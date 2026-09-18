import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Server as SocketServer } from 'socket.io';

import {
  addFriend,
  areFriends,
  cleanName,
  createAccount,
  findAccountByCode,
  findAccountByToken,
  getAccount,
  giftedOn,
  invitedCount,
  listFriends,
  openDb,
  recordGift,
  removeFriend,
  setDaily,
  tokenFromHeader,
  transaction,
  type Account,
} from './accounts.js';
import { createDeck, shuffle } from './deck.js';
import { loadUnfinishedRooms, profileStats, ratedPlayers, roomIdTaken, saveRoom, writeRoom } from './roomDb.js';
import { afterDeal, afterRoom, ratingOf, shownRating, START_SKILL } from './rating.js';
import { addReaction, isPlayerCode, isRoomCode, type ReactionEntry } from './reactions.js';
import { addDeal, addMoney, emptyStats, roomWinners, type PlayerStats } from './stats.js';
import { avatarPath, detectImageType, loadAvatar, MAX_AVATAR_BYTES, saveAvatar } from './avatars.js';
import {
  dailyClaim,
  dayKey,
  giftError,
  normalizeCode,
  REFERRAL_BONUS,
} from './bonus.js';
import {
  DISCONNECT_TIMEOUT_MS,
  OFFLINE_GRACE_MS,
  presenceStep,
  secondsLeft,
  touch,
  type PresenceState,
} from './presence.js';
import { openTrump } from './deal.js';
import type { Card, Suit } from './types.js';
import {
  baseKon,
  cheapestStake,
  COIN_STEP,
  collectAnte,
  ENTRY_STEP,
  konAvailable,
  konUnlockAt,
  lowestEntryFor,
  MAX_ENTRY,
  MAX_ANTE,
  MAX_EMPTY_LIMIT,
  MAX_KON_THRESHOLD,
  MIN_ANTE,
  MIN_EMPTY_LIMIT,
  MIN_KON_THRESHOLD,
  nobodyCanPlay,
  settleRound,
  splitKon,
  someoneBelowBase,
  stakeFor,
} from './money.js';
import {
  allowedBidsFor,
  dvaSuitOptions,
  isBiddingOver,
  konTrumpOptions,
  razSuitFor,
  resolveBidding,
  type Bid,
  type BidEntry,
  type Capacity,
  type MainPlayer,
  type Wallet,
} from './bidding.js';
import { dealsUntilNextVote, tallyVote, type VoteChoice } from './vote.js';
import {
  contestResult,
  nextActor,
  passCard,
  riskOptions,
  specialKindOf,
  specialLeader,
  startContest,
  takeCard,
  type Contest,
  type SpecialKind,
} from './special.js';
import {
  firstLeader,
  countsAsGarba,
  instantWinIndex,
  mainStatus,
  nextSeat,
  playableCards,
  TRICKS_PER_ROUND,
  winnerOfTrick,
  type TrickCard,
} from './play.js';

type Player = {
  id: string; // это id аккаунта
  name: string;
  ready: boolean;
  joinedAt: number;
  // Баланс аккаунта. Пока игрок в комнате, деньги считаются здесь, а после каждого
  // действия записываются обратно в базу (persistRoom).
  balance: number;
  // Баланс при входе в комнату — от него считается, кто больше всех проиграл (§12.2).
  startBalance: number;
};

// finished — комната закрыта, играть в ней больше нельзя (RULES.md §12).
type RoomStatus = 'lobby' | 'started' | 'finished';

// Настройки, которые выбирает создатель комнаты (RULES.md §9.1, §9.3, §6.7).
type RoomSettings = {
  ante: number; // взнос, 100…1000, кратен 100
  emptyLimit: number; // лимит пустых раздач подряд, 3…10
  konThreshold: number; // КОН открывается при коне ≥ базовый × это число, 3…10
  minBalance: number; // минимум денег для входа, 1 000…10 000, не меньше взноса × 10
};

type RevealCard = Card & {
  playerId: string;
  playerName: string;
};

// dealer_found  — первый раздающий найден вскрытием на туза, ждём раздачи
// bidding       — карты розданы, идут торги
// playing       — главный определён, идёт розыгрыш 5 взяток
// round_done    — раздача сыграна, деньги посчитаны, следующий раздающий должен раздать
// awaiting_deal — пересдача: все спасовали, новый раздающий должен раздать
// special       — открылась спецкарта: слепой круг туза или окно борьбы за карту (§7)
// special_discard — спецкарту забрали: владелец сбрасывает одну свою карту (§7.5)
// kon_trump     — торги выиграл КОН, он называет козырь: РАЗ или ДВА (§6.7)
// vote          — кон не по карману никому: голосуем, продолжаем или делим (§12.2)
// room_done     — комната закрыта: кон забрали (§12.1) или поделили по голосованию (§12.2)
type Stage =
  | 'dealer_found'
  | 'bidding'
  | 'special'
  | 'special_discard'
  | 'kon_trump'
  | 'playing'
  | 'round_done'
  | 'awaiting_deal'
  | 'vote'
  | 'room_done';

type MainResult = MainPlayer & {
  tricks: number;
  won: boolean;
  delta: number; // сколько монет получил (+) или положил в кон (−)
  // Выиграл сразу, без розыгрыша: дама, король и туз козыря на руках (§8).
  instant: boolean;
  // Это ГАРБА — только при РАЗ и КОНЕ: анимация и статистика. При ДВА — нет.
  garba: boolean;
};

// Пустая раздача — никто не играет: все спасовали (§6.5) или три раза подряд
// открылась ИЗЖОГА (§5.2). В обоих случаях пересдача с доливкой (§9.2, §9.3).
type EmptyRoundReason = 'all_pass' | 'three_izzhoga';

// Последний взнос в кон — чтобы игроки видели, откуда взялись деньги.
type AnteRecord = {
  reason: 'kon_empty' | EmptyRoundReason;
  perPlayer: number;
  total: number;
  // Доливают все или никто: если у кого-то не хватило денег, не доливал никто.
  skipped: boolean;
  // У кого не хватило денег на взнос — из-за них доливка и отключилась.
  brokePlayerIds: string[];
};

// Завершённая взятка: какие карты легли и кто её забрал.
type PlayedTrick = { cards: TrickCard[]; winnerId: string; winnerName: string };

type GameState = {
  stage: Stage;
  dealerId: string;
  dealerName: string;
  revealLog: RevealCard[];

  // Открытая карта и козырь — разные вещи. При 4 игроках козырь всегда черви,
  // а открытая некозырная карта просто лежит (RULES.md §5.1).
  openCard: Card | null;
  // Масть РАЗ — известна сразу после раздачи.
  razSuit: Suit | null;
  // Итоговый козырь раздачи — известен только после торгов (ДВА может его сменить).
  trumpSuit: Suit | null;
  // Главные игроки: один, либо двое при двух РАЗ.
  mains: MainPlayer[];
  // Почему сейчас пересдача: все спасовали или три ИЗЖОГИ подряд.
  lastRedeal: EmptyRoundReason | null;
  // Карты ИЗЖОГИ, которые открылись в этой раздаче и вернулись в колоду (§5.2).
  // Их видели все, поэтому они открыты.
  izzhoga: Card[];
  // Масть, которую выбрал сказавший ДВА при 6–7 игроках. СКРЫТА от остальных
  // до начала розыгрыша (§6.3): в публичное состояние не попадает никогда —
  // когда ДВА становится главным, она раскрывается через trumpSuit.
  dvaSuit: Suit | null;
  // Выиграл КОН — как он назвал козырь: по РАЗ (масть РАЗ) или по ДВА (§6.7).
  konAs: 'РАЗ' | 'ДВА' | null;
  // Спецкарта этой раздачи и борьба за неё (§7). null — открылась обычная карта.
  special: {
    kind: SpecialKind;
    card: Card;
    contest: Contest;
    // Итог борьбы: у кого карта и на каком риске; 'nobody' — не взял никто.
    outcome: { holderId: string; risk: number } | 'nobody' | null;
  } | null;
  // Сброшенная владельцем спецкарты карта. СКРЫТА от всех (§7.5), наружу не отдаётся.
  discardedCard: Card | null;

  // Розыгрыш.
  turnPlayerId: string | null;
  trickNumber: number; // 1…5
  currentTrick: TrickCard[];
  // Последняя завершённая взятка — чтобы все успели увидеть, кто её забрал.
  lastTrick: PlayedTrick | null;
  // Все завершённые взятки раздачи по порядку. Сыгранные карты остаются на виду
  // у всех до конца раздачи (RULES.md §10.6).
  playedTricks: PlayedTrick[];
  tricksWon: Record<string, number>;
  result: MainResult[] | null;

  // Деньги.
  kon: number;
  konBeforeSettlement: number | null;
  // Пустые раздачи подряд (все ПАС). Сбрасывается, когда кто-то сыграл (§9.3).
  emptyStreak: number;
  lastAnte: AnteRecord | null;
  // Кто-то опустился ниже базового кона — доигрываем, пока кон не заберут (§12.1).
  closing: boolean;
  // Почему закрылась комната: кон забрали (§12.1), кон никто не может взять
  // и его поделили поровну (§12.2) или игрок отключился и не вернулся за 5 минут (§13).
  closeReason: 'kon_taken' | 'nobody_can_play' | 'player_left' | null;
  // Кто не вернулся за 5 минут — ему доля кона не положена (§13).
  leftPlayerIds?: string[];
  // Победитель комнаты (ТЗ §36): лучший итог по монетам; при ничьей — несколько.
  winnerIds?: string[];
  // Идущее голосование. resumeStage — куда вернуться, если решат продолжать.
  vote: {
    votes: Record<string, VoteChoice>;
    resumeStage: 'round_done' | 'awaiting_deal';
    cheapest: number;
  } | null;
  // Итог последнего голосования — чтобы все видели, чем оно закончилось.
  lastVote: { result: VoteChoice; continueVotes: number; splitVotes: number } | null;
  // Сколько раздач прошло после решения «продолжаем». Снова голосуем не раньше
  // чем через круг (§12.2). null — решения «продолжаем» ещё не было.
  dealsSinceContinue: number | null;
  split: {
    kon: number;
    perPlayer: number;
    remainder: number;
    remainderTo: string | null;
  } | null;

  hands: Record<string, Card[]>;
  bids: BidEntry[];
  bidOrder: string[];
  bidIndex: number;
  activeBidderId: string | null;
};

type Room = {
  id: string;
  capacity: number;
  creatorId: string;
  settings: RoomSettings;
  players: Player[];
  status: RoomStatus;
  createdAt: number;
  game?: GameState;
  // Статистика игроков за эту комнату (ТЗ §35, этап 9.4). Заводится при старте игры.
  stats?: Record<string, PlayerStats>;
  // Рейтинг игроков за столом (RULES.md §16, этап 9.6). Мастерство меняется здесь и
  // сохраняется в аккаунт вместе с комнатой — как баланс. startSkill и startDeals —
  // с чем игрок сел за стол: от них «Рейтинг 4.0 → 4.9» в итогах.
  rating?: Record<string, { skill: number; startSkill: number; startDeals: number }>;
  // Последние реакции-смайлики (RULES.md §14, этап 9.7).
  reactions?: ReactionEntry[];
};

const app = express();
// Порт можно переопределить — это нужно проверке сокетов (tests/live-socket.ts),
// чтобы поднять отдельный сервер и не мешать тому, что работает на 3000.
const PORT = Number(process.env.PORT ?? 3000);
const rooms = new Map<string, Room>();

app.use(cors());
app.use(express.json());

// --- Аккаунты (этап 9.1) и сохранение комнат (этап 9.2) ---
//
// Файл базы — backend/data/garba.db, путь можно сменить переменной GARBA_DB
// (':memory:' — база в памяти, для проверок). В базе аккаунты и комнаты:
// после перезапуска сервера недоигранные комнаты поднимаются обратно.
const DB_FILE = process.env.GARBA_DB ?? 'data/garba.db';
if (DB_FILE !== ':memory:') mkdirSync(dirname(DB_FILE), { recursive: true });
const db = openDb(DB_FILE);

for (const room of loadUnfinishedRooms<Room>(db)) rooms.set(room.id, room);
if (rooms.size > 0) console.log(`[DB] restored ${rooms.size} unfinished room(s)`);

// Незаконченная комната игрока. Играть можно только в одной комнате за раз:
// баланс аккаунта один, и пока игрок за столом, его деньги считаются там.
function activeRoomOf(accountId: string): Room | undefined {
  for (const room of rooms.values()) {
    if (room.status !== 'finished' && room.players.some((p) => p.id === accountId)) {
      return room;
    }
  }
  return undefined;
}

// Сохранить комнату и балансы её игроков — одной транзакцией.
function persistRoom(room: Room) {
  saveRoom(db, room);
}

// Изменить баланс аккаунта вне игры: бонус, подарок, приглашение (этап 9.3).
// Вызывать внутри transaction(). Если игрок сидит в незаконченной комнате, его деньги
// сейчас считаются там — меняем и там, иначе следующее сохранение комнаты затёрло бы
// начисление. startBalance сдвигаем тоже: бонус и подарок — не выигрыш за столом,
// в «кто больше всех проиграл» (§12.2, §13) и в итоги комнаты они не входят.
// undo — как откатить изменение в памяти, если транзакция не прошла.
function changeCoins(accountId: string, delta: number, undo: (() => void)[]): Room | undefined {
  const room = activeRoomOf(accountId);
  const player = room?.players.find((p) => p.id === accountId);

  if (room && player) {
    player.balance += delta;
    player.startBalance += delta;
    undo.push(() => {
      player.balance -= delta;
      player.startBalance -= delta;
    });
    writeRoom(db, room);
    return room;
  }

  db.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?').run(delta, accountId);
  return undefined;
}

// Несколько изменений денег одной транзакцией. Не прошла — память откатывается
// вместе с базой. Прошла — комнатам, где поменялся баланс, рассылается новое состояние.
function moveCoins(changes: { accountId: string; delta: number }[], extra: () => void = () => {}) {
  const undo: (() => void)[] = [];
  let touched: Room[] = [];
  try {
    touched = transaction(db, () => {
      const rooms: Room[] = [];
      for (const c of changes) {
        const room = changeCoins(c.accountId, c.delta, undo);
        if (room) rooms.push(room);
      }
      extra();
      return rooms;
    });
  } catch (e) {
    for (const u of undo.reverse()) u();
    throw e;
  }
  for (const room of touched) {
    broadcastRoom(room.id).catch((e) => console.error(`[ROOM ${room.id}] broadcast failed:`, e));
  }
}

function accountOf(req: express.Request): Account | null {
  return findAccountByToken(db, tokenFromHeader(req.headers.authorization));
}

// Новый аккаунт: имя → id, токен, стартовые 10 000. Токен приходит один раз,
// телефон обязан его сохранить. inviteCode — код пригласившего (ТЗ §4):
// он сразу получает 1 000 — новый игрок зарегистрировался и вошёл.
app.post('/accounts', (req, res) => {
  const name = cleanName(req.body?.name);
  if (!name) {
    return res.status(400).json({ error: 'name must be 1 to 20 characters' });
  }

  const inviteCode = normalizeCode(req.body?.inviteCode);
  const inviter = inviteCode ? findAccountByCode(db, inviteCode) : null;
  if (inviteCode && !inviter) {
    return res.status(400).json({ error: 'invite code not found' });
  }

  let created: ReturnType<typeof createAccount> | null = null;
  moveCoins(inviter ? [{ accountId: inviter.id, delta: REFERRAL_BONUS }] : [], () => {
    created = createAccount(db, name, inviter?.id ?? null);
  });
  const { account, token } = created!;

  console.log(
    `[ACCOUNT] created ${account.name} (${account.id})` +
      (inviter ? `, invited by ${inviter.name} (+${REFERRAL_BONUS})` : ''),
  );

  return res.status(201).json({ ...account, token });
});

// Кто я: по токену. roomId — незаконченная комната, если игрок в ней сидит.
// daily — ежедневный бонус (ТЗ §3): взят ли сегодня, какой день серии, сколько даст.
app.get('/me', (req, res) => {
  const account = accountOf(req);
  if (!account) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const today = dayKey(Date.now());
  const claim = dailyClaim(account.dailyDay, account.dailyStreak, today);

  return res.json({
    ...account,
    avatar: avatarPath(db, account.id),
    rating: shownRating(accountRating(account.id)),
    roomId: activeRoomOf(account.id)?.id ?? null,
    daily: {
      claimedToday: !claim.claimable,
      streak: claim.streak,
      amount: claim.claimable ? claim.amount : 0,
    },
    giftSentToday: giftedOn(db, account.id, today),
    invitedCount: invitedCount(db, account.id),
  });
});

// Забрать ежедневный бонус (ТЗ §3): 1 000, на 7-й день подряд ещё 5 000.
app.post('/me/daily-bonus', (req, res) => {
  const account = accountOf(req);
  if (!account) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const today = dayKey(Date.now());
  const claim = dailyClaim(account.dailyDay, account.dailyStreak, today);
  if (!claim.claimable) {
    return res.status(409).json({ error: 'already claimed today', streak: claim.streak });
  }

  moveCoins([{ accountId: account.id, delta: claim.amount }], () => {
    setDaily(db, account.id, today, claim.streak);
  });
  console.log(`[ACCOUNT] ${account.name}: daily bonus day ${claim.streak}/7, +${claim.amount}`);

  return res.json({
    amount: claim.amount,
    streak: claim.streak,
    balance: account.balance + claim.amount,
  });
});

// --- Ссылки-приглашения (ТЗ §4, §6, этап 9.7) ---
//
// Ссылку игрок отправляет другу в мессенджер. Она открывает эту страницу:
// кнопка «Открыть в ГАРБЕ» запускает приложение (garba://...), а если приложения
// ещё нет — на странице крупно код, его можно ввести вручную.
//   /r/<номер комнаты>  — зовут в комнату
//   /i/<код игрока>     — приглашение друга (пригласивший получит 1 000)

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function invitePage(title: string, text: string, appLink: string, code: string, hint: string): string {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 0; font-family: system-ui, sans-serif; background: #07131B; color: #fff;
         display: flex; min-height: 100vh; align-items: center; justify-content: center; }
  main { max-width: 420px; padding: 24px; text-align: center; }
  h1 { color: #D4A94F; font-size: 40px; margin: 0 0 8px; }
  p { color: #cfd8dc; font-size: 17px; line-height: 1.4; }
  a.btn { display: block; margin: 24px 0; padding: 16px; border-radius: 12px; background: #D4A94F;
          color: #07131B; font-weight: 800; font-size: 18px; text-decoration: none; }
  .code { font-size: 36px; font-weight: 900; letter-spacing: 6px; color: #D4A94F; }
  small { color: #78909c; }
</style>
</head>
<body><main>
  <h1>ГАРБА</h1>
  <p>${escapeHtml(text)}</p>
  <a class="btn" href="${escapeHtml(appLink)}">ОТКРЫТЬ В ГАРБЕ</a>
  <p>${escapeHtml(hint)}</p>
  <div class="code">${escapeHtml(code)}</div>
  <p><small>Монеты в ГАРБЕ — игровые, это не деньги.</small></p>
</main></body>
</html>`;
}

app.get('/r/:roomId', (req, res) => {
  const roomId = req.params.roomId;
  const room = isRoomCode(roomId) ? rooms.get(roomId) : undefined;
  if (!room || room.status === 'finished') {
    return res.status(404).type('html').send(
      invitePage('ГАРБА', 'Эта комната уже закрыта или её нет.', 'garba://', '', 'Создайте новую комнату в приложении.'),
    );
  }
  const creator = room.players.find((p) => p.id === room.creatorId)?.name ?? 'Друг';
  return res.type('html').send(
    invitePage(
      'Приглашение в ГАРБУ',
      `${creator} зовёт вас играть в ГАРБУ: комната на ${room.capacity} игроков, сейчас ${room.players.length}.`,
      `garba://room/${roomId}`,
      roomId,
      'Если приложение не открылось — нажмите «Войти по коду» и введите номер комнаты:',
    ),
  );
});

app.get('/i/:code', (req, res) => {
  const code = req.params.code;
  const inviter = isPlayerCode(code) ? findAccountByCode(db, code) : null;
  if (!inviter) {
    return res.status(404).type('html').send(
      invitePage('ГАРБА', 'Такого приглашения нет.', 'garba://', '', 'Проверьте ссылку.'),
    );
  }
  return res.type('html').send(
    invitePage(
      'Приглашение в ГАРБУ',
      `${inviter.name} приглашает вас в ГАРБУ — карточную игру для друзей.`,
      `garba://invite/${code}`,
      code,
      'Установите приложение и при первом входе введите код приглашения:',
    ),
  );
});

// --- Аватар (ТЗ §2, этап 9.5) ---
// Телефон присылает уже уменьшенную картинку как есть (не JSON). Тип картинки сервер
// определяет сам по её байтам — присланному Content-Type не верим.
app.put(
  '/me/avatar',
  express.raw({ type: () => true, limit: MAX_AVATAR_BYTES }),
  (req, res) => {
    const account = accountOf(req);
    if (!account) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const bytes = Buffer.isBuffer(req.body) ? new Uint8Array(req.body) : new Uint8Array();
    const mime = detectImageType(bytes);
    if (!mime) {
      return res.status(400).json({ error: 'not an image' });
    }
    saveAvatar(db, account.id, mime, bytes);
    console.log(`[ACCOUNT] ${account.name}: new avatar, ${bytes.length} bytes`);

    // Игрок сидит за столом — пусть остальные сразу увидят новое фото.
    const room = activeRoomOf(account.id);
    if (room) broadcastRoom(room.id).catch((e) => console.error(`[ROOM ${room.id}] broadcast failed:`, e));

    return res.json({ avatar: avatarPath(db, account.id) });
  },
);

// Картинка аватара. Без токена: её грузит виджет картинки, а адрес знают только
// те, кому сервер его отдал (id аккаунта угадать нельзя).
app.get('/avatars/:id', (req, res) => {
  const avatar = loadAvatar(db, req.params.id);
  if (!avatar) {
    return res.status(404).json({ error: 'no avatar' });
  }
  res.setHeader('Content-Type', avatar.mime);
  // Адрес меняется с каждой новой фоткой (?v=...), поэтому кэшировать можно надолго.
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  return res.send(Buffer.from(avatar.data));
});

// Слишком большое фото — понятная ошибка вместо обрыва.
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.too.large') {
    return res.status(413).json({ error: 'image too large', maxBytes: MAX_AVATAR_BYTES });
  }
  return next(err);
});

// Мой профиль (ТЗ §2): аккаунт и статистика за всё время.
app.get('/me/profile', (req, res) => {
  const account = accountOf(req);
  if (!account) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return res.json({
    id: account.id,
    name: account.name,
    code: account.code,
    balance: account.balance,
    createdAt: account.createdAt,
    avatar: avatarPath(db, account.id),
    rating: shownRating(accountRating(account.id)),
    stats: profileStats(db, account.id),
    friendsCount: listFriends(db, account.id).length,
  });
});

// Игрок по коду: имя и статистика. Нужен перед подарком (кому он уйдёт)
// и в списке друзей. Баланс чужого игрока не отдаём — вне стола он ни к чему.
app.get('/players/:code', (req, res) => {
  const me = accountOf(req);
  if (!me) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const player = findAccountByCode(db, normalizeCode(req.params.code));
  if (!player) {
    return res.status(404).json({ error: 'player not found' });
  }
  return res.json({
    code: player.code,
    name: player.name,
    avatar: avatarPath(db, player.id),
    rating: shownRating(accountRating(player.id)),
    stats: profileStats(db, player.id),
    isFriend: areFriends(db, me.id, player.id),
  });
});

// --- Рейтинг (ТЗ §38, RULES.md §16) ---
// scope=friends — я и мои друзья; scope=all — все игроки (первые 50 и моё место).
app.get('/rating', (req, res) => {
  const me = accountOf(req);
  if (!me) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const friendsOnly = req.query.scope === 'friends';
  const list = friendsOnly
    ? ratedPlayers(db, [me.id, ...listFriends(db, me.id).map((f) => f.id)])
    : ratedPlayers(db);

  const places = list.map((p, i) => ({
    place: i + 1,
    code: p.code,
    name: p.name,
    avatar: avatarPath(db, p.id),
    rating: shownRating(p.rating),
    me: p.id === me.id,
  }));
  const myPlace = places.find((p) => p.me)?.place ?? null;
  const top = friendsOnly ? places : places.slice(0, 50);

  return res.json({ scope: friendsOnly ? 'friends' : 'all', total: places.length, myPlace, players: top });
});

// --- Друзья (ТЗ §2, этап 9.4) ---
// Добавил по коду — дружба сразу взаимная, у обоих в списке.

app.get('/friends', (req, res) => {
  const me = accountOf(req);
  if (!me) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return res.json({
    friends: listFriends(db, me.id).map((f) => ({
      code: f.code,
      name: f.name,
      avatar: avatarPath(db, f.id),
      rating: shownRating(accountRating(f.id)),
      stats: profileStats(db, f.id),
      // В какой комнате сейчас сидит — чтобы можно было зайти к другу.
      roomId: activeRoomOf(f.id)?.id ?? null,
    })),
  });
});

app.post('/friends', (req, res) => {
  const me = accountOf(req);
  if (!me) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const friend = findAccountByCode(db, normalizeCode(req.body?.code));
  if (!friend) {
    return res.status(404).json({ error: 'player not found' });
  }
  if (friend.id === me.id) {
    return res.status(400).json({ error: 'self' });
  }
  if (areFriends(db, me.id, friend.id)) {
    return res.status(409).json({ error: 'already friends' });
  }
  addFriend(db, me.id, friend.id);
  console.log(`[FRIENDS] ${me.name} + ${friend.name}`);
  return res.status(201).json({ code: friend.code, name: friend.name });
});

app.delete('/friends/:code', (req, res) => {
  const me = accountOf(req);
  if (!me) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const friend = findAccountByCode(db, normalizeCode(req.params.code));
  if (!friend || !areFriends(db, me.id, friend.id)) {
    return res.status(404).json({ error: 'not a friend' });
  }
  removeFriend(db, me.id, friend.id);
  return res.json({ ok: true });
});

// Подарить монеты по коду игрока (ТЗ §5): до 1 000, не чаще раза в сутки.
// Дарить можно, только когда не сидишь в комнате: там деньги нужны для ставок,
// и минимум для входа проверялся по балансу на момент входа.
app.post('/gifts', (req, res) => {
  const from = accountOf(req);
  if (!from) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const to = findAccountByCode(db, normalizeCode(req.body?.toCode));
  if (!to) {
    return res.status(404).json({ error: 'player not found' });
  }

  const busyIn = activeRoomOf(from.id);
  if (busyIn) {
    return res.status(409).json({ error: 'finish your game first', roomId: busyIn.id });
  }

  const amount = Number(req.body?.amount);
  const today = dayKey(Date.now());
  const error = giftError({
    amount,
    balance: from.balance,
    giftedToday: giftedOn(db, from.id, today),
    toSelf: to.id === from.id,
  });
  if (error) {
    return res.status(error === 'already gifted today' ? 409 : 400).json({ error });
  }

  moveCoins(
    [
      { accountId: from.id, delta: -amount },
      { accountId: to.id, delta: amount },
    ],
    () => recordGift(db, from.id, to.id, amount, today),
  );
  console.log(`[GIFT] ${from.name} → ${to.name}: ${amount}`);

  return res.json({ amount, balance: from.balance - amount, to: { code: to.code, name: to.name } });
});

// Всё про комнаты — только с токеном. Кто делает запрос, сервер знает сам:
// playerId и name в теле запроса больше не нужны, а если пришли — не используются.
// Так никто не может ходить за другого игрока или смотреть его карты.
app.use('/rooms', (req, res, next) => {
  const account = findAccountByToken(db, tokenFromHeader(req.headers.authorization));
  if (!account) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  res.locals.account = account;
  req.body = { ...(req.body ?? {}), playerId: account.id, name: account.name };
  next();
});

// Аккаунт, от имени которого пришёл запрос (его положил middleware выше).
function me(res: express.Response): Account {
  return res.locals.account as Account;
}

// --- Живые обновления через Socket.IO (этап 8) ---
//
// Действия по-прежнему идут обычными HTTP-запросами — контракт API не меняется.
// Новое: после каждого действия сервер сам рассылает свежее состояние комнаты всем,
// кто за ней следит. Каждому — своё: publicRoom(room, его playerId), то есть со своей
// рукой, чужие карты не уходят никому. Клиенту больше не нужно спрашивать раз в секунду.
//
// Протокол:
//   клиент → 'watch' { roomId, token }      начать следить за комнатой
//   сервер → 'room'  publicRoom(...)         сразу после watch и после каждого действия
//   сервер → 'room_error' { error }          комнаты нет или токен не подходит
//
// Кто смотрит — сервер узнаёт по токену (этап 9.1), а не по присланному playerId.
const httpServer = createServer(app);
const io = new SocketServer(httpServer, { cors: { origin: '*' } });

io.on('connection', (socket) => {
  socket.on('watch', (payload: { roomId?: unknown; token?: unknown }) => {
    const roomId = String(payload?.roomId ?? '');
    const account = findAccountByToken(db, String(payload?.token ?? ''));
    const room = rooms.get(roomId);

    if (!account) {
      socket.emit('room_error', { error: 'unauthorized' });
      return;
    }
    const playerId = account.id;

    if (!room) {
      socket.emit('room_error', { error: 'room not found' });
      return;
    }

    // Один сокет — одна комната: при повторном watch уходим из прежней.
    for (const joined of socket.rooms) {
      if (joined !== socket.id) socket.leave(joined);
    }

    socket.data.playerId = playerId;
    socket.join(roomId);
    socket.emit('room', publicRoom(room, playerId));
  });
});

// Разослать состояние комнаты всем, кто за ней следит, — каждому со своей рукой.
async function broadcastRoom(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  const sockets = await io.in(roomId).fetchSockets();
  for (const s of sockets) {
    const viewer = typeof s.data.playerId === 'string' ? s.data.playerId : undefined;
    s.emit('room', publicRoom(room, viewer));
  }
}

// После любого действия с комнатой (POST /rooms/:id/...) — рассылка.
// Рассылаем и после отказа: состояние не изменилось, лишнее сообщение безвредно,
// а разбирать, какой ответ что поменял, — лишнее место для ошибок.
// Здесь же комната и балансы записываются в базу — переживают перезапуск сервера.
app.use('/rooms/:id', (req, res, next) => {
  if (req.method === 'POST') {
    const roomId = req.params.id;
    res.on('finish', () => {
      const room = rooms.get(roomId);
      if (room) persistRoom(room);
      broadcastRoom(roomId).catch((e) =>
        console.error(`[ROOM ${roomId}] broadcast failed:`, e),
      );
    });
  }
  next();
});

// --- Отключение игрока (RULES.md §13, этап 9.2) ---
//
// Раз в секунду смотрим, у кого из игроков начатых комнат открыт сокет. Пропал
// дольше отсрочки — игра на паузе, у него 5 минут. Вернулся — играем дальше.
// Не вернулся — игра прекращается, кон делится поровну между оставшимися.
// Присутствие живёт только в памяти: после перезапуска сервера всем даётся
// отсрочка на переподключение, таймеры начинаются заново.
// Время можно сократить переменными окружения — это нужно живой проверке.
const presenceOpts = {
  graceMs: Number(process.env.GARBA_GRACE_MS ?? OFFLINE_GRACE_MS),
  timeoutMs: Number(process.env.GARBA_DISCONNECT_MS ?? DISCONNECT_TIMEOUT_MS),
};
const presence = new Map<string, PresenceState>();

function presenceOf(roomId: string): PresenceState {
  return presence.get(roomId) ?? { lastSeen: {}, disconnectedAt: {} };
}

// Присутствие считается только за столом: в лобби игры ещё нет, после конца — уже нет.
function tracksPresence(room: Room): boolean {
  return room.status === 'started' && !!room.game && room.game.stage !== 'room_done';
}

function isPaused(room: Room): boolean {
  return tracksPresence(room) && Object.keys(presenceOf(room.id).disconnectedAt).length > 0;
}

// У кого сейчас открыт сокет к комнате.
function connectedPlayerIds(roomId: string): string[] {
  const ids: string[] = [];
  for (const socketId of io.sockets.adapter.rooms.get(roomId) ?? []) {
    const playerId = io.sockets.sockets.get(socketId)?.data.playerId;
    if (typeof playerId === 'string') ids.push(playerId);
  }
  return ids;
}

// Не вернулся за 5 минут: игра прекращается, кон поровну между оставшимися,
// остаток — тому из них, кто за эту игру проиграл больше всех (§13).
function closeByDisconnect(room: Room, leftIds: string[]) {
  const game = room.game!;
  const remaining = room.players.filter((p) => !leftIds.includes(p.id));
  const { shares, perPlayer, remainder, remainderTo } = splitKon(
    game.kon,
    remaining.map((p) => ({ id: p.id, lost: p.startBalance - p.balance })),
  );

  for (const p of remaining) {
    p.balance += shares[p.id];
    recordMoney(room, p.id, shares[p.id]);
  }

  game.split = { kon: game.kon, perPlayer, remainder, remainderTo };
  game.kon = 0;
  game.stage = 'room_done';
  game.closeReason = 'player_left';
  game.leftPlayerIds = leftIds;
  markWinners(room);
  game.activeBidderId = null;
  game.turnPlayerId = null;
  game.vote = null;
  room.status = 'finished';
  presence.delete(room.id);

  const names = room.players.filter((p) => leftIds.includes(p.id)).map((p) => p.name);
  console.log(
    `[ROOM ${room.id}] ${names.join(', ')} did not return in time — kon ${game.split.kon} split: ${perPlayer} each`,
  );
}

function sweepPresence() {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (!tracksPresence(room)) continue;

    const step = presenceStep(
      room.players.map((p) => p.id),
      connectedPlayerIds(room.id),
      presenceOf(room.id),
      now,
      presenceOpts,
    );
    presence.set(room.id, { lastSeen: step.lastSeen, disconnectedAt: step.disconnectedAt });

    if (step.expired.length > 0) {
      closeByDisconnect(room, step.expired);
    } else if (step.changed) {
      const off = room.players.filter((p) => step.disconnectedAt[p.id] !== undefined);
      console.log(
        off.length > 0
          ? `[ROOM ${room.id}] paused, disconnected: ${off.map((p) => p.name).join(', ')}`
          : `[ROOM ${room.id}] everyone is back, game resumed`,
      );
    } else {
      continue;
    }

    persistRoom(room);
    broadcastRoom(room.id).catch((e) => console.error(`[ROOM ${room.id}] broadcast failed:`, e));
  }
}

setInterval(sweepPresence, 1000);

// Запрос игрока к своей комнате — тоже знак, что он на месте (приложение без сокета
// опрашивает сервер). На паузе ходы не принимаются: ждём отключившегося.
const LOBBY_ACTIONS = ['/join', '/leave', '/start'];
app.use('/rooms/:id', (req, res, next) => {
  const room = rooms.get(req.params.id);
  if (!room || !tracksPresence(room)) return next();

  const playerId = me(res).id;
  if (room.players.some((p) => p.id === playerId)) {
    presence.set(room.id, touch(presenceOf(room.id), playerId, Date.now()));
  }

  if (req.method === 'POST' && !LOBBY_ACTIONS.includes(req.path) && isPaused(room)) {
    return res.status(409).json({ error: 'game paused', pause: publicPause(room) });
  }
  next();
});

// Пауза для экрана: кто отключился и сколько секунд у него осталось.
function publicPause(room: Room) {
  if (!isPaused(room)) return null;
  const now = Date.now();
  const { disconnectedAt } = presenceOf(room.id);
  return {
    players: room.players
      .filter((p) => disconnectedAt[p.id] !== undefined)
      .map((p) => ({
        id: p.id,
        name: p.name,
        secondsLeft: secondsLeft(disconnectedAt[p.id], now, presenceOpts.timeoutMs),
      })),
  };
}

// --- Статистика (ТЗ §2, §35, этап 9.4) ---
// Комната копит статистику каждого игрока; при сохранении комнаты она пишется в базу,
// профиль складывает её по всем комнатам. Бонусы и подарки сюда не попадают.

function statsOf(room: Room, playerId: string): PlayerStats {
  return room.stats?.[playerId] ?? emptyStats();
}

// Деньги за столом: взнос, расчёт раздачи, доля кона.
function recordMoney(room: Room, playerId: string, delta: number) {
  room.stats ??= {};
  room.stats[playerId] = addMoney(statsOf(room, playerId), delta);
}

// Комната закрылась — отмечаем победителя (§36).
function markWinners(room: Room) {
  room.game!.winnerIds = roomWinners(
    room.players.map((p) => ({ id: p.id, diff: p.balance - p.startBalance })),
  );

  // Итог комнаты меняет рейтинг (RULES.md §16.3); ушедшему — штраф (§16.3a).
  const skills = afterRoom(
    room.players.map((p) => ({
      id: p.id,
      skill: ratingState(room, p.id).skill,
      rating: liveRating(room, p.id),
      diff: p.balance - p.startBalance,
    })),
    room.game!.winnerIds,
    room.capacity,
    room.game!.leftPlayerIds ?? [],
  );
  for (const [id, skill] of Object.entries(skills)) ratingState(room, id).skill = skill;
}

// --- Рейтинг (RULES.md §16, этап 9.6) ---

// Мастерство и опыт игрока за этим столом. Заводится при старте игры; для комнат,
// поднятых из базы до этапа 9.6, — при первом обращении.
function ratingState(room: Room, playerId: string) {
  room.rating ??= {};
  if (!room.rating[playerId]) {
    const account = getAccount(db, playerId);
    const skill = account?.skill ?? START_SKILL;
    const deals = profileStats(db, playerId).deals - statsOf(room, playerId).deals;
    room.rating[playerId] = { skill, startSkill: skill, startDeals: deals };
  }
  return room.rating[playerId];
}

// Рейтинг прямо сейчас: мастерство + опыт, включая партии этой комнаты.
function liveRating(room: Room, playerId: string): number {
  const r = ratingState(room, playerId);
  return ratingOf(r.skill, r.startDeals + statsOf(room, playerId).deals);
}

// Рейтинг игрока вне стола — из базы.
function accountRating(playerId: string): number {
  const account = getAccount(db, playerId);
  return ratingOf(account?.skill ?? START_SKILL, profileStats(db, playerId).deals);
}

function makeRoomId(): string {
  let id = '';
  do {
    id = String(Math.floor(10000 + Math.random() * 90000));
  } while (rooms.has(id) || roomIdTaken(db, id));
  return id;
}

function makeDealerSelection(room: Room): GameState {
  // Выбор первого раздающего: карты открываются по кругу до первого туза (RULES.md §4).
  // Вскрытие идёт по местам за столом — room.players к этому моменту уже перетасован.
  // Состав колоды для вскрытия правилами не оговорён, берём полную (36 карт).
  const deck = shuffle(createDeck(7));
  const revealLog: RevealCard[] = [];
  let dealer = room.players[0];

  for (let i = 0; i < deck.length; i++) {
    const player = room.players[i % room.players.length];
    const card = deck[i];

    revealLog.push({
      ...card,
      playerId: player.id,
      playerName: player.name,
    });

    if (card.rank === 'A') {
      dealer = player;
      break;
    }
  }

  return {
    stage: 'dealer_found',
    dealerId: dealer.id,
    dealerName: dealer.name,
    revealLog,
    openCard: null,
    razSuit: null,
    trumpSuit: null,
    mains: [],
    lastRedeal: null,
    izzhoga: [],
    dvaSuit: null,
    konAs: null,
    special: null,
    discardedCard: null,
    ...emptyPlayState(),
    hands: {},
    bids: [],
    bidOrder: [],
    bidIndex: 0,
    activeBidderId: null,
    kon: 0,
    konBeforeSettlement: null,
    emptyStreak: 0,
    lastAnte: null,
    closing: false,
    closeReason: null,
    split: null,
    vote: null,
    lastVote: null,
    dealsSinceContinue: null,
  };
}

// Базовый кон комнаты = игроки × взнос.
function roomBaseKon(room: Room): number {
  return baseKon(room.players.length, room.settings.ante);
}

// Баланс игрока и стоимость каждой заявки при текущем коне — для проверки,
// хватает ли ему денег заявиться (RULES.md §6.6).
function walletOf(room: Room, playerId: string): Wallet {
  const player = room.players.find((p) => p.id === playerId);
  const kon = room.game?.kon ?? 0;
  const base = roomBaseKon(room);
  return {
    balance: player?.balance ?? 0,
    razStake: stakeFor('РАЗ', kon, base),
    dvaStake: stakeFor('ДВА', kon, base),
    // КОН открыт, только когда кон дорос до порога (§6.7), и стоит базовый кон.
    konStake: konAvailable(kon, base, room.settings.konThreshold)
      ? stakeFor('КОН', kon, base)
      : null,
  };
}

// Все вносят взнос в кон.
function takeAnte(room: Room, reason: AnteRecord['reason']) {
  const game = room.game!;
  const ante = room.settings.ante;
  const balances = Object.fromEntries(room.players.map((p) => [p.id, p.balance]));
  const { paid, total, brokePlayerIds } = collectAnte(balances, ante);

  for (const p of room.players) {
    p.balance -= paid[p.id];
    recordMoney(room, p.id, -paid[p.id]);
  }
  game.kon += total;
  game.lastAnte = {
    reason,
    perPlayer: ante,
    total,
    skipped: brokePlayerIds.length > 0,
    brokePlayerIds,
  };

  updateClosing(room);
}

// Как только у кого-то баланс ниже базового кона, комната доигрывает последний
// кон: новых конов не будет, играем, пока текущий кто-нибудь не заберёт (§12).
function updateClosing(room: Room) {
  const game = room.game!;
  if (game.closing) return;
  const balances = room.players.map((p) => p.balance);
  if (someoneBelowBase(balances, roomBaseKon(room))) {
    game.closing = true;
    console.log(`[ROOM ${room.id}] someone is below base kon, playing the last kon`);
  }
}

// Кон никто не может взять — ни у кого не хватает даже на самую дешёвую заявку.
// Тогда игра останавливается на голосование: продолжаем или делим (RULES.md §12.2).
// Вызывать, когда раздача закончилась и следующая ещё не роздана.
function startVoteIfNobodyCanPlay(room: Room) {
  const game = room.game!;
  if (game.kon === 0) return; // пустой кон заново соберут взносом
  if (game.stage !== 'round_done' && game.stage !== 'awaiting_deal') return;

  // Смотрим только на РАЗ и ДВА: заявка КОН голосованию не мешает (§12.2).
  const cheapest = cheapestStake(room.capacity, game.kon, roomBaseKon(room));
  const balances = room.players.map((p) => p.balance);
  if (!nobodyCanPlay(balances, cheapest)) return;

  // Недавно решили продолжать — ждём, пока раздача обойдёт круг (§12.2).
  if (dealsUntilNextVote(game.dealsSinceContinue, room.players.length) > 0) return;

  game.dealsSinceContinue = null;
  game.vote = { votes: {}, resumeStage: game.stage, cheapest };
  game.stage = 'vote';
  console.log(
    `[ROOM ${room.id}] nobody can afford even the cheapest bid (${cheapest}), kon ${game.kon}: vote`,
  );
}

// Голос подан — если итог уже ясен, выполняем его.
function applyVoteIfDecided(room: Room) {
  const game = room.game!;
  const vote = game.vote!;
  const choices = Object.values(vote.votes);
  const outcome = tallyVote(choices, room.players.length);
  if (outcome === 'pending') return;

  game.lastVote = {
    result: outcome,
    continueVotes: choices.filter((c) => c === 'continue').length,
    splitVotes: choices.filter((c) => c === 'split').length,
  };
  game.vote = null;

  if (outcome === 'split') {
    closeWithSplit(room);
    return;
  }

  // Продолжаем: возвращаемся туда, где остановились, — раздающий раздаёт дальше.
  // Следующий раз спросим не раньше чем через круг.
  game.stage = vote.resumeStage;
  game.dealsSinceContinue = 0;
  console.log(`[ROOM ${room.id}] vote: continue`);
}

// Комната закрывается, кон делится поровну (RULES.md §12.2).
function closeWithSplit(room: Room) {
  const game = room.game!;
  const { shares, perPlayer, remainder, remainderTo } = splitKon(
    game.kon,
    room.players.map((p) => ({ id: p.id, lost: p.startBalance - p.balance })),
  );

  for (const p of room.players) {
    p.balance += shares[p.id];
    recordMoney(room, p.id, shares[p.id]);
  }

  game.split = { kon: game.kon, perPlayer, remainder, remainderTo };
  game.kon = 0;
  game.stage = 'room_done';
  game.closeReason = 'nobody_can_play';
  markWinners(room);
  game.activeBidderId = null;
  game.turnPlayerId = null;
  room.status = 'finished';

  console.log(
    `[ROOM ${room.id}] vote: split, kon ${game.split.kon} split: ${perPlayer} each`,
  );
}

// Раздающий переходит к соседу справа — каждую раздачу, в том числе после
// пересдачи (RULES.md §4).
function passDealer(room: Room) {
  const game = room.game!;
  const dealerIndex = room.players.findIndex((p) => p.id === game.dealerId);
  const next = room.players[(dealerIndex + 1) % room.players.length];
  game.dealerId = next.id;
  game.dealerName = next.name;
}

// Состояние розыгрыша «ничего не сыграно».
function emptyPlayState() {
  return {
    turnPlayerId: null,
    trickNumber: 0,
    currentTrick: [] as TrickCard[],
    lastTrick: null,
    playedTricks: [] as PlayedTrick[],
    tricksWon: {} as Record<string, number>,
    result: null,
  };
}

function beginBidding(room: Room) {
  if (!room.game) return;
  const game = room.game;

  game.trumpSuit = null;
  game.mains = [];
  game.lastRedeal = null;
  game.izzhoga = [];
  game.dvaSuit = null;
  game.konAs = null;
  game.special = null;
  game.discardedCard = null;
  Object.assign(game, emptyPlayState());
  game.konBeforeSettlement = null;

  // Отсчёт круга до следующего голосования: каждая раздача — шаг (§12.2).
  if (game.dealsSinceContinue !== null) {
    game.dealsSinceContinue += 1;
  }

  // Кон пуст (старт комнаты или кто-то его забрал) — все вносят взнос (RULES.md §9.2).
  // Если кон не пуст, взноса нет: играем на том, что лежит.
  if (game.kon === 0) {
    takeAnte(room, 'kon_empty');
  } else {
    game.lastAnte = null;
  }

  // Колода зависит от числа игроков, см. RULES.md §3.
  // Сходится ровно: 1 открытая карта + по 5 карт каждому.
  const deck = shuffle(createDeck(room.capacity as Capacity));

  // Сначала открываем карту. Она задаёт масть РАЗ (при 4 игроках козырь всегда
  // черви, §5.1). При 5 и 6 игроках вышла ИЗЖОГА — карта вбивается обратно
  // в колоду и открывается следующая, не больше трёх раз (§5.2).
  const opening = openTrump(deck, room.capacity);
  game.izzhoga = opening.izzhoga;

  if (!opening.openCard) {
    // Три ИЗЖОГИ подряд — раздача отменяется, пересдача (§5.2).
    emptyRound(room, 'three_izzhoga');
    return;
  }

  // После открытой карты раздаём по 5 карт каждому. Вернувшиеся ИЗЖОГИ
  // остались в колоде, поэтому карт ровно хватает.
  const hands: Record<string, Card[]> = {};
  for (const player of room.players) {
    hands[player.id] = [];
  }

  let cursor = 0;
  for (let round = 0; round < 5; round++) {
    for (const player of room.players) {
      const card = opening.deck[cursor++];
      if (!card) {
        throw new Error('not enough cards to deal 5 to each player');
      }
      hands[player.id].push(card);
    }
  }

  game.openCard = opening.openCard;
  game.razSuit = razSuitFor(room.capacity as Capacity, opening.openCard);

  // Первым говорит сосед справа от раздающего, дальше против часовой стрелки,
  // раздающий высказывается последним (RULES.md §6.1).
  // Против часовой = следующий индекс в room.players.
  const dealerIndex = room.players.findIndex((p) => p.id === game.dealerId);

  if (dealerIndex < 0) {
    throw new Error('dealer is not seated at the table');
  }

  const bidOrder = room.players.map(
    (_, offset) =>
      room.players[(dealerIndex + 1 + offset) % room.players.length].id,
  );

  game.stage = 'bidding';
  game.hands = hands;
  game.bids = [];
  game.bidOrder = bidOrder;
  game.bidIndex = 0;
  game.activeBidderId = bidOrder[0] ?? null;

  // Открылась спецкарта — вместо торгов борьба за неё (§7). Карты уже лежат в руках,
  // но до конца борьбы игроки видят только часть: при слепом круге туза — ничего,
  // в окне — первую карту. Остальные 4 «дораздаются молча» (§7.2, §7.3).
  const kind = specialKindOf(room.capacity, opening.openCard);
  if (kind) {
    game.special = {
      kind,
      card: opening.openCard,
      contest: startContest(kind, room.players.map((p) => p.id), game.dealerId),
      outcome: null,
    };
    game.stage = 'special';
    game.activeBidderId = null;
  }
}

// Сколько своих карт игрок видит прямо сейчас. null — все.
// Во время борьбы за спецкарту карты раздаются по одной (§7.2, §7.3).
function visibleCardCount(game: GameState): number | null {
  if (game.stage !== 'special' || !game.special) return null;
  return game.special.contest.phase === 'blind' ? 0 : 1;
}

// Хватает ли игроку денег взять спецкарту на этом риске: проигрыш — кон × риск (§11.7).
function canAffordSpecial(room: Room, playerId: string, risk: number): boolean {
  const player = room.players.find((p) => p.id === playerId);
  return !!player && player.balance >= room.game!.kon * risk;
}

// Борьба за спецкарту окончена.
function finishSpecial(room: Room) {
  const game = room.game!;
  const special = game.special!;
  const result = contestResult(special.contest);

  // Не взял никто — карта просто лежит козырем, идут обычные торги с риском ×1 (§7.2, §7.3).
  if (!result) {
    special.outcome = 'nobody';
    game.stage = 'bidding';
    game.activeBidderId = game.bidOrder[0] ?? null;
    return;
  }

  // Взявший — главный, обычных торгов нет. Играет как РАЗ на весь кон, проигрыш × риск.
  const holder = room.players.find((p) => p.id === result.holderId)!;
  special.outcome = result;
  game.mains = [{ playerId: holder.id, playerName: holder.name, declaration: 'РАЗ' }];
  game.trumpSuit = game.razSuit;
  game.emptyStreak = 0;

  // Спецкарта идёт ему в руку — теперь у него 6 карт, одну он должен сбросить (§7.5).
  game.hands[holder.id] = [...game.hands[holder.id], special.card];
  game.stage = 'special_discard';
}

// Пустая раздача: никто не играет — все спасовали (§6.5) или три ИЗЖОГИ подряд (§5.2).
// Раздающий переходит к соседу справа, все доливают взнос поверх кона — но только
// пока пустых раздач подряд не больше лимита; дальше раздаём на том же коне (§9.3).
function emptyRound(room: Room, reason: EmptyRoundReason) {
  const game = room.game!;

  game.emptyStreak += 1;
  if (game.emptyStreak <= room.settings.emptyLimit) {
    takeAnte(room, reason);
  } else {
    game.lastAnte = null;
  }

  passDealer(room);
  game.stage = 'awaiting_deal';
  game.lastRedeal = reason;
  game.openCard = null;
  game.razSuit = null;
  game.trumpSuit = null;
  game.dvaSuit = null;
  game.konAs = null;
  game.special = null;
  game.discardedCard = null;
  game.mains = [];
  game.hands = {};
  game.bids = [];
  game.bidOrder = [];
  game.bidIndex = 0;
  game.activeBidderId = null;
  Object.assign(game, emptyPlayState());

  // После доливки кон мог стать таким, что его никто не может взять —
  // тогда голосуем, продолжать или делить (§12.2).
  startVoteIfNobodyCanPlay(room);
}

// Главные и козырь известны — начинается розыгрыш.
// Первым ходит сосед слева от первого главного (RULES.md §10.4, §10.5).
// Но если у главного дама, король и туз козыря, разыгрывать нечего: он выигрывает
// сразу (§8). При РАЗ и КОНЕ это ГАРБА, при ДВА — просто победа без розыгрыша.
function startPlay(room: Room) {
  const game = room.game!;
  const seatIds = room.players.map((p) => p.id);

  Object.assign(game, emptyPlayState());
  game.tricksWon = Object.fromEntries(seatIds.map((id) => [id, 0]));

  const instantIndex = instantWinIndex(game.mains, game.hands, game.trumpSuit!);
  if (instantIndex >= 0) {
    // Ни одной взятки не сыграно — trickNumber остаётся 0.
    finishRound(
      room,
      game.mains.map((_, i) => i === instantIndex),
      instantIndex,
    );
    const main = game.mains[instantIndex];
    console.log(
      countsAsGarba(main.declaration)
        ? `[ROOM ${room.id}] ГАРБА у ${main.playerName}`
        : `[ROOM ${room.id}] ${main.playerName} (${main.declaration}): Q K A козыря — без розыгрыша`,
    );
    return;
  }

  game.stage = 'playing';
  game.trickNumber = 1;
  // В спецраздаче первый ход особый: при 6 главный ходит сам, при 10 — последним (§10.4).
  const specialOutcome = game.special?.outcome;
  game.turnPlayerId =
    game.special && specialOutcome && specialOutcome !== 'nobody'
      ? specialLeader(game.special.kind, seatIds, game.mains[0].playerId)
      : firstLeader(seatIds, game.mains[0].playerId);
}

// Торги закончились: либо определился главный, либо все спасовали.
function finishBidding(room: Room): 'main' | 'kon' | 'all_pass' {
  const game = room.game;
  if (!game || !game.razSuit) {
    throw new Error('finishBidding called outside of bidding');
  }

  const outcome = resolveBidding(
    room.capacity as Capacity,
    game.bids,
    game.razSuit,
    game.dvaSuit,
  );

  game.activeBidderId = null;

  if (outcome.kind === 'main') {
    game.mains = outcome.mains;
    game.trumpSuit = outcome.trumpSuit;
    // Кто-то сыграл — счётчик пустых раздач обнуляется (RULES.md §9.3).
    game.emptyStreak = 0;
    startPlay(room);
    return 'main';
  }

  // Торги выиграл КОН. Козырь он называет отдельным шагом после торгов —
  // по РАЗ или по ДВА (§6.7). При 4 игроках выбора нет: козырь всегда черви.
  if (outcome.kind === 'kon') {
    game.mains = [outcome.main];
    game.emptyStreak = 0;

    const options = konTrumpOptions(room.capacity as Capacity, game.razSuit);
    if (options.length === 1) {
      game.konAs = options[0].as;
      game.trumpSuit = options[0].suit;
      startPlay(room);
    } else {
      game.stage = 'kon_trump';
    }
    return 'kon';
  }

  // Все спасовали — пересдача (RULES.md §6.5).
  emptyRound(room, 'all_pass');
  return 'all_pass';
}

// Игрок кладёт карту. Вызывать только после всех проверок допустимости.
// Возвращает, чем закончился ход: взятка ещё собирается, взятка собрана,
// или разыграна последняя взятка раздачи.
function playCard(
  room: Room,
  playerId: string,
  card: Card,
): 'next_player' | 'trick_taken' | 'round_done' {
  const game = room.game!;
  const trumpSuit = game.trumpSuit!;
  const seatIds = room.players.map((p) => p.id);
  const player = room.players.find((p) => p.id === playerId)!;

  game.hands[playerId] = game.hands[playerId].filter((c) => c.id !== card.id);
  game.currentTrick.push({ playerId, playerName: player.name, card });

  // Взятка ещё не собрана — ход соседу справа.
  if (game.currentTrick.length < room.players.length) {
    game.turnPlayerId = nextSeat(seatIds, playerId);
    return 'next_player';
  }

  // Все положили по карте — определяем, кто взял.
  const winnerId = winnerOfTrick(game.currentTrick, trumpSuit);
  const winner = room.players.find((p) => p.id === winnerId)!;

  game.tricksWon[winnerId] = (game.tricksWon[winnerId] ?? 0) + 1;
  game.lastTrick = {
    cards: game.currentTrick,
    winnerId,
    winnerName: winner.name,
  };
  game.playedTricks.push(game.lastTrick);
  game.currentTrick = [];

  // Раздача заканчивается, как только исход ясен для всех главных, —
  // до пятой взятки доигрывать не нужно (RULES.md §10.5a).
  const tricksPlayed = game.trickNumber;
  const statuses = game.mains.map((m) =>
    mainStatus(game.tricksWon[m.playerId] ?? 0, tricksPlayed),
  );
  const decided = statuses.every((s) => s !== 'open');

  if (decided || tricksPlayed >= TRICKS_PER_ROUND) {
    finishRound(
      room,
      statuses.map((s) => s === 'won'),
    );
    return 'round_done';
  }

  // Взявший взятку ходит первым в следующей (RULES.md §10.3).
  game.trickNumber += 1;
  game.turnPlayerId = winnerId;
  return 'trick_taken';
}

// Раздача сыграна: считаем деньги, передаём раздачу, проверяем конец комнаты.
// won[i] — выиграл ли game.mains[i].
// instantIndex — индекс главного, выигравшего сразу, без розыгрыша, или -1.
function finishRound(room: Room, won: boolean[], instantIndex = -1) {
  const game = room.game!;
  const base = roomBaseKon(room);

  // Риск — множитель, на котором главный забрал спецкарту (§7, §11.7); иначе ×1.
  const outcome = game.special?.outcome;
  const risk = outcome && outcome !== 'nobody' ? outcome.risk : 1;
  const settlement = settleRound(
    game.mains.map((m, i) => ({
      playerId: m.playerId,
      declaration: m.declaration,
      won: won[i],
      risk,
    })),
    game.kon,
    base,
  );

  for (const p of room.players) {
    p.balance += settlement.deltas[p.id] ?? 0;
    recordMoney(room, p.id, settlement.deltas[p.id] ?? 0);
  }

  game.konBeforeSettlement = game.kon;
  game.kon = settlement.konAfter;
  game.turnPlayerId = null;
  game.result = game.mains.map((m, i) => ({
    ...m,
    tricks: game.tricksWon[m.playerId] ?? 0,
    won: won[i],
    delta: settlement.deltas[m.playerId] ?? 0,
    instant: i === instantIndex,
    garba: i === instantIndex && countsAsGarba(m.declaration),
  }));

  // Партия сыграна — у каждого за столом. Главным — ещё победа или поражение.
  for (const p of room.players) {
    const main = game.result.find((r) => r.playerId === p.id);
    room.stats![p.id] = addDeal(
      statsOf(room, p.id),
      main ? { declaration: main.declaration, won: main.won, delta: main.delta, garba: main.garba, risk } : null,
    );
  }

  // И рейтинг (RULES.md §16.2): риск, ГАРБА, отбились ли противники.
  const skills = afterDeal(
    room.players.map((p) => ({ id: p.id, skill: ratingState(room, p.id).skill, rating: liveRating(room, p.id) })),
    game.result.map((r) => ({ id: r.playerId, won: r.won, risk, garba: r.garba })),
    room.capacity,
  );
  for (const [id, skill] of Object.entries(skills)) ratingState(room, id).skill = skill;

  updateClosing(room);

  // Комната доигрывала последний кон, и его забрали — комната закрывается (§12.1).
  if (game.closing && game.kon === 0) {
    game.stage = 'room_done';
    game.closeReason = 'kon_taken';
    markWinners(room);
    room.status = 'finished';
    console.log(`[ROOM ${room.id}] room finished`);
    return;
  }

  // Следующую раздачу сдаёт сосед справа (RULES.md §4).
  passDealer(room);
  game.stage = 'round_done';

  // Кон вырос так, что его никто не может взять, — голосуем (§12.2).
  startVoteIfNobodyCanPlay(room);
}

function publicRoom(room: Room, viewerId?: string) {
  let game: any = null;

  if (room.game) {
    game = {
      stage: room.game.stage,
      dealerId: room.game.dealerId,
      dealerName: room.game.dealerName,
      revealLog: room.game.revealLog,
      openCard: room.game.openCard,
      razSuit: room.game.razSuit,
      trumpSuit: room.game.trumpSuit,
      // Открывавшиеся ИЗЖОГИ видели все — они открыты (§5.2).
      izzhoga: room.game.izzhoga,
      // Масть ДВА видит только тот, кто сказал ДВА (§6.3), остальным — null.
      // Кто смотрит — сервер знает по токену (этап 9.1), чужой не подсмотрит.
      myDvaSuit:
        viewerId !== undefined &&
        room.game.dvaSuit !== null &&
        room.game.bids.some((b) => b.playerId === viewerId && b.bid === 'ДВА')
          ? room.game.dvaSuit
          : null,
      // Из каких мастей можно выбрать ДВА — только тому, чья очередь и кому ДВА доступен.
      myDvaSuitOptions:
        room.game.stage === 'bidding' &&
        viewerId !== undefined &&
        viewerId === room.game.activeBidderId &&
        room.game.razSuit &&
        allowedBidsFor(
          room.capacity as Capacity,
          room.game.bids,
          walletOf(room, viewerId),
        ).includes('ДВА')
          ? dvaSuitOptions(room.capacity as Capacity, room.game.razSuit)
          : [],
      mains: room.game.mains,
      lastRedeal: room.game.lastRedeal,
      // Кнопки заявок решает сервер: клиент только включает те, что пришли.
      // Не-активному игроку — пустой список.
      myAllowedBids:
        room.game.stage === 'bidding' &&
        viewerId !== undefined &&
        viewerId === room.game.activeBidderId
          ? allowedBidsFor(
              room.capacity as Capacity,
              room.game.bids,
              walletOf(room, viewerId),
            )
          : [],
      // Деньги.
      kon: room.game.kon,
      baseKon: roomBaseKon(room),
      // Сколько сейчас стоит каждая заявка — столько нужно иметь на балансе.
      razStake: stakeFor('РАЗ', room.game.kon, roomBaseKon(room)),
      dvaStake: stakeFor('ДВА', room.game.kon, roomBaseKon(room)),
      konBeforeSettlement: room.game.konBeforeSettlement,
      // С какого кона открывается заявка КОН, открыта ли она сейчас и сколько стоит (§6.7).
      konUnlockAt: konUnlockAt(roomBaseKon(room), room.settings.konThreshold),
      konAvailable: konAvailable(
        room.game.kon,
        roomBaseKon(room),
        room.settings.konThreshold,
      ),
      konStake: stakeFor('КОН', room.game.kon, roomBaseKon(room)),
      // Как КОН назвал козырь — видно всем, когда козырь уже объявлен.
      konAs: room.game.trumpSuit ? room.game.konAs : null,
      // Выбор козыря — только игроку, выигравшему КОН, пока он выбирает.
      myKonTrumpOptions:
        room.game.stage === 'kon_trump' &&
        viewerId !== undefined &&
        viewerId === room.game.mains[0]?.playerId &&
        room.game.razSuit
          ? konTrumpOptions(room.capacity as Capacity, room.game.razSuit)
          : [],
      emptyStreak: room.game.emptyStreak,
      lastAnte: room.game.lastAnte,
      closing: room.game.closing,
      closeReason: room.game.closeReason,
      leftPlayerIds: room.game.leftPlayerIds ?? [],
      winnerIds: room.game.winnerIds ?? [],
      split: room.game.split,
      // Голосование «продолжаем или делим» (§12.2): сколько за что и кто уже голосовал.
      vote: room.game.vote
        ? {
            continueVotes: Object.values(room.game.vote.votes).filter(
              (v) => v === 'continue',
            ).length,
            splitVotes: Object.values(room.game.vote.votes).filter(
              (v) => v === 'split',
            ).length,
            votedIds: Object.keys(room.game.vote.votes),
            cheapest: room.game.vote.cheapest,
          }
        : null,
      myVote:
        room.game.vote && viewerId
          ? (room.game.vote.votes[viewerId] ?? null)
          : null,
      lastVote: room.game.lastVote,
      // Через сколько раздач снова спросим, если кон всё ещё никому не по карману.
      dealsUntilNextVote: dealsUntilNextVote(
        room.game.dealsSinceContinue,
        room.players.length,
      ),
      // Розыгрыш. Сыгранные карты открыты всем — они лежат на столе.
      turnPlayerId: room.game.turnPlayerId,
      trickNumber: room.game.trickNumber,
      currentTrick: room.game.currentTrick,
      lastTrick: room.game.lastTrick,
      // Все завершённые взятки раздачи — сыгранные карты открыты всем (§10.6).
      playedTricks: room.game.playedTricks,
      tricksWon: room.game.tricksWon,
      result: room.game.result,
      // Какими картами запросивший может пойти прямо сейчас. Решает сервер,
      // клиент только подсвечивает. Не его ход — пустой список.
      myPlayableCardIds:
        room.game.stage === 'playing' &&
        viewerId !== undefined &&
        viewerId === room.game.turnPlayerId &&
        room.game.trumpSuit
          ? playableCards(
              room.game.hands[viewerId] ?? [],
              room.game.currentTrick,
              room.game.trumpSuit,
            ).map((c) => c.id)
          : [],
      bids: room.game.bids,
      bidOrder: room.game.bidOrder,
      bidIndex: room.game.bidIndex,
      activeBidderId: room.game.activeBidderId,
      // Во время борьбы за спецкарту видна только часть руки (§7.2, §7.3).
      hand:
        viewerId && room.game.hands[viewerId]
          ? room.game.hands[viewerId].slice(
              0,
              visibleCardCount(room.game) ?? undefined,
            )
          : [],
      handCounts: Object.fromEntries(
        Object.entries(room.game.hands).map(([playerId, cards]) => [
          playerId,
          Math.min(cards.length, visibleCardCount(room.game!) ?? cards.length),
        ]),
      ),
      // Спецкарта и борьба за неё (§7). Кто что сказал — открыто всем.
      special: room.game.special
        ? {
            kind: room.game.special.kind,
            card: room.game.special.card,
            phase: room.game.special.contest.phase,
            holderId: room.game.special.contest.holderId,
            holderName:
              room.players.find((p) => p.id === room.game!.special!.contest.holderId)
                ?.name ?? null,
            risk: room.game.special.contest.risk,
            passedIds: room.game.special.contest.passed,
            activeId:
              room.game.stage === 'special' ? nextActor(room.game.special.contest) : null,
            outcome: room.game.special.outcome,
          }
        : null,
      // Какие множители может назвать запросивший, если сейчас его очередь (с учётом баланса).
      mySpecialRisks:
        room.game.stage === 'special' &&
        room.game.special &&
        viewerId !== undefined &&
        nextActor(room.game.special.contest) === viewerId
          ? riskOptions(room.game.special.contest).filter((r) =>
              canAffordSpecial(room, viewerId, r),
            )
          : [],
      // Владелец спецкарты сбрасывает одну свою карту — кроме самой спецкарты (§7.5).
      myDiscardOptions:
        room.game.stage === 'special_discard' &&
        viewerId !== undefined &&
        viewerId === room.game.mains[0]?.playerId &&
        room.game.special
          ? room.game.hands[viewerId]
              .filter((c) => c.id !== room.game!.special!.card.id)
              .map((c) => c.id)
          : [],
    };
  }

  return {
    id: room.id,
    capacity: room.capacity,
    creatorId: room.creatorId,
    settings: room.settings,
    // У каждого игрока — адрес его фото (этап 9.5) или null.
    // И рейтинг (этап 9.6): сейчас и с каким сел за стол — для итогов «4.0 → 4.9».
    players: room.players.map((p) => {
      const atTable = room.rating?.[p.id];
      return {
        ...p,
        avatar: avatarPath(db, p.id),
        rating: shownRating(atTable ? liveRating(room, p.id) : accountRating(p.id)),
        ratingStart: shownRating(
          atTable ? ratingOf(atTable.startSkill, atTable.startDeals) : accountRating(p.id),
        ),
      };
    }),
    status: room.status,
    // Пауза из-за отключения (§13): кто отключился и сколько секунд у него осталось.
    pause: publicPause(room),
    // Смайлики после раздачи и после игры (§14). Клиент показывает новые по id.
    reactions: room.reactions ?? [],
    // Статистика игроков за комнату (ТЗ §35) — для экрана «ИТОГИ ИГРЫ».
    stats: room.stats ?? null,
    createdAt: room.createdAt,
    game,
  };
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/rooms', (req, res) => {
  const { playerId, name, capacity, ante, emptyLimit, konThreshold, minBalance } =
    req.body ?? {};
  const cap = Number(capacity);
  const anteValue = Number(ante);
  const limitValue = Number(emptyLimit);
  const thresholdValue = Number(konThreshold);
  const minBalanceValue = Number(minBalance);

  if (!playerId || !name) {
    return res.status(400).json({ error: 'playerId and name are required' });
  }

  if (!Number.isInteger(cap) || cap < 4 || cap > 7) {
    return res.status(400).json({ error: 'capacity must be from 4 to 7' });
  }

  // Взнос, лимит пустых раздач и порог КОН выбирает создатель
  // (RULES.md §9.1, §9.3, §6.7). Взнос кратен 100 — на этом держится
  // округление половины кона для ДВА (§11.4).
  if (
    !Number.isInteger(anteValue) ||
    anteValue < MIN_ANTE ||
    anteValue > MAX_ANTE ||
    anteValue % COIN_STEP !== 0
  ) {
    return res.status(400).json({
      error: `ante must be from ${MIN_ANTE} to ${MAX_ANTE}, multiple of ${COIN_STEP}`,
    });
  }

  if (
    !Number.isInteger(thresholdValue) ||
    thresholdValue < MIN_KON_THRESHOLD ||
    thresholdValue > MAX_KON_THRESHOLD
  ) {
    return res.status(400).json({
      error: `konThreshold must be from ${MIN_KON_THRESHOLD} to ${MAX_KON_THRESHOLD}`,
    });
  }

  // Минимум для входа — не меньше взноса × 10 (RULES.md §9.1a).
  const lowestEntry = lowestEntryFor(anteValue);
  if (
    !Number.isInteger(minBalanceValue) ||
    minBalanceValue < lowestEntry ||
    minBalanceValue > MAX_ENTRY ||
    minBalanceValue % ENTRY_STEP !== 0
  ) {
    return res.status(400).json({
      error: `minBalance must be from ${lowestEntry} to ${MAX_ENTRY}, multiple of ${ENTRY_STEP}`,
    });
  }

  // Играть можно только в одной комнате за раз — roomId, чтобы вернуться в неё.
  const busyIn = activeRoomOf(me(res).id);
  if (busyIn) {
    return res.status(409).json({ error: 'already in another room', roomId: busyIn.id });
  }

  // Создатель тоже должен проходить по минимуму.
  const creatorBalance = me(res).balance;
  if (creatorBalance < minBalanceValue) {
    return res.status(403).json({
      error: 'not enough coins to enter',
      minBalance: minBalanceValue,
      balance: creatorBalance,
    });
  }

  if (
    !Number.isInteger(limitValue) ||
    limitValue < MIN_EMPTY_LIMIT ||
    limitValue > MAX_EMPTY_LIMIT
  ) {
    return res.status(400).json({
      error: `emptyLimit must be from ${MIN_EMPTY_LIMIT} to ${MAX_EMPTY_LIMIT}`,
    });
  }

  const id = makeRoomId();

  const room: Room = {
    id,
    capacity: cap,
    creatorId: String(playerId),
    settings: {
      ante: anteValue,
      emptyLimit: limitValue,
      konThreshold: thresholdValue,
      minBalance: minBalanceValue,
    },
    players: [
      {
        id: String(playerId),
        name: String(name),
        ready: true,
        joinedAt: Date.now(),
        balance: creatorBalance,
        startBalance: creatorBalance,
      },
    ],
    status: 'lobby',
    createdAt: Date.now(),
  };

  rooms.set(id, room);
  persistRoom(room);
  console.log(`[ROOM ${id}] created ${room.players.length}/${room.capacity}`);

  return res.status(201).json(publicRoom(room, String(playerId)));
});

app.get('/rooms/:id', (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room) {
    return res.status(404).json({ error: 'room not found' });
  }

  // Свою руку видит только тот, чей токен. ?playerId=... больше не читается.
  return res.json(publicRoom(room, me(res).id));
});

app.post('/rooms/:id/join', (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room) {
    return res.status(404).json({ error: 'room not found' });
  }

  if (room.status !== 'lobby') {
    return res.status(409).json({ error: 'game already started' });
  }

  const { playerId, name } = req.body ?? {};

  if (!playerId || !name) {
    return res.status(400).json({ error: 'playerId and name are required' });
  }

  const existing = room.players.find((p) => p.id === String(playerId));
  if (existing) {
    return res.json(publicRoom(room, String(playerId)));
  }

  if (room.players.length >= room.capacity) {
    return res.status(409).json({ error: 'room is full' });
  }

  const busyIn = activeRoomOf(String(playerId));
  if (busyIn) {
    return res.status(409).json({ error: 'already in another room', roomId: busyIn.id });
  }

  // Войти можно, только если денег не меньше минимума комнаты (RULES.md §9.1a).
  const joiningBalance = me(res).balance;
  if (joiningBalance < room.settings.minBalance) {
    return res.status(403).json({
      error: 'not enough coins to enter',
      minBalance: room.settings.minBalance,
      balance: joiningBalance,
    });
  }

  room.players.push({
    id: String(playerId),
    name: String(name),
    ready: true,
    joinedAt: Date.now(),
    balance: joiningBalance,
    startBalance: joiningBalance,
  });

  console.log(
    `[ROOM ${room.id}] ${name} joined ${room.players.length}/${room.capacity}`,
  );

  return res.json(publicRoom(room, String(playerId)));
});

// Выйти из комнаты, пока игра не началась. Иначе брошенная комната держала бы
// игрока навсегда — играть можно только в одной. Уходит создатель — комната
// закрывается для всех: начать игру в ней больше некому.
// Выход из начатой игры — это отключение, оно по правилам §13 (этап 9.2).
app.post('/rooms/:id/leave', (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room) {
    return res.status(404).json({ error: 'room not found' });
  }

  if (room.status !== 'lobby') {
    return res.status(409).json({ error: 'game already started' });
  }

  const playerId = me(res).id;
  if (!room.players.some((p) => p.id === playerId)) {
    return res.status(403).json({ error: 'player is not in this room' });
  }

  if (playerId === room.creatorId) {
    room.status = 'finished';
    console.log(`[ROOM ${room.id}] creator left, room closed`);
  } else {
    room.players = room.players.filter((p) => p.id !== playerId);
    console.log(`[ROOM ${room.id}] ${me(res).name} left ${room.players.length}/${room.capacity}`);
  }

  return res.json(publicRoom(room, playerId));
});

app.post('/rooms/:id/start', (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room) {
    return res.status(404).json({ error: 'room not found' });
  }

  const { playerId } = req.body ?? {};

  if (String(playerId) !== room.creatorId) {
    return res.status(403).json({ error: 'only creator can start the game' });
  }

  if (room.players.length !== room.capacity) {
    return res.status(409).json({
      error: 'room is not full',
      players: room.players.length,
      capacity: room.capacity,
    });
  }

  if (room.status === 'started' && room.game) {
    return res.json(publicRoom(room, String(playerId)));
  }

  room.status = 'started';

  // Посадка за столом случайная и НЕ совпадает с порядком входа в комнату
  // (RULES.md §2). После этой перетасовки room.players — это и есть места за
  // столом в порядке против часовой стрелки: следующий в массиве = сосед справа.
  room.players = shuffle(room.players);

  room.game = makeDealerSelection(room);
  room.stats = Object.fromEntries(room.players.map((p) => [p.id, emptyStats()]));
  room.rating = {};
  for (const p of room.players) ratingState(room, p.id);

  console.log(
    `[ROOM ${room.id}] GAME STARTED, dealer=${room.game.dealerName}`,
  );

  return res.json(publicRoom(room, String(playerId)));
});

app.post('/rooms/:id/dealer/continue', (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room) {
    return res.status(404).json({ error: 'room not found' });
  }

  const { playerId } = req.body ?? {};

  if (!room.game) {
    return res.status(409).json({ error: 'game not started' });
  }

  // Карты сдаёт раздающий, а не создатель комнаты. Раздающий определяется тузом,
  // дальше роль идёт по кругу против часовой стрелки (RULES.md §4).
  if (String(playerId) !== room.game.dealerId) {
    return res.status(403).json({
      error: 'only the dealer can deal',
      dealerId: room.game.dealerId,
    });
  }

  // Раздавать можно только когда карты не на руках: после выбора первого
  // раздающего, при пересдаче и после сыгранной раздачи. Без этой проверки
  // повторный вызов посреди торгов перераздал бы карты и обнулил заявки.
  const canDeal =
    room.game.stage === 'dealer_found' ||
    room.game.stage === 'awaiting_deal' ||
    room.game.stage === 'round_done';

  if (!canDeal) {
    return res.status(409).json({
      error: 'cards are already dealt',
      stage: room.game.stage,
    });
  }

  beginBidding(room);

  console.log(
    `[ROOM ${room.id}] open=${room.game.openCard?.id}, raz=${room.game.razSuit}, 5 cards dealt, bidding started`,
  );

  return res.json(publicRoom(room, String(playerId)));
});

app.post('/rooms/:id/bid', (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room || !room.game) {
    return res.status(404).json({ error: 'room/game not found' });
  }

  const { playerId, bid, suit } = req.body ?? {};
  const bidValue = String(bid) as Bid;

  if (room.game.stage !== 'bidding') {
    return res.status(409).json({ error: 'bidding is not active' });
  }

  if (room.game.activeBidderId !== String(playerId)) {
    return res.status(409).json({
      error: 'not your turn',
      activeBidderId: room.game.activeBidderId,
    });
  }

  // Здесь же проверка баланса: заявку, на которую не хватает денег, не примем.
  const allowedBids = allowedBidsFor(
    room.capacity as Capacity,
    room.game.bids,
    walletOf(room, String(playerId)),
  );

  if (!allowedBids.includes(bidValue)) {
    return res.status(400).json({
      error: 'invalid bid',
      allowedBids,
    });
  }

  const player = room.players.find((p) => p.id === String(playerId));

  if (!player) {
    return res.status(404).json({ error: 'player not found' });
  }

  // ДВА: при 5 игроках масть одна и выбирать нечего. При 6 и 7 игрок обязан
  // назвать масть из допустимых (RULES.md §6.3). Масть хранится скрыто —
  // в публичную заявку попадает только «ДВА».
  if (bidValue === 'ДВА') {
    const options = dvaSuitOptions(room.capacity as Capacity, room.game.razSuit!);

    if (options.length === 1) {
      room.game.dvaSuit = options[0];
    } else if (options.includes(suit)) {
      room.game.dvaSuit = suit;
    } else {
      return res.status(400).json({
        error: 'choose a suit for ДВА',
        suitOptions: options,
      });
    }
  }

  room.game.bids.push({
    playerId: player.id,
    playerName: player.name,
    bid: bidValue,
  });

  room.game.bidIndex += 1;

  if (isBiddingOver(room.game.bids, room.game.bidOrder.length)) {
    const outcome = finishBidding(room);
    if (outcome === 'main') {
      const mains = room.game.mains
        .map((m) => `${m.playerName} (${m.declaration})`)
        .join(', ');
      console.log(
        `[ROOM ${room.id}] bidding finished, main: ${mains}, trump=${room.game.trumpSuit}`,
      );
    } else if (outcome === 'kon') {
      console.log(
        `[ROOM ${room.id}] bidding finished, КОН: ${room.game.mains[0].playerName}`,
      );
    } else {
      console.log(
        `[ROOM ${room.id}] all passed, redeal by ${room.game.dealerName}`,
      );
    }
  } else {
    room.game.activeBidderId =
      room.game.bidOrder[room.game.bidIndex];
  }

  return res.json(publicRoom(room, String(playerId)));
});

app.post('/rooms/:id/play', (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room || !room.game) {
    return res.status(404).json({ error: 'room/game not found' });
  }

  const game = room.game;
  const { playerId, cardId } = req.body ?? {};

  if (game.stage !== 'playing' || !game.trumpSuit) {
    return res.status(409).json({ error: 'play is not active', stage: game.stage });
  }

  if (game.turnPlayerId !== String(playerId)) {
    return res.status(409).json({
      error: 'not your turn',
      turnPlayerId: game.turnPlayerId,
    });
  }

  const hand = game.hands[String(playerId)] ?? [];
  const card = hand.find((c) => c.id === String(cardId));

  if (!card) {
    return res.status(400).json({ error: 'card is not in your hand' });
  }

  // Ход в масть / обязательный козырь — RULES.md §10.1.
  const playable = playableCards(hand, game.currentTrick, game.trumpSuit);

  if (!playable.some((c) => c.id === card.id)) {
    return res.status(400).json({
      error: 'card is not allowed by the rules',
      playableCardIds: playable.map((c) => c.id),
    });
  }

  const trickNo = game.trickNumber;
  const outcome = playCard(room, String(playerId), card);

  if (outcome !== 'next_player' && game.lastTrick) {
    console.log(
      `[ROOM ${room.id}] trick ${trickNo} taken by ${game.lastTrick.winnerName}`,
    );
  }
  if (outcome === 'round_done' && game.result) {
    const summary = game.result
      .map((r) => `${r.playerName} ${r.declaration}: ${r.tricks} ${r.won ? 'WIN' : 'LOSE'}`)
      .join(', ');
    console.log(`[ROOM ${room.id}] round done: ${summary}`);
  }

  return res.json(publicRoom(room, String(playerId)));
});

// Борьба за спецкарту: взять за множитель или пасовать (RULES.md §7).
app.post('/rooms/:id/special', (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room || !room.game) {
    return res.status(404).json({ error: 'room/game not found' });
  }

  const game = room.game;
  const { playerId, action, risk } = req.body ?? {};

  if (game.stage !== 'special' || !game.special) {
    return res.status(409).json({ error: 'no special card contest', stage: game.stage });
  }

  const contest = game.special.contest;
  if (nextActor(contest) !== String(playerId)) {
    return res.status(409).json({ error: 'not your turn', activeId: nextActor(contest) });
  }

  if (action === 'pass') {
    game.special.contest = passCard(contest, String(playerId));
  } else if (action === 'take') {
    const value = Number(risk);
    if (!riskOptions(contest).includes(value)) {
      return res.status(400).json({ error: 'risk is not allowed', riskOptions: riskOptions(contest) });
    }
    // Проигрыш на спецкарте — кон × риск; денег должно хватать заранее (§6.6, §11.7).
    if (!canAffordSpecial(room, String(playerId), value)) {
      return res.status(400).json({ error: 'not enough coins for this risk', need: game.kon * value });
    }
    game.special.contest = takeCard(contest, String(playerId), value);
  } else {
    return res.status(400).json({ error: 'action must be take or pass' });
  }

  if (nextActor(game.special.contest) === null) {
    finishSpecial(room);
    const outcome = game.special.outcome;
    console.log(
      outcome === 'nobody'
        ? `[ROOM ${room.id}] спецкарту ${game.special.kind} не взял никто — обычные торги`
        : `[ROOM ${room.id}] спецкарта ${game.special.kind} у ${game.mains[0].playerName} на ×${(outcome as { risk: number }).risk}`,
    );
  }

  return res.json(publicRoom(room, String(playerId)));
});

// Владелец спецкарты сбрасывает одну свою карту — после этого начинается розыгрыш (§7.5).
app.post('/rooms/:id/discard', (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room || !room.game) {
    return res.status(404).json({ error: 'room/game not found' });
  }

  const game = room.game;
  const { playerId, cardId } = req.body ?? {};

  if (game.stage !== 'special_discard' || !game.special) {
    return res.status(409).json({ error: 'nothing to discard', stage: game.stage });
  }

  if (game.mains[0]?.playerId !== String(playerId)) {
    return res.status(403).json({ error: 'only the special card holder discards' });
  }

  const hand = game.hands[String(playerId)];
  const card = hand.find((c) => c.id === String(cardId));

  if (!card || card.id === game.special.card.id) {
    return res.status(400).json({ error: 'discard one of your own cards, not the special card' });
  }

  game.hands[String(playerId)] = hand.filter((c) => c.id !== card.id);
  game.discardedCard = card;
  startPlay(room);

  return res.json(publicRoom(room, String(playerId)));
});

// Выигравший КОН называет козырь: по РАЗ (масть РАЗ) или по ДВА (§6.7).
// До этого момента козырь не знает никто — trumpSuit пуст.
app.post('/rooms/:id/kon-trump', (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room || !room.game) {
    return res.status(404).json({ error: 'room/game not found' });
  }

  const game = room.game;
  const { playerId, suit } = req.body ?? {};

  if (game.stage !== 'kon_trump' || !game.razSuit) {
    return res.status(409).json({ error: 'not choosing КОН trump', stage: game.stage });
  }

  if (game.mains[0]?.playerId !== String(playerId)) {
    return res.status(403).json({ error: 'only the КОН player chooses trump' });
  }

  const options = konTrumpOptions(room.capacity as Capacity, game.razSuit);
  const choice = options.find((o) => o.suit === suit);

  if (!choice) {
    return res.status(400).json({ error: 'choose a trump suit', options });
  }

  game.konAs = choice.as;
  game.trumpSuit = choice.suit;
  startPlay(room);

  console.log(
    `[ROOM ${room.id}] КОН ${game.mains[0].playerName}: козырь ${choice.suit} (по ${choice.as})`,
  );

  return res.json(publicRoom(room, String(playerId)));
});

// Реакция-смайлик (RULES.md §14): только после раздачи и после закрытия комнаты.
app.post('/rooms/:id/react', (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room || !room.game) {
    return res.status(404).json({ error: 'room/game not found' });
  }

  const playerId = me(res).id;
  if (!room.players.some((p) => p.id === playerId)) {
    return res.status(403).json({ error: 'player is not in this room' });
  }

  const result = addReaction(room.reactions ?? [], room.game.stage, playerId, req.body?.emoji, Date.now());
  if (result === 'not now') {
    return res.status(409).json({ error: 'reactions only after a deal' });
  }
  if (result === 'unknown emoji') {
    return res.status(400).json({ error: 'unknown emoji' });
  }
  if (result === 'too fast') {
    return res.status(429).json({ error: 'too fast' });
  }

  room.reactions = result;
  return res.json({ ok: true });
});

// Голос «продолжаем» или «делим кон» (RULES.md §12.2).
app.post('/rooms/:id/vote', (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room || !room.game) {
    return res.status(404).json({ error: 'room/game not found' });
  }

  const game = room.game;
  const { playerId, choice } = req.body ?? {};

  if (game.stage !== 'vote' || !game.vote) {
    return res.status(409).json({ error: 'no vote in progress', stage: game.stage });
  }

  if (!room.players.some((p) => p.id === String(playerId))) {
    return res.status(403).json({ error: 'player is not in this room' });
  }

  if (choice !== 'continue' && choice !== 'split') {
    return res.status(400).json({ error: 'choice must be continue or split' });
  }

  if (game.vote.votes[String(playerId)]) {
    return res.status(409).json({ error: 'already voted' });
  }

  game.vote.votes[String(playerId)] = choice;
  applyVoteIfDecided(room);

  return res.json(publicRoom(room, String(playerId)));
});

// HTTP и Socket.IO слушают один и тот же порт.
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`GARBA backend running on :${PORT} (HTTP + Socket.IO)`);
});
