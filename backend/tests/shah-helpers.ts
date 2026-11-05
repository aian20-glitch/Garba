// Помощники для проверок ШАХ (shah-*.test.ts). Сам по себе ничего не проверяет.

import { createShahDeck } from '../src/shah/cards.js';
import {
  act,
  createMatch,
  startParty,
  type ShahAction,
  type ShahFormat,
  type ShahMatch,
  type ShahOptions,
} from '../src/shah/engine.js';
import { shahView } from '../src/shah/view.js';
import type { Card, Rank, Suit } from '../src/types.js';

export const PLAYERS = ['A', 'B', 'C', 'D', 'E', 'F'];

const SUIT_OF: Record<string, Suit> = { '♠': 'spades', '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs' };

// «10♥», «A♠», «6♣» → карта.
export function card(text: string): Card {
  const suit = SUIT_OF[text.slice(-1)];
  const rank = text.slice(0, -1) as Rank;
  if (!suit || !rank) throw new Error(`не карта: ${text}`);
  return { id: `${suit}-${rank}`, suit, rank };
}

// «8♥ 8♣» → карты.
export function cards(text: string): Card[] {
  return text.split(' ').filter(Boolean).map(card);
}

export const ids = (list: Card[]) => list.map((c) => c.id);

// Колода для вскрытия на туза: первый туз выпадает месту dealerSeat.
export function dealerDeckFor(dealerSeat: number): Card[] {
  const all = createShahDeck();
  const aces = all.filter((c) => c.rank === 'A');
  const others = all.filter((c) => c.rank !== 'A');
  return [...others.slice(0, dealerSeat), aces[0], ...others.slice(dealerSeat), ...aces.slice(1)];
}

// Колода раздачи: раздают по одной с соседа справа от сдающего, hands[место] — что получит место,
// rest — остаток колоды (rest[0] — карта, которую откроют для козыря при 2/3/4).
export function dealDeck(format: ShahFormat, dealerSeat: number, hands: Card[][], rest: Card[] = []): Card[] {
  const order = Array.from({ length: format }, (_, i) => (dealerSeat + 1 + i) % format);
  const deck: Card[] = [];
  for (let round = 0; round < 6; round++) for (const s of order) deck.push(hands[s][round]);
  deck.push(...rest);
  if (deck.length !== 36 || new Set(ids(deck)).size !== 36) throw new Error('dealDeck: нужно 36 разных карт');
  return deck;
}

// Остаток колоды: сначала front (front[0] — карта для козыря), потом все карты, которых нет в руках.
export function restAfter(hands: Card[][], front: Card[]): Card[] {
  const used = new Set([...ids(hands.flat()), ...ids(front)]);
  return [...front, ...createShahDeck().filter((c) => !used.has(c.id))];
}

// Какие карты видны в состоянии для игрока viewerId (null — зритель) сверх положенного.
// Положено: своя рука, свои закрытые, открытые карты взяток, показанные карты, карта козыря,
// открытая карта в колоде, вскрытие на туза, стопки в конце (если revealPilesAtEnd).
export function leaks(m: ShahMatch, viewerId: string | null): string[] {
  const seat = viewerId === null ? -1 : m.players.indexOf(viewerId);
  const allowed = new Set(m.firstDealer.reveals.map((r) => r.card.id));
  const p = m.party;
  if (p) {
    if (seat >= 0) for (const c of p.hands[seat]) allowed.add(c.id);
    for (const x of p.shown) allowed.add(x.cardId);
    allowed.add(p.openCard.id);
    allowed.add(p.trumpCard.id);
    if (p.deckOpenCard) allowed.add(p.deckOpenCard.id);
    if (p.lastDraw) allowed.add(p.lastDraw.card.id);
    for (const move of [...(p.trick?.moves ?? []), ...(p.lastTrick?.moves ?? [])]) {
      if (move.kind !== 'closed' || move.seat === seat) for (const c of move.cards) allowed.add(c.id);
    }
    if (p.phase === 'done' && m.options.revealPilesAtEnd) for (const c of p.piles.flat()) allowed.add(c.id);
  }
  const json = JSON.stringify(shahView(m, viewerId));
  const seen = new Set(json.match(/(spades|hearts|diamonds|clubs)-(10|[6-9JQKA])/g) ?? []);
  return [...seen].filter((id) => !allowed.has(id));
}

// Все карты матча на своих местах: руки + колода + стол + стопки = 36 разных.
export function cardsInPlay(m: ShahMatch): number {
  const p = m.party!;
  const all = [
    ...p.hands.flat(),
    ...p.deck,
    ...(p.trick?.moves.flatMap((move) => move.cards) ?? []),
    ...p.piles.flat(),
  ];
  return new Set(ids(all)).size === all.length ? all.length : -1;
}

// Матч с первой партией: сдающий — последнее место, первым заходит место 0 (A).
export function setup(
  format: ShahFormat,
  hands: Card[][],
  rest: Card[] = [],
  options: Partial<ShahOptions> = {},
  dealerSeat = format - 1,
): ShahMatch {
  const match = createMatch(PLAYERS.slice(0, format), dealerDeckFor(dealerSeat), options);
  return startParty(match, dealDeck(format, dealerSeat, hands, rest));
}

// Ход, который обязан пройти.
export function play(m: ShahMatch, player: string, action: ShahAction): ShahMatch {
  const r = act(m, player, action);
  if (!r.ok) throw new Error(`${player} ${action.type} ${action.cardIds.join(',')}: ${r.error}`);
  return r.match;
}

export const lead = (m: ShahMatch, player: string, text: string) =>
  play(m, player, { type: 'lead', cardIds: ids(cards(text)) });

export const beat = (m: ShahMatch, player: string, text: string, targets?: string) =>
  play(m, player, { type: 'beat', cardIds: ids(cards(text)), targetIds: targets ? ids(cards(targets)) : undefined });

export const closed = (m: ShahMatch, player: string, text: string) =>
  play(m, player, { type: 'closed', cardIds: ids(cards(text)) });

// Ход, который должен быть отклонён: вернёт текст ошибки (или 'ok', если прошёл).
export function refused(m: ShahMatch, player: string, action: ShahAction): string {
  const r = act(m, player, action);
  return r.ok ? 'ok' : r.error;
}

// Партия «с середины» для проверок конца: колода пуста, руки — hands, у piles — что уже
// выиграно, всё остальное — в стопку стороны restSide. Заходит leader.
export function craftEndgame(
  match: ShahMatch,
  hands: Card[][],
  leader: number,
  restSide = 0,
  piles?: Card[][],
): ShahMatch {
  const m = structuredClone(match);
  const p = m.party!;
  p.hands = structuredClone(hands);
  p.deck = [];
  p.deckOpenCard = null;
  p.shown = [];
  p.trick = null;
  p.piles = piles ? structuredClone(piles) : p.piles.map(() => []);
  const used = new Set([...ids(hands.flat()), ...ids(p.piles.flat())]);
  p.piles[restSide].push(...createShahDeck().filter((c) => !used.has(c.id)));
  p.phase = 'lead';
  p.leaderSeat = leader;
  p.turnSeat = leader;
  p.awaiting = 'lead';
  return m;
}

// Детерминированная случайность для прогонов (mulberry32).
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}
