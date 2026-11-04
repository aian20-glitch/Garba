// Проверки personalPause.ts: личная пауза (RULES.md §20a, решение владельца 04.11.2026).
// Запуск: npm test

import { check, section } from './check.js';
import { pauseOver, pauseRefusal, pausesLeft, pauseSecondsLeft, startPause, type PauseCheck } from '../src/personalPause.js';

const ok: PauseCheck = {
  betweenDeals: true,
  seated: true,
  bot: false,
  gone: false,
  roomPaused: false,
  activePause: false,
  voteActive: false,
  timeUp: false,
  used: 0,
  tournament: false,
};

section('обычная игра — 3 паузы по 10 секунд за партию');
check('«Пауза 3/3» → 2/3 → 1/3 → 0/3', [0, 1, 2, 3].map((u) => pausesLeft(u, false)), [3, 2, 1, 0]);
check('между раздачами, ничего не ждём — можно', pauseRefusal(ok), null);
check('третья — можно', pauseRefusal({ ...ok, used: 2 }), null);
check('четвёртая — нельзя', pauseRefusal({ ...ok, used: 3 }), 'no pauses left');

section('турнир — 1 пауза на весь турнир');
check('«Турнирная пауза 1/1» → 0/1', [pausesLeft(0, true), pausesLeft(1, true)], [1, 0]);
check('не тратил — можно на любом столе', pauseRefusal({ ...ok, tournament: true }), null);
check('потратил на первом столе — на следующем нельзя', pauseRefusal({ ...ok, tournament: true, used: 1 }), 'no pauses left');

section('когда нельзя');
check('посреди раздачи', pauseRefusal({ ...ok, betweenDeals: false }), 'cannot pause now');
check('стол ждёт отключившегося (§13)', pauseRefusal({ ...ok, roomPaused: true }), 'cannot pause now');
check('идёт голосование (закончить, без ушедшего, докупить)', pauseRefusal({ ...ok, voteActive: true }), 'cannot pause now');
check('время стола вышло', pauseRefusal({ ...ok, timeUp: true }), 'cannot pause now');
check('уже идёт чья-то пауза — вторую сразу нельзя', pauseRefusal({ ...ok, activePause: true }), 'pause in progress');
check('зритель или ушедший', pauseRefusal({ ...ok, seated: false }), 'player is not in this room');
check('бот', pauseRefusal({ ...ok, bot: true }), 'player is not in this room');
check('пропавший посреди раздачи', pauseRefusal({ ...ok, gone: true }), 'player is not in this room');

section('10 секунд');
const p = startPause('Серик', 1000);
check('сразу — 10 с', [pauseSecondsLeft(p, 1000), pauseOver(p, 1000)], [10, false]);
check('через 9,5 с — ещё 1 с', [pauseSecondsLeft(p, 10_500), pauseOver(p, 10_500)], [1, false]);
check('через 10 с — кончилась', [pauseSecondsLeft(p, 11_000), pauseOver(p, 11_000)], [0, true]);
