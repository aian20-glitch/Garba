import { ANTE_PER_PLAYER, STARTING_COINS } from "./config.js";
import type { Player, RoomState } from "./types.js";

const rooms = new Map<string, RoomState>();

export function createRoom(ownerId: string, ownerName: string, capacity: 4|5|6|7): RoomState {
  const roomId = String(Math.floor(10000 + Math.random() * 90000));
  const owner: Player = {
    id: ownerId,
    name: ownerName,
    coins: STARTING_COINS,
    rating: 1000,
    online: true,
    ready: true,
    hand: [],
    playedCards: [],
    tricks: 0
  };

  const room: RoomState = {
    id: roomId,
    capacity,
    players: [owner],
    phase: "lobby",
    pot: 0,
    riskMultiplier: 1,
    currentTrick: []
  };

  rooms.set(roomId, room);
  return room;
}

export function getRoom(roomId: string) {
  return rooms.get(roomId);
}

export function addPlayer(roomId: string, playerId: string, name: string): RoomState {
  const room = rooms.get(roomId);
  if (!room) throw new Error("ROOM_NOT_FOUND");
  if (room.phase !== "lobby") throw new Error("ROOM_ALREADY_STARTED");
  if (room.players.length >= room.capacity) throw new Error("ROOM_FULL");

  if (!room.players.some(p => p.id === playerId)) {
    room.players.push({
      id: playerId,
      name,
      coins: STARTING_COINS,
      rating: 1000,
      online: true,
      ready: true,
      hand: [],
      playedCards: [],
      tricks: 0
    });
  }
  return room;
}

export function startAnte(room: RoomState) {
  const total = room.players.length * ANTE_PER_PLAYER;
  for (const p of room.players) {
    if (p.coins < ANTE_PER_PLAYER) throw new Error("PLAYER_HAS_NOT_ENOUGH_COINS");
    p.coins -= ANTE_PER_PLAYER;
  }
  room.pot += total;
}

export function allRooms() {
  return [...rooms.values()];
}
