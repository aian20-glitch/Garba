// Сохранение комнат в базе (этап 9.2).
//
// Комната целиком — одна строка JSON. Сохраняется после каждого действия вместе
// с балансами игроков, в одной транзакции: деньги в комнате и на аккаунтах не
// разъедутся, даже если сервер упадёт посередине записи.
// При старте сервера недоигранные комнаты поднимаются из базы обратно в память.

import type { DatabaseSync } from 'node:sqlite';
import { emptyStats, type PlayerStats } from './stats.js';
import { ratingOf } from './rating.js';

export type StoredRoom = {
  id: string;
  status: string;
  players: { id: string; balance: number }[];
  // Статистика игроков за эту комнату (этап 9.4). Нет — игра ещё не начиналась.
  stats?: Record<string, PlayerStats>;
  // Мастерство игроков, пока они за столом (этап 9.6) — как баланс.
  rating?: Record<string, { skill: number }>;
  // Ушли посреди игры (24.09.2026) — для них комната не «доиграна».
  departedIds?: string[];
};

// Колонки статистики в базе и поля PlayerStats — в одном порядке.
const STAT_COLUMNS: [string, keyof PlayerStats][] = [
  ['deals', 'deals'],
  ['mains', 'mains'],
  ['wins', 'wins'],
  ['losses', 'losses'],
  ['raz', 'raz'],
  ['dva', 'dva'],
  ['kon', 'kon'],
  ['garba', 'garba'],
  ['coins_won', 'coinsWon'],
  ['coins_lost', 'coinsLost'],
  ['max_win', 'maxWin'],
  ['max_risk', 'maxRisk'],
];

export function ensureRoomTable(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id          TEXT PRIMARY KEY,
      status      TEXT NOT NULL,
      data        TEXT NOT NULL,
      updated_at  INTEGER NOT NULL
    )
  `);

  // Статистика игрока за одну комнату (этап 9.4). Профиль — сумма по всем комнатам.
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_stats (
      room_id    TEXT NOT NULL,
      player_id  TEXT NOT NULL,
      finished   INTEGER NOT NULL,
      ${STAT_COLUMNS.map(([c]) => `${c} INTEGER NOT NULL`).join(', ')},
      PRIMARY KEY (room_id, player_id)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS room_stats_player ON room_stats (player_id)');
}

// Записать комнату и балансы её игроков — без своей транзакции,
// чтобы можно было вложить в общую (подарок, бонус — этап 9.3).
export function writeRoom(db: DatabaseSync, room: StoredRoom) {
  db.prepare(
    `INSERT INTO rooms (id, status, data, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data,
                                   updated_at = excluded.updated_at`,
  ).run(room.id, room.status, JSON.stringify(room), Date.now());

  const setBalance = db.prepare('UPDATE accounts SET balance = ? WHERE id = ?');
  for (const p of room.players) setBalance.run(p.balance, p.id);

  if (room.rating) {
    const setSkill = db.prepare('UPDATE accounts SET skill = ? WHERE id = ?');
    for (const [playerId, r] of Object.entries(room.rating)) setSkill.run(r.skill, playerId);
  }

  if (room.stats) {
    const cols = STAT_COLUMNS.map(([c]) => c);
    const upsert = db.prepare(
      `INSERT INTO room_stats (room_id, player_id, finished, ${cols.join(', ')})
       VALUES (?, ?, ?, ${cols.map(() => '?').join(', ')})
       ON CONFLICT(room_id, player_id) DO UPDATE SET finished = excluded.finished,
         ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}`,
    );
    const finished = room.status === 'finished' ? 1 : 0;
    const departed = new Set(room.departedIds ?? []);
    for (const [playerId, st] of Object.entries(room.stats)) {
      upsert.run(room.id, playerId, departed.has(playerId) ? 0 : finished, ...STAT_COLUMNS.map(([, k]) => st[k]));
    }
  }
}

// Статистика игрока за всё время (ТЗ §2): сумма по комнатам, максимумы — максимум.
// rooms — сколько комнат он доиграл до конца.
export function profileStats(db: DatabaseSync, playerId: string): PlayerStats & { rooms: number } {
  const sums = STAT_COLUMNS.map(([c]) =>
    c.startsWith('max_') ? `COALESCE(MAX(${c}), 0) AS ${c}` : `COALESCE(SUM(${c}), 0) AS ${c}`,
  );
  const row = db
    .prepare(`SELECT COALESCE(SUM(finished), 0) AS rooms, ${sums.join(', ')} FROM room_stats WHERE player_id = ?`)
    .get(playerId) as Record<string, number>;

  const stats = emptyStats();
  for (const [c, k] of STAT_COLUMNS) stats[k] = Number(row[c]);
  return { ...stats, rooms: Number(row.rooms) };
}

// Комната и балансы её игроков — одной транзакцией.
export function saveRoom(db: DatabaseSync, room: StoredRoom) {
  db.exec('BEGIN');
  try {
    writeRoom(db, room);
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

export type RatedPlayer = { id: string; name: string; code: string; rating: number };

// Рейтинг игроков (RULES.md §16): мастерство + опыт по всем сыгранным партиям.
// ids — только эти игроки (друзья); без ids — все. По убыванию рейтинга.
export function ratedPlayers(db: DatabaseSync, ids?: string[]): RatedPlayer[] {
  if (ids && ids.length === 0) return [];
  const where = ids ? `WHERE a.id IN (${ids.map(() => '?').join(', ')})` : '';
  const rows = db
    .prepare(
      `SELECT a.id, a.name, a.code, a.skill, COALESCE(SUM(rs.deals), 0) AS deals
       FROM accounts a LEFT JOIN room_stats rs ON rs.player_id = a.id
       ${where}
       GROUP BY a.id`,
    )
    .all(...(ids ?? [])) as { id: string; name: string; code: string; skill: number; deals: number }[];

  return rows
    .map((r) => ({ id: r.id, name: r.name, code: r.code, rating: ratingOf(Number(r.skill), Number(r.deals)) }))
    .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
}
