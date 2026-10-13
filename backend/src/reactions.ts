// Реакции и смайлики (RULES.md §14, этап 9.7). Чистые функции.
//
// Текстового чата нет — только готовые смайлики. С 25.09.2026 (решение владельца) —
// в любой момент: в лобби, в торгах, в розыгрыше, после раздачи и после игры.

import { packOf } from './shop.js';

// Набор смайликов. Свои тексты слать нельзя — это был бы чат.
export const REACTIONS = ['👍', '👏', '😂', '😎', '😮', '🤔', '😭', '😡', '🔥', '🤝', '🙈', '🎉'] as const;
// Готовые фразы (09.10.2026, решение владельца): то, что чаще всего хочется сказать за столом.
// Тоже готовый набор, своих текстов нет. Шлются тем же полем emoji, с тем же ограничением частоты.
export const PHRASES = [
  'Жми ГОТОВ!',
  'Ходи быстрее!',
  'Раздавай!',
  'Удачи всем!',
  'Хорошая игра!',
  'Вот это ход!',
  'Не повезло…',
  'Повезло тебе!',
  'Ещё партию?',
  'Сейчас вернусь',
  'Спасибо!',
  'Рахмет!',
] as const;
// Ещё смайлики, фразы и стикеры — из наборов магазина (§17, 13.10.2026), только купившему.
export type Reaction = string;


export const REACTION_COOLDOWN_MS = 2_000; // не чаще раза в 2 секунды от игрока
export const REACTIONS_KEPT = 20; // сколько последних реакций помнит комната

export type ReactionEntry = { id: number; playerId: string; emoji: Reaction; at: number };

export type ReactionError = 'not now' | 'unknown emoji' | 'not owned' | 'too fast';

export function isReaction(value: unknown): value is Reaction {
  return (
    typeof value === 'string' &&
    ((REACTIONS as readonly string[]).includes(value) ||
      (PHRASES as readonly string[]).includes(value) ||
      packOf(value) !== null)
  );
}

// Добавить реакцию. Возвращает новый список или ошибку.
// id растёт — по нему клиент понимает, какие реакции новые, и показывает их один раз.
// ownedPacks — какие наборы магазина у игрока куплены (§17).
export function addReaction(
  list: ReactionEntry[],
  stage: string,
  playerId: string,
  emoji: unknown,
  now: number,
  ownedPacks: readonly string[] = [],
): ReactionEntry[] | ReactionError {
  void stage; // когда угодно (25.09.2026); стадия остаётся в подписи для журнала
  if (!isReaction(emoji)) return 'unknown emoji';
  const pack = packOf(emoji);
  if (pack && !ownedPacks.includes(pack)) return 'not owned';

  const last = [...list].reverse().find((r) => r.playerId === playerId);
  if (last && now - last.at < REACTION_COOLDOWN_MS) return 'too fast';

  const id = (list.at(-1)?.id ?? 0) + 1;
  return [...list, { id, playerId, emoji, at: now }].slice(-REACTIONS_KEPT);
}

// --- Ссылки-приглашения (ТЗ §4, §6) ---
// Проверка кода из ссылки: страница приглашения вставляет его в HTML,
// поэтому пропускаем только то, что может быть кодом.
export function isRoomCode(value: string): boolean {
  return /^\d{5}$/.test(value);
}

export function isPlayerCode(value: string): boolean {
  return /^[A-HJKMNP-Z2-9]{6}$/.test(value);
}
