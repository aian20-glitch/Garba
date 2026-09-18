// Аккаунты игроков и база данных (этап 9.1, дополнено на 9.3).
//
// Вход без пароля и СМС: при первом запуске игрок вводит имя, сервер создаёт аккаунт
// и выдаёт секретный токен. Телефон хранит токен и предъявляет его в каждом запросе.
// В базе лежит только хеш токена — утечка базы не даёт войти за игрока.
// Телефон или Google можно будет привязать позже, не меняя аккаунт.
//
// База — встроенный в Node.js SQLite (node:sqlite): без зависимостей и отдельного сервера.

import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { STARTING_COINS } from './config.js';
import { ensureRoomTable } from './roomDb.js';
import { makePlayerCode } from './bonus.js';

export type Account = {
  id: string;
  name: string;
  balance: number;
  createdAt: number;
  // Код игрока (этап 9.3): по нему приглашают друзей и дарят монеты.
  code: string;
  // Ежедневный бонус: день последнего бонуса и его день серии 1…7.
  dailyDay: string | null;
  dailyStreak: number;
  // Кто пригласил (id аккаунта) — null, если пришёл сам.
  invitedBy: string | null;
};

export const NAME_MAX_LENGTH = 20;

// file — путь к файлу базы или ':memory:' для проверок.
export function openDb(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id          TEXT PRIMARY KEY,
      token_hash  TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      balance     INTEGER NOT NULL,
      created_at  INTEGER NOT NULL
    )
  `);
  migrateAccounts(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS gifts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id     TEXT NOT NULL,
      to_id       TEXT NOT NULL,
      amount      INTEGER NOT NULL,
      day         TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS gifts_from_day ON gifts (from_id, day)');
  ensureRoomTable(db); // комнаты — этап 9.2
  return db;
}

// Поля этапа 9.3 добавляются и в уже созданную базу — без потери аккаунтов.
function migrateAccounts(db: DatabaseSync) {
  const columns = new Set(
    (db.prepare('PRAGMA table_info(accounts)').all() as { name: string }[]).map((c) => c.name),
  );
  const add = (name: string, type: string) => {
    if (!columns.has(name)) db.exec(`ALTER TABLE accounts ADD COLUMN ${name} ${type}`);
  };
  add('code', 'TEXT');
  add('daily_day', 'TEXT');
  add('daily_streak', 'INTEGER NOT NULL DEFAULT 0');
  add('invited_by', 'TEXT');

  // Аккаунтам, созданным до этапа 9.3, выдаём коды.
  const withoutCode = db.prepare('SELECT id FROM accounts WHERE code IS NULL').all() as { id: string }[];
  for (const { id } of withoutCode) {
    db.prepare('UPDATE accounts SET code = ? WHERE id = ?').run(freeCode(db), id);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS accounts_code ON accounts (code)');
}

function freeCode(db: DatabaseSync): string {
  for (;;) {
    const code = makePlayerCode();
    if (!db.prepare('SELECT 1 FROM accounts WHERE code = ?').get(code)) return code;
  }
}

// Несколько записей — всё или ничего.
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const ACCOUNT_FIELDS = 'id, name, balance, created_at, code, daily_day, daily_streak, invited_by';

function toAccount(row: Record<string, unknown> | undefined): Account | null {
  if (!row) return null;
  return {
    id: String(row.id),
    name: String(row.name),
    balance: Number(row.balance),
    createdAt: Number(row.created_at),
    code: String(row.code),
    dailyDay: row.daily_day == null ? null : String(row.daily_day),
    dailyStreak: Number(row.daily_streak ?? 0),
    invitedBy: row.invited_by == null ? null : String(row.invited_by),
  };
}

// Имя: без пробелов по краям, от 1 до 20 символов. null — имя не подходит.
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length === 0 || name.length > NAME_MAX_LENGTH) return null;
  return name;
}

// Новый аккаунт со стартовыми 10 000 монет (ТЗ §2). Токен возвращается один раз —
// сервер его больше нигде не хранит, только хеш. invitedBy — id пригласившего.
export function createAccount(
  db: DatabaseSync,
  name: string,
  invitedBy: string | null = null,
): { account: Account; token: string } {
  const id = randomUUID();
  const token = randomBytes(32).toString('hex');
  const createdAt = Date.now();
  const code = freeCode(db);

  db.prepare(
    `INSERT INTO accounts (id, token_hash, name, balance, created_at, code, daily_streak, invited_by)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
  ).run(id, hashToken(token), name, STARTING_COINS, createdAt, code, invitedBy);

  return {
    account: {
      id, name, balance: STARTING_COINS, createdAt, code,
      dailyDay: null, dailyStreak: 0, invitedBy,
    },
    token,
  };
}

export function findAccountByToken(db: DatabaseSync, token: string): Account | null {
  if (!token) return null;
  const row = db
    .prepare(`SELECT ${ACCOUNT_FIELDS} FROM accounts WHERE token_hash = ?`)
    .get(hashToken(token)) as Record<string, unknown> | undefined;
  return toAccount(row);
}

export function findAccountByCode(db: DatabaseSync, code: string): Account | null {
  if (!code) return null;
  const row = db
    .prepare(`SELECT ${ACCOUNT_FIELDS} FROM accounts WHERE code = ?`)
    .get(code) as Record<string, unknown> | undefined;
  return toAccount(row);
}

export function getAccount(db: DatabaseSync, id: string): Account | null {
  const row = db
    .prepare(`SELECT ${ACCOUNT_FIELDS} FROM accounts WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return toAccount(row);
}

export function setBalance(db: DatabaseSync, id: string, balance: number) {
  db.prepare('UPDATE accounts SET balance = ? WHERE id = ?').run(balance, id);
}

export function setDaily(db: DatabaseSync, id: string, day: string, streak: number) {
  db.prepare('UPDATE accounts SET daily_day = ?, daily_streak = ? WHERE id = ?').run(day, streak, id);
}

// Дарил ли игрок сегодня (ТЗ §5: не больше одного подарка в сутки).
export function giftedOn(db: DatabaseSync, fromId: string, day: string): boolean {
  return db.prepare('SELECT 1 FROM gifts WHERE from_id = ? AND day = ?').get(fromId, day) !== undefined;
}

export function recordGift(db: DatabaseSync, fromId: string, toId: string, amount: number, day: string) {
  db.prepare('INSERT INTO gifts (from_id, to_id, amount, day, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(fromId, toId, amount, day, Date.now());
}

// Сколько человек пришло по приглашению этого игрока.
export function invitedCount(db: DatabaseSync, id: string): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE invited_by = ?').get(id) as { n: number };
  return Number(row.n);
}

// Токен из заголовка «Authorization: Bearer <токен>».
export function tokenFromHeader(header: unknown): string {
  if (typeof header !== 'string') return '';
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : '';
}
