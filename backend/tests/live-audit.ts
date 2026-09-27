// Живая проверка находок последнего аудита (28.09.2026): закрытая комната не трогает
// аккаунты, «закончить игру» — только за столом, пропавший главный проигрывает сразу,
// лимит на сокеты. Настоящий сервер на порту 3095, база в памяти. Запуск: npm run test:live

import { spawn } from 'node:child_process';
import { io as connect } from 'socket.io-client';
import { check, section, summary } from './check.js';

const PORT = 3095;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    GARBA_DB: ':memory:',
    GARBA_GRACE_MS: '1000',
    GARBA_DISCONNECT_MS: '3000',
    GARBA_REQS_PER_10S: '20',
  },
  stdio: 'ignore',
});

async function request(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

const account = async (name: string) => (await request('POST', '/accounts', undefined, { name })).body;
const balanceOf = async (token: string) => (await request('GET', '/me', token)).body.balance as number;

async function closedRoom() {
  section('закрытая комната больше не пишет в аккаунты (28.09.2026)');
  const host = await account('Хозяин');
  const pal = await account('Друг');
  const room = (await request('POST', '/rooms', host.token, { capacity: 4, ante: 100, emptyLimit: 5, konThreshold: 10, minBalance: 1000 })).body;
  await request('POST', `/rooms/${room.id}/join`, pal.token);
  await request('POST', `/rooms/${room.id}/leave`, host.token);
  check('создатель ушёл — лобби закрылось',
    (await request('GET', `/rooms/${room.id}`, pal.token)).body.status, 'finished');

  const before = await balanceOf(pal.token);
  const bonus = await request('POST', '/me/daily-bonus', pal.token);
  check('после закрытия бонус пришёл', await balanceOf(pal.token), before + bonus.body.amount);
  await request('POST', `/rooms/${room.id}/react`, pal.token, { emoji: '👍' });
  await request('POST', `/rooms/${room.id}/back`, host.token);
  check('смайлик и чужой запрос в закрытую комнату бонус не стёрли',
    await balanceOf(pal.token), before + bonus.body.amount);

  const hostCode = (await request('GET', '/me', host.token)).body.code;
  const gift = await request('POST', '/gifts', pal.token, { toCode: hostCode, amount: 1000 });
  check('подарок ушёл', gift.status, 200);
  const afterGift = await balanceOf(pal.token);
  await request('POST', `/rooms/${room.id}/react`, pal.token, { emoji: '😂' });
  check('подарок не возвращается смайликом в старую комнату', await balanceOf(pal.token), afterGift);
}

async function goneMain() {
  section('пропавший главный — сразу проигрыш (RULES.md §13)');
  const players = [];
  for (let i = 0; i < 4; i++) players.push(await account(`Г${i}`));
  const room = (await request('POST', '/rooms', players[0].token, { capacity: 4, ante: 100, emptyLimit: 5, konThreshold: 10, minBalance: 1000 })).body;
  for (const p of players.slice(1)) await request('POST', `/rooms/${room.id}/join`, p.token);
  for (const p of players) await request('POST', `/rooms/${room.id}/ready`, p.token);

  let state = (await request('GET', `/rooms/${room.id}`, players[0].token)).body;
  const dealer = players.find((p) => p.id === state.game.dealerId)!;
  await request('POST', `/rooms/${room.id}/dealer/continue`, dealer.token);
  // Спецкарта (при 4 игроках — червы A K Q 6 10): все пасуют, дальше обычные торги.
  for (let k = 0; k < 20; k++) {
    state = (await request('GET', `/rooms/${room.id}`, players[0].token)).body;
    if (state.game.stage !== 'special') break;
    const actor = players.find((p) => p.id === state.game.special.activeId)!;
    await request('POST', `/rooms/${room.id}/special`, actor.token, { action: 'pass' });
  }
  check('раздача дошла до торгов', state.game.stage, 'bidding');

  const gone = players.find((p) => p.id === state.game.activeBidderId)!;
  const others = players.filter((p) => p !== gone);
  check('первый в торгах сказал РАЗ', (await request('POST', `/rooms/${room.id}/bid`, gone.token, { bid: 'РАЗ' })).status, 200);

  // Он пропал: запросов от него больше нет. Остальные на связи — опрашивают стол.
  for (let t = 0; t < 40; t++) {
    for (const p of others) state = (await request('GET', `/rooms/${room.id}`, p.token)).body;
    if (state.game.goneIds?.includes(gone.id)) break;
    await wait(300);
  }
  check('через 3 секунды (вместо 5 минут) он отмечен пропавшим', state.game.goneIds?.includes(gone.id), true);

  // Остальные пасуют — главным становится пропавший.
  for (let t = 0; t < 10 && state.game.stage === 'bidding'; t++) {
    const bidder = others.find((p) => p.id === state.game.activeBidderId);
    if (bidder) await request('POST', `/rooms/${room.id}/bid`, bidder.token, { bid: 'ПАС' });
    state = (await request('GET', `/rooms/${room.id}`, others[0].token)).body;
  }
  const result = state.game.result?.find((r: any) => r.playerId === gone.id);
  check('главный пропал до розыгрыша — раздача сразу кончилась его проигрышем',
    [state.game.stage, result?.won, result?.conceded, result?.delta < 0], ['round_done', false, true, true]);

  section('«закончить игру» — только тем, кто за столом (§12.3)');
  const stranger = await account('Чужой');
  check('посторонний предложить не может — 403',
    (await request('POST', `/rooms/${room.id}/end-game`, stranger.token, { choice: 'yes' })).status, 403);
  check('и голосования нет', (await request('GET', `/rooms/${room.id}`, others[0].token)).body.game.endVote, null);
}

async function socketLimits() {
  section('сокеты под общим лимитом с адреса (28.09.2026)');
  const results: boolean[] = [];
  for (let i = 0; i < 24; i++) {
    const socket = connect(BASE, {
      transports: ['polling'],
      extraHeaders: { 'X-Forwarded-For': '7.7.7.7' },
      reconnection: false,
      forceNew: true,
    });
    results.push(await new Promise<boolean>((resolve) => {
      socket.on('connect', () => resolve(true));
      socket.on('connect_error', () => resolve(false));
    }));
    socket.close();
  }
  check('20 подключений с адреса — можно, дальше — отказ',
    [results.slice(0, 20).every(Boolean), results.slice(20).some((ok) => !ok)], [true, true]);

  const me = await account('Смотрящий');
  const room = (await request('POST', '/rooms', me.token, { capacity: 4, ante: 100, emptyLimit: 5, konThreshold: 10, minBalance: 1000 })).body;
  const socket = connect(BASE, { transports: ['websocket'], reconnection: false, forceNew: true });
  let answers = 0;
  socket.on('room', () => answers++);
  await new Promise((r) => socket.on('connect', r));
  for (let i = 0; i < 15; i++) socket.emit('watch', { roomId: room.id, token: me.token });
  await wait(700);
  check('частый watch с одного сокета — отвечаем не больше 10 раз за 10 секунд', answers, 10);
  socket.close();
}

async function main() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/health')).ok) break; } catch {}
    await wait(200);
  }
  await closedRoom();
  await goneMain();
  await socketLimits();
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
