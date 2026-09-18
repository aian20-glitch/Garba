import express from 'express';
import cors from 'cors';

type Player = {
  id: string;
  name: string;
  ready: boolean;
  joinedAt: number;
};

type RoomStatus = 'lobby' | 'started';

type RevealCard = {
  playerId: string;
  playerName: string;
  rank: string;
  suit: string;
};

type GameState = {
  stage: 'dealer_selection' | 'dealer_found' | 'table_ready';
  dealerId: string;
  dealerName: string;
  revealLog: RevealCard[];
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

function makeDealerSelection(room: Room): GameState {
  // Временная игровая колода для этапа выбора раздающего: 6..A, 4 масти.
  const ranks = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const suits = ['♠', '♥', '♦', '♣'];

  const deck = shuffle(
    ranks.flatMap((rank) => suits.map((suit) => ({ rank, suit }))),
  );

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
  };
}

function publicRoom(room: Room) {
  return {
    id: room.id,
    capacity: room.capacity,
    creatorId: room.creatorId,
    players: room.players,
    status: room.status,
    createdAt: room.createdAt,
    game: room.game ?? null,
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

  return res.status(201).json(publicRoom(room));
});

app.get('/rooms/:id', (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room) {
    return res.status(404).json({ error: 'room not found' });
  }

  return res.json(publicRoom(room));
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
    return res.json(publicRoom(room));
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

  return res.json(publicRoom(room));
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
    return res.json(publicRoom(room));
  }

  room.status = 'started';
  room.game = makeDealerSelection(room);

  console.log(
    `[ROOM ${room.id}] GAME STARTED, dealer=${room.game.dealerName}`,
  );

  return res.json(publicRoom(room));
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

  room.game.stage = 'table_ready';
  console.log(`[ROOM ${room.id}] dealer selection complete`);

  return res.json(publicRoom(room));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`GARBA backend running on :${PORT}`);
});
