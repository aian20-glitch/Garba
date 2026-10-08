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

// Запас на отлучку выбирает создатель комнаты: 1…5 минут (решение владельца, 08.10.2026).
// Старые комнаты и «Быстрая игра» — 5 минут.
export const ABSENCE_MINUTES_OPTIONS = [1, 2, 3, 4, 5];
export const DEFAULT_ABSENCE_MINUTES = 5;

export function absenceMsFor(minutes: number | undefined): number {
  return ABSENCE_MINUTES_OPTIONS.includes(minutes ?? NaN)
    ? minutes! * 60_000
    : DEFAULT_ABSENCE_MINUTES * 60_000;
}

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

// Запас на отсутствие — 5 минут на всю игру (§13, §13a, решение владельца правил).
// Его тратят и потеря связи, и «ушёл» (два хода подряд за игрока сходил таймер).
// Отошёл на 2 минуты и вернулся — в следующий раз у него 3 минуты. Кончился — комната
// закрывается при следующем же отсутствии.
//   absentIds — кто сейчас отсутствует (нет связи или «ушёл»);
//   since — с какого момента идёт текущее отсутствие (живёт в памяти);
//   usedMs — сколько запаса уже потрачено за игру (хранится в комнате).
export type AbsenceStep = {
  since: Record<string, number>;
  usedMs: Record<string, number>;
  expired: string[];
  msLeft: Record<string, number>;
};

export function absenceStep(
  playerIds: string[],
  absentIds: string[],
  since: Record<string, number>,
  usedMs: Record<string, number>,
  now: number,
  budgetMs: number,
): AbsenceStep {
  const nextSince = { ...since };
  const nextUsed = { ...usedMs };
  const expired: string[] = [];
  const msLeft: Record<string, number> = {};
  const absent = new Set(absentIds);

  for (const id of playerIds) {
    if (absent.has(id) && nextSince[id] === undefined) nextSince[id] = now;
    if (!absent.has(id) && nextSince[id] !== undefined) {
      // Вернулся — отсутствие списывается с запаса.
      nextUsed[id] = (nextUsed[id] ?? 0) + (now - nextSince[id]);
      delete nextSince[id];
    }
    const current = nextSince[id] !== undefined ? now - nextSince[id] : 0;
    msLeft[id] = Math.max(0, budgetMs - (nextUsed[id] ?? 0) - current);
    if (absent.has(id) && msLeft[id] <= 0) expired.push(id);
  }

  return { since: nextSince, usedMs: nextUsed, expired, msLeft };
}
