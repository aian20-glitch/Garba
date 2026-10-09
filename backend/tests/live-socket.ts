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
  env: { ...process.env, PORT: String(PORT), GARBA_DB: ':memory:', GARBA_AVATARS: '1' },
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
  check('аккаунт создан, 30 000 на счету', serik.balance, 30_000);
  check('токен выдан', typeof serik.token === 'string' && serik.token.length === 64, true);
  check('пустое имя — отказ', (await request('POST', '/accounts', undefined, { name: '  ' })).status, 400);

  const meRes = await request('GET', '/me', serik.token);
  check('GET /me по токену — свой аккаунт, кириллица целая', [meRes.body.id, meRes.body.name], [serik.id, 'Серик']);
  check('GET /me без токена — 401', (await request('GET', '/me')).status, 401);
  check('комнаты без токена — 401', (await request('POST', '/rooms', undefined, { capacity: 4 })).status, 401);

  const bots: Me[] = [];
  for (let i = 1; i <= 3; i++) bots.push(await account(`Бот ${i}`));

  section('живые обновления по сокету (этап 8)');
  // Сумма за стол (09.10.2026): от минимума комнаты до всего баланса.
  const roomBody = { capacity: 4, ante: 100, emptyLimit: 5, konThreshold: 10, minBalance: 1000 };
  check('за стол меньше минимума — 400',
    (await post('/rooms', serik.token, { ...roomBody, buyIn: 500 })).body.error, 'bad buyIn');
  check('за стол больше, чем есть, — 400',
    (await post('/rooms', serik.token, { ...roomBody, buyIn: 30_100 })).body.error, 'bad buyIn');
  const created = await post('/rooms', serik.token, {
    playerId: bots[0].id, name: 'Самозванец', // должны игнорироваться
    ...roomBody, buyIn: 10_000,
  });
  check('взял за стол 10 000 — за столом 10 000, вне стола 20 000',
    [created.body.players?.[0]?.balance, (await request('GET', '/me', serik.token)).body.balance], [10_000, 20_000]);
  const roomId = created.body.id;
  check('без выбора запаса на отлучку — 1 минута (08.10.2026)', created.body.settings?.absenceMinutes, 1);
  check('запас на отлучку только 1…5 минут — 400',
    (await post('/rooms', serik.token, { capacity: 4, ante: 100, emptyLimit: 5, konThreshold: 10, minBalance: 1000, absenceMinutes: 7 })).status, 400);
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
  // «ГОТОВ» (23.09.2026): комната набралась — старт только когда нажали все.
  check('комната набралась — все видят кнопку «ГОТОВ», 30 секунд',
    [serikWatch.state.last?.readyCheck?.readyIds, serikWatch.state.last?.readyCheck?.secondsLeft], [[], 30]);
  for (const p of [serik, bots[0], bots[1]]) await post(`/rooms/${roomId}/ready`, p.token);
  await wait(300);
  check('трое готовы из четырёх — игра ещё не началась',
    [serikWatch.state.last?.status, serikWatch.state.last?.readyCheck?.readyIds?.length], ['lobby', 3]);
  await post(`/rooms/${roomId}/ready`, bots[2].token);
  await wait(300);
  check('нажал последний — игра началась сама, без кнопки создателя', serikWatch.state.last?.status, 'started');
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
  const afterAnte = (await request('GET', '/me', serik.token)).body;
  check('взнос списан со стола, общий баланс не тронут',
    [kon, afterAnte.tableBalance, afterAnte.balance], [400, 9_900, 20_000]);

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
  check('пришла по приглашению — у неё обычные 30 000', invited.balance, 30_000);
  const aAfterInvite = (await request('GET', '/me', a.token)).body;
  // Бонус пригласившему — только после 3 комнат друга (решение владельца, 19.09.2026).
  check('пригласившему пока ничего — бонус после 3 комнат друга', [aAfterInvite.balance, aAfterInvite.invitedCount], [30_000, 1]);

  check('бонус ещё не взят: день 1/7, 1 000', aAfterInvite.daily, { claimedToday: false, streak: 1, amount: 1_000 });
  const bonus = await post('/me/daily-bonus', a.token);
  check('забрал ежедневный бонус', [bonus.body.amount, bonus.body.streak, bonus.body.balance], [1_000, 1, 31_000]);
  check('второй раз за день — нельзя', (await post('/me/daily-bonus', a.token)).status, 409);
  check('на главном экране: сегодня уже взят', (await request('GET', '/me', a.token)).body.daily.claimedToday, true);

  const bMe = (await request('GET', '/me', b.token)).body;
  // карточка с 9.4 шире (stats, isFriend, avatar, rating) — здесь важны только код и имя
  const card = (await request('GET', `/players/${bMe.code}`, a.token)).body;
  check('найти игрока по коду перед подарком', { code: card.code, name: card.name }, { code: bMe.code, name: 'Ержан' });
  check('в карточке игрока видно, сколько у него монет', card.balance, bMe.balance);
  check('больше 10 000 подарить нельзя', (await post('/gifts', a.token, { toCode: bMe.code, amount: 10_100 })).body.error, 'bad amount');
  check('себе — нельзя', (await post('/gifts', a.token, { toCode: aMe.code, amount: 400 })).body.error, 'self');
  const gift = await post('/gifts', a.token, { toCode: bMe.code, amount: 400 });
  check('подарил 400', [gift.status, gift.body.balance, gift.body.to?.name], [200, 30_600, 'Ержан']);
  check('получатель получил', (await request('GET', '/me', b.token)).body.balance, 30_400);
  check('второй подарок в тот же день — можно, пока не вышло 10 000', (await post('/gifts', a.token, { toCode: bMe.code, amount: 100 })).body.leftToday, 9_500);
  check('больше остатка на сегодня — нельзя', (await post('/gifts', a.token, { toCode: bMe.code, amount: 10_000 })).body.error, 'over daily limit');
  check('в /me — сколько ещё можно подарить', (await request('GET', '/me', a.token)).body.giftLeftToday, 9_500);

  const serikBefore = (await request('GET', `/rooms/${roomId}`, serik.token)).body.players.find((p: any) => p.id === serik.id);
  check('сидит за столом — дарить нельзя', (await post('/gifts', serik.token, { toCode: bMe.code, amount: 100 })).body.error, 'finish your game first');
  await post('/gifts', b.token, { toCode: (await request('GET', '/me', serik.token)).body.code, amount: 300 });
  await post('/me/daily-bonus', serik.token);
  const serikAfter = (await request('GET', `/rooms/${roomId}`, serik.token)).body.players.find((p: any) => p.id === serik.id);
  // С 09.10.2026 за столом играешь только тем, что взял: бонус и подарок — в общий баланс.
  check('подарок и бонус игроку за столом на стол не попали',
    [serikAfter.balance - serikBefore.balance, serikAfter.startBalance - serikBefore.startBalance], [0, 0]);
  const serikMe = (await request('GET', '/me', serik.token)).body;
  check('они в общем балансе, вне стола', [serikMe.balance, serikMe.tableBalance], [21_300, serikAfter.balance]);

  section('профиль и друзья (этап 9.4)');
  const profile = (await request('GET', '/me/profile', serik.token)).body;
  check('профиль: имя, код, статистика', [profile.name, typeof profile.stats?.deals, profile.stats?.coinsLost], ['Серик', 'number', 100]);
  check('в комнате видна статистика за стол (взнос уже учтён)',
    (await request('GET', `/rooms/${roomId}`, serik.token)).body.stats?.[serik.id]?.coinsLost, 100);

  // С 19.09.2026 — заявка: дружба только с согласия второго (решение владельца).
  const asked = await post('/friends', a.token, { code: bMe.code });
  check('добавить в друзья по коду — это заявка, ещё не дружба', [asked.status, asked.body.status], [202, 'requested']);
  check('повторно — заявка уже отправлена', (await post('/friends', a.token, { code: bMe.code })).body.error, 'request already sent');
  check('у Ержана — входящая заявка от Даны, в друзьях пока никого',
    [(await request('GET', '/friends/requests', b.token)).body.incoming.map((f: any) => f.name), (await request('GET', '/friends', b.token)).body.friends,
      (await request('GET', '/me', b.token)).body.friendRequests],
    [['Дана'], [], 1]);
  check('в карточке у Даны — «заявка отправлена»', (await request('GET', `/players/${bMe.code}`, a.token)).body.friendStatus, 'outgoing');
  check('Ержан принял', (await post(`/friends/requests/${aMe.code}/accept`, b.token)).body.status, 'friends');
  check('повторно — уже друзья', (await post('/friends', a.token, { code: bMe.code })).body.error, 'already friends');
  check('себя — нельзя', (await post('/friends', a.token, { code: aMe.code })).body.error, 'self');
  check('дружба взаимная: Дана у Ержана в списке',
    (await request('GET', '/friends', b.token)).body.friends.map((f: any) => f.name), ['Дана']);
  check('в карточке игрока видно, что это друг', (await request('GET', `/players/${bMe.code}`, a.token)).body.isFriend, true);
  check('удалить из друзей', (await request('DELETE', `/friends/${bMe.code}`, a.token)).status, 200);
  check('пропал у обоих', (await request('GET', '/friends', b.token)).body.friends, []);
  await post('/friends', b.token, { code: aMe.code });
  check('Дана отклонила заявку Ержана — дружбы нет, заявки тоже',
    [(await post(`/friends/requests/${bMe.code}/decline`, a.token)).status, (await request('GET', `/players/${aMe.code}`, b.token)).body.friendStatus],
    [200, 'none']);
  await post('/friends', a.token, { code: bMe.code });
  check('оба позвали друг друга — сразу друзья', (await post('/friends', b.token, { code: aMe.code })).body.status, 'friends');
  await request('DELETE', `/friends/${bMe.code}`, a.token);

  section('аватар (этап 9.5)');
  const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(500).fill(7)]);
  const put = async (bytes: Uint8Array, type = 'image/jpeg') => {
    const r = await fetch(BASE + '/me/avatar', {
      method: 'PUT',
      headers: { 'Content-Type': type, Authorization: `Bearer ${serik.token}` },
      body: new Blob([bytes as BlobPart]),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  check('не картинка — отказ', (await put(new TextEncoder().encode('<script>'), 'image/jpeg')).status, 400);
  check('слишком большая — 413', (await put(new Uint8Array(400 * 1024).fill(0xff))).status, 413);
  const uploaded = await put(photo, 'application/octet-stream');
  check('фото загружено, адрес с версией', /^\/avatars\/[\w-]+\?v=\d+$/.test(uploaded.body.avatar ?? ''), true);
  const img = await fetch(BASE + uploaded.body.avatar);
  check('картинка отдаётся как JPEG, байт в байт',
    [img.headers.get('content-type'), (await img.arrayBuffer()).byteLength], ['image/jpeg', photo.length]);
  const seat = (await request('GET', `/rooms/${roomId}`, serik.token)).body.players.find((p: any) => p.id === serik.id);
  check('за столом у игрока видно фото', seat.avatar, uploaded.body.avatar);
  check('у кого фото нет — null', (await request('GET', '/me', a.token)).body.avatar, null);

  section('реакции и ссылки-приглашения (этап 9.7)');
  const stage = (await request('GET', `/rooms/${roomId}`, serik.token)).body.game.stage;
  if (stage !== 'round_done' && stage !== 'room_done') {
    check('смайлик — и во время торгов (с 25.09.2026)', (await post(`/rooms/${roomId}/react`, serik.token, { emoji: '👍' })).status, 200);
  }
  check('в комнате есть список реакций', Array.isArray((await request('GET', `/rooms/${roomId}`, serik.token)).body.reactions), true);

  const roomPage = await fetch(`${BASE}/r/${roomId}`);
  const roomHtml = await roomPage.text();
  check('страница приглашения в комнату: кнопка открыть в приложении и номер',
    [roomPage.status, roomHtml.includes(`garba://room/${roomId}`), roomHtml.includes('Серик зовёт')], [200, true, true]);
  check('несуществующая комната — 404', (await fetch(`${BASE}/r/99999`)).status, 404);

  const hacker = await account('<script>x');
  const hackerCode = (await request('GET', '/me', hacker.token)).body.code;
  const invitePage = await (await fetch(`${BASE}/i/${hackerCode}`)).text();
  check('страница приглашения друга: код и ссылка в приложение', invitePage.includes(`garba://invite/${hackerCode}`), true);
  check('имя с HTML-тегами на странице экранировано', [invitePage.includes('<script>x'), invitePage.includes('&lt;script&gt;x')], [false, true]);
  check('мусор вместо кода — 404', (await fetch(`${BASE}/i/%3Cb%3E`)).status, 404);

  section('удалить аккаунт (требование Apple и Google)');
  const busy = await request('DELETE', '/me', serik.token);
  check('сидит за столом — нельзя, сначала доиграть', [busy.status, busy.body.roomId], [409, roomId]);
  const leaving = await account('Уходящий');
  check('свободный игрок — удалён', (await request('DELETE', '/me', leaving.token)).status, 200);
  check('токен больше не работает', (await request('GET', '/me', leaving.token)).status, 401);

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
