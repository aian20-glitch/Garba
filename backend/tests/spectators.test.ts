// Проверки spectators.ts: наблюдатели (RULES.md §18). Запуск: npm test

import { check, section } from './check.js';
import { liveRoomsFor, spectateRefusal, spectatorCount, LIVE_ROOMS_LIMIT, type LiveRoomSummary } from '../src/spectators.js';

const room = (id: string, over: Partial<LiveRoomSummary> = {}): LiveRoomSummary => ({
  id, status: 'started', memberIds: ['a', 'b', 'c', 'd'], spectators: 0, createdAt: 0, ...over,
});

section('§18: какие идущие столы видны в лобби');
const all = [
  room('лобби', { status: 'lobby' }),
  room('закончилась', { status: 'finished' }),
  room('я за столом', { memberIds: ['я', 'b', 'c', 'd'] }),
  room('там заблокированный', { memberIds: ['враг', 'b', 'c', 'd'] }),
  room('тихий, давно', { createdAt: 10 }),
  room('тихий, новый', { createdAt: 20 }),
  room('много зрителей', { spectators: 7, createdAt: 30 }),
];
const shown = liveRoomsFor(all, 'я', new Set(['враг'])).map((r) => r.id);
check('только начатые, без меня и без заблокированных', shown, ['много зрителей', 'тихий, давно', 'тихий, новый']);
check('сверху — где больше зрителей', shown[0], 'много зрителей');
check('столов много — показываем не больше лимита',
  liveRoomsFor(Array.from({ length: 50 }, (_, i) => room(`r${i}`)), 'я', new Set()).length, LIVE_ROOMS_LIMIT);

section('§18: кто может смотреть стол');
const base = { member: false, status: 'started', playingElsewhere: false, blocked: false };
check('свободный игрок смотрит идущую игру', spectateRefusal(base), null);
check('сам сидит в начатой игре — нельзя (свой стол встал бы на паузу)',
  spectateRefusal({ ...base, playingElsewhere: true }), 'playing elsewhere');
check('за столом тот, с кем блок, — нельзя', spectateRefusal({ ...base, blocked: true }), 'blocked');
check('игрок своего стола — всегда можно', spectateRefusal({ ...base, member: true, playingElsewhere: true, blocked: true }), null);
check('лобби — как раньше, без ограничений', spectateRefusal({ ...base, status: 'lobby', playingElsewhere: true }), null);
check('законченная игра — итоги видны', spectateRefusal({ ...base, status: 'finished', blocked: true }), null);

section('§18: счётчик 👁');
check('считаются только не сидящие за столом', spectatorCount('started', ['a', 'x', 'y'], ['a', 'b']), 2);
check('два сокета одного зрителя — один зритель', spectatorCount('started', ['x', 'x', 'y'], ['a']), 2);
check('после конца игры зрители остаются', spectatorCount('finished', ['x'], ['a']), 1);
check('в лобби зрителей не считаем', spectatorCount('lobby', ['x', 'y'], ['a']), 0);
