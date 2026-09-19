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
import { ensureAvatarTable } from './avatars.js';
import { START_SKILL } from './rating.js';

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
  // Мастерство 0…8 (RULES.md §16). Рейтинг = мастерство + опыт по сыгранным партиям.
  skill: number;
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
  // Друзья (этап 9.4): дружба взаимная — строка в обе стороны.
  db.exec(`
    CREATE TABLE IF NOT EXISTS friends (
      owner_id    TEXT NOT NULL,
      friend_id   TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      PRIMARY KEY (owner_id, friend_id)
    )
  `);
  ensureRoomTable(db); // комнаты — этап 9.2
  ensureAvatarTable(db); // аватары — этап 9.5
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
  add('skill', `REAL NOT NULL DEFAULT ${START_SKILL}`); // рейтинг — этап 9.6
  // Бонус за приглашение платится после 3 комнат друга (19.09.2026). Кого пригласили
  // раньше, тем уже заплатили сразу при регистрации — помечаем оплаченными.
  if (!columns.has('referral_paid')) {
    db.exec('ALTER TABLE accounts ADD COLUMN referral_paid INTEGER NOT NULL DEFAULT 0');
    db.exec('UPDATE accounts SET referral_paid = 1 WHERE invited_by IS NOT NULL');
  }

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

const ACCOUNT_FIELDS = 'id, name, balance, created_at, code, daily_day, daily_streak, invited_by, skill';

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
    skill: Number(row.skill ?? START_SKILL),
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
    `INSERT INTO accounts (id, token_hash, name, balance, created_at, code, daily_streak, invited_by, skill)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(id, hashToken(token), name, STARTING_COINS, createdAt, code, invitedBy, START_SKILL);

  return {
    account: {
      id, name, balance: STARTING_COINS, createdAt, code,
      dailyDay: null, dailyStreak: 0, invitedBy, skill: START_SKILL,
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
// Кто пригласил игрока, если бонус за него ещё не выплачен.
export function unpaidInviter(db: DatabaseSync, id: string): string | null {
  const row = db
    .prepare('SELECT invited_by FROM accounts WHERE id = ? AND invited_by IS NOT NULL AND referral_paid = 0')
    .get(id) as { invited_by: string } | undefined;
  return row ? String(row.invited_by) : null;
}

export function markReferralPaid(db: DatabaseSync, id: string) {
  db.prepare('UPDATE accounts SET referral_paid = 1 WHERE id = ?').run(id);
}

export function invitedCount(db: DatabaseSync, id: string): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE invited_by = ?').get(id) as { n: number };
  return Number(row.n);
}

// --- Друзья (этап 9.4) ---
// Добавил по коду — дружба сразу взаимная: у обоих в списке. Удалил — у обоих пропала.

export function areFriends(db: DatabaseSync, a: string, b: string): boolean {
  return db.prepare('SELECT 1 FROM friends WHERE owner_id = ? AND friend_id = ?').get(a, b) !== undefined;
}

export function addFriend(db: DatabaseSync, a: string, b: string) {
  const now = Date.now();
  const insert = db.prepare('INSERT OR IGNORE INTO friends (owner_id, friend_id, created_at) VALUES (?, ?, ?)');
  transaction(db, () => {
    insert.run(a, b, now);
    insert.run(b, a, now);
  });
}

export function removeFriend(db: DatabaseSync, a: string, b: string) {
  const del = db.prepare('DELETE FROM friends WHERE owner_id = ? AND friend_id = ?');
  transaction(db, () => {
    del.run(a, b);
    del.run(b, a);
  });
}

export function listFriends(db: DatabaseSync, ownerId: string): Account[] {
  const rows = db
    .prepare(
      `SELECT ${ACCOUNT_FIELDS.split(', ').map((c) => 'a.' + c).join(', ')}
       FROM friends f JOIN accounts a ON a.id = f.friend_id
       WHERE f.owner_id = ? ORDER BY a.name`,
    )
    .all(ownerId) as Record<string, unknown>[];
  return rows.map((r) => toAccount(r)!);
}

// Токен из заголовка «Authorization: Bearer <токен>».
export function tokenFromHeader(header: unknown): string {
  if (typeof header !== 'string') return '';
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : '';
}
