// Проверки lobbyTimer.ts: лобби закрывается, если игра не началась за 10 минут
// (решение владельца, 27.09.2026). Запуск: npm test

import { check, section } from './check.js';
import { LOBBY_MS, lobbyExpired, lobbySecondsLeft } from '../src/lobbyTimer.js';

const t0 = 1_000_000;

section('лобби ждёт игроков 10 минут');
check('на сбор — 10 минут', LOBBY_MS, 600_000);
check('9:59 — ещё ждём', lobbyExpired(t0, t0 + 599_000, false), false);
check('10:00 — комната закрывается', lobbyExpired(t0, t0 + 600_000, false), true);
check('идёт «ГОТОВ» — не закрываем, ждём итога проверки', lobbyExpired(t0, t0 + 700_000, true), false);
check('сразу после создания — 600 секунд', lobbySecondsLeft(t0, t0), 600);
check('через 4 минуты и полсекунды — 360 секунд (округляем вверх)', lobbySecondsLeft(t0, t0 + 240_500), 360);
check('время вышло — 0, не минус', lobbySecondsLeft(t0, t0 + 700_000), 0);
