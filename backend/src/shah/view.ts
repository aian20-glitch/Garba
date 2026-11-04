// Что видит каждый за столом ШАХ (SHAH_RULES.md §8, §17). Чистые функции.
//
// - своя рука — целиком; у других — только число карт и карты, которые все видели
//   (показанная при доборе карта козыря, открытая карта у сдающего при 6);
// - закрытые карты — только рубашкой: число карт; сами карты — лишь тому, кто их положил;
// - колода — числом карт и открытой картой козыря, пока она в колоде; порядок колоды не виден;
// - стопки — числом карт; очки — только в конце партии (по ходу по ним можно было бы
//   вычислить закрытые карты). Сами стопки — в конце партии, если revealPilesAtEnd (вопрос 13).
// Зритель (viewerId = null или не за столом) видит то же, что игрок, но без своей руки.

import type { Card, Suit } from '../types.js';
import { coverCost, findBeat, isLegalLead, matchCovers } from './cards.js';
import { awaitedOf, isTeamFormat, sideCount, sideOf, type ShahMatch, type TrickMove } from './engine.js';
import { MATCH_LIMIT } from './score.js';

// Рука больше не бывает (§3, §11: по 6, добор не больше заложенного) — на всякий случай
// подсказки не считаем для руки больше этого, чтобы не перебирать 2^n.
const OPTIONS_HAND_LIMIT = 10;

// Все наборы карт руки размером от min до max — в порядке руки.
function subsets(hand: Card[], min: number, max: number): Card[][] {
  const out: Card[][] = [];
  const total = 1 << hand.length;
  for (let mask = 1; mask < total; mask++) {
    const pick = hand.filter((_, i) => mask & (1 << i));
    if (pick.length >= min && pick.length <= max) out.push(pick);
  }
  return out;
}

// Какими картами можно зайти (§6): одна любая, несколько одной масти или одного достоинства,
// не больше max (вопрос 8). Сервер решает — приложение только включает кнопку «ЗАЙТИ».
export function leadOptions(hand: Card[], max: number): string[][] {
  if (hand.length > OPTIONS_HAND_LIMIT) return [];
  return subsets(hand, 1, max)
    .filter(isLegalLead)
    .map((set) => set.map((c) => c.id));
}

// Какими наборами из n карт можно побить верхнюю комбинацию (§7): каждую карту — своей.
// Сначала самые дешёвые (как findBeat): обычные карты, потом козыри, ШАХ — последним.
export function beatOptions(hand: Card[], top: Card[], trump: Suit): string[][] {
  if (hand.length > OPTIONS_HAND_LIMIT || top.length === 0) return [];
  const cost = (set: Card[]) => set.reduce((sum, c) => sum + coverCost(c, trump), 0);
  return subsets(hand, top.length, top.length)
    .filter((set) => matchCovers(set, top, trump) !== null)
    .sort((a, b) => cost(a) - cost(b))
    .map((set) => set.map((c) => c.id));
}

export type PublicMove =
  | { seat: number; kind: 'lead'; cards: Card[] }
  | { seat: number; kind: 'beat'; cards: Card[]; covers: string[]; shah: boolean }
  | { seat: number; kind: 'closed'; reason: string; count: number; cards?: Card[] };

function publicMove(move: TrickMove, viewerSeat: number): PublicMove {
  if (move.kind !== 'closed') return move;
  const view: PublicMove = { seat: move.seat, kind: 'closed', reason: move.reason, count: move.cards.length };
  if (move.seat === viewerSeat) view.cards = move.cards; // свои закрытые карты игрок знает
  return view;
}

export function shahView(match: ShahMatch, viewerId: string | null) {
  const seat = viewerId === null ? -1 : match.players.indexOf(viewerId);
  const p = match.party;
  const awaited = awaitedOf(match);
  const mine = seat >= 0 && awaited?.seat === seat ? awaited : null;
  const hand = seat >= 0 && p ? p.hands[seat] : [];
  const done = p?.phase === 'done';

  return {
    format: match.format,
    teams: isTeamFormat(match.format),
    sides: sideCount(match.format),
    players: match.players.map((id, s) => ({
      id,
      seat: s,
      side: sideOf(match.format, s),
      handCount: p ? p.hands[s].length : 0,
      shown: p ? p.shown.filter((x) => x.seat === s).map((x) => p.hands[s].find((c) => c.id === x.cardId)!) : [],
    })),
    firstDealer: match.firstDealer,
    dealerSeat: p ? p.dealerSeat : match.dealerSeat,
    nextDealerSeat: done || !p ? match.dealerSeat : null,
    totals: match.totals,
    multiplier: match.multiplier,
    limit: MATCH_LIMIT,
    history: match.history,
    over: match.over,
    result: match.result,
    party: p && {
      number: p.number,
      phase: p.phase,
      trump: p.trump,
      trumpCard: p.trumpCard,
      openCard: p.openCard,
      deckCount: p.deck.length,
      deckOpenCard: p.deckOpenCard,
      leaderSeat: p.leaderSeat,
      turnSeat: p.turnSeat,
      awaiting: p.awaiting,
      trick: p.trick && {
        leader: p.trick.leader,
        n: p.trick.n,
        circle: p.trick.circle,
        topSeat: p.trick.topSeat,
        shah: p.trick.shah,
        inTrick: p.trick.inTrick,
        out: p.trick.out,
        mustClose: p.trick.mustClose,
        moves: p.trick.moves.map((m) => publicMove(m, seat)),
      },
      lastTrick: p.lastTrick && {
        leader: p.lastTrick.leader,
        n: p.lastTrick.n,
        winnerSeat: p.lastTrick.winnerSeat,
        shah: p.lastTrick.shah,
        circles: p.lastTrick.circles,
        moves: p.lastTrick.moves.map((m) => publicMove(m, seat)),
      },
      lastDraw: p.lastDraw,
      tricksPlayed: p.tricksPlayed,
      pileCounts: p.piles.map((pile) => pile.length),
      leftover: p.leftover,
      result: p.result,
      piles: done && match.options.revealPilesAtEnd ? p.piles : null,
    },
    mySeat: seat,
    myHand: hand,
    myAwaiting: mine?.awaiting ?? null,
    myMin: mine?.min ?? 0,
    myMax: mine?.max ?? 0,
    // Есть ли чем побить верхнюю комбинацию — только самому игроку, чтобы включить «ПОБИТЬ».
    myCanBeat: mine?.awaiting === 'beat' && p?.trick ? findBeat(hand, p.trick.topCards, p.trump) !== null : false,
    // Наборы карт, которыми сейчас можно зайти / побить, — только тому, чей ход. Приложение
    // включает «ЗАЙТИ» и «ПОБИТЬ», только когда выбранные карты совпали с одним из наборов.
    myLeadOptions: mine?.awaiting === 'lead' ? leadOptions(hand, mine.max) : [],
    myBeatOptions: mine?.awaiting === 'beat' && p?.trick ? beatOptions(hand, p.trick.topCards, p.trump) : [],
  };
}

export type ShahView = ReturnType<typeof shahView>;
