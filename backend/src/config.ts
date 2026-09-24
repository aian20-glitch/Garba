import type { Rank, Suit } from "./types.js";

export const STARTING_COINS = 30_000; // новый игрок (решение владельца, 25.09.2026; было 10 000)
export const DAILY_BONUS = 1_000;
export const DAY_7_BONUS = 5_000;
export const REFERRAL_BONUS = 10_000;
export const DAILY_GIFT_MAX = 10_000;
export const DISCONNECT_GRACE_MS = 5 * 60 * 1000;
export const ANTE_PER_PLAYER = 100;

export const ALL_SUITS: Suit[] = ["hearts", "diamonds", "clubs", "spades"];
export const LOW_TO_HIGH: Rank[] = ["6", "7", "8", "9", "10", "J", "Q", "K", "A"];

export function eligibleTrumpSuits(capacity: 4 | 5 | 6 | 7): Suit[] {
  if (capacity === 4) return ["hearts"];
  if (capacity === 5) return ["hearts", "diamonds"];
  if (capacity === 6) return ["hearts", "diamonds", "clubs"];
  return [...ALL_SUITS];
}

export function ranksForSuit(capacity: 4 | 5 | 6 | 7, suit: Suit): Rank[] {
  const eligible = eligibleTrumpSuits(capacity).includes(suit);
  return eligible ? [...LOW_TO_HIGH] : ["J", "Q", "K", "A"];
}
