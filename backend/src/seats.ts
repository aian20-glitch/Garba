// Места за столом, выход из игры и замена (решение владельца, 24.09.2026).
//
// - В лобби игрок сразу сидит на месте; пересесть можно на свободное, пока игра не началась.
//   Где сел — там и играет: места номер 0…capacity−1 по кругу против часовой стрелки
//   (следующее место — сосед справа). Случайной посадки при старте больше нет.
// - «Выйти» посреди игры — только между раздачами. Кон сразу делится между оставшимися,
//   ушедшему −1.0 рейтинга, его место свободно.
// - Пропал на 5 минут — так же, как «Выйти». Посреди раздачи: главный — сразу проигрыш
//   (как сдался), дальше за него доигрывает таймер; место освобождается после раздачи.
// - Свободное место ждёт нового игрока 10 минут; никто не сел — игра заканчивается.
//   Новый игрок садится с пустым коном — все начинают как с нуля.
// Чистые функции; сами действия — в index.ts.

export const VACANCY_WAIT_MS = 10 * 60_000;

// Между раздачами — можно выйти и можно посадить нового игрока.
export const BETWEEN_DEALS = ['dealer_found', 'round_done', 'awaiting_deal'];

export function betweenDeals(stage: string): boolean {
  return BETWEEN_DEALS.includes(stage);
}

export function freeSeats(taken: number[], capacity: number): number[] {
  const busy = new Set(taken);
  return Array.from({ length: capacity }, (_, i) => i).filter((i) => !busy.has(i));
}

// Какое место дать входящему: выбранное, если свободно; иначе первое свободное; нет — null.
export function seatFor(taken: number[], capacity: number, wanted?: number): number | null {
  const free = freeSeats(taken, capacity);
  if (wanted !== undefined && free.includes(wanted)) return wanted;
  if (wanted !== undefined) return null;
  return free[0] ?? null;
}

export type Vacancy = { seat: number; since: number };

// Свободное место ждёт дольше лимита — игру пора заканчивать.
export function vacancyExpired(vacancies: Vacancy[], now: number, waitMs = VACANCY_WAIT_MS): boolean {
  return vacancies.some((v) => now - v.since >= waitMs);
}

export function vacancySecondsLeft(v: Vacancy, now: number, waitMs = VACANCY_WAIT_MS): number {
  return Math.max(0, Math.ceil((v.since + waitMs - now) / 1000));
}
