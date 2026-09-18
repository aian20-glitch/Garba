// Проверки presence.ts и roomDb.ts. Запуск всех проверок: npm test

import { check, section } from './check.js';
import {
  DISCONNECT_TIMEOUT_MS,
  OFFLINE_GRACE_MS,
  presenceStep,
  secondsLeft,
  touch,
  type PresenceState,
} from '../src/presence.js';
import { createAccount, getAccount, openDb } from '../src/accounts.js';
import { loadUnfinishedRooms, roomIdTaken, saveRoom } from '../src/roomDb.js';

const opts = { graceMs: OFFLINE_GRACE_MS, timeoutMs: DISCONNECT_TIMEOUT_MS };
const ids = ['a', 'b', 'c', 'd'];
const empty: PresenceState = { lastSeen: {}, disconnectedAt: {} };

section('отключение игрока (§13)');

let s = presenceStep(ids, ['a', 'b', 'c', 'd'], empty, 0, opts);
check('все на связи — паузы нет', [s.disconnectedAt, s.changed, s.expired], [{}, false, []]);

s = presenceStep(ids, ['a', 'b', 'c'], s, 5_000, opts);
check('d пропал на 5 секунд — ещё не отключился (переход между экранами)', s.disconnectedAt, {});

s = presenceStep(ids, ['a', 'b', 'c'], s, 11_000, opts);
check('d нет дольше 10 секунд — отключился, пауза', [s.disconnectedAt, s.changed], [{ d: 11_000 }, true]);

s = presenceStep(ids, ['a', 'b', 'c'], s, 12_000, opts);
check('повторная проверка — ничего нового', s.changed, false);
check('на экране: осталось 4:59', secondsLeft(s.disconnectedAt.d, 12_000, DISCONNECT_TIMEOUT_MS), 299);

const back = presenceStep(ids, ['a', 'b', 'c', 'd'], s, 200_000, opts);
check('вернулся через 3 минуты — таймер снят, игра идёт', [back.disconnectedAt, back.changed], [{}, true]);

const gone = presenceStep(ids, ['a', 'b', 'c'], s, 11_000 + DISCONNECT_TIMEOUT_MS, opts);
check('не вернулся за 5 минут — время вышло', gone.expired, ['d']);
check('за секунду до конца — ещё ждём', presenceStep(ids, ['a', 'b', 'c'], s, 10_000 + DISCONNECT_TIMEOUT_MS, opts).expired, []);

section('запросы тоже считаются присутствием');
let h = presenceStep(ids, ['a', 'b', 'c'], empty, 0, opts);
h = touch(h, 'd', 8_000); // приложение без сокета опрашивает сервер
h = presenceStep(ids, ['a', 'b', 'c'], h, 15_000, opts);
check('опрашивает раз в несколько секунд — не отключился', h.disconnectedAt, {});
h = presenceStep(ids, ['a', 'b', 'c'], h, 19_000, opts);
check('перестал опрашивать — отключился', Object.keys(h.disconnectedAt), ['d']);

section('перезапуск сервера');
const fresh = presenceStep(ids, [], empty, 1_000_000, opts);
check('сразу после старта никого не считаем отключившимся — даём время переподключиться',
  fresh.disconnectedAt, {});
const later = presenceStep(ids, ['a', 'b', 'c'], fresh, 1_000_000 + 11_000, opts);
check('не переподключился за 10 секунд — отключился', Object.keys(later.disconnectedAt), ['d']);

section('сохранение комнат (этап 9.2)');
const db = openDb(':memory:');
const x = createAccount(db, 'Серик').account;
const y = createAccount(db, 'Дана').account;

saveRoom(db, { id: '11111', status: 'started', players: [{ id: x.id, balance: 9_900 }, { id: y.id, balance: 9_900 }] });
check('балансы записаны вместе с комнатой', [getAccount(db, x.id)?.balance, getAccount(db, y.id)?.balance], [9_900, 9_900]);

saveRoom(db, { id: '22222', status: 'finished', players: [] });
const loaded = loadUnfinishedRooms<{ id: string }>(db).map((r) => r.id);
check('после перезапуска поднимаются только недоигранные комнаты', loaded, ['11111']);
check('номер закрытой комнаты занят', roomIdTaken(db, '22222'), true);
check('свободный номер свободен', roomIdTaken(db, '33333'), false);

saveRoom(db, { id: '11111', status: 'finished', players: [{ id: x.id, balance: 10_300 }, { id: y.id, balance: 9_500 }] });
check('та же комната перезаписывается, а не дублируется', loadUnfinishedRooms(db).length, 0);
check('итоговые балансы на аккаунтах', [getAccount(db, x.id)?.balance, getAccount(db, y.id)?.balance], [10_300, 9_500]);
