// Проверки deal.ts: открытие козыря, ИЗЖОГА, переоткрытие. Запуск всех проверок: npm test

import { check, section } from './check.js';
import { isIzzhoga, MAX_TRUMP_ATTEMPTS, openTrump } from '../src/deal.js';
import { createDeck, shuffle } from '../src/deck.js';
import type { Card, Rank, Suit } from '../src/types.js';

const c = (suit: Suit, rank: Rank): Card => ({ id: `${suit}-${rank}`, suit, rank });
const ids = (cards: Card[]) => cards.map((x) => x.id);

// Колода, где сверху лежат заданные карты, а дальше — остальные из настоящей колоды.
function deckWithTop(capacity: 4 | 5 | 6 | 7, top: Card[]): Card[] {
  const topIds = new Set(ids(top));
  return [...top, ...createDeck(capacity).filter((x) => !topIds.has(x.id))];
}

section('какая масть ИЗЖОГА (§3.1, §5)');
check('4 игрока: ИЗЖОГИ нет, даже у пик', isIzzhoga(4, 'spades'), false);
check('5 игроков: крести — ИЗЖОГА', isIzzhoga(5, 'clubs'), true);
check('5 игроков: пики — ИЗЖОГА', isIzzhoga(5, 'spades'), true);
check('5 игроков: бубны — не ИЗЖОГА', isIzzhoga(5, 'diamonds'), false);
check('6 игроков: крести уже не ИЗЖОГА', isIzzhoga(6, 'clubs'), false);
check('6 игроков: пики — ИЗЖОГА', isIzzhoga(6, 'spades'), true);
check('7 игроков: ИЗЖОГИ нет вообще', ['hearts', 'diamonds', 'clubs', 'spades'].some((s) => isIzzhoga(7, s as Suit)), false);
check('попыток открыть козырь — три', MAX_TRUMP_ATTEMPTS, 3);

section('открытие козыря (§5.2)');
const first = openTrump(deckWithTop(5, [c('hearts', '9')]), 5);
check('5 игроков, сверху ♥9 — сразу РАЗ, ИЗЖОГИ нет',
  [first.openCard?.id, first.izzhoga.length, first.deck.length], ['hearts-9', 0, 25]);

// Твой пример: открылся ♠K — ИЗЖОГА, вернулся в колоду; следующая ♦9 — годится.
const second = openTrump(deckWithTop(5, [c('spades', 'K'), c('diamonds', '9')]), 5, () => 0.5);
check('♠K — ИЗЖОГА, вернули в колоду; ♦9 — РАЗ бубны',
  [second.openCard?.id, ids(second.izzhoga)], ['diamonds-9', ['spades-K']]);
check('после этого на раздачу ровно 25 карт, и ♠K среди них',
  [second.deck.length, second.deck.some((x) => x.id === 'spades-K')], [25, true]);

const three = openTrump(
  deckWithTop(5, [c('spades', 'K'), c('clubs', 'J'), c('spades', 'A'), c('hearts', '6')]),
  5,
  () => 0.99, // вбиваем глубоко, чтобы вернувшаяся карта не открылась снова
);
check('три ИЗЖОГИ подряд — козыря нет, пересдача',
  [three.openCard, ids(three.izzhoga)], [null, ['spades-K', 'clubs-J', 'spades-A']]);
check('при пересдаче колода цела: все 26 карт на месте', three.deck.length, 26);

const fourPlayers = openTrump(deckWithTop(4, [c('spades', 'Q')]), 4);
check('4 игрока, открылась ♠Q — не ИЗЖОГА, просто лежит (козырь всё равно черви)',
  [fourPlayers.openCard?.id, fourPlayers.izzhoga.length], ['spades-Q', 0]);

section('вернувшаяся карта не открывается сразу снова');
let reopened = 0;
for (let i = 0; i < 1000; i++) {
  const r = openTrump(deckWithTop(5, [c('spades', 'K'), c('clubs', 'J'), c('spades', 'A')]), 5);
  // Первая открытая ИЗЖОГА — ♠K. Если бы её вбили наверх, она открылась бы второй.
  if (r.izzhoga[1]?.id === 'spades-K') reopened++;
}
check('1000 раз: ИЗЖОГУ никогда не вбивают наверх колоды', reopened, 0);

section('10 000 случайных раздач: колода всегда сходится');
for (const capacity of [4, 5, 6, 7] as const) {
  let broken = 0;
  let redeals = 0;
  const full = createDeck(capacity).length;

  for (let i = 0; i < 10_000; i++) {
    const r = openTrump(shuffle(createDeck(capacity)), capacity);
    const all = r.openCard ? [r.openCard, ...r.deck] : r.deck;
    const unique = new Set(ids(all)).size;

    if (all.length !== full || unique !== full) broken++;
    if (r.openCard && isIzzhoga(capacity, r.openCard.suit)) broken++;
    if (r.openCard && r.deck.length !== capacity * 5) broken++;
    if (!r.openCard) redeals++;
  }

  check(`${capacity} игроков: ни одна карта не потерялась и не задвоилась, на раздачу ровно ${capacity * 5}`, broken, 0);
  console.log(`      пересдач из-за трёх ИЗЖОГ: ${redeals} из 10 000`);
}
