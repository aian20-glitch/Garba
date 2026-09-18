import express from 'express';
import cors from 'cors';

import { createDeck, shuffle } from './deck.js';
import type { Card, Suit } from './types.js';
import {
  allowedBidsFor,
  isBiddingOver,
  razSuitFor,
  resolveBidding,
  type Bid,
  type BidEntry,
  type Capacity,
  type MainPlayer,
} from './bidding.js';
import {
  firstLeader,
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
};

type RoomStatus = 'lobby' | 'started';

type RevealCard = Card & {
  playerId: string;
  playerName: string;
};

// dealer_found  — первый раздающий найден вскрытием на туза, ждём раздачи
// bidding       — карты розданы, идут торги
// playing       — главный определён, идёт розыгрыш 5 взяток
// round_done    — раздача сыграна, итог посчитан (деньги и следующая раздача — этап 4)
// awaiting_deal — пересдача: все спасовали, новый раздающий должен раздать
type Stage =
  | 'dealer_found'
  | 'bidding'
  | 'playing'
  | 'round_done'
  | 'awaiting_deal';

type MainResult = MainPlayer & {
  tricks: number;
  won: boolean;
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
  // Почему сейчас пересдача. Пока бывает только «все спасовали».
  lastRedeal: 'all_pass' | null;

  // Розыгрыш.
  turnPlayerId: string | null;
  trickNumber: number; // 1…5
  currentTrick: TrickCard[];
  // Последняя завершённая взятка — чтобы все успели увидеть, кто её забрал.
  lastTrick: { cards: TrickCard[]; winnerId: string; winnerName: string } | null;
  tricksWon: Record<string, number>;
  result: MainResult[] | null;

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
    ...emptyPlayState(),
    hands: {},
    bids: [],
    bidOrder: [],
    bidIndex: 0,
    activeBidderId: null,
  };
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

  // Колода зависит от числа игроков, см. RULES.md §3.
  // Сходится ровно: 1 открытый козырь + по 5 карт каждому.
  const deck = shuffle(createDeck(room.capacity as 4 | 5 | 6 | 7));

  // Сначала открываем одну карту. Она задаёт масть РАЗ, но при 4 игроках
  // козырь всегда черви независимо от неё (RULES.md §5.1).
  // ИЗЖОГА при 5 и 6 игроках (переоткрытие до 3 раз) — этап 5.
  const openCard = deck.shift();

  if (!openCard) {
    throw new Error('cannot open a card');
  }

  const hands: Record<string, Card[]> = {};

  for (const player of room.players) {
    hands[player.id] = [];
  }

  // После открытой карты раздаём по 5 карт каждому.
  let cursor = 0;
  for (let round = 0; round < 5; round++) {
    for (const player of room.players) {
      const card = deck[cursor++];
      if (!card) {
        throw new Error('not enough cards to deal 5 to each player');
      }
      hands[player.id].push(card);
    }
  }

  room.game.openCard = openCard;
  room.game.razSuit = razSuitFor(room.capacity as Capacity, openCard);
  room.game.trumpSuit = null;
  room.game.mains = [];
  room.game.lastRedeal = null;
  Object.assign(room.game, emptyPlayState());

  // Первым говорит сосед справа от раздающего, дальше против часовой стрелки,
  // раздающий высказывается последним (RULES.md §6.1).
  // Против часовой = следующий индекс в room.players.
  const dealerIndex = room.players.findIndex(
    (p) => p.id === room.game!.dealerId,
  );

  if (dealerIndex < 0) {
    throw new Error('dealer is not seated at the table');
  }

  const bidOrder = room.players.map(
    (_, offset) =>
      room.players[(dealerIndex + 1 + offset) % room.players.length].id,
  );

  room.game.stage = 'bidding';
  room.game.hands = hands;
  room.game.bids = [];
  room.game.bidOrder = bidOrder;
  room.game.bidIndex = 0;
  room.game.activeBidderId = bidOrder[0] ?? null;
}

// Торги закончились: либо определился главный, либо все спасовали.
function finishBidding(room: Room): 'main' | 'all_pass' {
  const game = room.game;
  if (!game || !game.razSuit) {
    throw new Error('finishBidding called outside of bidding');
  }

  const outcome = resolveBidding(
    room.capacity as Capacity,
    game.bids,
    game.razSuit,
  );

  game.activeBidderId = null;

  if (outcome.kind === 'main') {
    game.mains = outcome.mains;
    game.trumpSuit = outcome.trumpSuit;

    // Главный определён — сразу начинается розыгрыш.
    // Первым ходит сосед слева от первого главного (RULES.md §10.4, §10.5).
    const seatIds = room.players.map((p) => p.id);
    game.stage = 'playing';
    Object.assign(game, emptyPlayState());
    game.trickNumber = 1;
    game.tricksWon = Object.fromEntries(seatIds.map((id) => [id, 0]));
    game.turnPlayerId = firstLeader(seatIds, outcome.mains[0].playerId);
    return 'main';
  }

  // Все спасовали — пересдача: раздаёт следующий игрок, то есть сосед справа
  // от текущего раздающего (RULES.md §6.5).
  // Доливка взноса в кон при пересдаче — этап 4 (деньги).
  const dealerIndex = room.players.findIndex((p) => p.id === game.dealerId);
  const nextDealer = room.players[(dealerIndex + 1) % room.players.length];

  game.stage = 'awaiting_deal';
  game.lastRedeal = 'all_pass';
  game.dealerId = nextDealer.id;
  game.dealerName = nextDealer.name;
  game.openCard = null;
  game.razSuit = null;
  game.trumpSuit = null;
  game.mains = [];
  game.hands = {};
  game.bids = [];
  game.bidOrder = [];
  game.bidIndex = 0;
  Object.assign(game, emptyPlayState());
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
    game.stage = 'round_done';
    game.turnPlayerId = null;
    game.result = game.mains.map((m, i) => ({
      ...m,
      tricks: game.tricksWon[m.playerId] ?? 0,
      won: statuses[i] === 'won',
    }));
    return 'round_done';
  }

  // Взявший взятку ходит первым в следующей (RULES.md §10.3).
  game.trickNumber += 1;
  game.turnPlayerId = winnerId;
  return 'trick_taken';
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
      mains: room.game.mains,
      lastRedeal: room.game.lastRedeal,
      // Кнопки заявок решает сервер: клиент только включает те, что пришли.
      // Не-активному игроку — пустой список.
      myAllowedBids:
        room.game.stage === 'bidding' &&
        viewerId !== undefined &&
        viewerId === room.game.activeBidderId
          ? allowedBidsFor(room.capacity as Capacity, room.game.bids)
          : [],
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
  const { playerId, name, capacity } = req.body ?? {};
  const cap = Number(capacity);

  if (!playerId || !name) {
    return res.status(400).json({ error: 'playerId and name are required' });
  }

  if (!Number.isInteger(cap) || cap < 4 || cap > 7) {
    return res.status(400).json({ error: 'capacity must be from 4 to 7' });
  }

  const id = makeRoomId();

  const room: Room = {
    id,
    capacity: cap,
    creatorId: String(playerId),
    players: [
      {
        id: String(playerId),
        name: String(name),
        ready: true,
        joinedAt: Date.now(),
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

  room.players.push({
    id: String(playerId),
    name: String(name),
    ready: true,
    joinedAt: Date.now(),
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
  // раздающего или при пересдаче. Без этой проверки повторный вызов посреди
  // торгов перераздал бы карты, сменил открытую карту и обнулил все заявки.
  if (room.game.stage !== 'dealer_found' && room.game.stage !== 'awaiting_deal') {
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

  const { playerId, bid } = req.body ?? {};
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

  const allowedBids = allowedBidsFor(room.capacity as Capacity, room.game.bids);

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

  room.game.bids.push({
    playerId: player.id,
    playerName: player.name,
    bid: bidValue,
  });

  room.game.bidIndex += 1;

  if (isBiddingOver(room.game.bids, room.game.bidOrder.length)) {
    if (finishBidding(room) === 'main') {
      const mains = room.game.mains
        .map((m) => `${m.playerName} (${m.declaration})`)
        .join(', ');
      console.log(
        `[ROOM ${room.id}] bidding finished, main: ${mains}, trump=${room.game.trumpSuit}`,
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`GARBA backend running on :${PORT}`);
});
