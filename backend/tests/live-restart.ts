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
      GARBA_READY_MS: '2000',
      GARBA_VACANCY_MS: '3000',
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

  for (const p of players) await request('POST', `/rooms/${roomId}/ready`, p.token);
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

  // Доигрываем раздачу: все пасуют — пересдача, между раздачами (24.09.2026).
  for (let i = 0; i < 30; i++) {
    const g = (await request('GET', `/rooms/${roomId}`, serik.token)).body.game;
    if (g.stage === 'bidding') {
      const p = players.find((x) => x.id === g.activeBidderId)!;
      await request('POST', `/rooms/${roomId}/bid`, p.token, { bid: 'ПАС' });
    } else if (g.stage === 'special') {
      const p = players.find((x) => x.id === g.special.activeId)!;
      await request('POST', `/rooms/${roomId}/special`, p.token, { action: 'pass' });
    } else break;
  }
  const between = (await request('GET', `/rooms/${roomId}`, serik.token)).body;
  check('все спасовали — между раздачами', ['awaiting_deal', 'round_done'].includes(between.game.stage), true);

  section('пропал на 5 минут между раздачами — место свободно, кон делится (24.09.2026)');
  sockets.get(erzhan.id)!.close();
  // Запас 5 минут (здесь 3 с) общий на игру — ждём, когда место освободится.
  let freed: any = null;
  for (let i = 0; i < 60 && !freed; i++) {
    await wait(200);
    const b = (await request('GET', `/rooms/${roomId}`, serik.token)).body;
    if (b.pause?.vacancies?.length) freed = b;
  }
  const kon = between.game.kon;
  check('комната не закрыта, Ержана за столом нет, его место свободно',
    [freed.status, freed.players.map((p: any) => p.name).includes('Ержан'), freed.pause?.vacancies?.length], ['started', false, 1]);
  check('кон разделён между тремя оставшимися, кон пуст',
    [freed.game.lastLeave?.name, freed.game.lastLeave?.perPlayer, freed.game.kon], ['Ержан', Math.floor(kon / 3), 0]);
  check('Ержан свободен для новой комнаты', (await request('GET', '/me', erzhan.token)).body.roomId, null);
  check('ушёл — рейтинг 4.0 → 3.0', (await request('GET', '/me', erzhan.token)).body.rating, 3);
  const total = (b: any) => b.players.reduce((a: number, p: any) => a + p.balance, 0) + b.game.kon;
  const erzhanBalance = (await request('GET', '/me', erzhan.token)).body.balance;
  check('деньги не потерялись: трое за столом + кон + Ержан', total(freed) + erzhanBalance, 40_000);
  const nextDealer = players.find((p) => p.id === freed.game.dealerId);
  if (nextDealer && nextDealer.id !== erzhan.id) {
    check('пока место свободно — раздавать нельзя',
      (await request('POST', `/rooms/${roomId}/dealer/continue`, nextDealer.token)).body.error, 'game paused');
  }

  section('на свободное место садится новый игрок — все начинают с пустого кона');
  const farid: Me = (await request('POST', '/accounts', undefined, { name: 'Фарид' })).body;
  const open = (await request('GET', '/rooms/open', farid.token)).body.rooms;
  check('открытой игры со свободным местом нет в списке, пока она закрытая', open.some((r: any) => r.id === roomId), false);
  const joined = await request('POST', `/rooms/${roomId}/join`, farid.token);
  sockets.set(farid.id, sit(roomId, farid.token));
  await wait(1_500);
  const refilled = (await request('GET', `/rooms/${roomId}`, serik.token)).body;
  check('Фарид сел на место Ержана, пауза снята',
    [joined.status, refilled.players.find((p: any) => p.id === farid.id)?.seat, refilled.pause],
    [200, freed.players.length === 3 ? [0, 1, 2, 3].find((s) => !freed.players.some((p: any) => p.seat === s)) : -1, null]);

  section('«Выйти» между раздачами, никто не сел — игра заканчивается');
  const leftNow = await request('POST', `/rooms/${roomId}/leave`, serik.token);
  check('Серик вышел из игры', leftNow.body.left, true);
  await wait(3_500);
  const closed = (await request('GET', `/rooms/${roomId}`, farid.token)).body;
  check('место пустовало — комната закрыта', [closed.status, closed.game?.closeReason], ['finished', 'seat_empty']);
  check('ушедшему комната не засчитана как доигранная', (await request('GET', '/me/profile', serik.token)).body.stats.rooms, 0);
  check('доигравшему засчитана', (await request('GET', '/me/profile', farid.token)).body.stats.rooms, 1);
  check('победитель комнаты отмечен сервером', Array.isArray(closed.game?.winnerIds) && closed.game.winnerIds.length > 0, true);

  const board = (await request('GET', '/rating?scope=all', serik.token)).body;
  check('общий рейтинг: все 5 игроков (с Фаридом), по убыванию, моё место известно',
    [board.total, board.players.every((p: any, i: number) => i === 0 || board.players[i - 1].rating >= p.rating), typeof board.myPlace],
    [5, true, 'number']);
  const friendsBoard = (await request('GET', '/rating?scope=friends', serik.token)).body;
  check('рейтинг друзей без друзей — только я, место 1', [friendsBoard.total, friendsBoard.myPlace], [1, 1]);

  for (const s of sockets.values()) s.close();

  // «ГОТОВ» (23.09.2026): кто не нажал за отведённое время (здесь 2 с), выходит.
  section('не нажал «ГОТОВ» — вышел из комнаты, остальные ждут новых');
  const lobbyPlayers: Me[] = [];
  for (const name of ['Асан', 'Болат', 'Гульнар', 'Диас']) {
    lobbyPlayers.push((await request('POST', '/accounts', undefined, { name })).body);
  }
  const [asan, bolat, gulnar, dias] = lobbyPlayers;
  const lobby = (await request('POST', '/rooms', asan.token, {
    capacity: 4, ante: 100, emptyLimit: 5, konThreshold: 10, minBalance: 1000,
  })).body;
  for (const p of [bolat, gulnar, dias]) await request('POST', `/rooms/${lobby.id}/join`, p.token);
  await request('POST', `/rooms/${lobby.id}/ready`, bolat.token);
  await request('POST', `/rooms/${lobby.id}/ready`, dias.token);
  await wait(3500);
  const lobbyAfter = (await request('GET', `/rooms/${lobby.id}`, bolat.token)).body;
  check('остались только нажавшие, игра не началась',
    [lobbyAfter.status, lobbyAfter.players.map((p: any) => p.name)], ['lobby', ['Болат', 'Диас']]);
  check('создатель Асан не нажал — создателем стал Болат', lobbyAfter.creatorId, bolat.id);
  check('не нажавшие знают, почему вышли', lobbyAfter.readyDroppedIds, [asan.id, gulnar.id]);
  check('вышедший свободен — может зайти в другую комнату', (await request('GET', '/me', asan.token)).body.roomId, null);
}

main()
  .catch((e) => {
    console.error('Живая проверка упала:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stopServer();
    for (const f of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) {
      try { rmSync(f, { force: true }); } catch {}
    }
    const failed = summary();
    process.exit(failed === 0 && process.exitCode !== 1 ? 0 : 1);
  });
