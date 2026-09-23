// Боты-игроки для ручной проверки GARBA на эмуляторе — версия для Mac/Linux.
//
// То же, что tools/garba.ps1 (он остаётся для Windows), но на Node: встроенный fetch
// шлёт тело в UTF-8, кириллица (имена, РАЗ / ДВА / ПАС) доезжает целой.
// Токены ботов — в том же tools/.bots.json, так что оба скрипта и bots-online.ts
// видят одних и тех же ботов.
//
// Запуск из корня проекта (обёртка tools/garba) или из backend: npm run garba -- <команда> ...
//   ./tools/garba join     12345              добрать ботов до полной комнаты — дальше они играют сами
//   ./tools/garba join     12345 --manual     то же, но боты только держат связь, ходы — командами ниже
//   ./tools/garba state    12345              показать состояние комнаты
//   ./tools/garba deal     12345              раздать, если раздающим оказался бот
//   ./tools/garba bid      12345 РАЗ --bot 1  заявка конкретного бота
//   ./tools/garba bid      12345 ДВА --bot 2 --suit clubs   ДВА с мастью (6–7 игроков)
//   ./tools/garba bid      12345 КОН --bot 1  КОН (когда кон дорос до порога)
//   ./tools/garba passall  12345              боты пасуют, пока очередь не дойдёт до тебя
//   ./tools/garba playall  12345              боты ходят картами, пока очередь не дойдёт до тебя
//   ./tools/garba vote     12345 split        все боты голосуют (continue | split)
//   ./tools/garba kontrump 12345 diamonds     бот, выигравший КОН, называет козырь (без масти — масть РАЗ)
//   ./tools/garba special  12345 2            бот, чья очередь, берёт спецкарту за ×2 (без числа — пас)
//   ./tools/garba discard  12345              бот-владелец спецкарты сбрасывает карту
//   ./tools/garba online   12345 [--manual]   снова посадить ботов на связь (после offline)
//   ./tools/garba offline                     «отключить» ботов (проверка паузы, §13)

import { spawn } from 'node:child_process';
import { existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Bot = { id: string; name: string; token: string };

const base = process.env.GARBA_URL ?? 'http://127.0.0.1:3000';
const botNames = ['Айдар', 'Дана', 'Ержан', 'Асель', 'Тимур', 'Мадина'];
const botsFile = fileURLToPath(new URL('../../tools/.bots.json', import.meta.url));
const pidFile = fileURLToPath(new URL('../../tools/.bots-online.pid', import.meta.url));
const logFile = fileURLToPath(new URL('../../tools/.bots-online.log', import.meta.url));
const backendDir = fileURLToPath(new URL('..', import.meta.url));

// ---------- аргументы ----------

const argv = process.argv.slice(2);
const flags: Record<string, string> = {};
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--manual') flags.manual = '';
  else if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[++i] ?? '';
  else positional.push(argv[i]);
}
const [command, room, extra] = positional;

const commands = ['coins', 'join', 'state', 'deal', 'bid', 'passall', 'playall', 'vote', 'kontrump', 'special', 'discard', 'online', 'offline'];
if (!commands.includes(command) || (!['offline', 'coins'].includes(command) && !/^\d+$/.test(room ?? ''))) {
  console.log('Использование: ./tools/garba <команда> <номер комнаты> [...]');
  console.log(`Команды: ${commands.join(', ')}. Подробно — в начале backend/scripts/garba.ts`);
  process.exit(1);
}

// ---------- HTTP ----------

class HttpError extends Error {}

async function request(method: 'GET' | 'POST', path: string, token?: string, body?: unknown): Promise<any> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
  let res: Response;
  try {
    res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new HttpError(`Сервер ${base} не отвечает — запущен ли npm run dev?`);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const post = (path: string, token: string, body: unknown = {}) => request('POST', path, token, body);

// ---------- боты ----------

async function getMe(token: string): Promise<any | null> {
  try {
    return await request('GET', '/me', token);
  } catch {
    return null;
  }
}

async function newBot(name: string): Promise<Bot> {
  const acc = await request('POST', '/accounts', undefined, { name });
  return { id: acc.id, name: acc.name, token: acc.token };
}

function saveBots(bots: Bot[]) {
  writeFileSync(botsFile, JSON.stringify(bots));
}

// Сервер не знает сохранённого бота (база стёрта) — заводим аккаунт заново.
async function loadBots(): Promise<Bot[]> {
  let saved: Bot[] = [];
  if (existsSync(botsFile)) {
    // .bots.json с Windows мог сохраниться с BOM
    saved = JSON.parse(readFileSync(botsFile, 'utf8').replace(/^﻿/, ''));
  }
  const bots: Bot[] = [];
  let changed = false;
  for (let i = 0; i < botNames.length; i++) {
    const s = saved[i];
    if (s && (await getMe(s.token))) {
      bots.push(s);
    } else {
      bots.push(await newBot(botNames[i]));
      changed = true;
    }
  }
  if (changed) saveBots(bots);
  return bots;
}

// ---------- связь ботов (этап 9.2) ----------

// Игрок без сокета через 10 секунд считается отключившимся — игра встаёт на паузу.
// Соединение ботам держит scripts/bots-online.ts, запускаем его в фоне. Он же ходит за ботов,
// если не --manual.
function stopOnline(): boolean {
  if (!existsSync(pidFile)) return false;
  const pid = Number(readFileSync(pidFile, 'utf8'));
  unlinkSync(pidFile);
  try {
    process.kill(-pid); // вся группа: npx → tsx → node
    return true;
  } catch {
    return false; // уже завершился сам (комната закрылась)
  }
}

function startOnline(roomId: string) {
  stopOnline();
  const manual = 'manual' in flags;
  const log = openSync(logFile, 'w');
  const args = ['tsx', 'scripts/bots-online.ts', roomId, ...(manual ? ['--manual'] : [])];
  const child = spawn('npx', args, {
    cwd: backendDir,
    detached: true,
    stdio: ['ignore', log, log],
  });
  child.unref();
  writeFileSync(pidFile, String(child.pid));
  console.log(manual ? 'Боты на связи (в фоне), ходы — командами.' : 'Боты на связи (в фоне) и играют сами.');
  console.log('Что они делают — журнал: tail -f tools/.bots-online.log');
  console.log('«Отключить» ботов: ./tools/garba offline');
}

// ---------- состояние ----------

let bots: Bot[] = [];

// Смотреть комнату можно только с токеном. Без бота — глазами первого бота:
// showState берёт только общие поля, руки не показывает.
const getRoom = (viewer?: Bot) => request('GET', `/rooms/${room}`, (viewer ?? bots[0]).token);
const botById = (id: string | undefined) => bots.find((b) => b.id === id);
const pad = (s: unknown, n: number) => String(s ?? '').padEnd(n);
const card = (c: any) => `${c.rank} ${c.suit}`;

async function showState() {
  const r = await getRoom();
  console.log('');
  console.log(`Комната ${r.id}: ${r.players.length}/${r.capacity}, статус ${r.status}`);

  if (!r.game) {
    console.log(`Игроки: ${r.players.map((p: any) => p.name).join(', ')}`);
    console.log('Игра ещё не начата.');
    return;
  }

  const g = r.game;
  console.log(`Раздающий: ${g.dealerName} | стадия: ${g.stage}`);
  if (r.pause) {
    const off = r.pause.players.map((p: any) => `${p.name} (осталось ${p.secondsLeft} с)`);
    console.log(`ПАУЗА — отключился: ${off.join(', ')}`);
  }
  console.log(`Кон: ${g.kon} (базовый ${g.baseKon}) | РАЗ стоит ${g.razStake}, ДВА стоит ${g.dvaStake}`);
  if (g.konAvailable) console.log(`КОН открыт (с ${g.konUnlockAt}), стоит ${g.konStake}`);
  if (g.special) {
    const sp = g.special;
    console.log(`СПЕЦКАРТА: ${card(sp.card)} (${sp.kind}), фаза ${sp.phase}`);
    if (sp.holderName) console.log(`  у ${sp.holderName} на x${sp.risk}`);
    if (sp.activeId) console.log(`  решает: ${r.players.find((p: any) => p.id === sp.activeId)?.name ?? sp.activeId}`);
    if (sp.passedIds?.length) console.log(`  выбыли: ${sp.passedIds.join(', ')}`);
    if (sp.outcome === 'nobody') console.log('  не взял никто — обычные торги');
  }
  if (g.stage === 'special_discard') console.log(`Владелец спецкарты ${g.mains[0].playerName} сбрасывает одну карту`);
  if (g.stage === 'kon_trump') console.log(`КОН выиграл ${g.mains[0].playerName} — ждём, какой козырь он назовёт`);
  if (g.closing) console.log('У кого-то меньше базового кона — доигрываем последний кон');

  if (g.openCard) console.log(`Открыта: ${card(g.openCard)}`);
  if (g.trumpSuit) console.log(`Козырь: ${g.trumpSuit}`);
  else if (g.razSuit) console.log(`РАЗ: ${g.razSuit}`);
  if (g.izzhoga?.length) console.log(`ИЗЖОГА (вернули в колоду): ${g.izzhoga.map(card).join(', ')}`);
  if (g.stage === 'awaiting_deal') {
    const why = g.lastRedeal === 'three_izzhoga' ? 'Три ИЗЖОГИ подряд' : 'Все спасовали';
    console.log(`${why} — пересдача, раздаёт ${g.dealerName}`);
    if (g.lastAnte?.skipped) {
      console.log(`Доливки нет ни у кого: не хватает на взнос у ${g.lastAnte.brokePlayerIds.join(', ')}`);
    }
  }

  if (g.stage === 'vote') {
    console.log(`ГОЛОСОВАНИЕ: кон не по карману никому (самая дешёвая заявка ${g.vote.cheapest})`);
    console.log(`Продолжаем: ${g.vote.continueVotes} | Делим: ${g.vote.splitVotes} | голосовали: ${g.vote.votedIds.join(', ')}`);
  }
  if (g.lastVote && g.stage !== 'vote') {
    console.log(`Последнее голосование: ${g.lastVote.result} (${g.lastVote.continueVotes} : ${g.lastVote.splitVotes})`);
  }

  const mainIds = (g.mains ?? []).map((m: any) => m.playerId);
  const playing = g.stage === 'playing' || g.stage === 'round_done';
  const actor = g.stage === 'playing' ? g.turnPlayerId : g.activeBidderId;

  if (g.stage === 'playing') {
    console.log(`Взятка ${g.trickNumber} из 5`);
    if (g.currentTrick?.length) {
      console.log(`На столе: ${g.currentTrick.map((t: any) => `${t.playerName}: ${card(t.card)}`).join(' | ')}`);
    } else if (g.lastTrick) {
      console.log(`Прошлую взятку забрал ${g.lastTrick.winnerName}`);
    }
  }

  for (const p of r.players) {
    let mark = '  ';
    if (p.id === actor) mark = '->';
    else if (mainIds.includes(p.id)) mark = '**';

    let said: string;
    if (playing) {
      said = `взяток: ${g.tricksWon?.[p.id] ?? 0}`;
    } else {
      const mine = (g.bids ?? []).filter((b: any) => b.playerId === p.id);
      said = mine.length ? mine[mine.length - 1].bid : '-';
    }
    console.log(`${mark} ${pad(p.name, 10)} ${pad(said, 10)} карт: ${g.handCounts?.[p.id] ?? 0}  баланс: ${p.balance}`);
  }

  if (g.stage === 'round_done') {
    console.log('');
    const noPlay = (g.result ?? []).some((res: any) => res.instant);
    if (g.trickNumber < 5 && !noPlay) console.log(`Исход ясен после ${g.trickNumber}-й взятки — дальше не играли`);
    for (const res of g.result ?? []) {
      const verdict = res.won ? 'ВЫИГРАЛ' : 'ПРОИГРАЛ';
      let how = `взяток ${res.tricks}`;
      if (res.garba) how = 'ГАРБА, без розыгрыша';
      else if (res.instant) how = 'Q K A козыря, без розыгрыша (не ГАРБА)';
      console.log(`ИТОГ: ${res.playerName} (${res.declaration}) — ${how}, ${verdict}, ${res.delta}`);
    }
    console.log(`Кон: ${g.konBeforeSettlement} -> ${g.kon}. Следующую раздачу сдаёт ${g.dealerName}`);
  }

  if (g.stage === 'room_done') {
    console.log('');
    console.log('КОМНАТА ЗАКРЫТА. Итоги:');
    if (g.closeReason === 'nobody_can_play') {
      console.log(`Кон ${g.split.kon} не по карману никому — поделили по ${g.split.perPlayer}, остаток ${g.split.remainder}`);
    }
    if (g.closeReason === 'player_left') {
      const left = r.players.filter((p: any) => g.leftPlayerIds.includes(p.id)).map((p: any) => p.name);
      console.log(`Не вернулся за 5 минут: ${left.join(', ')}. Кон ${g.split.kon} поделили между оставшимися по ${g.split.perPlayer}, остаток ${g.split.remainder}`);
    }
    for (const p of r.players) {
      console.log(`   ${pad(p.name, 10)} ${p.startBalance} -> ${p.balance}  (${p.balance - p.startBalance})`);
    }
  }
  console.log('');
}

// ---------- команды ----------

async function join() {
  const r = await getRoom();
  const need = r.capacity - r.players.length;
  if (need <= 0) {
    console.log(`Комната уже полная: ${r.players.length}/${r.capacity}`);
  } else {
    for (let i = 0; i < need; i++) {
      let b = bots[i];
      // Играть можно только в одной комнате. Если бот застрял в старой
      // недоигранной — заводим ему новый аккаунт с тем же именем.
      const me = await getMe(b.token);
      if (me?.roomId && me.roomId !== room) {
        console.log(`${b.name} занят в комнате ${me.roomId} — новый аккаунт`);
        b = await newBot(b.name);
        bots[i] = b;
        saveBots(bots);
      }
      const res = await post(`/rooms/${room}/join`, b.token);
      console.log(`${b.name} вошёл: ${res.players.length}/${res.capacity}`);
    }
  }
  startOnline(room);
  await showState();
}

async function deal() {
  const r = await getRoom();
  if (!r.game) return console.log('Игра ещё не начата — сначала нажми СТАРТ в приложении.');
  if (!['dealer_found', 'awaiting_deal', 'round_done'].includes(r.game.stage)) {
    console.log(`Карты уже розданы, стадия: ${r.game.stage}`);
    return showState();
  }
  const b = botById(r.game.dealerId);
  if (!b) return console.log(`Раздающий — живой игрок (${r.game.dealerName}). Жми кнопку в приложении.`);
  await post(`/rooms/${room}/dealer/continue`, b.token);
  console.log(`${b.name} раздал карты`);
  await showState();
}

async function bid() {
  const b = bots[Number(flags.bot ?? 1) - 1];
  const declaration = extra ?? flags.bid ?? 'ПАС';
  const body: Record<string, string> = { bid: declaration };
  if (flags.suit) body.suit = flags.suit;
  await post(`/rooms/${room}/bid`, b.token, body);
  console.log(`${b.name} сказал ${declaration} ${flags.suit ?? ''}`);
  await showState();
}

async function passAll() {
  for (let guard = 0; guard < 10; guard++) {
    const r = await getRoom();
    if (!r.game) return console.log('Игра ещё не начата.');
    if (r.game.stage !== 'bidding') {
      console.log(`Торги не активны, стадия: ${r.game.stage}`);
      break;
    }
    const b = botById(r.game.activeBidderId);
    if (!b) {
      console.log('Сейчас ход живого игрока. Жду тебя.');
      break;
    }
    await post(`/rooms/${room}/bid`, b.token, { bid: 'ПАС' });
    console.log(`${b.name} сказал ПАС`);
  }
  await showState();
}

// Бот кладёт первую карту из тех, что разрешил сервер. Никакой стратегии —
// задача только довести раздачу до твоего хода.
async function playAll() {
  for (let guard = 0; guard < 40; guard++) {
    const r = await getRoom();
    if (r.game?.stage !== 'playing') {
      console.log(`Розыгрыш не идёт, стадия: ${r.game?.stage}`);
      break;
    }
    const b = botById(r.game.turnPlayerId);
    if (!b) {
      console.log('Сейчас ход живого игрока. Жду тебя.');
      break;
    }
    const view = await getRoom(b);
    const cardId = view.game.myPlayableCardIds[0];
    const played = view.game.hand.find((c: any) => c.id === cardId);
    await post(`/rooms/${room}/play`, b.token, { cardId });
    console.log(`${b.name} сходил: ${card(played)}`);
  }
  await showState();
}

async function special() {
  const r = await getRoom();
  if (r.game?.stage !== 'special') return console.log(`Борьбы за спецкарту нет, стадия: ${r.game?.stage}`);
  const b = botById(r.game.special.activeId);
  if (!b) return console.log('Сейчас решает живой игрок. Жми в приложении.');
  const risk = Number(extra ?? flags.risk ?? 0);
  if (risk > 0) {
    await post(`/rooms/${room}/special`, b.token, { action: 'take', risk });
    console.log(`${b.name} берёт спецкарту за x${risk}`);
  } else {
    await post(`/rooms/${room}/special`, b.token, { action: 'pass' });
    console.log(`${b.name} пасует`);
  }
  await showState();
}

// Бот-владелец спецкарты сбрасывает первую разрешённую карту.
async function discard() {
  const r = await getRoom();
  if (r.game?.stage !== 'special_discard') return console.log(`Сейчас никто не сбрасывает, стадия: ${r.game?.stage}`);
  const b = botById(r.game.mains[0].playerId);
  if (!b) return console.log('Спецкарта у живого игрока. Сбрасывай в приложении.');
  const view = await getRoom(b);
  await post(`/rooms/${room}/discard`, b.token, { cardId: view.game.myDiscardOptions[0] });
  console.log(`${b.name} сбросил карту (её никто не видит)`);
  await showState();
}

// Бот, выигравший КОН, называет козырь. Масть не задана — берёт масть РАЗ.
async function konTrump() {
  const r = await getRoom();
  if (r.game?.stage !== 'kon_trump') return console.log(`Сейчас никто не выбирает козырь для КОНА, стадия: ${r.game?.stage}`);
  const b = botById(r.game.mains[0].playerId);
  if (!b) return console.log(`КОН у живого игрока (${r.game.mains[0].playerName}). Выбирай козырь в приложении.`);
  const suit = extra ?? flags.suit ?? r.game.razSuit;
  await post(`/rooms/${room}/kon-trump`, b.token, { suit });
  console.log(`${b.name} (КОН) назвал козырь: ${suit}`);
  await showState();
}

// Все боты, которые ещё не голосовали, голосуют одинаково.
// Сервер объявит итог, как только его нельзя будет изменить.
async function vote() {
  const choice = extra ?? flags.choice ?? 'continue';
  if (choice !== 'continue' && choice !== 'split') return console.log('Голос — continue или split');
  for (const b of bots) {
    const r = await getRoom();
    if (r.game?.stage !== 'vote') {
      console.log(`Голосования нет, стадия: ${r.game?.stage}`);
      break;
    }
    if (!r.players.some((p: any) => p.id === b.id)) continue;
    if (r.game.vote.votedIds.includes(b.id)) continue;
    await post(`/rooms/${room}/vote`, b.token, { choice });
    console.log(`${b.name} голосует: ${choice}`);
  }
  await showState();
}

// Начислить монеты: ./tools/garba coins <код игрока | bots> <сумма> (минус — списать).
// bots — всем шести ботам. Идёт через сервер (POST /admin/coins, только с этого компьютера).
async function coins() {
  const amount = Number(extra);
  if (!room || !Number.isInteger(amount)) {
    console.log('Использование: ./tools/garba coins <код игрока | bots> <сумма>');
    process.exit(1);
  }
  const targets = room === 'bots' ? (await loadBots()).map((b) => ({ id: b.id })) : [{ code: room }];
  for (const t of targets) {
    const r = await request('POST', '/admin/coins', undefined, { ...t, amount });
    console.log(`${r.name}: ${amount > 0 ? '+' : ''}${amount} → баланс ${r.balance}`);
  }
}

async function main() {
  if (command === 'offline') {
    console.log(stopOnline() ? 'Боты «отключились». Через 10 секунд — пауза, через 5 минут — конец игры.' : 'Боты и так не на связи.');
    return;
  }
  if (command === 'coins') return coins();
  bots = await loadBots();
  switch (command) {
    case 'join': return join();
    case 'state': return showState();
    case 'deal': return deal();
    case 'bid': return bid();
    case 'passall': return passAll();
    case 'playall': return playAll();
    case 'vote': return vote();
    case 'kontrump': return konTrump();
    case 'special': return special();
    case 'discard': return discard();
    case 'online':
      startOnline(room);
      return showState();
  }
}

main().catch((e) => {
  console.error(e instanceof HttpError ? e.message : e);
  process.exit(1);
});
