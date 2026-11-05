// Комнаты ШАХ (SHAH_PLAN.md, этап 2, 04.11.2026) — чистые функции: настройки комнаты, монеты
// матча, ход за игрока по таймеру, ход бота-тренировки. Сам сервер — shah/server.ts.
//
// Где ответа владельца ещё нет (SHAH_PLAN.md, вопросы 17–24), сделан вариант «а», второй —
// переключателем, как в движке.

import type { Card, Suit } from '../types.js';
import { ABSENCE_MINUTES_OPTIONS, NEW_ROOM_ABSENCE_MINUTES } from '../presence.js';
import { checkTimeLimit } from '../tableTimer.js';
import { DEFAULT_TURN_SECONDS, TURN_SECONDS_OPTIONS } from '../turnTimer.js';
import { cardPoints, findBeat, isShah, pointsOf, rankPower } from './cards.js';
import { awaitedOf, isTeamFormat, sideOf, type ShahAction, type ShahFormat, type ShahMatch } from './engine.js';
import type { SideResult } from './score.js';

export const SHAH_CAPACITIES: readonly ShahFormat[] = [2, 3, 4, 6];
export const SHAH_ANTE_MIN = 100;
export const SHAH_ANTE_MAX = 1000;
export const SHAH_ANTE_STEP = 100;

export type ShahSettings = {
  ante: number; // взнос матча, 100…1000, кратно 100
  absenceMinutes: number; // ожидание вышедшего, 1…5 минут за игру (как в Гарбе, §13)
  turnSeconds: number; // время на ход: 20 или 40 секунд (вопрос 23 «а» — как в Гарбе)
  timeLimitMinutes: number | null; // время игры 15…180 или без ограничения (как в Гарбе, §20)
};

export type SettingsCheck =
  | { ok: true; capacity: ShahFormat; settings: ShahSettings; isPublic: boolean }
  | { ok: false; error: string; min?: number; max?: number };

// Настройки при создании комнаты. Чего не прислали — как в Гарбе: ожидание 1 минута, ход 20 с,
// время игры без ограничения, комната только по коду.
export function checkShahSettings(body: Record<string, unknown> | undefined): SettingsCheck {
  const b = body ?? {};
  const capacity = Number(b.capacity);
  if (!SHAH_CAPACITIES.includes(capacity as ShahFormat)) return { ok: false, error: 'bad capacity' };
  const ante = Number(b.ante);
  if (!Number.isInteger(ante) || ante < SHAH_ANTE_MIN || ante > SHAH_ANTE_MAX || ante % SHAH_ANTE_STEP !== 0) {
    return { ok: false, error: 'bad ante', min: SHAH_ANTE_MIN, max: SHAH_ANTE_MAX };
  }
  const absenceMinutes = b.absenceMinutes === undefined ? NEW_ROOM_ABSENCE_MINUTES : Number(b.absenceMinutes);
  if (!ABSENCE_MINUTES_OPTIONS.includes(absenceMinutes)) return { ok: false, error: 'bad absenceMinutes' };
  const turnSeconds = b.turnSeconds === undefined ? DEFAULT_TURN_SECONDS : Number(b.turnSeconds);
  if (!TURN_SECONDS_OPTIONS.includes(turnSeconds)) return { ok: false, error: 'bad turnSeconds' };
  const time = checkTimeLimit(b.timeLimitMinutes);
  if (!time.ok) return { ok: false, error: time.error };
  return {
    ok: true,
    capacity: capacity as ShahFormat,
    settings: { ante, absenceMinutes, turnSeconds, timeLimitMinutes: time.minutes },
    isPublic: b.isPublic === true,
  };
}

// ——— Монеты матча (вопрос 17) ———
// 'pot' («а») — ставка на матч: в начале каждый кладёт взнос, победители забирают всё
// (команда — поровну); 'loserPays' («б») — в начале ничего, в конце каждый проигравший платит
// взнос каждому победителю.
export type MoneyMode = 'pot' | 'loserPays';
export const DEFAULT_MONEY_MODE: MoneyMode = 'pot';

// Сколько игрок может проиграть за матч — столько нужно иметь, чтобы сесть за стол.
export function maxLoss(format: ShahFormat, ante: number, mode: MoneyMode): number {
  if (mode === 'pot') return ante;
  const winnersAtMost = isTeamFormat(format) ? format / 2 : format - 1;
  return ante * winnersAtMost;
}

// Итог матча для каждого места: win | lose | none (при 3 по варианту «б» вопроса 16 — ни то
// ни другое) | draw (ничья — время вышло при равном счёте, вопрос 18).
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

// Итог матча в монетах для каждого места (+ выиграл, − проиграл): то, что показывает экран итогов.
export function matchDeltas(format: ShahFormat, ante: number, mode: MoneyMode, outcomes: SeatOutcome[]): number[] {
  if (mode === 'pot') return potPayouts(format, ante, outcomes).map((paid) => paid - ante);
  const winners = outcomes.filter((o) => o === 'win').length;
  const losers = outcomes.filter((o) => o === 'lose').length;
  if (winners === 0 || losers === 0) return outcomes.map(() => 0);
  return outcomes.map((o) => (o === 'win' ? ante * losers : o === 'lose' ? -ante * winners : 0));
}

// Время стола вышло, матч не доигран (вопрос 18 «а»): выигрывает сторона с меньшими штрафами,
// поровну у всех — ничья (null — взносы назад). При 3: у кого меньше всех — выиграли, остальные — проиграли.
export function resultByTotals(totals: number[]): SideResult[] | null {
  const best = Math.max(...totals);
  if (totals.every((t) => t === best)) return null;
  return totals.map((t) => (t === best ? 'win' : 'lose'));
}

// Кто-то ушёл (вопрос 19 «а»): его сторона проиграла матч, остальные выиграли.
export function resultByLeaver(format: ShahFormat, leaverSeats: number[]): SideResult[] {
  const sides = isTeamFormat(format) ? 2 : format;
  const lost = new Set(leaverSeats.map((s) => sideOf(format, s)));
  if (lost.size === sides) return Array.from({ length: sides }, () => 'lose');
  return Array.from({ length: sides }, (_, side) => (lost.has(side) ? 'lose' : 'win'));
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
