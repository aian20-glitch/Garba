// Время на ход (RULES.md §13a, решение владельца правил): 20 или 40 секунд на любое
// решение — выбирает создатель комнаты (решение владельца, 23.09.2026).
// Не успел — за игрока ходит сервер: в торгах и в борьбе за спецкарту — ПАС, в розыгрыше
// и при сбросе — случайная допустимая карта, КОН — козырь по РАЗ, раздающий — раздаёт,
// в голосовании «продолжаем / делим» — «делим».
// Два пропуска подряд — игрок считается ушедшим: пауза на 5 минут, как при отключении.
// Чистые функции; таймеры и сами ходы — в index.ts.

export const TURN_MS = 20_000;
export const TURN_SECONDS_OPTIONS = [20, 40];
export const DEFAULT_TURN_SECONDS = 20;

// Время на ход в комнате. Нет в настройках (комнаты до 23.09.2026) — 20 секунд.
export function turnMsFor(turnSeconds: number | undefined): number {
  return (turnSeconds ?? DEFAULT_TURN_SECONDS) * 1000;
}
export const AWAY_AFTER_MISSES = 2;

export type TurnClock = { key: string; since: number };

// Часы хода: пока ждём того же решения (ключ тот же) — время идёт с прежнего момента;
// ждём нового — отсчёт заново. Ключ null — сейчас никого не ждём.
// startAt — не раньше этого момента (конец анимации раздачи, 27.09.2026): пока карты
// летят по столу, игрок их ещё не видит, и время на ход не идёт.
export function clockFor(
  prev: TurnClock | undefined,
  key: string | null,
  now: number,
  startAt: number = now,
): TurnClock | null {
  if (key === null) return null;
  if (prev && prev.key === key) return prev;
  return { key, since: Math.max(now, startAt) };
}

// Анимация раздачи в приложении (updateDealPresentation в game_table.dart): сначала
// ИЗЖОГИ и открытая карта, потом карты по одной каждому. Числа — те же, что в приложении.
export const DEAL_OPENING_MS = 1_000;
export const DEAL_IZZHOGA_MS = 3_000;
export const DEAL_CARD_MS = 430;
export const DEAL_MORE_MS = 500; // дораздача после борьбы за спецкарту

// Вскрытие на туза (dealer_selection.dart): карты открываются по одной, потом 1,6 с
// возвращаются в колоду. Пока это идёт, раздающий ещё не знает, что раздаёт он.
export const REVEAL_CARD_MS = 900;
export const REVEAL_RETURN_MS = 1_600;

export function revealShowMs(cards: number): number {
  return cards * REVEAL_CARD_MS + REVEAL_RETURN_MS;
}

// Три ИЗЖОГИ подряд — пересдача (§5.2): приложение сначала показывает эти ИЗЖОГИ, и только
// потом у раздающего появляется «РАЗДАТЬ» (threeIzzhogaLocked в game_table.dart). Менять вместе.
export const THREE_IZZHOGA_TAIL_MS = 900;

export function threeIzzhogaShowMs(izzhoga: number): number {
  return izzhoga * DEAL_IZZHOGA_MS + THREE_IZZHOGA_TAIL_MS;
}

// Раздача, которую сейчас показывают игрокам: key — номер раздачи, dealt — сколько карт
// роздано каждому, shownAt — когда анимация закончится.
export type DealShow = { key: string; dealt: number; shownAt: number };

// Новая раздача — анимация с начала; карт стало больше (дораздали после спецкарты) —
// досдача после текущей. key null — открытой карты нет, раздачи на столе нет.
export function dealShowStep(
  prev: DealShow | undefined,
  key: string | null,
  cards: number,
  players: number,
  izzhoga: number,
  now: number,
): DealShow | undefined {
  if (key === null) return prev;
  if (!prev || prev.key !== key) {
    return {
      key,
      dealt: cards,
      shownAt: now + DEAL_OPENING_MS + izzhoga * DEAL_IZZHOGA_MS + players * cards * DEAL_CARD_MS,
    };
  }
  if (cards > prev.dealt) {
    return {
      key,
      dealt: cards,
      shownAt: Math.max(prev.shownAt, now) + DEAL_MORE_MS + players * (cards - prev.dealt) * DEAL_CARD_MS,
    };
  }
  return prev;
}

// Сколько секунд осталось на ход (для отсчёта на экране).
export function turnSecondsLeft(clock: TurnClock | null, now: number, turnMs: number): number | null {
  if (!clock) return null;
  return Math.max(0, Math.ceil((clock.since + turnMs - now) / 1000));
}

// За игрока сходил таймер: пропусков подряд стало на один больше. Второй подряд — ушёл.
export function addMiss(
  missed: Record<string, number>,
  playerId: string,
): { missed: Record<string, number>; away: boolean } {
  const count = (missed[playerId] ?? 0) + 1;
  return { missed: { ...missed, [playerId]: count }, away: count >= AWAY_AFTER_MISSES };
}

// Случайный элемент — какой картой сходит за игрока таймер.
export function pickRandom<T>(items: T[], random: () => number = Math.random): T {
  return items[Math.floor(random() * items.length)];
}
