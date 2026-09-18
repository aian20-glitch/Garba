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

// Итог голосования. Решает большинство, при ничьей — продолжаем.
// Итог объявляется, как только его уже нельзя изменить оставшимися голосами:
// большинство за «делим» набрано, или «продолжаем» набрало половину (тогда в
// худшем случае ничья, а ничья — это тоже «продолжаем»).
export function tallyVote(
  votes: VoteChoice[],
  playerCount: number,
): VoteChoice | 'pending' {
  const split = votes.filter((v) => v === 'split').length;
  const cont = votes.filter((v) => v === 'continue').length;

  if (split * 2 > playerCount) return 'split';
  if (cont * 2 >= playerCount) return 'continue';
  return 'pending';
}
