// Живая проверка: кнопка «ДОБАВИТЬ БОТОВ» (27.09.2026) — боты сервера садятся и играют сами,
// отсчёт хода ждёт конца анимации раздачи. Настоящий сервер на порту 3096, база в памяти.
// Запуск: npm run test:live

import { spawn } from 'node:child_process';
import { check, section, summary } from './check.js';
import { botAction } from '../src/serverBots.js';

const PORT = 3096;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), GARBA_DB: ':memory:' },
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

async function main() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/health')).ok) break; } catch {}
    await wait(200);
  }

  section('кнопка «ДОБАВИТЬ БОТОВ» (27.09.2026)');
  const host = (await request('POST', '/accounts', undefined, { name: 'Серик' })).body;
  const guest = (await request('POST', '/accounts', undefined, { name: 'Гость' })).body;
  const room = (await request('POST', '/rooms', host.token, { capacity: 4, ante: 100, emptyLimit: 5, konThreshold: 10, minBalance: 1000 })).body;
  await request('POST', `/rooms/${room.id}/join`, guest.token);
  check('добавить ботов может только создатель', (await request('POST', `/rooms/${room.id}/bots`, guest.token)).status, 403);
  await request('POST', `/rooms/${room.id}/leave`, guest.token);

  const added = await request('POST', `/rooms/${room.id}/bots`, host.token);
  const bots = added.body.players.filter((p: any) => p.bot);
  check('боты сели на все свободные места', [added.status, added.body.players.length, bots.length], [200, 4, 3]);
  check('у каждого бота 30 000', bots.map((b: any) => b.balance), [30_000, 30_000, 30_000]);
  check('имена — «Бот …»', bots.every((b: any) => b.name.startsWith('Бот ')), true);
  check('полный стол — ботов больше не добавить', (await request('POST', `/rooms/${room.id}/bots`, host.token)).status, 409);
  check('комната с ботами — тренировка', added.body.practice, true);
  check('бота не найти по коду: ни подарка, ни дружбы', (await request('GET', `/players/${bots[0].code}`, host.token)).status, 404);
  const ratingBefore = (await request('GET', '/me', host.token)).body.rating;

  // Серик играет сам той же логикой, что и боты, и опрашивает сервер — он на связи.
  let firstBidLeft: number | null = null;
  let sawRoundDone = false;
  let lastDeal = 0;
  let lastVersion = -1;
  let versionWentBack = false;
  const deadline = Date.now() + 150_000;
  // Взял спецкарту — торгов в этой раздаче нет: отсчёт перед первой заявкой меряем в следующей.
  while (Date.now() < deadline && !(sawRoundDone && firstBidLeft !== null)) {
    const state = (await request('GET', `/rooms/${room.id}`, host.token)).body;
    if (state.status === 'finished') break;
    const g = state.game;
    if (state.version < lastVersion) versionWentBack = true;
    lastVersion = state.version;
    if (g?.stage === 'bidding' && (g.dealNumber ?? 0) > lastDeal) {
      lastDeal = g.dealNumber;
      firstBidLeft ??= g.turnSecondsLeft;
    }
    if (g?.stage === 'round_done' || g?.stage === 'room_done') sawRoundDone = true;
    const move = botAction(host.id, state);
    if (move) await request('POST', `/rooms/${room.id}/${move.path}`, host.token, move.body);
    await wait(400);
  }
  check('все нажали «ГОТОВ», боты раздали, торговались и доиграли раздачу', sawRoundDone, true);
  check('сразу после раздачи отсчёт стоит: 20 с хода + анимация (4 игрока — 9,6 с)',
    firstBidLeft !== null && firstBidLeft > 20 && firstBidLeft <= 30, true);

  check('номер состояния растёт и не откатывается', [lastVersion > 5, versionWentBack], [true, false]);

  // Тренировка: сколько бы ни выиграл или проиграл за столом — в аккаунте всё как было.
  const final = (await request('GET', `/rooms/${room.id}`, host.token)).body;
  const inRoom = final.players.find((p: any) => p.id === host.id).balance;
  const meNow = (await request('GET', '/me', host.token)).body;
  console.log(`   за столом у Серика ${inRoom}, в аккаунте ${meNow.balance}`);
  // Вне стола + взятое за стол (09.10.2026) — выигрыш и проигрыш за столом сюда не попали.
  const taken = final.players.find((p: any) => p.id === host.id).startBalance;
  check('тренировка: баланс аккаунта не изменился (30 000)', meNow.balance + taken, 30_000);
  check('тренировка: рейтинг не изменился', meNow.rating, ratingBefore);
  const profile = (await request('GET', '/me/profile', host.token)).body;
  check('тренировка: в статистику профиля не попала', profile.stats.deals, 0);

  const rating = (await request('GET', '/rating?scope=all', host.token)).body;
  check('в рейтинге ботов нет', rating.players.some((p: any) => p.name.startsWith('Бот ')), false);
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
