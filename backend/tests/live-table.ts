// Живая проверка стола (22.10.2026): докупить из кошелька (RULES.md §9.1c), 3 секунды
// открытых карт после раздачи (§10.8), отдать часть выигрыша другому игроку (§11.8).
// Настоящий сервер на порту 3093, база в памяти. Запуск: npm run test:live

import { spawn } from 'node:child_process';
import { botAction } from '../src/serverBots.js';
import { check, section, summary } from './check.js';

const PORT = 3093;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), GARBA_DB: ':memory:' },
  stdio: 'ignore',
});

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
const balanceAt = (s: any, id: string) => s.players.find((x: any) => x.id === id)?.balance as number;
const coinsOnTable = (s: any) => s.players.reduce((a: number, x: any) => a + x.balance, 0) + s.game.kon;

// Четверо за столом по 100, все нажали «ГОТОВ» — игра началась. buyIn — сколько взять за стол.
async function fourAtTable(prefix: string, buyIn?: number) {
  const players: P[] = [];
  for (let i = 0; i < 4; i++) players.push(await account(`${prefix}${i}`));
  const settings = { capacity: 4, ante: 100, emptyLimit: 10, konThreshold: 10, minBalance: 1000 };
  const room = (await request('POST', '/rooms', players[0].token, { ...settings, ...(buyIn ? { buyIn } : {}) })).body;
  for (const p of players.slice(1)) await post(room.id, p, 'join', buyIn ? { buyIn } : {});
  for (const p of players) await post(room.id, p, 'ready');
  return { players, roomId: room.id as string };
}

// Раздающий раздаёт, все пасуют (и в борьбе за спецкарту) — пересдача, между раздачами.
async function dealAndPass(roomId: string, players: P[]) {
  let s = await view(roomId, players[0]);
  await post(roomId, players.find((p) => p.id === s.game.dealerId)!, 'dealer/continue');
  for (let i = 0; i < 40; i++) {
    s = await view(roomId, players[0]);
    const g = s.game;
    const actorId = g.stage === 'special' ? g.special?.activeId : g.stage === 'bidding' ? g.activeBidderId : null;
    if (!actorId) break;
    const actor = players.find((p) => p.id === actorId)!;
    if (g.stage === 'special') await post(roomId, actor, 'special', { action: 'pass' });
    else await post(roomId, actor, 'bid', { bid: 'ПАС' });
  }
  // Все на связи: без запросов через 10 секунд игра встала бы на паузу.
  for (const p of players) s = await view(roomId, p);
  return s;
}

async function topUp() {
  section('докупить из кошелька — только с согласия всех (§9.1c, 22.10.2026)');
  // За стол — по 10 000 из 30 000: в кошельке у каждого остаётся 20 000.
  const { players, roomId } = await fourAtTable('Д', 10_000);
  const [serik, ...others] = players;
  let s = await view(roomId, serik);
  check('за столом 10 000, в кошельке 20 000', [balanceAt(s, serik.id), s.myReserve], [10_000, 20_000]);
  check('до первой раздачи докупить нельзя',
    (await post(roomId, serik, 'top-up', { amount: 5_000 })).body.error, 'cannot request top-up now');

  s = await dealAndPass(roomId, players);
  check('все спасовали — между раздачами, Серик может попросить',
    [s.game.stage, (await view(roomId, serik)).game.myCanRequestTopUp], ['awaiting_deal', true]);
  check('больше, чем в кошельке, — нельзя',
    (await post(roomId, serik, 'top-up', { amount: 20_100 })).body.error, 'bad top-up amount');
  const before = await view(roomId, serik);
  check('просит 5 000', (await post(roomId, serik, 'top-up', { amount: 5_000 })).status, 200);
  s = await view(roomId, others[0]);
  check('остальные видят просьбу: кто, сколько, кто отвечает',
    [s.game.topUpVote?.requesterName, s.game.topUpVote?.amount, s.game.topUpVote?.voterIds?.length], [serik.name, 5_000, 3]);
  const dealer = players.find((p) => p.id === s.game.dealerId)!;
  check('пока спрашиваем — раздавать нельзя',
    (await post(roomId, dealer, 'dealer/continue')).body.error, 'top-up vote in progress');
  check('на свою просьбу сам не отвечает',
    (await post(roomId, serik, 'top-up-vote', { choice: 'yes' })).body.error, 'you do not vote on this');
  await post(roomId, others[0], 'top-up-vote', { choice: 'yes' });
  check('один и тот же отвечает один раз',
    (await post(roomId, others[0], 'top-up-vote', { choice: 'no' })).body.error, 'already voted');
  await post(roomId, others[1], 'top-up-vote', { choice: 'yes' });
  await post(roomId, others[2], 'top-up-vote', { choice: 'no' });
  s = await view(roomId, serik);
  check('хоть один против — докупки нет, на столе и в кошельке то же',
    [s.game.lastTopUp?.result, s.game.lastTopUp?.byName, balanceAt(s, serik.id) - balanceAt(before, serik.id), s.myReserve],
    ['rejected', others[2].name, 0, 20_000]);
  check('второй раз между этими раздачами — нельзя',
    (await post(roomId, serik, 'top-up', { amount: 5_000 })).body.error, 'cannot request top-up now');

  s = await dealAndPass(roomId, players);
  check('снова пересдача — можно попросить снова', (await view(roomId, serik)).game.myCanRequestTopUp, true);
  const mid = await view(roomId, serik);
  // Во время личной паузы (§20a) докупить можно (решение владельца, 05.11.2026).
  check('Серик взял личную паузу', (await post(roomId, serik, 'pause')).status, 200);
  check('во время паузы кнопка «ДОКУПИТЬ» есть', (await view(roomId, serik)).game.myCanRequestTopUp, true);
  check('просит докупить во время паузы', (await post(roomId, serik, 'top-up', { amount: 5_000 })).status, 200);
  for (const p of others) await post(roomId, p, 'top-up-vote', { choice: 'yes' });
  s = await view(roomId, serik);
  check('пауза идёт дальше — докупка её не сняла', s.game.personalPause?.playerId, serik.id);
  const me = s.players.find((x: any) => x.id === serik.id);
  check('все согласны — на столе +5 000, в кошельке 15 000',
    [s.game.lastTopUp?.result, balanceAt(s, serik.id) - balanceAt(mid, serik.id), s.myReserve], ['approved', 5_000, 15_000]);
  check('докупка — не выигрыш: «с чем сел за стол» тоже +5 000', me.startBalance, 15_000);
  check('монеты на столе выросли ровно на докупку', coinsOnTable(s) - coinsOnTable(mid), 5_000);
  const account2 = (await request('GET', '/me', serik.token)).body;
  check('в /me: вне стола 15 000, за столом — то, что на столе', [account2.balance, account2.tableBalance], [15_000, balanceAt(s, serik.id)]);
  check('пока пауза — раздавать нельзя',
    (await post(roomId, players.find((p) => p.id === s.game.dealerId)!, 'dealer/continue')).body.error, 'personal pause in progress');
  await post(roomId, serik, 'pause/end');
  check('пауза кончилась — раздавать снова можно', (await post(roomId, players.find((p) => p.id === s.game.dealerId)!, 'dealer/continue')).status, 200);
}

async function openHandsAndShare() {
  section('раздача сыграна — 3 секунды все смотрят карты (§10.8), часть выигрыша — другому (§11.8)');
  const { players, roomId } = await fourAtTable('Щ');
  let sawShow = false;
  let shared = false;
  // Сначала все пасуют, пока кон не дорастёт до 1 200 (3 базовых), — иначе 10% выигрыша
  // меньше взноса и отдавать нечего. Дальше ходы — как у ботов сервера.
  for (let i = 0; i < 1_500 && !shared; i++) {
    const views = [];
    for (const p of players) views.push(await view(roomId, p));
    const g = views[0].game;
    if (views[0].status !== 'started') break;

    if (['dealer_found', 'awaiting_deal', 'round_done'].includes(g.stage)) {
      const dealer = players.find((p) => p.id === g.dealerId)!;
      if (g.stage === 'round_done') {
        if (!sawShow) {
          sawShow = true;
          const early = await post(roomId, dealer, 'dealer/continue');
          check('сразу после раздачи раздать нельзя — все смотрят карты',
            [early.status, early.body.error], [409, 'cards on show']);
          check('сервер говорит, сколько ещё смотреть (до 3 с, при ГАРБЕ — до 5,5 с)',
            g.dealShowLeftMs > 0 && g.dealShowLeftMs <= 5_500, true);
          check('карты всех открыты', Object.keys(g.openHands ?? {}).length, 4);
        }
        const win = g.result?.find((r: any) => r.won);
        if (win && win.delta >= 1_000 && win.declaration !== 'КОН') {
          await shareChecks(roomId, players, views, win);
          shared = true;
        }
        if (g.dealShowLeftMs > 0 && !shared) {
          await wait(Math.min(g.dealShowLeftMs, 500));
          continue;
        }
      }
      if (!shared) await post(roomId, dealer, 'dealer/continue');
      continue;
    }

    const growing = g.kon < 1_200;
    let acted = false;
    for (let k = 0; k < players.length && !acted; k++) {
      let action = botAction(players[k].id, views[k]);
      if (!action || ['dealer/continue', 'end-game', 'ready'].includes(action.path)) continue;
      if (growing && action.path === 'bid') action = { ...action, body: { bid: 'ПАС' } };
      if (growing && action.path === 'special') action = { ...action, body: { action: 'pass' } };
      if (action.path === 'vote') action = { ...action, body: { choice: 'continue' } };
      await post(roomId, players[k], action.path, action.body);
      acted = true;
    }
    if (!acted) await wait(100);
  }
  check('главный выиграл РАЗ на большом коне — передачу проверили', shared, true);
  if (!shared) return;

  // Досмотрели карты — следующая раздача: отдать уже нельзя, сообщение пропало.
  let s = await view(roomId, players[0]);
  for (let i = 0; i < 30 && s.game.dealShowLeftMs > 0; i++) {
    await wait(300);
    for (const p of players) s = await view(roomId, p);
  }
  const dealer = players.find((p) => p.id === s.game.dealerId)!;
  check('досмотрели — раздающий раздаёт', (await post(roomId, dealer, 'dealer/continue')).status, 200);
  s = await view(roomId, players[0]);
  check('новая раздача — сообщения о передаче нет', s.game.winShare, null);
}

async function shareChecks(roomId: string, players: P[], views: any[], win: any) {
  const gi = players.findIndex((p) => p.id === win.playerId);
  const giver = players[gi];
  const receiver = players[(gi + 1) % 4];
  const other = players[(gi + 2) % 4];
  const max = Math.floor(win.delta / 10 / 100) * 100;
  check(`${giver.name} выиграл ${win.delta}: отдать можно от взноса 100 до 10% — ${max}`,
    views[gi].game.myShareLimits, { min: 100, max });
  check('остальным отдавать нечего', views.filter((_, i) => i !== gi).map((v) => v.game.myShareLimits), [null, null, null]);
  check('не выигравший отдать не может',
    (await post(roomId, other, 'share', { toId: receiver.id, amount: 100 })).body.error, 'cannot share now');
  check('себе — нельзя', (await post(roomId, giver, 'share', { toId: giver.id, amount: 100 })).body.error, 'bad share recipient');
  check('больше 10% — нельзя',
    (await post(roomId, giver, 'share', { toId: receiver.id, amount: max + 100 })).body.error, 'bad share amount');
  check('меньше взноса — нельзя',
    (await post(roomId, giver, 'share', { toId: receiver.id, amount: 50 })).body.error, 'bad share amount');

  const before = await view(roomId, receiver);
  const ok = await post(roomId, giver, 'share', { toId: receiver.id, amount: 100 });
  check('отдал 100', ok.status, 200);
  const after = await view(roomId, receiver);
  check('у отдавшего на 100 меньше, у получившего на 100 больше',
    [balanceAt(after, giver.id) - balanceAt(before, giver.id), balanceAt(after, receiver.id) - balanceAt(before, receiver.id)],
    [-100, 100]);
  check('монеты не потерялись', coinsOnTable(after), coinsOnTable(before));
  check('все видят: кто, кому, сколько и сколько выиграл', after.game.winShare,
    { fromId: giver.id, fromName: giver.name, toId: receiver.id, toName: receiver.name, amount: 100, won: win.delta });
  check('в статистике за комнату — как деньги за столом',
    [after.stats[giver.id].coinsLost - before.stats[giver.id].coinsLost, after.stats[receiver.id].coinsWon - before.stats[receiver.id].coinsWon],
    [100, 100]);
  check('второй раз в этой раздаче — нельзя',
    (await post(roomId, giver, 'share', { toId: receiver.id, amount: 100 })).body.error, 'cannot share now');
}

async function leaveBanAndLeaders() {
  section('вышел из начатой игры — бан на вход за стол (§13d, 23.10.2026)');
  const { players, roomId } = await fourAtTable('Б');
  await dealAndPass(roomId, players);
  const leaver = players[3];
  check('выйти между раздачами можно', (await post(roomId, leaver, 'leave')).status, 200);
  const meNow = (await request('GET', '/me', leaver.token)).body;
  check('в /me — первый выход, бан 10 минут',
    [meNow.leaveBan?.count, meNow.leaveBan?.secondsLeft > 590 && meNow.leaveBan?.secondsLeft <= 600], [1, true]);
  const settings = { capacity: 4, ante: 100, emptyLimit: 10, konThreshold: 10, minBalance: 1000 };
  const created = await request('POST', '/rooms', leaver.token, settings);
  check('создать игру нельзя — 403 и сколько осталось',
    [created.status, created.body.error, created.body.secondsLeft > 0], [403, 'banned for leaving', true]);
  check('«Быстрая игра» — тоже нельзя', (await request('POST', '/rooms/quick', leaver.token, {})).body.error, 'banned for leaving');
  const host = await account('Хозяин');
  const lobby = (await request('POST', '/rooms', host.token, settings)).body;
  check('сесть в чужое лобби — нельзя', (await post(lobby.id, leaver, 'join')).body.error, 'banned for leaving');
  check('профиль и рейтинг смотреть можно',
    [(await request('GET', '/me/profile', leaver.token)).status, (await request('GET', '/rating', leaver.token)).status], [200, 200]);
  const free = await account('Свободный');
  check('новый игрок без бана — садится', (await post(lobby.id, free, 'join')).status, 200);

  section('рейтинг по монетам и ТОП-3 недели (§16.8)');
  await wait(300);
  const coins = (await request('GET', '/rating?scope=coins', leaver.token)).body;
  const sorted = coins.players.every((p: any, i: number) => i === 0 || coins.players[i - 1].coins >= p.coins);
  check('по монетам — по убыванию, моё место есть', [coins.scope, sorted, typeof coins.myPlace], ['coins', true, 'number']);
  const weeks = await Promise.all(players.map(async (p) => (await request('GET', '/rating/week', p.token)).body));
  check('за неделю у четверых в сумме 0 — кон поделили между ними', weeks.reduce((a, w) => a + w.myCoins, 0), 0);
  check('ушедший за неделю в минусе — его взносы остались в кону', weeks[3].myCoins < 0, true);
  check('в ТОПе недели — только кто в плюсе, не больше трёх',
    weeks[0].players.length <= 3 && weeks[0].players.every((p: any) => p.coins > 0), true);

  section('рейтинг не от монет (§16, 26.10.2026)');
  const ratings = await Promise.all(players.map(async (p) => (await request('GET', '/me', p.token)).body.rating));
  check('оставшиеся получили доли кона, но рейтинг тот же — 4.0; ушедший — 3.0', ratings, [4, 4, 4, 3]);
}

async function main() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/health')).ok) break; } catch {}
    await wait(200);
  }
  await topUp();
  await openHandsAndShare();
  await leaveBanAndLeaders();
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
