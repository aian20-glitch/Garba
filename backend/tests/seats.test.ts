// Проверки seats.ts: места за столом, выход, ожидание замены (24.09.2026). Запуск: npm test

import { check, section } from './check.js';
import { betweenDeals, freeSeats, seatFor, vacancyExpired, vacancySecondsLeft, VACANCY_WAIT_MS } from '../src/seats.js';
import { openRoomsFor } from '../src/openRooms.js';

section('места за столом: где сел — там играет');
check('стол на 5, заняты 0 и 2 — свободны 1, 3, 4', freeSeats([0, 2], 5), [1, 3, 4]);
check('без выбора — первое свободное', seatFor([0, 2], 5), 1);
check('выбрал свободное — его', seatFor([0, 2], 5, 4), 4);
check('выбрал занятое — нельзя', seatFor([0, 2], 5, 2), null);
check('стол полон — места нет', seatFor([0, 1, 2, 3], 4), null);

section('«Выйти» — только между раздачами');
check('после раздачи, при пересдаче, до первой раздачи — можно',
  ['round_done', 'awaiting_deal', 'dealer_found'].map(betweenDeals), [true, true, true]);
check('в торгах, в розыгрыше, в борьбе за спецкарту — нельзя',
  ['bidding', 'playing', 'special', 'special_discard', 'kon_trump'].map(betweenDeals), [false, false, false, false, false]);

section('свободное место ждёт нового игрока 10 минут');
check('ждём 10 минут', VACANCY_WAIT_MS, 600_000);
check('9 минут — ещё ждём', vacancyExpired([{ seat: 1, since: 0 }], 9 * 60_000), false);
check('10 минут — игра заканчивается', vacancyExpired([{ seat: 1, since: 0 }], 10 * 60_000), true);
check('осталось 1 минута', vacancySecondsLeft({ seat: 1, since: 0 }, 9 * 60_000), 60);

section('начатая игра со свободным местом — в «Открытых комнатах»');
const base = { isPublic: true, capacity: 5, minBalance: 1000, createdAt: 0 };
const list = openRoomsFor([
  { ...base, id: 'lobby', status: 'lobby', memberIds: ['a'] },
  { ...base, id: 'game-free', status: 'started', memberIds: ['a', 'b', 'c', 'd'], vacancies: 1 },
  { ...base, id: 'game-full', status: 'started', memberIds: ['a', 'b', 'c', 'd', 'e'], vacancies: 0 },
], 5000, 'z');
check('показываем лобби и игру со свободным местом, полную игру — нет', list.map((r) => r.id).sort(), ['game-free', 'lobby']);
