import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import { addPlayer, createRoom, getRoom, allRooms } from "./roomStore.js";
import { beginDealerSelection, closeIfTimeout, pauseForDisconnect, reconnect } from "./gameEngine.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true, service: "garba-backend" }));

app.post("/rooms", (req, res) => {
  try {
    const { playerId, name, capacity } = req.body;
    if (![4,5,6,7].includes(capacity)) return res.status(400).json({ error: "INVALID_CAPACITY" });
    const room = createRoom(playerId, name, capacity);
    res.json(room);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/rooms/:roomId/join", (req, res) => {
  try {
    const room = addPlayer(req.params.roomId, req.body.playerId, req.body.name);
    res.json(room);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/rooms/:roomId/start", (req, res) => {
  try {
    const room = getRoom(req.params.roomId);
    if (!room) return res.status(404).json({ error: "ROOM_NOT_FOUND" });
    beginDealerSelection(room);
    res.json(room);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

io.on("connection", socket => {
  socket.on("room:watch", ({ roomId }) => socket.join(roomId));

  socket.on("player:reconnect", ({ roomId, playerId }) => {
    const room = getRoom(roomId);
    if (!room) return;
    reconnect(room, playerId);
    io.to(roomId).emit("room:state", room);
  });

  socket.on("player:disconnecting", ({ roomId, playerId }) => {
    const room = getRoom(roomId);
    if (!room) return;
    pauseForDisconnect(room, playerId);
    io.to(roomId).emit("room:state", room);
  });
});

setInterval(() => {
  for (const room of allRooms()) {
    if (closeIfTimeout(room)) {
      io.to(room.id).emit("room:state", room);
    }
  }
}, 1000);

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, () => console.log(`GARBA backend running on :${PORT}`));
