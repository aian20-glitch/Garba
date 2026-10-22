// Проверки serverBots.ts: боты сервера — кнопка «ДОБАВИТЬ БОТОВ» (27.09.2026). Запуск: npm test

import { check, section } from './check.js';
import { botAction, botTopUp, BOT_NAMES, chooseBid, chooseCard, chooseDiscard, freeBotName, specialRisk, wantsRaz } from '../src/serverBots.js';

const bot = 'bot-1';
const card = (id: string) => { const [suit, rank] = id.split('-'); return { id, suit, rank }; };
const hand = (ids: string) => ids.split(' ').map(card);

section('боты сервера: что делают');
check('лобби набралось — жмёт «ГОТОВ»',
  botAction(bot, { status: 'lobby', readyCheck: { readyIds: [] } })?.path, 'ready');
check('уже нажал — ничего', botAction(bot, { status: 'lobby', readyCheck: { readyIds: [bot] } }), null);
check('на паузе не ходит', botAction(bot, { status: 'started', pause: { players: [] }, game: { stage: 'bidding' } }), null);
check('ждём замену ушедшему — «закончить игру» поддерживает',
  botAction(bot, { status: 'started', pause: { players: [], vacancies: [{ seat: 2 }] }, game: { stage: 'round_done', endVote: {} } })?.body,
  { choice: 'yes' });
check('кто-то за столом отключился — бот и не голосует',
  botAction(bot, { status: 'started', pause: { players: [{ id: 'x' }] }, game: { stage: 'round_done', endVote: {} } }), null);
check('раздаёт, только если раздающий он',
  [botAction(bot, { status: 'started', game: { stage: 'round_done', dealerId: bot } })?.path,
    botAction(bot, { status: 'started', game: { stage: 'round_done', dealerId: 'x' } })],
  ['dealer/continue', null]);
check('кто-то просит докупить (§9.1c) — бот не голосует и не раздаёт, пока ждём ответа людей',
  botAction(bot, { status: 'started', game: { stage: 'round_done', dealerId: bot, topUpVote: { requesterId: 'x' } } }), null);
check('в торгах — только из разрешённого сервером',
  botAction(bot, { status: 'started', game: { stage: 'bidding', myAllowedBids: ['ПАС'], hand: [], razSuit: 'hearts' } })?.body,
  { bid: 'ПАС' });
check('в розыгрыше — только из разрешённых сервером',
  botAction(bot, { status: 'started', game: { stage: 'playing', myPlayableCardIds: ['clubs-6'], hand: [card('hearts-A'), card('clubs-6')] } })?.body,
  { cardId: 'clubs-6' });
check('спецкарту вслепую не берёт — пас',
  botAction(bot, { status: 'started', game: { stage: 'special', mySpecialRisks: [1], special: { activeId: bot, phase: 'blind', kind: 'A', card: card('hearts-A') } } })?.body,
  { action: 'pass' });
check('голосует «делим» — решает живой игрок',
  botAction(bot, { status: 'started', game: { stage: 'vote' } })?.body, { choice: 'split' });
check('закончить игру по согласию — согласен',
  botAction(bot, { status: 'started', game: { stage: 'playing', endVote: {} } })?.body, { choice: 'yes' });
check('ГАРБА — всегда РАЗ', wantsRaz(hand('hearts-Q hearts-K hearts-A clubs-J spades-J'), 'hearts', true), true);
check('туз, король и младший козырь — РАЗ', wantsRaz(hand('hearts-A hearts-K hearts-7 clubs-J spades-J'), 'hearts'), true);
check('три младших козыря без тузов — ПАС', wantsRaz(hand('hearts-6 hearts-7 hearts-8 clubs-J spades-J'), 'hearts'), false);
check('два козыря без старшего — ПАС', wantsRaz(hand('hearts-6 hearts-7 clubs-J spades-J diamonds-J'), 'hearts'), false);
check('второй РАЗ — нужна рука сильнее',
  [wantsRaz(hand('hearts-A hearts-K hearts-7 clubs-J spades-J'), 'hearts', true),
    wantsRaz(hand('hearts-A hearts-K hearts-Q hearts-7 spades-J'), 'hearts', true)],
  [false, true]);

section('боты сервера: заявки');
check('слабая масть РАЗ, сильная своя — ДВА в своей масти',
  chooseBid({ myAllowedBids: ['РАЗ', 'ДВА', 'ПАС'], razSuit: 'hearts', myDvaSuitOptions: ['diamonds', 'clubs'],
    hand: hand('clubs-A clubs-K clubs-9 hearts-6 spades-J') }),
  { bid: 'ДВА', suit: 'clubs' });
check('на РАЗ нет денег, рука сильная — КОН',
  chooseBid({ myAllowedBids: ['КОН', 'ПАС'], razSuit: 'hearts', myDvaSuitOptions: [],
    hand: hand('hearts-A hearts-K hearts-10 clubs-6 spades-J') }),
  { bid: 'КОН' });
check('слабая рука — ПАС',
  chooseBid({ myAllowedBids: ['РАЗ', 'ПАС'], razSuit: 'hearts', hand: hand('hearts-6 clubs-J clubs-Q spades-J diamonds-Q') }),
  { bid: 'ПАС' });
check('КОН называет козырь в сильной масти',
  botAction(bot, { status: 'started', game: { stage: 'kon_trump', hand: hand('diamonds-A diamonds-K diamonds-8 hearts-6 spades-J'),
    myKonTrumpOptions: [{ suit: 'hearts', as: 'РАЗ' }, { suit: 'diamonds', as: 'ДВА' }] } })?.body,
  { suit: 'diamonds' });

section('боты сервера: спецкарта');
const sp = (kind: string, cardId: string, risks: number[], visible: string) => ({
  special: { phase: 'window', kind, card: card(cardId), activeId: bot }, mySpecialRisks: risks, hand: hand(visible) });
check('король, видна козырная дама — берёт за ×2', specialRisk(sp('K', 'hearts-K', [2, 3, 4, 5], 'hearts-Q')), 2);
check('король, видна младшая не козырь — пас', specialRisk(sp('K', 'hearts-K', [2, 3, 4, 5], 'clubs-9')), null);
check('перебили до ×3 — дальше не борется', specialRisk(sp('K', 'hearts-K', [4, 5], 'hearts-A')), null);
check('шестёрка, видна козырная дама — берёт за ×1', specialRisk(sp('6', 'hearts-6', [1], 'hearts-Q')), 1);
check('шестёрка, видна козырная десятка — пас', specialRisk(sp('6', 'hearts-6', [1], 'hearts-10')), null);
check('сбрасывает самую слабую, козыри бережёт',
  chooseDiscard({ myDiscardOptions: ['hearts-7', 'clubs-J', 'spades-Q', 'hearts-A'], special: { card: card('hearts-K') },
    hand: hand('hearts-7 clubs-J spades-Q hearts-A hearts-K') }),
  'clubs-J');

section('боты сервера: розыгрыш');
// 4 игрока: места me → p2 → p3 → p4; козырь — черви.
const table = (game: Record<string, unknown>) => ({
  capacity: 4, players: [{ id: bot }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }],
  game: { trumpSuit: 'hearts', playedTricks: [], concededIds: [], ...game },
});
const t = (playerId: string, id: string) => ({ playerId, card: card(id) });
check('главный первым — старший козырь, выбивает козыри',
  chooseCard(bot, table({ mains: [{ playerId: bot }], currentTrick: [], openCard: card('hearts-10'),
    hand: hand('hearts-A hearts-9 clubs-J spades-Q diamonds-K'),
    myPlayableCardIds: ['hearts-A', 'hearts-9', 'clubs-J', 'spades-Q', 'diamonds-K'] })),
  'hearts-A');
check('противник первым — туз сбоку, которого не перебить мастью',
  chooseCard(bot, table({ mains: [{ playerId: 'p3' }], currentTrick: [], openCard: card('hearts-10'),
    hand: hand('clubs-A hearts-7 spades-J diamonds-Q diamonds-J'),
    myPlayableCardIds: ['clubs-A', 'hearts-7', 'spades-J', 'diamonds-Q', 'diamonds-J'] })),
  'clubs-A');
check('взятку берёт свой, главный уже сходил — слабую карту',
  chooseCard(bot, table({ mains: [{ playerId: 'p3' }], currentTrick: [t('p3', 'clubs-J'), t('p4', 'clubs-A')],
    hand: hand('clubs-K clubs-Q hearts-7'), myPlayableCardIds: ['clubs-K', 'clubs-Q'] })),
  'clubs-Q');
check('главный берёт, после бота — только свои: младшей бьющей',
  chooseCard(bot, table({ mains: [{ playerId: 'p4' }], currentTrick: [t('p3', 'spades-J'), t('p4', 'spades-Q')],
    hand: hand('spades-K spades-A diamonds-J'), myPlayableCardIds: ['spades-K', 'spades-A'] })),
  'spades-K');
check('нечем перебить главного — слабую',
  chooseCard(bot, table({ mains: [{ playerId: 'p4' }], currentTrick: [t('p3', 'spades-J'), t('p4', 'spades-A')],
    hand: hand('spades-K spades-Q diamonds-J'), myPlayableCardIds: ['spades-K', 'spades-Q'] })),
  'spades-Q');
check('нет масти — главного бьёт младшим козырем, если последний',
  chooseCard(bot, table({ mains: [{ playerId: 'p2' }], currentTrick: [t('p2', 'spades-A'), t('p3', 'spades-J'), t('p4', 'spades-Q')],
    hand: hand('hearts-K hearts-6 diamonds-J'), myPlayableCardIds: ['hearts-K', 'hearts-6'] })),
  'hearts-6');
check('свой берёт старшей из оставшихся, главный после — не перебивает своего',
  chooseCard(bot, table({ mains: [{ playerId: 'p2' }], currentTrick: [t('p3', 'diamonds-J'), t('p4', 'diamonds-Q')],
    openCard: card('hearts-10'), hand: hand('diamonds-K diamonds-A clubs-J'), myPlayableCardIds: ['diamonds-K', 'diamonds-A'] })),
  'diamonds-K');
check('свой берёт слабой, главный после — перебивает картой, которую не перебить',
  chooseCard(bot, { ...table({ mains: [{ playerId: 'p2' }], currentTrick: [t('p3', 'diamonds-9'), t('p4', 'diamonds-J')],
    openCard: card('hearts-10'), hand: hand('diamonds-7 diamonds-A clubs-J'), myPlayableCardIds: ['diamonds-7', 'diamonds-A'] }), capacity: 7 }),
  'diamonds-A');

section('боты сервера: монеты и имена');
check('новому боту — до 30 000', botTopUp(30_000, 1_000, 30_000), 0);
check('проиграл — доложить до 30 000', botTopUp(4_500, 1_000, 30_000), 25_500);
check('выиграл — не забираем', botTopUp(52_000, 1_000, 30_000), 0);
check('имена начинаются с «Бот»', BOT_NAMES.every((n) => n.startsWith('Бот ')), true);
check('имя — которого нет за столом', freeBotName(['Серик', 'Бот Айдар']), 'Бот Дана');
