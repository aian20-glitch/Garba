// Комнаты ШАХ в базе (этап 2, 04.11.2026). Отдельная таблица shah_rooms — комнаты Гарбы
// (таблица rooms) её не видят, и наоборот. Комната целиком — одна строка JSON.
//
// Монеты ШАХ не лежат в комнате: взнос списывается со счёта при старте матча и выплачивается
// в конце — каждый раз в одной транзакции с записью комнаты (флаги charged / settled в комнате),
// поэтому после падения сервера ничего не спишется и не заплатится дважды.

import type { DatabaseSync } from 'node:sqlite';

export function ensureShahTables(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shah_rooms (
      id          TEXT PRIMARY KEY,
      status      TEXT NOT NULL,
      data        TEXT NOT NULL,
      updated_at  INTEGER NOT NULL
    )
  `);
}

export function saveShahRoom(db: DatabaseSync, room: { id: string; status: string }) {
  db.prepare(
    `INSERT INTO shah_rooms (id, status, data, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data, updated_at = excluded.updated_at`,
  ).run(room.id, room.status, JSON.stringify(room), Date.now());
}

export function loadUnfinishedShahRooms<T>(db: DatabaseSync): T[] {
  const rows = db.prepare("SELECT data FROM shah_rooms WHERE status != 'finished'").all() as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as T);
}

export function shahRoomIdTaken(db: DatabaseSync, id: string): boolean {
  return db.prepare('SELECT 1 FROM shah_rooms WHERE id = ?').get(id) !== undefined;
}

// Списать взнос. false — денег не хватает (ничего не списано).
export function chargeCoins(db: DatabaseSync, accountId: string, amount: number): boolean {
  const r = db.prepare('UPDATE accounts SET balance = balance - ? WHERE id = ? AND balance >= ?').run(amount, accountId, amount);
  return Number(r.changes) === 1;
}

export function creditCoins(db: DatabaseSync, accountId: string, amount: number) {
  db.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?').run(amount, accountId);
}

// Забрать до amount — сколько есть (в минус счёт не уходит). Возвращает, сколько забрали.
export function debitUpTo(db: DatabaseSync, accountId: string, amount: number): number {
  const row = db.prepare('SELECT balance FROM accounts WHERE id = ?').get(accountId) as { balance: number } | undefined;
  const take = Math.max(0, Math.min(amount, row?.balance ?? 0));
  if (take > 0) db.prepare('UPDATE accounts SET balance = balance - ? WHERE id = ?').run(take, accountId);
  return take;
}
