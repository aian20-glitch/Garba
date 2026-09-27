// Лобби не ждёт вечно (решение владельца, 27.09.2026).
//
// Игра не началась за 10 минут после создания комнаты — комната закрывается сама.
// Пока идёт «ГОТОВ» (комната набралась, 30 секунд на кнопку), не закрываем: пусть
// проверка закончится — либо игра начнётся, либо не нажавшие выйдут, и тогда закроем.
// Чистые функции; таймер и само закрытие — в index.ts.

export const LOBBY_MS = 10 * 60_000;

// Пора закрыть лобби?
export function lobbyExpired(
  createdAt: number,
  now: number,
  readyCheckActive: boolean,
  lobbyMs: number = LOBBY_MS,
): boolean {
  return !readyCheckActive && now - createdAt >= lobbyMs;
}

// Сколько секунд осталось до закрытия — для отсчёта в лобби. Не меньше 0.
export function lobbySecondsLeft(createdAt: number, now: number, lobbyMs: number = LOBBY_MS): number {
  return Math.max(0, Math.ceil((createdAt + lobbyMs - now) / 1000));
}
