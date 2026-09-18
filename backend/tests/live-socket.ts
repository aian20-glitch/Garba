// Живая проверка сервера: поднимает настоящий сервер на отдельном порту с базой
// в памяти, заводит аккаунты, подключает игроков по сокету и смотрит, что приходит.
// Этап 8 — рассылка по Socket.IO; этап 9.1 — аккаунты и токены.
// Запуск: npm run test:live   (сервер на 3000 и файл базы не трогает — порт 3099, база в памяти)

import { spawn } from 'node:child_process';
import { io, type Socket } from 'socket.io-client';
import { check, section, summary } from './check.js';

const PORT = 3099;
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), GARBA_DB: ':memory:' },
  stdio: 'ignore',
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Me = { id: string; name: string; balance: number; token: string };

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

const post = (path: string, token: string, body: unknown = {}) => request('POST', path, token, body);

async function account(name: string): Promise<Me> {
  return (await request('POST', '/accounts', undefined, { name })).body;
}

// Последнее состояние комнаты, которое пришло этому игроку по сокету.
function watcher(roomId: string, token: string) {
  const socket: Socket = io(BASE, { transports: ['websocket'], forceNew: true });
  const state: { last: any; count: number; error: string } = { last: null, count: 0, error: '' };
  socket.on('connect', () => socket.emit('watch', { roomId, token }));
  socket.on('room', (room) => {
    state.last = room;
    state.count++;
  });
  socket.on('room_error', (e) => { state.error = e.error; });
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

  section('аккаунты (этап 9.1)');
  const serik = await account('Серик');
  check('аккаунт создан, 10 000 на счету', serik.balance, 10_000);
  check('токен выдан', typeof serik.token === 'string' && serik.token.length === 64, true);
  check('пустое имя — отказ', (await request('POST', '/accounts', undefined, { name: '  ' })).status, 400);

  const meRes = await request('GET', '/me', serik.token);
  check('GET /me по токену — свой аккаунт, кириллица целая', [meRes.body.id, meRes.body.name], [serik.id, 'Серик']);
  check('GET /me без токена — 401', (await request('GET', '/me')).status, 401);
  check('комнаты без токена — 401', (await request('POST', '/rooms', undefined, { capacity: 4 })).status, 401);

  const bots: Me[] = [];
  for (let i = 1; i <= 3; i++) bots.push(await account(`Бот ${i}`));

  section('живые обновления по сокету (этап 8)');
  const created = await post('/rooms', serik.token, {
    playerId: bots[0].id, name: 'Самозванец', // должны игнорироваться
    capacity: 4, ante: 100, emptyLimit: 5, konThreshold: 10, minBalance: 1000,
  });
  const roomId = created.body.id;
  check('создатель комнаты — владелец токена, а не playerId из тела',
    [created.body.creatorId, created.body.players?.[0]?.name], [serik.id, 'Серик']);
  check('вторую комнату тому же игроку не создать — 409 и номер его комнаты',
    [(await post('/rooms', serik.token, { capacity: 4, ante: 100, emptyLimit: 5, konThreshold: 10, minBalance: 1000 })).body.roomId],
    [roomId]);
  check('GET /me знает, в какой он комнате', (await request('GET', '/me', serik.token)).body.roomId, roomId);

  const serikWatch = watcher(roomId, serik.token);
  await wait(500);
  check('сразу после подписки приходит состояние комнаты', serikWatch.state.last?.id, roomId);

  // Вход трёх игроков — сокет Серика должен узнать об этом сам, без запроса.
  for (const b of bots) await post(`/rooms/${roomId}/join`, b.token);
  await wait(500);
  check('игроки вошли — Серик узнал сам: 4 из 4', serikWatch.state.last?.players?.length, 4);

  const botWatch = watcher(roomId, bots[0].token);
  check('старт не от создателя — 403 (playerId в теле не помогает)',
    (await post(`/rooms/${roomId}/start`, bots[0].token, { playerId: serik.id })).status, 403);
  await post(`/rooms/${roomId}/start`, serik.token);
  await wait(300);
  const dealerId = serikWatch.state.last?.game?.dealerId;
  const dealer = [serik, ...bots].find((p) => p.id === dealerId)!;
  await post(`/rooms/${roomId}/dealer/continue`, dealer.token);
  await wait(500);

  const mine = serikWatch.state.last?.game;
  const theirs = botWatch.state.last?.game;
  check('после раздачи оба получили новое состояние', [mine?.stage, theirs?.stage].every((s) => s && s !== 'dealer_found'), true);

  const myIds = (mine?.hand ?? []).map((c: any) => c.id).sort().join();
  const botIds = (theirs?.hand ?? []).map((c: any) => c.id).sort().join();
  check('каждому пришла своя рука', myIds.length > 0 && botIds.length > 0 && myIds !== botIds, true);
  check('чужих карт в рассылке нет: у Серика нет ни одной карты бота',
    (mine?.hand ?? []).some((c: any) => botIds.split(',').includes(c.id)), false);

  const peek = await request('GET', `/rooms/${roomId}?playerId=${bots[0].id}`, serik.token);
  check('чужую руку через ?playerId= не подсмотреть — отдаётся своя',
    (peek.body.game?.hand ?? []).map((c: any) => c.id).sort().join(), myIds);

  const kon = serikWatch.state.last?.game?.kon ?? 0;
  const afterAnte = (await request('GET', '/me', serik.token)).body.balance;
  check('взнос списан и записан в аккаунт', [kon, afterAnte], [400, 9_900]);

  const before = serikWatch.state.count;
  await post(`/rooms/${roomId}/bid`, serik.token, { bid: 'ПАС' }); // скорее всего не его ход — отказ
  await wait(300);
  check('после любого запроса к комнате приходит рассылка (безвредно)', serikWatch.state.count > before, true);

  const ghost = watcher('00000', serik.token);
  const stranger = watcher(roomId, 'x'.repeat(64));
  await wait(500);
  check('подписка на несуществующую комнату — ошибка, а не молчание', ghost.state.error, 'room not found');
  check('подписка с чужим токеном — отказ', [stranger.state.error, stranger.state.last], ['unauthorized', null]);

  section('выход из лобби');
  const a = await account('Дана');
  const b = await account('Ержан');
  const lobby = (await post('/rooms', a.token, { capacity: 4, ante: 100, emptyLimit: 5, konThreshold: 10, minBalance: 1000 })).body;
  await post(`/rooms/${lobby.id}/join`, b.token);
  const left = await post(`/rooms/${lobby.id}/leave`, b.token);
  check('игрок вышел из лобби', left.body.players?.length, 1);
  check('и может зайти в другую комнату', (await request('GET', '/me', b.token)).body.roomId, null);
  const closed = await post(`/rooms/${lobby.id}/leave`, a.token);
  check('ушёл создатель — комната закрыта', closed.body.status, 'finished');
  check('из начатой игры так не выйти', (await post(`/rooms/${roomId}/leave`, bots[1].token)).status, 409);

  for (const w of [serikWatch, botWatch, ghost, stranger]) w.socket.close();
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
