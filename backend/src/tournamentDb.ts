// Еженедельный турнир в базе (RULES.md §19). Турнир, участники, столы и журнал денег.
//
// Деньги турнира двигаются только через журнал tournament_ledger: у каждого движения свой
// уникальный ключ (взнос игрока, возврат, +50 000 за стол, остаток в казну, выплата).
// Запись в журнал и изменение кошелька — в одной транзакции; ключ уже есть — второй раз
// ничего не происходит. Так повторный запрос, переподключение и перезапуск сервера не
// спишут, не вернут и не заплатят дважды.

import type { DatabaseSync } from 'node:sqlite';
import { clampSkill, ENTRY_FEE, type Standing } from './tournament.js';

export type TournamentStatus = 'registration' | 'cancelled' | 'qualification' | 'final' | 'finished';

// registered — зарегистрирован, ещё не сыграл; playing — играет стол отбора; played — сыграл
// отбор; finalist — прошёл в финал; out — не прошёл; final_playing — играет финал;
// final_done — сыграл финал; penalized — наказан (§19.6); refunded — турнир отменён.
export type EntryStatus =
  | 'registered'
  | 'playing'
  | 'played'
  | 'finalist'
  | 'out'
  | 'final_playing'
  | 'final_done'
  | 'penalized'
  | 'refunded';

export type Tournament = {
  id: string;
  status: TournamentStatus;
  startsAt: number;
  regEndsAt: number;
  qualEndsAt: number;
  finalEndsAt: number | null;
  winnerId: string | null;
  winnerPrize: number | null;
  finishedAt: number | null;
};

export type Entry = Standing & {
  tournamentId: string;
  accountId: string;
  name: string;
  status: EntryStatus;
  tableNo: number | null;
  qualBalance: number | null; // итог отбора — для списка
  finalPlace: number | null;
  ratingDelta: number | null;
  // Счёт финала для ничьей (§19.7) — отдельно от отбора.
  finalRazWins: number;
  finalDvaWins: number;
  finalMaxRisk: number;
};

export type TableStage = 'qual' | 'final';
export type TableStatus = 'waiting' | 'playing' | 'finished' | 'skipped';

export type TournamentTable = {
  tournamentId: string;
  stage: TableStage;
  tableNo: number;
  capacity: number;
  roomId: string | null;
  status: TableStatus;
  startedAt: number | null;
  finishedAt: number | null;
};

// Куда идут деньги: в кошелёк игрока (fee, refund, payout) или в казну (остальное).
export type LedgerKind = 'fee' | 'refund' | 'table' | 'leftover' | 'penalty' | 'bot' | 'payout';
const TREASURY_KINDS: LedgerKind[] = ['table', 'leftover', 'penalty', 'bot'];

export function ensureTournamentTables(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tournaments (
      id             TEXT PRIMARY KEY,
      status         TEXT NOT NULL,
      starts_at      INTEGER NOT NULL,
      reg_ends_at    INTEGER NOT NULL,
      qual_ends_at   INTEGER NOT NULL,
      final_ends_at  INTEGER,
      winner_id      TEXT,
      winner_prize   INTEGER,
      finished_at    INTEGER
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS tournament_entries (
      tournament_id    TEXT NOT NULL,
      account_id       TEXT NOT NULL,
      name             TEXT NOT NULL,
      registered_at    INTEGER NOT NULL,
      status           TEXT NOT NULL,
      balance          INTEGER NOT NULL,
      table_no         INTEGER,
      qual_balance     INTEGER,
      raz_wins         INTEGER NOT NULL DEFAULT 0,
      dva_wins         INTEGER NOT NULL DEFAULT 0,
      max_risk         INTEGER NOT NULL DEFAULT 0,
      final_raz_wins   INTEGER NOT NULL DEFAULT 0,
      final_dva_wins   INTEGER NOT NULL DEFAULT 0,
      final_max_risk   INTEGER NOT NULL DEFAULT 0,
      final_place      INTEGER,
      rating_delta     REAL,
      PRIMARY KEY (tournament_id, account_id)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS tournament_entries_account ON tournament_entries (account_id)');
  db.exec(`
    CREATE TABLE IF NOT EXISTS tournament_tables (
      tournament_id  TEXT NOT NULL,
      stage          TEXT NOT NULL,
      table_no       INTEGER NOT NULL,
      capacity       INTEGER NOT NULL,
      room_id        TEXT,
      status         TEXT NOT NULL,
      started_at     INTEGER,
      finished_at    INTEGER,
      PRIMARY KEY (tournament_id, stage, table_no)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS tournament_ledger (
      key            TEXT PRIMARY KEY,
      tournament_id  TEXT NOT NULL,
      kind           TEXT NOT NULL,
      account_id     TEXT,
      amount         INTEGER NOT NULL,
      at             INTEGER NOT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS tournament_ledger_t ON tournament_ledger (tournament_id)');
}

// --- Журнал денег ---

// Записать движение. false — с этим ключом уже было: второй раз не делать.
export function ledgerAdd(
  db: DatabaseSync,
  key: string,
  tournamentId: string,
  kind: LedgerKind,
  accountId: string | null,
  amount: number,
  at: number = Date.now(),
): boolean {
  const r = db
    .prepare(
      `INSERT INTO tournament_ledger (key, tournament_id, kind, account_id, amount, at)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO NOTHING`,
    )
    .run(key, tournamentId, kind, accountId, amount, at);
  return Number(r.changes) === 1;
}

// Казна: +50 000 за столы, остатки не прошедших, монеты наказанных и ботов.
export function treasuryOf(db: DatabaseSync, tournamentId: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM tournament_ledger
       WHERE tournament_id = ? AND kind IN (${TREASURY_KINDS.map(() => '?').join(', ')})`,
    )
    .get(tournamentId, ...TREASURY_KINDS) as { total: number | bigint };
  return Number(row.total);
}

export function ledgerOf(db: DatabaseSync, tournamentId: string): { key: string; kind: LedgerKind; accountId: string | null; amount: number }[] {
  return (
    db
      .prepare('SELECT key, kind, account_id AS accountId, amount FROM tournament_ledger WHERE tournament_id = ? ORDER BY at, key')
      .all(tournamentId) as { key: string; kind: LedgerKind; accountId: string | null; amount: number }[]
  ).map((r) => ({ ...r, amount: Number(r.amount) }));
}

// --- Турнир ---

function toTournament(row: Record<string, unknown> | undefined): Tournament | null {
  if (!row) return null;
  return {
    id: String(row.id),
    status: row.status as TournamentStatus,
    startsAt: Number(row.starts_at),
    regEndsAt: Number(row.reg_ends_at),
    qualEndsAt: Number(row.qual_ends_at),
    finalEndsAt: row.final_ends_at === null ? null : Number(row.final_ends_at),
    winnerId: (row.winner_id as string | null) ?? null,
    winnerPrize: row.winner_prize === null ? null : Number(row.winner_prize),
    finishedAt: row.finished_at === null ? null : Number(row.finished_at),
  };
}

// Новый турнир. Такой уже есть — ничего (недельный турнир открывается один раз).
export function createTournament(db: DatabaseSync, id: string, startsAt: number, regMs: number, qualMs: number): boolean {
  const r = db
    .prepare(
      `INSERT INTO tournaments (id, status, starts_at, reg_ends_at, qual_ends_at)
       VALUES (?, 'registration', ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
    )
    .run(id, startsAt, startsAt + regMs, startsAt + regMs + qualMs);
  return Number(r.changes) === 1;
}

export function getTournament(db: DatabaseSync, id: string): Tournament | null {
  return toTournament(db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id) as Record<string, unknown> | undefined);
}

// Турнир, который сейчас идёт (не закончен и не отменён).
export function activeTournament(db: DatabaseSync): Tournament | null {
  return toTournament(
    db.prepare("SELECT * FROM tournaments WHERE status NOT IN ('finished', 'cancelled') ORDER BY starts_at DESC LIMIT 1")
      .get() as Record<string, unknown> | undefined,
  );
}

// Последний турнир — идущий или уже закончившийся (для экрана «ТУРНИР»).
export function latestTournament(db: DatabaseSync): Tournament | null {
  return toTournament(
    db.prepare('SELECT * FROM tournaments ORDER BY starts_at DESC LIMIT 1').get() as Record<string, unknown> | undefined,
  );
}

// Сменить состояние, только если сейчас оно from — второй тик ничего не сделает.
export function moveTournament(
  db: DatabaseSync,
  id: string,
  from: TournamentStatus,
  to: TournamentStatus,
  extra: Partial<Pick<Tournament, 'finalEndsAt' | 'winnerId' | 'winnerPrize' | 'finishedAt'>> = {},
): boolean {
  const r = db
    .prepare(
      `UPDATE tournaments SET status = ?,
         final_ends_at = COALESCE(?, final_ends_at), winner_id = COALESCE(?, winner_id),
         winner_prize = COALESCE(?, winner_prize), finished_at = COALESCE(?, finished_at)
       WHERE id = ? AND status = ?`,
    )
    .run(to, extra.finalEndsAt ?? null, extra.winnerId ?? null, extra.winnerPrize ?? null, extra.finishedAt ?? null, id, from);
  return Number(r.changes) === 1;
}

// --- Участники ---

function toEntry(row: Record<string, unknown>): Entry {
  return {
    tournamentId: String(row.tournament_id),
    accountId: String(row.account_id),
    id: String(row.account_id),
    name: String(row.name),
    registeredAt: Number(row.registered_at),
    status: row.status as EntryStatus,
    balance: Number(row.balance),
    tableNo: row.table_no === null ? null : Number(row.table_no),
    qualBalance: row.qual_balance === null ? null : Number(row.qual_balance),
    razWins: Number(row.raz_wins),
    dvaWins: Number(row.dva_wins),
    maxRisk: Number(row.max_risk),
    finalRazWins: Number(row.final_raz_wins),
    finalDvaWins: Number(row.final_dva_wins),
    finalMaxRisk: Number(row.final_max_risk),
    finalPlace: row.final_place === null ? null : Number(row.final_place),
    ratingDelta: row.rating_delta === null ? null : Number(row.rating_delta),
  };
}

// Зарегистрировать. false — уже зарегистрирован (второй раз не записываем).
export function addEntry(db: DatabaseSync, tournamentId: string, accountId: string, name: string, at: number): boolean {
  const r = db
    .prepare(
      `INSERT INTO tournament_entries (tournament_id, account_id, name, registered_at, status, balance)
       VALUES (?, ?, ?, ?, 'registered', ?) ON CONFLICT(tournament_id, account_id) DO NOTHING`,
    )
    .run(tournamentId, accountId, name, at, ENTRY_FEE);
  return Number(r.changes) === 1;
}

export function entriesOf(db: DatabaseSync, tournamentId: string): Entry[] {
  return (
    db.prepare('SELECT * FROM tournament_entries WHERE tournament_id = ? ORDER BY registered_at, account_id')
      .all(tournamentId) as Record<string, unknown>[]
  ).map(toEntry);
}

export function entryOf(db: DatabaseSync, tournamentId: string, accountId: string): Entry | null {
  const row = db.prepare('SELECT * FROM tournament_entries WHERE tournament_id = ? AND account_id = ?')
    .get(tournamentId, accountId) as Record<string, unknown> | undefined;
  return row ? toEntry(row) : null;
}

// Сменить статус, только если сейчас он один из from. true — сменился.
export function moveEntry(
  db: DatabaseSync,
  tournamentId: string,
  accountId: string,
  from: EntryStatus[],
  to: EntryStatus,
  fields: { tableNo?: number; balance?: number; qualBalance?: number; finalPlace?: number } = {},
): boolean {
  const r = db
    .prepare(
      `UPDATE tournament_entries SET status = ?, table_no = COALESCE(?, table_no), balance = COALESCE(?, balance),
         qual_balance = COALESCE(?, qual_balance), final_place = COALESCE(?, final_place)
       WHERE tournament_id = ? AND account_id = ? AND status IN (${from.map(() => '?').join(', ')})`,
    )
    .run(
      to,
      fields.tableNo ?? null,
      fields.balance ?? null,
      fields.qualBalance ?? null,
      fields.finalPlace ?? null,
      tournamentId,
      accountId,
      ...from,
    );
  return Number(r.changes) === 1;
}

// Турнирный баланс и счёт для ничьей — пока игрок за турнирным столом (как баланс в writeRoom).
export function writeEntryPlay(
  db: DatabaseSync,
  tournamentId: string,
  accountId: string,
  stage: TableStage,
  balance: number,
  score: { razWins: number; dvaWins: number; maxRisk: number },
) {
  const playing: EntryStatus = stage === 'qual' ? 'playing' : 'final_playing';
  const cols = stage === 'qual' ? ['raz_wins', 'dva_wins', 'max_risk'] : ['final_raz_wins', 'final_dva_wins', 'final_max_risk'];
  db.prepare(
    `UPDATE tournament_entries SET balance = ?, ${cols[0]} = ?, ${cols[1]} = ?, ${cols[2]} = ?
     WHERE tournament_id = ? AND account_id = ? AND status = ?`,
  ).run(balance, score.razWins, score.dvaWins, score.maxRisk, tournamentId, accountId, playing);
}

// Рейтинг за турнир (§19.10) — один раз: второй вызов ничего не меняет. true — записали.
export function rateEntry(db: DatabaseSync, tournamentId: string, accountId: string, delta: number): boolean {
  const r = db
    .prepare('UPDATE tournament_entries SET rating_delta = ? WHERE tournament_id = ? AND account_id = ? AND rating_delta IS NULL')
    .run(delta, tournamentId, accountId);
  if (Number(r.changes) !== 1) return false;
  const row = db.prepare('SELECT skill FROM accounts WHERE id = ?').get(accountId) as { skill: number } | undefined;
  if (row) db.prepare('UPDATE accounts SET skill = ? WHERE id = ?').run(clampSkill(Number(row.skill) + delta), accountId);
  return true;
}

// Незаконченный турнир игрока — удалить аккаунт нельзя, пока он в нём (§19.2).
export function unfinishedEntryOf(db: DatabaseSync, accountId: string): string | null {
  const row = db
    .prepare(
      `SELECT e.tournament_id AS id FROM tournament_entries e JOIN tournaments t ON t.id = e.tournament_id
       WHERE e.account_id = ? AND t.status NOT IN ('finished', 'cancelled')
         AND e.status NOT IN ('penalized', 'refunded', 'out')`,
    )
    .get(accountId) as { id: string } | undefined;
  return row?.id ?? null;
}

// --- Столы ---

function toTable(row: Record<string, unknown>): TournamentTable {
  return {
    tournamentId: String(row.tournament_id),
    stage: row.stage as TableStage,
    tableNo: Number(row.table_no),
    capacity: Number(row.capacity),
    roomId: (row.room_id as string | null) ?? null,
    status: row.status as TableStatus,
    startedAt: row.started_at === null ? null : Number(row.started_at),
    finishedAt: row.finished_at === null ? null : Number(row.finished_at),
  };
}

export function addTable(db: DatabaseSync, tournamentId: string, stage: TableStage, tableNo: number, capacity: number, roomId: string): boolean {
  const r = db
    .prepare(
      `INSERT INTO tournament_tables (tournament_id, stage, table_no, capacity, room_id, status)
       VALUES (?, ?, ?, ?, ?, 'waiting') ON CONFLICT DO NOTHING`,
    )
    .run(tournamentId, stage, tableNo, capacity, roomId);
  return Number(r.changes) === 1;
}

export function tablesOf(db: DatabaseSync, tournamentId: string, stage?: TableStage): TournamentTable[] {
  const rows = stage
    ? db.prepare('SELECT * FROM tournament_tables WHERE tournament_id = ? AND stage = ? ORDER BY table_no').all(tournamentId, stage)
    : db.prepare("SELECT * FROM tournament_tables WHERE tournament_id = ? ORDER BY stage = 'final', table_no").all(tournamentId);
  return (rows as Record<string, unknown>[]).map(toTable);
}

export function moveTable(
  db: DatabaseSync,
  tournamentId: string,
  stage: TableStage,
  tableNo: number,
  from: TableStatus[],
  to: TableStatus,
  at: number = Date.now(),
): boolean {
  const field = to === 'playing' ? 'started_at' : 'finished_at';
  const r = db
    .prepare(
      `UPDATE tournament_tables SET status = ?, ${field} = ?
       WHERE tournament_id = ? AND stage = ? AND table_no = ? AND status IN (${from.map(() => '?').join(', ')})`,
    )
    .run(to, at, tournamentId, stage, tableNo, ...from);
  return Number(r.changes) === 1;
}

// --- Значок победителя (§19.12) ---

export function tournamentWinsOf(db: DatabaseSync, accountId: string): number {
  const row = db.prepare('SELECT tournament_wins AS w FROM accounts WHERE id = ?').get(accountId) as { w: number } | undefined;
  return Number(row?.w ?? 0);
}

// Удалить аккаунт: в турнирных списках вместо имени — «Удалённый игрок».
export function anonymizeEntries(db: DatabaseSync, accountId: string, deletedName: string) {
  db.prepare('UPDATE tournament_entries SET name = ? WHERE account_id = ?').run(deletedName, accountId);
}
