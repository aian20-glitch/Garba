// Кто из игроков за столом, а кто отключился (RULES.md §13, этап 9.2).
//
// Игрок «на месте», если у него открыт сокет к комнате или он недавно делал запрос
// к ней. Пропал дольше чем на OFFLINE_GRACE_MS — считаем отключившимся: игра встаёт
// на паузу и идёт таймер 5 минут. Вернулся — таймер снимается. Не вернулся —
// игра прекращается, кон делится между оставшимися.
//
// Короткая отсрочка нужна, чтобы пауза не мигала от переходов между экранами
// и мелких обрывов сети: у каждого экрана своё соединение, между ними — доли секунды.

export const DISCONNECT_TIMEOUT_MS = 5 * 60 * 1000; // §13: 5 минут
export const OFFLINE_GRACE_MS = 10_000;

export type PresenceState = {
  // Когда игрока последний раз видели. Живёт только в памяти сервера.
  lastSeen: Record<string, number>;
  // Кто отключился и с какого момента идёт его таймер. Пока не пусто — пауза.
  disconnectedAt: Record<string, number>;
};

export type PresenceOptions = { graceMs: number; timeoutMs: number };

export type PresenceStep = PresenceState & {
  changed: boolean; // кто-то отключился или вернулся — надо разослать состояние
  expired: string[]; // у кого истекли 5 минут — игра прекращается
};

// Один шаг проверки. connectedIds — у кого сейчас открыт сокет к комнате.
export function presenceStep(
  playerIds: string[],
  connectedIds: string[],
  state: PresenceState,
  now: number,
  opts: PresenceOptions,
): PresenceStep {
  const lastSeen = { ...state.lastSeen };
  const disconnectedAt = { ...state.disconnectedAt };
  const connected = new Set(connectedIds);
  let changed = false;
  const expired: string[] = [];

  for (const id of playerIds) {
    // Первый раз видим игрока (например, сервер только что поднялся) — даём отсрочку.
    if (connected.has(id) || lastSeen[id] === undefined) lastSeen[id] = now;

    const online = now - lastSeen[id] <= opts.graceMs;

    if (online && disconnectedAt[id] !== undefined) {
      delete disconnectedAt[id];
      changed = true;
    } else if (!online && disconnectedAt[id] === undefined) {
      disconnectedAt[id] = now;
      changed = true;
    }

    if (disconnectedAt[id] !== undefined && now - disconnectedAt[id] >= opts.timeoutMs) {
      expired.push(id);
    }
  }

  return { lastSeen, disconnectedAt, changed, expired };
}

// Игрок сделал запрос к комнате — он на месте.
export function touch(state: PresenceState, playerId: string, now: number): PresenceState {
  return { ...state, lastSeen: { ...state.lastSeen, [playerId]: now } };
}

// Сколько секунд осталось у отключившегося (для обратного отсчёта на экране).
export function secondsLeft(disconnectedAt: number, now: number, timeoutMs: number): number {
  return Math.max(0, Math.ceil((disconnectedAt + timeoutMs - now) / 1000));
}
