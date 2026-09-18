export type Suit = "hearts" | "diamonds" | "clubs" | "spades";
export type Rank = "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A";

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
}

export interface Player {
  id: string;
  name: string;
  coins: number;
  rating: number;
  online: boolean;
  ready: boolean;
  hand: Card[];
  playedCards: Card[];
  tricks: number;
}

export type RoomPhase =
  | "lobby"
  | "dealer_selection"
  | "trump_selection"
  | "special_card"
  | "decision"
  | "playing"
  | "round_result"
  | "paused"
  | "closed";

export interface RoomState {
  id: string;
  capacity: 4 | 5 | 6 | 7;
  players: Player[];
  phase: RoomPhase;
  dealerPlayerId?: string;
  trumpCard?: Card;
  trumpSuit?: Suit;
  leadPlayerId?: string;
  mainPlayerId?: string;
  riskMultiplier: 1 | 2 | 3 | 4 | 5;
  pot: number;
  currentTurnPlayerId?: string;
  currentTrick: { playerId: string; card: Card }[];
  disconnectDeadline?: number;
}
