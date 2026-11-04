// Сервер игры ШАХ (SHAH_PLAN.md, этап 2, 04.11.2026): комнаты, лобби, «ГОТОВ», раздача, ходы,
// время на ход, отключение и пауза, время стола и продление, личная пауза, смайлики,
// боты-тренировка, монеты матча.
//
// Отдельно от комнат Гарбы: своя карта комнат, своя таблица shah_rooms, свои запросы /shah/...
// и сокет-события watch_shah → shah_room. Общее с Гарбой — аккаунты, кошелёк, бан за выход,
// блокировки, «одна комната за раз» (ctx из index.ts). Включается переменной GARBA_SHAH=1.
//
// Правила партии — движок (engine.ts), сервер его только вызывает: он — единственный источник
// истины, приложение лишь показывает состояние и присылает ходы. Чужие карты не уходят никому
// (view.ts). Ход по таймеру и ход бота идут тем же путём, что ход игрока (applyMove).

import type { DatabaseSync } from 'node:sqlite';
import type express from 'express';
import type { Server as SocketServer } from 'socket.io';
import {
  botAccounts,
  createAccount,
  findAccountByToken,
  getAccount,
  leaveRecordOf,
  markBot,
  setLeaveRecord,
  tokenFromHeader,
  transaction,
  type Account,
} from '../accounts.js';
import { shuffle } from '../deck.js';
import { nextLeaveBan } from '../leaveBan.js';
import { lobbyExpired, lobbySecondsLeft, LOBBY_MS } from '../lobbyTimer.js';
import { pauseRefusal, pauseSecondsLeft, pausesLeft, startPause, GAME_PAUSES, type PersonalPause } from '../personalPause.js';
import {
  absenceMsFor,
  absenceStep,
  presenceStep,
  touch,
  DISCONNECT_TIMEOUT_MS,
  OFFLINE_GRACE_MS,
  type PresenceState,
} from '../presence.js';
import { rateCheck } from '../rateLimit.js';
import { addReaction, type ReactionEntry } from '../reactions.js';
import { markReady, readyOutcome, readySecondsLeft, startReadyCheck, READY_MS, type ReadyCheck } from '../readyCheck.js';
import { freeBotName } from '../serverBots.js';
import { seatFor } from '../seats.js';
import { liveRoomsFor as liveRoomsForList, spectateRefusal } from '../spectators.js';
import { ask, cast, playedMs, remainingMs, roundDue, setRunning, settle, startClock, type TableClock } from '../tableTimer.js';
import {
  addMiss,
  clockFor,
  revealShowMs,
  turnMsFor,
  turnSecondsLeft,
  DEAL_CARD_MS,
  DEAL_OPENING_MS,
  type TurnClock,
} from '../turnTimer.js';
import { createShahDeck } from './cards.js';
import { chargeCoins, creditCoins, debitUpTo, ensureShahTables, loadUnfinishedShahRooms, saveShahRoom, shahRoomIdTaken } from './db.js';
import {
  act,
  awaitedOf,
  createMatch,
  isTeamFormat,
  sideOf,
  startParty,
  DEFAULT_SHAH_OPTIONS,
  HAND_SIZE,
  type ShahAction,
  type ShahFormat,
  type ShahMatch,
  type ShahOptions,
} from './engine.js';
import {
  botAction,
  checkShahSettings,
  matchDeltas,
  maxLoss,
  potPayouts,
  resultByLeaver,
  resultByTotals,
  seatOutcomes,
  timeoutAction,
  DEFAULT_MONEY_MODE,
  type MoneyMode,
  type SeatOutcome,
  type ShahSettings,
} from './rooms.js';
import type { SideResult } from './score.js';
import { shahView } from './view.js';

export type ShahPlayer = { id: string; name: string; seat: number; joinedAt: number; bot?: boolean };

export type ShahCloseReason =
  | 'match_over' // кто-то дошёл до −24
  | 'time_limit' // время стола вышло (вопрос 18)
  | 'player_left' // ушёл или не вернулся (вопрос 19)
  | 'lobby_timeout' // игра не началась за 10 минут
  | 'nobody_ready' // «ГОТОВ» не нажал никто
  | 'creator_left'; // создатель вышел из лобби

export type ShahRoom = {
  id: string;
  kind: 'shah';
  capacity: ShahFormat;
  creatorId: string;
  settings: ShahSettings;
  isPublic: boolean;
  options: ShahOptions; // варианты правил, с которыми создана комната (SHAH_RULES.md)
  moneyMode: MoneyMode; // вопрос 17
  players: ShahPlayer[]; // всегда по местам
  status: 'lobby' | 'started' | 'finished';
  createdAt: number;
  startedAt: number | null;
  readyCheck: ReadyCheck | null;
  readyDroppedIds: string[];
  practice: boolean; // за столом боты — монеты не двигаются
  botIds: string[];
  match: ShahMatch | null;
  charged: boolean; // взносы списаны (moneyMode 'pot')
  settled: boolean; // итог матча выплачен
  missed: Record<string, number>; // пропуски хода подряд (§13a)
  awayAt: Record<string, number>; // «ушёл» — два пропуска подряд
  absenceUsedMs: Record<string, number>;
  absenceFreeMs: Record<string, number>;
  clock: TableClock | null; // время стола (§20), с первой раздачи
  personalPause: (PersonalPause & { name: string }) | null; // §20a
  lastPersonalPause: { playerId: string; name: string; early: boolean } | null;
  pausesUsed: Record<string, number>;
  partyDoneAt: number | null; // когда кончилась последняя партия — итог на экране
  partyDoneFor: number | null; // номер этой партии
  dealShownAt: number | null; // когда в приложении закончится анимация раздачи
  result: {
    reason: ShahCloseReason;
    outcomes: Record<string, SeatOutcome>;
    deltas: Record<string, number>;
    leftIds: string[];
    totals: number[] | null;
  } | null;
  reactions: ReactionEntry[];
  version: number;
  finishedAt: number | null;
};

export type ShahContext = {
  app: express.Express;
  io: SocketServer;
  db: DatabaseSync;
  // Незаконченная комната Гарбы игрока — «одна комната за раз»; начата ли она — для зрителей (§18).
  garbaRoomOf: (accountId: string) => { id: string; status: string } | undefined;
  garbaIdTaken: (id: string) => boolean;
  banError: (accountId: string) => { error: string; secondsLeft: number; count: number } | null;
  avoidIds: (accountId: string) => Set<string>; // блокировки в обе стороны
  ownedPacks: (accountId: string) => string[]; // наборы смайликов из магазина
  lookOf: (accountId: string) => { avatar: string | null; frame: string | null; cardBack: string | null };
  ratingOf: (accountId: string) => number;
  notify?: (accountId: string, key: string, text: string, startParam?: string) => void;
  // Позвать друга за стол ШАХ (этап 3): приглашение — в общем списке /me → roomInvites (kind 'shah').
  invite: (from: Account, code: string, roomId: string, memberIds: string[]) => { status: number; body: Record<string, unknown> };
};

const env = (name: string, fallback: number) => (process.env[name] ? Number(process.env[name]) : fallback);
// Для проверок сроки укорачиваются теми же переменными, что у Гарбы.
const READY_WAIT_MS = env('GARBA_READY_MS', READY_MS);
const LOBBY_WAIT_MS = env('GARBA_LOBBY_MS', LOBBY_MS);
const GRACE_MS = env('GARBA_GRACE_MS', OFFLINE_GRACE_MS);
const TEST_ABSENCE_MS = process.env.GARBA_DISCONNECT_MS ? Number(process.env.GARBA_DISCONNECT_MS) : null;
const TEST_TURN_MS = process.env.GARBA_TURN_MS ? Number(process.env.GARBA_TURN_MS) : null;
const TABLE_MINUTE_MS = env('GARBA_TABLE_MINUTE_MS', 60_000);
const PAUSE_MS = env('GARBA_PERSONAL_PAUSE_MS', 10_000);
// После партии 3 секунды все смотрят итог — раздать нельзя (как §10.8 Гарбы).
export const PARTY_SHOW_MS = env('GARBA_SHAH_SHOW_MS', 3_000);
const BOT_DELAY_MS = env('GARBA_SHAH_BOT_MS', 900);
const BOT_TICK_MS = env('GARBA_SHAH_BOT_TICK_MS', 250); // как часто боты смотрят, не их ли ход
// Сколько идут анимации в приложении: вскрытие на туза и раздача. Пока они идут, часы хода и
// боты ждут (как в Гарбе, turnTimer.ts). Для проверок — GARBA_SHAH_ANIM_MS: обе столько.
const TEST_ANIM_MS = process.env.GARBA_SHAH_ANIM_MS ? Number(process.env.GARBA_SHAH_ANIM_MS) : null;
const revealMs = (cards: number) => TEST_ANIM_MS ?? revealShowMs(cards);
const dealAnimMs = (players: number) => TEST_ANIM_MS ?? DEAL_OPENING_MS + players * HAND_SIZE * DEAL_CARD_MS;
const UNLOAD_FINISHED_MS = 30 * 60_000;
const WATCH_LIMIT = [{ max: 10, windowMs: 10_000 }];
const TOURNAMENT_ROOM = 'tournament'; // комната сокетов экрана «ТУРНИР» (index.ts) — её не трогаем
const channel = (roomId: string) => `shah:${roomId}`;

// Коды ошибок движка: «не сейчас» — 409, «не так» — 400 (как /play в Гарбе).
const CONFLICT_ERRORS = ['not your turn', 'no party in progress', 'wrong move'];

export function registerShah(ctx: ShahContext) {
  const { app, io, db } = ctx;
  ensureShahTables(db);
  const rooms = new Map<string, ShahRoom>();
  const presence = new Map<string, PresenceState>();
  const absentSince = new Map<string, Record<string, number>>();
  const turnClocks = new Map<string, TurnClock>();
  const botDue = new Map<string, { key: string; at: number }>();

  for (const room of loadUnfinishedShahRooms<ShahRoom>(db)) {
    room.readyCheck = null; // после перезапуска «ГОТОВ» — заново
    rooms.set(room.id, room);
  }
  if (rooms.size > 0) console.log(`[SHAH] restored ${rooms.size} unfinished room(s)`);

  const log = (room: ShahRoom, text: string) => console.log(`[SHAH ${room.id}] ${text}`);

  // ——— поиск ———

  function roomOf(accountId: string): ShahRoom | undefined {
    for (const room of rooms.values()) {
      if (room.status !== 'finished' && room.players.some((p) => p.id === accountId)) return room;
    }
    return undefined;
  }

  function idTaken(id: string): boolean {
    return rooms.has(id) || shahRoomIdTaken(db, id);
  }

  function makeId(): string {
    let id = '';
    do id = String(Math.floor(10000 + Math.random() * 90000));
    while (idTaken(id) || ctx.garbaIdTaken(id));
    return id;
  }

  const humans = (room: ShahRoom) => room.players.filter((p) => !p.bot);
  const isMember = (room: ShahRoom, id: string) => room.players.some((p) => p.id === id);
  const sortSeats = (room: ShahRoom) => room.players.sort((a, b) => a.seat - b.seat);
  const absenceMsOf = (room: ShahRoom) => TEST_ABSENCE_MS ?? absenceMsFor(room.settings.absenceMinutes);
  const turnMsOf = (room: ShahRoom) => TEST_TURN_MS ?? turnMsFor(room.settings.turnSeconds);
  const lossOf = (room: ShahRoom) => maxLoss(room.capacity, room.settings.ante, room.moneyMode);

  type Stage = 'lobby' | 'awaiting_deal' | 'playing' | 'finished';
  function stageOf(room: ShahRoom): Stage {
    if (room.status === 'lobby') return 'lobby';
    if (room.status === 'finished') return 'finished';
    const party = room.match?.party;
    return party && party.phase !== 'done' ? 'playing' : 'awaiting_deal';
  }

  function dealerOf(room: ShahRoom): ShahPlayer | null {
    if (stageOf(room) !== 'awaiting_deal' || !room.match) return null;
    return room.players[room.match.dealerSeat] ?? null;
  }

  // ——— сохранение и рассылка ———

  // Комната и деньги её итога — одной транзакцией. Ошибку только пишем в журнал: вызывается
  // после ответа и из таймеров; комната цела в памяти, следующее сохранение запишет её целиком.
  function persist(room: ShahRoom) {
    room.version++;
    const settling = room.status === 'finished' && !!room.result && !!room.match && !room.settled && !room.practice;
    try {
      transaction(db, () => {
        if (settling) {
          applySettlement(room);
          room.settled = true;
        }
        saveShahRoom(db, room);
      });
    } catch (e) {
      if (settling) room.settled = false;
      console.error(`[SHAH ${room.id}] save to database failed:`, e);
    }
  }

  async function broadcast(roomId: string) {
    const room = rooms.get(roomId);
    if (!room) return;
    const sockets = await io.in(channel(roomId)).fetchSockets();
    for (const s of sockets) {
      const viewer = typeof s.data.playerId === 'string' ? (s.data.playerId as string) : null;
      const refusal = viewer ? watchRefusal(room, viewer) : null;
      if (refusal) {
        s.leave(channel(roomId));
        s.emit('shah_room_error', { error: refusal });
        continue;
      }
      s.emit('shah_room', publicRoom(room, viewer));
    }
  }

  function changed(room: ShahRoom) {
    persist(room);
    broadcast(room.id).catch((e) => console.error(`[SHAH ${room.id}] broadcast failed:`, e));
  }

  const blockedWith = (room: ShahRoom, viewer: string) => {
    const avoid = ctx.avoidIds(viewer);
    return room.players.some((p) => avoid.has(p.id));
  };

  // ——— присутствие (§13) ———

  function presenceOf(roomId: string): PresenceState {
    return presence.get(roomId) ?? { lastSeen: {}, disconnectedAt: {} };
  }

  function connectedIds(room: ShahRoom): string[] {
    const ids: string[] = [];
    for (const socketId of io.sockets.adapter.rooms.get(channel(room.id)) ?? []) {
      const id = io.sockets.sockets.get(socketId)?.data.playerId;
      if (typeof id === 'string') ids.push(id);
    }
    return [...ids, ...room.botIds];
  }

  const tracksPresence = (room: ShahRoom) => room.status === 'started';

  function absentIds(room: ShahRoom): string[] {
    const { disconnectedAt } = presenceOf(room.id);
    return room.players.map((p) => p.id).filter((id) => disconnectedAt[id] !== undefined || room.awayAt[id] !== undefined);
  }

  const isPaused = (room: ShahRoom) => tracksPresence(room) && absentIds(room).length > 0;

  function markBack(room: ShahRoom, playerId: string) {
    const wasAway = room.awayAt[playerId] !== undefined;
    room.missed[playerId] = 0;
    delete room.awayAt[playerId];
    if (wasAway) log(room, `${nameOf(room, playerId)} вернулся`);
    return wasAway;
  }

  const nameOf = (room: ShahRoom, id: string) => room.players.find((p) => p.id === id)?.name ?? id;

  // Код игрока — для его карточки из-за стола (в друзья, подарок). Код не меняется — помним.
  const codes = new Map<string, string>();
  function codeOf(id: string): string | null {
    const known = codes.get(id);
    if (known) return known;
    const code = getAccount(db, id)?.code ?? null;
    if (code) codes.set(id, code);
    return code;
  }

  // Сам сидит в другой начатой игре (Гарбы или ШАХ) — смотреть чужой стол нельзя: свой встал
  // бы на паузу (§18 Гарбы, «зрители — как в Гарбе»).
  function playingElsewhere(accountId: string, room: ShahRoom): boolean {
    if (ctx.garbaRoomOf(accountId)?.status === 'started') return true;
    const other = roomOf(accountId);
    return other !== undefined && other.id !== room.id && other.status === 'started';
  }

  // Почему этому аккаунту нельзя смотреть стол; null — можно (или он за столом).
  function watchRefusal(room: ShahRoom, accountId: string): string | null {
    if (isMember(room, accountId)) return null;
    if (blockedWith(room, accountId)) return 'blocked';
    return spectateRefusal({ member: false, status: room.status, playingElsewhere: playingElsewhere(accountId, room), blocked: false });
  }

  // ——— начало матча ———

  function startMatch(room: ShahRoom) {
    // «а» вопроса 17: взнос списывается при старте. Кому не хватает — выходит из лобби.
    if (!room.practice && room.moneyMode === 'pot') {
      const poor = humans(room).filter((p) => (getAccount(db, p.id)?.balance ?? 0) < room.settings.ante);
      if (poor.length > 0) {
        room.players = room.players.filter((p) => !poor.some((x) => x.id === p.id));
        room.readyCheck = null;
        room.readyDroppedIds = poor.map((p) => p.id);
        if (poor.some((p) => p.id === room.creatorId)) room.creatorId = humans(room)[0]?.id ?? '';
        log(room, `не хватает монет на взнос — вышли: ${poor.map((p) => p.name).join(', ')}`);
        if (!room.creatorId) closeLobby(room, 'creator_left');
        return;
      }
    }
    sortSeats(room);
    const now = Date.now();
    const before = { status: room.status, match: room.match, charged: room.charged, readyCheck: room.readyCheck };
    room.match = createMatch(room.players.map((p) => p.id), shuffle(createShahDeck()), room.options);
    room.status = 'started';
    room.startedAt = now;
    room.readyCheck = null;
    room.readyDroppedIds = [];
    room.version++;
    try {
      transaction(db, () => {
        if (!room.practice && room.moneyMode === 'pot') {
          for (const p of humans(room)) {
            if (!chargeCoins(db, p.id, room.settings.ante)) throw new Error(`not enough coins: ${p.name}`);
          }
          room.charged = true;
        }
        saveShahRoom(db, room);
      });
    } catch (e) {
      Object.assign(room, before);
      room.charged = before.charged;
      console.error(`[SHAH ${room.id}] start failed:`, e);
      return;
    }
    const dealer = room.players[room.match.dealerSeat];
    log(room, `МАТЧ НАЧАЛСЯ, ${room.capacity} игроков, взнос ${room.settings.ante}, первый сдающий ${dealer.name}`);
    broadcast(room.id).catch((e) => console.error(`[SHAH ${room.id}] broadcast failed:`, e));
  }

  // ——— конец ———

  function closeLobby(room: ShahRoom, reason: ShahCloseReason) {
    room.status = 'finished';
    room.finishedAt = Date.now();
    room.readyCheck = null;
    room.result = { reason, outcomes: {}, deltas: {}, leftIds: [], totals: null };
    log(room, `лобби закрыто: ${reason}`);
  }

  // Конец матча: sides — итог сторон (null — ничья). Деньги пишутся в persist, одной транзакцией.
  function finishMatch(room: ShahRoom, reason: ShahCloseReason, sides: SideResult[] | null, leftIds: string[] = []) {
    if (room.status !== 'started' || !room.match) return;
    const ids = room.match.players;
    const outcomes = seatOutcomes(room.capacity, sides);
    const deltas = matchDeltas(room.capacity, room.settings.ante, room.moneyMode, outcomes);
    room.status = 'finished';
    room.finishedAt = Date.now();
    room.personalPause = null;
    room.result = {
      reason,
      outcomes: Object.fromEntries(ids.map((id, i) => [id, outcomes[i]])),
      deltas: Object.fromEntries(ids.map((id, i) => [id, deltas[i]])),
      leftIds,
      totals: [...room.match.totals],
    };
    turnClocks.delete(room.id);
    const text = ids.map((id, i) => `${nameOf(room, id)} ${outcomes[i]} ${deltas[i] >= 0 ? '+' : ''}${deltas[i]}`).join(', ');
    log(room, `МАТЧ ОКОНЧЕН (${reason}${room.practice ? ', тренировка' : ''}): ${text}`);
  }

  // Выплата итога (внутри транзакции persist). «а»: банк — победителям; «б»: проигравший платит
  // каждому победителю, сколько есть (в минус счёт не уходит).
  function applySettlement(room: ShahRoom) {
    const r = room.result!;
    const ids = room.match!.players;
    const ante = room.settings.ante;
    if (room.moneyMode === 'pot') {
      if (!room.charged) return;
      const payouts = potPayouts(room.capacity, ante, ids.map((id) => r.outcomes[id]));
      ids.forEach((id, i) => {
        if (payouts[i] > 0) creditCoins(db, id, payouts[i]);
      });
      return;
    }
    const winners = ids.filter((id) => r.outcomes[id] === 'win');
    const losers = ids.filter((id) => r.outcomes[id] === 'lose');
    if (winners.length === 0 || losers.length === 0) return;
    const actual: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
    for (const loser of losers) {
      const taken = debitUpTo(db, loser, ante * winners.length);
      actual[loser] -= taken;
      const each = Math.floor(taken / winners.length);
      for (const w of winners) {
        creditCoins(db, w, each);
        actual[w] += each;
      }
    }
    r.deltas = actual;
  }

  // После любого изменения матча: партия кончилась — запомнить; матч окончен или время вышло — закрыть.
  function afterMatchChange(room: ShahRoom) {
    const match = room.match!;
    const party = match.party;
    if (party?.phase === 'done' && room.partyDoneFor !== party.number) {
      room.partyDoneFor = party.number;
      room.partyDoneAt = Date.now();
      const res = party.result!;
      log(room, `партия ${res.number}: очки ${res.points.join(':')}, штрафы ${res.penalties.join('/')}, счёт ${res.totals.join('/')}${res.draw ? ', ничья — следующая ×' + match.multiplier : ''}`);
    }
    if (match.over) return finishMatch(room, 'match_over', match.result);
    if (party?.phase === 'done' && room.clock?.reached) return finishMatch(room, 'time_limit', resultByTotals(match.totals));
  }

  // Ушёл (сам или кончился запас на отлучку): его сторона проиграла матч (вопрос 19 «а»).
  function leaveMatch(room: ShahRoom, leaverIds: string[], voluntary: boolean) {
    const seats = leaverIds.map((id) => room.match!.players.indexOf(id)).filter((s) => s >= 0);
    if (voluntary && !room.practice) {
      for (const id of leaverIds) setLeaveRecord(db, id, nextLeaveBan(leaveRecordOf(db, id), Date.now()));
    }
    log(room, `${leaverIds.map((id) => nameOf(room, id)).join(', ')} ${voluntary ? 'вышел' : 'не вернулся'} — его сторона проиграла`);
    finishMatch(room, 'player_left', resultByLeaver(room.capacity, seats), leaverIds);
  }

  // ——— ходы ———

  type Result = { status: number; body: Record<string, unknown> };

  function deal(room: ShahRoom, playerId: string): Result {
    if (stageOf(room) !== 'awaiting_deal') return { status: 409, body: { error: 'not time to deal' } };
    const dealer = dealerOf(room)!;
    if (dealer.id !== playerId) return { status: 403, body: { error: 'only dealer can deal', dealerId: dealer.id } };
    const showLeft = (room.partyDoneAt ?? 0) + PARTY_SHOW_MS - Date.now();
    if (room.match!.party && showLeft > 0) return { status: 409, body: { error: 'party result on show', msLeft: showLeft } };
    if (room.personalPause) return { status: 409, body: { error: 'personal pause in progress' } };
    if (room.clock?.reached) return { status: 409, body: { error: 'time is up' } };
    const now = Date.now();
    room.match = startParty(room.match!, shuffle(createShahDeck()));
    room.dealShownAt = now + dealAnimMs(room.capacity);
    if (!room.clock && room.settings.timeLimitMinutes) room.clock = startClock(room.settings.timeLimitMinutes, now, TABLE_MINUTE_MS);
    const party = room.match.party!;
    log(room, `партия ${party.number}: сдаёт ${dealer.name}, козырь ${party.trump}`);
    return { status: 200, body: {} };
  }

  function applyMove(room: ShahRoom, playerId: string, action: ShahAction): Result {
    if (room.status !== 'started' || !room.match) return { status: 409, body: { error: 'game not started' } };
    const r = act(room.match, playerId, action);
    if (!r.ok) return { status: CONFLICT_ERRORS.includes(r.error) ? 409 : 400, body: { ...r } };
    room.match = r.match;
    afterMatchChange(room);
    return { status: 200, body: {} };
  }

  // Что сервер сейчас ждёт и от кого — для часов хода, таймера и ботов.
  function awaited(room: ShahRoom): { key: string; playerId: string; deal: boolean; startAt: number } | null {
    if (room.status !== 'started' || !room.match || isPaused(room) || room.personalPause) return null;
    const match = room.match;
    if (stageOf(room) === 'awaiting_deal') {
      const dealer = dealerOf(room)!;
      const first = match.party === null;
      const startAt = first
        ? (room.startedAt ?? 0) + revealMs(match.firstDealer.reveals.length)
        : (room.partyDoneAt ?? 0) + PARTY_SHOW_MS;
      return { key: `deal:${match.history.length + 1}`, playerId: dealer.id, deal: true, startAt };
    }
    const aw = awaitedOf(match);
    if (!aw) return null;
    const p = match.party!;
    const key = `move:${p.number}:${p.tricksPlayed}:${p.trick?.moves.length ?? 0}:${aw.seat}:${aw.awaiting}`;
    return { key, playerId: aw.playerId, deal: false, startAt: room.dealShownAt ?? 0 };
  }

  // ——— состояние для игрока ———

  function publicRoom(room: ShahRoom, viewerId: string | null) {
    const now = Date.now();
    const seated = viewerId !== null && isMember(room, viewerId);
    const stage = stageOf(room);
    const a = awaited(room);
    const clock = turnClocks.get(room.id);
    const turnLeft = a && clock && clock.key === a.key ? turnSecondsLeft(clock, now, turnMsOf(room)) : null;
    const { disconnectedAt } = presenceOf(room.id);
    const absence = tracksPresence(room)
      ? absenceStep(room.players.map((p) => p.id), absentIds(room), absentSince.get(room.id) ?? {}, room.absenceUsedMs, now, absenceMsOf(room), room.absenceFreeMs)
      : null;
    const paused = absence && absentIds(room).length > 0
      ? {
          players: absentIds(room).map((id) => ({
            id,
            name: nameOf(room, id),
            reason: disconnectedAt[id] !== undefined ? 'offline' : 'away',
            secondsLeft: Math.ceil((absence.msLeft[id] ?? 0) / 1000),
          })),
        }
      : null;
    const avoid = viewerId ? ctx.avoidIds(viewerId) : new Set<string>();
    const voters = humans(room).map((p) => p.id);
    const vote = room.clock?.vote ?? null;
    const showLeft = room.match?.party ? Math.max(0, (room.partyDoneAt ?? 0) + PARTY_SHOW_MS - now) : 0;
    const pauseUsed = viewerId ? (room.pausesUsed[viewerId] ?? 0) : 0;

    return {
      kind: 'shah' as const,
      id: room.id,
      capacity: room.capacity,
      teams: isTeamFormat(room.capacity),
      status: room.status,
      stage,
      creatorId: room.creatorId,
      isPublic: room.isPublic,
      practice: room.practice,
      settings: room.settings,
      options: room.options,
      money: {
        mode: room.moneyMode,
        ante: room.settings.ante,
        pot: room.moneyMode === 'pot' && room.charged ? room.settings.ante * room.capacity : 0,
        maxLoss: lossOf(room),
      },
      players: room.players.map((p) => ({
        id: p.id,
        name: p.name,
        code: codeOf(p.id),
        seat: p.seat,
        side: sideOf(room.capacity, p.seat),
        bot: !!p.bot,
        ready: room.readyCheck?.readyIds.includes(p.id) ?? false,
        rating: ctx.ratingOf(p.id),
        ...ctx.lookOf(p.id),
      })),
      readyCheck: room.readyCheck
        ? { secondsLeft: readySecondsLeft(room.readyCheck, now, READY_WAIT_MS), readyIds: room.readyCheck.readyIds }
        : null,
      readyDroppedIds: room.readyDroppedIds,
      lobbySecondsLeft: room.status === 'lobby' ? lobbySecondsLeft(room.createdAt, now, LOBBY_WAIT_MS) : null,
      dealerId: dealerOf(room)?.id ?? null,
      partyShowLeftMs: showLeft,
      // Вскрытие на туза в начале матча: сколько ещё идёт анимация (открыл стол позже — догоняет).
      revealShowLeftMs:
        room.status === 'started' && room.match && !room.match.party
          ? Math.max(0, (room.startedAt ?? 0) + revealMs(room.match.firstDealer.reveals.length) - now)
          : 0,
      dealShowLeftMs: Math.max(0, (room.dealShownAt ?? 0) - now),
      awaitedIds: a ? [a.playerId] : [],
      turnSecondsLeft: turnLeft,
      pause: paused,
      tableClock: room.clock
        ? {
            minutes: room.clock.minutes,
            limitMs: room.clock.limitMs,
            playedMs: playedMs(room.clock, now),
            secondsLeft: Math.ceil(remainingMs(room.clock, now) / 1000),
            paused: room.clock.runningSince === null,
            extensions: room.clock.extensions,
            reached: room.clock.reached,
            vote: vote
              ? { forEndsAt: vote.forEndsAt, round: vote.round, votedCount: vote.yes.length + vote.no.length, voterCount: voters.length }
              : null,
            lastVote: room.clock.lastVote,
          }
        : null,
      myExtendVote: vote && viewerId ? (vote.yes.includes(viewerId) ? 'yes' : vote.no.includes(viewerId) ? 'no' : null) : null,
      myCanVoteExtend: !!vote && !!viewerId && voters.includes(viewerId) && !vote.yes.includes(viewerId) && !vote.no.includes(viewerId),
      personalPause: room.personalPause
        ? { playerId: room.personalPause.playerId, name: room.personalPause.name, secondsLeft: pauseSecondsLeft(room.personalPause, now) }
        : null,
      lastPersonalPause: room.lastPersonalPause,
      pauseLimit: GAME_PAUSES,
      myPausesLeft: seated ? pausesLeft(pauseUsed, false) : 0,
      myCanPause: seated && viewerId !== null && pauseRefusalFor(room, viewerId) === null,
      game: room.match ? shahView(room.match, seated ? viewerId : null) : null,
      result: room.result,
      reactions: room.reactions.filter((r) => !avoid.has(r.playerId)),
      spectators: spectatorsOf(room),
      version: room.version,
      lobbyTimedOut: room.result?.reason === 'lobby_timeout',
    };
  }

  function spectatorsOf(room: ShahRoom): number {
    const ids = new Set<string>();
    for (const socketId of io.sockets.adapter.rooms.get(channel(room.id)) ?? []) {
      const id = io.sockets.sockets.get(socketId)?.data.playerId;
      if (typeof id === 'string' && !isMember(room, id)) ids.add(id);
    }
    return room.status === 'lobby' ? 0 : ids.size;
  }

  function pauseRefusalFor(room: ShahRoom, playerId: string) {
    const player = room.players.find((p) => p.id === playerId);
    return pauseRefusal({
      betweenDeals: stageOf(room) === 'awaiting_deal',
      seated: !!player,
      bot: !!player?.bot,
      gone: false,
      roomPaused: isPaused(room),
      activePause: !!room.personalPause,
      voteActive: false,
      timeUp: !!room.clock?.reached,
      used: room.pausesUsed[playerId] ?? 0,
      tournament: false,
    });
  }

  // ——— вход в комнату ———

  function busyError(accountId: string): Result | null {
    const garba = ctx.garbaRoomOf(accountId);
    if (garba) return { status: 409, body: { error: 'already in another room', roomId: garba.id, kind: 'garba' } };
    const shah = roomOf(accountId);
    if (shah) return { status: 409, body: { error: 'already in another room', roomId: shah.id, kind: 'shah' } };
    const ban = ctx.banError(accountId);
    if (ban) return { status: 403, body: { ...ban } };
    return null;
  }

  function moneyError(account: Account, room: { capacity: ShahFormat; settings: ShahSettings; moneyMode: MoneyMode }): Result | null {
    const need = maxLoss(room.capacity, room.settings.ante, room.moneyMode);
    if (account.balance < need) return { status: 403, body: { error: 'not enough coins to enter', need, balance: account.balance } };
    return null;
  }

  function join(room: ShahRoom, account: Account, wantedSeat?: unknown, bot = false): Result {
    if (isMember(room, account.id)) return { status: 200, body: publicRoom(room, account.id) };
    if (room.status !== 'lobby') return { status: 409, body: { error: room.status === 'finished' ? 'room finished' : 'game already started' } };
    const wanted = wantedSeat === undefined || wantedSeat === null ? undefined : Number(wantedSeat);
    if (wanted !== undefined && (!Number.isInteger(wanted) || wanted < 0 || wanted >= room.capacity)) {
      return { status: 400, body: { error: 'bad seat' } };
    }
    const seat = seatFor(room.players.map((p) => p.seat), room.capacity, wanted);
    if (seat === null) return { status: 409, body: { error: room.players.length >= room.capacity ? 'room is full' : 'seat taken' } };
    if (!bot) {
      const busy = busyError(account.id);
      if (busy) return busy;
      if (blockedWith(room, account.id)) return { status: 403, body: { error: 'blocked' } };
      const poor = moneyError(account, room);
      if (poor) return poor;
    }
    room.players.push({ id: account.id, name: account.name, seat, joinedAt: Date.now(), bot: bot || undefined });
    sortSeats(room);
    log(room, `${account.name} сел на место ${seat} — ${room.players.length}/${room.capacity}`);
    return { status: 200, body: publicRoom(room, account.id) };
  }

  function makeRoom(account: Account, capacity: ShahFormat, settings: ShahSettings, isPublic: boolean): ShahRoom {
    const room: ShahRoom = {
      id: makeId(),
      kind: 'shah',
      capacity,
      creatorId: account.id,
      settings,
      isPublic,
      options: { ...DEFAULT_SHAH_OPTIONS },
      moneyMode: DEFAULT_MONEY_MODE,
      players: [{ id: account.id, name: account.name, seat: 0, joinedAt: Date.now() }],
      status: 'lobby',
      createdAt: Date.now(),
      startedAt: null,
      readyCheck: null,
      readyDroppedIds: [],
      practice: false,
      botIds: [],
      match: null,
      charged: false,
      settled: false,
      missed: {},
      awayAt: {},
      absenceUsedMs: {},
      absenceFreeMs: {},
      clock: null,
      personalPause: null,
      lastPersonalPause: null,
      pausesUsed: {},
      partyDoneAt: null,
      partyDoneFor: null,
      dealShownAt: null,
      result: null,
      reactions: [],
      version: 0,
      finishedAt: null,
    };
    rooms.set(room.id, room);
    log(room, `создана: ${capacity} игроков, взнос ${settings.ante}${isPublic ? ', открытая' : ''}`);
    return room;
  }

  // ——— HTTP ———

  const me = (res: express.Response) => res.locals.shahAccount as Account;

  app.use('/shah', (req, res, next) => {
    const account = findAccountByToken(db, tokenFromHeader(req.headers.authorization));
    if (!account) return res.status(401).json({ error: 'unauthorized' });
    res.locals.shahAccount = account;
    next();
  });

  // Запрос игрока к своей комнате — знак, что он на месте; любой его POST — что он за столом:
  // пропуски хода с нуля, «ушёл» снимается (§13a). После POST — сохранить и разослать.
  app.use('/shah/rooms/:id', (req, res, next) => {
    const room = rooms.get(req.params.id);
    if (!room) return next();
    const id = me(res).id;
    if (isMember(room, id) && tracksPresence(room)) {
      presence.set(room.id, touch(presenceOf(room.id), id, Date.now()));
      if (req.method === 'POST') markBack(room, id);
    }
    if (req.method === 'POST') res.on('finish', () => changed(room));
    next();
  });

  const roomFor = (req: express.Request, res: express.Response): ShahRoom | null => {
    const room = rooms.get(String(req.params.id));
    if (!room) {
      res.status(404).json({ error: 'room not found' });
      return null;
    }
    return room;
  };
  const send = (res: express.Response, result: Result) => res.status(result.status).json(result.body);
  const seatedOrRefuse = (room: ShahRoom, res: express.Response): boolean => {
    if (isMember(room, me(res).id)) return true;
    res.status(403).json({ error: 'player is not in this room' });
    return false;
  };
  const pausedOrNot = (room: ShahRoom, res: express.Response): boolean => {
    if (!isPaused(room)) return false;
    res.status(409).json({ error: 'game paused' });
    return true;
  };

  app.post('/shah/rooms', (req, res) => {
    const account = me(res);
    const check = checkShahSettings(req.body);
    if (!check.ok) return res.status(400).json(check);
    const busy = busyError(account.id);
    if (busy) return send(res, busy);
    const poor = moneyError(account, { capacity: check.capacity, settings: check.settings, moneyMode: DEFAULT_MONEY_MODE });
    if (poor) return send(res, poor);
    const room = makeRoom(account, check.capacity, check.settings, check.isPublic);
    persist(room);
    return res.status(201).json(publicRoom(room, account.id));
  });

  function openRoomsFor(account: Account, capacity?: number) {
    const avoid = ctx.avoidIds(account.id);
    return [...rooms.values()]
      .filter((r) => r.status === 'lobby' && r.isPublic && !r.practice && r.players.length < r.capacity)
      .filter((r) => capacity === undefined || r.capacity === capacity)
      .filter((r) => !r.players.some((p) => avoid.has(p.id) || p.id === account.id))
      .filter((r) => account.balance >= lossOf(r))
      .sort((a, b) => b.players.length / b.capacity - a.players.length / a.capacity || a.createdAt - b.createdAt);
  }

  app.get('/shah/rooms/open', (_req, res) => {
    const account = me(res);
    return res.json({
      rooms: openRoomsFor(account).slice(0, 30).map((r) => ({
        id: r.id,
        capacity: r.capacity,
        players: r.players.length,
        creatorName: r.players.find((p) => p.id === r.creatorId)?.name ?? '',
        settings: r.settings,
        money: { mode: r.moneyMode, ante: r.settings.ante, maxLoss: lossOf(r) },
      })),
      live: liveRoomsFor(account),
    });
  });

  // Идущие матчи — смотреть (как «ИДУТ СЕЙЧАС» Гарбы, §18): все начатые, и открытые, и по коду;
  // без моих и без тех, где игрок, с которым у меня блок. Больше зрителей — выше.
  function liveRoomsFor(account: Account) {
    return liveRoomsForList(
      [...rooms.values()].map((r) => ({
        room: r,
        id: r.id,
        status: r.status,
        memberIds: r.players.map((p) => p.id),
        spectators: spectatorsOf(r),
        createdAt: r.createdAt,
      })),
      account.id,
      ctx.avoidIds(account.id),
    ).map(({ room, spectators }) => ({
      id: room.id,
      capacity: room.capacity,
      players: room.players.length,
      names: room.players.map((p) => p.name),
      creatorName: room.players.find((p) => p.id === room.creatorId)?.name ?? '',
      settings: room.settings,
      practice: room.practice,
      partyNumber: room.match?.party?.number ?? 0,
      totals: room.match?.totals ?? [],
      spectators,
    }));
  }

  // «Быстрая игра»: сесть в самую заполненную открытую комнату (того же размера, если прислали),
  // нет такой — создать открытую: capacity (без него — 4), взнос 100.
  app.post('/shah/rooms/quick', (req, res) => {
    const account = me(res);
    const raw = req.body?.capacity;
    const capacity = raw === undefined ? undefined : Number(raw);
    if (capacity !== undefined && !SHAH_SIZES.includes(capacity)) return res.status(400).json({ error: 'bad capacity' });
    const busy = busyError(account.id);
    if (busy) return send(res, busy);
    const open = openRoomsFor(account, capacity)[0];
    if (open) return send(res, join(open, account));
    const check = checkShahSettings({ capacity: capacity ?? 4, ante: 100, isPublic: true });
    if (!check.ok) return res.status(500).json(check);
    const poor = moneyError(account, { capacity: check.capacity, settings: check.settings, moneyMode: DEFAULT_MONEY_MODE });
    if (poor) return send(res, poor);
    const room = makeRoom(account, check.capacity, check.settings, true);
    persist(room);
    return res.status(201).json(publicRoom(room, account.id));
  });

  app.get('/shah/rooms/:id', (req, res) => {
    const room = roomFor(req, res);
    if (!room) return;
    const id = me(res).id;
    const refusal = watchRefusal(room, id);
    if (refusal) return res.status(403).json({ error: refusal });
    return res.json(publicRoom(room, id));
  });

  // Позвать друга за стол (как в Гарбе, 25.09.2026): только из лобби со свободным местом.
  // Друг увидит приглашение на главном экране (/me → roomInvites, kind 'shah').
  app.post('/shah/rooms/:id/invite', (req, res) => {
    const room = roomFor(req, res);
    if (!room || !seatedOrRefuse(room, res)) return;
    if (room.status !== 'lobby' || room.players.length >= room.capacity) return res.status(409).json({ error: 'no free seat' });
    return send(res, ctx.invite(me(res), String(req.body?.code ?? ''), room.id, room.players.map((p) => p.id)));
  });

  app.post('/shah/rooms/:id/join', (req, res) => {
    const room = roomFor(req, res);
    if (!room) return;
    return send(res, join(room, me(res), req.body?.seat));
  });

  app.post('/shah/rooms/:id/seat', (req, res) => {
    const room = roomFor(req, res);
    if (!room || !seatedOrRefuse(room, res)) return;
    if (room.status !== 'lobby') return res.status(409).json({ error: 'game already started' });
    const seat = Number(req.body?.seat);
    if (!Number.isInteger(seat) || seat < 0 || seat >= room.capacity) return res.status(400).json({ error: 'bad seat' });
    if (room.players.some((p) => p.seat === seat)) return res.status(409).json({ error: 'seat taken' });
    room.players.find((p) => p.id === me(res).id)!.seat = seat;
    sortSeats(room);
    room.readyCheck = null;
    return res.json(publicRoom(room, me(res).id));
  });

  app.post('/shah/rooms/:id/visibility', (req, res) => {
    const room = roomFor(req, res);
    if (!room) return;
    if (room.creatorId !== me(res).id) return res.status(403).json({ error: 'only creator can change visibility' });
    if (room.status !== 'lobby') return res.status(409).json({ error: 'game already started' });
    room.isPublic = req.body?.isPublic === true;
    return res.json(publicRoom(room, me(res).id));
  });

  app.post('/shah/rooms/:id/leave', (req, res) => {
    const room = roomFor(req, res);
    if (!room) return;
    const id = me(res).id;
    if (!isMember(room, id) || room.status === 'finished') return res.json({ left: true });
    if (room.status === 'lobby') {
      room.players = room.players.filter((p) => p.id !== id);
      room.readyCheck = null;
      log(room, `${me(res).name} вышел из лобби`);
      if (id === room.creatorId || humans(room).length === 0) closeLobby(room, 'creator_left');
      return res.json({ left: true });
    }
    // Начатый матч — только между партиями (как в Гарбе §13b); сторона ушедшего проигрывает.
    if (stageOf(room) !== 'awaiting_deal') return res.status(409).json({ error: 'can leave only between deals' });
    leaveMatch(room, [id], true);
    return res.json({ left: true });
  });

  app.post('/shah/rooms/:id/ready', (req, res) => {
    const room = roomFor(req, res);
    if (!room) return;
    if (room.status === 'started') return res.json(publicRoom(room, me(res).id));
    if (room.status !== 'lobby') return res.status(409).json({ error: 'room finished' });
    if (!seatedOrRefuse(room, res)) return;
    if (!room.readyCheck) return res.status(409).json({ error: 'room is not full', players: room.players.length, capacity: room.capacity });
    room.readyCheck = markReady(room.readyCheck, me(res).id);
    settleReady(room);
    return res.json(publicRoom(room, me(res).id));
  });

  // «ДОБАВИТЬ БОТОВ» — только создатель, только в лобби. Комната с ботами — тренировка:
  // монеты не двигаются (как в Гарбе, решение владельца 28.09.2026).
  app.post('/shah/rooms/:id/bots', (req, res) => {
    const room = roomFor(req, res);
    if (!room) return;
    if (room.creatorId !== me(res).id) return res.status(403).json({ error: 'only creator can add bots' });
    if (room.status !== 'lobby') return res.status(409).json({ error: 'game already started' });
    if (room.players.length >= room.capacity) return res.status(409).json({ error: 'room is full' });
    const pool = botAccounts(db).filter((b) => !roomOf(b.id) && !ctx.garbaRoomOf(b.id));
    while (room.players.length < room.capacity) {
      const taken = room.players.map((p) => p.name);
      let bot = pool.find((b) => !taken.includes(b.name));
      if (bot) pool.splice(pool.indexOf(bot), 1);
      else {
        bot = createAccount(db, freeBotName(taken)).account;
        markBot(db, bot.id);
      }
      const joined = join(room, bot, undefined, true);
      if (joined.status !== 200) break;
      room.botIds.push(bot.id);
    }
    room.practice = true;
    log(room, `${me(res).name} добавил ботов — тренировка`);
    return res.json(publicRoom(room, me(res).id));
  });

  app.post('/shah/rooms/:id/deal', (req, res) => {
    const room = roomFor(req, res);
    if (!room || !seatedOrRefuse(room, res) || pausedOrNot(room, res)) return;
    const result = deal(room, me(res).id);
    return result.status === 200 ? res.json(publicRoom(room, me(res).id)) : send(res, result);
  });

  // Ход: { type: lead | beat | closed, cardIds, targetIds? } — всё проверяет движок.
  app.post('/shah/rooms/:id/move', (req, res) => {
    const room = roomFor(req, res);
    if (!room || !seatedOrRefuse(room, res) || pausedOrNot(room, res)) return;
    const type = req.body?.type;
    if (type !== 'lead' && type !== 'beat' && type !== 'closed') return res.status(400).json({ error: 'bad move type' });
    const action = { type, cardIds: req.body?.cardIds, targetIds: req.body?.targetIds } as ShahAction;
    const result = applyMove(room, me(res).id, action);
    return result.status === 200 ? res.json(publicRoom(room, me(res).id)) : send(res, result);
  });

  // «Я ЗДЕСЬ» — разрешён и на паузе; сам факт запроса уже вернул игрока (middleware выше).
  app.post('/shah/rooms/:id/back', (req, res) => {
    const room = roomFor(req, res);
    if (!room || !seatedOrRefuse(room, res)) return;
    return res.json(publicRoom(room, me(res).id));
  });

  app.post('/shah/rooms/:id/extend-vote', (req, res) => {
    const room = roomFor(req, res);
    if (!room || !seatedOrRefuse(room, res)) return;
    if (!room.clock) return res.status(409).json({ error: 'no extension vote' });
    const choice = req.body?.choice;
    if (choice !== 'yes' && choice !== 'no') return res.status(400).json({ error: 'bad choice' });
    const round = req.body?.round === undefined ? undefined : Number(req.body.round);
    const voters = humans(room).map((p) => p.id);
    const r = cast(room.clock, voters, me(res).id, choice, Number(req.body?.forEndsAt), Date.now(), round);
    if (!r.ok) return res.status(409).json({ error: r.error });
    room.clock = settle(r.clock, voters, Date.now());
    return res.json(publicRoom(room, me(res).id));
  });

  app.post('/shah/rooms/:id/pause', (req, res) => {
    const room = roomFor(req, res);
    if (!room) return;
    const id = me(res).id;
    const refusal = pauseRefusalFor(room, id);
    if (refusal === 'player is not in this room') return res.status(403).json({ error: refusal });
    if (refusal === 'no pauses left') return res.status(409).json({ error: refusal, pausesLeft: 0 });
    if (refusal) return res.status(409).json({ error: refusal });
    room.personalPause = { ...startPause(id, Date.now(), PAUSE_MS), name: me(res).name };
    room.pausesUsed[id] = (room.pausesUsed[id] ?? 0) + 1;
    log(room, `${me(res).name} взял паузу ${room.pausesUsed[id]}/${GAME_PAUSES}`);
    return res.json(publicRoom(room, id));
  });

  app.post('/shah/rooms/:id/pause/end', (req, res) => {
    const room = roomFor(req, res);
    if (!room) return;
    if (!room.personalPause) return res.status(409).json({ error: 'no pause now' });
    if (room.personalPause.playerId !== me(res).id) return res.status(403).json({ error: 'not your pause' });
    endPersonalPause(room, true);
    return res.json(publicRoom(room, me(res).id));
  });

  app.post('/shah/rooms/:id/react', (req, res) => {
    const room = roomFor(req, res);
    if (!room || !seatedOrRefuse(room, res)) return;
    const result = addReaction(room.reactions, stageOf(room), me(res).id, req.body?.emoji, Date.now(), ctx.ownedPacks(me(res).id));
    if (result === 'unknown emoji') return res.status(400).json({ error: result });
    if (result === 'not owned') return res.status(403).json({ error: 'buy it in the shop' });
    if (result === 'too fast') return res.status(429).json({ error: result });
    if (result === 'not now') return res.status(409).json({ error: result });
    room.reactions = result;
    return res.json({ ok: true });
  });

  function endPersonalPause(room: ShahRoom, early: boolean) {
    const p = room.personalPause;
    if (!p) return;
    room.personalPause = null;
    room.lastPersonalPause = { playerId: p.playerId, name: p.name, early };
  }

  // ——— сокет ———

  io.on('connection', (socket) => {
    socket.on('watch_shah', (payload: { roomId?: unknown; token?: unknown }) => {
      const check = rateCheck((socket.data.shahWatchTimes as number[] | undefined) ?? [], Date.now(), WATCH_LIMIT);
      socket.data.shahWatchTimes = check.times;
      if (!check.allowed) return;
      const account = findAccountByToken(db, String(payload?.token ?? ''));
      if (!account) return void socket.emit('shah_room_error', { error: 'unauthorized' });
      const room = rooms.get(String(payload?.roomId ?? ''));
      if (!room) return void socket.emit('shah_room_error', { error: 'room not found' });
      const refusal = watchRefusal(room, account.id);
      if (refusal) return void socket.emit('shah_room_error', { error: refusal });
      // Один сокет — одна комната (как в Гарбе); экран «ТУРНИР» не трогаем.
      for (const joined of socket.rooms) {
        if (joined !== socket.id && joined !== channel(room.id) && joined !== TOURNAMENT_ROOM) socket.leave(joined);
      }
      socket.data.playerId = account.id;
      socket.join(channel(room.id));
      // Открыл стол — значит, вернулся: «ушёл» снимается сам (§13a).
      if (isMember(room, account.id) && room.awayAt[account.id] !== undefined) {
        markBack(room, account.id);
        changed(room);
      }
      socket.emit('shah_room', publicRoom(room, account.id));
      // Пришёл зритель — у всех новое число 👁.
      if (!isMember(room, account.id) && room.status === 'started') {
        broadcast(room.id).catch((e) => console.error(`[SHAH ${room.id}] broadcast failed:`, e));
      }
    });
  });

  // ——— таймеры ———

  const guarded = (name: string, fn: () => void) => () => {
    try {
      fn();
    } catch (e) {
      console.error(`[SHAH TIMER ${name}] failed:`, e);
    }
  };

  // «ГОТОВ»: все нажали — старт; 30 секунд вышли — не нажавшие выходят.
  function settleReady(room: ShahRoom): boolean {
    if (room.status !== 'lobby' || !room.readyCheck) return false;
    const outcome = readyOutcome(room.readyCheck, room.players.map((p) => p.id), room.creatorId, Date.now(), READY_WAIT_MS);
    if (outcome.kind === 'wait') return false;
    if (outcome.kind === 'start') {
      startMatch(room);
      return true;
    }
    const names = room.players.filter((p) => outcome.drop.includes(p.id)).map((p) => p.name);
    room.players = room.players.filter((p) => !outcome.drop.includes(p.id));
    room.readyCheck = null;
    room.readyDroppedIds = outcome.drop;
    // Создателем бот не становится.
    let creator = outcome.creatorId;
    if (creator !== null && room.botIds.includes(creator)) creator = humans(room)[0]?.id ?? null;
    if (creator === null) closeLobby(room, 'nobody_ready');
    else room.creatorId = creator;
    log(room, `не нажали «ГОТОВ» — вышли: ${names.join(', ')}`);
    return true;
  }

  setInterval(guarded('lobby', () => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.status !== 'lobby') continue;
      let dirty = false;
      if (!room.readyCheck && room.players.length === room.capacity) {
        room.readyCheck = startReadyCheck(now);
        for (const id of room.botIds) room.readyCheck = markReady(room.readyCheck, id);
        for (const p of humans(room)) ctx.notify?.(p.id, `shah-ready:${room.id}`, `Стол ШАХ #${room.id} собран — жми «ГОТОВ»!`, `shah_${room.id}`);
        dirty = true;
      }
      if (settleReady(room)) dirty = true;
      if (room.status === 'lobby' && lobbyExpired(room.createdAt, now, !!room.readyCheck, LOBBY_WAIT_MS)) {
        closeLobby(room, 'lobby_timeout');
        dirty = true;
      }
      if (dirty && stageOf(room) !== 'awaiting_deal') changed(room); // старт сам сохраняет и рассылает
    }
  }), 1000);

  // Присутствие (§13), запас на отлучку, личная пауза, время стола (§20).
  setInterval(guarded('presence', () => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (!tracksPresence(room)) continue;
      let dirty = false;
      const ids = room.players.map((p) => p.id);
      const step = presenceStep(ids, connectedIds(room), presenceOf(room.id), now, { graceMs: GRACE_MS, timeoutMs: absenceMsOf(room) });
      const wasOffline = presenceOf(room.id).disconnectedAt;
      presence.set(room.id, { lastSeen: step.lastSeen, disconnectedAt: step.disconnectedAt });
      for (const id of Object.keys(step.disconnectedAt)) {
        if (wasOffline[id] === undefined) {
          ctx.notify?.(id, `shah-offline:${room.id}`, `ШАХ #${room.id} на паузе — стол ждёт тебя.`, `shah_${room.id}`);
        }
      }
      if (step.changed) dirty = true;
      const absence = absenceStep(ids, absentIds(room), absentSince.get(room.id) ?? {}, room.absenceUsedMs, now, absenceMsOf(room), room.absenceFreeMs);
      absentSince.set(room.id, absence.since);
      if (JSON.stringify(absence.usedMs) !== JSON.stringify(room.absenceUsedMs)) dirty = true;
      room.absenceUsedMs = absence.usedMs;
      room.absenceFreeMs = absence.freeUsedMs;
      if (absence.expired.length > 0) {
        leaveMatch(room, absence.expired, false);
        changed(room);
        continue;
      }
      if (room.personalPause && now >= room.personalPause.endsAt) {
        endPersonalPause(room, false);
        dirty = true;
      }
      if (room.clock) {
        const before = JSON.stringify(room.clock);
        let c = setRunning(room.clock, !isPaused(room) && !room.personalPause, now);
        if (roundDue(c, now)) c = ask(c, now);
        c = settle(c, humans(room).map((p) => p.id), now);
        room.clock = c;
        if (JSON.stringify(c) !== before) dirty = true; // вопрос, итог голоса, пауза часов, время вышло
        if (c.reached && stageOf(room) === 'awaiting_deal') {
          finishMatch(room, 'time_limit', resultByTotals(room.match!.totals));
          dirty = true;
        }
      }
      if (dirty) changed(room);
    }
  }), 1000);

  // Время на ход (§13a): не успел — сервер ходит сам (вопрос 24 «а»), два пропуска — «ушёл».
  // Боты таймера не ждут — за них ходит driveBots.
  setInterval(guarded('turns', () => {
    const now = Date.now();
    for (const room of rooms.values()) {
      const a = awaited(room);
      const clock = clockFor(turnClocks.get(room.id), a?.key ?? null, now, a?.startAt ?? now);
      if (!clock) {
        turnClocks.delete(room.id);
        continue;
      }
      turnClocks.set(room.id, clock);
      if (!a || room.botIds.includes(a.playerId) || now - clock.since < turnMsOf(room)) continue;
      const result = a.deal ? deal(room, a.playerId) : applyTimeout(room);
      if (result.status !== 200) {
        console.error(`[SHAH ${room.id}] timed move failed:`, result.body);
        continue;
      }
      const miss = addMiss(room.missed, a.playerId);
      room.missed = miss.missed;
      if (miss.away) {
        room.awayAt[a.playerId] = now;
        log(room, `${nameOf(room, a.playerId)} пропустил ход дважды — «ушёл», пауза`);
      }
      changed(room);
    }
  }), 500);

  function applyTimeout(room: ShahRoom): Result {
    const move = timeoutAction(room.match!);
    if (!move) return { status: 409, body: { error: 'nothing awaited' } };
    return applyMove(room, move.playerId, move.action);
  }

  // Боты-тренировка: подумали BOT_DELAY_MS — сходили. За раз — один ход в комнате.
  setInterval(guarded('bots', () => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.botIds.length === 0 || room.status !== 'started') continue;
      const a = awaited(room);
      if (!a || !room.botIds.includes(a.playerId)) {
        botDue.delete(room.id);
        continue;
      }
      const due = botDue.get(room.id);
      if (!due || due.key !== a.key) {
        botDue.set(room.id, { key: a.key, at: Math.max(now, a.startAt) + BOT_DELAY_MS });
        continue;
      }
      if (now < due.at) continue;
      botDue.delete(room.id);
      const action = a.deal ? null : botAction(room.match!, a.playerId);
      const result = a.deal ? deal(room, a.playerId) : action ? applyMove(room, a.playerId, action) : null;
      if (!result || result.status !== 200) {
        console.error(`[SHAH ${room.id}] bot move failed:`, result?.body);
        continue;
      }
      changed(room);
    }
  }), BOT_TICK_MS);

  // Закрытые комнаты — 30 минут в памяти (итоги, смайлики), потом только в базе.
  setInterval(guarded('unload', () => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.status === 'finished' && room.finishedAt !== null && now - room.finishedAt > UNLOAD_FINISHED_MS) {
        rooms.delete(room.id);
        presence.delete(room.id);
        absentSince.delete(room.id);
      }
    }
  }), 60_000);

  return {
    roomOf: (accountId: string) => {
      const room = roomOf(accountId);
      return room ? { id: room.id, status: room.status } : undefined;
    },
    idTaken,
    // Приглашение ещё в силе: лобби со свободным местом, а друг за ним не сидит.
    hasSeatFor: (roomId: string, accountId: string) => {
      const room = rooms.get(roomId);
      return !!room && room.status === 'lobby' && room.players.length < room.capacity && !isMember(room, accountId);
    },
    // Для страницы-приглашения /r/:id: что за стол.
    summary: (roomId: string) => {
      const room = rooms.get(roomId);
      if (!room || room.status === 'finished') return undefined;
      return {
        capacity: room.capacity,
        players: room.players.length,
        creatorName: room.players.find((p) => p.id === room.creatorId)?.name ?? 'Друг',
      };
    },
  };
}

const SHAH_SIZES: readonly number[] = [2, 3, 4, 6];
