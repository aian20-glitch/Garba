// Проверки share.ts: отдать часть выигрыша другому игроку (RULES.md §11.8, 22.10.2026). Запуск: npm test

import { check, section } from './check.js';
import { canShare, checkShareAmount, shareLimits } from '../src/share.js';

section('сколько можно отдать — от взноса до 10% выигрыша (§11.8)');
// Пример владельца: за столом играют по 100, Серик выиграл 10 000 и отдал Аяну 500.
check('выиграл 10 000 при взносе 100 — от 100 до 1 000', shareLimits(10_000, 100), { min: 100, max: 1_000 });
check('10% не круглые — вниз до сотни: выиграл 1 550 — до 100', shareLimits(1_550, 100), { min: 100, max: 100 });
check('10% меньше взноса — отдать нельзя: выиграл 900 при взносе 100', shareLimits(900, 100), null);
check('взнос 500, выиграл 4 000 — 10% это 400, меньше взноса — нельзя', shareLimits(4_000, 500), null);
check('взнос 500, выиграл 5 000 — ровно 500', shareLimits(5_000, 500), { min: 500, max: 500 });
check('КОН забирает базовый кон — 10% всегда меньше взноса (7 игроков × 1 000)', shareLimits(7_000, 1_000), null);

section('кто и когда может отдать');
const won = { playerId: 'Серик', declaration: 'РАЗ', won: true, delta: 10_000 };
const g = { stage: 'round_done', result: [won], shared: false, playerId: 'Серик', ante: 100 };
check('Серик сказал РАЗ и выиграл — может, до 1 000', canShare(g), { min: 100, max: 1_000 });
check('сказал ДВА и выиграл — тоже', canShare({ ...g, result: [{ ...won, declaration: 'ДВА' }] }), { min: 100, max: 1_000 });
check('КОН — нет, даже если бы хватало', canShare({ ...g, result: [{ ...won, declaration: 'КОН' }] }), null);
check('проиграл — нечего отдавать', canShare({ ...g, result: [{ ...won, won: false, delta: -10_000 }] }), null);
check('не главный — нельзя', canShare({ ...g, playerId: 'Аян' }), null);
check('уже отдал в этой раздаче — второй раз нельзя', canShare({ ...g, shared: true }), null);
check('раздача ещё идёт или уже новая — нельзя',
  ['bidding', 'special', 'playing', 'awaiting_deal', 'vote', 'room_done'].map((stage) => canShare({ ...g, stage })),
  [null, null, null, null, null, null]);
check('итога нет — нельзя', canShare({ ...g, result: null }), null);

section('сумма — кратно 100, от взноса до 10%');
const limits = { min: 100, max: 1_000 };
check('500 — можно (пример владельца)', checkShareAmount(500, limits), 500);
check('ровно взнос и ровно 10% — можно', [checkShareAmount(100, limits), checkShareAmount(1_000, limits)], [100, 1_000]);
check('меньше взноса, больше 10% — нельзя', [checkShareAmount(0, limits), checkShareAmount(1_100, limits)], [null, null]);
check('не кратно 100, дробь, минус, не число — нельзя',
  [checkShareAmount(150, limits), checkShareAmount(500.5, limits), checkShareAmount(-500, limits), checkShareAmount('много', limits), checkShareAmount(undefined, limits)],
  [null, null, null, null, null]);
