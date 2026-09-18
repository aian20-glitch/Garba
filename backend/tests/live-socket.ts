// Живая проверка Socket.IO (этап 8): поднимает настоящий сервер на отдельном порту,
// подключает двух игроков по сокету и смотрит, что приходит.
// Запуск: npm run test:live   (сервер на 3000 не трогает — берёт порт 3099)

import { spawn } from 'node:child_process';
import { io, type Socket } from 'socket.io-client';
import { check, section, summary } from './check.js';

const PORT = 3099;
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post(path: string, body: unknown) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

// Последнее состояние комнаты, которое пришло этому игроку по сокету.
function watcher(roomId: string, playerId: string) {
  const socket: Socket = io(BASE, { transports: ['websocket'], forceNew: true });
  const state: { last: any; count: number } = { last: null, count: 0 };
  socket.on('connect', () => socket.emit('watch', { roomId, playerId }));
  socket.on('room', (room) => {
    state.last = room;
    state.count++;
  });
  return { socket, state };
}

async function main() {
  // Ждём, пока сервер поднимется.
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(BASE + '/health')).ok) break;
    } catch {}
    await wait(200);
  }

  section('живые обновления по сокету (этап 8)');
  const room = await post('/rooms', {
    playerId: 'p0', name: 'Серик', capacity: 4,
    ante: 100, emptyLimit: 5, konThreshold: 10, minBalance: 1000,
  });
  const roomId = room.id;

  const serik = watcher(roomId, 'p0');
  await wait(500);
  check('сразу после подписки приходит состояние комнаты', serik.state.last?.id, roomId);

  // Вход трёх игроков — сокет Серика должен узнать об этом сам, без запроса.
  for (let i = 1; i <= 3; i++) await post(`/rooms/${roomId}/join`, { playerId: `p${i}`, name: `Бот ${i}` });
  await wait(500);
  check('игроки вошли — Серик узнал сам: 4 из 4', serik.state.last?.players?.length, 4);

  const bot = watcher(roomId, 'p1');
  await post(`/rooms/${roomId}/start`, { playerId: 'p0' });
  await wait(300);
  const dealer = serik.state.last?.game?.dealerId;
  await post(`/rooms/${roomId}/dealer/continue`, { playerId: dealer });
  await wait(500);

  const mine = serik.state.last?.game;
  const theirs = bot.state.last?.game;
  check('после раздачи оба получили новое состояние', [mine?.stage, theirs?.stage].every((s) => s && s !== 'dealer_found'), true);

  const myIds = (mine?.hand ?? []).map((c: any) => c.id).sort().join();
  const botIds = (theirs?.hand ?? []).map((c: any) => c.id).sort().join();
  check('каждому пришла своя рука', myIds.length > 0 && botIds.length > 0 && myIds !== botIds, true);
  check('чужих карт в рассылке нет: у Серика нет ни одной карты бота',
    (mine?.hand ?? []).some((c: any) => botIds.split(',').includes(c.id)), false);

  const before = serik.state.count;
  await post(`/rooms/${roomId}/bid`, { playerId: 'nobody', bid: 'ПАС' }); // отказ — состояние не меняется
  await wait(300);
  check('после отказанного запроса тоже приходит рассылка (безвредно)', serik.state.count > before, true);

  const ghost = io(BASE, { transports: ['websocket'], forceNew: true });
  let ghostError = '';
  ghost.on('room_error', (e) => { ghostError = e.error; });
  ghost.on('connect', () => ghost.emit('watch', { roomId: '00000', playerId: 'x' }));
  await wait(500);
  check('подписка на несуществующую комнату — ошибка, а не молчание', ghostError, 'room not found');

  serik.socket.close();
  bot.socket.close();
  ghost.close();
}

main()
  .catch((e) => {
    console.error('Живая проверка упала:', e);
    process.exitCode = 1;
  })
  .finally(() => {
    server.kill();
    const failed = summary();
    process.exit(failed === 0 && process.exitCode !== 1 ? 0 : 1);
  });
