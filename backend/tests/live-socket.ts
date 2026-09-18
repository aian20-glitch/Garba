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

  section('приглашение, ежедневный бонус, подарки (этап 9.3)');
  const aMe = (await request('GET', '/me', a.token)).body;
  check('у игрока есть код для приглашений и подарков', /^[A-Z2-9]{6}$/.test(aMe.code), true);
  check('неверный код приглашения — отказ', (await request('POST', '/accounts', undefined, { name: 'Асель', inviteCode: 'ZZZZZZ' })).status, 400);
  const invited = (await request('POST', '/accounts', undefined, { name: 'Асель', inviteCode: aMe.code.toLowerCase() })).body;
  check('пришла по приглашению — у неё обычные 10 000', invited.balance, 10_000);
  const aAfterInvite = (await request('GET', '/me', a.token)).body;
  check('пригласившему +1 000', [aAfterInvite.balance, aAfterInvite.invitedCount], [11_000, 1]);

  check('бонус ещё не взят: день 1/7, 1 000', aAfterInvite.daily, { claimedToday: false, streak: 1, amount: 1_000 });
  const bonus = await post('/me/daily-bonus', a.token);
  check('забрал ежедневный бонус', [bonus.body.amount, bonus.body.streak, bonus.body.balance], [1_000, 1, 12_000]);
  check('второй раз за день — нельзя', (await post('/me/daily-bonus', a.token)).status, 409);
  check('на главном экране: сегодня уже взят', (await request('GET', '/me', a.token)).body.daily.claimedToday, true);

  const bMe = (await request('GET', '/me', b.token)).body;
  check('найти игрока по коду перед подарком', (await request('GET', `/players/${bMe.code}`, a.token)).body, { code: bMe.code, name: 'Ержан' });
  check('больше 1 000 подарить нельзя', (await post('/gifts', a.token, { toCode: bMe.code, amount: 1_100 })).body.error, 'bad amount');
  check('себе — нельзя', (await post('/gifts', a.token, { toCode: aMe.code, amount: 400 })).body.error, 'self');
  const gift = await post('/gifts', a.token, { toCode: bMe.code, amount: 400 });
  check('подарил 400', [gift.status, gift.body.balance, gift.body.to?.name], [200, 11_600, 'Ержан']);
  check('получатель получил', (await request('GET', '/me', b.token)).body.balance, 10_400);
  check('второй подарок в тот же день — нельзя', (await post('/gifts', a.token, { toCode: bMe.code, amount: 100 })).body.error, 'already gifted today');

  const serikBefore = (await request('GET', `/rooms/${roomId}`, serik.token)).body.players.find((p: any) => p.id === serik.id);
  check('сидит за столом — дарить нельзя', (await post('/gifts', serik.token, { toCode: bMe.code, amount: 100 })).body.error, 'finish your game first');
  await post('/gifts', b.token, { toCode: (await request('GET', '/me', serik.token)).body.code, amount: 300 });
  await post('/me/daily-bonus', serik.token);
  const serikAfter = (await request('GET', `/rooms/${roomId}`, serik.token)).body.players.find((p: any) => p.id === serik.id);
  check('подарок и бонус игроку за столом дошли до баланса в комнате',
    serikAfter.balance - serikBefore.balance, 1_300);
  check('и не считаются выигрышем за столом', serikAfter.startBalance - serikBefore.startBalance, 1_300);
  check('баланс аккаунта совпадает с комнатой', (await request('GET', '/me', serik.token)).body.balance, serikAfter.balance);

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
