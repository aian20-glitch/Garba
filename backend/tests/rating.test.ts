// Проверки rating.ts по RULES.md §16. Запуск всех проверок: npm test

import { check, section } from './check.js';
import {
  afterDeal,
  afterRoom,
  applySkill,
  experience,
  ratingOf,
  shownRating,
  START_SKILL,
  strengthFactor,
  tableFactor,
  type RatingPlayer,
} from '../src/rating.js';

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

section('опыт и шкала (§16.1)');
check('новичок — 4.0', ratingOf(START_SKILL, 0), 4);
check('30 партий — +0.3 опыта', near(experience(30), 0.3), true);
check('200 партий — опыт 2.0, больше не растёт', [experience(200), experience(5_000)], [2, 2]);
check('на экране одна цифра после запятой', shownRating(4.93), 4.9);

section('сила соперника (§16.4)');
check('соперники равны — ×1', strengthFactor(4, [4, 4, 4]), 1);
check('соперники на 2 сильнее — прибавка ×1.4', near(strengthFactor(4, [6, 6]), 1.4), true);
check('не больше ×1.5', strengthFactor(1, [9]), 1.5);
check('не меньше ×0.5', strengthFactor(9, [1]), 0.5);
check('проиграл сильным — теряешь меньше (×0.6)', near(applySkill(4, -0.1, 1.4), 3.94), true);
check('проиграл слабым — теряешь больше (×1.4)', near(applySkill(4, -0.1, 0.6), 3.86), true);

section('чем выше, тем труднее (§16.5)');
check('при 4 прибавка как есть', near(applySkill(4, 0.1, 1), 4.1), true);
check('при 6 — вчетверо меньше', near(applySkill(6, 0.1, 1), 6.025), true);
check('при 7.5 — почти не растёт (×1/64)', near(applySkill(7.5, 0.1, 1), 7.5015625), true);
check('при 2 — растёт быстрее (×2.25)', near(applySkill(2, 0.1, 1), 2.225), true);
check('выше 8 не бывает — к 8 можно только приближаться', applySkill(7.99, 5, 1.5) < 8, true);
check('ниже 0 не бывает', applySkill(0.1, -1, 0.5), 0);

section('размер стола (§16.4a)');
check('4 / 5 / 6 / 7 игроков', [4, 5, 6, 7].map(tableFactor), [1, 1.1, 1.2, 1.3]);
check('выигрыш главным за столом на 7 — ×1.3', near(applySkill(4, 0.05, 1, tableFactor(7)), 4.065), true);

section('после партии (§16.2)');
const four = (skill = 4): RatingPlayer[] =>
  ['m', 'a', 'b', 'c'].map((id) => ({ id, skill, rating: skill }));

let s = afterDeal(four(), [{ id: 'm', won: true, risk: 1, garba: false }], 4);
check('главный выиграл на ×1: +0.05, противникам ничего',
  [near(s.m, 4.05), s.a, s.b, s.c], [true, 4, 4, 4]);

s = afterDeal(four(), [{ id: 'm', won: true, risk: 5, garba: false }], 4);
check('выиграл на ×5: +0.25', near(s.m, 4.25), true);

s = afterDeal(four(), [{ id: 'm', won: false, risk: 1, garba: false }], 4);
check('главный проиграл: −0.03, каждому противнику +0.02',
  [near(s.m, 3.97), near(s.a, 4.02), near(s.c, 4.02)], [true, true, true]);

s = afterDeal(four(), [{ id: 'm', won: false, risk: 3, garba: false }], 4);
check('проиграл на ×3: −0.09', near(s.m, 3.91), true);

s = afterDeal(four(), [{ id: 'm', won: true, risk: 1, garba: true }], 4);
check('ГАРБА: +0.05 и ещё +0.10', near(s.m, 4.15), true);

s = afterDeal(four(), [
  { id: 'm', won: false, risk: 1, garba: false },
  { id: 'a', won: false, risk: 1, garba: false },
], 4);
check('двое РАЗ, оба проиграли: противникам +0.02 за каждого', [Math.abs(s.b - 4.04) < 0.001, near(s.m, 3.97)], [true, true]);

section('после комнаты (§16.3)');
const room = [
  { id: 'w', skill: 4, rating: 4, diff: 900 },
  { id: 'p', skill: 4, rating: 4, diff: 100 },
  { id: 'z', skill: 4, rating: 4, diff: 0 },
  { id: 'l', skill: 4, rating: 4, diff: -300 },
  { id: 'x', skill: 4, rating: 4, diff: -700 },
];
const r = afterRoom(room, ['w'], 5);
check('победитель +0.50 (×1.1 за стол на 5)', near(r.w, 4.55), true);
check('в плюсе +0.20 (×1.1)', near(r.p, 4.22), true);
check('в ноль — без изменений', r.z, 4);
check('в минусе −0.20', near(r.l, 3.8), true);
check('проиграл больше всех −0.40 (вместо −0.20, не вместе)', near(r.x, 3.6), true);

section('ушёл из игры — комната закрылась (§16.3a)');
const left = afterRoom([
  { id: 'a', skill: 4, rating: 4, diff: 50 },
  { id: 'b', skill: 4, rating: 4, diff: 50 },
  { id: 'c', skill: 4, rating: 4, diff: -20 },
  { id: 'q', skill: 4, rating: 4, diff: -80 },
], [], 4, ['q']);
check('ушедший теряет 1.0 — больше, чем за любой проигрыш', near(left.q, 3), true);
check('«проиграл больше всех» считается среди оставшихся: у c −0.40, а не −0.20', near(left.c, 3.6), true);
check('ушедший со слабым мастерством не уходит ниже 0', afterRoom([{ id: 'q', skill: 0.5, rating: 1, diff: -1 }], [], 4, ['q']).q, 0);

section('10 — очень трудно (просьба владельца правил)');
let top = START_SKILL;
let rooms = 0;
while (shownRating(ratingOf(top, 200)) < 9 && rooms < 10_000) { top = afterRoom([{ id: 't', skill: top, rating: 9, diff: 1 }, { id: 'o', skill: 4, rating: 9, diff: -1 }], ['t'], 4).t; rooms++; }
check('до 9.0 — больше 20 комнат подряд, выигранных все', rooms > 20, true);
let rooms10 = rooms;
while (shownRating(ratingOf(top, 200)) < 10 && rooms10 < 100_000) { top = afterRoom([{ id: 't', skill: top, rating: 9, diff: 1 }, { id: 'o', skill: 4, rating: 9, diff: -1 }], ['t'], 4).t; rooms10++; }
check('до 10.0 — сотни комнат подряд, выигранных все', rooms10 > 300, true);
console.log('     (до 9.0: ' + rooms + ' комнат, до 10.0: ' + rooms10 + ')');

section('пример владельца правил: новичок за вечер');
let me = START_SKILL;
me = applySkill(me, 0.05, 1); // выиграл главным
me = applySkill(me, 0.05, 1); // ещё раз
me = applySkill(me, -0.03, 1); // проиграл
for (let i = 0; i < 4; i++) me = applySkill(me, 0.02, 1); // 4 раза отбился
me = applySkill(me, 0.5, 1); // выиграл комнату (стол на 4)
check('30 партий, 2 победы, 1 поражение, 4 раза отбился, победил в комнате: 4.0 → 4.9',
  shownRating(ratingOf(me, 30)), 4.9);
