// Личная пауза (RULES.md §20a, решение владельца 04.11.2026). Чистые функции.
//
// Обычная игра — у каждого 3 паузы по 10 секунд за партию (комнату); турнир — 1 пауза на
// 10 секунд за весь турнир (на всех его столах вместе). Взять — только между раздачами и
// только когда ничего другого не ждём: стол не на паузе, никто не голосует, другой паузы нет.
// Пока пауза — часы стола стоят и раздавать нельзя. Через 10 секунд игра идёт сама; взявший
// может закончить раньше, но пауза всё равно потрачена.

export const PERSONAL_PAUSE_MS = 10_000;
export const GAME_PAUSES = 3;
export const TOURNAMENT_PAUSES = 1;

export type PersonalPause = { playerId: string; startedAt: number; endsAt: number };

export function pauseLimit(tournament: boolean): number {
  return tournament ? TOURNAMENT_PAUSES : GAME_PAUSES;
}

export function pausesLeft(used: number, tournament: boolean): number {
  return Math.max(0, pauseLimit(tournament) - used);
}

export type PauseCheck = {
  betweenDeals: boolean; // раздача не идёт: до первой, после сыгранной, пересдача
  seated: boolean; // сидит за этим столом
  bot: boolean;
  gone: boolean; // пропал посреди раздачи — место освобождается
  roomPaused: boolean; // ждём отключившегося или «ушедшего» (§13)
  activePause: boolean; // уже идёт чья-то личная пауза
  voteActive: boolean; // «закончить игру», «без ушедшего», «докупить»
  timeUp: boolean; // время стола вышло
  used: number;
  tournament: boolean;
};

export type PauseRefusal =
  | 'player is not in this room'
  | 'cannot pause now'
  | 'pause in progress'
  | 'no pauses left';

// Можно ли взять паузу. null — можно.
export function pauseRefusal(c: PauseCheck): PauseRefusal | null {
  if (!c.seated || c.bot || c.gone) return 'player is not in this room';
  if (c.activePause) return 'pause in progress';
  if (pausesLeft(c.used, c.tournament) <= 0) return 'no pauses left';
  if (!c.betweenDeals || c.roomPaused || c.voteActive || c.timeUp) return 'cannot pause now';
  return null;
}

export function startPause(playerId: string, now: number, ms = PERSONAL_PAUSE_MS): PersonalPause {
  return { playerId, startedAt: now, endsAt: now + ms };
}

export function pauseOver(p: PersonalPause, now: number): boolean {
  return now >= p.endsAt;
}

export function pauseSecondsLeft(p: PersonalPause, now: number): number {
  return Math.max(0, Math.ceil((p.endsAt - now) / 1000));
}
