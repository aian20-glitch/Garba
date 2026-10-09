// Проверки shrinkVote.ts: игрок ушёл — играть дальше без него или закрыть (RULES.md §13c).
// Запуск: npm test

import { check, section } from './check.js';
import {
  canKeepPlaying,
  dealerAfterLeave,
  renumberSeats,
  shrinkVoteOutcome,
  SHRINK_VOTE_MS,
} from '../src/shrinkVote.js';

section('когда спрашиваем «играть дальше» (§13c)');
check('было 5, ушёл один — осталось 4: спрашиваем', canKeepPlaying(4, 4), true);
check('было 7, осталось 6 — спрашиваем', canKeepPlaying(6, 6), true);
check('было 4, осталось 3 — втроём нельзя, игра заканчивается', canKeepPlaying(3, 3), false);
check('остались одни боты — игра заканчивается', canKeepPlaying(4, 0), false);

section('итог — только если все согласны (§13c)');
const left = ['Серик', 'Айдар', 'Дана', 'Ержан'];
const t0 = 1_000_000;
const vote = (yes: string[]) => ({ leftName: 'Асель', yes, startedAt: t0 });
check('все «продолжаем» — играем вчетвером', shrinkVoteOutcome(vote(left), left, t0 + 5_000), 'continue');
check('ещё не все ответили — ждём', shrinkVoteOutcome(vote(['Серик', 'Айдар']), left, t0 + 5_000), 'pending');
check('30 секунд без ответа — молчание = «закрыть»', shrinkVoteOutcome(vote(['Серик', 'Айдар', 'Дана']), left, t0 + SHRINK_VOTE_MS), 'close');
check('ждём 30 секунд', SHRINK_VOTE_MS, 30_000);

section('стол стал меньше — места и раздающий');
check('ушёл с места 2 из 0…4 — места 0,1,3,4 становятся 0,1,2,3', renumberSeats([0, 1, 3, 4]), [0, 1, 2, 3]);
const seats = ['Серик', 'Айдар', 'Асель', 'Дана', 'Ержан'];
check('раздавать должна была Асель, она ушла — раздаёт Дана (сосед справа)', dealerAfterLeave(seats, 'Асель', 'Асель'), 'Дана');
check('ушёл последний по кругу — раздаёт первый', dealerAfterLeave(seats, 'Ержан', 'Ержан'), 'Серик');
check('ушёл не раздающий — раздающий тот же', dealerAfterLeave(seats, 'Дана', 'Асель'), 'Дана');
