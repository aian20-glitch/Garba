// Проверки bidding.ts. Запуск всех проверок: npm test

import { check, section } from './check.js';
import {
  allowedBidsFor,
  isBiddingOver,
  razSuitFor,
  resolveBidding,
  type Bid,
  type BidEntry,
  type Capacity,
  type Wallet,
} from '../src/bidding.js';
import type { Suit } from '../src/types.js';


// Богатый игрок: деньги не ограничивают, проверяем только правила.
const rich: Wallet = { balance: 1e9, razStake: 0, dvaStake: 0 };


// Прогоняет торги: заявки идут по очереди, пока isBiddingOver не скажет стоп.
function run(capacity: Capacity, razSuit: Suit, said: Bid[]) {
  const bids: BidEntry[] = [];
  for (let i = 0; i < said.length; i++) {
    const allowed = allowedBidsFor(capacity, bids, rich);
    if (!allowed.includes(said[i])) {
      return { rejectedAt: i, bid: said[i], allowed };
    }
    bids.push({ playerId: `И${i + 1}`, playerName: `И${i + 1}`, bid: said[i] });
    if (isBiddingOver(bids, capacity)) {
      const out = resolveBidding(capacity, bids, razSuit);
      return { spoke: bids.length, ...out };
    }
  }
  return { unfinished: bids.length };
}

section('масть РАЗ');
check('4 игрока, открылся K♣ → РАЗ = черви',
  razSuitFor(4, { id: 'clubs-K', suit: 'clubs', rank: 'K' }), 'hearts');
check('5 игроков, открылась ♦9 → РАЗ = бубны',
  razSuitFor(5, { id: 'diamonds-9', suit: 'diamonds', rank: '9' }), 'diamonds');

section('4 игрока');
check('кнопки: только РАЗ и ПАС', allowedBidsFor(4, [], rich), ['РАЗ', 'ПАС']);
check('РАЗ, ПАС, ПАС, ПАС → один главный, козырь черви',
  run(4, 'hearts', ['РАЗ', 'ПАС', 'ПАС', 'ПАС']),
  { spoke: 4, kind: 'main', mains: [{ playerId: 'И1', playerName: 'И1', declaration: 'РАЗ' }], trumpSuit: 'hearts' });
check('ПАС, РАЗ, РАЗ → торги обрываются на третьем, двое главных',
  run(4, 'hearts', ['ПАС', 'РАЗ', 'РАЗ', 'ПАС']),
  { spoke: 3, kind: 'main', mains: [
    { playerId: 'И2', playerName: 'И2', declaration: 'РАЗ' },
    { playerId: 'И3', playerName: 'И3', declaration: 'РАЗ' }], trumpSuit: 'hearts' });
check('все ПАС → пересдача',
  run(4, 'hearts', ['ПАС', 'ПАС', 'ПАС', 'ПАС']), { spoke: 4, kind: 'all_pass' });
check('ДВА при 4 игроках отклоняется',
  run(4, 'hearts', ['ДВА']), { rejectedAt: 0, bid: 'ДВА', allowed: ['РАЗ', 'ПАС'] });

section('5 игроков, РАЗ = бубны, ДВА = черви');
check('кнопки в начале: РАЗ, ДВА, ПАС', allowedBidsFor(5, [], rich), ['РАЗ', 'ДВА', 'ПАС']);
check('ДВА, остальные ПАС → играет ДВА, козырь меняется на черви',
  run(5, 'diamonds', ['ДВА', 'ПАС', 'ПАС', 'ПАС', 'ПАС']),
  { spoke: 5, kind: 'main', mains: [{ playerId: 'И1', playerName: 'И1', declaration: 'ДВА' }], trumpSuit: 'hearts' });
check('ДВА, ПАС, РАЗ → ДВА выбывает, играет РАЗ, козырь бубны',
  run(5, 'diamonds', ['ДВА', 'ПАС', 'РАЗ', 'ПАС', 'ПАС']),
  { spoke: 5, kind: 'main', mains: [{ playerId: 'И3', playerName: 'И3', declaration: 'РАЗ' }], trumpSuit: 'diamonds' });
check('второй ДВА не принимается',
  run(5, 'diamonds', ['ДВА', 'ДВА']), { rejectedAt: 1, bid: 'ДВА', allowed: ['РАЗ', 'ПАС'] });
check('ДВА, РАЗ, РАЗ → обрыв после второго РАЗ, двое главных',
  run(5, 'diamonds', ['ДВА', 'РАЗ', 'РАЗ', 'ПАС', 'ПАС']),
  { spoke: 3, kind: 'main', mains: [
    { playerId: 'И2', playerName: 'И2', declaration: 'РАЗ' },
    { playerId: 'И3', playerName: 'И3', declaration: 'РАЗ' }], trumpSuit: 'diamonds' });

section('6 игроков');
check('ДВА пока недоступен (выбор скрытой масти — этап 5)', allowedBidsFor(6, [], rich), ['РАЗ', 'ПАС']);

section('проверка баланса (RULES.md §6.6)');
check('кон 1000, баланс 800: РАЗ закрыт (нужно 1000), ДВА открыт (нужно 500)',
  allowedBidsFor(5, [], { balance: 800, razStake: 1000, dvaStake: 500 }), ['ДВА', 'ПАС']);
check('баланс ровно на РАЗ — можно', allowedBidsFor(4, [], { balance: 1000, razStake: 1000, dvaStake: 1000 }), ['РАЗ', 'ПАС']);
check('денег нет ни на что — только ПАС', allowedBidsFor(5, [], { balance: 100, razStake: 500, dvaStake: 500 }), ['ПАС']);

