// Рейтинг игрока (RULES.md §16, этап 9.6). Чистые функции.
//
// Рейтинг = Мастерство (0…8) + Опыт (0…2). Опыт — от числа сыгранных партий,
// мастерство меняется после каждой партии и после окончания комнаты.

export const START_SKILL = 4;
export const MAX_SKILL = 8;
export const MAX_EXPERIENCE = 2;
export const EXPERIENCE_PER_DEAL = 0.01;

// §16.2
export const MAIN_WIN = 0.05; // × риск
export const MAIN_LOSS = -0.03; // × риск
export const GARBA_BONUS = 0.1;
export const DEFENDED = 0.02; // каждому противнику за каждого проигравшего главного

// §16.3
export const ROOM_WINNER = 0.5;
export const ROOM_PLUS = 0.2;
export const ROOM_MINUS = -0.2;
export const ROOM_BIGGEST_LOSER = -0.4;
// §16.3a: ушёл из игры, не вернулся за 5 минут — из-за него закрылась комната.
export const LEFT_GAME = -1.0;

// §16.3a: штраф за уход. Если за столом уже пустое место (кто-то ушёл раньше и стол ждёт
// нового игрока), уходить не наказываем — играть всё равно не с кем (решение владельца, 08.10.2026).
export function leavePenalty(seatAlreadyEmpty: boolean): number {
  return seatAlreadyEmpty ? 0 : LEFT_GAME;
}

// §16.4a — прибавки за большим столом ценнее.
const TABLE_FACTOR: Record<number, number> = { 4: 1.0, 5: 1.1, 6: 1.2, 7: 1.3 };

export function tableFactor(capacity: number): number {
  return TABLE_FACTOR[capacity] ?? 1;
}

// §16.1: +0.01 за партию, не больше 2.
export function experience(deals: number): number {
  return Math.min(MAX_EXPERIENCE, deals * EXPERIENCE_PER_DEAL);
}

export function ratingOf(skill: number, deals: number): number {
  return skill + experience(deals);
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

// Применить изменение мастерства (§16.4, §16.5, §16.7):
// прибавка × k × ((8 − мастерство)/4)² × размер стола, потеря × (2 − k). Итог — в пределах 0…8.
// Замедление квадратичное — чтобы 10 было очень трудно получить (просьба владельца правил).
export function applySkill(skill: number, base: number, k: number, table = 1): number {
  const slow = ((MAX_SKILL - skill) / 4) ** 2;
  const delta = base > 0 ? base * k * slow * table : base * (2 - k);
  return Math.min(MAX_SKILL, Math.max(0, skill + delta));
}

export type RatingPlayer = { id: string; skill: number; rating: number };

export type DealMain = { id: string; won: boolean; risk: number; garba: boolean };

// Мастерство после партии (§16.2). players — все за столом; mains — главные партии.
export function afterDeal(players: RatingPlayer[], mains: DealMain[], capacity: number): Record<string, number> {
  const skill: Record<string, number> = Object.fromEntries(players.map((p) => [p.id, p.skill]));
  const rating = Object.fromEntries(players.map((p) => [p.id, p.rating]));
  const mainIds = new Set(mains.map((m) => m.id));
  const defenders = players.filter((p) => !mainIds.has(p.id));
  const table = tableFactor(capacity);

  for (const m of mains) {
    const k = strengthFactor(rating[m.id], defenders.map((d) => rating[d.id]));
    if (m.won) {
      const base = MAIN_WIN * m.risk + (m.garba ? GARBA_BONUS : 0);
      skill[m.id] = applySkill(skill[m.id], base, k, table);
    } else {
      skill[m.id] = applySkill(skill[m.id], MAIN_LOSS * m.risk, k);
      // Отбились: соперник для каждого противника — этот главный.
      for (const d of defenders) {
        skill[d.id] = applySkill(skill[d.id], DEFENDED, strengthFactor(rating[d.id], [rating[m.id]]));
      }
    }
  }
  return skill;
}

// Мастерство после окончания комнаты (§16.3). diff — итог игрока за комнату в монетах.
// leftIds — кто ушёл и не вернулся (§13): вместо итога комнаты у них −1.0 (§16.3a),
// без поправок на силу соперника и размер стола. Среди остальных они не считаются.
export function afterRoom(
  players: (RatingPlayer & { diff: number })[],
  winnerIds: string[],
  capacity: number,
  leftIds: string[] = [],
): Record<string, number> {
  const stayed = players.filter((p) => !leftIds.includes(p.id));
  const worst = Math.min(...stayed.map((p) => p.diff));
  const table = tableFactor(capacity);
  const result: Record<string, number> = {};

  for (const p of players) {
    if (leftIds.includes(p.id)) {
      result[p.id] = Math.max(0, p.skill + LEFT_GAME);
      continue;
    }
    const k = strengthFactor(p.rating, players.filter((o) => o.id !== p.id).map((o) => o.rating));
    let base = 0;
    if (winnerIds.includes(p.id)) base = ROOM_WINNER;
    else if (p.diff > 0) base = ROOM_PLUS;
    else if (p.diff < 0) base = p.diff === worst ? ROOM_BIGGEST_LOSER : ROOM_MINUS;
    result[p.id] = base === 0 ? p.skill : applySkill(p.skill, base, k, table);
  }
  return result;
}
