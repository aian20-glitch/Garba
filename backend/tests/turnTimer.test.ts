// Проверки turnTimer.ts: время на ход (RULES.md §13a). Запуск: npm test

import { check, section } from './check.js';
import { addMiss, clockFor, pickRandom, TURN_MS, turnMsFor, turnSecondsLeft } from '../src/turnTimer.js';

section('время на ход — 20 секунд (§13a, решение владельца правил)');
const t0 = 1_000_000;
const c1 = clockFor(undefined, 'bid:0:Серик', t0);
check('ждём Серика — отсчёт пошёл', c1, { key: 'bid:0:Серик', since: t0 });
check('то же решение через 5 с — время не сбрасывается', clockFor(c1!, 'bid:0:Серик', t0 + 5_000), c1);
check('Серик сказал — ждём Дану, отсчёт заново', clockFor(c1!, 'bid:1:Дана', t0 + 5_000), { key: 'bid:1:Дана', since: t0 + 5_000 });
check('никого не ждём — часов нет', clockFor(c1!, null, t0), null);
check('на экране: прошло 5 с — осталось 15', turnSecondsLeft(c1, t0 + 5_000, TURN_MS), 15);
check('время вышло — 0, не меньше', turnSecondsLeft(c1, t0 + 25_000, TURN_MS), 0);

section('два пропуска подряд — ушёл (§13a)');
const first = addMiss({}, 'Серик');
check('первый пропуск — ещё не ушёл (мог задуматься)', [first.missed, first.away], [{ Серик: 1 }, false]);
const second = addMiss(first.missed, 'Серик');
check('второй подряд — ушёл: пауза 5 минут', [second.missed.Серик, second.away], [2, true]);
check('у другого игрока счёт свой', addMiss(second.missed, 'Дана').away, false);

section('случайная карта');
check('берём из списка', pickRandom(['a', 'b', 'c'], () => 0.99), 'c');
check('и первую тоже', pickRandom(['a', 'b', 'c'], () => 0), 'a');

section('время на ход выбирает создатель — 20 или 40 секунд (решение владельца, 23.09.2026)');
check('выбрали 40 — 40 секунд', turnMsFor(40), 40_000);
check('выбрали 20 — 20 секунд', turnMsFor(20), 20_000);
check('комната до выбора времени — 20 секунд', turnMsFor(undefined), 20_000);
{
  const clock = clockFor(undefined, 'bid:1', 0);
  check('при 40 секундах через 25 с ещё 15 осталось', turnSecondsLeft(clock, 25_000, turnMsFor(40)), 15);
}
