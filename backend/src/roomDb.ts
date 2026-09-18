// Сохранение комнат в базе (этап 9.2).
//
// Комната целиком — одна строка JSON. Сохраняется после каждого действия вместе
// с балансами игроков, в одной транзакции: деньги в комнате и на аккаунтах не
// разъедутся, даже если сервер упадёт посередине записи.
// При старте сервера недоигранные комнаты поднимаются из базы обратно в память.

import type { DatabaseSync } from 'node:sqlite';

export type StoredRoom = {
  id: string;
  status: string;
  players: { id: string; balance: number }[];
};

export function ensureRoomTable(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id          TEXT PRIMARY KEY,
      status      TEXT NOT NULL,
      data        TEXT NOT NULL,
      updated_at  INTEGER NOT NULL
    )
  `);
}

// Комната и балансы её игроков — одной транзакцией.
export function saveRoom(db: DatabaseSync, room: StoredRoom) {
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO rooms (id, status, data, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data,
                                     updated_at = excluded.updated_at`,
    ).run(room.id, room.status, JSON.stringify(room), Date.now());

    const setBalance = db.prepare('UPDATE accounts SET balance = ? WHERE id = ?');
    for (const p of room.players) setBalance.run(p.balance, p.id);

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Недоигранные комнаты — их нужно поднять после перезапуска.
export function loadUnfinishedRooms<T>(db: DatabaseSync): T[] {
  const rows = db
    .prepare("SELECT data FROM rooms WHERE status != 'finished'")
    .all() as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as T);
}

// Номер комнаты занят — в том числе закрытой: её итоги лежат в базе.
export function roomIdTaken(db: DatabaseSync, id: string): boolean {
  return db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(id) !== undefined;
}
