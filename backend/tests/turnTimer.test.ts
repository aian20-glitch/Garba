// Проверки turnTimer.ts: время на ход (RULES.md §13a). Запуск: npm test

import { check, section } from './check.js';
import { addMiss, clockFor, dealShowStep, pickRandom, revealShowMs, TURN_MS, turnMsFor, turnSecondsLeft } from '../src/turnTimer.js';

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

section('отсчёт хода — после анимации раздачи (решение владельца, 27.09.2026)');
{
  // 7 игроков по 5 карт: 1 с на открытую карту + 35 карт по 0,43 с = 16,05 с.
  const show = dealShowStep(undefined, '3', 5, 7, 0, t0);
  check('7 игроков, 5 карт — анимация 16,05 с', show!.shownAt - t0, 16_050);
  const clock = clockFor(undefined, 'bid:0:Серик', t0 + 200, show!.shownAt);
  check('первая заявка: часы стоят, пока карты летят', clock!.since, t0 + 16_050);
  check('через 10 с после раздачи — 20 с хода и ещё 6 с анимации', turnSecondsLeft(clock, t0 + 10_000, TURN_MS), 27);
  check('анимация кончилась — ровно 20 секунд', turnSecondsLeft(clock, t0 + 16_050, TURN_MS), 20);
  check('следующее решение после анимации — отсчёт сразу',
    clockFor(clock!, 'bid:1:Дана', t0 + 30_000, show!.shownAt)!.since, t0 + 30_000);
  check('ИЗЖОГА добавляет 3 с', dealShowStep(undefined, '4', 5, 5, 1, t0)!.shownAt - t0, 1_000 + 3_000 + 25 * 430);
  check('та же раздача — анимация не начинается заново', dealShowStep(show, '3', 5, 7, 0, t0 + 20_000), show);
  const blind = dealShowStep(undefined, '5', 0, 5, 0, t0);
  check('слепой круг туза: карт нет — только открытая карта', blind!.shownAt - t0, 1_000);
  const more = dealShowStep(blind, '5', 5, 5, 0, t0 + 30_000);
  check('дораздали после спецкарты — 0,5 с + карты', more!.shownAt - t0, 30_000 + 500 + 25 * 430);
  check('раздачи на столе нет — ничего не меняем', dealShowStep(show, null, 0, 7, 0, t0), show);
  check('вскрытие на туза: 25 карт по 0,9 с + 1,6 с на возврат — больше 20 с хода', revealShowMs(25), 24_100);
}
