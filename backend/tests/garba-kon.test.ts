// Проверки КОНА (RULES.md §6.7, §11.6) и ГАРБЫ (§8). Запуск всех проверок: npm test

import { check, section } from './check.js';
import {
  allowedBidsFor,
  isBiddingOver,
  konTrumpOptions,
  resolveBidding,
  type Bid,
  type BidEntry,
  type Capacity,
  type Wallet,
} from '../src/bidding.js';
import { konAvailable, settleRound, stakeFor } from '../src/money.js';
import { countsAsGarba, instantWinIndex } from '../src/play.js';
import type { Card, Rank, Suit } from '../src/types.js';

const c = (suit: Suit, rank: Rank): Card => ({ id: `${suit}-${rank}`, suit, rank });

// КОН открыт и все богаты — проверяем только правила очерёдности.
const konOpen: Wallet = { balance: 1e9, razStake: 0, dvaStake: 0, konStake: 0 };
const konClosed: Wallet = { balance: 1e9, razStake: 0, dvaStake: 0, konStake: null };

function run(capacity: Capacity, said: Bid[]) {
  const bids: BidEntry[] = [];
  for (let i = 0; i < said.length; i++) {
    const allowed = allowedBidsFor(capacity, bids, konOpen);
    if (!allowed.includes(said[i])) return { rejectedAt: i, bid: said[i], allowed };
    bids.push({ playerId: `И${i + 1}`, playerName: `И${i + 1}`, bid: said[i] });
    if (isBiddingOver(bids, capacity)) {
      return { spoke: bids.length, ...resolveBidding(capacity, bids, 'hearts', 'diamonds') };
    }
  }
  return { unfinished: bids.length };
}

section('когда кнопка КОН есть (§6.7, §6.4)');
check('кон не дорос до порога — КОНА нет', allowedBidsFor(5, [], konClosed), ['РАЗ', 'ДВА', 'ПАС']);
check('кон дорос — четыре кнопки: РАЗ, ДВА, КОН, ПАС', allowedBidsFor(5, [], konOpen), ['РАЗ', 'ДВА', 'КОН', 'ПАС']);
check('4 игрока: КОН тоже есть (ДВА нет)', allowedBidsFor(4, [], konOpen), ['РАЗ', 'КОН', 'ПАС']);
const afterKon: BidEntry[] = [{ playerId: 'И1', playerName: 'И1', bid: 'КОН' }];
check('после КОНА можно РАЗ и ДВА, второго КОНА нет', allowedBidsFor(5, afterKon, konOpen), ['РАЗ', 'ДВА', 'ПАС']);
const afterDva: BidEntry[] = [{ playerId: 'И1', playerName: 'И1', bid: 'ДВА' }];
check('после ДВА КОН сказать нельзя', allowedBidsFor(5, afterDva, konOpen), ['РАЗ', 'ПАС']);
const afterRaz: BidEntry[] = [{ playerId: 'И1', playerName: 'И1', bid: 'РАЗ' }];
check('после РАЗ КОН сказать нельзя', allowedBidsFor(5, afterRaz, konOpen), ['РАЗ', 'ПАС']);

section('проверка баланса для КОНА (§6.7)');
// Твой пример: 5 × 100, базовый кон 500, кон 5000, у игрока 700.
const poor: Wallet = {
  balance: 700,
  razStake: stakeFor('РАЗ', 5000, 500),
  dvaStake: stakeFor('ДВА', 5000, 500),
  konStake: stakeFor('КОН', 5000, 500),
};
check('кон 5000, баланс 700: РАЗ и ДВА не по карману, КОН — можно', allowedBidsFor(5, [], poor), ['КОН', 'ПАС']);
check('КОН стоит базовый кон, а не текущий', stakeFor('КОН', 5000, 500), 500);

section('кто играет после торгов с КОНОМ (§6.4)');
check('КОН, остальные ПАС — играет КОН',
  run(5, ['КОН', 'ПАС', 'ПАС', 'ПАС', 'ПАС']),
  { spoke: 5, kind: 'kon', main: { playerId: 'И1', playerName: 'И1', declaration: 'КОН' } });
check('КОН, потом ДВА — КОН не играет, главный ДВА',
  run(5, ['КОН', 'ДВА', 'ПАС', 'ПАС', 'ПАС']),
  { spoke: 5, kind: 'main', mains: [{ playerId: 'И2', playerName: 'И2', declaration: 'ДВА' }], trumpSuit: 'diamonds' });
check('КОН, потом РАЗ — КОН не играет, главный РАЗ',
  run(5, ['КОН', 'ПАС', 'РАЗ', 'ПАС', 'ПАС']),
  { spoke: 5, kind: 'main', mains: [{ playerId: 'И3', playerName: 'И3', declaration: 'РАЗ' }], trumpSuit: 'hearts' });
check('второй КОН не принимается',
  run(5, ['КОН', 'КОН']), { rejectedAt: 1, bid: 'КОН', allowed: ['РАЗ', 'ДВА', 'ПАС'] });

section('КОН называет козырь после торгов (§6.7)');
check('4 игрока: выбора нет — только черви по РАЗ',
  konTrumpOptions(4, 'hearts'), [{ suit: 'hearts', as: 'РАЗ' }]);
check('5 игроков, РАЗ бубны: бубны по РАЗ или черви по ДВА',
  konTrumpOptions(5, 'diamonds'), [{ suit: 'diamonds', as: 'РАЗ' }, { suit: 'hearts', as: 'ДВА' }]);
check('7 игроков: любая из четырёх мастей',
  konTrumpOptions(7, 'clubs').map((o) => o.suit), ['clubs', 'hearts', 'diamonds', 'spades']);

section('деньги КОНА (§11.6) — твой пример: 5 × 100, кон 5000');
check('кон 5000 ≥ 500 × 10 — КОН открыт', konAvailable(5000, 500, 10), true);
check('КОН выиграл → +500, в коне 4500',
  settleRound([{ playerId: 'A', declaration: 'КОН', won: true, risk: 1 }], 5000, 500),
  { deltas: { A: 500 }, konAfter: 4500 });
check('после выигрыша кон 4500 < 5000 — КОН снова закрыт', konAvailable(4500, 500, 10), false);
check('КОН проиграл → −500, в коне 5500',
  settleRound([{ playerId: 'A', declaration: 'КОН', won: false, risk: 1 }], 5000, 500),
  { deltas: { A: -500 }, konAfter: 5500 });

section('ГАРБА (§8)');
const garbaHand = [c('hearts', 'Q'), c('hearts', 'K'), c('hearts', 'A'), c('spades', 'J'), c('clubs', 'J')];
const plainHand = [c('hearts', 'Q'), c('hearts', 'K'), c('hearts', '6'), c('spades', 'A'), c('clubs', 'J')];

check('РАЗ с дамой, королём и тузом козыря — ГАРБА',
  instantWinIndex([{ playerId: 'A', declaration: 'РАЗ' }], { A: garbaHand }, 'hearts'), 0);
check('без туза козыря — не ГАРБА',
  instantWinIndex([{ playerId: 'A', declaration: 'РАЗ' }], { A: plainHand }, 'hearts'), -1);
check('Q K A не той масти — не ГАРБА (козырь бубны)',
  instantWinIndex([{ playerId: 'A', declaration: 'РАЗ' }], { A: garbaHand }, 'diamonds'), -1);
check('двое РАЗ, ГАРБА у второго — выигрывает второй',
  instantWinIndex(
    [{ playerId: 'A', declaration: 'РАЗ' }, { playerId: 'B', declaration: 'РАЗ' }],
    { A: plainHand, B: garbaHand },
    'hearts',
  ), 1);
check('КОН с ГАРБОЙ — тоже ГАРБА',
  instantWinIndex([{ playerId: 'A', declaration: 'КОН' }], { A: garbaHand }, 'hearts'), 0);
check('ДВА с Q K A своей масти — тоже побеждает сразу, без розыгрыша',
  instantWinIndex([{ playerId: 'A', declaration: 'ДВА' }], { A: garbaHand }, 'hearts'), 0);
check('но у ДВА это НЕ ГАРБА: без анимации и не в статистику', countsAsGarba('ДВА'), false);
check('главный пропал до розыгрыша (§13) — ГАРБА ему не помогает',
  instantWinIndex([{ playerId: 'A', declaration: 'РАЗ' }], { A: garbaHand }, 'hearts', ['A']), -1);
check('двое РАЗ, пропал второй с ГАРБОЙ — сразу не выигрывает никто',
  instantWinIndex(
    [{ playerId: 'A', declaration: 'РАЗ' }, { playerId: 'B', declaration: 'РАЗ' }],
    { A: plainHand, B: garbaHand },
    'hearts',
    ['B'],
  ), -1);
check('РАЗ и КОН с Q K A — это ГАРБА', [countsAsGarba('РАЗ'), countsAsGarba('КОН')], [true, true]);

section('деньги ГАРБЫ (§8)');
check('ГАРБА без второго РАЗ — забирает весь кон 2000',
  settleRound([{ playerId: 'A', declaration: 'РАЗ', won: true, risk: 1 }], 2000, 500),
  { deltas: { A: 2000 }, konAfter: 0 });
check('ГАРБА против второго РАЗ — забирает кон, второй кладёт столько же, кон сохраняется',
  settleRound(
    [{ playerId: 'A', declaration: 'РАЗ', won: true, risk: 1 }, { playerId: 'B', declaration: 'РАЗ', won: false, risk: 1 }],
    2000,
    500,
  ),
  { deltas: { A: 2000, B: -2000 }, konAfter: 2000 });
check('ДВА с Q K A при коне 2000 (≥ ×2 базового) — забирает половину, 1000, как обычный ДВА',
  settleRound([{ playerId: 'A', declaration: 'ДВА', won: true, risk: 1 }], 2000, 500),
  { deltas: { A: 1000 }, konAfter: 1000 });
check('ГАРБА при КОНЕ — только базовый кон: из 5000 забирает 500',
  settleRound([{ playerId: 'A', declaration: 'КОН', won: true, risk: 1 }], 5000, 500),
  { deltas: { A: 500 }, konAfter: 4500 });
