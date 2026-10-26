// Проверки rating.ts по RULES.md §16 (новая система рейтинга, 26.10.2026). Запуск всех проверок: npm test

import { check, section } from './check.js';
import {
  applyLeave,
  calculateHandDifficulty,
  dayExperience,
  dealDeltas,
  experienceOf,
  HAND,
  isActiveDay,
  leavePenalty,
  longestStreak,
  masteryStability,
  ratingOf,
  ratingRiskMultiplier,
  roomTimeMultiplier,
  settleRoom,
  shownRating,
  START_SKILL,
  streakBonus,
  strengthFactor,
  tableFactor,
  type ActivityDay,
  type RatingPlayer,
} from '../src/rating.js';
import { createAccount, openDb } from '../src/accounts.js';
import { playerExperience, ratedPlayers, writeRoom } from '../src/roomDb.js';

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const MIN = 60_000;
const c = (suit: string, rank: string) => ({ suit, rank });

section('шкала (§16)');
check('новичок: мастерство 4.0, опыт 0 — рейтинг 4.0', ratingOf(START_SKILL, 0), 4);
check('на экране одна цифра после запятой', shownRating(4.93), 4.9);

section('время игры (§16.3b)');
check('меньше 10 минут — ×0.20', [roomTimeMultiplier(0), roomTimeMultiplier(9.9 * MIN)], [0.2, 0.2]);
check('10–19 — ×0.45, 20–29 — ×0.70, 30–39 — ×0.85',
  [roomTimeMultiplier(10 * MIN), roomTimeMultiplier(19 * MIN), roomTimeMultiplier(25 * MIN), roomTimeMultiplier(35 * MIN)],
  [0.45, 0.45, 0.7, 0.85]);
check('40–59 — ×1.00, 60–89 — ×1.05, 90+ — ×1.10',
  [roomTimeMultiplier(40 * MIN), roomTimeMultiplier(75 * MIN), roomTimeMultiplier(200 * MIN)], [1, 1.05, 1.1]);

section('риск в рейтинге (§16.2b)');
check('×1…×5 → 1.00 / 1.10 / 1.20 / 1.30 / 1.40', [1, 2, 3, 4, 5].map(ratingRiskMultiplier), [1, 1.1, 1.2, 1.3, 1.4]);

section('чем выше, тем стабильнее (§16.5)');
check('мастерство 4 → ×1.00, 6 → ×0.50, 7 → ×0.25, 8 → ×0.25',
  [4, 6, 7, 8].map(masteryStability), [1, 0.5, 0.25, 0.25]);
check('внизу не больше ×1.50', [masteryStability(2), masteryStability(0)], [1.5, 1.5]);

section('сила соперника (§16.4)');
check('соперники равны — ×1', strengthFactor(4, [4, 4, 4]), 1);
check('соперники на 2 сильнее — ×1.4', near(strengthFactor(4, [6, 6]), 1.4), true);
check('не больше ×1.5, не меньше ×0.5', [strengthFactor(1, [9]), strengthFactor(9, [1])], [1.5, 0.5]);

section('сила руки главного (§16.2a)');
check('ГАРБА — дама, король и туз козыря',
  calculateHandDifficulty([c('hearts', 'Q'), c('hearts', 'K'), c('hearts', 'A'), c('clubs', '7'), c('spades', '8')], 'hearts', 4), HAND.GARBA);
check('один мелкий козырь и мусор — очень слабая',
  calculateHandDifficulty([c('hearts', '7'), c('clubs', 'J'), c('spades', '8'), c('diamonds', '9'), c('clubs', '6')], 'hearts', 4), HAND.VERY_WEAK);
check('туз и король козыря — слабая (2 взятки, третью ещё надо взять)',
  calculateHandDifficulty([c('hearts', 'A'), c('hearts', 'K'), c('spades', '8'), c('diamonds', '9'), c('clubs', '6')], 'hearts', 4), HAND.WEAK);
check('туз, король, валет козыря — обычная',
  calculateHandDifficulty([c('hearts', 'A'), c('hearts', 'K'), c('hearts', 'J'), c('diamonds', '9'), c('clubs', '6')], 'hearts', 4), HAND.NORMAL);
check('туз, король, валет, десятка козыря — сильная',
  calculateHandDifficulty([c('hearts', 'A'), c('hearts', 'K'), c('hearts', 'J'), c('hearts', '10'), c('clubs', '6')], 'hearts', 4), HAND.STRONG);
check('пять козырей без дамы — очень сильная',
  calculateHandDifficulty([c('hearts', 'A'), c('hearts', 'K'), c('hearts', 'J'), c('hearts', '10'), c('hearts', '9')], 'hearts', 4), HAND.VERY_STRONG);
const sideAces = [c('hearts', 'A'), c('hearts', 'J'), c('clubs', 'A'), c('spades', 'A'), c('diamonds', '6')];
check('чужие тузы за большим столом стоят меньше: на 4 — сильная, на 7 — обычная',
  [calculateHandDifficulty(sideAces, 'hearts', 4), calculateHandDifficulty(sideAces, 'hearts', 7)], [HAND.STRONG, HAND.NORMAL]);

section('после партии (§16.2, §16.7)');
const four = (skill = 4): RatingPlayer[] => ['m', 'a', 'b', 'c'].map((id) => ({ id, skill, rating: skill }));

let d = dealDeltas(four(), [{ id: 'm', won: true, risk: 1 }], 4);
check('главный выиграл, обычная рука, ×1: +0.05, противникам 0', [near(d.m, 0.05), d.a, d.b, d.c], [true, 0, 0, 0]);

d = dealDeltas(four(), [{ id: 'm', won: false, risk: 1 }], 4);
check('главный проиграл: −0.03, каждому противнику +0.02',
  [near(d.m, -0.03), near(d.a, 0.02), near(d.c, 0.02)], [true, true, true]);

d = dealDeltas(four(), [{ id: 'm', won: true, risk: 5 }], 4);
check('выиграл на ×5: +0.05 × 1.4 = +0.07 (не ×5)', near(d.m, 0.07), true);

d = dealDeltas(four(), [{ id: 'm', won: true, risk: 1, handDifficulty: HAND.VERY_WEAK }], 4);
check('выиграл со слабой рукой: ×1.30 — +0.065', near(d.m, 0.065), true);
d = dealDeltas(four(), [{ id: 'm', won: true, risk: 1, handDifficulty: HAND.GARBA }], 4);
check('ГАРБА: ×0.60 — +0.03, отдельной прибавки нет', near(d.m, 0.03), true);

d = dealDeltas(four(), [{ id: 'm', won: false, risk: 1, handDifficulty: HAND.VERY_WEAK }], 4);
check('проиграл со слабой рукой: ×(2 − 1.30) — −0.021', near(d.m, -0.021), true);
d = dealDeltas(four(), [{ id: 'm', won: false, risk: 1, handDifficulty: HAND.VERY_STRONG }], 4);
check('проиграл с очень сильной: ×(2 − 0.70) — −0.039, противникам по +0.026',
  [near(d.m, -0.039), near(d.a, 0.026)], [true, true]);

d = dealDeltas(four(), [{ id: 'm', won: true, risk: 1 }], 7);
check('за столом на 7 выигрыш главным — ×1.3 (§16.4a)', near(d.m, 0.065), true);
check('размер стола: 4 / 5 / 6 / 7', [4, 5, 6, 7].map(tableFactor), [1, 1.1, 1.2, 1.3]);

d = dealDeltas(['m', 'a', 'b', 'c'].map((id) => ({ id, skill: 6, rating: 6 })), [{ id: 'm', won: false, risk: 1 }], 4);
check('при мастерстве 6 и потеря вдвое меньше: −0.015', near(d.m, -0.015), true);

d = dealDeltas([
  { id: 'm', skill: 4, rating: 4 },
  { id: 'a', skill: 6, rating: 6 },
  { id: 'b', skill: 6, rating: 6 },
  { id: 'c', skill: 6, rating: 6 },
], [{ id: 'm', won: false, risk: 1 }], 4);
check('проиграл соперникам на 2 сильнее: потеря × (2 − 1.4) — −0.018', near(d.m, -0.018), true);

d = dealDeltas(four(), [{ id: 'm', won: false, risk: 1 }, { id: 'a', won: false, risk: 1 }], 4);
check('двое РАЗ, оба проиграли: противникам +0.02 за каждого', [near(d.b, 0.04), near(d.m, -0.03)], [true, true]);

section('итог комнаты (§16.3b)');
check('40 минут: накопленное +0.2 — как есть', near(settleRoom(4, 0.2, 40 * MIN), 4.2), true);
check('5 минут: +0.2 × 0.20 — всего +0.04', near(settleRoom(4, 0.2, 5 * MIN), 4.04), true);
check('потеря за комнату — не больше 0.25', near(settleRoom(4, -0.6, 90 * MIN), 3.75), true);
check('выше 8 и ниже 0 не бывает', [settleRoom(7.95, 1, 90 * MIN), settleRoom(0.1, -0.2, 90 * MIN)], [8, 0]);

section('ушёл из игры (§16.3a)');
check('2 минуты, накопил −0.6 (×0.20 → −0.12), потом ушёл: ещё −1.0 мимо лимита и времени — 4.0 → 2.88',
  near(applyLeave(settleRoom(4, -0.6, 2 * MIN), leavePenalty(false)), 2.88), true);
check('за столом все на месте — уход стоит −1.0; место уже пустует — без штрафа', [leavePenalty(false), leavePenalty(true)], [-1, 0]);
check('ниже 0 не уходит', applyLeave(0.5, -1), 0);

section('опыт (§16.1)');
const day = (dayStr: string, minutes: number, deals: number): ActivityDay => ({ day: dayStr, ms: minutes * MIN, deals });
check('активный день — 20 минут и 5 партий', [isActiveDay(day('2026-10-26', 20, 5)), isActiveDay(day('2026-10-26', 19, 30)), isActiveDay(day('2026-10-26', 60, 4))], [true, false, false]);
check('просто зашёл — 0', dayExperience(day('2026-10-26', 10, 2)), 0);
check('25 минут — +0.005 за день', dayExperience(day('2026-10-26', 25, 8)), 0.005);
check('1 час — +0.005 и +0.02 за два раза по 30 минут', near(dayExperience(day('2026-10-26', 60, 20)), 0.025), true);
check('за время — не больше +0.04 за сутки', near(dayExperience(day('2026-10-26', 600, 200)), 0.045), true);
check('серия считается по дням подряд', longestStreak(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05', '2026-10-06']), 3);
check('серия: 10 → 0.05, 20 → 0.15, 30 → 0.30, 60 → 0.40, 90 → 0.50 (берётся высший)',
  [9, 10, 20, 30, 60, 90, 400].map(streakBonus), [0, 0.05, 0.15, 0.3, 0.4, 0.5, 0.5]);
const days = (n: number, minutes: number) =>
  Array.from({ length: n }, (_, i) => day(new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10), minutes, 20));
check('10 дней подряд по часу: 10 × 0.025 + 0.05 = 0.30', near(experienceOf(0, days(10, 60)), 0.3), true);
check('старый опыт сохраняется, всё вместе — не больше 2', [near(experienceOf(1.5, days(10, 60)), 1.8), experienceOf(1.9, days(30, 60))], [true, 2]);

section('цель системы (§16): быстрый крупный выигрыш почти не даёт рейтинга');
// Зашёл на 8 минут, взял спецкарту за ×5 и выиграл дважды.
let pending = 0;
for (let i = 0; i < 2; i++) pending += dealDeltas(four(), [{ id: 'm', won: true, risk: 5 }], 4).m;
const lucky = settleRoom(START_SKILL, pending, 8 * MIN);
check('8 минут, два выигрыша на ×5: рейтинг 4.0 → 4.0 (+0.03)', [shownRating(lucky), near(lucky - 4, 0.028)], [4, true]);

section('цель системы: одна проигранная комната не уничтожает дни хорошей игры');
let pendingBad = 0;
for (let i = 0; i < 8; i++) pendingBad += dealDeltas(four(), [{ id: 'm', won: false, risk: 3, handDifficulty: HAND.VERY_STRONG }], 4).m;
check('8 поражений главным с сильной рукой на ×3 за 2 часа — всего −0.25', near(settleRoom(4, pendingBad, 120 * MIN) - 4, -0.25), true);

section('цель системы: кто играет часами и долго — постепенно 8–10');
// Каждый день — 1,5 часа за столом на 5 (комната 90 минут, 30 партий): 3 раза выиграл
// главным с обычной рукой на ×1, 2 раза проиграл, 4 раза отбился. Соперники равны.
let skill = START_SKILL;
const history: ActivityDay[] = [];
let dayN = 0;
const ratingNow = () => ratingOf(skill, experienceOf(0, history));
const until = (target: number) => {
  while (shownRating(ratingNow()) < target && dayN < 5000) {
    const p = (s: number): RatingPlayer[] => ['m', 'a', 'b', 'c', 'e'].map((id) => ({ id, skill: s, rating: s }));
    let room = 0;
    for (let i = 0; i < 3; i++) room += dealDeltas(p(skill), [{ id: 'm', won: true, risk: 1 }], 5).m;
    for (let i = 0; i < 2; i++) room += dealDeltas(p(skill), [{ id: 'm', won: false, risk: 1 }], 5).m;
    for (let i = 0; i < 4; i++) room += dealDeltas(p(skill), [{ id: 'a', won: false, risk: 1 }], 5).m;
    skill = settleRoom(skill, room, 90 * MIN);
    history.push(day(new Date(Date.UTC(2026, 0, 1) + dayN * 86_400_000).toISOString().slice(0, 10), 90, 30));
    dayN++;
  }
  return dayN;
};
const to8 = until(8);
check('до 8.0 — несколько недель ежедневной хорошей игры', to8 > 21 && to8 < 120, true);
const to9 = until(9);
check('до 9.0 — больше месяца каждый день', to9 > 30, true);
console.log('     (до 8.0: ' + to8 + ' дней, до 9.0: ' + to9 + ' дней)');

section('опыт — из комнат в базу (§16.1)');
{
  const db = openDb(':memory:');
  const a = createAccount(db, 'Серик').account;
  const sixty = { ms: 60 * MIN, deals: 20 };
  writeRoom(db, { id: '11111', status: 'finished', players: [{ id: a.id, balance: 30_000 }], activity: { [a.id]: { '2026-10-25': { ms: 10 * MIN, deals: 3 } } } });
  writeRoom(db, { id: '22222', status: 'started', players: [{ id: a.id, balance: 30_000 }], activity: { [a.id]: { '2026-10-25': { ms: 15 * MIN, deals: 4 } } } });
  check('день складывается по двум комнатам: 25 минут и 7 партий — +0.005', near(playerExperience(db, a.id), 0.005), true);
  check('свежие цифры комнаты из памяти заменяют её старую запись',
    near(playerExperience(db, a.id, { id: '22222', activity: { [a.id]: { '2026-10-25': sixty } } }), 0.025), true);
  writeRoom(db, { id: '33333', status: 'started', practice: true, players: [{ id: a.id, balance: 30_000 }], activity: { [a.id]: { '2026-10-26': sixty } } });
  check('тренировка с ботами в опыт не идёт', near(playerExperience(db, a.id), 0.005), true);
  check('в общем рейтинге — тот же опыт', near(ratedPlayers(db).find((p) => p.id === a.id)!.rating, 4.005), true);
}
