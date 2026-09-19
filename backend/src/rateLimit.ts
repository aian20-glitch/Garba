// Ограничение частоты: не больше max событий за windowMs. Чистые функции.
// Сейчас — новые аккаунты с одного адреса: каждый новый аккаунт — 10 000 монет,
// без ограничения их штамповали бы скриптом и переводили подарками на один.

export type RateRule = { max: number; windowMs: number };

// Оставить только события внутри окна и решить, можно ли ещё одно.
export function rateCheck(
  times: number[],
  now: number,
  rules: RateRule[],
): { allowed: boolean; times: number[] } {
  const longest = Math.max(...rules.map((r) => r.windowMs));
  const recent = times.filter((t) => now - t < longest);
  const allowed = rules.every((r) => recent.filter((t) => now - t < r.windowMs).length < r.max);
  return { allowed, times: allowed ? [...recent, now] : recent };
}
