import { ALL_SUITS, ranksForSuit } from "./config.js";
import type { Card } from "./types.js";

export function createDeck(capacity: 4 | 5 | 6 | 7): Card[] {
  const deck: Card[] = [];
  for (const suit of ALL_SUITS) {
    for (const rank of ranksForSuit(capacity, suit)) {
      deck.push({ id: `${suit}-${rank}`, suit, rank });
    }
  }
  return deck;
}

export function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
