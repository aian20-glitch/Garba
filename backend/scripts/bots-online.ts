// Боты из tools/garba.ps1 и tools/garba за столом: держат соединение и играют сами.
//
// С этапа 9.2 игрок без открытого соединения через 10 секунд считается отключившимся,
// игра встаёт на паузу (RULES.md §13). Этот скрипт держит сокет каждому боту
// из tools/.bots.json и, пока его не закроют (Ctrl+C), ходит за ботов, когда их очередь:
// раздаёт, торгуется, ходит картами, голосует. С флагом --manual — только держит связь,
// а ходы делаются руками командами tools/garba.
//
// Запуск: npm run bots -- 12345 [--manual]      (12345 — номер комнаты)
// tools\garba.ps1 join запускает его сам в отдельном окне, tools/garba join — в фоне.
//
// Стратегии у ботов нет — это инструмент проверки, а не соперник. Правила решает сервер:
// бот выбирает только из того, что сервер ему разрешил (myAllowedBids, myPlayableCardIds…).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

type Bot = { id: string; name: string; token: string };
type Action = { path: string; body: unknown; say: string; delay: number };

const roomId = process.argv[2];
const manual = process.argv.includes('--manual');
const base = process.env.GARBA_URL ?? 'http://127.0.0.1:3000';

if (!roomId) {
  console.error('Укажи номер комнаты: npm run bots -- 12345');
  process.exit(1);
}

const botsFile = fileURLToPath(new URL('../../tools/.bots.json', import.meta.url));
const bots = JSON.parse(readFileSync(botsFile, 'utf8').replace(/^﻿/, '')) as Bot[];

// Паузы — чтобы живой игрок успевал видеть, что происходит за столом.
const STEP_MS = 1_200; // заявка, ход картой, голос
const DEAL_MS = 2_500; // раздача после вскрытия на туза или пересдачи
const NEXT_DEAL_MS = 10_000; // следующая раздача — сначала прочитать итог и отправить смайлик
const REDEAL_MS = 6_000; // пересдача после всеобщего ПАСа — прочитать, кто сколько долил

const card = (c: any) => `${c.rank} ${c.suit}`;

// Когда брать РАЗ: 3+ карты масти РАЗ или 2 со старшей (туз / король). Иначе ПАС.
// ДВА и КОН боты не говорят. Это не правило игры — просто чтобы боты иногда играли главными.
function wantsRaz(hand: any[], razSuit: string): boolean {
  const trumps = hand.filter((c) => c.suit === razSuit);
  return trumps.length >= 3 || (trumps.length >= 2 && trumps.some((c) => c.rank === 'A' || c.rank === 'K'));
}

// Что бот должен сделать в этом состоянии (он видит комнату своими глазами).
function nextAction(bot: Bot, room: any): Action | null {
  const at = `/rooms/${roomId}`;
  // Комнату создал бот (открытая комната для «Быстрой игры») — он и запускает игру,
  // как только все места заняты.
  if (room.status === 'lobby') {
    if (room.creatorId !== bot.id || room.players.length < room.capacity) return null;
    return { path: `${at}/start`, body: {}, say: 'начинает игру', delay: DEAL_MS };
  }
  const g = room.game;
  if (!g || room.status === 'finished' || room.pause) return null;

  // Кто-то предложил закончить игру (§12.3): боты согласны — решают живые игроки.
  // Пока голосование идёт, раздавать нельзя.
  if (g.endVote) {
    if (g.myEndVote) return null;
    return { path: `${at}/end-game`, body: { choice: 'yes' }, say: 'согласен закончить игру', delay: STEP_MS };
  }

  switch (g.stage) {
    case 'dealer_found':
    case 'awaiting_deal':
    case 'round_done':
      if (g.dealerId !== bot.id) return null;
      return {
        path: `${at}/dealer/continue`,
        body: {},
        say: 'раздаёт карты',
        delay: g.stage === 'round_done' ? NEXT_DEAL_MS : g.stage === 'awaiting_deal' ? REDEAL_MS : DEAL_MS,
      };

    case 'bidding': {
      const allowed: string[] = g.myAllowedBids ?? [];
      if (allowed.length === 0) return null;
      const bid = allowed.includes('РАЗ') && wantsRaz(g.hand, g.razSuit) ? 'РАЗ' : 'ПАС';
      return { path: `${at}/bid`, body: { bid }, say: `говорит ${bid}`, delay: STEP_MS };
    }

    case 'playing': {
      const cardId = g.myPlayableCardIds?.[0];
      if (!cardId) return null;
      const played = g.hand.find((c: any) => c.id === cardId);
      return {
        path: `${at}/play`,
        body: { cardId },
        say: `ходит ${card(played)}`,
        delay: STEP_MS,
      };
    }

    case 'special':
      // Спецкарту боты не берут — решает живой игрок. Очередь — по activeId:
      // mySpecialRisks бывает пуст и в свою очередь (не хватает монет ни на один риск),
      // а пас доступен всегда.
      if (g.special?.activeId !== bot.id) return null;
      return {
        path: `${at}/special`,
        body: { action: 'pass' },
        say: 'пасует за спецкарту',
        delay: STEP_MS,
      };

    case 'special_discard': {
      const cardId = g.myDiscardOptions?.[0];
      if (!cardId) return null;
      return { path: `${at}/discard`, body: { cardId }, say: 'сбрасывает карту', delay: STEP_MS };
    }

    case 'kon_trump': {
      const option = g.myKonTrumpOptions?.[0];
      if (!option) return null;
      return {
        path: `${at}/kon-trump`,
        body: { suit: option.suit },
        say: `называет козырь ${option.suit}`,
        delay: STEP_MS,
      };
    }

    case 'vote':
      // Делим только единогласно (§12.2): боты за «делим», решает живой игрок.
      if (g.myVote || !room.players.some((p: any) => p.id === bot.id)) return null;
      return { path: `${at}/vote`, body: { choice: 'split' }, say: 'голосует «делим»', delay: STEP_MS };
  }
  return null;
}

// Один бот: последнее состояние и отложенный ход. После своего хода бот ждёт свежую
// рассылку (сервер шлёт её после любого POST) — иначе по старому состоянию сходил бы дважды.
function playFor(bot: Bot) {
  let latest: any = null;
  let timer: NodeJS.Timeout | null = null;
  let busy = false;
  let waitingFresh = false;

  const consider = () => {
    if (manual || busy || waitingFresh || timer || !latest) return;
    const action = nextAction(bot, latest);
    if (!action) return;
    timer = setTimeout(async () => {
      timer = null;
      // За время паузы состояние могло измениться — берём свежее.
      const now = nextAction(bot, latest);
      if (!now) return;
      busy = true;
      try {
        const res = await fetch(base + now.path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bot.token}` },
          body: JSON.stringify(now.body),
        });
        if (res.ok) console.log(`${bot.name} ${now.say}`);
        else console.log(`${bot.name}: сервер отказал (${res.status}) — ${await res.text()}`);
      } catch {
        console.log(`${bot.name}: сервер не отвечает`);
      }
      busy = false;
      waitingFresh = true;
      // Рассылка не пришла (сокет отвалился) — через 3 секунды смотрим снова.
      setTimeout(() => {
        waitingFresh = false;
        consider();
      }, 3_000);
    }, action.delay);
  };

  return (room: any) => {
    latest = room;
    if (!busy) waitingFresh = false;
    consider();
  };
}

let lastPause = '';

for (const bot of bots) {
  const socket = io(base, { transports: ['websocket'], forceNew: true });
  const onRoom = playFor(bot);
  socket.on('connect', () => socket.emit('watch', { roomId, token: bot.token }));
  socket.on('room_error', (e) => console.log(`${bot.name}: ${e.error}`));
  socket.on('room', (room) => {
    // Бот не из этой комнаты — соединение ему не нужно.
    if (!room.players.some((p: { id: string }) => p.id === bot.id)) {
      socket.close();
      return;
    }
    onRoom(room);
    if (bot !== bots.find((b) => room.players.some((p: { id: string }) => p.id === b.id))) return;

    // Сообщаем о паузе один раз — от имени первого бота за столом.
    const pause = room.pause
      ? room.pause.players.map((p: { name: string }) => p.name).join(', ')
      : '';
    if (pause !== lastPause) {
      console.log(pause ? `ПАУЗА: отключился ${pause}` : 'Все за столом, игра идёт');
      lastPause = pause;
    }
    if (room.status === 'finished') {
      console.log('Комната закрыта — боты уходят.');
      process.exit(0);
    }
  });
}

console.log(
  manual
    ? `Боты держат соединение с комнатой ${roomId} (ходы — руками). Закрыть — Ctrl+C.`
    : `Боты за столом в комнате ${roomId} и играют сами. Закрыть — Ctrl+C.`,
);
