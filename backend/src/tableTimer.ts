// Время игры за обычным столом и продление по общему согласию (RULES.md §20, решение
// владельца 01.11.2026). Чистые функции: проверка настройки, часы стола, голосование.
//
// Часы идут от первой раздачи по настоящему времени (паузы входят). За 5 минут до конца
// всем за столом — вопрос «продлить на 10 минут?»: все «да» — +10 минут; одно «нет» или
// не успели до 00:00 — продления нет. На каждое время окончания — один вопрос.

export const TIME_LIMIT_PRESETS = [30, 60, 90]; // готовые варианты, минут
export const TIME_LIMIT_DEFAULT = 60; // в приложении выбрано по умолчанию
export const TIME_LIMIT_MIN = 15; // «своё время» — от 15 минут…
export const TIME_LIMIT_MAX = 180; // …до 3 часов
export const EXTEND_MINUTES = 10; // одно продление
export const VOTE_BEFORE_MINUTES = 5; // за сколько до конца спрашиваем
export const WARN_MINUTES = 1; // «осталась 1 минута»

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

// Голосование за продление: к какому времени окончания относится, кто «да», кто «нет».
export type ExtensionVote = {
  forEndsAt: number;
  yes: string[];
  no: string[];
};

export type TableClock = {
  minutes: number; // что выбрал хозяин
  startedAt: number; // первая раздача
  endsAt: number; // сейчас — с учётом всех продлений
  extensions: number; // сколько раз продлили
  // Для какого времени окончания вопрос уже задавали — второй раз не спрашиваем.
  askedForEndsAt: number | null;
  vote: ExtensionVote | null;
  // Чем кончилось последнее голосование — для надписи у всех.
  lastVote: { forEndsAt: number; result: 'approved' | 'rejected' | 'expired'; byId: string | null } | null;
  // Время вышло. Раздачу доигрываем, новую не начинаем — стол закрывается.
  reached: boolean;
};

// Длина «минуты» — для проверок её укорачивают (GARBA_TABLE_MINUTE_MS).
export function startClock(minutes: number, now: number, minuteMs = 60_000): TableClock {
  return {
    minutes,
    startedAt: now,
    endsAt: now + minutes * minuteMs,
    extensions: 0,
    askedForEndsAt: null,
    vote: null,
    lastVote: null,
    reached: false,
  };
}

// Пора задать вопрос: до конца не больше 5 минут, по этому времени окончания ещё не спрашивали.
export function shouldAsk(clock: TableClock, now: number, minuteMs = 60_000): boolean {
  if (clock.reached || clock.vote || clock.askedForEndsAt === clock.endsAt) return false;
  return now < clock.endsAt && clock.endsAt - now <= VOTE_BEFORE_MINUTES * minuteMs;
}

export function ask(clock: TableClock): TableClock {
  return {
    ...clock,
    askedForEndsAt: clock.endsAt,
    vote: { forEndsAt: clock.endsAt, yes: [], no: [] },
    lastVote: null,
  };
}

export type CastResult =
  | { ok: true; clock: TableClock }
  | { ok: false; error: 'no extension vote' | 'stale extension vote' | 'already voted' | 'you do not vote on this' };

// Голос игрока. forEndsAt — к какому вопросу относится нажатие: старое нажатие (вопрос уже
// сменился) не засчитывается в новый. Каждый голосует один раз.
export function cast(
  clock: TableClock,
  voterIds: string[],
  playerId: string,
  choice: 'yes' | 'no',
  forEndsAt: number,
  now: number,
): CastResult {
  const vote = clock.vote;
  if (!vote || clock.reached || now >= clock.endsAt) return { ok: false, error: 'no extension vote' };
  if (forEndsAt !== vote.forEndsAt) return { ok: false, error: 'stale extension vote' };
  if (!voterIds.includes(playerId)) return { ok: false, error: 'you do not vote on this' };
  if (vote.yes.includes(playerId) || vote.no.includes(playerId)) return { ok: false, error: 'already voted' };
  const next = choice === 'yes' ? { ...vote, yes: [...vote.yes, playerId] } : { ...vote, no: [...vote.no, playerId] };
  return { ok: true, clock: { ...clock, vote: next } };
}

// Подвести итог. voterIds — кто сейчас за столом и голосует (ушедших уже нет в списке).
// Одно «нет» — сразу отказ; все «да» — +10 минут ровно один раз (голосование закрывается
// тут же); 00:00 без единогласия — продления нет, время вышло.
export function settle(clock: TableClock, voterIds: string[], now: number, minuteMs = 60_000): TableClock {
  let c = clock;
  const vote = c.vote;
  if (vote) {
    if (vote.no.length > 0) {
      c = { ...c, vote: null, lastVote: { forEndsAt: vote.forEndsAt, result: 'rejected', byId: vote.no[0] } };
    } else if (now < c.endsAt && voterIds.length > 0 && voterIds.every((id) => vote.yes.includes(id))) {
      c = {
        ...c,
        endsAt: c.endsAt + EXTEND_MINUTES * minuteMs,
        extensions: c.extensions + 1,
        vote: null,
        lastVote: { forEndsAt: vote.forEndsAt, result: 'approved', byId: null },
      };
    } else if (now >= c.endsAt) {
      c = { ...c, vote: null, lastVote: { forEndsAt: vote.forEndsAt, result: 'expired', byId: null } };
    }
  }
  if (!c.reached && now >= c.endsAt) c = { ...c, reached: true };
  return c;
}

export function secondsLeft(clock: TableClock, now: number): number {
  return Math.max(0, Math.ceil((clock.endsAt - now) / 1000));
}
