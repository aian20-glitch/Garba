// Держит ботов из tools/garba.ps1 и tools/garba «за столом» (этап 9.2).
//
// С этапа 9.2 игрок без открытого соединения через 10 секунд считается отключившимся,
// игра встаёт на паузу (RULES.md §13). Боты ходят редкими HTTP-запросами, поэтому
// им нужен кто-то, кто держит сокет открытым. Этот скрипт и держит — для каждого бота
// из tools/.bots.json, пока его не закроют (Ctrl+C или закрыть окно).
//
// Запуск: npm run bots -- 12345      (12345 — номер комнаты)
// tools\garba.ps1 join запускает его сам в отдельном окне, tools/garba join — в фоне.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const roomId = process.argv[2];
const base = process.env.GARBA_URL ?? 'http://127.0.0.1:3000';

if (!roomId) {
  console.error('Укажи номер комнаты: npm run bots -- 12345');
  process.exit(1);
}

const botsFile = fileURLToPath(new URL('../../tools/.bots.json', import.meta.url));
const bots = JSON.parse(readFileSync(botsFile, 'utf8').replace(/^﻿/, '')) as {
  id: string;
  name: string;
  token: string;
}[];

let lastPause = '';

for (const bot of bots) {
  const socket = io(base, { transports: ['websocket'], forceNew: true });
  socket.on('connect', () => socket.emit('watch', { roomId, token: bot.token }));
  socket.on('room_error', (e) => console.log(`${bot.name}: ${e.error}`));
  socket.on('room', (room) => {
    // Бот не из этой комнаты — соединение ему не нужно.
    if (!room.players.some((p: { id: string }) => p.id === bot.id)) {
      socket.close();
      return;
    }
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

console.log(`Боты держат соединение с комнатой ${roomId}. Закрыть — Ctrl+C.`);
