// Проверки shah/score.ts — штрафы, ничья ×2, конец матча (SHAH_RULES.md §14–§16).
// Примеры — из задания владельца 04.11.2026.

import { check, section } from './check.js';
import { matchResult, nextMultiplier, partyOutcome, penaltyThree, penaltyTwoSides } from '../src/shah/score.js';
import { throws } from './shah-helpers.js';

section('ШАХ: штрафы при 2, 4 и 6 игроках');
check('120:0 → проигравшим −12', partyOutcome([120, 0], 1), { draw: false, penalties: [0, -12] });
check('100:20 → проигравшим −4', partyOutcome([100, 20], 1).penalties, [0, -4]);
check('75:45 → проигравшим −2', partyOutcome([75, 45], 1).penalties, [0, -2]);
check('20:100 — штраф первой стороне', partyOutcome([20, 100], 1).penalties, [-4, 0]);
check('1 очко → −4', penaltyTwoSides(1), -4);
check('40 очков → −4', penaltyTwoSides(40), -4);
check('41 очко → −2', penaltyTwoSides(41), -2);
check('59 очков → −2', penaltyTwoSides(59), -2);
check('0 очков (даже со взятыми картами) → −12', penaltyTwoSides(0), -12);
check('60:60 — ничья, штрафа нет', partyOutcome([60, 60], 1), { draw: true, penalties: [0, 0] });
check('после ничьей ×2: 100:20 → −8', partyOutcome([100, 20], 2).penalties, [0, -8]);
check('после ничьей ×2: 120:0 → −24', partyOutcome([120, 0], 2).penalties, [0, -24]);
check('очки не сходятся со 120 — ошибка', throws(() => partyOutcome([60, 50], 1)), true);

section('ШАХ: штрафы при 3 игроках');
check('10:50:60 → −4 / 0 / 0', partyOutcome([10, 50, 60], 1).penalties, [-4, 0, 0]);
check('20:40:60 → −4 / −2 / 0', partyOutcome([20, 40, 60], 1).penalties, [-4, -2, 0]);
check('30:40:50 → −2 / −2 / 0', partyOutcome([30, 40, 50], 1).penalties, [-2, -2, 0]);
check('0:60:60 → −12 / 0 / 0', partyOutcome([0, 60, 60], 1).penalties, [-12, 0, 0]);
check('40:40:40 — ничья', partyOutcome([40, 40, 40], 1), { draw: true, penalties: [0, 0, 0] });
check('карты взяты, но все по 0 очков → −12', penaltyThree(0), -12);
check('20 → −4, 21 → −2', [penaltyThree(20), penaltyThree(21)], [-4, -2]);
check('40 → −2, 41 → 0', [penaltyThree(40), penaltyThree(41)], [-2, 0]);
check('после ничьей ×2: 20:40:60 → −8 / −4 / 0', partyOutcome([20, 40, 60], 2).penalties, [-8, -4, 0]);

section('ШАХ: множитель после ничьей');
check('ничья → следующая партия ×2', nextMultiplier(1, true, 'fixed'), 2);
check('результативная партия после ничьей — снова ×1', nextMultiplier(2, false, 'fixed'), 1);
check('две ничьи подряд, вариант «а» — всё равно ×2', nextMultiplier(2, true, 'fixed'), 2);
check('две ничьи подряд, вариант «б» — ×4', nextMultiplier(2, true, 'stacking'), 4);
check('три ничьи подряд, вариант «б» — ×8', nextMultiplier(4, true, 'stacking'), 8);

section('ШАХ: конец матча (−24 и ниже)');
check('было −22, получил −4 → −26: проиграл сразу', matchResult([-22 - 4, -10], 'both'), ['lose', 'win']);
check('−23 — играем дальше', matchResult([-23, -20], 'both'), null);
check('ровно −24 — проиграл', matchResult([0, -24], 'both'), ['win', 'lose']);
check('3 игрока, «а»: один дошёл — двое других выиграли', matchResult([-24, -10, -2], 'both'), ['lose', 'win', 'win']);
check('3 игрока, «а»: двое сразу — оба проиграли', matchResult([-26, -24, -10], 'both'), ['lose', 'lose', 'win']);
check('3 игрока, «б»: выиграл тот, у кого меньше штрафов', matchResult([-24, -10, -2], 'best'), ['lose', 'none', 'win']);
check('3 игрока, «б»: двое сразу — проиграл тот, у кого больше', matchResult([-26, -24, -10], 'best'), ['lose', 'none', 'win']);
check('3 игрока, «б»: двое сразу поровну — оба', matchResult([-24, -24, -10], 'best'), ['lose', 'lose', 'win']);
