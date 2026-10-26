// Рейтинг игрока (RULES.md §16, этап 9.6; новая система — 26.10.2026). Чистые функции.
//
// Рейтинг = Мастерство (0…8) + Опыт (0…2). Рейтинг показывает мастерство, опыт и
// постоянство, а не размер выигрыша: монеты за комнату его не меняют (для монет —
// ТОП-3 недели, §16.8).
//
// Мастерство: после каждой партии копится «сырое» изменение (выиграл главным, проиграл,
// отбился), в конце комнаты оно умножается на время игры и ограничивается снизу −0.25.
// Опыт: активные дни, полчаса игры, серия дней — никогда не уменьшается.

export const START_SKILL = 4;
export const MAX_SKILL = 8;
export const MAX_EXPERIENCE = 2;

// §16.2 — база изменений за партию.
export const MAIN_WIN = 0.05;
export const MAIN_LOSS = 0.03; // отнимается
export const DEFENDED = 0.02; // каждому противнику за каждого проигравшего главного

// §16.3b: за одну комнату мастерство падает не больше чем на 0.25.
export const ROOM_MAX_LOSS = 0.25;

// §16.3a: ушёл из игры, не вернулся за 5 минут — −1.0, отдельно от всего остального.
export const LEFT_GAME = -1.0;

// §16.3a: штраф за уход. Если за столом уже пустое место (кто-то ушёл раньше и стол ждёт
// нового игрока), уходить не наказываем — играть всё равно не с кем (решение владельца, 08.10.2026).
export function leavePenalty(seatAlreadyEmpty: boolean): number {
  return seatAlreadyEmpty ? 0 : LEFT_GAME;
}

// §16.4a — выигрыш главным за большим столом ценнее (только прибавка главному).
const TABLE_FACTOR: Record<number, number> = { 4: 1.0, 5: 1.1, 6: 1.2, 7: 1.3 };

export function tableFactor(capacity: number): number {
  return TABLE_FACTOR[capacity] ?? 1;
}

// §16.2b — риск ×1…×5 в рейтинге не умножает напрямую: ×5 → ×1.4.
const RISK_FACTOR: Record<number, number> = { 1: 1.0, 2: 1.1, 3: 1.2, 4: 1.3, 5: 1.4 };

export function ratingRiskMultiplier(risk: number): number {
  return RISK_FACTOR[risk] ?? 1;
}

// §16.3b — серьёзность игры по времени: короткая комната почти не меняет рейтинг.
// minutes — сколько игрок реально играл за этим столом (без пауз и лобби).
const TIME_STEPS: [number, number][] = [
  [90, 1.1],
  [60, 1.05],
  [40, 1.0],
  [30, 0.85],
  [20, 0.7],
  [10, 0.45],
];

export function roomTimeMultiplier(activeMs: number): number {
  const minutes = activeMs / 60_000;
  for (const [from, mult] of TIME_STEPS) if (minutes >= from) return mult;
  return 0.2;
}

// §16.2a — сила начальной руки главного. Больше 1 — рука слабая, выигрыш с ней ценнее.
export const HAND = {
  VERY_WEAK: 1.3,
  WEAK: 1.15,
  NORMAL: 1.0,
  STRONG: 0.85,
  VERY_STRONG: 0.7,
  GARBA: 0.6,
} as const;

// Сколько взяток рука примерно возьмёт сама: козыри — по старшинству, чужие тузы и
// короли — меньше, чем больше соперников (их могут побить козырем).
export function handScore(hand: { suit: string; rank: string }[], trump: string, capacity: number): number {
  const extra = Math.max(0, Math.min(3, capacity - 4)); // 0 при 4 игроках … 3 при 7
  let sum = 0;
  for (const c of hand) {
    if (c.suit === trump) {
      sum += ['A', 'K', 'Q'].includes(c.rank) ? 1 : c.rank === 'J' ? 0.75 : c.rank === '10' ? 0.65 : 0.5;
    } else if (c.rank === 'A') sum += 0.75 - 0.05 * extra;
    else if (c.rank === 'K') sum += 0.3 - 0.05 * extra;
  }
  return sum;
}

// Нужно 3 взятки из 5. ГАРБА (дама, король и туз козыря) — отдельная категория.
export function calculateHandDifficulty(
  hand: { suit: string; rank: string }[],
  trump: string,
  capacity: number,
): number {
  if (['Q', 'K', 'A'].every((r) => hand.some((c) => c.suit === trump && c.rank === r))) return HAND.GARBA;
  const score = handScore(hand, trump, capacity);
  if (score < 1.8) return HAND.VERY_WEAK;
  if (score < 2.4) return HAND.WEAK;
  if (score < 3.2) return HAND.NORMAL;
  if (score < 3.9) return HAND.STRONG;
  return HAND.VERY_STRONG;
}

// Опыт — §16.1.
export const ACTIVE_DAY_MS = 20 * 60_000;
export const ACTIVE_DAY_DEALS = 5;
export const ACTIVE_DAY_BONUS = 0.005;
export const HALF_HOUR_BONUS = 0.01;
export const DAY_TIME_MAX = 0.04;
// Серия активных дней подряд: берётся самый высокий достигнутый уровень, не сумма.
const STREAK_LEVELS: [number, number][] = [
  [90, 0.5],
  [60, 0.4],
  [30, 0.3],
  [20, 0.15],
  [10, 0.05],
];

export type ActivityDay = { day: string; ms: number; deals: number };

// День засчитан: 20 минут игры и 5 доигранных партий.
export function isActiveDay(d: ActivityDay): boolean {
  return d.ms >= ACTIVE_DAY_MS && d.deals >= ACTIVE_DAY_DEALS;
}

// Опыт за один день: 0.005 за активный день и 0.01 за каждые полные 30 минут (до 0.04).
export function dayExperience(d: ActivityDay): number {
  if (!isActiveDay(d)) return 0;
  return ACTIVE_DAY_BONUS + Math.min(DAY_TIME_MAX, Math.floor(d.ms / 1_800_000) * HALF_HOUR_BONUS);
}

// Самая длинная серия активных дней подряд. day — 'YYYY-MM-DD' (сутки Казахстана).
export function longestStreak(days: string[]): number {
  const sorted = [...new Set(days)].sort();
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const day of sorted) {
    const t = Date.parse(`${day}T00:00:00Z`);
    run = prev !== null && t - prev === 86_400_000 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}

export function streakBonus(streak: number): number {
  for (const [from, bonus] of STREAK_LEVELS) if (streak >= from) return bonus;
  return 0;
}

// Весь опыт: набранный по старому правилу (+0.01 за партию до 26.10.2026) + дни + серия.
export function experienceOf(legacy: number, days: ActivityDay[]): number {
  const active = days.filter(isActiveDay);
  const sum = active.reduce((a, d) => a + dayExperience(d), 0);
  return Math.min(MAX_EXPERIENCE, legacy + sum + streakBonus(longestStreak(active.map((d) => d.day))));
}

export function ratingOf(skill: number, experience: number): number {
  return skill + experience;
}

// Для экрана: одна цифра после запятой.
export function shownRating(value: number): number {
  return Math.round(value * 10) / 10;
}

// §16.4 / §16.7: сила соперников. k от 0.5 до 1.5; 1 — соперники равны мне.
export function strengthFactor(mine: number, opponents: number[]): number {
  if (opponents.length === 0) return 1;
  const avg = opponents.reduce((a, b) => a + b, 0) / opponents.length;
  return Math.min(1.5, Math.max(0.5, 1 + (avg - mine) / 5));
}

// §16.5: чем выше мастерство, тем медленнее оно меняется — и вверх, и вниз.
// При 4 — ×1, при 6 — ×0.5, от 7 — ×0.25; при 2 и ниже — ×1.5.
export function masteryStability(skill: number): number {
  return Math.min(1.5, Math.max(0.25, (MAX_SKILL - skill) / 4));
}

export type RatingPlayer = { id: string; skill: number; rating: number };

// handDifficulty — сила руки главного (calculateHandDifficulty); нет — обычная.
export type DealMain = { id: string; won: boolean; risk: number; handDifficulty?: number };

// Изменение мастерства за партию (§16.2, §16.7) — ещё без времени комнаты: его знаем
// только в конце (settleRoom). players — все за столом: мастерство и рейтинг на начало
// комнаты. Возвращает изменение каждого (0 — не изменилось).
export function dealDeltas(players: RatingPlayer[], mains: DealMain[], capacity: number): Record<string, number> {
  const delta: Record<string, number> = Object.fromEntries(players.map((p) => [p.id, 0]));
  const byId = Object.fromEntries(players.map((p) => [p.id, p]));
  const mainIds = new Set(mains.map((m) => m.id));
  const defenders = players.filter((p) => !mainIds.has(p.id));

  for (const m of mains) {
    const me = byId[m.id];
    if (!me) continue;
    const k = strengthFactor(me.rating, defenders.map((d) => d.rating));
    const hand = m.handDifficulty ?? HAND.NORMAL;
    const risk = ratingRiskMultiplier(m.risk);
    if (m.won) {
      delta[m.id] += MAIN_WIN * k * masteryStability(me.skill) * risk * hand * tableFactor(capacity);
    } else {
      delta[m.id] -= MAIN_LOSS * (2 - k) * masteryStability(me.skill) * risk * (2 - hand);
      // Отбились: соперник для каждого противника — этот главный. Отбиться от сильной
      // руки труднее — множитель (2 − сила руки), от слабой — наоборот.
      for (const d of defenders) {
        delta[d.id] += DEFENDED * strengthFactor(d.rating, [me.rating]) * masteryStability(d.skill) * risk * (2 - hand);
      }
    }
  }
  return delta;
}

// Мастерство после комнаты (§16.3b): накопленное за партии × время игры, потеря — не
// больше 0.25. Итог — в пределах 0…8. Штраф за уход сюда не входит (§16.3a).
export function settleRoom(skill: number, pending: number, activeMs: number): number {
  const delta = Math.max(-ROOM_MAX_LOSS, pending * roomTimeMultiplier(activeMs));
  return Math.min(MAX_SKILL, Math.max(0, skill + delta));
}

// Штраф за уход (§16.3a) — после итога партий, без времени, руки и лимита потери.
export function applyLeave(skill: number, penalty: number): number {
  return Math.min(MAX_SKILL, Math.max(0, skill + penalty));
}
