// Аккаунты игроков и база данных (этап 9.1).
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

export type Account = {
  id: string;
  name: string;
  balance: number;
  createdAt: number;
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
  ensureRoomTable(db); // комнаты — этап 9.2
  return db;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toAccount(row: Record<string, unknown> | undefined): Account | null {
  if (!row) return null;
  return {
    id: String(row.id),
    name: String(row.name),
    balance: Number(row.balance),
    createdAt: Number(row.created_at),
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
// сервер его больше нигде не хранит, только хеш.
export function createAccount(db: DatabaseSync, name: string): { account: Account; token: string } {
  const id = randomUUID();
  const token = randomBytes(32).toString('hex');
  const createdAt = Date.now();

  db.prepare(
    'INSERT INTO accounts (id, token_hash, name, balance, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, hashToken(token), name, STARTING_COINS, createdAt);

  return { account: { id, name, balance: STARTING_COINS, createdAt }, token };
}

export function findAccountByToken(db: DatabaseSync, token: string): Account | null {
  if (!token) return null;
  const row = db
    .prepare('SELECT id, name, balance, created_at FROM accounts WHERE token_hash = ?')
    .get(hashToken(token)) as Record<string, unknown> | undefined;
  return toAccount(row);
}

export function getAccount(db: DatabaseSync, id: string): Account | null {
  const row = db
    .prepare('SELECT id, name, balance, created_at FROM accounts WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  return toAccount(row);
}

export function setBalance(db: DatabaseSync, id: string, balance: number) {
  db.prepare('UPDATE accounts SET balance = ? WHERE id = ?').run(balance, id);
}

// Токен из заголовка «Authorization: Bearer <токен>».
export function tokenFromHeader(header: unknown): string {
  if (typeof header !== 'string') return '';
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : '';
}
