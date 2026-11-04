// Время игры за столом и продление по общему согласию (RULES.md §20, решение
// владельца 01.11.2026; паузы и второй вопрос — 04.11.2026). Чистые функции: проверка
// настройки, часы стола, голосование. Те же часы — у турнирного стола (§19.4).
//
// Часы идут от первой раздачи и **стоят**, пока стол на паузе: ждём отключившегося или
// «ушедшего» (§13), идёт личная пауза (§20a). Поэтому храним не время окончания, а сколько
// уже сыграно (playedMs) и с какого момента часы снова идут (runningSince).
// За 5 минут до конца всем за столом — вопрос «продлить на 10 минут?»: все «да» — +10 минут;
// одно «нет» — отказ. Не продлили — за 1 минуту спрашиваем ещё раз (второй и последний вопрос
// к этому сроку). Не успели до 00:00 — продления нет.

export const TIME_LIMIT_PRESETS = [30, 60, 90]; // готовые варианты, минут
export const TIME_LIMIT_DEFAULT = 60; // в приложении выбрано по умолчанию
export const TIME_LIMIT_MIN = 15; // «своё время» — от 15 минут…
export const TIME_LIMIT_MAX = 180; // …до 3 часов
export const EXTEND_MINUTES = 10; // одно продление
export const VOTE_BEFORE_MINUTES = 5; // за сколько до конца спрашиваем
export const WARN_MINUTES = 1; // «осталась 1 минута» — и второй вопрос

export type TimeLimitCheck =
  | { ok: true; minutes: number | null }
  | { ok: false; error: 'bad time limit' | 'time limit too short' | 'time limit too long' };

// Настройка при создании стола: null — без ограничения; число — целые минуты 15…180.
// Не прислали (старые приложения, «Быстрая игра») — без ограничения, как было раньше.
export function checkTimeLimit(value: unknown): TimeLimitCheck {
  if (value === undefined || value === null) return { ok: true, minutes: null };
  const n = Number(value);
  if (typeof value === 'boolean' || !Number.isInteger(n)) return { ok: false, error: 'bad time limit' };
  if (n < TIME_LIMIT_MIN) return { ok: false, error: 'time limit too short' };
  if (n > TIME_LIMIT_MAX) return { ok: false, error: 'time limit too long' };
  return { ok: true, minutes: n };
}

// Голосование за продление. forEndsAt — к какому сроку стола относится (сколько всего
// времени у стола, мс; меняется только с продлением) — по нему старое нажатие не попадёт в
// новый вопрос. round — 1 (за 5 минут) или 2 (за 1 минуту).
export type ExtensionVote = {
  forEndsAt: number;
  round: 1 | 2;
  yes: string[];
  no: string[];
};

export type TableClock = {
  minutes: number; // что выбрал хозяин (турнир — длина стола в минутах)
  startedAt: number; // первая раздача
  minuteMs: number; // длина «минуты» (для проверок короче)
  limitMs: number; // сколько всего времени у стола — с продлениями
  playedMs: number; // сыграно до runningSince
  runningSince: number | null; // часы идут с этого момента; null — стоят (пауза)
  extensions: number; // сколько раз продлили
  // Какой вопрос к текущему сроку уже задавали: 0 — никакого, 1 — за 5 минут, 2 — за 1 минуту.
  askedFor: number | null;
  askedRound: 0 | 1 | 2;
  vote: ExtensionVote | null;
  // Чем кончилось последнее голосование — для надписи у всех.
  lastVote: { forEndsAt: number; round: 1 | 2; result: 'approved' | 'rejected' | 'expired'; byId: string | null } | null;
  // Время вышло. Раздачу доигрываем, новую не начинаем — стол закрывается.
  reached: boolean;
};

// Часы стола на minutes «минут» (minuteMs — длина минуты).
export function startClock(minutes: number, now: number, minuteMs = 60_000): TableClock {
  return {
    minutes,
    startedAt: now,
    minuteMs,
    limitMs: minutes * minuteMs,
    playedMs: 0,
    runningSince: now,
    extensions: 0,
    askedFor: null,
    askedRound: 0,
    vote: null,
    lastVote: null,
    reached: false,
  };
}

// Часы из базы, записанные до 04.11.2026 (endsAt по настоящему времени, паузы входили):
// сыграно — с первой раздачи до сейчас, срок — endsAt − startedAt; голосование сохраняется.
export function normalizeClock(raw: unknown, now: number, minuteMs = 60_000): TableClock {
  const c = raw as TableClock & { endsAt?: number; askedForEndsAt?: number | null };
  if (typeof c.limitMs === 'number') return c;
  const endsAt = c.endsAt ?? c.startedAt + c.minutes * minuteMs;
  const limitMs = endsAt - c.startedAt;
  const old = (v: { forEndsAt: number } | null | undefined) => (v ? { ...v, forEndsAt: v.forEndsAt - c.startedAt, round: 1 as const } : null);
  return {
    minutes: c.minutes,
    startedAt: c.startedAt,
    minuteMs,
    limitMs,
    playedMs: Math.max(0, now - c.startedAt),
    runningSince: now,
    extensions: c.extensions ?? 0,
    askedFor: c.askedForEndsAt === endsAt ? limitMs : null,
    askedRound: c.askedForEndsAt === endsAt ? 1 : 0,
    vote: old(c.vote) as ExtensionVote | null,
    lastVote: old(c.lastVote) as TableClock['lastVote'],
    reached: !!c.reached,
  };
}

// Сколько уже сыграно (паузы не считаются).
export function playedMs(clock: TableClock, now: number): number {
  return clock.playedMs + (clock.runningSince !== null ? Math.max(0, now - clock.runningSince) : 0);
}

// Сколько осталось до конца стола.
export function remainingMs(clock: TableClock, now: number): number {
  return Math.max(0, clock.limitMs - playedMs(clock, now));
}

export function isRunning(clock: TableClock): boolean {
  return clock.runningSince !== null;
}

// Остановить (run = false) или пустить (true) часы. Уже в этом состоянии — тот же объект.
// Сыгранное сохраняется: после паузы отсчёт идёт с того же места.
export function setRunning(clock: TableClock, run: boolean, now: number): TableClock {
  if (run === (clock.runningSince !== null)) return clock;
  if (run) return { ...clock, runningSince: now };
  return { ...clock, playedMs: playedMs(clock, now), runningSince: null };
}

// Какой вопрос пора задать: 1 — за 5 минут (ещё не спрашивали), 2 — за 1 минуту (к этому сроку
// не продлили). 0 — спрашивать не надо. Продлили — срок новый, вопросы к нему — заново.
export function roundDue(clock: TableClock, now: number): 0 | 1 | 2 {
  if (clock.reached || clock.vote) return 0;
  const left = clock.limitMs - playedMs(clock, now);
  if (left <= 0) return 0;
  const asked = clock.askedFor === clock.limitMs ? clock.askedRound : 0;
  if (left <= WARN_MINUTES * clock.minuteMs) return asked < 2 ? 2 : 0;
  if (left <= VOTE_BEFORE_MINUTES * clock.minuteMs) return asked < 1 ? 1 : 0;
  return 0;
}

export function shouldAsk(clock: TableClock, now: number): boolean {
  return roundDue(clock, now) !== 0;
}

export function ask(clock: TableClock, now: number): TableClock {
  const round = roundDue(clock, now);
  if (round === 0) return clock;
  return {
    ...clock,
    askedFor: clock.limitMs,
    askedRound: round,
    vote: { forEndsAt: clock.limitMs, round, yes: [], no: [] },
    lastVote: null,
  };
}

export type CastResult =
  | { ok: true; clock: TableClock }
  | { ok: false; error: 'no extension vote' | 'stale extension vote' | 'already voted' | 'you do not vote on this' };

// Голос игрока. forEndsAt (и round, если прислали) — к какому вопросу относится нажатие:
// старое нажатие (вопрос уже сменился) не засчитывается в новый. Каждый голосует один раз.
export function cast(
  clock: TableClock,
  voterIds: string[],
  playerId: string,
  choice: 'yes' | 'no',
  forEndsAt: number,
  now: number,
  round?: number,
): CastResult {
  const vote = clock.vote;
  if (!vote || clock.reached || remainingMs(clock, now) <= 0) return { ok: false, error: 'no extension vote' };
  if (forEndsAt !== vote.forEndsAt || (round !== undefined && round !== vote.round)) {
    return { ok: false, error: 'stale extension vote' };
  }
  if (!voterIds.includes(playerId)) return { ok: false, error: 'you do not vote on this' };
  if (vote.yes.includes(playerId) || vote.no.includes(playerId)) return { ok: false, error: 'already voted' };
  const next = choice === 'yes' ? { ...vote, yes: [...vote.yes, playerId] } : { ...vote, no: [...vote.no, playerId] };
  return { ok: true, clock: { ...clock, vote: next } };
}

// Подвести итог. voterIds — кто сейчас за столом и голосует (ушедших уже нет в списке).
// Одно «нет» — сразу отказ; все «да» — +10 минут ровно один раз (голосование закрывается
// тут же); первый вопрос не решён к последней минуте — он закрывается, его место занимает
// второй; 00:00 без единогласия — продления нет, время вышло.
export function settle(clock: TableClock, voterIds: string[], now: number): TableClock {
  let c = clock;
  const vote = c.vote;
  const left = c.limitMs - playedMs(c, now);
  if (vote) {
    const last = (result: 'approved' | 'rejected' | 'expired', byId: string | null) => ({
      forEndsAt: vote.forEndsAt,
      round: vote.round,
      result,
      byId,
    });
    if (vote.no.length > 0) {
      c = { ...c, vote: null, lastVote: last('rejected', vote.no[0]) };
    } else if (left > 0 && voterIds.length > 0 && voterIds.every((id) => vote.yes.includes(id))) {
      c = {
        ...c,
        limitMs: c.limitMs + EXTEND_MINUTES * c.minuteMs,
        extensions: c.extensions + 1,
        vote: null,
        lastVote: last('approved', null),
      };
    } else if (left <= 0 || (vote.round === 1 && left <= WARN_MINUTES * c.minuteMs)) {
      c = { ...c, vote: null, lastVote: last('expired', null) };
    }
  }
  if (!c.reached && c.limitMs - playedMs(c, now) <= 0) c = { ...c, reached: true };
  return c;
}

export function secondsLeft(clock: TableClock, now: number): number {
  return Math.ceil(remainingMs(clock, now) / 1000);
}
