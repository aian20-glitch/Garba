// Проверки shah/cards.ts — колода, старшинство, очки, «чем бьётся» (SHAH_RULES.md §2, §6, §7, §10, §13).

import { check, section } from './check.js';
import {
  beats,
  CARD_POINTS,
  cardPoints,
  createShahDeck,
  findBeat,
  isLegalLead,
  matchCovers,
  pointsOf,
  rankPower,
  SHAH_RANKS,
  SHAH_SUITS,
} from '../src/shah/cards.js';
import { card, cards, ids } from './shah-helpers.js';

section('ШАХ: колода и старшинство');
const deck = createShahDeck();
check('36 карт', deck.length, 36);
check('все 36 разные', new Set(ids(deck)).size, 36);
check('по 9 карт каждой масти', SHAH_SUITS.map((s) => deck.filter((c) => c.suit === s).length), [9, 9, 9, 9]);
check('старшинство: Т > 10 > К > Д > В > 9 > 8 > 7 > 6', [...SHAH_RANKS].reverse(), ['A', '10', 'K', 'Q', 'J', '9', '8', '7', '6']);
check('десятка старше короля', rankPower('10') > rankPower('K'), true);
check('туз старше десятки', rankPower('A') > rankPower('10'), true);

section('ШАХ: очки карт');
check(
  'Т 11, 10 — 10, К 4, Д 3, В 2, 9…6 — 0',
  (['A', '10', 'K', 'Q', 'J', '9', '8', '7', '6'] as const).map((r) => CARD_POINTS[r]),
  [11, 10, 4, 3, 2, 0, 0, 0, 0],
);
check('вся колода — 120 очков', pointsOf(deck), 120);
check('ШАХ 6♣ — 0 очков', cardPoints(card('6♣')), 0);

section('ШАХ: чем бьётся карта (козырь ♠)');
check('козырный туз бьёт козырную десятку', beats(card('A♠'), card('10♠'), 'spades'), true);
check('козырная шестёрка бьёт обычную десятку другой масти', beats(card('6♠'), card('10♥'), 'spades'), true);
check('козырную десятку не побить слабым козырем: К♠', beats(card('K♠'), card('10♠'), 'spades'), false);
check('козырную десятку не побить слабым козырем: 6♠', beats(card('6♠'), card('10♠'), 'spades'), false);
check('козырную карту не побить обычной: А♥ на 6♠', beats(card('A♥'), card('6♠'), 'spades'), false);
check('10♥ бьётся тузом ♥', beats(card('A♥'), card('10♥'), 'spades'), true);
check('король ♥ десятку ♥ не бьёт', beats(card('K♥'), card('10♥'), 'spades'), false);
check('другая масть, не козырь — не бьёт: А♦ на 7♥', beats(card('A♦'), card('7♥'), 'spades'), false);
check('ШАХ на отбое бьёт 10♥', beats(card('6♣'), card('10♥'), 'spades'), true);
check('ШАХ на отбое бьёт козырного туза', beats(card('6♣'), card('A♠'), 'spades'), true);
check('ШАХ бьёт туза крестей, даже когда козырь ♣', beats(card('6♣'), card('A♣'), 'clubs'), true);
check('6♣ в заходе — обычная шестёрка: 7♣ её бьёт', beats(card('7♣'), card('6♣'), 'spades'), true);
check('6♣ в заходе бьётся козырем', beats(card('9♠'), card('6♣'), 'spades'), true);
check('6♣ в заходе бубной не побить', beats(card('A♦'), card('6♣'), 'spades'), false);

section('ШАХ: заход');
check('одна карта 10♥', isLegalLead(cards('10♥')), true);
check('две восьмёрки 8♥ 8♣', isLegalLead(cards('8♥ 8♣')), true);
check('четыре туза', isLegalLead(cards('A♠ A♥ A♦ A♣')), true);
check('три бубны разного достоинства', isLegalLead(cards('6♦ J♦ A♦')), true);
check('6♣ с другими крестями — можно (обычная карта)', isLegalLead(cards('6♣ K♣')), true);
check('разные масти и разные достоинства — нельзя', isLegalLead(cards('8♥ 9♣')), false);
check('три карты: две одной масти и одна другая — нельзя', isLegalLead(cards('8♥ 9♥ 9♣')), false);
check('пустой заход — нельзя', isLegalLead([]), false);

section('ШАХ: отбить несколько карт');
const top = cards('9♥ 9♦ 9♣');
const covers = cards('6♠ 7♠ J♥');
const matched = matchCovers(covers, top, 'spades');
check('три девятки: J♥ + два козыря — отбились', matched !== null, true);
check('J♥ накрывает именно 9♥ (козыри — остальные)', matched?.[2], 0);
check('каждое накрытие бьёт свою карту', matched?.every((j, i) => beats(covers[i], top[j], 'spades')), true);
check('одна карта не бьёт — не отбились: 8♥', matchCovers(cards('8♥ 6♠ 7♠'), top, 'spades'), null);
check('карт меньше, чем в заходе — нельзя', matchCovers(cards('6♠ 7♠'), top, 'spades'), null);
check('6♣ среди накрывающих бьёт любую из трёх', matchCovers(cards('6♣ 6♠ 7♠'), top, 'spades') !== null, true);

section('ШАХ: чем побить из руки');
check('самой дешёвой: на 9♥ из Т♥ В♥ 6♠ — В♥', ids(findBeat(cards('A♥ J♥ 6♠'), cards('9♥'), 'spades') ?? []), ['hearts-J']);
check('козырь раньше ШАХ: на 9♥ из 6♣ 6♠ — 6♠', ids(findBeat(cards('6♣ 6♠'), cards('9♥'), 'spades') ?? []), ['spades-6']);
check('козырного туза — только ШАХ', ids(findBeat(cards('7♠ 6♣'), cards('A♠'), 'spades') ?? []), ['clubs-6']);
check('нечем — null', findBeat(cards('7♥ 8♦'), cards('9♥'), 'spades'), null);
