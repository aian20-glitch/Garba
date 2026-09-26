// Ограничение частоты: не больше max событий за windowMs. Чистые функции.
// Новые аккаунты с одного адреса (каждый — 30 000 монет, без лимита их штамповали бы
// скриптом) и общий лимит запросов с одного адреса (26.09.2026).

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
