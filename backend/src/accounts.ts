// Аккаунты игроков и база данных (этап 9.1, дополнено на 9.3).
//
// Вход без пароля и СМС: при первом запуске игрок вводит имя, сервер создаёт аккаунт
// и выдаёт секретный токен. Телефон хранит токен и предъявляет его в каждом запросе.
// В базе лежит только хеш токена — утечка базы не даёт войти за игрока.
// Телефон или Google можно будет привязать позже, не меняя аккаунт.
//
// База — встроенный в Node.js SQLite (node:sqlite): без зависимостей и отдельного сервера.

import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { STARTING_COINS } from './config.js';
import { ensureRoomTable } from './roomDb.js';
import { makePlayerCode } from './bonus.js';
import { ensureAvatarTable } from './avatars.js';
import { START_SKILL } from './rating.js';
import { deleteModerationData, ensureModerationTables } from './moderation.js';
import { deleteShopData, ensureShopTables } from './shop.js';
import { anonymizeEntries, ensureTournamentTables } from './tournamentDb.js';
import { deleteShahData } from './shah/db.js';

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
  // timeout — сколько ждать, если база занята (например, ночной копией), вместо
  // мгновенной ошибки «database is locked». WAL — читатели не мешают записи.
  const db = new DatabaseSync(file, { timeout: 5000 });
  db.exec('PRAGMA journal_mode = WAL');
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
  // Заявки в друзья (решение владельца, 19.09.2026): дружба — только если второй согласился.
  db.exec(`
    CREATE TABLE IF NOT EXISTS friend_requests (
      from_id     TEXT NOT NULL,
      to_id       TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      PRIMARY KEY (from_id, to_id)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS friend_requests_to ON friend_requests (to_id)');
  // Дополнительные токены входа (07.10.2026): игра в Telegram получает свой токен на каждом
  // устройстве, и телефон с приложением при этом не выходит из аккаунта.
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_tokens (
      token_hash  TEXT PRIMARY KEY,
      account_id  TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS account_tokens_account ON account_tokens (account_id)');
  ensureRoomTable(db); // комнаты — этап 9.2
  ensureAvatarTable(db); // аватары — этап 9.5
  ensureModerationTables(db); // жалобы и блокировка — 29.09.2026
  ensureShopTables(db); // магазин — 13.10.2026
  ensureTournamentTables(db); // еженедельный турнир — 31.10.2026
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
  add('recovery_hash', 'TEXT');
  // Бот сервера (кнопка «ДОБАВИТЬ БОТОВ», 27.09.2026) — в рейтинге не показывается.
  add('is_bot', 'INTEGER NOT NULL DEFAULT 0');
  // Аккаунт Telegram (игра как Mini App, 07.10.2026): id пользователя Telegram.
  add('telegram_id', 'INTEGER');
  // Ссылки на аватарки из Telegram (10.10.2026) больше не храним (11.10.2026, решение владельца).
  if (columns.has('telegram_photo')) db.exec('UPDATE accounts SET telegram_photo = NULL');
  // Бонус за приглашение платится после 3 комнат друга (19.09.2026). Кого пригласили
  // раньше, тем уже заплатили сразу при регистрации — помечаем оплаченными.
  if (!columns.has('referral_paid')) {
    db.exec('ALTER TABLE accounts ADD COLUMN referral_paid INTEGER NOT NULL DEFAULT 0');
    db.exec('UPDATE accounts SET referral_paid = 1 WHERE invited_by IS NOT NULL');
  }

  // Медали за монеты (23.10.2026): самый большой баланс, до которого дошёл игрок. Растёт
  // сам при любой записи баланса (триггер) — за столом, бонус, подарок, магазин; вниз не идёт.
  add('peak_balance', 'INTEGER NOT NULL DEFAULT 0');

  // Опыт по старому правилу — +0.01 за партию, до 2.0 (новая система рейтинга, 26.10.2026).
  // Уже набранный опыт сохраняется (решение владельца), дальше опыт — за активные дни (§16.1).
  if (!columns.has('legacy_experience')) {
    db.exec('ALTER TABLE accounts ADD COLUMN legacy_experience REAL NOT NULL DEFAULT 0');
    const hasStats = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'room_stats'").get();
    if (hasStats) {
      db.exec(`UPDATE accounts SET legacy_experience = MIN(2, 0.01 *
        (SELECT COALESCE(SUM(deals), 0) FROM room_stats WHERE player_id = accounts.id))`);
    }
  }
  db.exec('UPDATE accounts SET peak_balance = balance WHERE balance > peak_balance');
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS accounts_peak_balance AFTER UPDATE OF balance ON accounts
    WHEN NEW.balance > NEW.peak_balance
    BEGIN
      UPDATE accounts SET peak_balance = NEW.balance WHERE id = NEW.id;
    END
  `);
  // Бан за выход из начатой игры (23.10.2026, leaveBan.ts): какой выход по счёту, когда
  // был последний и до какого времени нельзя за стол.
  add('leave_count', 'INTEGER NOT NULL DEFAULT 0');
  add('leave_last_at', 'INTEGER NOT NULL DEFAULT 0');
  add('ban_until', 'INTEGER NOT NULL DEFAULT 0');
  // Еженедельный турнир (§19, 31.10.2026): сколько раз выиграл (значок 🏆×N) и до какого
  // времени бан за неявку или выход из турнира — отдельно от счёта выходов §13d.
  add('tournament_wins', 'INTEGER NOT NULL DEFAULT 0');
  add('tournament_ban_until', 'INTEGER NOT NULL DEFAULT 0');

  // Аккаунтам, созданным до этапа 9.3, выдаём коды.
  const withoutCode = db.prepare('SELECT id FROM accounts WHERE code IS NULL').all() as { id: string }[];
  for (const { id } of withoutCode) {
    db.prepare('UPDATE accounts SET code = ? WHERE id = ?').run(freeCode(db), id);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS accounts_code ON accounts (code)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS accounts_telegram ON accounts (telegram_id)');
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

// Код восстановления предназначен для ручного сохранения вне телефона. В нём нет
// похожих символов 0/O и 1/I, а пробелы и дефисы при вводе не имеют значения.
const RECOVERY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const RECOVERY_LENGTH = 16;

export function normalizeRecoveryCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== RECOVERY_LENGTH) return null;
  for (const char of code) if (!RECOVERY_ALPHABET.includes(char)) return null;
  return code;
}

function makeRecoveryCode(): string {
  const bytes = randomBytes(RECOVERY_LENGTH);
  const code = [...bytes].map((byte) => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length]).join('');
  return code.match(/.{1,4}/g)!.join('-');
}

function hashRecoveryCode(code: string): Buffer {
  return createHash('sha256').update(`garba-recovery:${code}`).digest();
}

const ACCOUNT_FIELDS = 'id, name, balance, created_at, code, daily_day, daily_streak, invited_by, skill';
const ACCOUNT_FIELDS_A = ACCOUNT_FIELDS.split(', ').map((f) => `a.${f}`).join(', ');

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
// Управляющие и невидимые символы (нулевой ширины, смена направления текста) убираем —
// ими можно подделать чужое имя (28.09.2026). Соединитель U+200D оставляем: из него
// собраны составные эмодзи. «Удалённый игрок» занято — так подписаны удалённые аккаунты.
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw
    .replace(/(?![\u200d\s])[\p{Cc}\p{Cf}]/gu, '')
    .trim()
    .replace(/\s+/g, ' ');
  if (name.length === 0 || name.length > NAME_MAX_LENGTH) return null;
  if (name.toLowerCase() === DELETED_NAME.toLowerCase()) return null;
  return name;
}

// Новый аккаунт со стартовыми 10 000 монет (ТЗ §2). Токен возвращается один раз —
// сервер его больше нигде не хранит, только хеш. invitedBy — id пригласившего.
export function createAccount(
  db: DatabaseSync,
  name: string,
  invitedBy: string | null = null,
): { account: Account; token: string; recoveryCode: string } {
  const id = randomUUID();
  const token = randomBytes(32).toString('hex');
  const recoveryCode = makeRecoveryCode();
  const createdAt = Date.now();
  const code = freeCode(db);

  db.prepare(
    `INSERT INTO accounts
       (id, token_hash, name, balance, created_at, code, daily_streak, invited_by, skill, recovery_hash)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  ).run(
    id,
    hashToken(token),
    name,
    STARTING_COINS,
    createdAt,
    code,
    invitedBy,
    START_SKILL,
    hashRecoveryCode(normalizeRecoveryCode(recoveryCode)!).toString('hex'),
  );

  return {
    account: {
      id, name, balance: STARTING_COINS, createdAt, code,
      dailyDay: null, dailyStreak: 0, invitedBy, skill: START_SKILL,
    },
    token,
    recoveryCode,
  };
}

// Боты сервера — обычные аккаунты с пометкой: играют через те же проверки, что и люди.
export function markBot(db: DatabaseSync, id: string) {
  db.prepare('UPDATE accounts SET is_bot = 1 WHERE id = ?').run(id);
}

export function botAccounts(db: DatabaseSync): Account[] {
  return (db.prepare(`SELECT ${ACCOUNT_FIELDS} FROM accounts WHERE is_bot = 1`).all() as Record<string, unknown>[])
    .map((row) => toAccount(row)!);
}

export function hasRecoveryCode(db: DatabaseSync, id: string): boolean {
  const row = db.prepare('SELECT recovery_hash FROM accounts WHERE id = ?').get(id) as
    | { recovery_hash: string | null }
    | undefined;
  return Boolean(row?.recovery_hash);
}

// Уже вошедший игрок может выпустить новый код. Предыдущий сразу перестаёт работать.
export function replaceRecoveryCode(db: DatabaseSync, id: string): string | null {
  if (!getAccount(db, id)) return null;
  const recoveryCode = makeRecoveryCode();
  const normalized = normalizeRecoveryCode(recoveryCode)!;
  db.prepare('UPDATE accounts SET recovery_hash = ? WHERE id = ?')
    .run(hashRecoveryCode(normalized).toString('hex'), id);
  return recoveryCode;
}

// Успешное восстановление меняет и токен входа, и сам код восстановления. Поэтому
// старый телефон и однажды использованный код больше не дают доступ к аккаунту.
export function recoverAccount(
  db: DatabaseSync,
  playerCode: string,
  rawRecoveryCode: unknown,
): { account: Account; token: string; recoveryCode: string } | null {
  const account = checkRecoveryCode(db, playerCode, rawRecoveryCode);
  if (!account) return null;

  const token = randomBytes(32).toString('hex');
  const recoveryCode = makeRecoveryCode();
  transaction(db, () => {
    db.prepare('UPDATE accounts SET token_hash = ?, recovery_hash = ? WHERE id = ?').run(
      hashToken(token),
      hashRecoveryCode(normalizeRecoveryCode(recoveryCode)!).toString('hex'),
      account.id,
    );
    // Восстановление выкидывает и все входы через Telegram — на случай, если телефон украли
    // вместе с Telegram: иначе вор снова вошёл бы через него. Привязать заново — кодом.
    db.prepare('DELETE FROM account_tokens WHERE account_id = ?').run(account.id);
    db.prepare('UPDATE accounts SET telegram_id = NULL WHERE id = ?').run(account.id);
  });
  return { account, token, recoveryCode };
}

export function findAccountByToken(db: DatabaseSync, token: string): Account | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT ${ACCOUNT_FIELDS} FROM accounts WHERE token_hash = ?1
         OR id = (SELECT account_id FROM account_tokens WHERE token_hash = ?1)`,
    )
    .get(hashToken(token)) as Record<string, unknown> | undefined;
  return toAccount(row);
}

// Telegram (07.10.2026). Сколько устройств с Telegram держат вход одновременно —
// при входе с шестого самый старый токен перестаёт работать.
export const TELEGRAM_TOKENS_KEPT = 5;

export function findAccountByTelegram(db: DatabaseSync, telegramId: number): Account | null {
  const row = db
    .prepare(`SELECT ${ACCOUNT_FIELDS} FROM accounts WHERE telegram_id = ? AND is_bot = 0`)
    .get(telegramId) as Record<string, unknown> | undefined;
  return toAccount(row);
}

export function telegramIdOf(db: DatabaseSync, accountId: string): number | null {
  const row = db.prepare('SELECT telegram_id FROM accounts WHERE id = ?').get(accountId) as
    | { telegram_id: number | null }
    | undefined;
  return row?.telegram_id ?? null;
}

// Привязать Telegram к аккаунту. Был привязан к другому — переезжает сюда.
export function linkTelegram(db: DatabaseSync, accountId: string, telegramId: number) {
  transaction(db, () => {
    db.prepare('UPDATE accounts SET telegram_id = NULL WHERE telegram_id = ? AND id <> ?').run(telegramId, accountId);
    db.prepare('UPDATE accounts SET telegram_id = ? WHERE id = ?').run(telegramId, accountId);
  });
}

// Новый дополнительный токен входа; лишние старые удаляются.
export function issueExtraToken(db: DatabaseSync, accountId: string, keep = TELEGRAM_TOKENS_KEPT): string {
  const token = randomBytes(32).toString('hex');
  transaction(db, () => {
    db.prepare('INSERT INTO account_tokens (token_hash, account_id, created_at) VALUES (?, ?, ?)')
      .run(hashToken(token), accountId, Date.now());
    db.prepare(
      `DELETE FROM account_tokens WHERE account_id = ?1 AND token_hash NOT IN
         (SELECT token_hash FROM account_tokens WHERE account_id = ?1
          ORDER BY created_at DESC, rowid DESC LIMIT ?2)`,
    ).run(accountId, keep);
  });
  return token;
}

// Проверить код восстановления, ничего не меняя. Для привязки Telegram к аккаунту
// из приложения: телефон при этом остаётся в аккаунте, а код меняется (одноразовый).
export function checkRecoveryCode(db: DatabaseSync, playerCode: string, rawRecoveryCode: unknown): Account | null {
  const normalized = normalizeRecoveryCode(rawRecoveryCode);
  if (!normalized) return null;
  const account = findAccountByCode(db, playerCode);
  if (!account) return null;
  const row = db.prepare('SELECT recovery_hash FROM accounts WHERE id = ?').get(account.id) as
    | { recovery_hash: string | null }
    | undefined;
  if (!row?.recovery_hash) return null;
  const actual = hashRecoveryCode(normalized);
  const expected = Buffer.from(row.recovery_hash, 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return account;
}

// Ботов сервера по коду не найти: им не подарить монеты, не позвать в друзья и в комнату.
export function findAccountByCode(db: DatabaseSync, code: string): Account | null {
  if (!code) return null;
  const row = db
    .prepare(`SELECT ${ACCOUNT_FIELDS} FROM accounts WHERE code = ? AND is_bot = 0`)
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

// Самый большой баланс, до которого дошёл игрок (медали, 23.10.2026). Новый аккаунт
// ещё не записывал баланс — тогда это сам баланс.
export function peakBalanceOf(db: DatabaseSync, id: string): number {
  const row = db.prepare('SELECT MAX(peak_balance, balance) AS peak FROM accounts WHERE id = ?').get(id) as
    | { peak: number }
    | undefined;
  return Number(row?.peak ?? 0);
}

// Самые богатые (лидерборд по монетам, 23.10.2026): весь баланс — кошелёк и за столом.
export function coinLeaders(db: DatabaseSync): { id: string; name: string; code: string; coins: number }[] {
  const rows = db
    .prepare('SELECT id, name, code, balance FROM accounts WHERE is_bot = 0 ORDER BY balance DESC, name')
    .all() as { id: string; name: string; code: string; balance: number }[];
  return rows.map((r) => ({ id: r.id, name: r.name, code: r.code, coins: Number(r.balance) }));
}

// Бан за выход из начатой игры (23.10.2026, leaveBan.ts). Не выходил — null.
export function leaveRecordOf(db: DatabaseSync, id: string): { count: number; lastAt: number; until: number } | null {
  const row = db.prepare('SELECT leave_count, leave_last_at, ban_until FROM accounts WHERE id = ?').get(id) as
    | { leave_count: number; leave_last_at: number; ban_until: number }
    | undefined;
  if (!row || !row.leave_count) return null;
  return { count: Number(row.leave_count), lastAt: Number(row.leave_last_at), until: Number(row.ban_until) };
}

export function setLeaveRecord(db: DatabaseSync, id: string, rec: { count: number; lastAt: number; until: number }) {
  db.prepare('UPDATE accounts SET leave_count = ?, leave_last_at = ?, ban_until = ? WHERE id = ?').run(
    rec.count,
    rec.lastAt,
    rec.until,
    id,
  );
}

// Турнирный бан (§19.6, 31.10.2026): до какого времени нельзя за стол. 0 — бана нет.
export function tournamentBanUntil(db: DatabaseSync, id: string): number {
  const row = db.prepare('SELECT tournament_ban_until AS t FROM accounts WHERE id = ?').get(id) as { t: number } | undefined;
  return Number(row?.t ?? 0);
}

export function setTournamentBan(db: DatabaseSync, id: string, until: number) {
  db.prepare('UPDATE accounts SET tournament_ban_until = MAX(tournament_ban_until, ?) WHERE id = ?').run(until, id);
}

// Сменить имя — только владелец сервера по жалобе (POST /admin/rename, 29.09.2026).
export function setName(db: DatabaseSync, id: string, name: string) {
  db.prepare('UPDATE accounts SET name = ? WHERE id = ?').run(name, id);
}

export function setSkill(db: DatabaseSync, id: string, skill: number) {
  db.prepare('UPDATE accounts SET skill = ? WHERE id = ?').run(skill, id);
}

export function setDaily(db: DatabaseSync, id: string, day: string, streak: number) {
  db.prepare('UPDATE accounts SET daily_day = ?, daily_streak = ? WHERE id = ?').run(day, streak, id);
}

// Сколько игрок подарил за этот день, всем вместе (лимит 10 000 в сутки, 08.10.2026).
export function giftedOn(db: DatabaseSync, fromId: string, day: string): number {
  const row = db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM gifts WHERE from_id = ? AND day = ?')
    .get(fromId, day) as { total: number | bigint };
  return Number(row.total);
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

// --- Друзья (этап 9.4; заявки — с 19.09.2026) ---
// Дружба взаимная: у обоих в списке, удалил — у обоих пропала. Но появляется она только
// с согласия второго: сначала заявка, он принимает или отклоняет (решение владельца).

export type FriendStatus = 'friends' | 'outgoing' | 'incoming' | 'none';

export function friendStatus(db: DatabaseSync, me: string, other: string): FriendStatus {
  if (areFriends(db, me, other)) return 'friends';
  const req = db.prepare('SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?');
  if (req.get(me, other) !== undefined) return 'outgoing';
  if (req.get(other, me) !== undefined) return 'incoming';
  return 'none';
}

// Отправить заявку. Он уже звал меня — сразу друзья (оба хотят).
export function requestFriend(
  db: DatabaseSync,
  me: string,
  other: string,
): 'requested' | 'friends' | 'already friends' | 'already sent' {
  const status = friendStatus(db, me, other);
  if (status === 'friends') return 'already friends';
  if (status === 'outgoing') return 'already sent';
  if (status === 'incoming') {
    acceptFriend(db, me, other);
    return 'friends';
  }
  db.prepare('INSERT INTO friend_requests (from_id, to_id, created_at) VALUES (?, ?, ?)').run(me, other, Date.now());
  return 'requested';
}

// Принять заявку от from — становимся друзьями, заявки в обе стороны снимаются.
export function acceptFriend(db: DatabaseSync, me: string, from: string): boolean {
  if (friendStatus(db, me, from) !== 'incoming') return false;
  transaction(db, () => {
    dropRequests(db, me, from);
    const now = Date.now();
    const insert = db.prepare('INSERT OR IGNORE INTO friends (owner_id, friend_id, created_at) VALUES (?, ?, ?)');
    insert.run(me, from, now);
    insert.run(from, me, now);
  });
  return true;
}

// Отклонить входящую или отменить свою — заявка просто исчезает, никому не сообщаем.
export function dropRequests(db: DatabaseSync, a: string, b: string) {
  db.prepare('DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)').run(a, b, b, a);
}

// Кто зовёт меня в друзья / кого зову я — новые сверху.
export function friendRequests(db: DatabaseSync, me: string): { incoming: Account[]; outgoing: Account[] } {
  const list = (sql: string) =>
    (db.prepare(sql).all(me) as Record<string, unknown>[]).map((row) => toAccount(row)!);
  return {
    incoming: list(`SELECT ${ACCOUNT_FIELDS_A} FROM friend_requests r JOIN accounts a ON a.id = r.from_id WHERE r.to_id = ? ORDER BY r.created_at DESC`),
    outgoing: list(`SELECT ${ACCOUNT_FIELDS_A} FROM friend_requests r JOIN accounts a ON a.id = r.to_id WHERE r.from_id = ? ORDER BY r.created_at DESC`),
  };
}

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

// Удалить аккаунт навсегда (требование Apple и Google): аккаунт, фото, друзья,
// статистика. В сохранённых комнатах его имя заменяется на «Удалённый игрок» —
// история у остальных игроков остаётся, но без его данных. Вызывать в transaction().
export const DELETED_NAME = 'Удалённый игрок';

export function deleteAccountData(db: DatabaseSync, id: string) {
  db.prepare('DELETE FROM friends WHERE owner_id = ? OR friend_id = ?').run(id, id);
  db.prepare('DELETE FROM friend_requests WHERE from_id = ? OR to_id = ?').run(id, id);
  db.prepare('DELETE FROM avatars WHERE account_id = ?').run(id);
  db.prepare('DELETE FROM account_tokens WHERE account_id = ?').run(id);
  deleteModerationData(db, id);
  deleteShopData(db, id);
  db.prepare('DELETE FROM room_stats WHERE player_id = ?').run(id);
  db.prepare('DELETE FROM week_coins WHERE player_id = ?').run(id);
  db.prepare('DELETE FROM room_activity WHERE player_id = ?').run(id);
  deleteShahData(db, id, DELETED_NAME); // игра ШАХ: рейтинг, итоги матчей, имя в комнатах ШАХ
  anonymizeEntries(db, id, DELETED_NAME);
  db.prepare('UPDATE accounts SET invited_by = NULL WHERE invited_by = ?').run(id);

  const rows = db
    .prepare('SELECT id, data FROM rooms WHERE data LIKE ?')
    .all(`%${id}%`) as { id: string; data: string }[];
  const update = db.prepare('UPDATE rooms SET data = ? WHERE id = ?');
  for (const row of rows) update.run(JSON.stringify(anonymize(JSON.parse(row.data), id)), row.id);

  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
}

// Имя игрока — везде, где рядом его id: players[].name, playerName, dealerName, winnerName.
export function anonymize(value: unknown, id: string): unknown {
  if (Array.isArray(value)) return value.map((v) => anonymize(v, id));
  if (value === null || typeof value !== 'object') return value;
  const obj = { ...(value as Record<string, unknown>) };
  for (const [key, v] of Object.entries(obj)) obj[key] = anonymize(v, id);
  if (obj.id === id && typeof obj.name === 'string') obj.name = DELETED_NAME;
  if (obj.playerId === id && typeof obj.playerName === 'string') obj.playerName = DELETED_NAME;
  if (obj.dealerId === id && typeof obj.dealerName === 'string') obj.dealerName = DELETED_NAME;
  if (obj.winnerId === id && typeof obj.winnerName === 'string') obj.winnerName = DELETED_NAME;
  return obj;
}
