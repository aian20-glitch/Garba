// Проверки topUp.ts: докупить из кошелька за столом (RULES.md §9.1c, 22.10.2026). Запуск: npm test

import { check, section } from './check.js';
import { applyTopUp, canRequestTopUp, checkTopUpAmount, TOP_UP_VOTE_MS, topUpOutcome } from '../src/topUp.js';

// Пример владельца: у Серика в кошельке 300 000, за стол он сел со 100 000 — в запасе 200 000.
const serik = { balance: 100_000, reserve: 200_000, startBalance: 100_000 };
const ask = { stage: 'round_done', voteActive: false, requestedIds: [] as string[], playerId: 'Серик', reserve: 200_000 };

section('когда можно попросить докупить (§9.1c)');
check('после сыгранной раздачи — можно', canRequestTopUp(ask), true);
check('при пересдаче — можно', canRequestTopUp({ ...ask, stage: 'awaiting_deal' }), true);
check('до первой раздачи — нельзя: только что сам выбрал, сколько взять за стол',
  canRequestTopUp({ ...ask, stage: 'dealer_found' }), false);
check('посреди торгов, борьбы за спецкарту и розыгрыша — нельзя',
  ['bidding', 'special', 'special_discard', 'kon_trump', 'playing'].map((stage) => canRequestTopUp({ ...ask, stage })),
  [false, false, false, false, false]);
check('во время голосования «делим кон» и после конца игры — нельзя',
  [canRequestTopUp({ ...ask, stage: 'vote' }), canRequestTopUp({ ...ask, stage: 'room_done' })], [false, false]);
check('идёт другое голосование — нельзя', canRequestTopUp({ ...ask, voteActive: true }), false);
check('кошелёк пуст — нечего докупать', canRequestTopUp({ ...ask, reserve: 0 }), false);
check('Серик уже просил между этими раздачами — второй раз нельзя', canRequestTopUp({ ...ask, requestedIds: ['Серик'] }), false);
check('а Дана — может', canRequestTopUp({ ...ask, requestedIds: ['Серик'], playerId: 'Дана' }), true);

section('сколько можно попросить — до всего кошелька');
check('50 000 из 200 000 — можно', checkTopUpAmount(50_000, 200_000), 50_000);
check('весь кошелёк — можно', checkTopUpAmount(200_000, 200_000), 200_000);
check('больше кошелька — нельзя', checkTopUpAmount(200_001, 200_000), null);
check('ноль, минус, дробь, не число — нельзя',
  [checkTopUpAmount(0, 200_000), checkTopUpAmount(-100, 200_000), checkTopUpAmount(500.5, 200_000), checkTopUpAmount('много', 200_000)],
  [null, null, null, null]);
check('не прислал сумму или прислал true — нельзя', [checkTopUpAmount(undefined, 200_000), checkTopUpAmount(true, 200_000)], [null, null]);

section('ответ стола — нужно согласие всех остальных');
const t0 = 1_000_000;
const others = ['Аян', 'Дана', 'Ержан'];
const vote = (yes: string[], no: string[] = []) => ({ requesterId: 'Серик', amount: 50_000, yes, no, startedAt: t0 });
check('все остальные «за» — докупает', topUpOutcome(vote(others), others, t0 + 5_000), 'approved');
check('хотя бы один «против» — докупки нет', topUpOutcome(vote(['Аян', 'Дана'], ['Ержан']), others, t0 + 5_000), 'rejected');
check('«против» решает сразу, даже если другие ещё не ответили', topUpOutcome(vote([], ['Аян']), others, t0 + 1_000), 'rejected');
check('ответили не все — ждём', topUpOutcome(vote(['Аян']), others, t0 + 5_000), 'pending');
check('30 секунд без ответа — докупки нет', topUpOutcome(vote(['Аян']), others, t0 + TOP_UP_VOTE_MS), 'expired');
check('за столом, кроме него, одни боты — спрашивать некого, докупает сразу', topUpOutcome(vote([]), [], t0), 'approved');

section('деньги после докупки');
check('Серик докупил 50 000: на столе 150 000, в кошельке 150 000',
  applyTopUp(serik, 50_000), { balance: 150_000, reserve: 150_000, startBalance: 150_000 });
const after = applyTopUp(serik, 50_000);
check('всего монет столько же — 300 000', after.balance + after.reserve, 300_000);
check('докупка — не выигрыш: итог за игру не меняется (на столе − с чем сел)',
  after.balance - after.startBalance, serik.balance - serik.startBalance);
check('100 000 закончились (на столе 0) — докупил всё: 200 000 на столе, кошелёк пуст',
  applyTopUp({ balance: 0, reserve: 200_000, startBalance: 100_000 }, 200_000), { balance: 200_000, reserve: 0, startBalance: 300_000 });
