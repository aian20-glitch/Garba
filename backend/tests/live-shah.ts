// Живая проверка ШАХ (этап 2, 04.11.2026): настоящий сервер на порту 3090 с GARBA_SHAH=1, база во
// временном файле, сроки укорочены. Комнаты, «ГОТОВ», матч до −24 с монетами, чужие карты не
// уходят никому (и по сокету, и зрителю), одна комната за раз вместе с Габрой, выход и бан,
// время на ход и «ушёл», отключение, тренировка с ботами, перезапуск сервера посреди матча.
// Запуск: npm run test:live

import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { check, section, summary } from './check.js';
import { shownRating } from '../src/rating.js';
import { matchRatingDeltas, partyDeltas, settleShah } from '../src/shah/rating.js';

const PORT = 3090;
const BASE = `http://127.0.0.1:${PORT}`;
const DB_FILE = join(tmpdir(), `garba-live-shah-${Date.now()}.db`);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let server: ChildProcess | null = null;

async function startServer(port = PORT, shah = true) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    env: {
      ...process.env,
      PORT: String(port),
      GARBA_DB: port === PORT ? DB_FILE : ':memory:',
      GARBA_SHAH: shah ? '1' : '',
      GARBA_TURN_MS: '1500',
      GARBA_GRACE_MS: '2000',
      GARBA_DISCONNECT_MS: '4000',
      GARBA_READY_MS: '3000',
      GARBA_SHAH_SHOW_MS: '200',
      GARBA_SHAH_BOT_MS: '50',
      GARBA_SHAH_ANIM_MS: '300',
      GARBA_SHAH_BOT_TICK_MS: '40',
      GARBA_TABLE_MINUTE_MS: '400', // «минута» стола — 0,4 с (только у столов с временем игры)
      GARBA_PERSONAL_PAUSE_MS: '1000',
      GARBA_SHAH_RATING_MINUTE_MS: '10', // «минута» рейтинга ШАХ — 10 мс: матч в секунды идёт «больше часа»
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return child;
    } catch {}
    await wait(200);
  }
  throw new Error('сервер не поднялся');
}

async function stopServer(child: ChildProcess | null) {
  if (!child) return;
  const exited = new Promise((r) => child.once('exit', r));
  child.kill();
  await exited;
}

async function request(method: string, path: string, token?: string, body?: unknown, base = BASE) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

type P = { id: string; name: string; token: string; code: string };
async function account(name: string): Promise<P> {
  return (await request('POST', '/accounts', undefined, { name })).body;
}
const balanceOf = async (p: P) => (await request('GET', '/me', p.token)).body.balance as number;
const stateOf = async (roomId: string, p: P) => (await request('GET', `/shah/rooms/${roomId}`, p.token)).body;

// Ни одной карты чужой руки (кроме показанных всем) и ни одной чужой закрытой — в чужом состоянии.
// Перед поиском убираем то, что по правилам видно всем и может совпасть с картой в руке:
// вскрытие на туза (другая колода — номера те же), открытая карта козыря, карта, по которой
// назначен козырь, последняя взятая при доборе (их все видели, когда их брали).
let leakCount = 0;
function scrubPublic(state: any): any {
  const copy = structuredClone(state);
  if (copy.game) {
    copy.game.firstDealer = null;
    if (copy.game.party) {
      copy.game.party.openCard = null;
      copy.game.party.trumpCard = null;
      copy.game.party.deckOpenCard = null;
      copy.game.party.lastDraw = null;
    }
  }
  return copy;
}
function countLeaks(states: any[]) {
  states.forEach((viewerState, v) => {
    const json = JSON.stringify(scrubPublic(viewerState));
    states.forEach((other, o) => {
      if (o === v || !other.game) return;
      const shown = new Set((viewerState.game?.players?.[other.game.mySeat]?.shown ?? []).map((c: any) => c.id));
      const secret = (other.game.myHand ?? []).map((c: any) => c.id).filter((id: string) => !shown.has(id));
      for (const move of [...(other.game.party?.trick?.moves ?? []), ...(other.game.party?.lastTrick?.moves ?? [])]) {
        if (move.kind === 'closed' && move.cards) secret.push(...move.cards.map((c: any) => c.id));
      }
      for (const id of secret) if (json.includes(`"${id}"`)) leakCount++;
    });
  });
}

// Один шаг за всех игроков стола: кого ждут — тот ходит. Заходит первой картой, бить не бьёт.
async function step(roomId: string, players: P[], leaks = false): Promise<any[]> {
  const states = await Promise.all(players.map((p) => stateOf(roomId, p)));
  if (leaks) countLeaks(states);
  for (const [i, s] of states.entries()) {
    if (s.status !== 'started' || s.pause) continue;
    const p = players[i];
    if (s.stage === 'awaiting_deal' && s.dealerId === p.id && s.partyShowLeftMs === 0) {
      await request('POST', `/shah/rooms/${roomId}/deal`, p.token);
      break;
    }
    const g = s.game;
    if (g?.myAwaiting === 'lead') {
      await request('POST', `/shah/rooms/${roomId}/move`, p.token, { type: 'lead', cardIds: [g.myHand[0].id] });
      break;
    }
    if (g?.myAwaiting === 'beat' || g?.myAwaiting === 'closed') {
      await request('POST', `/shah/rooms/${roomId}/move`, p.token, { type: 'closed', cardIds: g.myHand.slice(0, g.myMin).map((c: any) => c.id) });
      break;
    }
  }
  return states;
}

async function playUntil(roomId: string, players: P[], done: (s: any) => boolean, ms: number, leaks = false) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const states = await step(roomId, players, leaks);
    if (done(states[0])) return states[0];
    await wait(60);
  }
  return stateOf(roomId, players[0]);
}

// Комната ШАХ на двоих: создать, войти, «ГОТОВ» — до начала матча.
async function startedRoom(a: P, b: P, ante: number, extra: Record<string, unknown> = {}): Promise<string> {
  const room = (await request('POST', '/shah/rooms', a.token, { capacity: 2, ante, ...extra })).body;
  await request('POST', `/shah/rooms/${room.id}/join`, b.token);
  for (let i = 0; i < 30; i++) {
    const s = await stateOf(room.id, a);
    if (s.status === 'started') return room.id;
    if (s.readyCheck) {
      await request('POST', `/shah/rooms/${room.id}/ready`, a.token);
      await request('POST', `/shah/rooms/${room.id}/ready`, b.token);
    }
    await wait(200);
  }
  throw new Error('матч не начался');
}

function socketFor(roomId: string, p: P): Promise<{ socket: Socket; last: () => any }> {
  return new Promise((resolve) => {
    const socket = io(BASE, { transports: ['websocket'] });
    let last: any = null;
    socket.on('shah_room', (s) => (last = s));
    socket.on('connect', () => {
      socket.emit('watch_shah', { roomId, token: p.token });
      resolve({ socket, last: () => last });
    });
  });
}

async function main() {
  section('ШАХ выключен без GARBA_SHAH');
  const off = await startServer(3089, false);
  const offUser = (await request('POST', '/accounts', undefined, { name: 'Выкл' }, 'http://127.0.0.1:3089')).body;
  const offRes = await request('POST', '/shah/rooms', offUser.token, { capacity: 2, ante: 100 }, 'http://127.0.0.1:3089');
  check('без GARBA_SHAH=1 запросов ШАХ нет', [offRes.status, offRes.body.error], [404, 'shah disabled']);
  const offMe = (await request('GET', '/me', offUser.token, undefined, 'http://127.0.0.1:3089')).body;
  check('/me: ШАХ выключен — приложение плитку не покажет', [offMe.shahEnabled, offMe.shahRoomId], [false, null]);
  await stopServer(off);

  server = await startServer();

  section('ШАХ: создание комнаты');
  const a = await account('Айдана');
  const b = await account('Берик');
  check('новый аккаунт — 30 000', await balanceOf(a), 30_000);
  check('5 игроков — нельзя', (await request('POST', '/shah/rooms', a.token, { capacity: 5, ante: 100 })).status, 400);
  check('взнос 1500 — нельзя', (await request('POST', '/shah/rooms', a.token, { capacity: 2, ante: 1500 })).status, 400);
  check('без токена — 401', (await request('POST', '/shah/rooms', undefined, { capacity: 2, ante: 100 })).status, 401);
  const created = await request('POST', '/shah/rooms', a.token, { capacity: 2, ante: 500, turnSeconds: 40, absenceMinutes: 3 });
  const roomId = created.body.id;
  check('комната ШАХ: 201, номер из 5 цифр, лобби', [created.status, /^\d{5}$/.test(roomId), created.body.kind, created.body.status], [201, true, 'shah', 'lobby']);
  check('настройки сохранены', created.body.settings, { ante: 500, absenceMinutes: 3, turnSeconds: 40, timeLimitMinutes: null });
  check('/me: стол ШАХ — отдельным полем, roomId Гарбы пуст', [(await request('GET', '/me', a.token)).body.shahRoomId, (await request('GET', '/me', a.token)).body.roomId], [roomId, null]);
  check('/me: ШАХ включён', (await request('GET', '/me', a.token)).body.shahEnabled, true);
  check('у игрока за столом — код (карточка игрока)', created.body.players[0].code, a.code);
  check('в лобби — рейтинг ШАХ 4.0 (матча ещё нет)', [created.body.players[0].rating, created.body.players[0].ratingStart], [4, null]);
  const page = await fetch(`${BASE}/r/${roomId}`);
  check('страница-приглашение на стол ШАХ', [page.status, (await page.text()).includes('ШАХ')], [200, true]);

  section('ШАХ: позвать друга за стол');
  check('не друга — нельзя', (await request('POST', `/shah/rooms/${roomId}/invite`, a.token, { code: b.code })).body.error, 'not a friend');
  await request('POST', '/friends', a.token, { code: b.code });
  await request('POST', `/friends/requests/${a.code}/accept`, b.token);
  const invited = await request('POST', `/shah/rooms/${roomId}/invite`, a.token, { code: b.code });
  const bInvites = (await request('GET', '/me', b.token)).body.roomInvites;
  check('друга — можно: приглашение у него на главном', [invited.status, bInvites.map((i: any) => [i.roomId, i.kind, i.fromName])], [200, [[roomId, 'shah', a.name]]]);
  check('у друга в списке друзей видно мой стол ШАХ', (await request('GET', '/friends', b.token)).body.friends.find((f: any) => f.code === a.code)?.shahRoomId, roomId);
  const garbaBusy = await request('POST', '/rooms', a.token, { capacity: 4, ante: 100, emptyLimit: 5, konThreshold: 10, minBalance: 1000 });
  check('одна комната за раз: за столом ШАХ стол Гарбы не создать', [garbaBusy.status, garbaBusy.body.roomId, garbaBusy.body.kind], [409, roomId, 'shah']);
  check('вторую комнату ШАХ — тоже нет', (await request('POST', '/shah/rooms', a.token, { capacity: 2, ante: 100 })).body.kind, 'shah');
  check('подарок за столом ШАХ — нельзя', (await request('POST', '/gifts', a.token, { toCode: b.code, amount: 100 })).status, 409);
  check('удалить аккаунт за столом — нельзя', (await request('DELETE', '/me', a.token)).status, 409);

  section('ШАХ: вход и «ГОТОВ»');
  const joined = await request('POST', `/shah/rooms/${roomId}/join`, b.token);
  check('второй сел — стол полный', [joined.status, joined.body.players.length, joined.body.players.map((p: any) => p.seat)], [200, 2, [0, 1]]);
  check('сел — приглашение пропало', (await request('GET', '/me', b.token)).body.roomInvites, []);
  const quickGarba = await request('POST', '/rooms/quick', b.token, {});
  check('за столом ШАХ «Быструю игру» Гарбы не начать', [quickGarba.status, quickGarba.body.kind], [409, 'shah']);
  await wait(1300);
  let s = await stateOf(roomId, a);
  check('стол собран — «ГОТОВ» на 3 секунды', s.readyCheck !== null, true);
  await request('POST', `/shah/rooms/${roomId}/ready`, a.token);
  await request('POST', `/shah/rooms/${roomId}/ready`, b.token);
  s = await stateOf(roomId, a);
  check('оба готовы — матч начался, ждём сдающего', [s.status, s.stage, [a.id, b.id].includes(s.dealerId)], ['started', 'awaiting_deal', true]);
  check('первый сдающий — через туза: последняя открытая карта — туз', s.game.firstDealer.reveals.at(-1).card.rank, 'A');
  check('сколько ещё идёт вскрытие — числом', typeof s.revealShowLeftMs, 'number');
  check('взнос 500 списан при старте («а» вопроса 17)', [await balanceOf(a), await balanceOf(b), s.money.pot], [29_500, 29_500, 1000]);
  const notDealer = s.dealerId === a.id ? b : a;
  check('раздать может только сдающий', (await request('POST', `/shah/rooms/${roomId}/deal`, notDealer.token)).status, 403);

  section('ШАХ: сокет — игроку его рука, зрителю ни одной');
  const spectator = await account('Зритель');
  const sockA = await socketFor(roomId, a);
  const sockS = await socketFor(roomId, spectator);
  const dealer = s.dealerId === a.id ? a : b;
  await request('POST', `/shah/rooms/${roomId}/deal`, dealer.token);
  await wait(500);
  const viaSocket = sockA.last();
  const forSpectator = sockS.last();
  check('по сокету игроку пришла его рука — 6 карт', viaSocket?.game?.myHand?.length, 6);
  check('зрителю — ни одной карты в руке', forSpectator?.game?.myHand?.length, 0);
  const aHand = (await stateOf(roomId, a)).game.myHand.map((c: any) => c.id);
  const bHand = (await stateOf(roomId, b)).game.myHand.map((c: any) => c.id);
  const specJson = JSON.stringify(scrubPublic(forSpectator));
  check('у зрителя нет ни одной карты из рук игроков', [...aHand, ...bHand].some((id: string) => specJson.includes(`"${id}"`)), false);
  check('игрок по сокету не видит руку соперника', bHand.some((id: string) => JSON.stringify(scrubPublic(viaSocket)).includes(`"${id}"`)), false);
  check('зрителя видно: 👁 1', (await stateOf(roomId, a)).spectators, 1);
  sockA.socket.close();
  sockS.socket.close();

  section('ШАХ: ходы проверяет сервер');
  s = await stateOf(roomId, a);
  const leader = s.game.party.turnSeat === s.game.mySeat ? a : b;
  const other = leader === a ? b : a;
  const lState = await stateOf(roomId, leader);
  check('заходящему — варианты захода, каждый из своих карт', [lState.game.myLeadOptions.length > 0, lState.game.myLeadOptions.flat().every((id: string) => lState.game.myHand.some((c: any) => c.id === id))], [true, true]);
  check('второму вариантов нет', (await stateOf(roomId, other)).game.myLeadOptions, []);
  check('ход не в свою очередь — 409', (await request('POST', `/shah/rooms/${roomId}/move`, other.token, { type: 'lead', cardIds: [bHand[0]] })).status, 409);
  check('чужой картой — 400', (await request('POST', `/shah/rooms/${roomId}/move`, leader.token, { type: 'lead', cardIds: [(leader === a ? bHand : aHand)[0]] })).status, 400);
  check('неизвестный ход — 400', (await request('POST', `/shah/rooms/${roomId}/move`, leader.token, { type: 'jump', cardIds: [lState.game.myHand[0].id] })).status, 400);

  section('ШАХ: матч до −24 — победитель забирает банк');
  const final = await playUntil(roomId, [a, b], (x) => x.status === 'finished', 60_000, true);
  check('матч окончен: кто-то дошёл до −24', [final.status, final.result?.reason], ['finished', 'match_over']);
  check('за весь матч ни одной чужой карты никому', leakCount, 0);
  const winner = final.result.outcomes[a.id] === 'win' ? a : b;
  const loser = winner === a ? b : a;
  check('итог в монетах: +500 и −500', [final.result.deltas[winner.id], final.result.deltas[loser.id]], [500, -500]);
  check('банк выплачен: 30 500 и 29 500', [await balanceOf(winner), await balanceOf(loser)], [30_500, 29_500]);
  check('штрафы: проигравший −24 или ниже', Math.min(...final.result.totals) <= -24, true);

  section('ШАХ: рейтинг ШАХ (этап 4) — свой, Гарбу не трогает');
  // Тот же расчёт по истории партий и итогу матча: соперники равны (4.0), время ×1.0.
  const rated = final.players.map((p: any) => ({ id: p.id, seat: p.seat, skill: 4 }));
  const pending: Record<string, number> = { [a.id]: 0, [b.id]: 0 };
  for (const party of final.game.history) {
    const d = partyDeltas(2, rated, party);
    for (const id of Object.keys(pending)) pending[id] += d[id];
  }
  const md = matchRatingDeltas(2, rated, final.result.outcomes);
  for (const id of Object.keys(pending)) pending[id] += md[id];
  const expected = (id: string) => shownRating(settleShah(4, pending[id], 3_600_000));
  const ratingIn = (st: any, p: P) => st.players.find((x: any) => x.id === p.id);
  check('итоги матча: рейтинг ШАХ на начало — 4.0 у обоих', [ratingIn(final, a).ratingStart, ratingIn(final, b).ratingStart], [4, 4]);
  check('итоги матча: рейтинг ШАХ после — по партиям и матчу', [ratingIn(final, a).rating, ratingIn(final, b).rating], [expected(a.id), expected(b.id)]);
  check('победитель матча — в плюсе', pending[winner.id] > 0, true);
  const board = (await request('GET', '/shah/rating?scope=all', a.token)).body;
  check('/shah/rating: оба в списке, мой рейтинг и место', [board.total, board.players.find((p: any) => p.me)?.rating, board.myRating, board.myMatches], [2, expected(a.id), expected(a.id), 1]);
  check('/shah/rating: первым — у кого выше', board.players[0].rating >= board.players[1].rating, true);
  const friendsBoard = (await request('GET', '/shah/rating?scope=friends', b.token)).body;
  check('/shah/rating друзья: я и друг', [friendsBoard.scope, friendsBoard.total, friendsBoard.players.map((p: any) => p.code).sort()], ['friends', 2, [a.code, b.code].sort()]);
  const meA = (await request('GET', '/me', a.token)).body;
  check('/me: рейтинг ШАХ — отдельным полем, рейтинг Гарбы прежний', [meA.shahRating, meA.rating], [expected(a.id), 4]);
  const profileW = (await request('GET', '/me/profile', winner.token)).body;
  check('профиль: матчей 1, побед 1, рейтинг ШАХ', [profileW.shah?.matches, profileW.shah?.wins, profileW.shah?.rating], [1, 1, expected(winner.id)]);
  const cardL = (await request('GET', `/players/${loser.code}`, winner.token)).body;
  check('карточка соперника: матчей 1, поражений 1', [cardL.shah?.matches, cardL.shah?.losses, cardL.shah?.parties], [1, 1, final.game.history.length]);
  check('после матча — снова свободен', (await request('GET', '/me', a.token)).body.shahRoomId, null);
  const garbaNow = await request('POST', '/rooms', a.token, { capacity: 4, ante: 100, emptyLimit: 5, konThreshold: 10, minBalance: 1000 });
  check('Гарба после ШАХ работает: стол создан', garbaNow.status, 201);
  const shahWhileGarba = await request('POST', '/shah/rooms', a.token, { capacity: 2, ante: 100 });
  check('за столом Гарбы стол ШАХ не создать', [shahWhileGarba.status, shahWhileGarba.body.roomId, shahWhileGarba.body.kind], [409, garbaNow.body.id, 'garba']);
  await request('POST', `/rooms/${garbaNow.body.id}/leave`, a.token);
  const shahAgain = await request('POST', '/shah/rooms', a.token, { capacity: 2, ante: 100 });
  check('вышел из Гарбы — стол ШАХ можно', shahAgain.status, 201);
  await request('POST', `/shah/rooms/${shahAgain.body.id}/leave`, a.token);
  check('создатель вышел из лобби — комната закрыта', (await stateOf(shahAgain.body.id, a)).result?.reason, 'creator_left');

  section('ШАХ: ушёл — его сторона проиграла, бан за выход');
  const c = await account('Чингиз');
  const d = await account('Дильназ');
  const leaveRoom = await startedRoom(c, d, 100);
  const midParty = await stateOf(leaveRoom, c);
  check('матч начался — взнос 100 списан', [await balanceOf(c), midParty.money.pot], [29_900, 200]);

  section('ШАХ: «ИДУТ СЕЙЧАС» и зрители');
  const x = await account('Ислам');
  const y = await account('Йеркин');
  const xyRoom = await startedRoom(x, y, 100);
  const liveIds = (await request('GET', '/shah/rooms/open', spectator.token)).body.live.map((r: any) => r.id);
  check('идущие матчи — в списке у зрителя', [liveIds.includes(leaveRoom), liveIds.includes(xyRoom)], [true, true]);
  check('свой матч в списке не показываем', (await request('GET', '/shah/rooms/open', x.token)).body.live.some((r: any) => r.id === xyRoom), false);
  check('сам в начатой игре — чужой стол смотреть нельзя', (await request('GET', `/shah/rooms/${leaveRoom}`, x.token)).body.error, 'playing elsewhere');
  check('зрителю без игры — можно', (await request('GET', `/shah/rooms/${leaveRoom}`, spectator.token)).status, 200);
  await request('POST', `/shah/rooms/${xyRoom}/leave`, x.token);
  check('вышел из своей игры — смотреть можно', (await request('GET', `/shah/rooms/${leaveRoom}`, x.token)).status, 200);
  const dealerCD = midParty.dealerId === c.id ? c : d;
  await request('POST', `/shah/rooms/${leaveRoom}/deal`, dealerCD.token);
  check('посреди партии выйти нельзя', (await request('POST', `/shah/rooms/${leaveRoom}/leave`, c.token)).status, 409);
  await playUntil(leaveRoom, [c, d], (x) => x.stage === 'awaiting_deal' || x.status === 'finished', 30_000);
  const left = await request('POST', `/shah/rooms/${leaveRoom}/leave`, c.token);
  const afterLeave = await stateOf(leaveRoom, d);
  check('между партиями вышел — матч окончен', [left.status, afterLeave.status, afterLeave.result?.reason], [200, 'finished', 'player_left']);
  check('ушедший проиграл, оставшийся выиграл', [afterLeave.result.outcomes[c.id], afterLeave.result.outcomes[d.id]], ['lose', 'win']);
  check('монеты: −100 и +100', [await balanceOf(c), await balanceOf(d)], [29_900, 30_100]);
  const ban = (await request('GET', '/me', c.token)).body.leaveBan;
  check('ушедшему — бан 10 минут (§13d)', [ban?.count, ban?.secondsLeft > 590], [1, true]);
  check('с баном за стол ШАХ не сесть', (await request('POST', '/shah/rooms', c.token, { capacity: 2, ante: 100 })).body.error, 'banned for leaving');

  section('ШАХ: время на ход, «ушёл» и отключение');
  const e = await account('Ерлан');
  const f = await account('Фатима');
  const timerRoom = await startedRoom(e, f, 100);
  // Оба на связи (опрашивают), но не ходят: за них ходит таймер, два пропуска — «ушёл».
  let away: any = null;
  let autoDealt = false;
  const awayDeadline = Date.now() + 60_000;
  while (Date.now() < awayDeadline && !away) {
    const [se] = await Promise.all([stateOf(timerRoom, e), stateOf(timerRoom, f)]);
    if (se.game?.party) autoDealt = true;
    away = se.pause?.players?.find((x: any) => x.reason === 'away') ?? null;
    await wait(300);
  }
  check('никто не раздал — раздал таймер', autoDealt, true);
  check('два пропуска подряд — «ушёл», стол на паузе', away?.reason, 'away');
  const awayPlayer = away?.id === e.id ? e : f;
  const present = awayPlayer === e ? f : e;
  // Свой запрос ушедшего сразу его возвращает (§13a) — ход на паузе пробует второй.
  const paused = await request('POST', `/shah/rooms/${timerRoom}/move`, present.token, { type: 'closed', cardIds: [] });
  check('на паузе ходы не принимаются', [paused.status, paused.body.error], [409, 'game paused']);
  await request('POST', `/shah/rooms/${timerRoom}/back`, awayPlayer.token);
  check('«Я ЗДЕСЬ» — пауза снята', (await stateOf(timerRoom, e)).pause, null);
  // Ф перестала опрашивать — через 2 с пауза, через 4 с её сторона проиграла. Е играет сам.
  let gone: any = null;
  const goneDeadline = Date.now() + 30_000;
  let sawOffline = false;
  while (Date.now() < goneDeadline) {
    gone = (await step(timerRoom, [e]))[0];
    if (gone.pause?.players?.some((x: any) => x.id === f.id && x.reason === 'offline')) sawOffline = true;
    if (gone.status === 'finished') break;
    await wait(300);
  }
  check('пропала связь — пауза «offline»', sawOffline, true);
  check('не вернулась за запас — проиграла (вопрос 19 «а»)', [gone.result?.reason, gone.result?.outcomes[f.id], gone.result?.leftIds], ['player_left', 'lose', [f.id]]);
  check('за пропажу связи бана нет — только за «Выйти»', (await request('GET', '/me', f.token)).body.leaveBan, null);

  section('ШАХ: личная пауза и время стола (§20, §20a)');
  const m1 = await account('Мадина');
  const n1 = await account('Нурлан');
  const timed = await startedRoom(m1, n1, 100, { timeLimitMinutes: 15 }); // 15 «минут» по 0,4 с = 6 с
  let ts = await stateOf(timed, m1);
  check('часов стола нет до первой раздачи', ts.tableClock, null);
  const tDealer = ts.dealerId === m1.id ? m1 : n1;
  const pause = await request('POST', `/shah/rooms/${timed}/pause`, m1.token);
  check('между партиями — личная пауза, осталось 2 из 3', [pause.status, pause.body.personalPause?.playerId, pause.body.myPausesLeft], [200, m1.id, 2]);
  check('во время паузы раздать нельзя', (await request('POST', `/shah/rooms/${timed}/deal`, tDealer.token)).body.error, 'personal pause in progress');
  check('вторую паузу сразу не взять', (await request('POST', `/shah/rooms/${timed}/pause`, n1.token)).body.error, 'pause in progress');
  for (let i = 0; i < 20 && (await stateOf(timed, m1)).personalPause; i++) await wait(200);
  ts = await stateOf(timed, m1);
  check('пауза кончилась сама', [ts.personalPause, ts.lastPersonalPause?.early], [null, false]);
  await request('POST', `/shah/rooms/${timed}/deal`, tDealer.token);
  ts = await stateOf(timed, m1);
  check('с первой раздачи часы идут: 15 минут', [ts.tableClock?.minutes, ts.tableClock?.limitMs], [15, 6000]);
  // На вопросы о продлении отвечаем сразу: первый — оба «да», дальше — «нет». Ходим медленно
  // (раз в 0,6 с), чтобы время вышло посреди первой партии.
  const seenVotes = new Set<string>();
  let extended: any = null;
  let timedEnd: any = null;
  let lastMove = 0;
  const timedDeadline = Date.now() + 90_000;
  while (Date.now() < timedDeadline) {
    const sm = await stateOf(timed, m1);
    if (sm.status === 'finished') {
      timedEnd = sm;
      break;
    }
    const vote = sm.tableClock?.vote;
    const key = vote ? `${vote.forEndsAt}:${vote.round}` : null;
    if (vote && key && !seenVotes.has(key)) {
      seenVotes.add(key);
      const body = (choice: string) => ({ choice, forEndsAt: vote.forEndsAt, round: vote.round });
      if (seenVotes.size === 1) {
        await request('POST', `/shah/rooms/${timed}/extend-vote`, m1.token, body('yes'));
        extended = (await request('POST', `/shah/rooms/${timed}/extend-vote`, n1.token, body('yes'))).body.tableClock;
      } else {
        await request('POST', `/shah/rooms/${timed}/extend-vote`, m1.token, body('no'));
      }
    }
    if (Date.now() - lastMove > 600) {
      lastMove = Date.now();
      await step(timed, [m1, n1]);
    } else {
      await stateOf(timed, n1); // Нурлан тоже на связи
    }
    await wait(80);
  }
  check('все «да» — +10 минут', [extended?.extensions, extended?.limitMs], [1, 10_000]);
  check('потом «нет» — ещё два вопроса (за 5 минут и за 1)', seenVotes.size >= 3, true);
  check('время вышло — партию доиграли, матч окончен по времени', [timedEnd?.status, timedEnd?.result?.reason], ['finished', 'time_limit']);
  const tWinner = timedEnd.result.outcomes[m1.id] === 'win' ? m1 : n1;
  check('выиграл тот, у кого меньше штрафов (вопрос 18 «а»)', timedEnd.result.totals[timedEnd.game.players.find((p: any) => p.id === tWinner.id).side], Math.max(...timedEnd.result.totals));
  check('банк — ему: 30 100', await balanceOf(tWinner), 30_100);

  section('ШАХ: тренировка с ботами');
  const g = await account('Гульнар');
  const practice = (await request('POST', '/shah/rooms', g.token, { capacity: 4, ante: 1000 })).body;
  const withBots = await request('POST', `/shah/rooms/${practice.id}/bots`, g.token);
  check('боты сели на 3 места, тренировка', [withBots.body.players.length, withBots.body.players.filter((p: any) => p.bot).length, withBots.body.practice], [4, 3, true]);
  check('команды через одного: места 0 и 2 — одна сторона', withBots.body.players.map((p: any) => p.side), [0, 1, 0, 1]);
  await wait(1300);
  await request('POST', `/shah/rooms/${practice.id}/ready`, g.token);
  const practiceEnd = await playUntil(practice.id, [g], (x) => x.status === 'finished', 120_000);
  check('боты доиграли матч с человеком', [practiceEnd.status, practiceEnd.result?.reason], ['finished', 'match_over']);
  check('сыграно несколько партий', practiceEnd.game.history.length >= 2, true);
  check('тренировка: монеты не двигались', await balanceOf(g), 30_000);
  const gMe = (await request('GET', '/me/profile', g.token)).body;
  check('тренировка: рейтинг ШАХ и матчи не изменились', [gMe.shah?.rating, gMe.shah?.matches, practiceEnd.players[0].ratingStart], [4, 0, null]);
  check('тренировки нет в рейтинге ШАХ', (await request('GET', '/shah/rating?scope=all', g.token)).body.players.some((p: any) => p.code === g.code), false);

  section('ШАХ: перезапуск сервера посреди матча');
  const h = await account('Хадиша');
  const k = await account('Канат');
  const restartRoom = await startedRoom(h, k, 100);
  let before = await stateOf(restartRoom, h);
  await request('POST', `/shah/rooms/${restartRoom}/deal`, (before.dealerId === h.id ? h : k).token);
  await step(restartRoom, [h, k]);
  before = await stateOf(restartRoom, h);
  await stopServer(server);
  server = await startServer();
  const after = await stateOf(restartRoom, h);
  check('комната поднялась из базы: та же партия, та же рука', [after.status, after.game.party.number, after.game.myHand], ['started', before.game.party.number, before.game.myHand]);
  check('взнос не списан второй раз', [await balanceOf(h), await balanceOf(k)], [29_900, 29_900]);
  const restartEnd = await playUntil(restartRoom, [h, k], (x) => x.status === 'finished', 60_000);
  const restartWinner = restartEnd.result.outcomes[h.id] === 'win' ? h : k;
  check('доиграли после перезапуска — выплата один раз', [restartEnd.status, await balanceOf(restartWinner)], ['finished', 30_100]);
  await stopServer(server);
  server = await startServer();
  check('после ещё одного перезапуска выплата не повторилась', await balanceOf(restartWinner), 30_100);
}

main()
  .catch((e) => {
    console.error(e);
    check('живая проверка ШАХ без падений', String(e), 'ok');
  })
  .finally(async () => {
    await stopServer(server);
    rmSync(DB_FILE, { force: true });
    rmSync(`${DB_FILE}-wal`, { force: true });
    rmSync(`${DB_FILE}-shm`, { force: true });
    process.exit(summary() === 0 ? 0 : 1);
  });
