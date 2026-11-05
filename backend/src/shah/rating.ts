// Рейтинг ШАХ (SHAH_PLAN.md, этап 4, 05.11.2026; SHAH_RULES.md §19) — чистые функции.
//
// Отдельный от Гарбы (вопрос 21 «а»): своё мастерство ШАХ 0…8, начало 4.0; рейтинг Гарбы ШАХ не
// трогает, и наоборот. Числа — вопрос 22 «а» (ответа владельца ещё нет, все числа — здесь):
//   за партию — без штрафа +0.03, −2 → −0.01, −4 → −0.02, −12 → −0.04, ничья — 0;
//   за матч — победа +0.10, поражение −0.06; вся команда — одинаково;
//   формат (и на плюс, и на минус): 1×1 ×0.8, 1×1×1 ×1.0, 2×2 ×1.2, 3×3 ×1.4;
//   время за столом: до 10 минут — 0, 10 ×0.3, 20 ×0.5, 30 ×0.7, 45 ×0.85, с часа ×1.0;
//   за один стол рейтинг падает не больше чем на 0.25; сила соперника и стабильность — как в
//   Гарбе (RULES.md §16.4, §16.5, §16.7).
//
// Как в Гарбе (§16.3b), за столом рейтинг не меняется: изменения партий и матча копятся, в конце
// матча становятся мастерством — накопленное × время игры, потеря не больше 0.25.

import { masteryStability, strengthFactor, MAX_SKILL, START_SKILL } from '../rating.js';
import { sideOf, type ShahFormat } from './engine.js';

export const SHAH_START_SKILL = START_SKILL; // 4.0 — как у нового игрока Гарбы
export const SHAH_MAX_SKILL = MAX_SKILL; // 8 — стабильность (§16.5 Гарбы) считается от 8

// За партию — по штрафу своей стороны (при 3 — своему).
export const PARTY_CLEAN = 0.03;
const PARTY_PENALTY: Record<number, number> = { [-2]: -0.01, [-4]: -0.02, [-12]: -0.04 };

// За матч.
export const MATCH_WIN = 0.1;
export const MATCH_LOSS = -0.06;

// Формат: командная игра ценнее одиночной (слова владельца: «1×1 поменьше, 1×1×1 средний, 2×2
// больше средней, 3×3 больше»).
const FORMAT_FACTOR: Record<number, number> = { 2: 0.8, 3: 1.0, 4: 1.2, 6: 1.4 };

export function formatFactor(format: ShahFormat): number {
  return FORMAT_FACTOR[format] ?? 1;
}

// Время за столом: «до 10 минут рейтинга нет, максимум — с часа».
const TIME_STEPS: [number, number][] = [
  [60, 1.0],
  [45, 0.85],
  [30, 0.7],
  [20, 0.5],
  [10, 0.3],
];

export const SHAH_ROOM_MAX_LOSS = 0.25;

// minuteMs — сколько миллисекунд в «минуте» (для живых проверок — меньше).
export function shahTimeMultiplier(activeMs: number, minuteMs = 60_000): number {
  const minutes = activeMs / minuteMs;
  for (const [from, mult] of TIME_STEPS) if (minutes >= from) return mult;
  return 0;
}

// База за партию по штрафу. После ничьей штраф умножен (×2), рейтинг смотрит на сам штраф:
// −8 после ничьей — это −4 (решено при реализации: ×2 рейтинг партии не удваивает).
export function partyBase(penalty: number, multiplier: number, draw: boolean): number {
  if (draw) return 0;
  const own = penalty / (multiplier || 1);
  if (own === 0) return PARTY_CLEAN;
  return PARTY_PENALTY[own] ?? 0;
}

// Итог матча для места: win | lose | none (при 3 по варианту «б» вопроса 16) | draw (время
// вышло при равном счёте). «Ни то ни другое» и ничья рейтинг матча не меняют.
export function matchBase(outcome: string | undefined): number {
  return outcome === 'win' ? MATCH_WIN : outcome === 'lose' ? MATCH_LOSS : 0;
}

// Игрок за столом: мастерство ШАХ на начало матча (сила соперника и стабильность — по нему,
// как в Гарбе: «рейтинги — на начало комнаты»).
export type ShahRated = { id: string; seat: number; skill: number };

function opponentSkills(format: ShahFormat, players: ShahRated[], me: ShahRated): number[] {
  const side = sideOf(format, me.seat);
  return players.filter((p) => sideOf(format, p.seat) !== side).map((p) => p.skill);
}

// Изменение одного игрока по базе (§16.7 Гарбы): прибавка × сила соперников k, потеря × (2 − k);
// обе — × стабильность и × формат.
export function shahDelta(base: number, me: ShahRated, opponents: number[], format: ShahFormat): number {
  if (base === 0) return 0;
  const k = strengthFactor(me.skill, opponents);
  return base * (base > 0 ? k : 2 - k) * masteryStability(me.skill) * formatFactor(format);
}

// За партию: каждому — по штрафу его стороны. penalties — штрафы сторон партии (PartyResult).
export function partyDeltas(
  format: ShahFormat,
  players: ShahRated[],
  party: { penalties: number[]; multiplier: number; draw: boolean },
): Record<string, number> {
  return Object.fromEntries(
    players.map((p) => {
      const base = partyBase(party.penalties[sideOf(format, p.seat)] ?? 0, party.multiplier, party.draw);
      return [p.id, shahDelta(base, p, opponentSkills(format, players, p), format)];
    }),
  );
}

// За матч: победа +0.10, поражение −0.06 — всей стороне одинаково.
export function matchRatingDeltas(
  format: ShahFormat,
  players: ShahRated[],
  outcomes: Record<string, string>,
): Record<string, number> {
  return Object.fromEntries(
    players.map((p) => [p.id, shahDelta(matchBase(outcomes[p.id]), p, opponentSkills(format, players, p), format)]),
  );
}

// Мастерство после стола: накопленное × время игры, потеря — не больше 0.25, итог — 0…8.
export function settleShah(skill: number, pending: number, activeMs: number, minuteMs = 60_000): number {
  const delta = Math.max(-SHAH_ROOM_MAX_LOSS, pending * shahTimeMultiplier(activeMs, minuteMs));
  return Math.min(SHAH_MAX_SKILL, Math.max(0, skill + delta));
}
