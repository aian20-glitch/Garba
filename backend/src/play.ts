// Розыгрыш: очередь хода, допустимые карты, взятки, итог раздачи.
// Только чистые функции. Правила — RULES.md §10.
//
// Места за столом — массив id в порядке против часовой стрелки:
// следующий элемент = сосед справа, предыдущий = сосед слева.

import { canPlayCard, isGarba, trickWinner } from './rules.js';
import type { Card, Suit } from './types.js';

export const TRICKS_PER_ROUND = 5;
// Главному нужно минимум 3 взятки из 5 (RULES.md §1).
export const TRICKS_TO_WIN = 3;

export type TrickCard = {
  playerId: string;
  playerName: string;
  card: Card;
};

// Следующий по ходу — сосед справа.
export function nextSeat(seatIds: string[], playerId: string): string {
  const i = seatIds.indexOf(playerId);
  if (i < 0) throw new Error(`player ${playerId} is not seated`);
  return seatIds[(i + 1) % seatIds.length];
}

// Первый ход первой взятки — сосед слева от главного, сам главный ходит вторым.
// При двух РАЗ — сосед слева от того, кто сказал РАЗ первым (RULES.md §10.4, §10.5).
// Исключения для спецкарт 6 и 10 — этап 7.
export function firstLeader(seatIds: string[], firstMainId: string): string {
  const i = seatIds.indexOf(firstMainId);
  if (i < 0) throw new Error(`main ${firstMainId} is not seated`);
  return seatIds[(i - 1 + seatIds.length) % seatIds.length];
}

// Какими картами игрок может сейчас пойти. Начинающий взятку — любой,
// отвечающий — в масть, без масти — козырем, без того и другого — любой.
export function playableCards(
  hand: Card[],
  trick: TrickCard[],
  trumpSuit: Suit,
): Card[] {
  return hand.filter((card) => canPlayCard(hand, card, trick, trumpSuit));
}

// Кто взял взятку: старший козырь, а без козырей — старшая карта масти хода.
export function winnerOfTrick(trick: TrickCard[], trumpSuit: Suit): string {
  const winner = trickWinner(trick, trumpSuit);
  if (!winner) throw new Error('empty trick has no winner');
  return winner;
}

// Дама, король и туз козыря на руках у главного. Три старших козыря побить нечем,
// поэтому раздача не разыгрывается: главный выигрывает сразу (RULES.md §8).
//
// При РАЗ и КОНЕ это ГАРБА — с анимацией и записью в статистику.
// При ДВА — тоже победа сразу, но это не ГАРБА: без анимации и не в статистику,
// потому что у ДВА нет риска РАЗ.
export const GARBA_DECLARATIONS: ReadonlyArray<string> = ['РАЗ', 'КОН'];

export function countsAsGarba(declaration: string): boolean {
  return GARBA_DECLARATIONS.includes(declaration);
}

// Индекс главного, который выигрывает сразу, без розыгрыша, или -1.
// Двух таких быть не может: дама, король и туз козыря в колоде по одной.
// concededIds — главные, которые уже проиграли (пропали до розыгрыша, RULES.md §13):
// им дама, король и туз не помогают.
export function instantWinIndex(
  mains: { playerId: string; declaration: string }[],
  hands: Record<string, Card[]>,
  trumpSuit: Suit,
  concededIds: string[] = [],
): number {
  return mains.findIndex(
    (m) => !concededIds.includes(m.playerId) && isGarba(hands[m.playerId] ?? [], trumpSuit),
  );
}

export type MainStatus = 'won' | 'lost' | 'open';

// Решилась ли уже судьба главного. Раздача не доигрывается до конца:
// главный взял 3 — выиграл, против него забрали 3 — проиграл (RULES.md §10.5a).
export function mainStatus(tricks: number, tricksPlayed: number): MainStatus {
  if (tricks >= TRICKS_TO_WIN) return 'won';

  // Сколько взяток могут забрать все остальные, пока главный ещё жив: 5 − 3 = 2.
  // Третья взятка против него — поражение.
  const againstToLose = TRICKS_PER_ROUND - TRICKS_TO_WIN + 1;
  if (tricksPlayed - tricks >= againstToLose) return 'lost';

  return 'open';
}

// Сдаться (§10.7, решение владельца правил): любой главный — РАЗ, ДВА, КОН, спецкарта —
// в любой момент розыгрыша (и пока взявший спецкарту сбрасывает карту), один раз.
export function canConcede(g: { stage: string; isMain: boolean; alreadyConceded: boolean }): boolean {
  if (!g.isMain || g.alreadyConceded) return false;
  return g.stage === 'playing' || g.stage === 'special_discard';
}

// Судьба каждого главного с учётом сдавшихся: сдался — проиграл сразу, остальные —
// по взяткам (§10.5a). Раздача кончается, когда не осталось 'open'.
export function mainStatuses(
  mains: { playerId: string }[],
  tricksWon: Record<string, number>,
  tricksPlayed: number,
  concededIds: string[],
): MainStatus[] {
  return mains.map((m) =>
    concededIds.includes(m.playerId)
      ? 'lost'
      : mainStatus(tricksWon[m.playerId] ?? 0, tricksPlayed),
  );
}

// Карты на руках после раздачи открываются всем (RULES.md §10.8, решение владельца
// 07.10.2026): раздача сыграна (есть итог) или игра закончилась. Пока раздача идёт —
// ничего не открываем, чужие руки скрыты (железное правило 2).
export function openHands(
  stage: string,
  hasResult: boolean,
  hands: Record<string, Card[]>,
): Record<string, Card[]> | null {
  if (stage === 'room_done' || (hasResult && (stage === 'round_done' || stage === 'vote'))) {
    return Object.fromEntries(Object.entries(hands).map(([id, cards]) => [id, [...cards]]));
  }
  return null;
}
