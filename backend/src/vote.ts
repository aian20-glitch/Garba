// Голосование «продолжаем или делим кон», когда кон не по карману никому.
// Только чистые функции. Правила — RULES.md §12.2.

export type VoteChoice = 'continue' | 'split';

// Решили продолжать — снова спрашиваем не раньше чем через круг: каждый игрок
// по разу побыл раздающим (RULES.md §12.2).
// dealsSinceContinue — сколько раздач прошло после решения «продолжаем»;
// null — такого решения ещё не было, спрашивать можно сразу.
export function dealsUntilNextVote(
  dealsSinceContinue: number | null,
  playerCount: number,
): number {
  if (dealsSinceContinue === null) return 0;
  return Math.max(0, playerCount - dealsSinceContinue);
}

// Итог голосования. Делим, только если согласны все; хоть один против — продолжаем
// (RULES.md §12.2): у игрока есть шанс выиграть на КОНЕ и потом сказать ДВА.
// Итог объявляется, как только его уже нельзя изменить: первый же голос
// «продолжаем» решает всё, а «делим» — только когда так проголосовали все.
export function tallyVote(
  votes: VoteChoice[],
  playerCount: number,
): VoteChoice | 'pending' {
  if (votes.includes('continue')) return 'continue';
  if (votes.length >= playerCount) return 'split';
  return 'pending';
}
