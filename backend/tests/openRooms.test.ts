// Проверки openRooms.ts: открытые комнаты и «быстрая игра». Запуск: npm test

import { check, section } from './check.js';
import { openRoomsFor, type RoomSummary } from '../src/openRooms.js';

const room = (id: string, over: Partial<RoomSummary> = {}): RoomSummary => ({
  id, isPublic: true, status: 'lobby', capacity: 5, memberIds: ['x'], minBalance: 1000, createdAt: 0, ...over,
});

section('открытые комнаты — какие показываем (решение владельца)');
const all = [
  room('по коду', { isPublic: false }),
  room('уже играют', { status: 'started' }),
  room('полная', { memberIds: ['a', 'b', 'c', 'd', 'e'] }),
  room('дорогая', { minBalance: 9000 }),
  room('я уже там', { memberIds: ['я', 'a'] }),
  room('почти полная', { memberIds: ['a', 'b', 'c', 'd'], createdAt: 50 }),
  room('пустая, давно ждёт', { createdAt: 10 }),
  room('пустая, новая', { createdAt: 20 }),
];
const shown = openRoomsFor(all, 5000, 'я').map((r) => r.id);
check('только открытые лобби со свободным местом и где хватает монет', shown, ['почти полная', 'пустая, давно ждёт', 'пустая, новая']);
check('сверху почти полная — её быстрее запустят', shown[0], 'почти полная');
check('монет мало — дорогие не видно', openRoomsFor([room('дорогая', { minBalance: 9000 })], 5000, 'я'), []);
check('быстрая игра берёт первую из списка', openRoomsFor(all, 5000, 'я')[0]?.id, 'почти полная');
