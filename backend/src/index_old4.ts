import express from 'express';
import cors from 'cors';

type Player = {
  id: string;
  name: string;
  ready: boolean;
  joinedAt: number;
};

type RoomStatus = 'lobby' | 'started';
type Bid = 'РАЗ' | 'ДВА' | 'ПАС';

type Card = {
  rank: string;
  suit: string;
};

type RevealCard = Card & {
  playerId: string;
  playerName: string;
};

type BidEntry = {
  playerId: string;
  playerName: string;
  bid: Bid;
};

type GameState = {
  stage: 'dealer_found' | 'bidding' | 'bidding_done';
  dealerId: string;
  dealerName: string;
  revealLog: RevealCard[];
  trumpCard: Card | null;
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

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeDeck(): Card[] {
  const ranks = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const suits = ['♠', '♥', '♦', '♣'];

  return ranks.flatMap((rank) =>
    suits.map((suit) => ({
      rank,
      suit,
    })),
  );
}


function makeFourPlayerDeck(): Card[] {
  // 4 игрока: 21 карта.
  // Черви: 6,7,8,9,10,J,Q,K,A = 9 карт.
  // Остальные масти: только J,Q,K,A = 12 карт.
  // Итого 21: 1 открытый козырь + 20 карт (по 5 каждому).
  const heartsRanks = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const highRanks = ['J', 'Q', 'K', 'A'];

  const hearts = heartsRanks.map((rank) => ({ rank, suit: '♥' }));
  const others = ['♠', '♦', '♣'].flatMap((suit) =>
    highRanks.map((rank) => ({ rank, suit })),
  );

  return [...hearts, ...others];
}

function makeDealerSelection(room: Room): GameState {
  const deck = shuffle(makeDeck());
  const revealLog: RevealCard[] = [];
  let dealer = room.players[0];

  for (let i = 0; i < deck.length; i++) {
    const player = room.players[i % room.players.length];
    const card = deck[i];

    revealLog.push({
      playerId: player.id,
      playerName: player.name,
      rank: card.rank,
      suit: card.suit,
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
    trumpCard: null,
    hands: {},
    bids: [],
    bidOrder: [],
    bidIndex: 0,
    activeBidderId: null,
  };
}

function beginBidding(room: Room) {
  if (!room.game) return;

  const baseDeck =
    room.capacity === 4 ? makeFourPlayerDeck() : makeDeck();
  const deck = shuffle(baseDeck);

  // СНАЧАЛА открываем одну карту — это козырь.
  const trumpCard = deck.shift();

  if (!trumpCard) {
    throw new Error('cannot open trump card');
  }

  const hands: Record<string, Card[]> = {};

  for (const player of room.players) {
    hands[player.id] = [];
  }

  // После открытия козыря раздаём по 5 карт каждому.
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

  room.game.trumpCard = trumpCard;

  // На этом тестовом этапе торги начинаем с первого игрока в комнате.
  const bidOrder = room.players.map((p) => p.id);

  room.game.stage = 'bidding';
  room.game.hands = hands;
  room.game.bids = [];
  room.game.bidOrder = bidOrder;
  room.game.bidIndex = 0;
  room.game.activeBidderId = bidOrder[0] ?? null;
}

function publicRoom(room: Room, viewerId?: string) {
  let game: any = null;

  if (room.game) {
    game = {
      stage: room.game.stage,
      dealerId: room.game.dealerId,
      dealerName: room.game.dealerName,
      revealLog: room.game.revealLog,
      trumpCard: room.game.trumpCard,
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

  if (String(playerId) !== room.creatorId) {
    return res.status(403).json({ error: 'only creator can continue' });
  }

  if (!room.game) {
    return res.status(409).json({ error: 'game not started' });
  }

  beginBidding(room);

  console.log(
    `[ROOM ${room.id}] trump=${room.game.trumpCard?.rank}${room.game.trumpCard?.suit}, 5 cards dealt, bidding started`,
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

  const allowedBids: Bid[] =
    room.capacity == 4 ? ['РАЗ', 'ПАС'] : ['РАЗ', 'ДВА', 'ПАС'];

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

  if (room.game.bidIndex >= room.game.bidOrder.length) {
    room.game.stage = 'bidding_done';
    room.game.activeBidderId = null;
    console.log(`[ROOM ${room.id}] bidding finished`);
  } else {
    room.game.activeBidderId =
      room.game.bidOrder[room.game.bidIndex];
  }

  return res.json(publicRoom(room, String(playerId)));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`GARBA backend running on :${PORT}`);
});
