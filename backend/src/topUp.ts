// Докупить монеты из кошелька за столом (RULES.md §9.1c, решение владельца, 22.10.2026).
// Игрок просит перенести часть запаса (то, что он не взял за стол) на стол. Нужно согласие
// всех остальных за столом: хоть одно «против» — докупки нет. Чистые функции; голосование,
// деньги и рассылка — в index.ts.

// Сколько ждём ответа. Не ответил — не согласился: докупки нет, игра не стоит.
export const TOP_UP_VOTE_MS = 30_000;

// Просить можно только между раздачами — как предлагать закончить игру (§12.3):
// раздача сыграна или пересдана, следующая ещё не роздана. Посреди раздачи сумма за столом
// не меняется. До первой раздачи — тоже нет: только что сам выбрал, сколько взять за стол.
export const TOP_UP_STAGES = ['round_done', 'awaiting_deal'];

export type TopUpVote = {
  requesterId: string;
  amount: number;
  yes: string[];
  no: string[];
  startedAt: number;
};

// Можно ли попросить сейчас: между раздачами, другого голосования нет, в кошельке есть монеты,
// и этот игрок между этими раздачами ещё не просил (иначе просьбами можно держать стол).
export function canRequestTopUp(g: {
  stage: string;
  voteActive: boolean;
  requestedIds: string[];
  playerId: string;
  reserve: number;
}): boolean {
  if (!TOP_UP_STAGES.includes(g.stage)) return false;
  if (g.voteActive) return false;
  if (g.reserve <= 0) return false;
  return !g.requestedIds.includes(g.playerId);
}

// Сколько просит: целое число монет, от 1 до всего кошелька. null — так нельзя.
export function checkTopUpAmount(raw: unknown, reserve: number): number | null {
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  const amount = Number(raw);
  if (!Number.isInteger(amount) || amount < 1 || amount > reserve) return null;
  return amount;
}

// Итог: хоть одно «против» — нет; согласны все, кого спрашивали, — докупает; вышло время — нет.
// voterIds — все за столом, кроме просящего и ботов сервера (боты не голосуют, решают люди).
export function topUpOutcome(
  vote: TopUpVote,
  voterIds: string[],
  now: number,
): 'approved' | 'rejected' | 'expired' | 'pending' {
  if (vote.no.length > 0) return 'rejected';
  if (voterIds.every((id) => vote.yes.includes(id))) return 'approved';
  if (now - vote.startedAt >= TOP_UP_VOTE_MS) return 'expired';
  return 'pending';
}

// Деньги игрока после докупки: из кошелька — на стол. С чем сел за стол (startBalance) растёт
// на ту же сумму: докупка — не выигрыш, в итогах комнаты и «проиграл больше всех» её нет.
export function applyTopUp(
  p: { balance: number; reserve: number; startBalance: number },
  amount: number,
): { balance: number; reserve: number; startBalance: number } {
  return {
    balance: p.balance + amount,
    reserve: p.reserve - amount,
    startBalance: p.startBalance + amount,
  };
}
