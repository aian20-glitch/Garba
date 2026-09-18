import { eligibleTrumpSuits, LOW_TO_HIGH } from "./config.js";
import type { Card, Player, RoomState, Suit } from "./types.js";

export type SpecialKind = "ACE" | "KING" | "QUEEN" | "SIX" | "TEN" | null;

export function specialKind(card?: Card): SpecialKind {
  if (!card) return null;
  if (card.rank === "A") return "ACE";
  if (card.rank === "K") return "KING";
  if (card.rank === "Q") return "QUEEN";
  if (card.rank === "6") return "SIX";
  if (card.rank === "10") return "TEN";
  return null;
}

export function isGarba(hand: Card[], trumpSuit?: Suit): boolean {
  if (!trumpSuit) return false;
  const ranks = new Set(hand.filter(c => c.suit === trumpSuit).map(c => c.rank));
  return ranks.has("Q") && ranks.has("K") && ranks.has("A");
}

export function canDeclareMain(player: Player, requiredLossCover: number): boolean {
  return player.coins >= requiredLossCover;
}

export function canPlayCard(
  hand: Card[],
  card: Card,
  currentTrick: { playerId: string; card: Card }[],
  trumpSuit?: Suit
): boolean {
  if (currentTrick.length === 0) return true;
  const leadSuit = currentTrick[0].card.suit;

  const hasLeadSuit = hand.some(c => c.suit === leadSuit);
  if (hasLeadSuit) return card.suit === leadSuit;

  const hasTrump = trumpSuit ? hand.some(c => c.suit === trumpSuit) : false;
  if (hasTrump) return card.suit === trumpSuit;

  return true;
}

export function trickWinner(
  trick: { playerId: string; card: Card }[],
  trumpSuit?: Suit
): string | undefined {
  if (trick.length === 0) return undefined;
  const leadSuit = trick[0].card.suit;

  const rankScore = (r: Card["rank"]) => LOW_TO_HIGH.indexOf(r);
  const score = (c: Card) => {
    const isTrump = trumpSuit && c.suit === trumpSuit;
    if (isTrump) return 100 + rankScore(c.rank);
    if (c.suit === leadSuit) return 50 + rankScore(c.rank);
    return rankScore(c.rank);
  };

  return trick.reduce((best, item) =>
    score(item.card) > score(best.card) ? item : best
  ).playerId;
}

export function isEligibleTrumpSuit(room: RoomState, suit: Suit): boolean {
  return eligibleTrumpSuits(room.capacity).includes(suit);
}
