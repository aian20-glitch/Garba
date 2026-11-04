// Прогон случайных партий ШАХ: игроки делают случайные разрешённые ходы, движок не должен
// ни разу нарушить правила. После каждого хода: все 36 карт на месте, у всех не больше 6,
// никому не видно чужих карт; после каждой партии — 120 очков; матч кончается на −24.

import { check, section } from './check.js';
import { beats, createShahDeck } from '../src/shah/cards.js';
import {
  act,
  awaitedOf,
  createMatch,
  startParty,
  type ShahAction,
  type ShahFormat,
  type ShahMatch,
  type ShahOptions,
} from '../src/shah/engine.js';
import { MATCH_LIMIT } from '../src/shah/score.js';
import type { Card, Suit } from '../src/types.js';
import { cardsInPlay, leaks, PLAYERS, seeded, shuffled } from './shah-helpers.js';

// Случайное накрытие: каждой верхней карте — случайная подходящая карта из руки.
function randomBeat(hand: Card[], targets: Card[], trump: Suit, random: () => number): Card[] | null {
  const pool = shuffled(hand, random);
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

function randomAction(m: ShahMatch, random: () => number): { player: string; action: ShahAction } {
  const aw = awaitedOf(m)!;
  const p = m.party!;
  const hand = p.hands[aw.seat];
  const player = m.players[aw.seat];
  if (aw.awaiting === 'lead') {
    const first = hand[Math.floor(random() * hand.length)];
    const bySuit = random() < 0.5;
    const group = hand.filter((c) => c.id !== first.id && (bySuit ? c.suit === first.suit : c.rank === first.rank));
    const extra = Math.floor(random() * (Math.min(group.length, aw.max - 1) + 1));
    const lead = [first, ...shuffled(group, random).slice(0, extra)];
    return { player, action: { type: 'lead', cardIds: lead.map((c) => c.id) } };
  }
  if (aw.awaiting === 'beat' && random() < 0.7) {
    const top = p.trick!.topCards;
    const cover = randomBeat(hand, top, p.trump, random);
    if (cover) {
      const explicit = random() < 0.5;
      return {
        player,
        action: { type: 'beat', cardIds: cover.map((c) => c.id), targetIds: explicit ? top.map((c) => c.id) : undefined },
      };
    }
  }
  return { player, action: { type: 'closed', cardIds: shuffled(hand, random).slice(0, aw.min).map((c) => c.id) } };
}

type Stats = {
  parties: number;
  matches: number;
  steps: number;
  rejected: number;
  mutated: number;
  lostCards: number;
  bigHands: number;
  leaked: number;
  badPoints: number;
  badTotals: number;
  badMatchEnd: number;
  stuck: number;
  shah: number;
  multiCircle: number;
  trumpChanges: number;
  draws: number;
  leftovers: number;
};

function simulate(format: ShahFormat, options: Partial<ShahOptions>, parties: number, seed: number): Stats {
  const random = seeded(seed);
  const s: Stats = {
    parties: 0, matches: 0, steps: 0, rejected: 0, mutated: 0, lostCards: 0, bigHands: 0, leaked: 0, badPoints: 0,
    badTotals: 0, badMatchEnd: 0, stuck: 0, shah: 0, multiCircle: 0, trumpChanges: 0, draws: 0, leftovers: 0,
  };
  const viewers = [...PLAYERS.slice(0, format), null];
  let m: ShahMatch | null = null;
  while (s.parties < parties) {
    if (!m || m.over) {
      m = createMatch(PLAYERS.slice(0, format), shuffled(createShahDeck(), random), options);
      s.matches++;
    }
    m = startParty(m, shuffled(createShahDeck(), random), random);
    s.parties++;
    let steps = 0;
    let trump = m.party!.trump;
    while (m.party!.phase !== 'done') {
      if (++steps > 3000) {
        s.stuck++;
        break;
      }
      const { player, action } = randomAction(m, random);
      // Ход не должен менять старое состояние (act копирует только то, что меняет) — через ход.
      const before = s.steps % 2 === 0 ? JSON.stringify(m) : null;
      const r = act(m, player, action);
      if (before !== null && JSON.stringify(m) !== before) s.mutated++;
      if (!r.ok) {
        s.rejected++;
        break;
      }
      m = r.match;
      s.steps++;
      const p = m.party!;
      if (cardsInPlay(m) !== 36) s.lostCards++;
      if (p.hands.some((h) => h.length > 6)) s.bigHands++;
      // Утечки — каждый ход для одного смотрящего по очереди (игроки и зритель), чтобы прогон был быстрым.
      if (leaks(m, viewers[s.steps % viewers.length]).length > 0) s.leaked++;
      if (p.trick === null && p.lastTrick) {
        if (p.lastTrick.shah) s.shah++;
        if (p.lastTrick.circles > 1) s.multiCircle++;
      }
      if (p.trump !== trump) {
        s.trumpChanges++;
        trump = p.trump;
      }
    }
    const result = m.party!.result;
    if (!result || result.points.reduce((a, b) => a + b, 0) !== 120) s.badPoints++;
    if (result?.draw) s.draws++;
    if (m.party!.leftover) s.leftovers++;
    const sums = m.totals.map((_, i) => m!.history.reduce((sum, h) => sum + h.penalties[i], 0));
    if (JSON.stringify(sums) !== JSON.stringify(m.totals)) s.badTotals++;
    if (m.over !== m.totals.some((t) => t <= MATCH_LIMIT)) s.badMatchEnd++;
  }
  return s;
}

// Все «б» сразу — проверить, что и второй вариант каждого открытого вопроса не ломает игру.
const ALL_B: Partial<ShahOptions> = {
  firstTrumpCard: 'bottom',
  sixOpenCard: 'shuffle',
  trickEnd: 'fullCircle',
  afterShah: 'everyone',
  leadLimit: 'minHand',
  drawMode: 'upTo6',
  drawStart: 'leader',
  revealPilesAtEnd: true,
  drawMultiplier: 'stacking',
  threeWinners: 'best',
};

const RUNS: { name: string; options: Partial<ShahOptions>; parties: number }[] = [
  { name: 'варианты «а»', options: {}, parties: 1000 },
  { name: 'варианты «б»', options: ALL_B, parties: 300 },
  { name: 'добор с соседа сдающего', options: { drawStart: 'dealerRight' }, parties: 200 },
];

for (const run of RUNS) {
  for (const format of [2, 3, 4, 6] as ShahFormat[]) {
    section(`ШАХ: прогон — ${format} игрока(ов), ${run.name}`);
    const s = simulate(format, run.options, run.parties, format * 1000 + run.parties);
    const label = `${format}: ${s.parties} партий, ${s.matches} матчей, ${s.steps} ходов`;
    check(`${label} — ни одного отклонённого разрешённого хода`, s.rejected, 0);
    check(`${format}: партия всегда кончается`, s.stuck, 0);
    check(`${format}: ход не меняет старое состояние`, s.mutated, 0);
    check(`${format}: все 36 карт всегда на месте`, s.lostCards, 0);
    check(`${format}: на руке никогда больше 6`, s.bigHands, 0);
    check(`${format}: никому не видно чужих карт`, s.leaked, 0);
    check(`${format}: каждая партия — ровно 120 очков`, s.badPoints, 0);
    check(`${format}: счёт матча = сумма штрафов партий`, s.badTotals, 0);
    check(`${format}: матч кончается ровно на −24 и ниже`, s.badMatchEnd, 0);
    if (run.options === RUNS[0].options) {
      check(`${format}: ШАХ на отбое случался (${s.shah})`, s.shah > 0, true);
      check(`${format}: перебивания в несколько кругов случались (${s.multiCircle})`, s.multiCircle > 0, true);
      if (format !== 6) check(`${format}: козырь менялся (${s.trumpChanges} раз)`, s.trumpChanges > 0, true);
      else check('6: козырь не меняется никогда', s.trumpChanges, 0);
    }
  }
}
