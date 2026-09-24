// Реакции и смайлики (RULES.md §14, этап 9.7). Чистые функции.
//
// Текстового чата нет — только готовые смайлики. С 25.09.2026 (решение владельца) —
// в любой момент: в лобби, в торгах, в розыгрыше, после раздачи и после игры.

// Набор смайликов. Свои тексты слать нельзя — это был бы чат.
export const REACTIONS = ['👍', '👏', '😂', '😎', '😮', '🤔', '😭', '😡', '🔥', '🤝', '🙈', '🎉'] as const;
export type Reaction = (typeof REACTIONS)[number];


export const REACTION_COOLDOWN_MS = 2_000; // не чаще раза в 2 секунды от игрока
export const REACTIONS_KEPT = 20; // сколько последних реакций помнит комната

export type ReactionEntry = { id: number; playerId: string; emoji: Reaction; at: number };

export type ReactionError = 'not now' | 'unknown emoji' | 'too fast';

export function isReaction(value: unknown): value is Reaction {
  return typeof value === 'string' && (REACTIONS as readonly string[]).includes(value);
}

// Добавить реакцию. Возвращает новый список или ошибку.
// id растёт — по нему клиент понимает, какие реакции новые, и показывает их один раз.
export function addReaction(
  list: ReactionEntry[],
  stage: string,
  playerId: string,
  emoji: unknown,
  now: number,
): ReactionEntry[] | ReactionError {
  void stage; // когда угодно (25.09.2026); стадия остаётся в подписи для журнала
  if (!isReaction(emoji)) return 'unknown emoji';

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
