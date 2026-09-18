// Проверки special.ts: спецкарты и борьба за карту (RULES.md §7). Запуск: npm test

import { check, section } from './check.js';
import {
  contestResult,
  nextActor,
  passCard,
  passUnaffordable,
  riskOptions,
  specialKindOf,
  specialLeader,
  startContest,
  takeCard,
  type Contest,
} from '../src/special.js';
import type { Card, Rank, Suit } from '../src/types.js';

const c = (suit: Suit, rank: Rank): Card => ({ id: `${suit}-${rank}`, suit, rank });
const seats = ['И1', 'И2', 'И3', 'И4', 'И5'];

section('какая открытая карта — спецкарта (§7)');
check('4 игрока: ♥A — туз', specialKindOf(4, c('hearts', 'A')), 'A');
check('4 игрока: ♠A — не спецкарта (не черви)', specialKindOf(4, c('spades', 'A')), null);
check('5 игроков: ♦K — король', specialKindOf(5, c('diamonds', 'K')), 'K');
check('5 игроков: ♥Q — дама', specialKindOf(5, c('hearts', 'Q')), 'Q');
check('5 игроков: ♥6 и ♥10 — спецкарты', [specialKindOf(5, c('hearts', '6')), specialKindOf(5, c('hearts', '10'))], ['6', '10']);
check('♥J, ♥9 — обычные карты', [specialKindOf(5, c('hearts', 'J')), specialKindOf(5, c('hearts', '9'))], [null, null]);

section('туз: твой пример из правил (§7.4)');
// Раздающий И1, значит опрос идёт И2 → И3 → И4 → И5 → И1.
let t: Contest = startContest('A', seats, 'И1');
check('первым спрашивают соседа справа от раздающего — И2, вслепую только ×1',
  [t.phase, nextActor(t), riskOptions(t)], ['blind', 'И2', [1]]);
t = takeCard(t, 'И2', 1);
check('И2 забрал вслепую на ×1 — открывается окно перехвата', [t.phase, t.holderId, t.risk], ['window', 'И2', 1]);
check('окно снова справа от раздающего; владельца И2 пропускаем — говорит И3', nextActor(t), 'И3');
check('И3 может назвать ×2, ×3, ×4 или сразу ×5', riskOptions(t), [2, 3, 4, 5]);
t = takeCard(t, 'И3', 2);
check('И3 сказал ×2 — туз у И3', [t.holderId, t.risk, nextActor(t)], ['И3', 2, 'И4']);
t = passCard(t, 'И4');
t = passCard(t, 'И5');
check('И4 и И5 спасовали — очередь И1', nextActor(t), 'И1');
t = takeCard(t, 'И1', 3);
check('И1 сказал ×3 — туз у И1', [t.holderId, t.risk], ['И1', 3]);
const circle: string[] = [];
let probe = t;
for (let i = 0; i < 3; i++) {
  const who = nextActor(probe)!;
  circle.push(who);
  probe = { ...probe, lastActorId: who };
}
check('дальше спрашивают только И2 и И3: туз у И1, И4 и И5 выбыли навсегда', circle, ['И2', 'И3', 'И2']);
check('И2 может ответить ×4 или ×5', riskOptions(t), [4, 5]);
t = takeCard(t, 'И2', 5);
check('×5 — потолок, борьба окончена, туз у И2 на ×5',
  [nextActor(t), contestResult(t)], [null, { holderId: 'И2', risk: 5 }]);

section('туз: слепой круг');
let blind = startContest('A', seats, 'И1');
for (const p of ['И2', 'И3', 'И4', 'И5', 'И1']) blind = passCard(blind, p);
check('все отказались вслепую — борьба окончена, туза нет, дальше обычные торги',
  [nextActor(blind), contestResult(blind)], [null, null]);

let lateTaker = startContest('A', seats, 'И1');
lateTaker = passCard(lateTaker, 'И2');
lateTaker = passCard(lateTaker, 'И3');
lateTaker = takeCard(lateTaker, 'И4', 1);
check('отказ вслепую не выводит из борьбы: в окне И2 снова спрашивают',
  nextActor(lateTaker), 'И2');

let allPass = startContest('A', seats, 'И1');
allPass = takeCard(allPass, 'И2', 1);
for (const p of ['И3', 'И4', 'И5', 'И1']) allPass = passCard(allPass, p);
check('никто не перехватил — туз остаётся у взявшего вслепую на ×1',
  [nextActor(allPass), contestResult(allPass)], [null, { holderId: 'И2', risk: 1 }]);

section('король и дама (§7.3)');
let k = startContest('K', seats, 'И1');
check('слепого круга нет, первый берущий — от ×2', [k.phase, nextActor(k), riskOptions(k)], ['window', 'И2', [2, 3, 4, 5]]);
k = passCard(k, 'И2');
k = takeCard(k, 'И3', 2);
check('И3 взял короля на ×2, дальше перехват от ×3', [k.holderId, riskOptions(k)], ['И3', [3, 4, 5]]);
for (const p of ['И4', 'И5', 'И1']) k = passCard(k, p);
check('И2 уже спасовал — все остальные тоже, король у И3 на ×2',
  [nextActor(k), contestResult(k)], [null, { holderId: 'И3', risk: 2 }]);
let q = startContest('Q', seats, 'И1');
for (const p of ['И2', 'И3', 'И4', 'И5', 'И1']) q = passCard(q, p);
check('даму не взял никто — обычные торги', contestResult(q), null);

section('6 и 10 (§7.3)');
let six = startContest('6', seats, 'И1');
check('берут за ×1', riskOptions(six), [1]);
six = passCard(six, 'И2');
six = takeCard(six, 'И3', 1);
check('первый взявший — и всё, перехвата нет', [nextActor(six), contestResult(six)], [null, { holderId: 'И3', risk: 1 }]);

section('первый ход в спецраздаче (§10.4)');
check('туз, король, дама — сосед слева от главного', specialLeader('A', seats, 'И3'), 'И2');
check('6 — главный ходит сам', specialLeader('6', seats, 'И3'), 'И3');
check('10 — сосед справа, главный ходит последним', specialLeader('10', seats, 'И3'), 'И4');

section('защита от ошибок');
let guard = startContest('K', seats, 'И1');
let error = '';
try { takeCard(guard, 'И3', 2); } catch (e) { error = String(e); }
check('не в свою очередь — отказ', error.includes('not your turn'), true);
error = '';
try { takeCard(guard, 'И2', 1); } catch (e) { error = String(e); }
check('короля за ×1 взять нельзя', error.includes('not allowed'), true);

section('нет монет на спецкарту — не спрашиваем (§7.4a, решение владельца правил)');
// Кон 1000, дама за ×2 стоит 2000 проигрыша. У И2 и И4 денег меньше — их пропускаем.
const wallet: Record<string, number> = { И1: 5000, И2: 1500, И3: 5000, И4: 900, И5: 5000 };
const afford = (id: string, risk: number) => wallet[id] >= 1000 * risk;
let poor = passUnaffordable(startContest('Q', seats, 'И1'), afford);
check('И2 не хватает на ×2 — сразу пас, спрашиваем И3', [nextActor(poor), poor.passed], ['И3', ['И2']]);
poor = passUnaffordable(passCard(poor, 'И3'), afford);
check('И3 спасовал сам, И4 пропущен — спрашиваем И5', [nextActor(poor), poor.passed], ['И5', ['И2', 'И3', 'И4']]);
poor = passUnaffordable(takeCard(poor, 'И5', 5), afford);
check('×5 — борьба окончена', [nextActor(poor), contestResult(poor)], [null, { holderId: 'И5', risk: 5 }]);
// Перехват: карта у И3 на ×2, дальше нужно ×3 = 3000 — у И4 (2500) уже не хватает.
const wallet2: Record<string, number> = { И1: 9000, И2: 9000, И3: 9000, И4: 2500, И5: 9000 };
let kx = takeCard(startContest('K', seats, 'И1'), 'И2', 2);
kx = passUnaffordable(passCard(kx, 'И3'), (id, r) => wallet2[id] >= 1000 * r);
check('на ×2 хватило бы, на ×3 — нет: И4 пропущен при перехвате', [nextActor(kx), kx.passed], ['И5', ['И3', 'И4']]);
const nobodyRich = passUnaffordable(startContest('A', seats, 'И1'), () => false);
check('не может никто — борьба кончается сразу, карту не взял никто', [nextActor(nobodyRich), contestResult(nobodyRich)], [null, null]);
check('у кого хватает — спрашиваем как обычно', nextActor(passUnaffordable(startContest('K', seats, 'И1'), () => true)), 'И2');
