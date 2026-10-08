// Проверки presence.ts и roomDb.ts. Запуск всех проверок: npm test

import { check, section } from './check.js';
import {
  absenceMsFor,
  absenceStep,
  DISCONNECT_TIMEOUT_MS,
  OFFLINE_GRACE_MS,
  presenceStep,
  secondsLeft,
  touch,
  type PresenceState,
} from '../src/presence.js';
import { createAccount, getAccount, openDb } from '../src/accounts.js';
import { loadUnfinishedRooms, profileStats, roomIdTaken, saveRoom } from '../src/roomDb.js';
import { emptyStats, type PlayerStats } from '../src/stats.js';

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

section('статистика в профиле (этап 9.4)');
const st = (over: Partial<PlayerStats>): PlayerStats => ({ ...emptyStats(), ...over });
check('новый игрок — всё по нулям', profileStats(db, x.id), { ...emptyStats(), rooms: 0 });

saveRoom(db, {
  id: '44444', status: 'started', players: [{ id: x.id, balance: 10_800 }],
  stats: { [x.id]: st({ deals: 3, mains: 1, wins: 1, raz: 1, coinsWon: 500, coinsLost: 100, maxWin: 500, maxRisk: 1 }) },
});
check('идущая комната уже в профиле, но не считается доигранной',
  [profileStats(db, x.id).deals, profileStats(db, x.id).rooms], [3, 0]);

saveRoom(db, {
  id: '44444', status: 'finished', players: [{ id: x.id, balance: 10_800 }],
  stats: { [x.id]: st({ deals: 5, mains: 2, wins: 1, losses: 1, raz: 2, coinsWon: 500, coinsLost: 1_100, maxWin: 500, maxRisk: 1 }) },
});
saveRoom(db, {
  id: '55555', status: 'finished', players: [{ id: x.id, balance: 12_800 }],
  stats: { [x.id]: st({ deals: 4, mains: 1, wins: 1, dva: 1, garba: 0, coinsWon: 2_000, maxWin: 2_000, maxRisk: 3 }) },
});
const profile = profileStats(db, x.id);
check('комната перезаписалась, а не прибавилась дважды; две доигранные комнаты',
  [profile.rooms, profile.deals, profile.mains, profile.wins, profile.losses], [2, 9, 3, 2, 1]);
check('монеты — сумма, максимумы — максимум',
  [profile.coinsWon, profile.coinsLost, profile.maxWin, profile.maxRisk], [2_500, 1_100, 2_000, 3]);
check('РАЗ и ДВА по отдельности', [profile.raz, profile.dva], [2, 1]);
check('у другого игрока своя статистика', profileStats(db, y.id).deals, 0);

section('запас 5 минут на всю игру (§13, §13a, решение владельца правил)');
const MIN = 60_000;
const seats = ['Серик', 'Дана'];
let a = absenceStep(seats, ['Серик'], {}, {}, 0, 5 * MIN);
check('Серик ушёл — у него 5:00', a.msLeft.Серик, 5 * MIN);
a = absenceStep(seats, ['Серик'], a.since, a.usedMs, 2 * MIN, 5 * MIN);
check('через 2 минуты — осталось 3', a.msLeft.Серик, 3 * MIN);
a = absenceStep(seats, [], a.since, a.usedMs, 2 * MIN, 5 * MIN);
check('вернулся — потрачено 2 минуты, запас 3', [a.usedMs.Серик, a.msLeft.Серик], [2 * MIN, 3 * MIN]);
a = absenceStep(seats, ['Серик'], a.since, a.usedMs, 30 * MIN, 5 * MIN);
check('снова ушёл через полчаса — у него не 5, а 3 минуты', a.msLeft.Серик, 3 * MIN);
a = absenceStep(seats, ['Серик'], a.since, a.usedMs, 33 * MIN, 5 * MIN);
check('3 минуты вышли — комната закрывается', a.expired, ['Серик']);
check('у Даны свой нетронутый запас', a.msLeft.Дана, 5 * MIN);
const b = absenceStep(seats, ['Дана'], {}, { Дана: 5 * MIN }, 0, 5 * MIN);
check('запас кончился раньше — следующий уход сразу закрывает', b.expired, ['Дана']);

section('запас на отлучку выбирает создатель: 1…5 минут (08.10.2026)');
check('3 минуты', absenceMsFor(3), 180_000);
check('1 минута', absenceMsFor(1), 60_000);
check('старая комната без настройки — 5 минут', absenceMsFor(undefined), 300_000);
check('чужое значение — 5 минут', absenceMsFor(7), 300_000);
