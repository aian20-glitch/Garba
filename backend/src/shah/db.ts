// Комнаты ШАХ в базе (этап 2, 04.11.2026). Отдельная таблица shah_rooms — комнаты Гарбы
// (таблица rooms) её не видят, и наоборот. Комната целиком — одна строка JSON.
//
// Монеты ШАХ не лежат в комнате: взнос списывается со счёта при старте матча и выплачивается
// в конце — каждый раз в одной транзакции с записью комнаты (флаги charged / settled в комнате),
// поэтому после падения сервера ничего не спишется и не заплатится дважды.

import type { DatabaseSync } from 'node:sqlite';
import { SHAH_START_SKILL } from './rating.js';

export function ensureShahTables(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shah_rooms (
      id          TEXT PRIMARY KEY,
      status      TEXT NOT NULL,
      data        TEXT NOT NULL,
      updated_at  INTEGER NOT NULL
    )
  `);
  // Рейтинг ШАХ (этап 4, 05.11.2026, SHAH_RULES.md §19) — отдельно от рейтинга Гарбы (accounts.skill):
  // мастерство ШАХ игрока. Строки нет — ещё не играл матч (не тренировку), мастерство 4.0.
  db.exec(`
    CREATE TABLE IF NOT EXISTS shah_players (
      player_id   TEXT PRIMARY KEY,
      skill       REAL NOT NULL,
      updated_at  INTEGER NOT NULL
    )
  `);
  // Итог каждого матча для каждого игрока (кроме тренировки): статистика профиля и история рейтинга.
  // outcome — win | lose | none | draw; coins — монеты за матч (+/−).
  db.exec(`
    CREATE TABLE IF NOT EXISTS shah_results (
      room_id       TEXT NOT NULL,
      player_id     TEXT NOT NULL,
      format        INTEGER NOT NULL,
      outcome       TEXT NOT NULL,
      coins         INTEGER NOT NULL,
      parties       INTEGER NOT NULL,
      skill_before  REAL NOT NULL,
      skill_after   REAL NOT NULL,
      active_ms     INTEGER NOT NULL,
      finished_at   INTEGER NOT NULL,
      PRIMARY KEY (room_id, player_id)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS shah_results_player ON shah_results (player_id)');
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

// ——— Рейтинг и статистика ШАХ (этап 4) ———

export function shahSkillOf(db: DatabaseSync, accountId: string): number {
  const row = db.prepare('SELECT skill FROM shah_players WHERE player_id = ?').get(accountId) as { skill: number } | undefined;
  return row ? Number(row.skill) : SHAH_START_SKILL;
}

export type ShahResultRow = {
  roomId: string;
  playerId: string;
  format: number;
  outcome: string;
  coins: number;
  parties: number;
  skillBefore: number;
  skillAfter: number;
  activeMs: number;
  finishedAt: number;
};

// Итог матча игрока и его новое мастерство — вызывать в транзакции записи комнаты.
export function writeShahResult(db: DatabaseSync, r: ShahResultRow) {
  db.prepare(
    `INSERT INTO shah_results (room_id, player_id, format, outcome, coins, parties, skill_before, skill_after, active_ms, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(room_id, player_id) DO NOTHING`,
  ).run(r.roomId, r.playerId, r.format, r.outcome, r.coins, r.parties, r.skillBefore, r.skillAfter, Math.round(r.activeMs), r.finishedAt);
  db.prepare(
    `INSERT INTO shah_players (player_id, skill, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(player_id) DO UPDATE SET skill = excluded.skill, updated_at = excluded.updated_at`,
  ).run(r.playerId, r.skillAfter, r.finishedAt);
}

export type ShahStats = { matches: number; wins: number; losses: number; parties: number; coins: number };

// Статистика ШАХ за всё время — по матчам, не по тренировкам.
export function shahStatsOf(db: DatabaseSync, accountId: string): ShahStats {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS matches,
              COALESCE(SUM(outcome = 'win'), 0) AS wins,
              COALESCE(SUM(outcome = 'lose'), 0) AS losses,
              COALESCE(SUM(parties), 0) AS parties,
              COALESCE(SUM(coins), 0) AS coins
       FROM shah_results WHERE player_id = ?`,
    )
    .get(accountId) as Record<string, number>;
  return {
    matches: Number(row.matches),
    wins: Number(row.wins),
    losses: Number(row.losses),
    parties: Number(row.parties),
    coins: Number(row.coins),
  };
}

export type ShahLeader = { id: string; name: string; code: string; skill: number; matches: number; wins: number };

// Рейтинг ШАХ: ids — только эти игроки (я и друзья; кто не играл — с мастерством 4.0); без ids —
// все, кто сыграл хотя бы один матч. Боты сервера не участвуют. По убыванию мастерства.
export function shahLeaders(db: DatabaseSync, ids?: string[]): ShahLeader[] {
  if (ids && ids.length === 0) return [];
  const join = ids ? 'LEFT JOIN' : 'JOIN';
  const where = ids ? `AND a.id IN (${ids.map(() => '?').join(', ')})` : '';
  const rows = db
    .prepare(
      `SELECT a.id, a.name, a.code, s.skill,
              (SELECT COUNT(*) FROM shah_results r WHERE r.player_id = a.id) AS matches,
              (SELECT COUNT(*) FROM shah_results r WHERE r.player_id = a.id AND r.outcome = 'win') AS wins
       FROM accounts a ${join} shah_players s ON s.player_id = a.id
       WHERE a.is_bot = 0 ${where}`,
    )
    .all(...(ids ?? [])) as { id: string; name: string; code: string; skill: number | null; matches: number; wins: number }[];
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      skill: r.skill === null ? SHAH_START_SKILL : Number(r.skill),
      matches: Number(r.matches),
      wins: Number(r.wins),
    }))
    .sort((a, b) => b.skill - a.skill || b.matches - a.matches || a.name.localeCompare(b.name));
}

// Удаление аккаунта (требование Apple и Google): рейтинг и итоги ШАХ — стереть, в сохранённых
// комнатах ШАХ имя — deletedName. Таблиц может не быть (ШАХ на сервере не включали) — тогда нечего.
export function deleteShahData(db: DatabaseSync, accountId: string, deletedName: string) {
  const has = (table: string) => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;
  if (has('shah_players')) db.prepare('DELETE FROM shah_players WHERE player_id = ?').run(accountId);
  if (has('shah_results')) db.prepare('DELETE FROM shah_results WHERE player_id = ?').run(accountId);
  if (!has('shah_rooms')) return;
  const rows = db.prepare('SELECT id, data FROM shah_rooms WHERE data LIKE ?').all(`%${accountId}%`) as { id: string; data: string }[];
  const update = db.prepare('UPDATE shah_rooms SET data = ? WHERE id = ?');
  for (const row of rows) update.run(JSON.stringify(anonymizeShah(JSON.parse(row.data), accountId, deletedName)), row.id);
}

// Имя игрока — везде, где рядом его id: players[].name ({ id, name }), личная пауза ({ playerId, name }).
export function anonymizeShah<T>(value: T, accountId: string, deletedName: string): T {
  if (Array.isArray(value)) return value.map((v) => anonymizeShah(v, accountId, deletedName)) as T;
  if (value === null || typeof value !== 'object') return value;
  const obj = { ...(value as Record<string, unknown>) };
  for (const [key, v] of Object.entries(obj)) obj[key] = anonymizeShah(v, accountId, deletedName);
  if ((obj.id === accountId || obj.playerId === accountId) && typeof obj.name === 'string') obj.name = deletedName;
  return obj as T;
}
