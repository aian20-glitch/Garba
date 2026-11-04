// Проверки shah/rating.ts — рейтинг ШАХ (SHAH_RULES.md §19, этап 4, 05.11.2026).
// Числа — вопрос 22 «а» (SHAH_PLAN.md): ответа владельца ещё нет, поменяется — меняем и примеры.

import { check, section } from './check.js';
import {
  formatFactor,
  matchBase,
  matchRatingDeltas,
  partyBase,
  partyDeltas,
  settleShah,
  shahDelta,
  shahTimeMultiplier,
  SHAH_START_SKILL,
  type ShahRated,
} from '../src/shah/rating.js';

const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
const round = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r4(v)]));
const MIN = 60_000;
const table = (n: number, skill = 4): ShahRated[] => Array.from({ length: n }, (_, seat) => ({ id: `p${seat}`, seat, skill }));

section('ШАХ рейтинг: база за партию и за матч');
check('новый игрок — 4.0, как в Гарбе', SHAH_START_SKILL, 4);
check('без штрафа +0.03', partyBase(0, 1, false), 0.03);
check('−2 → −0.01', partyBase(-2, 1, false), -0.01);
check('−4 → −0.02', partyBase(-4, 1, false), -0.02);
check('−12 → −0.04', partyBase(-12, 1, false), -0.04);
check('ничья — 0', partyBase(0, 1, true), 0);
check('после ничьей ×2: −8 считается как −4, −24 как −12, −4 как −2', [partyBase(-8, 2, false), partyBase(-24, 2, false), partyBase(-4, 2, false)], [-0.02, -0.04, -0.01]);
check('после ничьей ×2 без штрафа — всё равно +0.03', partyBase(0, 2, false), 0.03);
check('матч: победа +0.10, поражение −0.06', [matchBase('win'), matchBase('lose')], [0.1, -0.06]);
check('матч: «ни то ни другое» и ничья — 0', [matchBase('none'), matchBase('draw')], [0, 0]);

section('ШАХ рейтинг: формат — командная игра дороже');
check('1×1 ×0.8 · 1×1×1 ×1.0 · 2×2 ×1.2 · 3×3 ×1.4', [formatFactor(2), formatFactor(3), formatFactor(4), formatFactor(6)], [0.8, 1, 1.2, 1.4]);
check(
  '1×1, равные: выиграл партию +0.024, проиграл с −4 −0.016',
  round(partyDeltas(2, table(2), { penalties: [0, -4], multiplier: 1, draw: false })),
  { p0: 0.024, p1: -0.016 },
);
check(
  '1×1×1, 10:50:60 (−4 / 0 / 0): −0.02, +0.03, +0.03',
  round(partyDeltas(3, table(3), { penalties: [-4, 0, 0], multiplier: 1, draw: false })),
  { p0: -0.02, p1: 0.03, p2: 0.03 },
);
check(
  '2×2, 120:0: напарники одинаково — +0.036 и −0.048',
  round(partyDeltas(4, table(4), { penalties: [0, -12], multiplier: 1, draw: false })),
  { p0: 0.036, p1: -0.048, p2: 0.036, p3: -0.048 },
);
check(
  '3×3, 75:45 (−2): +0.042 и −0.014',
  round(partyDeltas(6, table(6), { penalties: [0, -2], multiplier: 1, draw: false })),
  { p0: 0.042, p1: -0.014, p2: 0.042, p3: -0.014, p4: 0.042, p5: -0.014 },
);
check(
  'ничья 60:60 — никому ничего',
  round(partyDeltas(2, table(2), { penalties: [0, 0], multiplier: 1, draw: true })),
  { p0: 0, p1: 0 },
);
check(
  '2×2: выигранный матч +0.12 обоим, проигранный −0.072 обоим',
  round(matchRatingDeltas(4, table(4), { p0: 'win', p1: 'lose', p2: 'win', p3: 'lose' })),
  { p0: 0.12, p1: -0.072, p2: 0.12, p3: -0.072 },
);
check(
  '1×1×1, вариант «б» вопроса 16: средний — 0',
  round(matchRatingDeltas(3, table(3), { p0: 'win', p1: 'none', p2: 'lose' })),
  { p0: 0.1, p1: 0, p2: -0.06 },
);
check(
  'время вышло при равном счёте — ничья, матч рейтинг не меняет',
  round(matchRatingDeltas(2, table(2), { p0: 'draw', p1: 'draw' })),
  { p0: 0, p1: 0 },
);

section('ШАХ рейтинг: сила соперника и стабильность — как в Гарбе');
check('обыграл сильнее себя (4 против 6): ×1.4 → +0.0336', r4(shahDelta(0.03, { id: 'a', seat: 0, skill: 4 }, [6], 2)), 0.0336);
check('проиграл сильному (4 против 6): ×(2 − 1.4) → −0.0096', r4(shahDelta(-0.02, { id: 'a', seat: 0, skill: 4 }, [6], 2)), -0.0096);
check('проиграл слабому (6 против 4): ×1.4, стабильность при 6 — ×0.5 → −0.0112', r4(shahDelta(-0.02, { id: 'a', seat: 0, skill: 6 }, [4], 2)), -0.0112);
check('7 и выше — стабильность ×0.25', r4(shahDelta(0.1, { id: 'a', seat: 0, skill: 7.5 }, [7.5], 6)), 0.035);
check(
  '2×2: соперники — другая команда (средний рейтинг 6 → k 1.4)',
  round(partyDeltas(4, [
    { id: 'a', seat: 0, skill: 4 },
    { id: 'b', seat: 1, skill: 6 },
    { id: 'c', seat: 2, skill: 4 },
    { id: 'd', seat: 3, skill: 6 },
  ], { penalties: [0, -4], multiplier: 1, draw: false })),
  { a: 0.0504, b: -0.0168, c: 0.0504, d: -0.0168 },
);

section('ШАХ рейтинг: время за столом');
check('до 10 минут — 0', [shahTimeMultiplier(0), shahTimeMultiplier(9.9 * MIN)], [0, 0]);
check('10 минут ×0.3, 19 — ещё ×0.3', [shahTimeMultiplier(10 * MIN), shahTimeMultiplier(19 * MIN)], [0.3, 0.3]);
check('20 ×0.5, 30 ×0.7, 44 — ещё ×0.7', [shahTimeMultiplier(20 * MIN), shahTimeMultiplier(30 * MIN), shahTimeMultiplier(44 * MIN)], [0.5, 0.7, 0.7]);
check('45 ×0.85, 59 — ещё ×0.85', [shahTimeMultiplier(45 * MIN), shahTimeMultiplier(59 * MIN)], [0.85, 0.85]);
check('максимум — с часа: 60 и 180 минут ×1.0', [shahTimeMultiplier(60 * MIN), shahTimeMultiplier(180 * MIN)], [1, 1]);
check('«минута» для проверок короче', shahTimeMultiplier(1_000, 10), 1);

section('ШАХ рейтинг: итог стола');
check('+0.5 за час — 4.5', r4(settleShah(4, 0.5, 60 * MIN)), 4.5);
check('+0.5 за 15 минут — только ×0.3: 4.15', r4(settleShah(4, 0.5, 15 * MIN)), 4.15);
check('8 минут — рейтинга нет', settleShah(4, 0.5, 8 * MIN), 4);
check('−1.0 за час — не больше −0.25: 3.75', r4(settleShah(4, -1, 60 * MIN)), 3.75);
check('−0.2 за 30 минут — −0.14: 3.86', r4(settleShah(4, -0.2, 30 * MIN)), 3.86);
check('выше 8 не бывает', settleShah(7.9, 5, 60 * MIN), 8);
check('ниже 0 не бывает', settleShah(0.1, -0.25, 60 * MIN), 0);

// Пример для владельца: час игры, равные соперники, 5 партий без штрафа, 2 проиграны с −4, матч выигран.
// Одна и та же игра в команде стоит больше, чем одному (1×1 < 1×1×1 < 2×2 < 3×3).
function hour(format: 2 | 3 | 4 | 6): number {
  const players = table(format);
  const lose = format === 3 ? [-4, 0, 0] : [-4, 0];
  const win = format === 3 ? [0, -4, -4] : [0, -4];
  let pending = 0;
  for (let i = 0; i < 5; i++) pending += partyDeltas(format, players, { penalties: win, multiplier: 1, draw: false }).p0;
  for (let i = 0; i < 2; i++) pending += partyDeltas(format, players, { penalties: lose, multiplier: 1, draw: false }).p0;
  const outcomes = Object.fromEntries(players.map((p) => [p.id, p.seat === 0 || (format !== 3 && p.seat % 2 === 0) ? 'win' : 'lose']));
  pending += matchRatingDeltas(format, players, outcomes).p0;
  return r4(settleShah(4, pending, 60 * MIN));
}
check('час, 5 партий без штрафа, 2 с −4, матч выигран: 1×1 4.168, 1×1×1 4.21, 2×2 4.252, 3×3 4.294', [hour(2), hour(3), hour(4), hour(6)], [4.168, 4.21, 4.252, 4.294]);
