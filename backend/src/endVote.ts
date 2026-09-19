// Закончить игру по общему согласию (RULES.md §12.3, решение владельца правил).
// Чистые функции: кто может предложить, чем кончилось голосование.

// Сколько ждём ответа. Не ответил — считается «нет», иначе раздача стояла бы вечно.
export const END_VOTE_MS = 30_000;

export type EndVote = {
  proposerId: string;
  yes: string[];
  no: string[];
  startedAt: number;
};

// Предложить можно только между раздачами — раздача сыграна или пересдана, деньги
// посчитаны. Каждый — не больше одного раза, пока не роздана следующая раздача.
export function canProposeEnd(g: {
  stage: string;
  voteActive: boolean;
  proposedIds: string[];
  playerId: string;
}): boolean {
  if (g.stage !== 'round_done' && g.stage !== 'awaiting_deal') return false;
  if (g.voteActive) return false;
  return !g.proposedIds.includes(g.playerId);
}

// Итог: все «да» — заканчиваем; хоть одно «нет» или вышло время — играем дальше.
export function endVoteOutcome(
  vote: EndVote,
  playerIds: string[],
  now: number,
): 'ended' | 'rejected' | 'expired' | 'pending' {
  if (vote.no.length > 0) return 'rejected';
  if (playerIds.every((id) => vote.yes.includes(id))) return 'ended';
  if (now - vote.startedAt >= END_VOTE_MS) return 'expired';
  return 'pending';
}
