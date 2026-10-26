// Сохранение комнат в базе (этап 9.2).
//
// Комната целиком — одна строка JSON. Сохраняется после каждого действия вместе
// с балансами игроков, в одной транзакции: деньги в комнате и на аккаунтах не
// разъедутся, даже если сервер упадёт посередине записи.
// При старте сервера недоигранные комнаты поднимаются из базы обратно в память.

import type { DatabaseSync } from 'node:sqlite';
import { emptyStats, type PlayerStats } from './stats.js';
import { experienceOf, ratingOf, type ActivityDay } from './rating.js';

export type StoredRoom = {
  id: string;
  status: string;
  players: { id: string; balance: number; reserve?: number }[];
  // Тренировка с ботами — в аккаунты ничего не пишется.
  practice?: boolean;
  // Закрытая комната уже записала итог в аккаунты (28.09.2026). Дальше её старые
  // цифры в аккаунты не пишутся: игроки успели взять бонус, получить подарок или
  // сыграть в другой комнате — смайлик на экране итогов затёр бы это.
  accountsClosed?: boolean;
  // Статистика игроков за эту комнату (этап 9.4). Нет — игра ещё не начиналась.
  stats?: Record<string, PlayerStats>;
  // Мастерство игроков, пока они за столом (этап 9.6) — как баланс.
  rating?: Record<string, { skill: number }>;
  // Активное время и партии игроков по дням (опыт, §16.1, 26.10.2026): { игрок: { день: … } }.
  activity?: Record<string, Record<string, { ms: number; deals: number }>>;
  // Ушли посреди игры (24.09.2026) — для них комната не «доиграна».
  departedIds?: string[];
  // Монеты за неделю (ТОП-3 недели, 23.10.2026): { неделя: { игрок: чистый плюс } }.
  weekly?: Record<string, Record<string, number>>;
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

  // Монеты за неделю (23.10.2026): чистый плюс игрока за столами комнаты в эту неделю.
  // ТОП-3 недели — сумма по комнатам. Неделя — дата понедельника (leaders.ts).
  db.exec(`
    CREATE TABLE IF NOT EXISTS week_coins (
      room_id    TEXT NOT NULL,
      player_id  TEXT NOT NULL,
      week       TEXT NOT NULL,
      coins      INTEGER NOT NULL,
      PRIMARY KEY (room_id, player_id, week)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS week_coins_week ON week_coins (week)');

  // Активность (опыт, §16.1, 26.10.2026): сколько игрок реально играл за столом комнаты
  // в этот день (без пауз и лобби) и сколько партий доиграл. Активный день — сумма по комнатам.
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_activity (
      room_id    TEXT NOT NULL,
      player_id  TEXT NOT NULL,
      day        TEXT NOT NULL,
      ms         INTEGER NOT NULL,
      deals      INTEGER NOT NULL,
      PRIMARY KEY (room_id, player_id, day)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS room_activity_player ON room_activity (player_id)');
}

// Записать комнату и балансы её игроков — без своей транзакции,
// чтобы можно было вложить в общую (подарок, бонус — этап 9.3).
export function writeRoom(db: DatabaseSync, room: StoredRoom) {
  db.prepare(
    `INSERT INTO rooms (id, status, data, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data,
                                   updated_at = excluded.updated_at`,
  ).run(room.id, room.status, JSON.stringify(room), Date.now());

  // Тренировка с ботами (решение владельца, 27.09.2026): монеты, рейтинг и статистика
  // игроков не меняются — в аккаунты из такой комнаты ничего не пишем.
  // Закрытая комната свой итог уже записала — больше в аккаунты не пишет.
  if (room.practice || room.accountsClosed) return;

  const setBalance = db.prepare('UPDATE accounts SET balance = ? WHERE id = ?');
  // В аккаунте — всё вместе: монеты за столом и запас, не взятый за стол (09.10.2026).
  for (const p of room.players) setBalance.run(p.balance + (p.reserve ?? 0), p.id);

  // Мастерство — только тем, кто за столом. Ушедшему оно записано при уходе
  // (vacateSeat): иначе старая комната затирала бы рейтинг, набранный в новой.
  if (room.rating) {
    const setSkill = db.prepare('UPDATE accounts SET skill = ? WHERE id = ?');
    for (const p of room.players) {
      const r = room.rating[p.id];
      if (r) setSkill.run(r.skill, p.id);
    }
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

  if (room.activity) {
    const upsert = db.prepare(
      `INSERT INTO room_activity (room_id, player_id, day, ms, deals) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(room_id, player_id, day) DO UPDATE SET ms = excluded.ms, deals = excluded.deals`,
    );
    for (const [playerId, days] of Object.entries(room.activity)) {
      for (const [day, a] of Object.entries(days)) upsert.run(room.id, playerId, day, Math.round(a.ms), a.deals);
    }
  }

  if (room.weekly) {
    const upsert = db.prepare(
      `INSERT INTO week_coins (room_id, player_id, week, coins) VALUES (?, ?, ?, ?)
       ON CONFLICT(room_id, player_id, week) DO UPDATE SET coins = excluded.coins`,
    );
    for (const [week, byPlayer] of Object.entries(room.weekly)) {
      for (const [playerId, coins] of Object.entries(byPlayer)) upsert.run(room.id, playerId, week, coins);
    }
  }
}

// Дни игрока: время и партии по всем комнатам. skipRoom — эту комнату не брать из базы
// (её свежие цифры — в памяти, их добавляет вызывающий).
export function activityDays(db: DatabaseSync, playerId: string, skipRoom?: string): ActivityDay[] {
  const rows = db
    .prepare(
      `SELECT day, SUM(ms) AS ms, SUM(deals) AS deals FROM room_activity
       WHERE player_id = ? AND room_id != ? GROUP BY day`,
    )
    .all(playerId, skipRoom ?? '') as { day: string; ms: number; deals: number }[];
  return rows.map((r) => ({ day: r.day, ms: Number(r.ms), deals: Number(r.deals) }));
}

// Сложить дни из базы и из комнаты в памяти.
export function mergeDays(days: ActivityDay[], extra: Record<string, { ms: number; deals: number }> = {}): ActivityDay[] {
  const map = new Map(days.map((d) => [d.day, { ...d }]));
  for (const [day, a] of Object.entries(extra)) {
    const d = map.get(day) ?? { day, ms: 0, deals: 0 };
    d.ms += a.ms;
    d.deals += a.deals;
    map.set(day, d);
  }
  return [...map.values()];
}

// Опыт игрока (§16.1): старый опыт из аккаунта + активные дни и серия.
export function playerExperience(db: DatabaseSync, playerId: string, room?: { id: string; activity?: StoredRoom['activity'] }): number {
  const row = db.prepare('SELECT legacy_experience AS legacy FROM accounts WHERE id = ?').get(playerId) as
    | { legacy: number }
    | undefined;
  const days = room
    ? mergeDays(activityDays(db, playerId, room.id), room.activity?.[playerId])
    : activityDays(db, playerId);
  return experienceOf(Number(row?.legacy ?? 0), days);
}

// Монеты за неделю — у всех игроков (не ботов), сумма по комнатам.
export function weekCoins(db: DatabaseSync, week: string): { id: string; name: string; code: string; coins: number }[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.name, a.code, SUM(w.coins) AS coins
       FROM week_coins w JOIN accounts a ON a.id = w.player_id
       WHERE w.week = ? AND a.is_bot = 0
       GROUP BY a.id`,
    )
    .all(week) as { id: string; name: string; code: string; coins: number }[];
  return rows.map((r) => ({ ...r, coins: Number(r.coins) }));
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

// Рейтинг игроков (RULES.md §16): мастерство + опыт (старый + активные дни и серия).
// ids — только эти игроки (друзья); без ids — все. По убыванию рейтинга.
export function ratedPlayers(db: DatabaseSync, ids?: string[]): RatedPlayer[] {
  if (ids && ids.length === 0) return [];
  // Боты сервера в рейтинге не участвуют.
  const where = ids ? `WHERE a.is_bot = 0 AND a.id IN (${ids.map(() => '?').join(', ')})` : 'WHERE a.is_bot = 0';
  const rows = db
    .prepare(
      `SELECT a.id, a.name, a.code, a.skill, a.legacy_experience AS legacy FROM accounts a ${where}`,
    )
    .all(...(ids ?? [])) as { id: string; name: string; code: string; skill: number; legacy: number }[];

  // Дни всех этих игроков — одним запросом.
  const dayRows = db
    .prepare(
      `SELECT ra.player_id AS id, ra.day, SUM(ra.ms) AS ms, SUM(ra.deals) AS deals
       FROM room_activity ra JOIN accounts a ON a.id = ra.player_id
       ${where.replace('a.id IN', 'ra.player_id IN')}
       GROUP BY ra.player_id, ra.day`,
    )
    .all(...(ids ?? [])) as { id: string; day: string; ms: number; deals: number }[];
  const days = new Map<string, ActivityDay[]>();
  for (const d of dayRows) {
    days.set(d.id, [...(days.get(d.id) ?? []), { day: d.day, ms: Number(d.ms), deals: Number(d.deals) }]);
  }

  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      rating: ratingOf(Number(r.skill), experienceOf(Number(r.legacy ?? 0), days.get(r.id) ?? [])),
    }))
    .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
}
