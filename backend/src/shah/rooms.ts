// Комнаты ШАХ (SHAH_PLAN.md, этап 2, 04.11.2026) — чистые функции: настройки комнаты, монеты
// партии, ход за игрока по таймеру, ход бота-тренировки. Сам сервер — shah/server.ts.
//
// Слова (решение владельца 05.11.2026): ПАРТИЯ — игра до −24 (в коде match), РАЗДАЧА — сдали по 6
// карт и сыграли (в коде party), СТОЛ — несколько партий подряд тем же составом.
// Ответы владельца 05.11.2026 (SHAH_PLAN.md, вопросы 17–19): взнос — за каждую партию, банк —
// выигравшим; времени стола нет — создатель выбирает 1…30 партий, сыграли — вопрос «ещё 3?»;
// ушёл — его сторона проиграла партию.

import type { Card, Suit } from '../types.js';
import { ABSENCE_MINUTES_OPTIONS, NEW_ROOM_ABSENCE_MINUTES } from '../presence.js';
import { DEFAULT_TURN_SECONDS, TURN_SECONDS_OPTIONS } from '../turnTimer.js';
import { cardPoints, findBeat, isShah, pointsOf, rankPower } from './cards.js';
import { awaitedOf, isTeamFormat, sideOf, type ShahAction, type ShahFormat, type ShahMatch } from './engine.js';
import type { SideResult } from './score.js';

export const SHAH_CAPACITIES: readonly ShahFormat[] = [2, 3, 4, 6];

// Взнос за партию (вопрос 17, владелец 05.11.2026): команды (2×2, 3×3) — 10 000…20 000,
// 1×1 и 1×1×1 — 1 000…10 000. Шаг 1 000 — решено при реализации (как сумма за стол в Гарбе).
export const SHAH_ANTE_STEP = 1000;
export function anteRange(format: ShahFormat): { min: number; max: number } {
  return isTeamFormat(format) ? { min: 10_000, max: 20_000 } : { min: 1_000, max: 10_000 };
}

// Сколько партий за столом (вопрос 18, владелец 05.11.2026): выбирает создатель, 1…30. Сыграли все —
// вопрос «добавить ещё 3 партии?». Без поля — 3 (решено при реализации), «Быстрая игра» — 1.
export const SHAH_MATCHES_MIN = 1;
export const SHAH_MATCHES_MAX = 30;
export const DEFAULT_SHAH_MATCHES = 3;
export const QUICK_SHAH_MATCHES = 1;
export const SHAH_EXTRA_MATCHES = 3;

export type ShahSettings = {
  ante: number; // взнос за каждую партию (anteRange)
  absenceMinutes: number; // ожидание вышедшего, 1…5 минут за игру (как в Гарбе, §13)
  turnSeconds: number; // время на ход: 20 или 40 секунд (вопрос 23 «а» — как в Гарбе)
  matches: number; // сколько партий договорились сыграть, 1…30
};

export type SettingsCheck =
  | { ok: true; capacity: ShahFormat; settings: ShahSettings; isPublic: boolean }
  | { ok: false; error: string; min?: number; max?: number };

// Настройки при создании комнаты. Чего не прислали — как в Гарбе: ожидание 1 минута, ход 20 с,
// комната только по коду; партий — 3. Время игры (timeLimitMinutes) у ШАХ нет — не читаем.
export function checkShahSettings(body: Record<string, unknown> | undefined): SettingsCheck {
  const b = body ?? {};
  const capacity = Number(b.capacity);
  if (!SHAH_CAPACITIES.includes(capacity as ShahFormat)) return { ok: false, error: 'bad capacity' };
  const range = anteRange(capacity as ShahFormat);
  const ante = Number(b.ante);
  if (!Number.isInteger(ante) || ante < range.min || ante > range.max || ante % SHAH_ANTE_STEP !== 0) {
    return { ok: false, error: 'bad ante', ...range };
  }
  const absenceMinutes = b.absenceMinutes === undefined ? NEW_ROOM_ABSENCE_MINUTES : Number(b.absenceMinutes);
  if (!ABSENCE_MINUTES_OPTIONS.includes(absenceMinutes)) return { ok: false, error: 'bad absenceMinutes' };
  const turnSeconds = b.turnSeconds === undefined ? DEFAULT_TURN_SECONDS : Number(b.turnSeconds);
  if (!TURN_SECONDS_OPTIONS.includes(turnSeconds)) return { ok: false, error: 'bad turnSeconds' };
  const matches = b.matches === undefined || b.matches === null ? DEFAULT_SHAH_MATCHES : Number(b.matches);
  if (!Number.isInteger(matches) || matches < SHAH_MATCHES_MIN || matches > SHAH_MATCHES_MAX) {
    return { ok: false, error: 'bad matches', min: SHAH_MATCHES_MIN, max: SHAH_MATCHES_MAX };
  }
  return {
    ok: true,
    capacity: capacity as ShahFormat,
    settings: { ante, absenceMinutes, turnSeconds, matches },
    isPublic: b.isPublic === true,
  };
}

// ——— Монеты партии (вопрос 17 «а», подтверждён владельцем 05.11.2026) ———
// 'pot' — ставка на партию: в начале каждой партии каждый кладёт взнос, выигравшие забирают всё
// (команда — поровну, при 1×1×1 двое выигравших — пополам); 'loserPays' («б», не выбран) — в начале
// ничего, в конце каждый проигравший платит взнос каждому победителю.
export type MoneyMode = 'pot' | 'loserPays';
export const DEFAULT_MONEY_MODE: MoneyMode = 'pot';

// Сколько игрок может проиграть за партию — столько нужно иметь, чтобы сесть за стол.
export function maxLoss(format: ShahFormat, ante: number, mode: MoneyMode): number {
  if (mode === 'pot') return ante;
  const winnersAtMost = isTeamFormat(format) ? format / 2 : format - 1;
  return ante * winnersAtMost;
}

// Итог партии для каждого места: win | lose | none (при 3 по варианту «б» вопроса 16 — ни то
// ни другое) | draw (ничья — ушли все стороны сразу).
export type SeatOutcome = 'win' | 'lose' | 'none' | 'draw';

export function seatOutcomes(format: ShahFormat, sides: SideResult[] | null): SeatOutcome[] {
  return Array.from({ length: format }, (_, seat) => (sides ? sides[sideOf(format, seat)] : 'draw'));
}

// Что выплатить в конце (только 'pot'): сколько кому вернуть из банка. Победители делят банк
// поровну; «ни то ни другое» — забирает свой взнос; ничья или победителей нет — всем взнос назад.
// Банк делится без остатка: взнос кратен 100, а победителей 1–3. Остаток всё же был бы — первому.
export function potPayouts(format: ShahFormat, ante: number, outcomes: SeatOutcome[]): number[] {
  const pot = ante * format;
  const winners = outcomes.filter((o) => o === 'win').length;
  if (winners === 0) return outcomes.map(() => ante);
  const none = outcomes.filter((o) => o === 'none').length;
  const share = Math.floor((pot - none * ante) / winners);
  const rest = pot - none * ante - share * winners;
  let first = true;
  return outcomes.map((o) => {
    if (o === 'none') return ante;
    if (o !== 'win') return 0;
    const extra = first ? rest : 0;
    first = false;
    return share + extra;
  });
}

// Итог партии в монетах для каждого места (+ выиграл, − проиграл): то, что показывает экран итогов.
export function matchDeltas(format: ShahFormat, ante: number, mode: MoneyMode, outcomes: SeatOutcome[]): number[] {
  if (mode === 'pot') return potPayouts(format, ante, outcomes).map((paid) => paid - ante);
  const winners = outcomes.filter((o) => o === 'win').length;
  const losers = outcomes.filter((o) => o === 'lose').length;
  if (winners === 0 || losers === 0) return outcomes.map(() => 0);
  return outcomes.map((o) => (o === 'win' ? ante * losers : o === 'lose' ? -ante * winners : 0));
}

// Кто-то ушёл (вопрос 19, владелец 05.11.2026): его сторона проиграла партию, даже если по штрафам
// выигрывала; банк — другой стороне, при 1×1×1 — двум оставшимся пополам.
export function resultByLeaver(format: ShahFormat, leaverSeats: number[]): SideResult[] {
  const sides = isTeamFormat(format) ? 2 : format;
  const lost = new Set(leaverSeats.map((s) => sideOf(format, s)));
  if (lost.size === sides) return Array.from({ length: sides }, () => 'lose');
  return Array.from({ length: sides }, (_, side) => (lost.has(side) ? 'lose' : 'win'));
}

// Ушли между партиями (владелец 05.11.2026: «бан + проигрыш, если команда — они проигрывают»):
// следующая партия засчитана проигранной стороне ушедшего. Взносов ещё не брали — каждый проигравший
// платит взнос (сколько есть, в минус счёт не уходит), выигравшие делят собранное поровну (остаток —
// первому). При полном взносе выходит то же, что matchDeltas 'pot'.
export function forfeitSplit(outcomes: SeatOutcome[], taken: number[]): number[] {
  const winners = outcomes.map((o, i) => (o === 'win' ? i : -1)).filter((i) => i >= 0);
  const deltas = outcomes.map((o, i) => (o === 'lose' ? -taken[i] : 0));
  if (winners.length === 0) return outcomes.map(() => 0);
  const pool = taken.reduce((sum, t, i) => sum + (outcomes[i] === 'lose' ? t : 0), 0);
  const share = Math.floor(pool / winners.length);
  winners.forEach((w, k) => (deltas[w] = share + (k === 0 ? pool - share * winners.length : 0)));
  return deltas;
}

// ——— Ещё 3 партии (вопрос 18, владелец 05.11.2026) ———
// Договорённые партии сыграны — всех за столом спрашивают: «добавить 3 партии?». Как продление
// времени в Гарбе (§20): все «да» — играем ещё 3; одно «нет» или 30 секунд без ответа — стол
// закрывается (решено при реализации). Боты не голосуют.
export const MORE_VOTE_MS = 30_000;
export type MoreVote = { startedAt: number; yesIds: string[]; noIds: string[] };
export type MoreVoteOutcome = 'wait' | 'approved' | 'rejected' | 'expired';

export function moreVoteOutcome(vote: MoreVote, voterIds: string[], now: number, ms = MORE_VOTE_MS): MoreVoteOutcome {
  if (voterIds.some((id) => vote.noIds.includes(id))) return 'rejected';
  if (voterIds.every((id) => vote.yesIds.includes(id))) return 'approved';
  return now - vote.startedAt >= ms ? 'expired' : 'wait';
}

export function castMoreVote(
  vote: MoreVote,
  voterIds: string[],
  playerId: string,
  choice: unknown,
): { ok: true; vote: MoreVote } | { ok: false; error: string } {
  if (choice !== 'yes' && choice !== 'no') return { ok: false, error: 'bad choice' };
  if (!voterIds.includes(playerId)) return { ok: false, error: 'you do not vote on this' };
  if (vote.yesIds.includes(playerId) || vote.noIds.includes(playerId)) return { ok: false, error: 'already voted' };
  return {
    ok: true,
    vote: choice === 'yes' ? { ...vote, yesIds: [...vote.yesIds, playerId] } : { ...vote, noIds: [...vote.noIds, playerId] },
  };
}

// ——— Итог стола: все партии вместе ———
export type MatchRecordLike = { outcomes: Record<string, SeatOutcome>; deltas: Record<string, number> };

// Монеты за стол, выигранные и проигранные партии — у каждого игрока.
export function tableTotals(ids: string[], series: MatchRecordLike[]) {
  const coins: Record<string, number> = {};
  const wins: Record<string, number> = {};
  const losses: Record<string, number> = {};
  for (const id of ids) {
    coins[id] = 0;
    wins[id] = 0;
    losses[id] = 0;
  }
  for (const m of series) {
    for (const id of ids) {
      coins[id] += m.deltas[id] ?? 0;
      if (m.outcomes[id] === 'win') wins[id]++;
      if (m.outcomes[id] === 'lose') losses[id]++;
    }
  }
  return { coins, wins, losses };
}

// ——— Ход за игрока (вопрос 24 «а») ———
// Не успел — сервер: заходит самой слабой картой (без очков, не козырь, младшая), а бить не
// бьёт — кладёт рубашкой самые дешёвые карты. ШАХ отдаётся в последнюю очередь.

function giveAwayCost(card: Card, trump: Suit): number {
  if (isShah(card)) return 10_000;
  return cardPoints(card) * 100 + (card.suit === trump ? 50 : 0) + rankPower(card.rank);
}

export function cheapest(hand: Card[], count: number, trump: Suit): Card[] {
  return [...hand].sort((a, b) => giveAwayCost(a, trump) - giveAwayCost(b, trump)).slice(0, count);
}

export function timeoutAction(match: ShahMatch): { playerId: string; action: ShahAction } | null {
  const aw = awaitedOf(match);
  const p = match.party;
  if (!aw || !p) return null;
  const hand = p.hands[aw.seat];
  const cards = cheapest(hand, aw.awaiting === 'lead' ? 1 : aw.min, p.trump);
  return {
    playerId: aw.playerId,
    action: { type: aw.awaiting === 'lead' ? 'lead' : 'closed', cardIds: cards.map((c) => c.id) },
  };
}

// ——— Бот-тренировка ———
// Простая честная стратегия без подглядывания (видит только то, что видел бы игрок):
// заходит самой слабой картой; напарника не перебивает; бьёт, если на столе есть очки или
// побить можно без козыря; ШАХ тратит, только когда на столе 20 очков и больше; иначе — рубашкой
// самые дешёвые. Без случайности.
export function botAction(match: ShahMatch, botId: string): ShahAction | null {
  const aw = awaitedOf(match);
  const p = match.party;
  if (!aw || !p || aw.playerId !== botId) return null;
  const hand = p.hands[aw.seat];
  if (aw.awaiting === 'lead') return { type: 'lead', cardIds: cheapest(hand, 1, p.trump).map((c) => c.id) };
  const close: ShahAction = { type: 'closed', cardIds: cheapest(hand, aw.min, p.trump).map((c) => c.id) };
  if (aw.awaiting === 'closed') return close;
  const t = p.trick!;
  if (isTeamFormat(match.format) && sideOf(match.format, t.topSeat) === sideOf(match.format, aw.seat)) return close;
  const cover = findBeat(hand, t.topCards, p.trump);
  if (!cover) return close;
  const onTable = pointsOf(t.moves.filter((m) => m.kind !== 'closed').flatMap((m) => m.cards));
  const usesShah = cover.some(isShah);
  const usesTrump = cover.some((c) => c.suit === p.trump);
  const worth = usesShah ? onTable >= 20 : usesTrump ? onTable >= 10 : true;
  return worth ? { type: 'beat', cardIds: cover.map((c) => c.id) } : close;
}
