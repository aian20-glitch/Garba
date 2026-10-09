// Игрок ушёл — играть дальше без него или закрыть комнату (RULES.md §13c, решение владельца
// правил, 09.10.2026). Кон к этому времени уже поделён между оставшимися (§13b).
// Чистые функции; голосование и закрытие — в index.ts.

// Меньше четырёх играть нельзя: столов на троих в игре нет (§1).
export const MIN_PLAYERS = 4;

// Сколько ждём ответа. Не ответил — считается «закрыть».
export const SHRINK_VOTE_MS = 30_000;

export type ShrinkVote = {
  leftName: string;
  yes: string[];
  startedAt: number;
};

// Спрашивать ли оставшихся: их хватает на стол и среди них есть живые люди
// (одни боты на тренировке играть сами с собой не будут).
export function canKeepPlaying(players: number, humans: number): boolean {
  return players >= MIN_PLAYERS && humans > 0;
}

// Итог: все «продолжаем» — играем дальше; вышло время — закрываем. «Закрыть» хоть одного
// закрывает сразу — это делает index.ts. Боты не голосуют — решают люди.
export function shrinkVoteOutcome(
  vote: ShrinkVote,
  humanIds: string[],
  now: number,
): 'continue' | 'close' | 'pending' {
  if (humanIds.every((id) => vote.yes.includes(id))) return 'continue';
  if (now - vote.startedAt >= SHRINK_VOTE_MS) return 'close';
  return 'pending';
}

// Стол стал меньше: места заново 0…n−1 в том же порядке по кругу.
export function renumberSeats(seats: number[]): number[] {
  const order = [...seats].sort((a, b) => a - b);
  return seats.map((s) => order.indexOf(s));
}

// Раздающий ушёл — раздаёт следующий по кругу (сосед справа), как при обычной смене (§4).
// ids — места до ухода, по порядку.
export function dealerAfterLeave(ids: string[], dealerId: string, leftId: string): string {
  if (dealerId !== leftId) return dealerId;
  const i = ids.indexOf(leftId);
  return ids[(i + 1) % ids.length];
}
