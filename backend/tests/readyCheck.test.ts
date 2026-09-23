// Проверки readyCheck.ts: «ГОТОВ» перед стартом (решение владельца, 23.09.2026). Запуск: npm test

import { check, section } from './check.js';
import { markReady, readyOutcome, readySecondsLeft, startReadyCheck, READY_MS } from '../src/readyCheck.js';

// Серик создал комнату, Айдар и Дана зашли, потом отошли; Ержан и Асель добрали стол.
const players = ['Серик', 'Айдар', 'Дана', 'Ержан', 'Асель'];
const t0 = 1_000_000;

section('комната набралась — 30 секунд на «ГОТОВ»');
check('на «ГОТОВ» — 30 секунд', READY_MS, 30_000);
{
  let c = startReadyCheck(t0);
  check('сразу никто не готов — ждём', readyOutcome(c, players, 'Серик', t0 + 1_000), { kind: 'wait' });
  c = markReady(c, 'Ержан');
  c = markReady(c, 'Ержан');
  check('повторное нажатие не считается дважды', c.readyIds, ['Ержан']);
  check('осталось 20 секунд через 10', readySecondsLeft(c, t0 + 10_000), 20);
  for (const p of players) c = markReady(c, p);
  check('нажали все — игра начинается сама, не дожидаясь 30 секунд', readyOutcome(c, players, 'Серик', t0 + 12_000), { kind: 'start' });
}

section('30 секунд вышли — кто не нажал, выходит');
{
  let c = startReadyCheck(t0);
  for (const p of ['Серик', 'Ержан', 'Асель']) c = markReady(c, p);
  check('29 секунд — ещё ждём Айдара и Дану', readyOutcome(c, players, 'Серик', t0 + 29_000), { kind: 'wait' });
  check('30 секунд — Айдар и Дана выходят, Серик остаётся создателем',
    readyOutcome(c, players, 'Серик', t0 + 30_000), { kind: 'expired', drop: ['Айдар', 'Дана'], creatorId: 'Серик' });
}
{
  let c = startReadyCheck(t0);
  for (const p of ['Дана', 'Ержан']) c = markReady(c, p);
  check('не нажал сам создатель — он тоже выходит, создатель — следующий по входу из оставшихся',
    readyOutcome(c, players, 'Серик', t0 + 31_000), { kind: 'expired', drop: ['Серик', 'Айдар', 'Асель'], creatorId: 'Дана' });
}
check('не нажал никто — комната пустеет',
  readyOutcome(startReadyCheck(t0), players, 'Серик', t0 + 30_000), { kind: 'expired', drop: players, creatorId: null });
