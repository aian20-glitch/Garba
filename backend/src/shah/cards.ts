// Карты игры ШАХ (SHAH_RULES.md §2, §6, §7, §10, §13). Чистые функции.
//
// Колода — 36 карт с теми же id, что в Гарбе («hearts-A»). Старшинство в ШАХ своё:
// Т > 10 > К > Д > В > 9 > 8 > 7 > 6 — десятка старше короля, но слабее туза.

import type { Card, Rank, Suit } from '../types.js';

export const SHAH_SUITS: readonly Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];

// От младшей к старшей (§2).
export const SHAH_RANKS: readonly Rank[] = ['6', '7', '8', '9', 'J', 'Q', 'K', '10', 'A'];

// §13: Т 11, 10 — 10, К 4, Д 3, В 2, 9…6 — 0. Вся колода — 120.
export const CARD_POINTS: Readonly<Record<Rank, number>> = {
  A: 11,
  '10': 10,
  K: 4,
  Q: 3,
  J: 2,
  '9': 0,
  '8': 0,
  '7': 0,
  '6': 0,
};
export const TOTAL_POINTS = 120;

// Особая карта ШАХ — шестёрка крестей (§10).
export const SHAH_CARD_ID = 'clubs-6';

export function createShahDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SHAH_SUITS) {
    for (const rank of SHAH_RANKS) deck.push({ id: `${suit}-${rank}`, suit, rank });
  }
  return deck;
}

export function rankPower(rank: Rank): number {
  return SHAH_RANKS.indexOf(rank);
}

export function cardPoints(card: Card): number {
  return CARD_POINTS[card.rank];
}

export function pointsOf(cards: Card[]): number {
  return cards.reduce((sum, card) => sum + cardPoints(card), 0);
}

export function isShah(card: Card): boolean {
  return card.suit === 'clubs' && card.rank === '6';
}

// Бьёт ли карта cover карту target при отбивании (§7, §10).
// - 6♣ на отбое бьёт любую карту, даже козырного туза;
// - та же масть — старшая карта;
// - другая масть — только козырь, и только если target не козырь.
// Как target 6♣ — обычная шестёрка крестей: в заходе у неё особой силы нет. Накрытую
// ШАХом комбинацию не бьют вовсе — это проверяет движок, а не эта функция.
export function beats(cover: Card, target: Card, trump: Suit): boolean {
  if (isShah(cover)) return true;
  if (cover.suit === target.suit) return rankPower(cover.rank) > rankPower(target.rank);
  return cover.suit === trump;
}

// Заход (§6): одна любая карта, несколько одной масти или несколько одного достоинства.
export function isLegalLead(cards: Card[]): boolean {
  if (cards.length === 0) return false;
  const [first] = cards;
  return cards.every((c) => c.suit === first.suit) || cards.every((c) => c.rank === first.rank);
}

// Каждую верхнюю карту — отдельной картой, которая её бьёт (§7). Масти накрывающих могут быть
// разными. Возвращает для каждой накрывающей индекс верхней карты, которую она бьёт, или null.
export function matchCovers(covers: Card[], targets: Card[], trump: Suit): number[] | null {
  if (covers.length !== targets.length || covers.length === 0) return null;
  const used = targets.map(() => false);
  const result: number[] = [];
  const place = (i: number): boolean => {
    if (i === covers.length) return true;
    for (let j = 0; j < targets.length; j++) {
      if (used[j] || !beats(covers[i], targets[j], trump)) continue;
      used[j] = true;
      result[i] = j;
      if (place(i + 1)) return true;
      used[j] = false;
    }
    return false;
  };
  return place(0) ? result : null;
}

// Дешевле — то, чем жальче бить последним: обычные карты по старшинству, потом козыри, ШАХ — в конце.
export function coverCost(card: Card, trump: Suit): number {
  if (isShah(card)) return 100;
  return (card.suit === trump ? 50 : 0) + rankPower(card.rank);
}

// Найти, чем побить targets из руки (по карте на каждую), — по возможности самыми дешёвыми
// картами. Порядок результата — по targets. null — побить нечем.
export function findBeat(hand: Card[], targets: Card[], trump: Suit): Card[] | null {
  if (targets.length === 0 || hand.length < targets.length) return null;
  const pool = [...hand].sort((a, b) => coverCost(a, trump) - coverCost(b, trump));
  const used = pool.map(() => false);
  const chosen: Card[] = [];
  const place = (i: number): boolean => {
    if (i === targets.length) return true;
    for (let j = 0; j < pool.length; j++) {
      if (used[j] || !beats(pool[j], targets[i], trump)) continue;
      used[j] = true;
      chosen[i] = pool[j];
      if (place(i + 1)) return true;
      used[j] = false;
    }
    return false;
  };
  return place(0) ? chosen : null;
}
