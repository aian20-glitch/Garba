// Штрафы и конец матча ШАХ (SHAH_RULES.md §14–§16). Чистые функции.
//
// Штрафы — отрицательные числа: −12, −4, −2. Счёт стороны копится от 0 вниз; кто дошёл до −24
// или ниже — проиграл матч (ровно в −24 попадать не нужно).

import { TOTAL_POINTS } from './cards.js';

export const MATCH_LIMIT = -24;

export type SideResult = 'win' | 'lose' | 'none';

// §14 — при 2, 4 и 6 игроках штраф получает проигравшая сторона, по своим очкам.
// Решают очки, а не число карт: взял карты, но все по 0 очков — тоже −12.
export function penaltyTwoSides(loserPoints: number): number {
  if (loserPoints === 0) return -12;
  if (loserPoints <= 40) return -4;
  return -2; // 41…59
}

// §15 — при 3 игроках штраф получает каждый, по своим очкам.
export function penaltyThree(points: number): number {
  if (points === 0) return -12;
  if (points <= 20) return -4;
  if (points <= 40) return -2;
  return 0; // 41 и больше
}

// Итог партии: points — очки сторон (2 стороны при 2/4/6, три при 3), multiplier — ×1, а после
// ничьей ×2 (или больше — см. nextMultiplier). Ничья (60:60, 40:40:40) — штрафов нет.
export function partyOutcome(points: number[], multiplier: number): { draw: boolean; penalties: number[] } {
  if (points.length !== 2 && points.length !== 3) throw new Error('ШАХ: две или три стороны');
  const total = points.reduce((a, b) => a + b, 0);
  if (total !== TOTAL_POINTS) throw new Error(`ШАХ: очков ${total}, а должно быть ${TOTAL_POINTS}`);
  if (points.length === 2) {
    if (points[0] === points[1]) return { draw: true, penalties: [0, 0] };
    const loser = points[0] < points[1] ? 0 : 1;
    const penalties = [0, 0];
    penalties[loser] = penaltyTwoSides(points[loser]) * multiplier;
    return { draw: false, penalties };
  }
  if (points.every((p) => p === 40)) return { draw: true, penalties: [0, 0, 0] };
  return { draw: false, penalties: points.map((p) => penaltyThree(p) * multiplier || 0) };
}

// Множитель для следующей партии (§14, §15). Удваиваются новые штрафы, не накопленный счёт.
// После результативной партии — снова ×1. Две ничьи подряд — вопрос 15 владельцу:
// 'fixed' — всё равно ×2, 'stacking' — ×2, ×4, ×8…
export function nextMultiplier(current: number, wasDraw: boolean, mode: 'fixed' | 'stacking'): number {
  if (!wasDraw) return 1;
  return mode === 'stacking' ? current * 2 : 2;
}

// Конец матча (§16): null — играем дальше. Иначе — итог каждой стороны.
// При 2 сторонах до −24 дойти может только одна (штраф в партии получает одна сторона).
// При 3 — вопрос 16 владельцу: 'both' — проиграли все, кто дошёл до −24, остальные выиграли;
// 'best' — проиграл тот, у кого штрафов больше всех (поровну — оба), выиграл тот, у кого меньше
// всех (поровну — оба), остальные — ни то ни другое.
export function matchResult(totals: number[], mode: 'both' | 'best'): SideResult[] | null {
  const reached = totals.map((t) => t <= MATCH_LIMIT);
  if (!reached.some(Boolean)) return null;
  if (mode === 'both' || totals.length === 2) return reached.map((r) => (r ? 'lose' : 'win'));
  const worst = Math.min(...totals);
  const best = Math.max(...totals);
  return totals.map((t) => (t === worst ? 'lose' : t === best ? 'win' : 'none'));
}
