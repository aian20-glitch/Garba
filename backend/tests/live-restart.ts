// Живая проверка этапа 9.2: комната переживает перезапуск сервера, отключение
// ставит игру на паузу, не вернулся — кон делится между оставшимися (RULES.md §13).
// Сервер поднимается на порту 3098 с базой во временном файле и укороченными
// таймерами: 1 секунда отсрочки вместо 10, 3 секунды вместо 5 минут.
// Запуск: npm run test:live   (вместе с live-socket.ts)

import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { check, section, summary } from './check.js';

const PORT = 3098;
const BASE = `http://127.0.0.1:${PORT}`;
const DB_FILE = join(tmpdir(), `garba-live-${Date.now()}.db`);

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let server: ChildProcess | null = null;

async function startServer() {
  server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      GARBA_DB: DB_FILE,
      GARBA_GRACE_MS: '1000',
      GARBA_DISCONNECT_MS: '3000',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(BASE + '/health')).ok) return;
    } catch {}
    await wait(200);
  }
  throw new Error('сервер не поднялся');
}

async function stopServer() {
  if (!server) return;
  const exited = new Promise((r) => server!.once('exit', r));
  server.kill();
  await exited;
  server = null;
}

async function request(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

type Me = { id: string; name: string; token: string };

// Игрок «за столом»: держит сокет и переподписывается после каждого переподключения.
function sit(roomId: string, token: string) {
  const socket: Socket = io(BASE, { transports: ['websocket'], forceNew: true, reconnectionDelayMax: 1000 });
  socket.on('connect', () => socket.emit('watch', { roomId, token }));
  return socket;
}

async function main() {
  await startServer();

  const players: Me[] = [];
  for (const name of ['Серик', 'Айдар', 'Дана', 'Ержан']) {
    players.push((await request('POST', '/accounts', undefined, { name })).body);
  }
  const [serik, , , erzhan] = players;

  const room = (await request('POST', '/rooms', serik.token, {
    capacity: 4, ante: 100, emptyLimit: 5, konThreshold: 10, minBalance: 1000,
  })).body;
  const roomId: string = room.id;
  for (const p of players.slice(1)) await request('POST', `/rooms/${roomId}/join`, p.token);

  const sockets = new Map(players.map((p) => [p.id, sit(roomId, p.token)]));
  await wait(500);

  await request('POST', `/rooms/${roomId}/start`, serik.token);
  const dealerId = (await request('GET', `/rooms/${roomId}`, serik.token)).body.game.dealerId;
  const dealer = players.find((p) => p.id === dealerId)!;
  await request('POST', `/rooms/${roomId}/dealer/continue`, dealer.token);

  const before = (await request('GET', `/rooms/${roomId}`, serik.token)).body;

  section('перезапуск сервера (этап 9.2)');
  await stopServer();
  await startServer();

  const after = (await request('GET', `/rooms/${roomId}`, serik.token));
  check('комната на месте после перезапуска', after.status, 200);
  check('та же стадия и тот же кон', [after.body.game?.stage, after.body.game?.kon], [before.game.stage, before.game.kon]);
  check('те же карты на руке',
    after.body.game?.hand?.map((c: any) => c.id), before.game.hand.map((c: any) => c.id));
  check('баланс на аккаунте — после взноса', (await request('GET', '/me', serik.token)).body.balance, 9_900);
  check('игрок по-прежнему в своей комнате', (await request('GET', '/me', serik.token)).body.roomId, roomId);

  await wait(2_500); // сокеты переподключаются сами
  check('все переподключились — паузы нет', (await request('GET', `/rooms/${roomId}`, serik.token)).body.pause, null);

  section('отключение игрока (§13)');
  sockets.get(erzhan.id)!.close();
  await wait(1_600);
  const paused = (await request('GET', `/rooms/${roomId}`, serik.token)).body;
  check('Ержан пропал дольше отсрочки — пауза, виден он и отсчёт',
    [paused.pause?.players?.map((p: any) => p.name), paused.pause?.players?.[0]?.secondsLeft > 0],
    [['Ержан'], true]);

  const active = paused.game.activeBidderId ?? paused.game.special?.activeId;
  const actor = players.find((p) => p.id === active);
  if (actor && actor.id !== erzhan.id) {
    const denied = await request('POST', `/rooms/${roomId}/bid`, actor.token, { bid: 'ПАС' });
    check('на паузе ход не принимается', [denied.status, denied.body.error], [409, 'game paused']);
  }

  sockets.set(erzhan.id, sit(roomId, erzhan.token));
  await wait(1_500);
  check('Ержан вернулся — пауза снята', (await request('GET', `/rooms/${roomId}`, serik.token)).body.pause, null);

  sockets.get(erzhan.id)!.close();
  await wait(1_000 + 3_000 + 1_500);
  const closed = (await request('GET', `/rooms/${roomId}`, serik.token)).body;
  check('не вернулся за отведённое время — комната закрыта',
    [closed.status, closed.game?.closeReason, closed.game?.leftPlayerIds], ['finished', 'player_left', [erzhan.id]]);

  const kon = before.game.kon;
  const perPlayer = Math.floor(kon / 3);
  check('кон поделён поровну между тремя оставшимися', closed.game?.split?.perPlayer, perPlayer);
  const shares = closed.players.map((p: any) => p.balance - 9_900);
  check('ушедшему — ничего, остаток — одному из оставшихся',
    shares.filter((s: number) => s === 0).length === 1 && shares.reduce((a: number, b: number) => a + b, 0) === kon, true);
  check('Ержан свободен для новой комнаты', (await request('GET', '/me', erzhan.token)).body.roomId, null);
  check('деньги не потерялись: сумма балансов после расчёта', closed.players.reduce((a: number, p: any) => a + p.balance, 0), 40_000);

  for (const s of sockets.values()) s.close();
}

main()
  .catch((e) => {
    console.error('Живая проверка упала:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stopServer();
    try { rmSync(DB_FILE, { force: true }); } catch {}
    const failed = summary();
    process.exit(failed === 0 && process.exitCode !== 1 ? 0 : 1);
  });
