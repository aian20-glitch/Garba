// Боты-участники турнира для ручной проверки на эмуляторе (RULES.md §19).
//
// Это обычные аккаунты (не боты сервера): регистрируются за 10 000, садятся за столы отбора,
// жмут «ГОТОВ», играют логикой ботов сервера (botAction), проходят в финал и играют его.
// Живой игрок (владелец) успевает выбрать стол первым: пока кто-то из людей зарегистрирован
// и ещё не сел, боты не садятся (кроме последних 10 минут, §19.5).
//
// Запуск: npm run tour-bots -- [сколько ботов, по умолчанию 7] [--skip-final] [--start]
//   --start       — запустить турнир сейчас (POST /admin/tournament/start), если его нет
//   --skip-final  — боты-финалисты не садятся в финал (проверка §19.13)
// Аккаунты — tools/.tour-bots.json (в git не попадает). Связь с сервером — опросом: запрос
// к своей комнате считается присутствием (§13).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { botAction } from '../src/serverBots.js';

type Bot = { id: string; name: string; token: string; code: string };

const base = process.env.GARBA_URL ?? 'http://127.0.0.1:3000';
const args = process.argv.slice(2);
const count = Number(args.find((a) => /^\d+$/.test(a)) ?? 7);
const skipFinal = args.includes('--skip-final');
const startNow = args.includes('--start');
const NAMES = ['Арман', 'Жанна', 'Ерлан', 'Айгерим', 'Нурлан', 'Сауле', 'Данияр', 'Гульнар', 'Асхат', 'Мадина', 'Берик', 'Камила'];

const file = fileURLToPath(new URL('../../tools/.tour-bots.json', import.meta.url));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Сервер перезапускается (tsx watch после правки) — ждём и повторяем, а не падаем.
async function call(method: string, path: string, token?: string, body?: unknown) {
  for (;;) {
    try {
      return await callOnce(method, path, token, body);
    } catch {
      console.log('сервер не отвечает — жду…');
      await wait(2_000);
    }
  }
}
async function callOnce(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

// Аккаунты ботов: старые из файла (если сервер их знает), недостающие — заново.
async function loadBots(): Promise<Bot[]> {
  const saved: Bot[] = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  const bots: Bot[] = [];
  for (const b of saved) {
    if (bots.length >= count) break;
    if ((await call('GET', '/me', b.token)).status === 200) bots.push(b);
  }
  while (bots.length < count) {
    const name = `${NAMES[bots.length % NAMES.length]}-тур`;
    const r = await call('POST', '/accounts', undefined, { name });
    if (r.status !== 201) throw new Error(`не создать аккаунт ${name}: ${r.status} ${JSON.stringify(r.body)}`);
    bots.push({ id: r.body.id, name: r.body.name, token: r.body.token, code: r.body.code });
  }
  writeFileSync(file, JSON.stringify(bots, null, 2));
  return bots;
}

// Ход за столом — не чаще раза в 1,2 с на бота, после новой раздачи ждём её анимацию
// (те же числа, что в приложении: 1 с + 0,43 с на карту каждому).
const nextAt = new Map<string, number>();
const dealSeen = new Map<string, number>();
async function playAt(bot: Bot, roomId: string) {
  const v = (await call('GET', `/rooms/${roomId}`, bot.token)).body;
  if (!v?.id) return;
  const now = Date.now();
  const deal = Number(v.game?.dealNumber ?? 0);
  if (deal !== dealSeen.get(bot.id)) {
    dealSeen.set(bot.id, deal);
    nextAt.set(bot.id, now + 1_000 + v.players.length * 5 * 430);
  }
  if (now < (nextAt.get(bot.id) ?? 0)) return;
  const action = botAction(bot.id, v);
  if (!action) return;
  const r = await call('POST', `/rooms/${roomId}/${action.path}`, bot.token, action.body);
  nextAt.set(bot.id, Date.now() + 1_200);
  if (r.status === 200) console.log(`${bot.name}: ${action.path} ${action.body && Object.keys(action.body).length ? JSON.stringify(action.body) : ''}`);
}

const bots = await loadBots();
const botCodes = new Set(bots.map((b) => b.code));
console.log(`Ботов: ${bots.length} — ${bots.map((b) => b.name).join(', ')}`);
if (startNow) {
  const r = await call('POST', '/admin/tournament/start');
  console.log(r.status === 200 ? `Турнир запущен: ${r.body.id}` : `Турнир не запущен: ${r.body.error}`);
}

let lastPhase = '';
for (;;) {
  const views = await Promise.all(bots.map(async (b) => (await call('GET', '/tournament', b.token)).body));
  const t = views[0]?.tournament;
  if (!t) {
    console.log('Турнира нет. Запусти с --start или дождись понедельника 20:00.');
    process.exit(0);
  }
  if (t.phase !== lastPhase) {
    lastPhase = t.phase;
    console.log(`--- этап: ${t.phase}, участников ${t.participantsCount}, казна ${t.treasury}`);
  }
  if (t.status === 'finished' || t.status === 'cancelled') {
    console.log(t.winner ? `Турнир закончен. Победитель — ${t.winner.name}, выигрыш ${t.winner.prize}` : `Турнир: ${t.status}`);
    process.exit(0);
  }
  // Люди, которые ещё не сели за стол отбора, — им выбирать первыми.
  const unseatedHumans = t.participants.filter(
    (p: any) => !botCodes.has(p.code) && p.status === 'registered' && p.seatedAt == null,
  ).length;
  for (const [i, bot] of bots.entries()) {
    const me = views[i]?.me;
    if (!me) continue;
    if (t.status === 'registration' && !me.registered && me.canRegister) {
      const r = await call('POST', '/tournament/register', bot.token, { confirm: true });
      console.log(r.status === 200 ? `${bot.name} зарегистрировался` : `${bot.name}: ${r.body.error}`);
      continue;
    }
    if (me.roomId) {
      await playAt(bot, me.roomId);
      continue;
    }
    // Сесть: отбор — когда люди выбрали (или последний шанс); финал — сразу, если не --skip-final.
    const stage = t.status === 'qualification' ? 'qual' : t.status === 'final' ? 'final' : null;
    const mustSit = (stage === 'qual' && me.status === 'registered') || (stage === 'final' && me.status === 'finalist' && !skipFinal);
    if (!mustSit) continue;
    const free = t.tables
      .filter((x: any) => x.stage === stage && x.status === 'waiting' && x.free > 0)
      .sort((a: any, b: any) => b.players.length - a.players.length);
    const table = stage === 'final' ? free[0] : free.find((x: any) => unseatedHumans === 0 || x.lastCall);
    if (!table) continue;
    const r = await call('POST', `/tournament/tables/${table.tableNo}/sit`, bot.token, {});
    console.log(r.status === 200 ? `${bot.name} сел за ${stage === 'final' ? 'финал' : `стол №${table.tableNo}`}` : `${bot.name}: ${r.body.error}`);
    break; // одна посадка за круг — список столов уже устарел
  }
  await wait(700);
}
