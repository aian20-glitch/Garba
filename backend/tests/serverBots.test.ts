// Проверки serverBots.ts: боты сервера — кнопка «ДОБАВИТЬ БОТОВ» (27.09.2026). Запуск: npm test

import { check, section } from './check.js';
import { botAction, botTopUp, BOT_NAMES, freeBotName, wantsRaz } from '../src/serverBots.js';

const bot = 'bot-1';

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
check('в торгах — только из разрешённого сервером',
  botAction(bot, { status: 'started', game: { stage: 'bidding', myAllowedBids: ['ПАС'], hand: [], razSuit: 'hearts' } })?.body,
  { bid: 'ПАС' });
check('в розыгрыше — первая разрешённая карта',
  botAction(bot, { status: 'started', game: { stage: 'playing', myPlayableCardIds: ['hearts-A', 'clubs-6'] } })?.body,
  { cardId: 'hearts-A' });
check('спецкарту не берёт — пас', botAction(bot, { status: 'started', game: { stage: 'special', special: { activeId: bot } } })?.body,
  { action: 'pass' });
check('голосует «делим» — решает живой игрок',
  botAction(bot, { status: 'started', game: { stage: 'vote' } })?.body, { choice: 'split' });
check('закончить игру по согласию — согласен',
  botAction(bot, { status: 'started', game: { stage: 'playing', endVote: {} } })?.body, { choice: 'yes' });
check('РАЗ при трёх козырях', wantsRaz([{ suit: 'hearts', rank: '6' }, { suit: 'hearts', rank: '7' }, { suit: 'hearts', rank: '8' }], 'hearts'), true);
check('два козыря без старшего — ПАС', wantsRaz([{ suit: 'hearts', rank: '6' }, { suit: 'hearts', rank: '7' }], 'hearts'), false);

section('боты сервера: монеты и имена');
check('новому боту — до 30 000', botTopUp(30_000, 1_000, 30_000), 0);
check('проиграл — доложить до 30 000', botTopUp(4_500, 1_000, 30_000), 25_500);
check('выиграл — не забираем', botTopUp(52_000, 1_000, 30_000), 0);
check('имена начинаются с «Бот»', BOT_NAMES.every((n) => n.startsWith('Бот ')), true);
check('имя — которого нет за столом', freeBotName(['Серик', 'Бот Айдар']), 'Бот Дана');
