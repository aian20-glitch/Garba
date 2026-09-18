// Проверки vote.ts. Запуск всех проверок: npm test

import { check, section } from './check.js';
import { dealsUntilNextVote, tallyVote, type VoteChoice } from '../src/vote.js';


const C: VoteChoice = 'continue';
const S: VoteChoice = 'split';

section('4 игрока');
check('3 за «делим» — делим', tallyVote([S, S, S], 4), 'split');
check('2 : 2 — ничья, продолжаем', tallyVote([S, S, C, C], 4), 'continue');
check('2 за «продолжаем» — уже ясно, что минимум ничья → продолжаем', tallyVote([C, C], 4), 'continue');
check('2 за «делим» из 4 — ещё не решено', tallyVote([S, S], 4), 'pending');
check('1 : 1 — ещё не решено', tallyVote([S, C], 4), 'pending');

section('5 игроков');
check('3 за «делим» — делим', tallyVote([S, S, S], 5), 'split');
check('3 за «продолжаем» — продолжаем', tallyVote([C, C, C], 5), 'continue');
check('2 : 2 — ждём пятого', tallyVote([S, S, C, C], 5), 'pending');
check('пятый за «делим» — 3 : 2, делим', tallyVote([S, S, C, C, S], 5), 'split');

section('перебор всех раскладов голосов, 4–7 игроков');
let wrong = 0;
for (let n = 4; n <= 7; n++) {
  for (let mask = 0; mask < 1 << n; mask++) {
    const votes: VoteChoice[] = Array.from({ length: n }, (_, i) => ((mask >> i) & 1 ? S : C));
    const splits = votes.filter((v) => v === S).length;
    const expected = splits > n - splits ? 'split' : 'continue'; // большинство, ничья → продолжаем
    if (tallyVote(votes, n) !== expected) wrong++;
    // Ранний итог не должен противоречить полному: если по части голосов уже
    // объявлено решение, полный подсчёт обязан дать то же самое.
    for (let k = 1; k < n; k++) {
      const early = tallyVote(votes.slice(0, k), n);
      if (early !== 'pending' && early !== expected) wrong++;
    }
  }
}
check('все расклады: большинство решает, ничья = продолжаем, ранний итог никогда не ошибается', wrong, 0);

section('повторное голосование через круг');
check('решения «продолжаем» не было — спрашиваем сразу', dealsUntilNextVote(null, 5), 0);
check('только что решили продолжать, 5 игроков — ждать 5 раздач', dealsUntilNextVote(0, 5), 5);
check('прошло 3 раздачи из 5 — ждать ещё 2', dealsUntilNextVote(3, 5), 2);
check('прошёл круг — можно спрашивать', dealsUntilNextVote(5, 5), 0);

// Прогон, как в игре: после «продолжаем» каждая раздача +1, голосуем после конца раздачи.
for (const n of [4, 5, 6, 7]) {
  let since: number | null = 0;
  let votedAfterDeal = -1;
  for (let deal = 1; deal <= 20 && votedAfterDeal < 0; deal++) {
    if (since !== null) since += 1;               // раздали карты
    if (dealsUntilNextVote(since, n) === 0) votedAfterDeal = deal; // раздача сыграна — проверка
  }
  check(`${n} игроков: снова голосуем ровно после ${n}-й раздачи`, votedAfterDeal, n);
}

