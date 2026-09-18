import express from 'express';
import cors from 'cors';

import { STARTING_COINS } from './config.js';
import { createDeck, shuffle } from './deck.js';
import { openTrump } from './deal.js';
import type { Card, Suit } from './types.js';
import {
  baseKon,
  cheapestStake,
  COIN_STEP,
  collectAnte,
  ENTRY_STEP,
  konAvailable,
  konUnlockAt,
  lowestEntryFor,
  MAX_ENTRY,
  MAX_ANTE,
  MAX_EMPTY_LIMIT,
  MAX_KON_THRESHOLD,
  MIN_ANTE,
  MIN_EMPTY_LIMIT,
  MIN_KON_THRESHOLD,
  nobodyCanPlay,
  settleRound,
  splitKon,
  someoneBelowBase,
  stakeFor,
} from './money.js';
import {
  allowedBidsFor,
  dvaSuitOptions,
  isBiddingOver,
  konTrumpOptions,
  razSuitFor,
  resolveBidding,
  type Bid,
  type BidEntry,
  type Capacity,
  type MainPlayer,
  type Wallet,
} from './bidding.js';
import { dealsUntilNextVote, tallyVote, type VoteChoice } from './vote.js';
import {
  firstLeader,
  countsAsGarba,
  instantWinIndex,
  mainStatus,
  nextSeat,
  playableCards,
  TRICKS_PER_ROUND,
  winnerOfTrick,
  type TrickCard,
} from './play.js';

type Player = {
  id: string;
  name: string;
  ready: boolean;
  joinedAt: number;
  // Аккаунтов пока нет (этап 9), поэтому баланс живёт в комнате:
  // каждый входит со стартовыми 10 000, как новый аккаунт по ТЗ.
  balance: number;
  startBalance: number;
};

// finished — комната закрыта, играть в ней больше нельзя (RULES.md §12).
type RoomStatus = 'lobby' | 'started' | 'finished';

// Настройки, которые выбирает создатель комнаты (RULES.md §9.1, §9.3, §6.7).
type RoomSettings = {
  ante: number; // взнос, 100…1000, кратен 100
  emptyLimit: number; // лимит пустых раздач подряд, 3…10
  konThreshold: number; // КОН открывается при коне ≥ базовый × это число, 3…10
  minBalance: number; // минимум денег для входа, 1 000…10 000, не меньше взноса × 10
};

type RevealCard = Card & {
  playerId: string;
  playerName: string;
};

// dealer_found  — первый раздающий найден вскрытием на туза, ждём раздачи
// bidding       — карты розданы, идут торги
// playing       — главный определён, идёт розыгрыш 5 взяток
// round_done    — раздача сыграна, деньги посчитаны, следующий раздающий должен раздать
// awaiting_deal — пересдача: все спасовали, новый раздающий должен раздать
// kon_trump     — торги выиграл КОН, он называет козырь: РАЗ или ДВА (§6.7)
// vote          — кон не по карману никому: голосуем, продолжаем или делим (§12.2)
// room_done     — комната закрыта: кон забрали (§12.1) или поделили по голосованию (§12.2)
type Stage =
  | 'dealer_found'
  | 'bidding'
  | 'kon_trump'
  | 'playing'
  | 'round_done'
  | 'awaiting_deal'
  | 'vote'
  | 'room_done';

type MainResult = MainPlayer & {
  tricks: number;
  won: boolean;
  delta: number; // сколько монет получил (+) или положил в кон (−)
  // Выиграл сразу, без розыгрыша: дама, король и туз козыря на руках (§8).
  instant: boolean;
  // Это ГАРБА — только при РАЗ и КОНЕ: анимация и статистика. При ДВА — нет.
  garba: boolean;
};

// Пустая раздача — никто не играет: все спасовали (§6.5) или три раза подряд
// открылась ИЗЖОГА (§5.2). В обоих случаях пересдача с доливкой (§9.2, §9.3).
type EmptyRoundReason = 'all_pass' | 'three_izzhoga';

// Последний взнос в кон — чтобы игроки видели, откуда взялись деньги.
type AnteRecord = {
  reason: 'kon_empty' | EmptyRoundReason;
  perPlayer: number;
  total: number;
  // Доливают все или никто: если у кого-то не хватило денег, не доливал никто.
  skipped: boolean;
  // У кого не хватило денег на взнос — из-за них доливка и отключилась.
  brokePlayerIds: string[];
};

type GameState = {
  stage: Stage;
  dealerId: string;
  dealerName: string;
  revealLog: RevealCard[];

  // Открытая карта и козырь — разные вещи. При 4 игроках козырь всегда черви,
  // а открытая некозырная карта просто лежит (RULES.md §5.1).
  openCard: Card | null;
  // Масть РАЗ — известна сразу после раздачи.
  razSuit: Suit | null;
  // Итоговый козырь раздачи — известен только после торгов (ДВА может его сменить).
  trumpSuit: Suit | null;
  // Главные игроки: один, либо двое при двух РАЗ.
  mains: MainPlayer[];
  // Почему сейчас пересдача: все спасовали или три ИЗЖОГИ подряд.
  lastRedeal: EmptyRoundReason | null;
  // Карты ИЗЖОГИ, которые открылись в этой раздаче и вернулись в колоду (§5.2).
  // Их видели все, поэтому они открыты.
  izzhoga: Card[];
  // Масть, которую выбрал сказавший ДВА при 6–7 игроках. СКРЫТА от остальных
  // до начала розыгрыша (§6.3): в публичное состояние не попадает никогда —
  // когда ДВА становится главным, она раскрывается через trumpSuit.
  dvaSuit: Suit | null;
  // Выиграл КОН — как он назвал козырь: по РАЗ (масть РАЗ) или по ДВА (§6.7).
  konAs: 'РАЗ' | 'ДВА' | null;

  // Розыгрыш.
  turnPlayerId: string | null;
  trickNumber: number; // 1…5
  currentTrick: TrickCard[];
  // Последняя завершённая взятка — чтобы все успели увидеть, кто её забрал.
  lastTrick: { cards: TrickCard[]; winnerId: string; winnerName: string } | null;
  tricksWon: Record<string, number>;
  result: MainResult[] | null;

  // Деньги.
  kon: number;
  konBeforeSettlement: number | null;
  // Пустые раздачи подряд (все ПАС). Сбрасывается, когда кто-то сыграл (§9.3).
  emptyStreak: number;
  lastAnte: AnteRecord | null;
  // Кто-то опустился ниже базового кона — доигрываем, пока кон не заберут (§12.1).
  closing: boolean;
  // Почему закрылась комната: кон забрали (§12.1) или кон никто не может взять
  // и его поделили поровну (§12.2).
  closeReason: 'kon_taken' | 'nobody_can_play' | null;
  // Идущее голосование. resumeStage — куда вернуться, если решат продолжать.
  vote: {
    votes: Record<string, VoteChoice>;
    resumeStage: 'round_done' | 'awaiting_deal';
    cheapest: number;
  } | null;
  // Итог последнего голосования — чтобы все видели, чем оно закончилось.
  lastVote: { result: VoteChoice; continueVotes: number; splitVotes: number } | null;
  // Сколько раздач прошло после решения «продолжаем». Снова голосуем не раньше
  // чем через круг (§12.2). null — решения «продолжаем» ещё не было.
  dealsSinceContinue: number | null;
  split: {
    kon: number;
    perPlayer: number;
    remainder: number;
    remainderTo: string | null;
  } | null;

  hands: Record<string, Card[]>;
  bids: BidEntry[];
  bidOrder: string[];
  bidIndex: number;
  activeBidderId: string | null;
};

type Room = {
  id: string;
  capacity: number;
  creatorId: string;
  settings: RoomSettings;
  players: Player[];
  status: RoomStatus;
  createdAt: number;
  game?: GameState;
};

const app = express();
const PORT = 3000;
const rooms = new Map<string, Room>();

app.use(cors());
app.use(express.json());

function makeRoomId(): string {
  let id = '';
  do {
    id = String(Math.floor(10000 + Math.random() * 90000));
  } while (rooms.has(id));
  return id;
}

function makeDealerSelection(room: Room): GameState {
  // Выбор первого раздающего: карты открываются по кругу до первого туза (RULES.md §4).
  // Вскрытие идёт по местам за столом — room.players к этому моменту уже перетасован.
  // Состав колоды для вскрытия правилами не оговорён, берём полную (36 карт).
  const deck = shuffle(createDeck(7));
  const revealLog: RevealCard[] = [];
  let dealer = room.players[0];

  for (let i = 0; i < deck.length; i++) {
    const player = room.players[i % room.players.length];
    const card = deck[i];

    revealLog.push({
      ...card,
      playerId: player.id,
      playerName: player.name,
    });

    if (card.rank === 'A') {
      dealer = player;
      break;
    }
  }

  return {
    stage: 'dealer_found',
    dealerId: dealer.id,
    dealerName: dealer.name,
    revealLog,
    openCard: null,
    razSuit: null,
    trumpSuit: null,
    mains: [],
    lastRedeal: null,
    izzhoga: [],
    dvaSuit: null,
    konAs: null,
    ...emptyPlayState(),
    hands: {},
    bids: [],
    bidOrder: [],
    bidIndex: 0,
    activeBidderId: null,
    kon: 0,
    konBeforeSettlement: null,
    emptyStreak: 0,
    lastAnte: null,
    closing: false,
    closeReason: null,
    split: null,
    vote: null,
    lastVote: null,
    dealsSinceContinue: null,
  };
}

// Базовый кон комнаты = игроки × взнос.
function roomBaseKon(room: Room): number {
  return baseKon(room.players.length, room.settings.ante);
}

// Баланс игрока и стоимость каждой заявки при текущем коне — для проверки,
// хватает ли ему денег заявиться (RULES.md §6.6).
function walletOf(room: Room, playerId: string): Wallet {
  const player = room.players.find((p) => p.id === playerId);
  const kon = room.game?.kon ?? 0;
  const base = roomBaseKon(room);
  return {
    balance: player?.balance ?? 0,
    razStake: stakeFor('РАЗ', kon, base),
    dvaStake: stakeFor('ДВА', kon, base),
    // КОН открыт, только когда кон дорос до порога (§6.7), и стоит базовый кон.
    konStake: konAvailable(kon, base, room.settings.konThreshold)
      ? stakeFor('КОН', kon, base)
      : null,
  };
}

// Все вносят взнос в кон.
function takeAnte(room: Room, reason: AnteRecord['reason']) {
  const game = room.game!;
  const ante = room.settings.ante;
  const balances = Object.fromEntries(room.players.map((p) => [p.id, p.balance]));
  const { paid, total, brokePlayerIds } = collectAnte(balances, ante);

  for (const p of room.players) {
    p.balance -= paid[p.id];
  }
  game.kon += total;
  game.lastAnte = {
    reason,
    perPlayer: ante,
    total,
    skipped: brokePlayerIds.length > 0,
    brokePlayerIds,
  };

  updateClosing(room);
}

// Как только у кого-то баланс ниже базового кона, комната доигрывает последний
// кон: новых конов не будет, играем, пока текущий кто-нибудь не заберёт (§12).
function updateClosing(room: Room) {
  const game = room.game!;
  if (game.closing) return;
  const balances = room.players.map((p) => p.balance);
  if (someoneBelowBase(balances, roomBaseKon(room))) {
    game.closing = true;
    console.log(`[ROOM ${room.id}] someone is below base kon, playing the last kon`);
  }
}

// Кон никто не может взять — ни у кого не хватает даже на самую дешёвую заявку.
// Тогда игра останавливается на голосование: продолжаем или делим (RULES.md §12.2).
// Вызывать, когда раздача закончилась и следующая ещё не роздана.
function startVoteIfNobodyCanPlay(room: Room) {
  const game = room.game!;
  if (game.kon === 0) return; // пустой кон заново соберут взносом
  if (game.stage !== 'round_done' && game.stage !== 'awaiting_deal') return;

  // Смотрим только на РАЗ и ДВА: заявка КОН голосованию не мешает (§12.2).
  const cheapest = cheapestStake(room.capacity, game.kon, roomBaseKon(room));
  const balances = room.players.map((p) => p.balance);
  if (!nobodyCanPlay(balances, cheapest)) return;

  // Недавно решили продолжать — ждём, пока раздача обойдёт круг (§12.2).
  if (dealsUntilNextVote(game.dealsSinceContinue, room.players.length) > 0) return;

  game.dealsSinceContinue = null;
  game.vote = { votes: {}, resumeStage: game.stage, cheapest };
  game.stage = 'vote';
  console.log(
    `[ROOM ${room.id}] nobody can afford even the cheapest bid (${cheapest}), kon ${game.kon}: vote`,
  );
}

// Голос подан — если итог уже ясен, выполняем его.
function applyVoteIfDecided(room: Room) {
  const game = room.game!;
  const vote = game.vote!;
  const choices = Object.values(vote.votes);
  const outcome = tallyVote(choices, room.players.length);
  if (outcome === 'pending') return;

  game.lastVote = {
    result: outcome,
    continueVotes: choices.filter((c) => c === 'continue').length,
    splitVotes: choices.filter((c) => c === 'split').length,
  };
  game.vote = null;

  if (outcome === 'split') {
    closeWithSplit(room);
    return;
  }

  // Продолжаем: возвращаемся туда, где остановились, — раздающий раздаёт дальше.
  // Следующий раз спросим не раньше чем через круг.
  game.stage = vote.resumeStage;
  game.dealsSinceContinue = 0;
  console.log(`[ROOM ${room.id}] vote: continue`);
}

// Комната закрывается, кон делится поровну (RULES.md §12.2).
function closeWithSplit(room: Room) {
  const game = room.game!;
  const { shares, perPlayer, remainder, remainderTo } = splitKon(
    game.kon,
    room.players.map((p) => ({ id: p.id, lost: p.startBalance - p.balance })),
  );

  for (const p of room.players) {
    p.balance += shares[p.id];
  }

  game.split = { kon: game.kon, perPlayer, remainder, remainderTo };
  game.kon = 0;
  game.stage = 'room_done';
  game.closeReason = 'nobody_can_play';
  game.activeBidderId = null;
  game.turnPlayerId = null;
  room.status = 'finished';

  console.log(
    `[ROOM ${room.id}] vote: split, kon ${game.split.kon} split: ${perPlayer} each`,
  );
}

// Раздающий переходит к соседу справа — каждую раздачу, в том числе после
// пересдачи (RULES.md §4).
function passDealer(room: Room) {
  const game = room.game!;
  const dealerIndex = room.players.findIndex((p) => p.id === game.dealerId);
  const next = room.players[(dealerIndex + 1) % room.players.length];
  game.dealerId = next.id;
  game.dealerName = next.name;
}

// Состояние розыгрыша «ничего не сыграно».
function emptyPlayState() {
  return {
    turnPlayerId: null,
    trickNumber: 0,
    currentTrick: [] as TrickCard[],
    lastTrick: null,
    tricksWon: {} as Record<string, number>,
    result: null,
  };
}

function beginBidding(room: Room) {
  if (!room.game) return;
  const game = room.game;

  game.trumpSuit = null;
  game.mains = [];
  game.lastRedeal = null;
  game.izzhoga = [];
  game.dvaSuit = null;
  game.konAs = null;
  Object.assign(game, emptyPlayState());
  game.konBeforeSettlement = null;

  // Отсчёт круга до следующего голосования: каждая раздача — шаг (§12.2).
  if (game.dealsSinceContinue !== null) {
    game.dealsSinceContinue += 1;
  }

  // Кон пуст (старт комнаты или кто-то его забрал) — все вносят взнос (RULES.md §9.2).
  // Если кон не пуст, взноса нет: играем на том, что лежит.
  if (game.kon === 0) {
    takeAnte(room, 'kon_empty');
  } else {
    game.lastAnte = null;
  }

  // Колода зависит от числа игроков, см. RULES.md §3.
  // Сходится ровно: 1 открытая карта + по 5 карт каждому.
  const deck = shuffle(createDeck(room.capacity as Capacity));

  // Сначала открываем карту. Она задаёт масть РАЗ (при 4 игроках козырь всегда
  // черви, §5.1). При 5 и 6 игроках вышла ИЗЖОГА — карта вбивается обратно
  // в колоду и открывается следующая, не больше трёх раз (§5.2).
  const opening = openTrump(deck, room.capacity);
  game.izzhoga = opening.izzhoga;

  if (!opening.openCard) {
    // Три ИЗЖОГИ подряд — раздача отменяется, пересдача (§5.2).
    emptyRound(room, 'three_izzhoga');
    return;
  }

  // После открытой карты раздаём по 5 карт каждому. Вернувшиеся ИЗЖОГИ
  // остались в колоде, поэтому карт ровно хватает.
  const hands: Record<string, Card[]> = {};
  for (const player of room.players) {
    hands[player.id] = [];
  }

  let cursor = 0;
  for (let round = 0; round < 5; round++) {
    for (const player of room.players) {
      const card = opening.deck[cursor++];
      if (!card) {
        throw new Error('not enough cards to deal 5 to each player');
      }
      hands[player.id].push(card);
    }
  }

  game.openCard = opening.openCard;
  game.razSuit = razSuitFor(room.capacity as Capacity, opening.openCard);

  // Первым говорит сосед справа от раздающего, дальше против часовой стрелки,
  // раздающий высказывается последним (RULES.md §6.1).
  // Против часовой = следующий индекс в room.players.
  const dealerIndex = room.players.findIndex((p) => p.id === game.dealerId);

  if (dealerIndex < 0) {
    throw new Error('dealer is not seated at the table');
  }

  const bidOrder = room.players.map(
    (_, offset) =>
      room.players[(dealerIndex + 1 + offset) % room.players.length].id,
  );

  game.stage = 'bidding';
  game.hands = hands;
  game.bids = [];
  game.bidOrder = bidOrder;
  game.bidIndex = 0;
  game.activeBidderId = bidOrder[0] ?? null;
}

// Пустая раздача: никто не играет — все спасовали (§6.5) или три ИЗЖОГИ подряд (§5.2).
// Раздающий переходит к соседу справа, все доливают взнос поверх кона — но только
// пока пустых раздач подряд не больше лимита; дальше раздаём на том же коне (§9.3).
function emptyRound(room: Room, reason: EmptyRoundReason) {
  const game = room.game!;

  game.emptyStreak += 1;
  if (game.emptyStreak <= room.settings.emptyLimit) {
    takeAnte(room, reason);
  } else {
    game.lastAnte = null;
  }

  passDealer(room);
  game.stage = 'awaiting_deal';
  game.lastRedeal = reason;
  game.openCard = null;
  game.razSuit = null;
  game.trumpSuit = null;
  game.dvaSuit = null;
  game.konAs = null;
  game.mains = [];
  game.hands = {};
  game.bids = [];
  game.bidOrder = [];
  game.bidIndex = 0;
  game.activeBidderId = null;
  Object.assign(game, emptyPlayState());

  // После доливки кон мог стать таким, что его никто не может взять —
  // тогда голосуем, продолжать или делить (§12.2).
  startVoteIfNobodyCanPlay(room);
}

// Главные и козырь известны — начинается розыгрыш.
// Первым ходит сосед слева от первого главного (RULES.md §10.4, §10.5).
// Но если у главного дама, король и туз козыря, разыгрывать нечего: он выигрывает
// сразу (§8). При РАЗ и КОНЕ это ГАРБА, при ДВА — просто победа без розыгрыша.
function startPlay(room: Room) {
  const game = room.game!;
  const seatIds = room.players.map((p) => p.id);

  Object.assign(game, emptyPlayState());
  game.tricksWon = Object.fromEntries(seatIds.map((id) => [id, 0]));

  const instantIndex = instantWinIndex(game.mains, game.hands, game.trumpSuit!);
  if (instantIndex >= 0) {
    // Ни одной взятки не сыграно — trickNumber остаётся 0.
    finishRound(
      room,
      game.mains.map((_, i) => i === instantIndex),
      instantIndex,
    );
    const main = game.mains[instantIndex];
    console.log(
      countsAsGarba(main.declaration)
        ? `[ROOM ${room.id}] ГАРБА у ${main.playerName}`
        : `[ROOM ${room.id}] ${main.playerName} (${main.declaration}): Q K A козыря — без розыгрыша`,
    );
    return;
  }

  game.stage = 'playing';
  game.trickNumber = 1;
  game.turnPlayerId = firstLeader(seatIds, game.mains[0].playerId);
}

// Торги закончились: либо определился главный, либо все спасовали.
function finishBidding(room: Room): 'main' | 'kon' | 'all_pass' {
  const game = room.game;
  if (!game || !game.razSuit) {
    throw new Error('finishBidding called outside of bidding');
  }

  const outcome = resolveBidding(
    room.capacity as Capacity,
    game.bids,
    game.razSuit,
    game.dvaSuit,
  );

  game.activeBidderId = null;

  if (outcome.kind === 'main') {
    game.mains = outcome.mains;
    game.trumpSuit = outcome.trumpSuit;
    // Кто-то сыграл — счётчик пустых раздач обнуляется (RULES.md §9.3).
    game.emptyStreak = 0;
    startPlay(room);
    return 'main';
  }

  // Торги выиграл КОН. Козырь он называет отдельным шагом после торгов —
  // по РАЗ или по ДВА (§6.7). При 4 игроках выбора нет: козырь всегда черви.
  if (outcome.kind === 'kon') {
    game.mains = [outcome.main];
    game.emptyStreak = 0;

    const options = konTrumpOptions(room.capacity as Capacity, game.razSuit);
    if (options.length === 1) {
      game.konAs = options[0].as;
      game.trumpSuit = options[0].suit;
      startPlay(room);
    } else {
      game.stage = 'kon_trump';
    }
    return 'kon';
  }

  // Все спасовали — пересдача (RULES.md §6.5).
  emptyRound(room, 'all_pass');
  return 'all_pass';
}

// Игрок кладёт карту. Вызывать только после всех проверок допустимости.
// Возвращает, чем закончился ход: взятка ещё собирается, взятка собрана,
// или разыграна последняя взятка раздачи.
function playCard(
  room: Room,
  playerId: string,
  card: Card,
): 'next_player' | 'trick_taken' | 'round_done' {
  const game = room.game!;
  const trumpSuit = game.trumpSuit!;
  const seatIds = room.players.map((p) => p.id);
  const player = room.players.find((p) => p.id === playerId)!;

  game.hands[playerId] = game.hands[playerId].filter((c) => c.id !== card.id);
  game.currentTrick.push({ playerId, playerName: player.name, card });

  // Взятка ещё не собрана — ход соседу справа.
  if (game.currentTrick.length < room.players.length) {
    game.turnPlayerId = nextSeat(seatIds, playerId);
    return 'next_player';
  }

  // Все положили по карте — определяем, кто взял.
  const winnerId = winnerOfTrick(game.currentTrick, trumpSuit);
  const winner = room.players.find((p) => p.id === winnerId)!;

  game.tricksWon[winnerId] = (game.tricksWon[winnerId] ?? 0) + 1;
  game.lastTrick = {
    cards: game.currentTrick,
    winnerId,
    winnerName: winner.name,
  };
  game.currentTrick = [];

  // Раздача заканчивается, как только исход ясен для всех главных, —
  // до пятой взятки доигрывать не нужно (RULES.md §10.5a).
  const tricksPlayed = game.trickNumber;
  const statuses = game.mains.map((m) =>
    mainStatus(game.tricksWon[m.playerId] ?? 0, tricksPlayed),
  );
  const decided = statuses.every((s) => s !== 'open');

  if (decided || tricksPlayed >= TRICKS_PER_ROUND) {
    finishRound(
      room,
      statuses.map((s) => s === 'won'),
    );
    return 'round_done';
  }

  // Взявший взятку ходит первым в следующей (RULES.md §10.3).
  game.trickNumber += 1;
  game.turnPlayerId = winnerId;
  return 'trick_taken';
}

// Раздача сыграна: считаем деньги, передаём раздачу, проверяем конец комнаты.
// won[i] — выиграл ли game.mains[i].
// instantIndex — индекс главного, выигравшего сразу, без розыгрыша, или -1.
function finishRound(room: Room, won: boolean[], instantIndex = -1) {
  const game = room.game!;
  const base = roomBaseKon(room);

  // Риск пока всегда ×1 — спецкарты появятся на этапе 7.
  const settlement = settleRound(
    game.mains.map((m, i) => ({
      playerId: m.playerId,
      declaration: m.declaration,
      won: won[i],
      risk: 1,
    })),
    game.kon,
    base,
  );

  for (const p of room.players) {
    p.balance += settlement.deltas[p.id] ?? 0;
  }

  game.konBeforeSettlement = game.kon;
  game.kon = settlement.konAfter;
  game.turnPlayerId = null;
  game.result = game.mains.map((m, i) => ({
    ...m,
    tricks: game.tricksWon[m.playerId] ?? 0,
    won: won[i],
    delta: settlement.deltas[m.playerId] ?? 0,
    instant: i === instantIndex,
    garba: i === instantIndex && countsAsGarba(m.declaration),
  }));

  updateClosing(room);

  // Комната доигрывала последний кон, и его забрали — комната закрывается (§12.1).
  if (game.closing && game.kon === 0) {
    game.stage = 'room_done';
    game.closeReason = 'kon_taken';
    room.status = 'finished';
    console.log(`[ROOM ${room.id}] room finished`);
    return;
  }

  // Следующую раздачу сдаёт сосед справа (RULES.md §4).
  passDealer(room);
  game.stage = 'round_done';

  // Кон вырос так, что его никто не может взять, — голосуем (§12.2).
  startVoteIfNobodyCanPlay(room);
}

function publicRoom(room: Room, viewerId?: string) {
  let game: any = null;

  if (room.game) {
    game = {
      stage: room.game.stage,
      dealerId: room.game.dealerId,
      dealerName: room.game.dealerName,
      revealLog: room.game.revealLog,
      openCard: room.game.openCard,
      razSuit: room.game.razSuit,
      trumpSuit: room.game.trumpSuit,
      // Открывавшиеся ИЗЖОГИ видели все — они открыты (§5.2).
      izzhoga: room.game.izzhoga,
      // Масть ДВА видит только тот, кто сказал ДВА (§6.3), остальным — null.
      // Оговорка: авторизации пока нет (CLAUDE.md, слабое место №8) — кто знает
      // чужой playerId, увидит и чужую руку, и эту масть. Закрывается на этапе 9.
      myDvaSuit:
        viewerId !== undefined &&
        room.game.dvaSuit !== null &&
        room.game.bids.some((b) => b.playerId === viewerId && b.bid === 'ДВА')
          ? room.game.dvaSuit
          : null,
      // Из каких мастей можно выбрать ДВА — только тому, чья очередь и кому ДВА доступен.
      myDvaSuitOptions:
        room.game.stage === 'bidding' &&
        viewerId !== undefined &&
        viewerId === room.game.activeBidderId &&
        room.game.razSuit &&
        allowedBidsFor(
          room.capacity as Capacity,
          room.game.bids,
          walletOf(room, viewerId),
        ).includes('ДВА')
          ? dvaSuitOptions(room.capacity as Capacity, room.game.razSuit)
          : [],
      mains: room.game.mains,
      lastRedeal: room.game.lastRedeal,
      // Кнопки заявок решает сервер: клиент только включает те, что пришли.
      // Не-активному игроку — пустой список.
      myAllowedBids:
        room.game.stage === 'bidding' &&
        viewerId !== undefined &&
        viewerId === room.game.activeBidderId
          ? allowedBidsFor(
              room.capacity as Capacity,
              room.game.bids,
              walletOf(room, viewerId),
            )
          : [],
      // Деньги.
      kon: room.game.kon,
      baseKon: roomBaseKon(room),
      // Сколько сейчас стоит каждая заявка — столько нужно иметь на балансе.
      razStake: stakeFor('РАЗ', room.game.kon, roomBaseKon(room)),
      dvaStake: stakeFor('ДВА', room.game.kon, roomBaseKon(room)),
      konBeforeSettlement: room.game.konBeforeSettlement,
      // С какого кона открывается заявка КОН, открыта ли она сейчас и сколько стоит (§6.7).
      konUnlockAt: konUnlockAt(roomBaseKon(room), room.settings.konThreshold),
      konAvailable: konAvailable(
        room.game.kon,
        roomBaseKon(room),
        room.settings.konThreshold,
      ),
      konStake: stakeFor('КОН', room.game.kon, roomBaseKon(room)),
      // Как КОН назвал козырь — видно всем, когда козырь уже объявлен.
      konAs: room.game.trumpSuit ? room.game.konAs : null,
      // Выбор козыря — только игроку, выигравшему КОН, пока он выбирает.
      myKonTrumpOptions:
        room.game.stage === 'kon_trump' &&
        viewerId !== undefined &&
        viewerId === room.game.mains[0]?.playerId &&
        room.game.razSuit
          ? konTrumpOptions(room.capacity as Capacity, room.game.razSuit)
          : [],
      emptyStreak: room.game.emptyStreak,
      lastAnte: room.game.lastAnte,
      closing: room.game.closing,
      closeReason: room.game.closeReason,
      split: room.game.split,
      // Голосование «продолжаем или делим» (§12.2): сколько за что и кто уже голосовал.
      vote: room.game.vote
        ? {
            continueVotes: Object.values(room.game.vote.votes).filter(
              (v) => v === 'continue',
            ).length,
            splitVotes: Object.values(room.game.vote.votes).filter(
              (v) => v === 'split',
            ).length,
            votedIds: Object.keys(room.game.vote.votes),
            cheapest: room.game.vote.cheapest,
          }
        : null,
      myVote:
        room.game.vote && viewerId
          ? (room.game.vote.votes[viewerId] ?? null)
          : null,
      lastVote: room.game.lastVote,
      // Через сколько раздач снова спросим, если кон всё ещё никому не по карману.
      dealsUntilNextVote: dealsUntilNextVote(
        room.game.dealsSinceContinue,
        room.players.length,
      ),
      // Розыгрыш. Сыгранные карты открыты всем — они лежат на столе.
      turnPlayerId: room.game.turnPlayerId,
      trickNumber: room.game.trickNumber,
      currentTrick: room.game.currentTrick,
      lastTrick: room.game.lastTrick,
      tricksWon: room.game.tricksWon,
      result: room.game.result,
      // Какими картами запросивший может пойти прямо сейчас. Решает сервер,
      // клиент только подсвечивает. Не его ход — пустой список.
      myPlayableCardIds:
        room.game.stage === 'playing' &&
        viewerId !== undefined &&
        viewerId === room.game.turnPlayerId &&
        room.game.trumpSuit
          ? playableCards(
              room.game.hands[viewerId] ?? [],
              room.game.currentTrick,
              room.game.trumpSuit,
            ).map((c) => c.id)
          : [],
      bids: room.game.bids,
      bidOrder: room.game.bidOrder,
      bidIndex: room.game.bidIndex,
      activeBidderId: room.game.activeBidderId,
      hand:
        viewerId && room.game.hands[viewerId]
          ? room.game.hands[viewerId]
          : [],
      handCounts: Object.fromEntries(
        Object.entries(room.game.hands).map(([playerId, cards]) => [
          playerId,
          cards.length,
        ]),
      ),
    };
  }

  return {
    id: room.id,
    capacity: room.capacity,
    creatorId: room.creatorId,
    settings: room.settings,
    players: room.players,
    status: room.status,
    createdAt: room.createdAt,
    game,
  };
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/rooms', (req, res) => {
  const { playerId, name, capacity, ante, emptyLimit, konThreshold, minBalance } =
    req.body ?? {};
  const cap = Number(capacity);
  const anteValue = Number(ante);
  const limitValue = Number(emptyLimit);
  const thresholdValue = Number(konThreshold);
  const minBalanceValue = Number(minBalance);

  if (!playerId || !name) {
    return res.status(400).json({ error: 'playerId and name are required' });
  }

  if (!Number.isInteger(cap) || cap < 4 || cap > 7) {
    return res.status(400).json({ error: 'capacity must be from 4 to 7' });
  }

  // Взнос, лимит пустых раздач и порог КОН выбирает создатель
  // (RULES.md §9.1, §9.3, §6.7). Взнос кратен 100 — на этом держится
  // округление половины кона для ДВА (§11.4).
  if (
    !Number.isInteger(anteValue) ||
    anteValue < MIN_ANTE ||
    anteValue > MAX_ANTE ||
    anteValue % COIN_STEP !== 0
  ) {
    return res.status(400).json({
      error: `ante must be from ${MIN_ANTE} to ${MAX_ANTE}, multiple of ${COIN_STEP}`,
    });
  }

  if (
    !Number.isInteger(thresholdValue) ||
    thresholdValue < MIN_KON_THRESHOLD ||
    thresholdValue > MAX_KON_THRESHOLD
  ) {
    return res.status(400).json({
      error: `konThreshold must be from ${MIN_KON_THRESHOLD} to ${MAX_KON_THRESHOLD}`,
    });
  }

  // Минимум для входа — не меньше взноса × 10 (RULES.md §9.1a).
  const lowestEntry = lowestEntryFor(anteValue);
  if (
    !Number.isInteger(minBalanceValue) ||
    minBalanceValue < lowestEntry ||
    minBalanceValue > MAX_ENTRY ||
    minBalanceValue % ENTRY_STEP !== 0
  ) {
    return res.status(400).json({
      error: `minBalance must be from ${lowestEntry} to ${MAX_ENTRY}, multiple of ${ENTRY_STEP}`,
    });
  }

  // Создатель тоже должен проходить по минимуму. Аккаунтов пока нет,
  // у всех стартовые 10 000 — с аккаунтами (этап 9) здесь будет реальный баланс.
  if (STARTING_COINS < minBalanceValue) {
    return res.status(403).json({
      error: 'not enough coins to enter',
      minBalance: minBalanceValue,
      balance: STARTING_COINS,
    });
  }

  if (
    !Number.isInteger(limitValue) ||
    limitValue < MIN_EMPTY_LIMIT ||
    limitValue > MAX_EMPTY_LIMIT
  ) {
    return res.status(400).json({
      error: `emptyLimit must be from ${MIN_EMPTY_LIMIT} to ${MAX_EMPTY_LIMIT}`,
    });
  }

  const id = makeRoomId();

  const room: Room = {
    id,
    capacity: cap,
    creatorId: String(playerId),
    settings: {
      ante: anteValue,
      emptyLimit: limitValue,
      konThreshold: thresholdValue,
      minBalance: minBalanceValue,
    },
    players: [
      {
        id: String(playerId),
        name: String(name),
        ready: true,
        joinedAt: Date.now(),
        balance: STARTING_COINS,
        startBalance: STARTING_COINS,
      },
    ],
    status: 'lobby',
    createdAt: Date.now(),
  };

  rooms.set(id, room);
  console.log(`[ROOM ${id}] created ${room.players.length}/${room.capacity}`);

  return res.status(201).json(publicRoom(room, String(playerId)));
});

app.get('/rooms/:id', (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room) {
    return res.status(404).json({ error: 'room not found' });
  }

  const viewerId =
    typeof req.query.playerId === 'string' ? req.query.playerId : undefined;

  return res.json(publicRoom(room, viewerId));
});

app.post('/rooms/:id/join', (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room) {
    return res.status(404).json({ error: 'room not found' });
  }

  if (room.status !== 'lobby') {
    return res.status(409).json({ error: 'game already started' });
  }

  const { playerId, name } = req.body ?? {};

  if (!playerId || !name) {
    return res.status(400).json({ error: 'playerId and name are required' });
  }

  const existing = room.players.find((p) => p.id === String(playerId));
  if (existing) {
    return res.json(publicRoom(room, String(playerId)));
  }

  if (room.players.length >= room.capacity) {
    return res.status(409).json({ error: 'room is full' });
  }

  // Войти можно, только если денег не меньше минимума комнаты (RULES.md §9.1a).
  // Аккаунтов пока нет, у всех стартовые 10 000 — с аккаунтами (этап 9)
  // здесь будет реальный баланс игрока.
  const joiningBalance = STARTING_COINS;
  if (joiningBalance < room.settings.minBalance) {
    return res.status(403).json({
      error: 'not enough coins to enter',
      minBalance: room.settings.minBalance,
      balance: joiningBalance,
    });
  }

  room.players.push({
    id: String(playerId),
    name: String(name),
    ready: true,
    joinedAt: Date.now(),
    balance: STARTING_COINS,
    startBalance: STARTING_COINS,
  });

  console.log(
    `[ROOM ${room.id}] ${name} joined ${room.players.length}/${room.capacity}`,
  );

  return res.json(publicRoom(room, String(playerId)));
});

app.post('/rooms/:id/start', (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room) {
    return res.status(404).json({ error: 'room not found' });
  }

  const { playerId } = req.body ?? {};

  if (String(playerId) !== room.creatorId) {
    return res.status(403).json({ error: 'only creator can start the game' });
  }

  if (room.players.length !== room.capacity) {
    return res.status(409).json({
      error: 'room is not full',
      players: room.players.length,
      capacity: room.capacity,
    });
  }

  if (room.status === 'started' && room.game) {
    return res.json(publicRoom(room, String(playerId)));
  }

  room.status = 'started';

  // Посадка за столом случайная и НЕ совпадает с порядком входа в комнату
  // (RULES.md §2). После этой перетасовки room.players — это и есть места за
  // столом в порядке против часовой стрелки: следующий в массиве = сосед справа.
  room.players = shuffle(room.players);

  room.game = makeDealerSelection(room);

  console.log(
    `[ROOM ${room.id}] GAME STARTED, dealer=${room.game.dealerName}`,
  );

  return res.json(publicRoom(room, String(playerId)));
});

app.post('/rooms/:id/dealer/continue', (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room) {
    return res.status(404).json({ error: 'room not found' });
  }

  const { playerId } = req.body ?? {};

  if (!room.game) {
    return res.status(409).json({ error: 'game not started' });
  }

  // Карты сдаёт раздающий, а не создатель комнаты. Раздающий определяется тузом,
  // дальше роль идёт по кругу против часовой стрелки (RULES.md §4).
  if (String(playerId) !== room.game.dealerId) {
    return res.status(403).json({
      error: 'only the dealer can deal',
      dealerId: room.game.dealerId,
    });
  }

  // Раздавать можно только когда карты не на руках: после выбора первого
  // раздающего, при пересдаче и после сыгранной раздачи. Без этой проверки
  // повторный вызов посреди торгов перераздал бы карты и обнулил заявки.
  const canDeal =
    room.game.stage === 'dealer_found' ||
    room.game.stage === 'awaiting_deal' ||
    room.game.stage === 'round_done';

  if (!canDeal) {
    return res.status(409).json({
      error: 'cards are already dealt',
      stage: room.game.stage,
    });
  }

  beginBidding(room);

  console.log(
    `[ROOM ${room.id}] open=${room.game.openCard?.id}, raz=${room.game.razSuit}, 5 cards dealt, bidding started`,
  );

  return res.json(publicRoom(room, String(playerId)));
});

app.post('/rooms/:id/bid', (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room || !room.game) {
    return res.status(404).json({ error: 'room/game not found' });
  }

  const { playerId, bid, suit } = req.body ?? {};
  const bidValue = String(bid) as Bid;

  if (room.game.stage !== 'bidding') {
    return res.status(409).json({ error: 'bidding is not active' });
  }

  if (room.game.activeBidderId !== String(playerId)) {
    return res.status(409).json({
      error: 'not your turn',
      activeBidderId: room.game.activeBidderId,
    });
  }

  // Здесь же проверка баланса: заявку, на которую не хватает денег, не примем.
  const allowedBids = allowedBidsFor(
    room.capacity as Capacity,
    room.game.bids,
    walletOf(room, String(playerId)),
  );

  if (!allowedBids.includes(bidValue)) {
    return res.status(400).json({
      error: 'invalid bid',
      allowedBids,
    });
  }

  const player = room.players.find((p) => p.id === String(playerId));

  if (!player) {
    return res.status(404).json({ error: 'player not found' });
  }

  // ДВА: при 5 игроках масть одна и выбирать нечего. При 6 и 7 игрок обязан
  // назвать масть из допустимых (RULES.md §6.3). Масть хранится скрыто —
  // в публичную заявку попадает только «ДВА».
  if (bidValue === 'ДВА') {
    const options = dvaSuitOptions(room.capacity as Capacity, room.game.razSuit!);

    if (options.length === 1) {
      room.game.dvaSuit = options[0];
    } else if (options.includes(suit)) {
      room.game.dvaSuit = suit;
    } else {
      return res.status(400).json({
        error: 'choose a suit for ДВА',
        suitOptions: options,
      });
    }
  }

  room.game.bids.push({
    playerId: player.id,
    playerName: player.name,
    bid: bidValue,
  });

  room.game.bidIndex += 1;

  if (isBiddingOver(room.game.bids, room.game.bidOrder.length)) {
    const outcome = finishBidding(room);
    if (outcome === 'main') {
      const mains = room.game.mains
        .map((m) => `${m.playerName} (${m.declaration})`)
        .join(', ');
      console.log(
        `[ROOM ${room.id}] bidding finished, main: ${mains}, trump=${room.game.trumpSuit}`,
      );
    } else if (outcome === 'kon') {
      console.log(
        `[ROOM ${room.id}] bidding finished, КОН: ${room.game.mains[0].playerName}`,
      );
    } else {
      console.log(
        `[ROOM ${room.id}] all passed, redeal by ${room.game.dealerName}`,
      );
    }
  } else {
    room.game.activeBidderId =
      room.game.bidOrder[room.game.bidIndex];
  }

  return res.json(publicRoom(room, String(playerId)));
});

app.post('/rooms/:id/play', (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room || !room.game) {
    return res.status(404).json({ error: 'room/game not found' });
  }

  const game = room.game;
  const { playerId, cardId } = req.body ?? {};

  if (game.stage !== 'playing' || !game.trumpSuit) {
    return res.status(409).json({ error: 'play is not active', stage: game.stage });
  }

  if (game.turnPlayerId !== String(playerId)) {
    return res.status(409).json({
      error: 'not your turn',
      turnPlayerId: game.turnPlayerId,
    });
  }

  const hand = game.hands[String(playerId)] ?? [];
  const card = hand.find((c) => c.id === String(cardId));

  if (!card) {
    return res.status(400).json({ error: 'card is not in your hand' });
  }

  // Ход в масть / обязательный козырь — RULES.md §10.1.
  const playable = playableCards(hand, game.currentTrick, game.trumpSuit);

  if (!playable.some((c) => c.id === card.id)) {
    return res.status(400).json({
      error: 'card is not allowed by the rules',
      playableCardIds: playable.map((c) => c.id),
    });
  }

  const trickNo = game.trickNumber;
  const outcome = playCard(room, String(playerId), card);

  if (outcome !== 'next_player' && game.lastTrick) {
    console.log(
      `[ROOM ${room.id}] trick ${trickNo} taken by ${game.lastTrick.winnerName}`,
    );
  }
  if (outcome === 'round_done' && game.result) {
    const summary = game.result
      .map((r) => `${r.playerName} ${r.declaration}: ${r.tricks} ${r.won ? 'WIN' : 'LOSE'}`)
      .join(', ');
    console.log(`[ROOM ${room.id}] round done: ${summary}`);
  }

  return res.json(publicRoom(room, String(playerId)));
});

// Выигравший КОН называет козырь: по РАЗ (масть РАЗ) или по ДВА (§6.7).
// До этого момента козырь не знает никто — trumpSuit пуст.
app.post('/rooms/:id/kon-trump', (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room || !room.game) {
    return res.status(404).json({ error: 'room/game not found' });
  }

  const game = room.game;
  const { playerId, suit } = req.body ?? {};

  if (game.stage !== 'kon_trump' || !game.razSuit) {
    return res.status(409).json({ error: 'not choosing КОН trump', stage: game.stage });
  }

  if (game.mains[0]?.playerId !== String(playerId)) {
    return res.status(403).json({ error: 'only the КОН player chooses trump' });
  }

  const options = konTrumpOptions(room.capacity as Capacity, game.razSuit);
  const choice = options.find((o) => o.suit === suit);

  if (!choice) {
    return res.status(400).json({ error: 'choose a trump suit', options });
  }

  game.konAs = choice.as;
  game.trumpSuit = choice.suit;
  startPlay(room);

  console.log(
    `[ROOM ${room.id}] КОН ${game.mains[0].playerName}: козырь ${choice.suit} (по ${choice.as})`,
  );

  return res.json(publicRoom(room, String(playerId)));
});

// Голос «продолжаем» или «делим кон» (RULES.md §12.2).
app.post('/rooms/:id/vote', (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room || !room.game) {
    return res.status(404).json({ error: 'room/game not found' });
  }

  const game = room.game;
  const { playerId, choice } = req.body ?? {};

  if (game.stage !== 'vote' || !game.vote) {
    return res.status(409).json({ error: 'no vote in progress', stage: game.stage });
  }

  if (!room.players.some((p) => p.id === String(playerId))) {
    return res.status(403).json({ error: 'player is not in this room' });
  }

  if (choice !== 'continue' && choice !== 'split') {
    return res.status(400).json({ error: 'choice must be continue or split' });
  }

  if (game.vote.votes[String(playerId)]) {
    return res.status(409).json({ error: 'already voted' });
  }

  game.vote.votes[String(playerId)] = choice;
  applyVoteIfDecided(room);

  return res.json(publicRoom(room, String(playerId)));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`GARBA backend running on :${PORT}`);
});
