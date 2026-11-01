// Живая проверка времени стола (RULES.md §20, 01.11.2026): настройка при создании, часы
// с первой раздачи, вопрос за 5 минут, продление только единогласно, отказ, молчание до
// 00:00, конец между раздачами и после доигранной раздачи, выход после конца — без бана,
// выход во время вопроса — бан как раньше, «без ограничения», перезапуск сервера посреди
// вопроса. Порт 3091, база во временном файле. «Минута» стола — 2 секунды
// (GARBA_TABLE_MINUTE_MS): 15 минут = 30 с, вопрос за 10 с до конца, продление +20 с.
// Запуск: npm run test:live

import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, section, summary } from './check.js';

const PORT = 3091;
const BASE = `http://127.0.0.1:${PORT}`;
const DB_FILE = join(tmpdir(), `garba-live-timer-${Date.now()}.db`);
const MINUTE = 2_000;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let server: ChildProcess | null = null;

async function startServer() {
  server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      GARBA_DB: DB_FILE,
      GARBA_TABLE_MINUTE_MS: String(MINUTE),
      // Связь и время на ход — длинные: проверяем только часы стола.
      GARBA_GRACE_MS: '600000',
      GARBA_TURN_MS: '600000',
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

type P = { id: string; name: string; token: string };

async function request(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

const account = async (name: string): Promise<P> => (await request('POST', '/accounts', undefined, { name })).body;
const view = async (roomId: string, p: P) => (await request('GET', `/rooms/${roomId}`, p.token)).body;
const post = (roomId: string, p: P, path: string, body: unknown = {}) =>
  request('POST', `/rooms/${roomId}/${path}`, p.token, body);
const settings = { capacity: 4, ante: 100, emptyLimit: 10, konThreshold: 10, minBalance: 1000 };

// Ждём, пока условие не выполнится (опрашиваем стол раз в 300 мс).
async function until(roomId: string, p: P, ok: (s: any) => boolean, ms: number) {
  const end = Date.now() + ms;
  let s = await view(roomId, p);
  while (!ok(s) && Date.now() < end) {
    await wait(300);
    s = await view(roomId, p);
  }
  return s;
}

// Четверо за столом, все нажали «ГОТОВ» — игра началась (раздающий найден, карт ещё нет).
async function fourAtTable(prefix: string, extra: Record<string, unknown>) {
  const players: P[] = [];
  for (let i = 0; i < 4; i++) players.push(await account(`${prefix}${i}`));
  const room = (await request('POST', '/rooms', players[0].token, { ...settings, ...extra })).body;
  for (const p of players.slice(1)) await post(room.id, p, 'join');
  for (const p of players) await post(room.id, p, 'ready');
  return { players, roomId: room.id as string };
}

const dealer = (s: any, players: P[]) => players.find((p) => p.id === s.game.dealerId)!;

// Все пасуют (и в борьбе за спецкарту) — раздача кончается пересдачей.
async function passAll(roomId: string, players: P[]) {
  for (let i = 0; i < 40; i++) {
    const g = (await view(roomId, players[0])).game;
    const actorId = g.stage === 'special' ? g.special?.activeId : g.stage === 'bidding' ? g.activeBidderId : null;
    if (!actorId) return;
    const actor = players.find((p) => p.id === actorId)!;
    if (g.stage === 'special') await post(roomId, actor, 'special', { action: 'pass' });
    else await post(roomId, actor, 'bid', { bid: 'ПАС' });
  }
}

const vote = (roomId: string, p: P, choice: 'yes' | 'no', forEndsAt: number) =>
  post(roomId, p, 'extend-vote', { choice, forEndsAt });

async function creation() {
  section('настройка «Время игры» при создании (§20.1, §20.2)');
  const p = await account('Хозяин');
  const short = await request('POST', '/rooms', p.token, { ...settings, timeLimitMinutes: 10 });
  check('10 минут — 400 «time limit too short» (сценарий 15)', [short.status, short.body.error, short.body.min], [400, 'time limit too short', 15]);
  const long = await request('POST', '/rooms', p.token, { ...settings, timeLimitMinutes: 200 });
  check('200 минут — 400 «time limit too long» (сценарий 16)', [long.status, long.body.error, long.body.max], [400, 'time limit too long', 180]);
  const ok = await request('POST', '/rooms', p.token, { ...settings, timeLimitMinutes: 45, isPublic: true });
  check('своё время 45 минут — стол создан (сценарий 14)', [ok.status, ok.body.settings.timeLimitMinutes], [201, 45]);
  const other = await account('Гость');
  const open = (await request('GET', '/rooms/open', other.token)).body.rooms.find((r: any) => r.id === ok.body.id);
  check('до входа видно время игры — в «Открытых комнатах»', open?.settings?.timeLimitMinutes, 45);
  check('в лобби часов нет — время не идёт (§20.3)', ok.body.game ?? null, null);
  await post(ok.body.id, p, 'leave');
}

async function extendAndExpire() {
  section('вопрос за 5 минут, единогласное продление, отказ, конец между раздачами (сценарии 2, 3, 5–7, 9, 12, 13)');
  const { players, roomId } = await fourAtTable('Т', { timeLimitMinutes: 15 });
  let s = await view(roomId, players[0]);
  check('игра началась, но раздачи не было — часы не идут', [s.game.stage, s.game.tableClock], ['dealer_found', null]);
  s = await until(roomId, players[0], (x) => x.game.dealShowLeftMs === 0, 15_000);
  await post(roomId, dealer(s, players), 'dealer/continue');
  s = await view(roomId, players[1]);
  check('первая раздача — часы пошли: 15 минут', [s.game.tableClock?.minutes, s.game.tableClock?.secondsLeft > 25, s.game.tableClock?.vote], [15, true, null]);
  await passAll(roomId, players);

  s = await until(roomId, players[0], (x) => !!x.game.tableClock?.vote, 30_000);
  const forEndsAt = s.game.tableClock.vote?.forEndsAt;
  check('за 5 минут до конца — вопрос всем', [!!forEndsAt, s.game.tableClock.secondsLeft <= 10, s.game.myCanVoteExtend], [true, true, true]);
  for (const p of players.slice(0, 3)) await vote(roomId, p, 'yes', forEndsAt);
  s = await view(roomId, players[3]);
  check('трое «да» — «проголосовали 3 из 4», время прежнее', [s.game.tableClock.vote?.votedCount, s.game.tableClock.vote?.voterCount, s.game.tableClock.endsAt], [3, 4, forEndsAt]);
  check('голос ещё не принят — четвёртый видит вопрос (как после переподключения, сценарий 12)', [s.game.myCanVoteExtend, s.game.myExtendVote], [true, null]);
  const mine = await view(roomId, players[0]);
  check('уже проголосовал — кнопок нет, видно «да» (сценарий 13)', [mine.game.myCanVoteExtend, mine.game.myExtendVote], [false, 'yes']);
  check('повторный голос — 409 «already voted»', (await vote(roomId, players[0], 'yes', forEndsAt)).body.error, 'already voted');

  section('сервер перезапустился посреди вопроса — часы и голоса на месте (§20.23)');
  await stopServer();
  await startServer();
  s = await view(roomId, players[3]);
  check('после перезапуска: тот же вопрос, 3 из 4, мой голос ещё нужен',
    [s.game.tableClock?.vote?.forEndsAt, s.game.tableClock?.vote?.votedCount, s.game.myCanVoteExtend], [forEndsAt, 3, true]);
  check('часы не сбросились', s.game.tableClock?.endsAt, forEndsAt);

  const last = await vote(roomId, players[3], 'yes', forEndsAt);
  check('четвёртый «да» — все согласны: +10 минут ровно один раз',
    [last.status, last.body.game.tableClock.endsAt - forEndsAt, last.body.game.tableClock.extensions, last.body.game.tableClock.lastVote?.result, last.body.game.tableClock.vote],
    [200, 10 * MINUTE, 1, 'approved', null]);
  check('нажатие на старый вопрос — уже не считается', (await vote(roomId, players[0], 'yes', forEndsAt)).status, 409);

  const newEnd = forEndsAt + 10 * MINUTE;
  s = await until(roomId, players[0], (x) => !!x.game.tableClock?.vote, 25_000);
  check('за 5 минут до нового конца — новый вопрос (сценарий 5)', s.game.tableClock.vote?.forEndsAt, newEnd);
  await vote(roomId, players[0], 'yes', newEnd);
  const no = await vote(roomId, players[2], 'no', newEnd);
  check('один «не продлевать» — отказ сразу, время прежнее (сценарий 6)',
    [no.body.game.tableClock.lastVote?.result, no.body.game.tableClock.vote, no.body.game.tableClock.endsAt], ['rejected', null, newEnd]);
  check('остальным голосовать уже не о чем', (await vote(roomId, players[1], 'yes', newEnd)).body.error, 'no extension vote');

  s = await until(roomId, players[0], (x) => x.status === 'finished', 15_000);
  check('время вышло между раздачами — стол закрыт сразу (сценарий 7)', [s.status, s.game.stage, s.game.closeReason], ['finished', 'room_done', 'time_limit']);
  check('кон поделили поровну, монеты на месте', s.players.reduce((a: number, x: any) => a + x.balance, 0), 4 * 30_000);
  const ratingBefore = (await request('GET', '/me', players[1].token)).body.rating;
  const left = await post(roomId, players[1], 'leave');
  const meAfter = (await request('GET', '/me', players[1].token)).body;
  check('после конца по времени вышел — без бана и без штрафа рейтинга (сценарий 9)',
    [left.status, meAfter.leaveBan, meAfter.rating, meAfter.roomId], [409, null, ratingBefore, null]);
}

async function midDeal() {
  section('время вышло посреди раздачи — доигрываем, новую не начинаем (сценарии 4, 8)');
  const { players, roomId } = await fourAtTable('С', { timeLimitMinutes: 15 });
  let s = await until(roomId, players[0], (x) => x.game.dealShowLeftMs === 0, 15_000);
  await post(roomId, dealer(s, players), 'dealer/continue');
  s = await until(roomId, players[0], (x) => !!x.game.tableClock?.vote, 30_000);
  const forEndsAt = s.game.tableClock.vote.forEndsAt;
  for (const p of players.slice(0, 3)) await vote(roomId, p, 'yes', forEndsAt);
  // Четвёртый молчит. Раздача стоит на торгах — 00:00 наступает посреди раздачи.
  s = await until(roomId, players[0], (x) => !!x.game.tableClock?.reached, 15_000);
  check('3 из 4 «да», четвёртый не ответил — в 00:00 продления нет (сценарий 4)',
    [s.game.tableClock.lastVote?.result, s.game.tableClock.endsAt, s.game.tableClock.extensions], ['expired', forEndsAt, 0]);
  check('раздача не оборвана — стол ещё идёт', [s.status, ['bidding', 'special'].includes(s.game.stage)], ['started', true]);
  await passAll(roomId, players);
  s = await until(roomId, players[0], (x) => x.status === 'finished', 5_000);
  check('раздачу доиграли — новая не началась, стол закрыт по времени', [s.status, s.game.closeReason], ['finished', 'time_limit']);
}

async function leaveDuringVote() {
  section('вышел сам, пока стол идёт, — бан как раньше (сценарии 10, 11, §20.14, §20.15)');
  const { players, roomId } = await fourAtTable('В', { timeLimitMinutes: 15 });
  let s = await until(roomId, players[0], (x) => x.game.dealShowLeftMs === 0, 15_000);
  await post(roomId, dealer(s, players), 'dealer/continue');
  await passAll(roomId, players);
  s = await until(roomId, players[0], (x) => !!x.game.tableClock?.vote, 30_000);
  check('идёт вопрос о продлении, до конца меньше 5 минут', [!!s.game.tableClock.vote, s.game.tableClock.secondsLeft <= 10], [true, true]);
  const ratingBefore = (await request('GET', '/me', players[3].token)).body.rating;
  const left = await post(roomId, players[3], 'leave');
  const me = (await request('GET', '/me', players[3].token)).body;
  check('вышел во время вопроса — бан за выход и −1.0 рейтинга',
    [left.status, me.leaveBan?.count, me.leaveBan?.secondsLeft > 0, Math.round((ratingBefore - me.rating) * 10) / 10], [200, 1, true, 1]);
}

async function unlimited() {
  section('«Без ограничения» — ни часов, ни вопроса (сценарий 17)');
  const { players, roomId } = await fourAtTable('Б', { timeLimitMinutes: null });
  let s = await until(roomId, players[0], (x) => x.game.dealShowLeftMs === 0, 15_000);
  check('в настройках — без ограничения', s.settings.timeLimitMinutes, null);
  await post(roomId, dealer(s, players), 'dealer/continue');
  await wait(1_500);
  s = await view(roomId, players[0]);
  check('раздача идёт — часов нет', [s.game.stage !== 'dealer_found', s.game.tableClock], [true, null]);
  check('голосовать не о чем', (await vote(roomId, players[0], 'yes', 0)).body.error, 'no extension vote');
  const old = await account('Старый');
  const legacy = (await request('POST', '/rooms', old.token, settings)).body;
  check('старое приложение не присылает время — без ограничения, как раньше', legacy.settings.timeLimitMinutes, null);
}

try {
  await startServer();
  await creation();
  await unlimited();
  await leaveDuringVote();
  await midDeal();
  await extendAndExpire();
} catch (e) {
  console.error(e);
  check('проверка дошла до конца без ошибок', String(e), 'ok');
} finally {
  await stopServer();
  for (const f of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) rmSync(f, { force: true });
}
process.exit(summary() === 0 ? 0 : 1);
