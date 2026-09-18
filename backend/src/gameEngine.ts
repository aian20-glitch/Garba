import { DISCONNECT_GRACE_MS } from "./config.js";
import { createDeck, shuffle } from "./deck.js";
import { startAnte } from "./roomStore.js";
import type { RoomState } from "./types.js";

export function beginDealerSelection(room: RoomState) {
  if (room.players.length !== room.capacity) throw new Error("ROOM_NOT_FULL");
  room.phase = "dealer_selection";
  startAnte(room);

  const deck = shuffle(createDeck(room.capacity));
  let cursor = 0;
  let winner = room.players[0];

  outer:
  while (cursor < deck.length) {
    for (const p of room.players) {
      const card = deck[cursor++];
      if (!card) break outer;
      if (card.rank === "A") {
        winner = p;
        break outer;
      }
    }
  }

  room.dealerPlayerId = winner.id;
  room.phase = "trump_selection";
}

export function pauseForDisconnect(room: RoomState, playerId: string) {
  const p = room.players.find(x => x.id === playerId);
  if (!p) return;
  p.online = false;
  room.phase = "paused";
  room.disconnectDeadline = Date.now() + DISCONNECT_GRACE_MS;
}

export function reconnect(room: RoomState, playerId: string) {
  const p = room.players.find(x => x.id === playerId);
  if (!p) return;
  p.online = true;
  if (room.phase === "paused") {
    room.phase = "playing";
    room.disconnectDeadline = undefined;
  }
}

export function closeIfTimeout(room: RoomState) {
  if (room.phase !== "paused" || !room.disconnectDeadline) return false;
  if (Date.now() < room.disconnectDeadline) return false;

  const remaining = room.players.filter(p => p.online);
  if (remaining.length > 0) {
    const share = Math.floor(room.pot / remaining.length);
    let remainder = room.pot - share * remaining.length;

    for (const p of remaining) p.coins += share;

    if (remainder > 0) {
      // MVP: give remainder to lowest-balance remaining player.
      // Final version: player who lost the most coins during this room.
      const recipient = [...remaining].sort((a,b) => a.coins - b.coins)[0];
      recipient.coins += remainder;
      remainder = 0;
    }
  }

  room.pot = 0;
  room.phase = "closed";
  return true;
}
