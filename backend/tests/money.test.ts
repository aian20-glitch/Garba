// Проверки money.ts. Запуск всех проверок: npm test

import { check, section } from './check.js';
import {
  baseKon,
  cheapestStake,
  nobodyCanPlay,
  splitKon,
  collectAnte,
  konUnlockAt,
  lowestEntryFor,
  settleRound,
  someoneBelowBase,
  stakeFor,
  type MainOutcome,
} from '../src/money.js';


const main = (playerId: string, declaration: 'РАЗ' | 'ДВА', won: boolean, risk = 1): MainOutcome =>
  ({ playerId, declaration, won, risk });

section('базовый кон (§9.1)');
check('5 игроков × 100 = 500', baseKon(5, 100), 500);
check('6 игроков × 200 = 1200', baseKon(6, 200), 1200);

section('стоимость заявки (§11.3, §11.4)');
check('РАЗ при коне 5000 — весь кон', stakeFor('РАЗ', 5000, 500), 5000);
check('ДВА при базовом коне 500 — не делится, 500', stakeFor('ДВА', 500, 500), 500);
check('ДВА при коне 1000 — половина, 500', stakeFor('ДВА', 1000, 500), 500);
check('ДВА, 6×200, кон 2400 — половина, 1200', stakeFor('ДВА', 2400, 1200), 1200);
check('кон 1500 — ДВА 700, в коне остаётся 800 (твой пример)', stakeFor('ДВА', 1500, 500), 700);
check('кон 2500 — ДВА 1200, в коне 1300', stakeFor('ДВА', 2500, 500), 1200);
let unfair = 0;
for (let k = 1000; k <= 200000; k += 100) {
  const share = stakeFor('ДВА', k, 500);
  if (share > k - share || share % 100 !== 0) unfair++;
}
check('любой кон от ×2 базового до 200 000: ДВА кратен 100 и в коне остаётся не меньше', unfair, 0);

section('ДВА до ×2 базового не делится (§11.4)');
check('5 × 100, кон 800 (меньше 1000) — ДВА стоит весь кон, 800', stakeFor('ДВА', 800, 500), 800);
check('кон 999 — ещё не ×2, ДВА 999', stakeFor('ДВА', 999, 500), 999);
check('кон ровно 1000 — уже ×2, ДВА половина, 500', stakeFor('ДВА', 1000, 500), 500);
let notEqual = 0;
for (let k = 500; k < 1000; k += 100) {
  if (stakeFor('ДВА', k, 500) !== stakeFor('РАЗ', k, 500)) notEqual++;
}
check('весь промежуток 500…900 — РАЗ и ДВА стоят одинаково', notEqual, 0);

// Твой пример целиком: кон 1500 → ДВА забрал 700 → в коне 800 → РАЗ и ДВА по 800.
const afterDva = settleRound([main('A', 'ДВА', true)], 1500, 500);
check('кон 1500, ДВА выиграл → +700, в коне 800', afterDva, { deltas: { A: 700 }, konAfter: 800 });
check('следующая раздача при коне 800: РАЗ и ДВА оба стоят 800',
  [stakeFor('РАЗ', afterDva.konAfter, 500), stakeFor('ДВА', afterDva.konAfter, 500)], [800, 800]);

section('один главный (§11.3, §11.4)');
check('РАЗ выиграл кон 500 → +500, кон пуст',
  settleRound([main('A', 'РАЗ', true)], 500, 500), { deltas: { A: 500 }, konAfter: 0 });
check('РАЗ проиграл кон 1000 → −1000, кон 2000',
  settleRound([main('A', 'РАЗ', false)], 1000, 500), { deltas: { A: -1000 }, konAfter: 2000 });
check('ДВА выиграл базовый кон 500 → +500, кон пуст',
  settleRound([main('A', 'ДВА', true)], 500, 500), { deltas: { A: 500 }, konAfter: 0 });
check('ДВА выиграл кон 1000 → +500, в коне остаётся 500',
  settleRound([main('A', 'ДВА', true)], 1000, 500), { deltas: { A: 500 }, konAfter: 500 });
check('ДВА, 6×200: кон 1200 базовый, проиграл → −1200, кон 2400',
  settleRound([main('A', 'ДВА', false)], 1200, 1200), { deltas: { A: -1200 }, konAfter: 2400 });
check('ДВА, 6×200: кон 2400 вырос, проиграл → −1200, кон 3600',
  settleRound([main('A', 'ДВА', false)], 2400, 1200), { deltas: { A: -1200 }, konAfter: 3600 });

section('двое РАЗ (§11.5)');
check('один выиграл, кон 1000 → +1000 / −1000, кон сохраняется 1000',
  settleRound([main('A', 'РАЗ', true), main('B', 'РАЗ', false)], 1000, 500),
  { deltas: { A: 1000, B: -1000 }, konAfter: 1000 });
check('оба проиграли, кон 1000 → каждый −1000, кон 3000',
  settleRound([main('A', 'РАЗ', false), main('B', 'РАЗ', false)], 1000, 500),
  { deltas: { A: -1000, B: -1000 }, konAfter: 3000 });

section('риск (§11.2, §11.7)');
check('король на ×2, проиграл при коне 1000 → −2000, кон 3000',
  settleRound([main('A', 'РАЗ', false, 2)], 1000, 500), { deltas: { A: -2000 }, konAfter: 3000 });
check('король на ×2, выиграл при коне 1000 → только +1000, риск в плюс не идёт',
  settleRound([main('A', 'РАЗ', true, 2)], 1000, 500), { deltas: { A: 1000 }, konAfter: 0 });

section('деньги не появляются из ниоткуда и не пропадают');
let leaks = 0;
for (let i = 0; i < 2000; i++) {
  const kon = 500 * (1 + Math.floor(Math.random() * 20)) + (i % 3 === 0 ? 250 : 0);
  const two = i % 2 === 0;
  const mains = two
    ? [main('A', 'РАЗ', i % 4 === 0), main('B', 'РАЗ', false)]
    : [main('A', Math.random() < 0.5 ? 'РАЗ' : 'ДВА', Math.random() < 0.5, 1 + (i % 5))];
  const s = settleRound(mains, kon, 500);
  const paidOut = Object.values(s.deltas).reduce((a, b) => a + b, 0);
  if (kon - paidOut !== s.konAfter || s.konAfter < 0) leaks++;
}
check('2000 случайных расчётов: кон до = кон после + выплаты, кон не уходит в минус', leaks, 0);

section('взнос (§9.2) и конец комнаты (§12)');
check('у всех хватает — все платят по 100',
  collectAnte({ A: 1000, B: 900 }, 100), { paid: { A: 100, B: 100 }, total: 200, brokePlayerIds: [] });
check('у одного 50 при взносе 100 — доливка отключается у ВСЕХ',
  collectAnte({ A: 1000, B: 50, C: 5000 }, 100), { paid: { A: 0, B: 0, C: 0 }, total: 0, brokePlayerIds: ['B'] });
check('у одного ровно 100 — хватает, все платят',
  collectAnte({ A: 1000, B: 100 }, 100), { paid: { A: 100, B: 100 }, total: 200, brokePlayerIds: [] });
section('порог КОН (§6.7)');
check('5 × 100, порог ×10 → КОН с 5000', konUnlockAt(500, 10), 5000);
check('5 × 100, порог ×3 → КОН с 1500', konUnlockAt(500, 3), 1500);
check('у всех ≥ 500 — комната живёт', someoneBelowBase([10000, 500, 700], 500), false);
check('у одного 499 — комната доигрывает последний кон', someoneBelowBase([10000, 499, 700], 500), true);

section('кон никто не может взять (§12.2)');
check('4 игрока: самая дешёвая заявка — РАЗ, весь кон', cheapestStake(4, 16000, 4000), 16000);
check('5 игроков: самая дешёвая — ДВА, половина выросшего кона', cheapestStake(5, 16000, 5000), 8000);
check('у одного хватает на заявку — игра идёт', nobodyCanPlay([9000, 7000, 16000, 3000], 16000), false);
check('ни у кого не хватает — закрываем', nobodyCanPlay([9000, 7000, 15900, 3000], 16000), true);
check('кон 16000 на четверых — по 4000, без остатка',
  splitKon(16000, [{ id: 'A', lost: 0 }, { id: 'B', lost: 5000 }, { id: 'C', lost: 1000 }, { id: 'D', lost: 0 }]),
  { shares: { A: 4000, B: 4000, C: 4000, D: 4000 }, perPlayer: 4000, remainder: 0, remainderTo: null });
check('кон 16000 на семерых — по 2285, остаток 5 тому, кто больше проиграл',
  splitKon(16000, ['A','B','C','D','E','F','G'].map((id, i) => ({ id, lost: i === 3 ? 9000 : 100 }))).remainderTo, 'D');
let splitLeaks = 0;
for (let i = 0; i < 1000; i++) {
  const n = 4 + (i % 4);
  const kon = 100 * (1 + Math.floor(Math.random() * 500));
  const r = splitKon(kon, Array.from({ length: n }, (_, k) => ({ id: 'p' + k, lost: Math.floor(Math.random() * 10000) })));
  const sum = Object.values(r.shares).reduce((a, b) => a + b, 0);
  if (sum !== kon) splitLeaks++;
}
check('1000 случайных делений: раздали ровно весь кон, ни монетой больше или меньше', splitLeaks, 0);

section('минимум для входа (§9.1a)');
check('взнос 100 → минимум от 1 000', lowestEntryFor(100), 1000);
check('взнос 500 → минимум от 5 000', lowestEntryFor(500), 5000);
check('взнос 1000 → минимум 10 000', lowestEntryFor(1000), 10000);
let below = 0;
for (let ante = 100; ante <= 1000; ante += 100) for (let n = 4; n <= 7; n++) if (lowestEntryFor(ante) < baseKon(n, ante)) below++;
check('при любом взносе и составе минимум для входа не ниже базового кона', below, 0);

