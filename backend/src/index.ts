import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
import { Server as SocketServer } from 'socket.io';

import {
  acceptFriend,
  dropRequests,
  friendRequests,
  friendStatus,
  requestFriend,
  deleteAccountData,
  markReferralPaid,
  unpaidInviter,
  addFriend,
  areFriends,
  cleanName,
  createAccount,
  findAccountByCode,
  findAccountByToken,
  getAccount,
  hasRecoveryCode,
  giftedOn,
  invitedCount,
  listFriends,
  openDb,
  recordGift,
  removeFriend,
  recoverAccount,
  replaceRecoveryCode,
  accountByLogin,
  addLogin,
  setBalance,
  issueToken,
  loginsOf,
  removeLogin,
  setDaily,
  tokenFromHeader,
  transaction,
  type Account,
} from './accounts.js';
import { createDeck, shuffle } from './deck.js';
import { loadUnfinishedRooms, profileStats, ratedPlayers, roomIdTaken, saveRoom, writeRoom } from './roomDb.js';
import { afterDeal, afterRoom, LEFT_GAME, ratingOf, shownRating, START_SKILL } from './rating.js';
import { addReaction, isPlayerCode, isRoomCode, type ReactionEntry } from './reactions.js';
import { addDeal, addMoney, emptyStats, roomWinners, type PlayerStats } from './stats.js';
import { avatarPath, detectImageType, loadAvatar, MAX_AVATAR_BYTES, saveAvatar } from './avatars.js';
import {
  dailyClaim,
  dayKey,
  giftError,
  normalizeCode,
  REFERRAL_BONUS,
  referralDue,
  REFERRAL_ROOMS,
} from './bonus.js';
import {
  absenceStep,
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
  refillPointless,
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
  passUnaffordable,
  passCard,
  riskOptions,
  specialKindOf,
  specialLeader,
  startContest,
  takeCard,
  type Contest,
  type SpecialKind,
} from './special.js';
import { betweenDeals, seatFor, vacancyExpired, vacancySecondsLeft, type Vacancy } from './seats.js';
import { JwksCache, PROVIDER_INFO, PROVIDERS, tokenKid, verifyIdToken, type Provider } from './oauth.js';
import { canProposeEnd, endVoteOutcome, END_VOTE_MS, type EndVote } from './endVote.js';
import {
  markReady,
  READY_MS,
  readyOutcome,
  readySecondsLeft,
  startReadyCheck,
  type ReadyCheck,
} from './readyCheck.js';
import { rateCheck } from './rateLimit.js';
import { openRoomsFor, QUICK_ROOM } from './openRooms.js';
import {
  addMiss,
  clockFor,
  pickRandom,
  TURN_SECONDS_OPTIONS,
  turnMsFor,
  turnSecondsLeft,
  type TurnClock,
} from './turnTimer.js';
import {
  canConcede,
  mainStatuses,
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
  // Место за столом 0…capacity−1 по кругу против часовой (24.09.2026): где сел — там и
  // играет. room.players всегда отсортирован по месту. Нет — комната до этого решения.
  seat?: number;
};

// finished — комната закрыта, играть в ней больше нельзя (RULES.md §12).
type RoomStatus = 'lobby' | 'started' | 'finished';

// Настройки, которые выбирает создатель комнаты (RULES.md §9.1, §9.3, §6.7).
type RoomSettings = {
  ante: number; // взнос, 100…1000, кратен 100
  emptyLimit: number; // лимит пустых раздач подряд, 3…10
  konThreshold: number; // КОН открывается при коне ≥ базовый × это число, 3…10
  minBalance: number; // минимум денег для входа, 1 000…10 000, не меньше взноса × 10
  turnSeconds?: number; // время на ход, 20 или 40 (§13a); нет — 20 (старые комнаты)
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
  // Сдался посреди раздачи (§10.7): платит как при проигрыше.
  conceded: boolean;
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
  // Всеобщий ПАС, а на РАЗ не хватает ни у кого — доливать бессмысленно (§9.2a).
  noRaz?: boolean;
};

// Завершённая взятка: какие карты легли и кто её забрал.
type PlayedTrick = { cards: TrickCard[]; winnerId: string; winnerName: string };

type GameState = {
  stage: Stage;
  dealerId: string;
  dealerName: string;
  revealLog: RevealCard[];
  // Номер попытки раздачи. Клиент использует его как стабильный ключ анимации,
  // в том числе когда три ИЗЖОГИ не дали открытой карты.
  dealNumber: number;

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
  // Главные, которые сдались в этой раздаче (§10.7). Нет в старых сохранённых комнатах.
  concededIds?: string[];
  // Закончить игру по согласию (§12.3): идущее голосование, кто уже предлагал между
  // этими раздачами, чем кончилось последнее. Нет в старых сохранённых комнатах.
  endVote?: EndVote | null;
  endProposedIds?: string[];
  lastEndVote?: { result: 'rejected' | 'expired'; byName: string | null } | null;
  // Время на ход (§13a): сколько раз подряд за игрока сходил таймер и кто «ушёл» —
  // с какого момента идёт его 5-минутный отсчёт. Нет в старых сохранённых комнатах.
  missedTurns?: Record<string, number>;
  awayAt?: Record<string, number>;
  // Запас 5 минут на отсутствие — на всю игру (§13, §13a): сколько уже потрачено.
  absenceUsedMs?: Record<string, number>;
  // Кто-то опустился ниже базового кона — доигрываем, пока кон не заберут (§12.1).
  closing: boolean;
  // Почему закрылась комната: кон забрали (§12.1), кон никто не может взять
  // и его поделили поровну (§12.2) или игрок отключился и не вернулся за 5 минут (§13).
  // seat_empty — место пустовало 10 минут, никто не сел (24.09.2026).
  closeReason: 'kon_taken' | 'nobody_can_play' | 'player_left' | 'agreed_end' | 'seat_empty' | null;
  // Пропали на 5 минут посреди раздачи: за них доигрывает таймер, после раздачи —
  // место свободно (24.09.2026).
  goneIds?: string[];
  // Последний ушедший и как разделили кон — для окна на столе.
  lastLeave?: {
    playerId: string;
    name: string;
    reason: 'left' | 'gone';
    kon: number;
    perPlayer: number;
    remainder: number;
    remainderTo: string | null;
  } | null;
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
  // Свободные места посреди игры — ждём замену 10 минут (24.09.2026).
  vacancies?: (Vacancy & { wasDealer: boolean })[];
  // Кто ушёл из этой комнаты посреди игры — комната для него не «доиграна».
  departedIds?: string[];
  // Лобби набралось — ждём «ГОТОВ» от всех (решение владельца, 23.09.2026).
  readyCheck?: ReadyCheck | null;
  // Кто вышел, не нажав «ГОТОВ» в прошлый раз, — чтобы его телефон сказал почему.
  readyDroppedIds?: string[];
  game?: GameState;
  // Статистика игроков за эту комнату (ТЗ §35, этап 9.4). Заводится при старте игры.
  stats?: Record<string, PlayerStats>;
  // Рейтинг игроков за столом (RULES.md §16, этап 9.6). Мастерство меняется здесь и
  // сохраняется в аккаунт вместе с комнатой — как баланс. startSkill и startDeals —
  // с чем игрок сел за стол: от них «Рейтинг 4.0 → 4.9» в итогах.
  rating?: Record<string, { skill: number; startSkill: number; startDeals: number }>;
  // Последние реакции-смайлики (RULES.md §14, этап 9.7).
  reactions?: ReactionEntry[];
  // Открытая комната — видна всем в списке, войти можно без кода (19.09.2026).
  isPublic?: boolean;
};

const app = express();
// Порт можно переопределить — это нужно проверке сокетов (tests/live-socket.ts),
// чтобы поднять отдельный сервер и не мешать тому, что работает на 3000.
const PORT = Number(process.env.PORT ?? 3000);
const rooms = new Map<string, Room>();

app.use(cors());
// За Caddy (https) все запросы приходят с 127.0.0.1 — настоящий адрес игрока Caddy кладёт
// в X-Forwarded-For. Верим ему только от локального прокси.
app.set('trust proxy', 'loopback');
app.use(express.json());

// --- Аккаунты (этап 9.1) и сохранение комнат (этап 9.2) ---
//
// Файл базы — backend/data/garba.db, путь можно сменить переменной GARBA_DB
// (':memory:' — база в памяти, для проверок). В базе аккаунты и комнаты:
// после перезапуска сервера недоигранные комнаты поднимаются обратно.
const DB_FILE = process.env.GARBA_DB ?? 'data/garba.db';
if (DB_FILE !== ':memory:') mkdirSync(dirname(DB_FILE), { recursive: true });
const db = openDb(DB_FILE);

for (const room of loadUnfinishedRooms<Room>(db)) {
  // Сервер лежал — 30 секунд на «ГОТОВ» начнутся заново (проверка готовности ниже).
  room.readyCheck = null;
  // Комнаты до выбора мест: место — по порядку, в котором уже сидят.
  room.players.forEach((p, i) => (p.seat ??= i));
  rooms.set(room.id, room);
}
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
// Вызывается после ответа игроку и из таймеров, где ошибку некому поймать: брошенная
// дальше, она уронила бы весь сервер. Поэтому только пишем в журнал — комната цела
// в памяти, и следующее сохранение запишет её целиком.
function persistRoom(room: Room) {
  try {
    saveRoom(db, room);
    if (room.status === 'finished') payReferrals(room);
  } catch (e) {
    console.error(`[ROOM ${room.id}] save to database failed:`, e);
  }
}

// Комната доиграна: кто из её игроков пришёл по приглашению и уже доиграл 3 комнаты —
// пригласившему +1 000, один раз (решение владельца правил, 19.09.2026).
const referralsChecked = new Set<string>();
function payReferrals(room: Room) {
  if (referralsChecked.has(room.id)) return;
  for (const p of room.players) {
    const inviterId = unpaidInviter(db, p.id);
    if (!inviterId || !referralDue(profileStats(db, p.id).rooms, false)) continue;
    moveCoins([{ accountId: inviterId, delta: REFERRAL_BONUS }], () => markReferralPaid(db, p.id));
    console.log(`[REFERRAL] ${p.name} доиграл ${REFERRAL_ROOMS} комнаты — пригласившему +${REFERRAL_BONUS}`);
  }
  // Отмечаем после выплат: не прошла — попробуем при следующем сохранении
  // (дважды не заплатим — выплаченный помечен в базе, markReferralPaid).
  referralsChecked.add(room.id);
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
// телефон обязан его сохранить. inviteCode — код пригласившего (ТЗ §4): его 1 000
// придут, когда новый игрок доиграет 3 комнаты (payReferrals).
// Новые аккаунты с одного адреса: не больше 5 в час и 20 в сутки. Каждый аккаунт —
// 10 000 монет; без лимита их штамповали бы скриптом. Числа меняются переменными
// окружения — например, если у мобильного оператора много игроков за одним адресом.
const ACCOUNT_LIMITS = [
  { max: Number(process.env.GARBA_ACCOUNTS_PER_HOUR ?? 5), windowMs: 3_600_000 },
  { max: Number(process.env.GARBA_ACCOUNTS_PER_DAY ?? 20), windowMs: 86_400_000 },
];
const accountsByIp = new Map<string, number[]>();
const recoveriesByIp = new Map<string, number[]>();

app.post('/accounts', (req, res) => {
  const ip = req.ip ?? 'unknown';
  const limit = rateCheck(accountsByIp.get(ip) ?? [], Date.now(), ACCOUNT_LIMITS);
  // Свой же компьютер (проверки, боты) — без лимита. Игроки из интернета приходят через
  // Caddy со своим адресом, а напрямую к серверу снаружи не достучаться (HOST=127.0.0.1).
  if (!limit.allowed && !LOOPBACK.includes(ip)) {
    return res.status(429).json({ error: 'too many accounts, try later' });
  }

  const name = cleanName(req.body?.name);
  if (!name) {
    return res.status(400).json({ error: 'name must be 1 to 20 characters' });
  }

  const inviteCode = normalizeCode(req.body?.inviteCode);
  const inviter = inviteCode ? findAccountByCode(db, inviteCode) : null;
  if (inviteCode && !inviter) {
    return res.status(400).json({ error: 'invite code not found' });
  }

  const { account, token, recoveryCode } = createAccount(db, name, inviter?.id ?? null);
  accountsByIp.set(ip, limit.times);

  console.log(
    `[ACCOUNT] created ${account.name} (${account.id})` +
      (inviter ? `, invited by ${inviter.name} (бонус — после 3 комнат)` : ''),
  );

  return res.status(201).json({ ...account, token, recoveryCode });
});

// Восстановление без телефона и почты: публичный код игрока + секретный код,
// который был показан при регистрации или заново создан в профиле. Ответ одинаков
// для неверного игрока и неверного секрета, чтобы нельзя было перебирать аккаунты.
app.post('/accounts/recover', (req, res) => {
  const ip = req.ip ?? 'unknown';
  const limit = rateCheck(recoveriesByIp.get(ip) ?? [], Date.now(), [
    { max: 5, windowMs: 15 * 60_000 },
    { max: 20, windowMs: 86_400_000 },
  ]);
  recoveriesByIp.set(ip, limit.times);
  if (!limit.allowed && !LOOPBACK.includes(ip)) {
    return res.status(429).json({ error: 'too many recovery attempts, try later' });
  }

  const playerCode = normalizeCode(req.body?.playerCode);
  const recovered = playerCode ? recoverAccount(db, playerCode, req.body?.recoveryCode) : null;
  if (!recovered) {
    return res.status(401).json({ error: 'invalid recovery credentials' });
  }
  console.log(`[ACCOUNT] recovered ${recovered.account.name} (${recovered.account.id})`);
  return res.json({ ...recovered.account, token: recovered.token, recoveryCode: recovered.recoveryCode });
});

// --- Вход через Google и Apple (23.09.2026, src/oauth.ts) ---
//
// Для кого выдан токен (aud): Google — идентификаторы клиентов iOS/Android/сервера из
// Google Cloud, Apple — bundle id приложения. Не задано — вход этим способом выключен (503).
// Адреса ключей меняются только для проверок (tests/live-socket.ts).
const LOGIN_AUDIENCES: Record<Provider, string[]> = {
  google: (process.env.GARBA_GOOGLE_CLIENT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  apple: (process.env.GARBA_APPLE_CLIENT_IDS ?? 'kz.garba.app').split(',').map((s) => s.trim()).filter(Boolean),
};
const loginKeys: Record<Provider, JwksCache> = {
  google: new JwksCache(process.env.GARBA_GOOGLE_JWKS_URL ?? PROVIDER_INFO.google.jwksUrl),
  apple: new JwksCache(process.env.GARBA_APPLE_JWKS_URL ?? PROVIDER_INFO.apple.jwksUrl),
};
const loginsByIp = new Map<string, number[]>();

async function checkLogin(provider: Provider, idToken: unknown) {
  const keys = await loginKeys[provider].get(tokenKid(idToken));
  return verifyIdToken(idToken, {
    issuers: PROVIDER_INFO[provider].issuers,
    audiences: LOGIN_AUDIENCES[provider],
    keys,
    nowS: Math.floor(Date.now() / 1000),
  });
}

function loginProvider(raw: string): Provider | null {
  return (PROVIDERS as string[]).includes(raw) ? (raw as Provider) : null;
}

// Войти через Google/Apple. Привязан к аккаунту — новый токен, прежний телефон выходит.
// Не привязан: без name — 404 (приложение спросит имя, suggestedName — подсказка из Google),
// с name — новый аккаунт с этим входом (те же лимиты и приглашение, что у /accounts).
app.post('/auth/:provider', async (req, res) => {
  const provider = loginProvider(req.params.provider);
  if (!provider) return res.status(404).json({ error: 'unknown provider' });
  if (LOGIN_AUDIENCES[provider].length === 0) return res.status(503).json({ error: 'login not configured' });

  const ip = req.ip ?? 'unknown';
  const limit = rateCheck(loginsByIp.get(ip) ?? [], Date.now(), [{ max: 30, windowMs: 15 * 60_000 }]);
  loginsByIp.set(ip, limit.times);
  if (!limit.allowed && !LOOPBACK.includes(ip)) {
    return res.status(429).json({ error: 'too many attempts, try later' });
  }

  let checked;
  try {
    checked = await checkLogin(provider, req.body?.idToken);
  } catch (e) {
    console.error(`[AUTH] ${provider}: keys unavailable`, e);
    return res.status(503).json({ error: 'login provider unavailable' });
  }
  if (!checked.ok) return res.status(401).json({ error: 'invalid token', reason: checked.error });

  const linked = accountByLogin(db, provider, checked.sub);
  if (linked) {
    const token = issueToken(db, linked.id);
    console.log(`[AUTH] ${linked.name} вошёл через ${provider}`);
    return res.json({ ...linked, token, created: false });
  }

  if (req.body?.name === undefined) {
    return res.status(404).json({ error: 'no account for this login', suggestedName: checked.name });
  }
  const accLimit = rateCheck(accountsByIp.get(ip) ?? [], Date.now(), ACCOUNT_LIMITS);
  if (!accLimit.allowed && !LOOPBACK.includes(ip)) {
    return res.status(429).json({ error: 'too many accounts, try later' });
  }
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'name must be 1 to 20 characters' });
  const inviteCode = normalizeCode(req.body?.inviteCode);
  const inviter = inviteCode ? findAccountByCode(db, inviteCode) : null;
  if (inviteCode && !inviter) return res.status(400).json({ error: 'invite code not found' });

  const created = transaction(db, () => {
    const c = createAccount(db, name, inviter?.id ?? null);
    addLogin(db, c.account.id, provider, checked.sub);
    return c;
  });
  accountsByIp.set(ip, accLimit.times);
  console.log(`[AUTH] новый аккаунт ${name} через ${provider}`);
  return res.status(201).json({ ...created.account, token: created.token, recoveryCode: created.recoveryCode, created: true });
});

// Привязать Google/Apple к своему аккаунту (из профиля).
app.post('/me/logins/:provider', async (req, res) => {
  const account = accountOf(req);
  if (!account) return res.status(401).json({ error: 'unauthorized' });
  const provider = loginProvider(req.params.provider);
  if (!provider) return res.status(404).json({ error: 'unknown provider' });
  if (LOGIN_AUDIENCES[provider].length === 0) return res.status(503).json({ error: 'login not configured' });

  let checked;
  try {
    checked = await checkLogin(provider, req.body?.idToken);
  } catch (e) {
    console.error(`[AUTH] ${provider}: keys unavailable`, e);
    return res.status(503).json({ error: 'login provider unavailable' });
  }
  if (!checked.ok) return res.status(401).json({ error: 'invalid token', reason: checked.error });

  const result = addLogin(db, account.id, provider, checked.sub);
  if (result === 'taken') return res.status(409).json({ error: 'login belongs to another account' });
  if (result === 'already') return res.status(409).json({ error: 'another login already linked' });
  console.log(`[AUTH] ${account.name}: привязан ${provider}`);
  return res.json({ logins: loginsOf(db, account.id) });
});

// Отвязать Google/Apple.
app.delete('/me/logins/:provider', (req, res) => {
  const account = accountOf(req);
  if (!account) return res.status(401).json({ error: 'unauthorized' });
  if (!removeLogin(db, account.id, req.params.provider)) return res.status(404).json({ error: 'not linked' });
  console.log(`[AUTH] ${account.name}: отвязан ${req.params.provider}`);
  return res.json({ logins: loginsOf(db, account.id) });
});

// Выпустить новый код можно только из уже открытого аккаунта. Сам код сервер
// возвращает один раз; в базе остаётся лишь его хеш.
app.post('/me/recovery-code', (req, res) => {
  const account = accountOf(req);
  if (!account) return res.status(401).json({ error: 'unauthorized' });
  const recoveryCode = replaceRecoveryCode(db, account.id);
  return res.json({ recoveryCode });
});

// Удалить аккаунт навсегда (требование Apple и Google). Пока игрок сидит в
// незаконченной комнате — нельзя: его деньги в игре, сначала доиграть.
app.delete('/me', (req, res) => {
  const account = accountOf(req);
  if (!account) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const room = activeRoomOf(account.id);
  if (room) {
    return res.status(409).json({ error: 'finish your game first', roomId: room.id });
  }
  transaction(db, () => deleteAccountData(db, account.id));
  console.log(`[ACCOUNT] deleted ${account.name} (${account.id})`);
  return res.json({ ok: true });
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
    // Сколько человек зовут меня в друзья — цифра у кнопки «ДРУЗЬЯ».
    friendRequests: friendRequests(db, account.id).incoming.length,
    hasRecoveryCode: hasRecoveryCode(db, account.id),
    // К чему привязан аккаунт: ['google'], ['apple'], оба или пусто.
    logins: loginsOf(db, account.id),
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
//   /i/<код игрока>     — приглашение друга (пригласивший получит 1 000 после 3 комнат друга)

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
    hasRecoveryCode: hasRecoveryCode(db, account.id),
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
    // friends | outgoing (я позвал) | incoming (он зовёт меня) | none
    friendStatus: friendStatus(db, me.id, player.id),
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
  // Дружба — только с согласия второго: отправляем заявку (решение владельца, 19.09.2026).
  // Он уже звал меня — сразу друзья.
  const result = requestFriend(db, me.id, friend.id);
  if (result === 'already friends') {
    return res.status(409).json({ error: 'already friends' });
  }
  if (result === 'already sent') {
    return res.status(409).json({ error: 'request already sent' });
  }
  console.log(`[FRIENDS] ${me.name} → ${friend.name}: ${result === 'friends' ? 'друзья' : 'заявка'}`);
  return res
    .status(result === 'friends' ? 201 : 202)
    .json({ status: result, code: friend.code, name: friend.name });
});

// Заявки в друзья: кто зовёт меня и кого зову я.
app.get('/friends/requests', (req, res) => {
  const me = accountOf(req);
  if (!me) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const { incoming, outgoing } = friendRequests(db, me.id);
  const card = (a: Account) => ({
    code: a.code,
    name: a.name,
    avatar: avatarPath(db, a.id),
    rating: shownRating(accountRating(a.id)),
  });
  return res.json({ incoming: incoming.map(card), outgoing: outgoing.map(card) });
});

// Принять заявку, отклонить её или отменить свою. Отклонённому ничего не сообщаем.
app.post('/friends/requests/:code/:action', (req, res) => {
  const me = accountOf(req);
  if (!me) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const other = findAccountByCode(db, normalizeCode(req.params.code));
  if (!other) {
    return res.status(404).json({ error: 'player not found' });
  }
  const status = friendStatus(db, me.id, other.id);
  const action = req.params.action;
  if (action === 'accept' && status === 'incoming') {
    acceptFriend(db, me.id, other.id);
    console.log(`[FRIENDS] ${me.name} + ${other.name}`);
    return res.json({ status: 'friends' });
  }
  if ((action === 'decline' && status === 'incoming') || (action === 'cancel' && status === 'outgoing')) {
    dropRequests(db, me.id, other.id);
    return res.json({ status: 'none' });
  }
  return res.status(404).json({ error: 'no such request' });
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
// Начислить или списать монеты вручную (решение владельца, 23.09.2026) — для проверок
// и помощи игрокам. Только с этого же компьютера: в интернете все запросы идут через
// Caddy и несут X-Forwarded-For, такие отклоняются. Через moveCoins — как бонус и подарок,
// поэтому начисление игроку за столом не затрётся и не посчитается выигрышем.
app.post('/admin/coins', (req, res) => {
  if (!LOOPBACK.includes(req.socket.remoteAddress ?? '') || req.headers['x-forwarded-for'] !== undefined) {
    return res.status(403).json({ error: 'local only' });
  }
  const account = findAccountByCode(db, normalizeCode(req.body?.code) ?? '') ?? getAccount(db, String(req.body?.id ?? ''));
  if (!account) return res.status(404).json({ error: 'player not found' });
  const amount = Number(req.body?.amount);
  if (!Number.isInteger(amount) || amount === 0 || account.balance + amount < 0) {
    return res.status(400).json({ error: 'bad amount' });
  }
  moveCoins([{ accountId: account.id, delta: amount }]);
  const balance = getAccount(db, account.id)!.balance;
  console.log(`[ADMIN] ${account.name}: ${amount > 0 ? '+' : ''}${amount} → ${balance}`);
  return res.json({ name: account.name, amount, balance });
});

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
// Ход за игрока по таймеру (§13a) сервер делает запросом самому себе — через те же
// проверки, запись в базу и рассылку, что и ход человека. Пропуск — случайный секрет
// этого процесса, принимается только с этого же компьютера.
const INTERNAL_SECRET = randomBytes(24).toString('hex');
const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

function internalAccount(req: express.Request): Account | null {
  if (req.headers['x-garba-internal'] !== INTERNAL_SECRET) return null;
  if (!LOOPBACK.includes(req.socket.remoteAddress ?? '')) return null;
  // Пришёл через Caddy (из интернета) — не внутренний, какой бы заголовок ни прислали.
  if (req.headers['x-forwarded-for'] !== undefined) return null;
  return getAccount(db, String(req.headers['x-garba-player'] ?? ''));
}

app.use('/rooms', (req, res, next) => {
  const internal = internalAccount(req);
  res.locals.internal = !!internal;
  const account = internal ?? findAccountByToken(db, tokenFromHeader(req.headers.authorization));
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

    // Игрок сам открыл стол — значит, вернулся: «ушёл» снимается (§13a), иначе
    // пауза держалась бы, пока он не найдёт кнопку «Я ЗДЕСЬ».
    if (room.game?.awayAt?.[playerId] !== undefined && room.players.some((p) => p.id === playerId)) {
      markBack(room, playerId);
      persistRoom(room);
      broadcastRoom(room.id).catch((e) => console.error(`[ROOM ${room.id}] broadcast failed:`, e));
    }
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
// С какого момента идёт текущее отсутствие игрока — только в памяти: после перезапуска
// сервера текущий отрезок не засчитывается (в пользу игрока).
const absentSince = new Map<string, Record<string, number>>();

function presenceOf(roomId: string): PresenceState {
  return presence.get(roomId) ?? { lastSeen: {}, disconnectedAt: {} };
}

// Присутствие считается только за столом: в лобби игры ещё нет, после конца — уже нет.
function tracksPresence(room: Room): boolean {
  return room.status === 'started' && !!room.game && room.game.stage !== 'room_done';
}

// Кто сейчас отсутствует: нет связи (§13) или «ушёл» по таймеру (§13a).
function absentIds(room: Room): string[] {
  const { disconnectedAt } = presenceOf(room.id);
  const awayAt = room.game?.awayAt ?? {};
  const gone = room.game?.goneIds ?? [];
  return room.players
    .map((p) => p.id)
    .filter((id) => !gone.includes(id))
    .filter((id) => disconnectedAt[id] !== undefined || awayAt[id] !== undefined);
}

// Запас 5 минут на всю игру: сколько у кого осталось и чьё время вышло.
function absenceOf(room: Room, now: number) {
  return absenceStep(
    room.players.map((p) => p.id),
    absentIds(room),
    absentSince.get(room.id) ?? {},
    room.game?.absenceUsedMs ?? {},
    now,
    presenceOpts.timeoutMs,
  );
}

// Пауза: кто-то отключился или «ушёл» (кроме пропавших — за них ходит таймер), или
// есть свободное место — ждём нового игрока (24.09.2026).
function isPaused(room: Room): boolean {
  if (!tracksPresence(room)) return false;
  return absentIds(room).length > 0 || (room.vacancies?.length ?? 0) > 0;
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

// Игрок ушёл из игры (24.09.2026): «Выйти» между раздачами или пропал на 5 минут.
// Кон сразу делится между оставшимися (остаток — тому, кто больше всех проиграл, как в
// §12.2), ушедшему −1.0 рейтинга (§16.3a), его место ждёт нового игрока 10 минут.
// Новый игрок садится с пустым коном — в следующей раздаче все снова вносят взнос.
function vacateSeat(room: Room, playerId: string, reason: 'left' | 'gone') {
  const game = room.game!;
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return;
  const rest = room.players.filter((p) => p.id !== playerId);

  const { shares, perPlayer, remainder, remainderTo } = splitKon(
    game.kon,
    rest.length > 0 ? rest.map((p) => ({ id: p.id, lost: p.startBalance - p.balance })) : [],
  );
  for (const p of rest) {
    p.balance += shares[p.id];
    recordMoney(room, p.id, shares[p.id]);
  }
  game.lastLeave = { playerId, name: player.name, reason, kon: game.kon, perPlayer, remainder, remainderTo };
  if (rest.length > 0) game.kon = 0;

  const r = ratingState(room, playerId);
  r.skill = Math.max(0, r.skill + LEFT_GAME);

  // Его баланс уходит с ним: пишем в аккаунт сейчас — комната его больше не сохраняет.
  setBalance(db, playerId, player.balance);
  room.departedIds = [...(room.departedIds ?? []).filter((id) => id !== playerId), playerId];
  room.vacancies = [
    ...(room.vacancies ?? []),
    { seat: player.seat ?? 0, since: Date.now(), wasDealer: game.dealerId === playerId },
  ];
  room.players = rest;

  // Всё, что про него помнила пауза и таймер хода.
  const drop = <T>(rec: Record<string, T> | undefined) => {
    if (!rec) return rec;
    const copy = { ...rec };
    delete copy[playerId];
    return copy;
  };
  game.awayAt = drop(game.awayAt);
  game.missedTurns = drop(game.missedTurns);
  game.absenceUsedMs = drop(game.absenceUsedMs);
  game.goneIds = (game.goneIds ?? []).filter((id) => id !== playerId);
  const pres = presence.get(room.id);
  if (pres) presence.set(room.id, { lastSeen: drop(pres.lastSeen)!, disconnectedAt: drop(pres.disconnectedAt)! });
  absentSince.set(room.id, drop(absentSince.get(room.id)) ?? {});

  console.log(
    `[ROOM ${room.id}] ${player.name} ${reason === 'left' ? 'вышел из игры' : 'не вернулся за 5 минут'} — ` +
      `кон ${game.lastLeave.kon} разделён: по ${perPlayer}, место ${player.seat} свободно`,
  );
  if (rest.length === 0) {
    game.stage = 'room_done';
    game.closeReason = 'seat_empty';
    room.status = 'finished';
  }
}

// Пропал на 5 минут посреди раздачи: главный — сразу проигрыш (как сдался, §10.7),
// дальше за него доигрывает таймер хода; после раздачи место освобождается.
function markGone(room: Room, playerId: string) {
  const game = room.game!;
  if (game.goneIds?.includes(playerId)) return;
  game.goneIds = [...(game.goneIds ?? []), playerId];
  const name = room.players.find((p) => p.id === playerId)?.name;
  console.log(`[ROOM ${room.id}] ${name} не вернулся за 5 минут — доигрываем раздачу за него`);
  if (concedeAllowed(game, playerId)) concede(room, playerId);
}

// Место пустует 10 минут — никто не сел: игра заканчивается, кон (обычно уже пуст —
// его разделили при уходе) делится между оставшимися. Для проверок — GARBA_VACANCY_MS.
const vacancyMs = Number(process.env.GARBA_VACANCY_MS ?? 10 * 60_000);

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.status !== 'started' || !room.game || !room.vacancies?.length) continue;
    if (!vacancyExpired(room.vacancies, now, vacancyMs)) continue;
    closeWithSplit(room, 'seat_empty');
    room.vacancies = [];
    console.log(`[ROOM ${room.id}] место пустовало ${vacancyMs / 60_000} мин — игра закончена`);
    persistRoom(room);
    broadcastRoom(room.id).catch((e) => console.error(`[ROOM ${room.id}] broadcast failed:`, e));
  }
}, 1000);

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

    // Общий запас 5 минут на всю игру — и на потерю связи, и на «ушёл» (§13, §13a).
    const absence = absenceOf(room, now);
    absentSince.set(room.id, absence.since);
    const usedChanged =
      JSON.stringify(absence.usedMs) !== JSON.stringify(room.game!.absenceUsedMs ?? {});
    room.game!.absenceUsedMs = absence.usedMs;
    const expired = absence.expired;

    // Пропавшие посреди раздачи: раздача сыграна — освобождаем места.
    const gone = room.game!.goneIds ?? [];
    const goneNow = betweenDeals(room.game!.stage) ? gone : [];

    if (expired.length > 0 || goneNow.length > 0) {
      for (const id of goneNow) vacateSeat(room, id, 'gone');
      for (const id of expired) {
        if (!room.players.some((p) => p.id === id)) continue;
        if (betweenDeals(room.game!.stage)) vacateSeat(room, id, 'gone');
        else markGone(room, id);
      }
    } else if (step.changed || usedChanged) {
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

// Голосование «закончить игру» без ответа 30 секунд — считается «нет» (§12.3).
// Проверяем раз в секунду, иначе при раздающем-боте оно висело бы, пока кто-то не нажмёт.
setInterval(() => {
  for (const room of rooms.values()) {
    if (!room.game?.endVote) continue;
    settleEndVote(room);
    if (!room.game.endVote) {
      persistRoom(room);
      broadcastRoom(room.id).catch((e) => console.error(`[ROOM ${room.id}] broadcast failed:`, e));
    }
  }
}, 1000);

// Запрос игрока к своей комнате — тоже знак, что он на месте (приложение без сокета
// опрашивает сервер). На паузе ходы не принимаются: ждём отключившегося.
const LOBBY_ACTIONS = ['/join', '/leave', '/ready', '/back', '/react'];
app.use('/rooms/:id', (req, res, next) => {
  const room = rooms.get(req.params.id);
  if (!room || !tracksPresence(room)) return next();

  const playerId = me(res).id;
  // Ход по таймеру (§13a) — не знак, что игрок на связи: его делает сервер.
  if (room.players.some((p) => p.id === playerId) && !res.locals.internal) {
    presence.set(room.id, touch(presenceOf(room.id), playerId, Date.now()));
    // Сам что-то нажал — он за столом: пропуски с нуля, «ушёл» снимается,
    // пауза из-за него — тоже (§13a).
    if (req.method === 'POST') markBack(room, playerId);
  }

  // Ждём только замену (все за столом на месте) — закончить игру по согласию можно.
  const onlyVacancy = absentIds(room).length === 0;
  if (req.method === 'POST' && req.path === '/end-game' && onlyVacancy) return next();
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
  const awayAt = room.game?.awayAt ?? {};
  const absence = absenceOf(room, now);
  const absent = absentIds(room);
  return {
    // Свободные места — ждём нового игрока, сколько секунд осталось до конца игры.
    vacancies: (room.vacancies ?? []).map((v) => ({ seat: v.seat, secondsLeft: vacancySecondsLeft(v, now, vacancyMs) })),
    players: room.players
      .filter((p) => absent.includes(p.id))
      .map((p) => ({
        id: p.id,
        name: p.name,
        // offline — пропала связь (§13); away — связь есть, но два хода подряд за него
        // сходил таймер (§13a). Вернуться — нажать «Я ЗДЕСЬ».
        reason: disconnectedAt[p.id] !== undefined ? 'offline' : 'away',
        // Остаток общего запаса на всю игру (§13a): отходил раньше — осталось меньше 5 минут.
        secondsLeft: Math.ceil((absence.msLeft[p.id] ?? 0) / 1000),
      })),
  };
}

// --- Время на ход (§13a) ---

// Время на ход — из настроек комнаты (§13a). GARBA_TURN_MS — для проверок, сразу всем.
const TEST_TURN_MS = process.env.GARBA_TURN_MS ? Number(process.env.GARBA_TURN_MS) : null;
const turnMsOf = (room: Room) => TEST_TURN_MS ?? turnMsFor(room.settings.turnSeconds);
const turnClocks = new Map<string, TurnClock>();
const turnBusy = new Set<string>();

type TimedMove = { playerId: string; path: string; body: Record<string, unknown> };

// Кого сейчас ждём и что сделать за него, если не успел. key меняется, как только
// ждём другого решения, — тогда отсчёт 20 секунд начинается заново.
function awaitedMoves(room: Room): { key: string; moves: TimedMove[] } | null {
  const g = room.game;
  if (!g || room.status !== 'started') return null;

  switch (g.stage) {
    case 'dealer_found':
    case 'awaiting_deal':
    case 'round_done':
      // Пока голосуют «закончить игру», раздавать нельзя — ждём итога (§12.3).
      if (g.endVote) return null;
      return {
        key: `deal:${g.stage}:${g.dealerId}:${g.kon}:${g.emptyStreak}`,
        moves: [{ playerId: g.dealerId, path: 'dealer/continue', body: {} }],
      };
    case 'bidding':
      if (!g.activeBidderId) return null;
      return {
        key: `bid:${g.bids.length}:${g.activeBidderId}`,
        moves: [{ playerId: g.activeBidderId, path: 'bid', body: { bid: 'ПАС' } }],
      };
    case 'playing': {
      const id = g.turnPlayerId;
      if (!id || !g.trumpSuit) return null;
      const cards = playableCards(g.hands[id] ?? [], g.currentTrick, g.trumpSuit);
      if (cards.length === 0) return null;
      return {
        key: `play:${g.playedTricks.length}:${g.currentTrick.length}:${id}`,
        moves: [{ playerId: id, path: 'play', body: { cardId: pickRandom(cards).id } }],
      };
    }
    case 'special': {
      const id = g.special ? nextActor(g.special.contest) : null;
      if (!id) return null;
      const c = g.special!.contest;
      return {
        key: `special:${c.phase}:${c.passed.length}:${c.holderId}:${c.risk}:${id}`,
        moves: [{ playerId: id, path: 'special', body: { action: 'pass' } }],
      };
    }
    case 'special_discard': {
      const id = g.mains[0]?.playerId;
      if (!id || !g.special) return null;
      const options = (g.hands[id] ?? []).filter((c) => c.id !== g.special!.card.id);
      if (options.length === 0) return null;
      return {
        key: `discard:${id}`,
        moves: [{ playerId: id, path: 'discard', body: { cardId: pickRandom(options).id } }],
      };
    }
    case 'kon_trump': {
      const id = g.mains[0]?.playerId;
      if (!id || !g.razSuit) return null;
      const options = konTrumpOptions(room.capacity as Capacity, g.razSuit);
      const asRaz = options.find((o) => o.as === 'РАЗ') ?? options[0];
      return {
        key: `kon:${id}`,
        moves: [{ playerId: id, path: 'kon-trump', body: { suit: asRaz.suit } }],
      };
    }
    case 'vote': {
      if (!g.vote) return null;
      // Молчание в голосовании — «делим» (решение владельца правил).
      const silent = room.players.filter((p) => !g.vote!.votes[p.id]);
      return {
        key: `vote:${g.dealerId}:${g.kon}`,
        moves: silent.map((p) => ({ playerId: p.id, path: 'vote', body: { choice: 'split' } })),
      };
    }
    default:
      return null;
  }
}

// Часы хода этой комнаты. Заводятся, как только появилось новое решение, которого ждём.
function turnClockOf(room: Room): TurnClock | null {
  if (isPaused(room)) return null;
  const awaited = awaitedMoves(room);
  const clock = clockFor(turnClocks.get(room.id), awaited?.key ?? null, Date.now());
  if (clock) turnClocks.set(room.id, clock);
  else turnClocks.delete(room.id);
  return clock;
}

// Сам что-то нажал — пропуски с нуля, «ушёл» снимается (§13a).
function markBack(room: Room, playerId: string) {
  const g = room.game;
  if (!g) return;
  if (g.missedTurns?.[playerId]) g.missedTurns = { ...g.missedTurns, [playerId]: 0 };
  if (g.awayAt?.[playerId] !== undefined) {
    const rest = { ...g.awayAt };
    delete rest[playerId];
    g.awayAt = rest;
    console.log(`[ROOM ${room.id}] ${room.players.find((p) => p.id === playerId)?.name} вернулся`);
  }
}

async function internalMove(roomId: string, move: TimedMove) {
  await fetch(`http://127.0.0.1:${PORT}/rooms/${roomId}/${move.path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-garba-internal': INTERNAL_SECRET,
      'x-garba-player': move.playerId,
    },
    body: JSON.stringify(move.body),
  });
}

// Раз в секунду: у кого вышли 20 секунд — ходим за него; второй пропуск подряд — «ушёл».
async function sweepTurns() {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (turnBusy.has(room.id)) continue;
    const clock = turnClockOf(room);
    const awaited = awaitedMoves(room);
    if (!clock || !awaited) continue;
    // За пропавших на 5 минут (24.09.2026) не ждём полного времени хода — полторы секунды,
    // чтобы остальные успели увидеть ход.
    const gone = room.game?.goneIds ?? [];
    const allGone = awaited.moves.every((m) => gone.includes(m.playerId));
    if (now - clock.since < (allGone ? 1500 : turnMsOf(room))) continue;

    turnBusy.add(room.id);
    turnClocks.delete(room.id);
    try {
      for (const move of awaited.moves) {
        await internalMove(room.id, move);
        const name = room.players.find((p) => p.id === move.playerId)?.name;
        console.log(`[ROOM ${room.id}] время вышло — за ${name}: ${move.path} ${JSON.stringify(move.body)}`);
        if (!room.game || room.status !== 'started') break;
        if (gone.includes(move.playerId)) continue;
        const miss = addMiss(room.game.missedTurns ?? {}, move.playerId);
        room.game.missedTurns = miss.missed;
        if (miss.away && room.game.awayAt?.[move.playerId] === undefined) {
          room.game.awayAt = { ...(room.game.awayAt ?? {}), [move.playerId]: Date.now() };
          console.log(`[ROOM ${room.id}] ${name} ушёл — пауза, 5 минут на возврат`);
        }
      }
      persistRoom(room);
      await broadcastRoom(room.id);
    } catch (e) {
      console.error(`[ROOM ${room.id}] turn timeout failed:`, e);
    } finally {
      turnBusy.delete(room.id);
    }
  }
}

setInterval(() => {
  sweepTurns().catch((e) => console.error('turn sweep failed:', e));
}, 1000);

// «Я здесь»: ушедший вернулся — сама отметка делается выше, в проверке присутствия.
app.post('/rooms/:id/back', (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'room not found' });
  return res.json(publicRoom(room, String(req.body?.playerId)));
});

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
  // Вскрытие идёт по местам за столом (room.players отсортирован по месту).
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
    dealNumber: 0,
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
function closeWithSplit(room: Room, reason: 'nobody_can_play' | 'agreed_end' | 'seat_empty' = 'nobody_can_play') {
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
  game.closeReason = reason;
  game.endVote = null;
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
    concededIds: [] as string[],
  };
}

function beginBidding(room: Room) {
  if (!room.game) return;
  const game = room.game;

  game.dealNumber = (game.dealNumber ?? 0) + 1;

  game.trumpSuit = null;
  game.mains = [];
  game.lastRedeal = null;
  game.izzhoga = [];
  game.dvaSuit = null;
  game.konAs = null;
  game.special = null;
  game.discardedCard = null;
  // Новая раздача — предлагать закончить игру снова может каждый (§12.3).
  game.endVote = null;
  game.endProposedIds = [];
  game.lastEndVote = null;
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
    // Кому не по карману ни один множитель — не спрашиваем (§7.4a). Не может никто —
    // борьба кончается сразу, идут обычные торги.
    skipUnaffordable(room);
  }
}

// Сколько своих карт игрок видит прямо сейчас. null — все.
// Во время борьбы за спецкарту карты раздаются по одной (§7.2, §7.3).
function visibleCardCount(game: GameState): number | null {
  if (game.stage !== 'special' || !game.special) return null;
  // Туз: слепой круг — до того, как роздана хоть одна карта (RULES.md §7.2), карт 0.
  // Потом (окно перехвата, король, дама, 6, 10) — по одной карте (§7.3).
  // Остальные четыре становятся видны только после завершения борьбы.
  return game.special.contest.phase === 'blind' ? 0 : 1;
}

// Хватает ли игроку денег взять спецкарту на этом риске: проигрыш — кон × риск (§11.7).
function canAffordSpecial(room: Room, playerId: string, risk: number): boolean {
  const player = room.players.find((p) => p.id === playerId);
  return !!player && player.balance >= room.game!.kon * risk;
}

// Пропустить тех, кому не хватает на спецкарту (§7.4a); борьба кончилась — подвести итог.
function skipUnaffordable(room: Room) {
  const special = room.game!.special!;
  special.contest = passUnaffordable(special.contest, (id, risk) =>
    canAffordSpecial(room, id, risk),
  );
  if (nextActor(special.contest) === null) finishSpecial(room);
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
  const balances = room.players.map((p) => p.balance);
  if (
    game.emptyStreak <= room.settings.emptyLimit &&
    refillPointless(reason, balances, game.kon, roomBaseKon(room))
  ) {
    // На РАЗ не хватает ни у кого — кон всё равно никто не заберёт, не доливаем (§9.2a).
    game.lastAnte = {
      reason,
      perPlayer: room.settings.ante,
      total: 0,
      skipped: true,
      brokePlayerIds: [],
      noRaz: true,
    };
  } else if (game.emptyStreak <= room.settings.emptyLimit) {
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
  // Сдавшийся главный уже проиграл, но карты кладёт как обычный противник (§10.7).
  const statuses = mainStatuses(game.mains, game.tricksWon, tricksPlayed, game.concededIds ?? []);
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
    conceded: (game.concededIds ?? []).includes(m.playerId),
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

// Код игрока по id — для карточки из-за стола. Меняется только при удалении аккаунта.
const codes = new Map<string, string | null>();
function codeOf(id: string): string | null {
  if (!codes.has(id)) codes.set(id, getAccount(db, id)?.code ?? null);
  return codes.get(id)!;
}

function publicRoom(room: Room, viewerId?: string) {
  let game: any = null;

  if (room.game) {
    game = {
      stage: room.game.stage,
      dealerId: room.game.dealerId,
      dealerName: room.game.dealerName,
      revealLog: room.game.revealLog,
      dealNumber: room.game.dealNumber ?? 0,
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
      // Кто ушёл из игры последним и как разделили кон; кто пропал посреди раздачи.
      lastLeave: room.game.lastLeave ?? null,
      goneIds: room.game.goneIds ?? [],
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
      // Может ли запросивший сдаться и сколько тогда положит в кон (§10.7).
      myCanConcede: viewerId !== undefined && concedeAllowed(room.game, viewerId),
      myConcedeLoss: viewerId !== undefined ? concedeLoss(room, viewerId) : 0,
      // Кто из главных уже сдался — он доигрывает как обычный противник.
      concededIds: room.game.concededIds ?? [],
      // Закончить игру по согласию (§12.3): идущее голосование, мой голос, могу ли предложить.
      endVote: room.game.endVote
        ? {
            proposerName:
              room.players.find((p) => p.id === room.game!.endVote!.proposerId)?.name ?? '',
            yesIds: room.game.endVote.yes,
            noIds: room.game.endVote.no,
            secondsLeft: Math.max(
              0,
              Math.ceil((room.game.endVote.startedAt + END_VOTE_MS - Date.now()) / 1000),
            ),
          }
        : null,
      myEndVote: room.game.endVote && viewerId
        ? room.game.endVote.yes.includes(viewerId)
          ? 'yes'
          : room.game.endVote.no.includes(viewerId)
            ? 'no'
            : null
        : null,
      myCanProposeEnd:
        viewerId !== undefined &&
        canProposeEnd({
          stage: room.game.stage,
          voteActive: !!room.game.endVote,
          proposedIds: room.game.endProposedIds ?? [],
          playerId: viewerId,
        }),
      lastEndVote: room.game.lastEndVote ?? null,
      // Время на ход (§13a): сколько секунд осталось тому, кого ждём; кого ждём.
      turnSecondsLeft: turnSecondsLeft(turnClockOf(room), Date.now(), turnMsOf(room)),
      awaitedIds: awaitedMoves(room)?.moves.map((m) => m.playerId) ?? [],
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
    isPublic: !!room.isPublic,
    // «ГОТОВ» перед стартом: кто уже нажал и сколько секунд осталось.
    readyCheck: room.readyCheck
      ? {
          readyIds: room.readyCheck.readyIds,
          secondsLeft: readySecondsLeft(room.readyCheck, Date.now(), readyMs),
        }
      : null,
    readyDroppedIds: room.readyDroppedIds ?? [],
    // У каждого игрока — адрес его фото (этап 9.5) или null.
    // И рейтинг (этап 9.6): сейчас и с каким сел за стол — для итогов «4.0 → 4.9».
    players: room.players.map((p) => {
      const atTable = room.rating?.[p.id];
      return {
        ...p,
        // Код игрока — нажать на него за столом и открыть карточку (в друзья, подарок).
        code: codeOf(p.id),
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
  const { playerId, name, capacity, ante, emptyLimit, konThreshold, minBalance, turnSeconds } =
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

  // Время на ход — 20 или 40 секунд (§13a). Не прислали — 20, как было раньше.
  const turnSecondsValue = turnSeconds === undefined ? 20 : Number(turnSeconds);
  if (!TURN_SECONDS_OPTIONS.includes(turnSecondsValue)) {
    return res.status(400).json({ error: `turnSeconds must be one of ${TURN_SECONDS_OPTIONS.join(', ')}` });
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

  const room = makeRoom(
    me(res),
    cap,
    {
      ante: anteValue,
      emptyLimit: limitValue,
      konThreshold: thresholdValue,
      minBalance: minBalanceValue,
      turnSeconds: turnSecondsValue,
    },
    req.body?.isPublic === true,
  );
  return res.status(201).json(publicRoom(room, String(playerId)));
});

// Новая комната с создателем за столом. Условия уже проверены.
function makeRoom(account: Account, capacity: number, settings: RoomSettings, isPublic: boolean): Room {
  const id = makeRoomId();
  const room: Room = {
    id,
    capacity,
    creatorId: account.id,
    settings,
    players: [
      {
        id: account.id,
        name: account.name,
        ready: true,
        joinedAt: Date.now(),
        balance: account.balance,
        startBalance: account.balance,
        seat: 0,
      },
    ],
    status: 'lobby',
    createdAt: Date.now(),
    isPublic,
  };

  rooms.set(id, room);
  persistRoom(room);
  console.log(`[ROOM ${id}] created ${room.players.length}/${room.capacity}${isPublic ? ', открытая' : ''}`);
  return room;
}

// Войти в комнату: те же проверки для кнопки «Войти», ссылки и «Быстрой игры».
// seat — какое место выбрал (нет — первое свободное). В начатую игру — только на
// освободившееся место (24.09.2026): новый игрок садится, и игра идёт дальше.
function joinRoom(room: Room, account: Account, wantedSeat?: number): { status: number; body: unknown } {
  if (room.players.some((p) => p.id === account.id)) {
    return { status: 200, body: publicRoom(room, account.id) };
  }
  const midGame = room.status === 'started' && !!room.game && (room.vacancies?.length ?? 0) > 0;
  if (room.status !== 'lobby' && !midGame) {
    return { status: 409, body: { error: 'game already started' } };
  }
  const free = midGame
    ? room.vacancies!.map((v) => v.seat)
    : null;
  const seat = free
    ? wantedSeat !== undefined
      ? free.includes(wantedSeat) ? wantedSeat : null
      : free[0]
    : seatFor(room.players.map((p) => p.seat ?? 0), room.capacity, wantedSeat);
  if (seat === null) {
    return { status: 409, body: { error: room.players.length >= room.capacity ? 'room is full' : 'seat taken' } };
  }
  const busyIn = activeRoomOf(account.id);
  if (busyIn) {
    return { status: 409, body: { error: 'already in another room', roomId: busyIn.id } };
  }
  // Войти можно, только если денег не меньше минимума комнаты (RULES.md §9.1a).
  if (account.balance < room.settings.minBalance) {
    return {
      status: 403,
      body: { error: 'not enough coins to enter', minBalance: room.settings.minBalance, balance: account.balance },
    };
  }

  room.players.push({
    id: account.id,
    name: account.name,
    ready: true,
    joinedAt: Date.now(),
    balance: account.balance,
    startBalance: account.balance,
    seat,
  });
  sortSeats(room);
  console.log(`[ROOM ${room.id}] ${account.name} joined ${room.players.length}/${room.capacity}, место ${seat}`);
  if (midGame) {
    // Сел на свободное место посреди игры: со следующей раздачи он играет.
    const vacancy = room.vacancies!.find((v) => v.seat === seat)!;
    room.vacancies = room.vacancies!.filter((v) => v.seat !== seat);
    room.departedIds = (room.departedIds ?? []).filter((id) => id !== account.id);
    room.stats ??= {};
    room.stats[account.id] ??= emptyStats();
    ratingState(room, account.id);
    if (vacancy.wasDealer) {
      room.game!.dealerId = account.id;
      room.game!.dealerName = account.name;
    }
    return { status: 200, body: publicRoom(room, account.id) };
  }
  if (room.players.length === room.capacity) {
    room.readyCheck = startReadyCheck(Date.now());
    console.log(`[ROOM ${room.id}] набралась — ждём «ГОТОВ» от всех`);
  }
  return { status: 200, body: publicRoom(room, account.id) };
}

// Открытые комнаты, куда можно сесть: лобби, есть место, хватает монет (19.09.2026).
function openRoomsForAccount(account: Account) {
  return openRoomsFor(
    [...rooms.values()].map((r) => ({
      id: r.id,
      isPublic: !!r.isPublic,
      status: r.status,
      capacity: r.capacity,
      memberIds: r.players.map((p) => p.id),
      vacancies: r.status === 'started' ? (r.vacancies?.length ?? 0) : 0,
      minBalance: r.settings.minBalance,
      createdAt: r.createdAt,
    })),
    account.balance,
    account.id,
  );
}

// Список открытых комнат для экрана «Открытые комнаты».
app.get('/rooms/open', (req, res) => {
  const list = openRoomsForAccount(me(res)).map((summary) => {
    const room = rooms.get(summary.id)!;
    return {
      id: room.id,
      capacity: room.capacity,
      players: room.players.length,
      creatorName: room.players.find((p) => p.id === room.creatorId)?.name ?? '',
      settings: room.settings,
      // Игра уже идёт, но освободилось место (24.09.2026).
      started: room.status === 'started',
    };
  });
  return res.json({ rooms: list });
});

// «Быстрая игра»: сесть в самую заполненную открытую комнату, куда хватает монет;
// таких нет — создать открытую комнату (5 игроков, взнос 100) и ждать людей.
app.post('/rooms/quick', (req, res) => {
  const account = me(res);
  const busyIn = activeRoomOf(account.id);
  if (busyIn) {
    return res.status(409).json({ error: 'already in another room', roomId: busyIn.id });
  }

  for (const summary of openRoomsForAccount(account)) {
    const room = rooms.get(summary.id)!;
    const joined = joinRoom(room, account);
    if (joined.status === 200) {
      persistRoom(room);
      broadcastRoom(room.id).catch((e) => console.error(`[ROOM ${room.id}] broadcast failed:`, e));
      return res.json(joined.body);
    }
  }

  if (account.balance < QUICK_ROOM.minBalance) {
    return res.status(403).json({
      error: 'not enough coins to enter',
      minBalance: QUICK_ROOM.minBalance,
      balance: account.balance,
    });
  }
  const { capacity, ...settings } = QUICK_ROOM;
  const room = makeRoom(account, capacity, settings, true);
  return res.status(201).json(publicRoom(room, account.id));
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

  const wanted = req.body?.seat === undefined ? undefined : Number(req.body.seat);
  const joined = joinRoom(room, me(res), Number.isInteger(wanted) ? wanted : undefined);
  return res.status(joined.status).json(joined.body);
});

// Пересесть на свободное место — только в лобби, до начала игры (24.09.2026).
app.post('/rooms/:id/seat', (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'room not found' });
  if (room.status !== 'lobby') return res.status(409).json({ error: 'game already started' });
  const player = room.players.find((p) => p.id === me(res).id);
  if (!player) return res.status(403).json({ error: 'player is not in this room' });
  const seat = Number(req.body?.seat);
  if (!Number.isInteger(seat) || seat < 0 || seat >= room.capacity) {
    return res.status(400).json({ error: 'bad seat' });
  }
  if (room.players.some((p) => p.seat === seat && p.id !== player.id)) {
    return res.status(409).json({ error: 'seat taken' });
  }
  player.seat = seat;
  sortSeats(room);
  return res.json(publicRoom(room, player.id));
});

// Открыть комнату для всех или закрыть обратно — только создатель и только в лобби.
// Например, собрались вчетвером и ищут пятого (19.09.2026).
app.post('/rooms/:id/visibility', (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) {
    return res.status(404).json({ error: 'room not found' });
  }
  if (room.creatorId !== me(res).id) {
    return res.status(403).json({ error: 'only the creator can change this' });
  }
  if (room.status !== 'lobby') {
    return res.status(409).json({ error: 'game already started' });
  }
  room.isPublic = req.body?.isPublic === true;
  console.log(`[ROOM ${room.id}] ${room.isPublic ? 'открыта для всех' : 'только по коду'}`);
  return res.json(publicRoom(room, me(res).id));
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

  const playerId = me(res).id;
  if (!room.players.some((p) => p.id === playerId)) {
    return res.status(403).json({ error: 'player is not in this room' });
  }

  // Посреди игры — только между раздачами (24.09.2026): кон делится между оставшимися,
  // место свободно, игра ждёт замену.
  if (room.status === 'started' && room.game) {
    if (!betweenDeals(room.game.stage) || room.game.endVote) {
      return res.status(409).json({ error: 'can leave only between deals', stage: room.game.stage });
    }
    vacateSeat(room, playerId, 'left');
    return res.json({ left: true });
  }
  if (room.status !== 'lobby') {
    return res.status(409).json({ error: 'game already started' });
  }

  if (playerId === room.creatorId) {
    room.status = 'finished';
    console.log(`[ROOM ${room.id}] creator left, room closed`);
  } else {
    room.players = room.players.filter((p) => p.id !== playerId);
    room.readyCheck = null; // место освободилось — ждём нового игрока
    console.log(`[ROOM ${room.id}] ${me(res).name} left ${room.players.length}/${room.capacity}`);
  }

  return res.json(publicRoom(room, playerId));
});

// «ГОТОВ» (решение владельца, 23.09.2026): кнопка появляется, когда комната набралась.
// Нажали все — игра начинается сама. Кто не нажал за 30 секунд — выходит (sweepReady).
app.post('/rooms/:id/ready', (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) {
    return res.status(404).json({ error: 'room not found' });
  }
  const playerId = me(res).id;
  if (room.status === 'started' && room.game) {
    return res.json(publicRoom(room, playerId));
  }
  if (room.status !== 'lobby') {
    return res.status(409).json({ error: 'room finished' });
  }
  if (!room.players.some((p) => p.id === playerId)) {
    return res.status(403).json({ error: 'player is not in this room' });
  }
  if (!room.readyCheck) {
    return res.status(409).json({
      error: 'room is not full',
      players: room.players.length,
      capacity: room.capacity,
    });
  }

  room.readyCheck = markReady(room.readyCheck, playerId);
  console.log(`[ROOM ${room.id}] ${me(res).name} готов ${room.readyCheck.readyIds.length}/${room.capacity}`);
  settleReadyCheck(room);
  return res.json(publicRoom(room, playerId));
});

// Проверка готовности: все нажали — старт; 30 секунд вышли — не нажавшие выходят.
// true — комната изменилась (нужно сохранить и разослать).
function settleReadyCheck(room: Room): boolean {
  if (room.status !== 'lobby' || !room.readyCheck) return false;
  const outcome = readyOutcome(
    room.readyCheck,
    room.players.map((p) => p.id),
    room.creatorId,
    Date.now(),
    readyMs,
  );
  if (outcome.kind === 'wait') return false;

  if (outcome.kind === 'start') {
    startGame(room);
    return true;
  }

  const names = room.players.filter((p) => outcome.drop.includes(p.id)).map((p) => p.name);
  room.players = room.players.filter((p) => !outcome.drop.includes(p.id));
  room.readyCheck = null;
  room.readyDroppedIds = outcome.drop;
  if (outcome.creatorId === null) {
    room.status = 'finished';
    console.log(`[ROOM ${room.id}] «ГОТОВ» не нажал никто — комната закрыта`);
  } else {
    if (outcome.creatorId !== room.creatorId) {
      room.creatorId = outcome.creatorId;
      const creator = room.players.find((p) => p.id === outcome.creatorId)?.name;
      console.log(`[ROOM ${room.id}] создатель теперь ${creator}`);
    }
    console.log(`[ROOM ${room.id}] не нажали «ГОТОВ» — вышли: ${names.join(', ')}`);
  }
  return true;
}

// room.players — всегда по местам за столом.
function sortSeats(room: Room) {
  room.players.sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
}

function startGame(room: Room) {
  room.status = 'started';
  room.readyCheck = null;
  room.readyDroppedIds = undefined;

  // Где сел — там и играет (RULES.md §2, решение владельца 24.09.2026): room.players
  // отсортирован по месту, следующий в массиве = сосед справа.
  sortSeats(room);

  room.game = makeDealerSelection(room);
  room.stats = Object.fromEntries(room.players.map((p) => [p.id, emptyStats()]));
  room.rating = {};
  for (const p of room.players) ratingState(room, p.id);

  console.log(
    `[ROOM ${room.id}] GAME STARTED, dealer=${room.game.dealerName}`,
  );
}

// Для проверок время на «ГОТОВ» можно укоротить.
const readyMs = Number(process.env.GARBA_READY_MS ?? READY_MS);

// Раз в секунду: набравшееся лобби без проверки (например, после перезапуска) — начинаем
// её; у кого вышли 30 секунд — выходят.
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.status !== 'lobby') continue;
    let changed = false;
    if (!room.readyCheck && room.players.length === room.capacity) {
      room.readyCheck = startReadyCheck(Date.now());
      changed = true;
    }
    if (settleReadyCheck(room)) changed = true;
    if (changed) {
      persistRoom(room);
      broadcastRoom(room.id).catch((e) => console.error(`[ROOM ${room.id}] broadcast failed:`, e));
    }
  }
}, 1000);

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

  // Идёт голосование «закончить игру» — раздавать нельзя, пока не решится (§12.3).
  settleEndVote(room);
  if (room.game.stage === 'room_done') {
    return res.status(409).json({ error: 'room finished', stage: room.game.stage });
  }
  if (room.game.endVote) {
    return res.status(409).json({ error: 'end vote in progress' });
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

  // Дальше по кругу — кому не по карману, тех не спрашиваем (§7.4a).
  skipUnaffordable(room);
  if (game.stage !== 'special') {
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

// Подвести голосование «закончить игру», если оно решилось (§12.3): все «да» — делим кон
// и закрываем комнату; «нет» или 30 секунд без ответа — играем дальше.
function settleEndVote(room: Room) {
  const game = room.game!;
  const vote = game.endVote;
  if (!vote) return;
  const outcome = endVoteOutcome(vote, room.players.map((p) => p.id), Date.now());
  if (outcome === 'pending') return;
  if (outcome === 'ended') {
    closeWithSplit(room, 'agreed_end');
    console.log(`[ROOM ${room.id}] все согласились закончить игру`);
    return;
  }
  const noId = vote.no[0];
  game.lastEndVote = {
    result: outcome,
    byName: noId ? (room.players.find((p) => p.id === noId)?.name ?? null) : null,
  };
  game.endVote = null;
}

// Предложить закончить игру или ответить на предложение: choice — yes | no (§12.3).
app.post('/rooms/:id/end-game', (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room || !room.game) {
    return res.status(404).json({ error: 'room/game not found' });
  }

  const game = room.game;
  const { playerId, choice } = req.body ?? {};
  const id = String(playerId);

  if (choice !== 'yes' && choice !== 'no') {
    return res.status(400).json({ error: 'choice must be yes or no' });
  }

  settleEndVote(room);
  if (!game.endVote) {
    // Голосования нет — это предложение закончить.
    const allowed = canProposeEnd({
      stage: game.stage,
      voteActive: false,
      proposedIds: game.endProposedIds ?? [],
      playerId: id,
    });
    if (!allowed || choice !== 'yes') {
      return res.status(409).json({ error: 'cannot propose ending now', stage: game.stage });
    }
    game.endProposedIds = [...(game.endProposedIds ?? []), id];
    game.endVote = { proposerId: id, yes: [id], no: [], startedAt: Date.now() };
    game.lastEndVote = null;
  } else {
    const vote = game.endVote;
    if (vote.yes.includes(id) || vote.no.includes(id)) {
      return res.status(409).json({ error: 'already voted' });
    }
    if (choice === 'yes') vote.yes.push(id);
    else vote.no.push(id);
  }
  settleEndVote(room);

  return res.json(publicRoom(room, id));
});

// Главный может сдаться в любой момент розыгрыша (§10.7).
function concedeAllowed(game: GameState, playerId: string): boolean {
  return canConcede({
    stage: game.stage,
    isMain: game.mains.some((m) => m.playerId === playerId),
    alreadyConceded: (game.concededIds ?? []).includes(playerId),
  });
}

// Сколько положит в кон главный, если сдастся: как при проигрыше — ставка его заявки
// × риск спецкарты (§11). Показываем в окне подтверждения.
function concedeLoss(room: Room, playerId: string): number {
  const game = room.game!;
  const main = game.mains.find((m) => m.playerId === playerId);
  if (!main) return 0;
  const outcome = game.special?.outcome;
  const risk = outcome && outcome !== 'nobody' ? outcome.risk : 1;
  return stakeFor(main.declaration, game.kon, roomBaseKon(room)) * risk;
}

// Главный сдаётся: сразу проиграл, платит как при проигрыше (§10.7). Если он один —
// раздача кончается. Если главных двое — второй доигрывает, а сдавшийся кладёт карты
// как обычный противник; раздача кончается, когда решится и судьба второго.
app.post('/rooms/:id/concede', (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room || !room.game) {
    return res.status(404).json({ error: 'room/game not found' });
  }

  const game = room.game;
  const { playerId } = req.body ?? {};
  const id = String(playerId);

  if (!concedeAllowed(game, id)) {
    return res.status(409).json({ error: 'cannot concede now', stage: game.stage });
  }

  concede(room, id);
  return res.json(publicRoom(room, id));
});

// Главный сдаётся (кнопкой или пропал на 5 минут посреди раздачи).
function concede(room: Room, id: string) {
  const game = room.game!;
  game.concededIds = [...(game.concededIds ?? []), id];
  const name = game.mains.find((m) => m.playerId === id)!.playerName;
  const statuses = mainStatuses(game.mains, game.tricksWon, game.playedTricks.length, game.concededIds);
  if (statuses.every((st) => st !== 'open')) {
    finishRound(room, statuses.map((st) => st === 'won'));
  }
  console.log(`[ROOM ${room.id}] ${name} сдался`);
}

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

  if (!room) {
    return res.status(404).json({ error: 'room not found' });
  }

  const playerId = me(res).id;
  if (!room.players.some((p) => p.id === playerId)) {
    return res.status(403).json({ error: 'player is not in this room' });
  }

  // Смайлики — в любой момент, и в лобби (решение владельца, 25.09.2026).
  const result = addReaction(room.reactions ?? [], room.game?.stage ?? 'lobby', playerId, req.body?.emoji, Date.now());
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
// HOST — какой адрес слушать. На сервере в интернете — 127.0.0.1: снаружи ходят только
// через Caddy по https. Дома по умолчанию 0.0.0.0 — чтобы достучался эмулятор.
const HOST = process.env.HOST ?? '0.0.0.0';
httpServer.listen(PORT, HOST, () => {
  console.log(`GARBA backend running on :${PORT} (HTTP + Socket.IO)`);
});
