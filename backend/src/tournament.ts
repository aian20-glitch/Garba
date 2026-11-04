// Еженедельный турнир (RULES.md §19, решение владельца 28.10 и 31.10.2026).
// Чистые функции: расписание, столы отбора, выбывание, конец стола, общий список, финалисты,
// победитель, рейтинг за турнир. Деньги и база — tournamentDb.ts, таймеры и комнаты — index.ts.

// --- Числа владельца (§19). Менять только вместе с RULES.md. ---
export const ENTRY_FEE = 10_000; // участие и турнирный баланс на первом столе
export const MIN_PARTICIPANTS = 8;
export const TABLE_MIN = 4;
export const TABLE_MAX = 7;
export const FINAL_MIN = 4;
export const FINAL_MAX = 7;
export const QUALIFY_ABOVE = 10_000; // в финал — баланс строго больше
export const TABLE_BONUS = 50_000; // в казну за каждый предусмотренный стол и за финал

// Настройки турнирного стола — у всех столов и у финала одинаковые (§19.4).
export const TOURNAMENT_SETTINGS = {
  ante: 100,
  emptyLimit: 7,
  konThreshold: 5,
  minBalance: 0, // сумма за стол не выбирается — турнирный баланс
  turnSeconds: 30,
  absenceMinutes: 3,
};

export const HOUR_MS = 3_600_000;
export const REGISTRATION_MS = 24 * HOUR_MS;
export const QUALIFICATION_MS = 72 * HOUR_MS;
export const FINAL_MS = 48 * HOUR_MS;
export const TABLE_PLAY_MS = 40 * 60_000; // стол играет не больше 40 минут (02.11.2026; 31.10 — 20 минут, до того 1 час)
export const LAST_CALL_LEAD_MS = 50 * 60_000; // за 50 мин до конца этапа — последний шанс (10 мин посадки + 40 мин стола)
export const LAST_CALL_MS = 10 * 60_000; // последние 10 минут на посадку
export const PENALTY_RATING = -1.5;
export const PENALTY_BAN_MS = 24 * HOUR_MS;

// Рейтинг за турнир — только одна категория (§19.10).
export const PLACE_RATING = { first: 1.0, second: 0.5, third: 0.3, finalist: 0.2, participant: 0.1 };

// Сроки — числа выше; для проверок их укорачивают (index.ts читает переменные окружения).
export type TournamentTimes = {
  registrationMs: number;
  qualificationMs: number;
  finalMs: number;
  tablePlayMs: number;
  lastCallLeadMs: number;
  lastCallMs: number;
};

export const DEFAULT_TIMES: TournamentTimes = {
  registrationMs: REGISTRATION_MS,
  qualificationMs: QUALIFICATION_MS,
  finalMs: FINAL_MS,
  tablePlayMs: TABLE_PLAY_MS,
  lastCallLeadMs: LAST_CALL_LEAD_MS,
  lastCallMs: LAST_CALL_MS,
};

// --- Расписание (§19.1) ---

const KZ_OFFSET_MS = 5 * HOUR_MS; // Казахстан, UTC+5
const DAY_MS = 24 * HOUR_MS;
const START_HOUR = 20; // понедельник 20:00

// Начало турнира этой недели: последний понедельник 20:00 по Казахстану, не позже now.
export function weeklyStartAt(now: number): number {
  const local = now + KZ_OFFSET_MS;
  const dayStart = Math.floor(local / DAY_MS) * DAY_MS;
  const sinceMonday = (new Date(dayStart).getUTCDay() + 6) % 7; // понедельник — 0
  let start = dayStart - sinceMonday * DAY_MS + START_HOUR * HOUR_MS;
  if (start > local) start -= 7 * DAY_MS;
  return start - KZ_OFFSET_MS;
}

// Следующий понедельник 20:00 (для экрана «следующий турнир»).
export function nextWeeklyStartAt(now: number): number {
  return weeklyStartAt(now) + 7 * DAY_MS;
}

// Имя турнира недели — дата его понедельника по Казахстану: «2026-11-02».
export function tournamentIdFor(startAt: number): string {
  return new Date(startAt + KZ_OFFSET_MS).toISOString().slice(0, 10);
}

// Открывать ли турнир этой недели сейчас: понедельник 20:00 уже был, регистрация ещё идёт.
// Сервер лежал в 20:00 — откроется, как только поднимется (сроки — всё равно от 20:00).
export function weeklyRegistrationOpen(now: number, times: TournamentTimes = DEFAULT_TIMES): boolean {
  return now < weeklyStartAt(now) + times.registrationMs;
}

// --- Столы отбора (§19.3) ---

// Столов как можно больше, игроки — как можно ровнее: n ÷ 4 столов, остаток — по одному.
// Меньше 8 участников — турнир не проводится (столов нет).
export function tableSizes(participants: number): number[] {
  if (participants < MIN_PARTICIPANTS) return [];
  const tables = Math.floor(participants / TABLE_MIN);
  const base = Math.floor(participants / tables);
  const extra = participants - base * tables;
  return Array.from({ length: tables }, (_, i) => base + (i >= tables - extra ? 1 : 0));
}

// --- Игра за столом (§19.4) ---

// Кто выбывает: не может оплатить следующий взнос.
export function eliminatedIds(players: { id: string; balance: number }[], ante: number): string[] {
  return players.filter((p) => p.balance < ante).map((p) => p.id);
}

export type TableEnd = 'three_left' | 'time_up' | 'no_humans' | null;

// Почему стол заканчивается (между раздачами): осталось трое (втроём не играют), вышло время стола,
// за столом одни боты (последний шанс, §19.5). null — играем дальше.
export function tableEndReason(
  players: number,
  humans: number,
  startedAt: number,
  now: number,
  playMs: number = TABLE_PLAY_MS,
): TableEnd {
  if (humans === 0) return 'no_humans';
  if (players < TABLE_MIN) return 'three_left';
  if (now - startedAt >= playMs) return 'time_up';
  return null;
}

// --- Последний шанс (§19.5) ---

// Где сейчас несобравшийся стол относительно конца этапа:
// wait — обычный сбор; last_call — открыт последние 10 минут; launch — пора стартовать с ботами.
export function lastCallPhase(now: number, stageEndsAt: number, times: TournamentTimes = DEFAULT_TIMES): 'wait' | 'last_call' | 'launch' {
  const callAt = stageEndsAt - times.lastCallLeadMs;
  if (now < callAt) return 'wait';
  if (now < callAt + times.lastCallMs) return 'last_call';
  return 'launch';
}

// --- Общий список и финалисты (§19.7) ---

export type Standing = {
  id: string;
  balance: number;
  razWins: number; // побед после «РАЗ» (спецкарта — как РАЗ)
  dvaWins: number; // побед после «ДВА»
  maxRisk: number; // самый большой риск, на котором выигрывал, 0 — не выигрывал
  registeredAt: number; // последний tie-break: кто раньше зарегистрировался
};

// Порядок списка: монеты, потом победы на РАЗ, на ДВА, риск, раньше зарегистрировался.
export function compareStandings(a: Standing, b: Standing): number {
  return (
    b.balance - a.balance ||
    b.razWins - a.razWins ||
    b.dvaWins - a.dvaWins ||
    b.maxRisk - a.maxRisk ||
    a.registeredAt - b.registeredAt ||
    a.id.localeCompare(b.id)
  );
}

export function rankStandings<T extends Standing>(list: T[]): T[] {
  return [...list].sort(compareStandings);
}

// Участник в общем списке экрана «ТУРНИР» (§19.11): счёт отбора и отдельно — счёт финала.
export type ListedEntry = Standing & {
  status: string;
  finalPlace: number | null;
  finalRazWins: number;
  finalDvaWins: number;
  finalMaxRisk: number;
};

function listGroup(status: string): number {
  if (status === 'finalist' || status === 'final_playing' || status === 'final_done') return 0;
  if (status === 'played' || status === 'out' || status === 'playing') return 1;
  return status === 'registered' ? 2 : 3;
}

// Порядок общего списка (§19.11): сверху финалисты, дальше сыгравшие — по общему списку, ещё не
// сыгравшие — по времени регистрации. Финалист, который финал ещё не играл, — по отбору: так его и
// выбрали (selectFinalists). Сыгравший финал — по счёту финала. Места розданы — по местам: по ним
// же приз и рейтинг (финал не сыгран — места по отбору, §19.13). Раньше финалиста всегда ставили по
// счёту финала, и при равном балансе порядок в списке расходился с местами (исправлено 05.11.2026).
export function compareListed(a: ListedEntry, b: ListedEntry): number {
  const group = listGroup(a.status) - listGroup(b.status);
  if (group !== 0) return group;
  if (listGroup(a.status) >= 2) return a.registeredAt - b.registeredAt;
  if (a.finalPlace !== null && b.finalPlace !== null) return a.finalPlace - b.finalPlace;
  return compareStandings(listStanding(a), listStanding(b));
}

function listStanding(e: ListedEntry): Standing {
  const playedFinal = e.status === 'final_playing' || e.status === 'final_done';
  return playedFinal ? { ...e, razWins: e.finalRazWins, dvaWins: e.finalDvaWins, maxRisk: e.finalMaxRisk } : e;
}

// Финалисты: больше 10 000 — до 7 лучших; таких меньше 4 — добор следующих по списку, кто
// может платить взнос; людей всё равно меньше 4 — недостающие места займут боты.
export function selectFinalists<T extends Standing>(
  standings: T[],
  ante: number = TOURNAMENT_SETTINGS.ante,
): { finalists: T[]; out: T[]; bots: number } {
  const ranked = rankStandings(standings);
  const finalists = ranked.filter((s) => s.balance > QUALIFY_ABOVE).slice(0, FINAL_MAX);
  for (const s of ranked) {
    if (finalists.length >= FINAL_MIN) break;
    if (!finalists.includes(s) && s.balance >= ante) finalists.push(s);
  }
  const picked = rankStandings(finalists);
  return {
    finalists: picked,
    out: ranked.filter((s) => !picked.includes(s)),
    bots: Math.max(0, FINAL_MIN - picked.length),
  };
}

// --- Победитель и выплаты (§19.9) ---

// Выплаты после финала: победителю — его баланс + казна, остальным — их баланс.
// standings — финалисты-люди, сыгравшие финал (наказанные сюда не входят).
export function payouts(
  standings: Standing[],
  treasury: number,
): { winnerId: string | null; payments: { id: string; amount: number }[] } {
  const ranked = rankStandings(standings);
  const winner = ranked[0] ?? null;
  return {
    winnerId: winner?.id ?? null,
    payments: ranked.map((s) => ({ id: s.id, amount: s.balance + (s === winner ? treasury : 0) })),
  };
}

// --- Рейтинг за турнир (§19.10) ---

// place — место в финале (1, 2, 3…) или null, если не финалист.
export function tournamentRating(place: number | null): number {
  if (place === 1) return PLACE_RATING.first;
  if (place === 2) return PLACE_RATING.second;
  if (place === 3) return PLACE_RATING.third;
  if (place !== null) return PLACE_RATING.finalist;
  return PLACE_RATING.participant;
}

// Мастерство в пределах шкалы §16 (0…8).
export function clampSkill(skill: number): number {
  return Math.round(Math.min(8, Math.max(0, skill)) * 1000) / 1000;
}

// --- Значок победителя (§19.12) ---

// «🏆», «🏆×2»… — ноль побед — пусто.
export function winsBadge(wins: number): string {
  if (wins <= 0) return '';
  return wins === 1 ? '🏆' : `🏆×${wins}`;
}

// Объявление перед обычной игрой: самый титулованный за столом. Нет победителей — null.
export function winnerBanner(wins: number[]): string | null {
  const best = Math.max(0, ...wins);
  if (best <= 0) return null;
  return best === 1
    ? 'В игре есть победитель турнира 🏆'
    : `В игре есть ${best}-кратный победитель турнира ${winsBadge(best)}`;
}
