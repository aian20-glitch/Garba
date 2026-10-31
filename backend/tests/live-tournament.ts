// Живая проверка еженедельного турнира (RULES.md §19, 31.10.2026). Настоящий сервер на порту
// 3092, база во временном файле — сервер перезапускается посреди турнира. Сроки укорочены
// переменными окружения, взнос за столом — 1 600 (чтобы за минуту кто-то выбыл).
// Играют люди логикой ботов сервера (botAction). Запуск: npm run test:live

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { botAction } from '../src/serverBots.js';
import { check, section, summary } from './check.js';

const PORT = 3092;
const BASE = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), 'garba-tour-'));
const DB_FILE = join(dir, 'garba.db');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ENV = {
  ...process.env,
  PORT: String(PORT),
  GARBA_DB: DB_FILE,
  GARBA_TOUR_AUTO: '0',
  GARBA_TOUR_REG_MS: '4000',
  GARBA_TOUR_QUAL_MS: '50000',
  GARBA_TOUR_FINAL_MS: '50000',
  GARBA_TOUR_TABLE_MS: '14000',
  GARBA_TOUR_LASTCALL_LEAD_MS: '22000',
  GARBA_TOUR_LASTCALL_MS: '4000',
  GARBA_TOUR_ANTE: '1600',
  GARBA_READY_MS: '3000',
};

let server: ChildProcess;
async function startServer() {
  server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { env: ENV, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {
      /* сервер ещё поднимается */
    }
    await wait(100);
  }
  throw new Error('server did not start');
}
async function stopServer() {
  server.kill();
  await new Promise((r) => server.once('exit', r));
}

type P = { id: string; name: string; token: string; code: string };

async function request(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}
const account = async (name: string): Promise<P> => (await request('POST', '/accounts', undefined, { name })).body;
const me = async (p: P) => (await request('GET', '/me', p.token)).body;
const tour = async (p: P) => (await request('GET', '/tournament', p.token)).body;
const register = (p: P) => request('POST', '/tournament/register', p.token, { confirm: true });
const sit = (p: P, no: number) => request('POST', `/tournament/tables/${no}/sit`, p.token, {});
const view = async (roomId: string, p: P) => (await request('GET', `/rooms/${roomId}`, p.token)).body;

async function waitFor(what: string, fn: () => Promise<boolean>, ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await fn()) return true;
    await wait(300);
  }
  console.log(`     (не дождались: ${what})`);
  return false;
}

// Люди за столом ходят логикой ботов сервера, пока стол не закончится. onTick — проверки по ходу.
async function play(roomId: string, players: P[], onTick?: (s: any) => void) {
  for (let i = 0; i < 4_000; i++) {
    let finished = false;
    for (const p of players) {
      const v = await view(roomId, p);
      if (!v?.id) continue;
      if (v.status === 'finished') finished = true;
      onTick?.(v);
      const action = botAction(p.id, v);
      if (action) await request('POST', `/rooms/${roomId}/${action.path}`, p.token, action.body);
    }
    if (finished) return;
    await wait(80);
  }
}

async function cancelled() {
  section('турнир: 7 участников — отмена и возврат (§19.2)');
  check('запуск турнира (проверка)', (await request('POST', '/admin/tournament/start')).status, 200);
  const players: P[] = [];
  for (let i = 0; i < 7; i++) players.push(await account(`Отмена${i}`));
  check('без подтверждения предупреждения — нельзя', (await request('POST', '/tournament/register', players[0].token, {})).body.error, 'confirm required');
  for (const p of players) await register(p);
  check('зарегистрировался — 10 000 списаны', (await me(players[0])).balance, 20_000);
  check('нельзя зарегистрироваться дважды', (await register(players[0])).body.error, 'already registered');
  check('второй раз не списано', (await me(players[0])).balance, 20_000);
  const t = await tour(players[0]);
  check('на экране: цена 10 000, минимум 8, участников 7, таймер', [t.fee, t.minParticipants, t.tournament.participantsCount, t.tournament.secondsLeft > 0], [10_000, 8, 7, true]);
  await waitFor('отмены', async () => (await tour(players[0])).tournament?.status === 'cancelled', 10_000);
  check('7 участников — турнир отменён', (await tour(players[0])).tournament.status, 'cancelled');
  check('всем вернули 10 000', (await Promise.all(players.map(me))).map((a) => a.balance), Array(7).fill(30_000));
}

async function fullTournament() {
  section('турнир: регистрация 9 и столы 4+5 (§19.3)');
  check('новый турнир', (await request('POST', '/admin/tournament/start')).status, 200);
  const players: P[] = [];
  for (let i = 0; i < 9; i++) players.push(await account(`Тур${i}`));
  const outsider = await account('Чужой');
  for (const p of players) await register(p);
  check('9 зарегистрированы', (await tour(players[0])).tournament.participantsCount, 9);
  await waitFor('отбора', async () => (await tour(players[0])).tournament?.status === 'qualification', 10_000);
  let t = await tour(players[0]);
  check('регистрация закрыта — отбор', t.tournament.status, 'qualification');
  check('9 → столы 4+5', t.tournament.tables.map((x: any) => x.capacity), [4, 5]);
  check('столы ждут игроков, места свободны', t.tournament.tables.map((x: any) => [x.status, x.free]), [['waiting', 4], ['waiting', 5]]);
  check('казна: 2 стола × 50 000', t.tournament.treasury, 100_000);

  section('турнир: посадка (§19.3)');
  const table2 = players.slice(0, 5); // пятеро людей
  const table1 = players.slice(5, 8); // трое людей + бот на последнем шансе
  const noShow = players[8]; // зарегистрировался и не пришёл
  check('чужой (не участник) сесть не может', (await sit(outsider, 2)).body.error, 'not registered');
  const first = await sit(table2[0], 2);
  check('участник садится — турнирный баланс 10 000, кошелёк не тронут',
    [first.status, first.body.players[0].balance, first.body.myReserve], [200, 10_000, 20_000]);
  check('за два турнирных стола сразу — нельзя', (await sit(table2[0], 1)).body.error, 'already in another room');
  check('за обычный стол, сидя за турнирным, — нельзя',
    (await request('POST', '/rooms', table2[0].token, { capacity: 4, ante: 100, emptyLimit: 3, konThreshold: 3, minBalance: 1000 })).body.error,
    'already in another room');
  const room2 = first.body.id as string;
  check('пригласить можно любого участника, не только друга',
    (await request('POST', `/rooms/${room2}/invite`, table2[0].token, { code: table2[1].code })).status, 200);
  check('не участника пригласить нельзя',
    (await request('POST', `/rooms/${room2}/invite`, table2[0].token, { code: outsider.code })).body.error, 'not a tournament participant');
  check('приглашение — на главном экране', (await me(table2[1])).roomInvites.map((x: any) => x.roomId), [room2]);
  check('обычный вход по коду за турнирный стол не пускает чужого',
    (await request('POST', `/rooms/${room2}/join`, outsider.token, {})).body.error, 'not registered');
  check('встать до начала игры — можно', (await request('POST', `/rooms/${room2}/leave`, table2[0].token, {})).status, 200);
  check('и снова сесть', (await sit(table2[0], 2)).status, 200);
  for (const p of table2.slice(1)) await request('POST', `/rooms/${room2}/join`, p.token, {});
  let s2 = await view(room2, table2[0]);
  check('стол полон — «ГОТОВ» 30 секунд', [s2.players.length, !!s2.readyCheck], [5, true]);
  for (const p of table2) await request('POST', `/rooms/${room2}/ready`, p.token, {});
  s2 = await view(room2, table2[0]);
  check('все нажали — игра началась автоматически', s2.status, 'started');
  check('за турнирным столом выключены докупка, часть выигрыша, «закончить по согласию»',
    [s2.game.myCanRequestTopUp, s2.game.myShareLimits, s2.game.myCanProposeEnd], [false, null, false]);
  check('в состоянии стола — турнир: отбор, стол №2, час идёт', [s2.tournament.stage, s2.tournament.tableNo, s2.tournament.secondsLeft > 0], ['qual', 2, true]);
  check('настройки турнира: взнос (здесь — для проверки), КОН ×5, пустых 7, 30 с на ход, 3 минуты отлучки',
    [s2.settings.konThreshold, s2.settings.emptyLimit, s2.settings.turnSeconds, s2.settings.absenceMinutes], [5, 7, 30, 3]);
  t = await tour(players[0]);
  check('на экране турнира: стол №2 — идёт игра', t.tournament.tables[1].status, 'playing');

  // Трое садятся за стол №1 — он ждёт четвёртого (не придёт).
  for (const p of table1) await sit(p, 1);
  const room1 = t.tournament.tables[0].roomId as string;

  section('турнир: игра, выбывание, конец стола (§19.4)');
  let sawElimination = false;
  let afterElimination: any = null;
  // Сервер перезапускается посреди отбора — турнир и стол продолжаются.
  setTimeout(() => {}, 0);
  await play(room2, table2, (v) => {
    if (!sawElimination && v.tournament?.eliminatedIds?.length > 0 && v.status === 'started') {
      sawElimination = true;
      afterElimination = v;
    }
  });
  s2 = await view(room2, table2[0]);
  if (afterElimination) {
    check('игрок с балансом меньше взноса выбыл, остальные играют дальше',
      [afterElimination.players.length, afterElimination.status], [4, 'started']);
    const outId = afterElimination.tournament.eliminatedIds[0];
    check('выбывший — в итогах стола со своим остатком', afterElimination.departedPlayers.some((d: any) => d.id === outId), true);
  } else {
    console.log('     (выбывания во время игры не случилось — стол закончился раньше)');
  }
  console.log(`     (стол №2: ${s2.tournament.endReason}, выбыли ${s2.tournament.eliminatedIds.length})`);
  check('стол закончился: осталось трое или вышел час', ['three_left', 'time_up'].includes(s2.tournament.endReason), true);
  check('кон после стола поделён между оставшимися — на столе его нет', s2.game.kon, 0);
  await waitFor('итога стола №2', async () => (await tour(players[0])).tournament.tables[1].status === 'finished', 5_000);
  t = await tour(players[0]);
  const t2rows = t.tournament.participants.filter((x: any) => x.tableNo === 2);
  check('итоги стола №2 в общем списке, пока другой стол не сыгран', [t2rows.length, t2rows.every((x: any) => x.status === 'played')], [5, true]);
  check('турнирные монеты стола сохранились: 5 × 10 000 = 50 000', t2rows.reduce((a: number, x: any) => a + x.balance, 0), 50_000);
  check('кошельки за игру не менялись', (await Promise.all(table2.map(me))).map((a) => a.balance), Array(5).fill(20_000));

  section('турнир: перезапуск сервера посреди отбора');
  await stopServer();
  await startServer();
  t = await tour(players[0]);
  check('после перезапуска — тот же турнир, тот же этап, та же казна', [t.tournament.status, t.tournament.treasury], ['qualification', 100_000]);
  check('итоги стола №2 на месте', t.tournament.participants.filter((x: any) => x.tableNo === 2).reduce((a: number, x: any) => a + x.balance, 0), 50_000);
  check('трое за столом №1 всё ещё сидят', (await view(room1, table1[0])).players.length, 3);

  section('турнир: последний шанс — боты на пустые места (§19.5)');
  await waitFor('последнего шанса', async () => !!(await view(room1, table1[0])).readyCheck, 40_000);
  let s1 = await view(room1, table1[0]);
  check('за 1 ч 10 мин до конца — стол открыт последние минуты', s1.tournament.lastCall, true);
  for (const p of table1) await request('POST', `/rooms/${room1}/ready`, p.token, {});
  s1 = await view(room1, table1[0]);
  check('«ГОТОВ» нажали — пустое место занял бот, игра идёт', [s1.status, s1.players.filter((x: any) => x.bot).length], ['started', 1]);
  check('неявившийся пропал со стола — сесть уже нельзя', (await sit(noShow, 1)).body.error, 'game already started');
  await play(room1, table1);

  section('турнир: финалисты и казна (§19.7, §19.8)');
  await waitFor('финалистов', async () => (await tour(players[0])).tournament?.status === 'final', 30_000);
  t = await tour(players[0]);
  const finalists = t.tournament.participants.filter((x: any) => x.status === 'finalist');
  const outRows = t.tournament.participants.filter((x: any) => x.status === 'out');
  check('финалистов от 1 до 7, финальный стол один', [finalists.length >= 1 && finalists.length <= 7, t.tournament.tables.filter((x: any) => x.stage === 'final').length], [true, 1]);
  const above = t.tournament.participants.filter((x: any) => ['finalist', 'out'].includes(x.status) && x.balance > 10_000);
  check('все, у кого больше 10 000, в финале (если их не больше 7)',
    above.length <= 7 ? above.every((x: any) => x.status === 'finalist') : finalists.length === 7, true);
  check('финалисты сверху списка', t.tournament.participants.slice(0, finalists.length).every((x: any) => x.status === 'finalist'), true);
  const penalizedRow = t.tournament.participants.find((x: any) => x.code === noShow.code);
  check('не сыгравший — наказан: исключён, −1.5 рейтинга', [penalizedRow.status, penalizedRow.ratingDelta], ['penalized', -1.5]);
  const ban = (await me(noShow)).leaveBan;
  check('и бан на 24 часа', ban && ban.secondsLeft > 23 * 3600 && ban.tournament, true);
  check('во время бана — за стол нельзя', (await request('POST', '/rooms', noShow.token, { capacity: 4, ante: 100, emptyLimit: 3, konThreshold: 3, minBalance: 1000 })).body.error, 'banned for leaving');

  section('турнир: финал и выплаты (§19.9)');
  const finalPlayers = players.filter((p) => finalists.some((f: any) => f.code === p.code));
  const finalTable = t.tournament.tables.find((x: any) => x.stage === 'final');
  const finalRoom = finalTable.roomId as string;
  check('сесть в финал может только финалист', (await sit(outRows[0] ? players.find((p) => p.code === outRows[0].code)! : outsider, 1)).status, 403);
  const walletsBefore = Object.fromEntries(await Promise.all(players.map(async (p) => [p.code, (await me(p)).balance])));
  for (const p of finalPlayers) await sit(p, 1);
  let sf = await view(finalRoom, finalPlayers[0]);
  check('финалист садится со своим балансом из отбора, не с новыми 10 000',
    finalPlayers.every((p) => sf.players.find((x: any) => x.id === p.id)?.balance === finalists.find((f: any) => f.code === p.code).balance), true);
  for (const p of finalPlayers) await request('POST', `/rooms/${finalRoom}/ready`, p.token, {});
  sf = await view(finalRoom, finalPlayers[0]);
  check('финал начался (людей меньше 4 — с ботами)', [sf.status, sf.players.length >= 4], ['started', true]);
  await play(finalRoom, finalPlayers);
  await waitFor('конца турнира', async () => (await tour(players[0])).tournament?.status === 'finished', 20_000);
  t = await tour(players[0]);
  check('турнир закончен, есть победитель', [t.tournament.status, !!t.tournament.winner], ['finished', true]);
  const w = t.tournament.winner;
  const winnerP = players.find((p) => p.code === w.code)!;
  check('выигрыш = баланс победителя + казна', w.prize, w.balance + w.treasury);
  const walletsAfter = Object.fromEntries(await Promise.all(players.map(async (p) => [p.code, (await me(p)).balance])));
  check('победитель получил ровно баланс + казну', walletsAfter[w.code] - walletsBefore[w.code], w.prize);
  const others = t.tournament.participants.filter((x: any) => x.status === 'final_done' && x.code !== w.code);
  check('остальные финалисты — свой оставшийся баланс', others.every((x: any) => walletsAfter[x.code] - walletsBefore[x.code] === x.balance), true);
  check('не прошедшие в финал ничего не получили', outRows.every((x: any) => walletsAfter[x.code] === walletsBefore[x.code]), true);
  check('первая победа — tournamentWins = 1, значок 🏆', [(await me(winnerP)).tournamentWins, (await tour(winnerP)).me.badge], [1, '🏆']);
  check('в профиле — победы', (await request('GET', '/me/profile', winnerP.token)).body.tournamentWins, 1);
  const places = t.tournament.participants.filter((x: any) => x.status === 'final_done').map((x: any) => [x.finalPlace, x.ratingDelta]);
  check('рейтинг: 1-е +1.0, дальше по местам', places[0], [1, 1]);
  check('не прошедшие в финал — +0.1', outRows.length === 0 || t.tournament.participants.filter((x: any) => x.status === 'out').every((x: any) => x.ratingDelta === 0.1), true);

  section('турнир: двойной выплаты нет — и после перезапуска');
  await stopServer();
  await startServer();
  await wait(2_500);
  const walletsRestart = Object.fromEntries(await Promise.all(players.map(async (p) => [p.code, (await me(p)).balance])));
  check('после перезапуска кошельки те же', JSON.stringify(walletsRestart) === JSON.stringify(walletsAfter), true);
  check('побед по-прежнему 1, второй значок не появился', (await me(winnerP)).tournamentWins, 1);

  section('турнир: журнал денег сходится (§19.8)');
  await stopServer();
  const db = new DatabaseSync(DB_FILE);
  const tid = t.tournament.id;
  const rows = db.prepare('SELECT kind, COUNT(*) AS n, SUM(amount) AS sum FROM tournament_ledger WHERE tournament_id = ? GROUP BY kind').all(tid) as any[];
  const by = Object.fromEntries(rows.map((r) => [r.kind, { n: Number(r.n), sum: Number(r.sum) }]));
  check('взносы: 9 × 10 000', [by.fee.n, by.fee.sum], [9, -90_000]);
  check('+50 000 за каждый стол — 2 отбора и финал, по одному разу', [by.table.n, by.table.sum], [3, 150_000]);
  check('монеты наказанного — в казне 10 000', by.penalty.sum, 10_000);
  const treasury = ['table', 'leftover', 'penalty', 'bot'].reduce((a, k) => a + (by[k]?.sum ?? 0), 0);
  check('казна победителя = вся казна по журналу', w.treasury, treasury);
  const finalDone = db.prepare("SELECT SUM(balance) AS s FROM tournament_entries WHERE tournament_id = ? AND status = 'final_done'").get(tid) as any;
  check('выплачено = балансы финалистов + казна', by.payout.sum, Number(finalDone.s) + treasury);
  const keys = db.prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT key) AS d FROM tournament_ledger').get() as any;
  check('каждое движение в журнале — один раз', Number(keys.n), Number(keys.d));
  db.close();
}

// Финал не сыгран совсем (§19.13, решение владельца 31.10.2026): никто из финалистов не сел —
// никого не наказываем, победитель и места — по общему списку отбора.
async function noFinal() {
  section('турнир: финал не сыгран — победитель по отбору (§19.13)');
  check('новый турнир', (await request('POST', '/admin/tournament/start')).status, 200);
  const players: P[] = [];
  for (let i = 0; i < 8; i++) players.push(await account(`Нефинал${i}`));
  for (const p of players) await register(p);
  await waitFor('отбора', async () => (await tour(players[0])).tournament?.status === 'qualification', 10_000);
  const groups = [players.slice(0, 4), players.slice(4)];
  for (const [i, g] of groups.entries()) for (const p of g) await sit(p, i + 1);
  let t = await tour(players[0]);
  const roomIds = t.tournament.tables.map((x: any) => x.roomId as string);
  for (const [i, g] of groups.entries()) for (const p of g) await request('POST', `/rooms/${roomIds[i]}/ready`, p.token, {});
  await Promise.all(groups.map((g, i) => play(roomIds[i], g)));
  await waitFor('финалистов', async () => (await tour(players[0])).tournament?.status === 'final', 60_000);
  t = await tour(players[0]);
  const finalists = t.tournament.participants.filter((x: any) => x.status === 'finalist');
  check('финалисты есть', finalists.length >= 1, true);
  const walletsBefore = Object.fromEntries(await Promise.all(players.map(async (p) => [p.code, (await me(p)).balance])));
  const treasury = t.tournament.treasury;
  await waitFor('конца турнира', async () => (await tour(players[0])).tournament?.status === 'finished', 60_000);
  t = await tour(players[0]);
  const w = t.tournament.winner;
  check('финал не сыгран — турнир закончен с победителем по отбору', [t.tournament.status, w?.code, w?.byQualification], ['finished', finalists[0].code, true]);
  check('выигрыш = баланс отбора + вся казна', [w.balance, w.prize], [finalists[0].balance, finalists[0].balance + treasury]);
  const rows = t.tournament.participants.filter((x: any) => finalists.some((f: any) => f.code === x.code));
  check('не пришедших финалистов не наказали', rows.every((x: any) => x.status === 'final_done'), true);
  check('места — по списку отбора', rows.map((x: any) => x.code), finalists.map((f: any) => f.code));
  check('рейтинг по местам: +1.0, +0.5, +0.3, +0.2…', rows.map((x: any) => x.ratingDelta), rows.map((_: any, i: number) => [1, 0.5, 0.3][i] ?? 0.2));
  const walletsAfter = Object.fromEntries(await Promise.all(players.map(async (p) => [p.code, (await me(p)).balance])));
  check('кошельки: победитель — баланс + казна, остальные финалисты — свой баланс',
    finalists.every((f: any, i: number) => walletsAfter[f.code] - walletsBefore[f.code] === f.balance + (i === 0 ? treasury : 0)), true);
  const winnerP = players.find((p) => p.code === w.code)!;
  check('победителю — значок 🏆, бана нет', [(await me(winnerP)).tournamentWins, (await me(winnerP)).leaveBan], [1, null]);
}

try {
  await startServer();
  await cancelled();
  await fullTournament();
  await startServer();
  await noFinal();
} catch (e) {
  console.error(e);
  check('проверка дошла до конца без ошибок', String(e), 'ok');
} finally {
  try {
    server.kill();
  } catch {
    /* уже остановлен */
  }
  rmSync(dir, { recursive: true, force: true });
}
process.exit(summary() === 0 ? 0 : 1);
