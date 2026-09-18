// Проверки play.ts. Запуск всех проверок: npm test

import { check, section } from './check.js';
import {
  firstLeader,
  mainStatus,
  nextSeat,
  playableCards,
  TRICKS_PER_ROUND,
  winnerOfTrick,
  type TrickCard,
} from '../src/play.js';
import { createDeck, shuffle } from '../src/deck.js';
import type { Card, Rank, Suit } from '../src/types.js';


const c = (suit: Suit, rank: Rank): Card => ({ id: `${suit}-${rank}`, suit, rank });
const t = (playerId: string, card: Card): TrickCard => ({ playerId, playerName: playerId, card });
const ids = (cards: Card[]) => cards.map((x) => x.id);

const seats = ['A', 'B', 'C', 'D'];

section('очередь хода');
check('главный C → первым ходит сосед слева B', firstLeader(seats, 'C'), 'B');
check('главный A → первым ходит D (по кругу)', firstLeader(seats, 'A'), 'D');
check('после D ходит A (сосед справа, по кругу)', nextSeat(seats, 'D'), 'A');

section('какими картами можно ходить (козырь черви)');
const hand1 = [c('spades', 'J'), c('hearts', '6'), c('diamonds', 'A')];
check('начинающий взятку — любая карта', ids(playableCards(hand1, [], 'hearts')), ids(hand1));
check('ход ♠K, есть пика → только пика',
  ids(playableCards(hand1, [t('A', c('spades', 'K'))], 'hearts')), ['spades-J']);
const hand2 = [c('hearts', '7'), c('diamonds', 'A'), c('clubs', 'Q')];
check('ход ♠K, пики нет, козырь есть → только козырь',
  ids(playableCards(hand2, [t('A', c('spades', 'K'))], 'hearts')), ['hearts-7']);
const hand3 = [c('diamonds', 'A'), c('clubs', 'Q')];
check('ход ♠K, нет ни пики ни козыря → любая',
  ids(playableCards(hand3, [t('A', c('spades', 'K'))], 'hearts')), ids(hand3));
const hand4 = [c('hearts', '6'), c('spades', 'A')];
check('ходят козырем ♥9, козырь есть → обязан козырем',
  ids(playableCards(hand4, [t('A', c('hearts', '9'))], 'hearts')), ['hearts-6']);

section('кто берёт взятку');
check('без козырей берёт старшая масти хода, чужой туз не бьёт',
  winnerOfTrick([t('A', c('spades', 'K')), t('B', c('spades', 'A')), t('C', c('diamonds', 'A')), t('D', c('clubs', 'Q'))], 'hearts'), 'B');
check('шестёрка козырей бьёт туза масти хода',
  winnerOfTrick([t('A', c('spades', 'K')), t('B', c('hearts', '6')), t('C', c('spades', 'A')), t('D', c('clubs', 'Q'))], 'hearts'), 'B');
check('из двух козырей берёт старший',
  winnerOfTrick([t('A', c('spades', 'K')), t('B', c('hearts', '6')), t('C', c('hearts', 'J')), t('D', c('clubs', 'Q'))], 'hearts'), 'C');
check('при козыре-бубнах (после ДВА) черви — обычная масть',
  winnerOfTrick([t('A', c('hearts', 'A')), t('B', c('diamonds', '6'))], 'diamonds'), 'B');

section('когда решается судьба главного');
check('взял 3 из 3 сыгранных — выиграл сразу', mainStatus(3, 3), 'won');
check('взял 3 на четвёртой взятке — выиграл', mainStatus(3, 4), 'won');
check('против него 3 из 3 — проиграл сразу', mainStatus(0, 3), 'lost');
check('1 из 4 (против 3) — проиграл', mainStatus(1, 4), 'lost');
check('2 из 4 (против 2) — ещё не решено', mainStatus(2, 4), 'open');
check('1 из 2 — ещё не решено', mainStatus(1, 2), 'open');
check('после 5 взяток всегда решено: 2 из 5', mainStatus(2, 5), 'lost');

section('1000 случайных раздач на 4 игроков: один и два главных, ранняя остановка');
let broken = 0;
const stopAt: Record<number, number> = { 3: 0, 4: 0, 5: 0 };
for (let round = 0; round < 1000; round++) {
  // Чётные раздачи — один главный, нечётные — двое (два РАЗ).
  const mains = round % 2 === 0 ? [seats[round % 4]] : [seats[round % 4], seats[(round + 2) % 4]];
  const deck = shuffle(createDeck(4));
  deck.shift(); // открытая карта
  const hands: Record<string, Card[]> = { A: [], B: [], C: [], D: [] };
  for (let i = 0; i < 5; i++) for (const s of seats) hands[s].push(deck.shift()!);

  const tricks: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  let turn = firstLeader(seats, mains[0]);
  let problem = '';
  let played = 0;
  let statuses: string[] = [];

  for (let n = 0; n < TRICKS_PER_ROUND && !problem; n++) {
    const trick: TrickCard[] = [];
    for (let k = 0; k < 4; k++) {
      const legal = playableCards(hands[turn], trick, 'hearts');
      if (legal.length === 0) { problem = `у ${turn} нет допустимых карт`; break; }
      const card = legal[Math.floor(Math.random() * legal.length)];
      hands[turn] = hands[turn].filter((x) => x.id !== card.id);
      trick.push(t(turn, card));
      turn = nextSeat(seats, turn);
    }
    if (problem) break;
    const w = winnerOfTrick(trick, 'hearts');
    tricks[w]++;
    turn = w;
    played++;

    // Та же остановка, что в index.ts: все главные решены — раздача окончена.
    statuses = mains.map((m) => mainStatus(tricks[m], played));
    if (statuses.every((s) => s !== 'open')) break;
  }

  const total = Object.values(tricks).reduce((a, b) => a + b, 0);
  const winners = statuses.filter((s) => s === 'won').length;
  if (!problem && total !== played) problem = `взяток ${total}, а сыграно ${played}`;
  if (!problem && (played < 3 || played > 5)) problem = `остановились на ${played}-й взятке`;
  if (!problem && statuses.some((s) => s === 'open')) problem = 'раздача кончилась, а исход не решён';
  if (!problem && winners > 1) problem = 'выиграли оба главных — так не бывает';
  if (problem) { broken++; if (broken <= 3) console.log('     ', problem); }
  else stopAt[played]++;
}
check('остановка не раньше 3-й взятки, исход всегда решён, больше одного победителя не бывает', broken, 0);
console.log(`      остановились на 3-й: ${stopAt[3]}, на 4-й: ${stopAt[4]}, на 5-й: ${stopAt[5]}`);

