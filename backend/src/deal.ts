// Открытие козыря перед раздачей: ИЗЖОГА и переоткрытие.
// Только чистые функции. Правила — RULES.md §5.

import { eligibleTrumpSuits } from './config.js';
import type { Card, Suit } from './types.js';

// Сколько раз можно открыть карту, пока не выйдет допустимая масть (RULES.md §5.2).
export const MAX_TRUMP_ATTEMPTS = 3;

// ИЗЖОГА — масть, которая в этом составе не может стать козырем.
// При 4 игроках ИЗЖОГИ нет: козырь всегда черви, а открытая некозырная карта
// просто лежит (§5.1). При 7 игроках козырем может стать любая масть (§5.3).
export function isIzzhoga(capacity: number, suit: Suit): boolean {
  if (capacity === 4) return false;
  return !eligibleTrumpSuits(capacity as 4 | 5 | 6 | 7).includes(suit);
}

export type TrumpOpening = {
  // Открытая карта, задающая РАЗ. null — ИЗЖОГА вышла все три раза, пересдача.
  openCard: Card | null;
  // Карты ИЗЖОГИ, которые открылись и вернулись в колоду, по порядку.
  izzhoga: Card[];
  // Колода после открытия: без открытой карты, но со всеми вернувшимися ИЗЖОГАМИ.
  deck: Card[];
};

// Открываем верхнюю карту. Вышла ИЗЖОГА — вбиваем её в середину колоды и открываем
// следующую, не больше трёх раз (§5.2). Колода не теряет карт: вернувшиеся ИЗЖОГИ
// остаются в ней, поэтому раздача по 5 сходится ровно.
//
// random — источник случайности для места, куда вбивается карта; в проверках
// его подменяют, чтобы результат был предсказуем.
export function openTrump(
  deck: Card[],
  capacity: number,
  random: () => number = Math.random,
): TrumpOpening {
  const rest = [...deck];
  const izzhoga: Card[] = [];

  for (let attempt = 0; attempt < MAX_TRUMP_ATTEMPTS; attempt++) {
    const card = rest.shift();
    if (!card) throw new Error('deck is empty');

    if (!isIzzhoga(capacity, card.suit)) {
      return { openCard: card, izzhoga, deck: rest };
    }

    // «Вбивается в середину»: не наверх, чтобы не открыть её же следующей,
    // и не в самый низ. Позиция от 1 до длина−1.
    izzhoga.push(card);
    const position = 1 + Math.floor(random() * Math.max(1, rest.length - 1));
    rest.splice(position, 0, card);
  }

  // Три ИЗЖОГИ подряд — раздача отменяется (§5.2).
  return { openCard: null, izzhoga, deck: rest };
}
