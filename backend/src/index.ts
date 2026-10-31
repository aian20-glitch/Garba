import express from 'express';
import cors from 'cors';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdirSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { Server as SocketServer } from 'socket.io';

import {
  acceptFriend,
  coinLeaders,
  leaveRecordOf,
  peakBalanceOf,
  setLeaveRecord,
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
  NAME_MAX_LENGTH,
  createAccount,
  markBot,
  botAccounts,
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
  setBalance,
  setDaily,
  setName,
  setSkill,
  setTournamentBan,
  tournamentBanUntil,
  anonymize,
  tokenFromHeader,
  transaction,
  type Account,
  checkRecoveryCode,
  findAccountByTelegram,
  issueExtraToken,
  linkTelegram,
  telegramIdOf,
} from './accounts.js';
import {
  parseStartParam,
  sendTelegram,
  startAppLink,
  suggestedName,
  verifyInitData,
  type TelegramLaunch,
} from './telegram.js';
import { createDeck, shuffle } from './deck.js';
import { STARTING_COINS } from './config.js';
import { BOT_STEP_MS, botAction, botTopUp, freeBotName, type BotAction } from './serverBots.js';
import { loadRoom, loadUnfinishedRooms, playerExperience, profileStats, ratedPlayers, roomIdTaken, saveRoom, weekCoins, writeRoom } from './roomDb.js';
import {
  compareStandings,
  DEFAULT_TIMES,
  eliminatedIds,
  ENTRY_FEE,
  lastCallPhase,
  MIN_PARTICIPANTS,
  nextWeeklyStartAt,
  payouts,
  PENALTY_BAN_MS,
  PENALTY_RATING,
  rankStandings,
  selectFinalists,
  tableEndReason,
  tableSizes,
  TABLE_BONUS,
  TOURNAMENT_SETTINGS,
  tournamentIdFor,
  tournamentRating,
  weeklyRegistrationOpen,
  weeklyStartAt,
  winnerBanner,
  winsBadge,
  FINAL_MIN,
  FINAL_MAX,
  QUALIFY_ABOVE,
  type Standing,
  type TableEnd,
  type TournamentTimes,
} from './tournament.js';
import {
  activeTournament,
  addEntry,
  addTable,
  createTournament,
  entriesOf,
  entryOf,
  latestTournament,
  ledgerAdd,
  moveEntry,
  moveTable,
  moveTournament,
  rateEntry,
  tablesOf,
  treasuryOf,
  tournamentWinsOf,
  unfinishedEntryOf,
  writeEntryPlay,
  type Entry,
  type EntryStatus,
  type TableStage,
  type Tournament,
  type TournamentTable,
} from './tournamentDb.js';
import { addWeekly, coinMedals, weekKey, weekTop, type WeeklyCoins } from './leaders.js';
import { banSecondsLeft, nextLeaveBan } from './leaveBan.js';
import { applyLeave, calculateHandDifficulty, dealDeltas, leavePenalty, ratingOf, settleRoom, shownRating, START_SKILL } from './rating.js';
import { addReaction, isPlayerCode, isRoomCode, type ReactionEntry } from './reactions.js';
import {
  buyError,
  equipError,
  lookOf,
  ownedItems,
  recordPurchase,
  setEquipped,
  SHOP_ITEMS,
  shopItem,
  shopSales,
  type Look,
  type Slot,
} from './shop.js';
import { addDeal, addMoney, emptyStats, roomWinners, type PlayerStats } from './stats.js';
import { avatarPath, detectImageType, loadAvatar, MAX_AVATAR_BYTES, saveAvatar } from './avatars.js';
import {
  dailyClaim,
  dailySchedule,
  dayKey,
  giftError,
  giftLeftToday,
  normalizeCode,
  REFERRAL_BONUS,
  referralDue,
  REFERRAL_ROOMS,
} from './bonus.js';
import {
  ABSENCE_MINUTES_OPTIONS,
  absenceMsFor,
  absenceStep,
  NEW_ROOM_ABSENCE_MINUTES,
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
  entryAllowed,
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
import { privacyHtml, supportHtml, privacySections, PRIVACY_UPDATED } from './privacy.js';
import { canProposeEnd, endVoteOutcome, END_VOTE_MS, type EndVote } from './endVote.js';
import {
  canKeepPlaying,
  dealerAfterLeave,
  renumberSeats,
  shrinkVoteOutcome,
  SHRINK_VOTE_MS,
  type ShrinkVote,
} from './shrinkVote.js';
import {
  markReady,
  READY_MS,
  readyOutcome,
  readySecondsLeft,
  startReadyCheck,
  type ReadyCheck,
} from './readyCheck.js';
import { LOBBY_MS, lobbyExpired, lobbySecondsLeft } from './lobbyTimer.js';
import { rateCheck } from './rateLimit.js';
import { openRoomsFor, QUICK_ROOM } from './openRooms.js';
import { liveRoomsFor, spectateRefusal, spectatorCount } from './spectators.js';
import { checkBuyIn } from './buyIn.js';
import { canShare, checkShareAmount } from './share.js';
import {
  applyTopUp,
  canRequestTopUp,
  checkTopUpAmount,
  TOP_UP_VOTE_MS,
  topUpOutcome,
  type TopUpVote,
} from './topUp.js';
import {
  addReport,
  avoidIds,
  blockedBetween,
  blockedIds,
  blockPlayer,
  hasBlocked,
  isReportReason,
  listReports,
  nameNotAllowed,
  resolveReport,
  unblockPlayer,
} from './moderation.js';
import {
  addMiss,
  clockFor,
  dealShowStep,
  pickRandom,
  revealShowMs,
  roundShowMs,
  threeIzzhogaShowMs,
  type DealShow,
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
  openHands,
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
  // Монеты за столом (09.10.2026): сколько игрок взял с собой, плюс выигрыш, минус
  // проигрыш. Все проверки игры — по ним. После каждого действия в аккаунт пишется
  // balance + reserve (persistRoom).
  balance: number;
  // Остаток аккаунта, который игрок не взял за стол (buyIn.ts). В игре не участвует,
  // бонус и подарок за столом идут сюда. Нет — комната до 09.10.2026: взят весь баланс.
  reserve?: number;
  // Сколько взял за стол — от этого считается, кто больше всех проиграл (§12.2).
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
  minBalance: number; // сумма за стол — минимум для входа, кратно 1 000, не меньше взноса × 10 (§9.1a)
  turnSeconds?: number; // время на ход, 20 или 40 (§13a); нет — 20 (старые комнаты)
  absenceMinutes?: number; // запас на отлучку за игру, 1…5 минут (§13); нет — 5
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

// Ушёл из игры посреди комнаты: с чем сел, с чем ушёл, рейтинг до и после (со штрафом).
type DepartedPlayer = {
  id: string;
  name: string;
  startBalance: number;
  balance: number;
  ratingStart: number;
  rating: number;
  bot: boolean;
};

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
  // Когда раздача сыграна — от этого 3 секунды все смотрят открытые карты, раздавать нельзя
  // (§10.8, 22.10.2026). Нет в старых сохранённых комнатах — тогда не ждём.
  roundDoneAt?: number | null;

  // Деньги.
  kon: number;
  konBeforeSettlement: number | null;
  // Пустые раздачи подряд (все ПАС). Сбрасывается, когда кто-то сыграл (§9.3).
  emptyStreak: number;
  lastAnte: AnteRecord | null;
  // Турнир (§19.4): кон никому не по карману — поделили между раздачами. До следующей раздачи.
  konSplit?: { kon: number; perPlayer: number; remainder: number; remainderTo: string | null } | null;
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
  absenceFreeMs?: Record<string, number>; // бесплатные короткие отлучки за игру (10.10.2026)
  // Кто-то опустился ниже базового кона — доигрываем, пока кон не заберут (§12.1).
  closing: boolean;
  // Почему закрылась комната: кон забрали (§12.1), кон никто не может взять
  // и его поделили поровну (§12.2) или игрок отключился и не вернулся (кончился запас на отлучку) (§13).
  // seat_empty — место пустовало 10 минут, никто не сел (24.09.2026).
  closeReason: 'kon_taken' | 'nobody_can_play' | 'player_left' | 'agreed_end' | 'seat_empty' | 'tournament_end' | null;
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
  // Игрок ушёл — оставшиеся решают: играть дальше без него или закрыть (§13c, 09.10.2026).
  shrinkVote?: ShrinkVote | null;
  // Последний раз стол стал меньше — с какого на какое число игроков (для надписи на столе).
  lastShrink?: { from: number; to: number } | null;
  // Докупить из кошелька за столом (§9.1c, 22.10.2026): идущая просьба, кто уже просил между
  // этими раздачами, чем кончилась последняя. Нет в старых сохранённых комнатах.
  topUpVote?: TopUpVote | null;
  topUpRequestedIds?: string[];
  lastTopUp?: {
    playerId: string;
    name: string;
    amount: number;
    result: 'approved' | 'rejected' | 'expired';
    byName: string | null; // кто был против
  } | null;
  // Главный выиграл и отдал часть выигрыша другому игроку (§11.8, 22.10.2026): кто, кому,
  // сколько и сколько выиграл. Одна передача за раздачу; новая раздача — null.
  winShare?: {
    fromId: string;
    fromName: string;
    toId: string;
    toName: string;
    amount: number;
    won: number;
  } | null;
  // Кто не вернулся (кончился запас на отлучку) — ему доля кона не положена (§13).
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
  // Сила начальной руки главных (§16.2a, 26.10.2026) — когда главный и риск определены.
  handDifficulty?: Record<string, number>;
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
  // Итог ушедших на момент ухода (11.10.2026): в «ИТОГАХ ИГРЫ» видны все, кто играл.
  departed?: DepartedPlayer[];
  // Лобби набралось — ждём «ГОТОВ» от всех (решение владельца, 23.09.2026).
  readyCheck?: ReadyCheck | null;
  // Кто вышел, не нажав «ГОТОВ» в прошлый раз, — чтобы его телефон сказал почему.
  readyDroppedIds?: string[];
  // Игра не началась за 10 минут — лобби закрылось само (27.09.2026).
  lobbyTimedOut?: boolean;
  // Боты сервера за этим столом (кнопка «ДОБАВИТЬ БОТОВ», 27.09.2026).
  botIds?: string[];
  // Тренировка (решение владельца, 28.09.2026): за столом боты — монеты, рейтинг,
  // статистика и зачёт приглашений не меняются (writeRoom в аккаунты не пишет).
  practice?: boolean;
  // Номер состояния — растёт с каждым сохранением (persistRoom).
  version?: number;
  // Итог закрытой комнаты уже записан в аккаунты — больше не пишем (writeRoom).
  accountsClosed?: boolean;
  game?: GameState;
  // Статистика игроков за эту комнату (ТЗ §35, этап 9.4). Заводится при старте игры.
  stats?: Record<string, PlayerStats>;
  // Монеты за неделю — для «ТОП-3 недели» (23.10.2026, leaders.ts).
  weekly?: WeeklyCoins;
  // Рейтинг игроков за столом (RULES.md §16, этап 9.6). Мастерство сохраняется в аккаунт
  // вместе с комнатой — как баланс. startSkill и startExp — с чем игрок сел за стол: от них
  // «Рейтинг 4.0 → 4.1» в итогах. С 26.10.2026 мастерство за столом не меняется: изменения
  // за партии копятся в pending, activeMs — сколько он реально играл за этим столом;
  // в конце комнаты (или при уходе) — settleRoom (§16.3b). startDeals — у старых комнат.
  rating?: Record<string, {
    skill: number;
    startSkill: number;
    startExp?: number;
    startDeals?: number;
    pending?: number;
    activeMs?: number;
  }>;
  // Активное время и партии по дням — для опыта (§16.1, 26.10.2026), пишется в room_activity.
  activity?: Record<string, Record<string, { ms: number; deals: number }>>;
  // Последние реакции-смайлики (RULES.md §14, этап 9.7).
  reactions?: ReactionEntry[];
  // Открытая комната — видна всем в списке, войти можно без кода (19.09.2026).
  isPublic?: boolean;
  // Стол еженедельного турнира (RULES.md §19, 31.10.2026). Нет — обычная комната.
  tournament?: TournamentRoom;
};

// Турнирный стол: какой турнир, этап и номер; с какого момента идёт час игры; последний шанс.
type TournamentRoom = {
  id: string;
  stage: TableStage;
  tableNo: number;
  // Сколько мест займут боты, когда сядут люди (финал, где людей меньше 4 — §19.7).
  reserveBots?: number;
  startedAt?: number; // начало игры — от него 20 минут (§19.4)
  lastCall?: boolean; // открыт последние 10 минут, уведомление разослано (§19.5)
  launch?: boolean; // «ГОТОВ» последнего шанса: кто не нажал — его место боту
  // Счёт для ничьей (§19.7): победы на РАЗ (спецкарта — как РАЗ), на ДВА, лучший риск.
  scores?: Record<string, { razWins: number; dvaWins: number; maxRisk: number }>;
  eliminatedIds?: string[]; // выбыли — не могли заплатить взнос
  penalizedIds?: string[]; // сами вышли или не вернулись — наказаны (§19.6)
  lastOut?: { name: string; reason: 'eliminated' | 'left' | 'gone' } | null; // для надписи на столе
  endReason?: TableEnd; // почему стол закончился
};

const app = express();
// Порт можно переопределить — это нужно проверке сокетов (tests/live-socket.ts),
// чтобы поднять отдельный сервер и не мешать тому, что работает на 3000.
const PORT = Number(process.env.PORT ?? 3000);
const rooms = new Map<string, Room>();

// Ошибка внутри таймера (например, база занята дольше 5 секунд) не должна ронять весь
// сервер: пишем в журнал, следующий тик попробует снова (28.09.2026).
function guarded(name: string, fn: () => void): () => void {
  return () => {
    try {
      fn();
    } catch (e) {
      console.error(`[TIMER ${name}] failed:`, e);
    }
  };
}

app.use(cors());
// За Caddy (https) все запросы приходят с 127.0.0.1 — настоящий адрес игрока Caddy кладёт
// в X-Forwarded-For. Верим ему только от локального прокси.
app.set('trust proxy', 'loopback');
app.use(express.json());

// Общий лимит запросов с одного адреса (26.09.2026) — от атаки скриптом. Обычному игроку
// нужно в десятки раз меньше; порог с запасом — у мобильных операторов много игроков за
// одним адресом. Свой компьютер (боты, проверки, ходы по таймеру) — без лимита.
const REQUEST_LIMIT = [{ max: Number(process.env.GARBA_REQS_PER_10S ?? 200), windowMs: 10_000 }];
const requestsByIp = new Map<string, number[]>();
let limitLoggedAt = 0;
app.use((req, res, next) => {
  const ip = req.ip ?? 'unknown';
  if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) return next();
  const check = rateCheck(requestsByIp.get(ip) ?? [], Date.now(), REQUEST_LIMIT);
  requestsByIp.set(ip, check.times);
  if (!check.allowed) {
    // Адрес не пишем (политика конфиденциальности) — только сам факт и путь, не чаще раза в 10 с.
    if (Date.now() - limitLoggedAt > 10_000) {
      limitLoggedAt = Date.now();
      console.warn(`[LIMIT] too many requests: ${req.method} ${req.path}`);
    }
    return res.status(429).json({ error: 'too many requests, slow down' });
  }
  next();
});
// Старые адреса забываем — иначе карта росла бы вечно.
setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of requestsByIp) {
    if (!times.length || now - times[times.length - 1] > 10_000) requestsByIp.delete(ip);
  }
}, 60_000);

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
  // Номер состояния растёт с каждым сохранением: по нему приложение отбрасывает
  // опоздавшие старые ответы (28.09.2026).
  room.version = (room.version ?? 0) + 1;
  try {
    saveRoom(db, room);
    // Итог закрытой комнаты записан — дальше её старые цифры в аккаунты не идут
    // (смайлик на экране итогов затёр бы бонус, подарок или игру в новой комнате).
    if (room.status === 'finished') room.accountsClosed = true;
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
// начисление. Кладём в запас (reserve), а не на стол: за столом игрок играет только
// тем, что взял с собой (09.10.2026), и в итоги комнаты бонус и подарок не входят.
// undo — как откатить изменение в памяти, если транзакция не прошла.
function changeCoins(accountId: string, delta: number, undo: (() => void)[]): Room | undefined {
  const room = activeRoomOf(accountId);
  const player = room?.players.find((p) => p.id === accountId);

  if (room && player) {
    // Списать можно только из запаса вне стола — монеты на столе в игре (09.10.2026).
    if ((player.reserve ?? 0) + delta < 0) throw new Error('not enough coins outside the table');
    player.reserve = (player.reserve ?? 0) + delta;
    undo.push(() => {
      player.reserve = (player.reserve ?? 0) - delta;
    });
    writeRoom(db, room);
    // Тренировка и турнирный стол балансы в аккаунт не пишут — начисление кладём в аккаунт сами.
    if (room.practice || room.tournament) db.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?').run(delta, accountId);
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
  // Мат и оскорбления в имени не берём (Apple, Guideline 1.2; 29.09.2026).
  if (nameNotAllowed(name)) {
    return res.status(400).json({ error: 'name not allowed' });
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

// --- Telegram: игра как Mini App (07.10.2026) ---
//
// Токен бота — переменная TELEGRAM_BOT_TOKEN (в git не лежит). Без неё вход через
// Telegram отвечает 503, бот молчит — остальная игра работает как раньше.
// Игра в Telegram — веб-сборка приложения по адресу <GARBA_PUBLIC_URL>/play/.
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const PUBLIC_URL = process.env.GARBA_PUBLIC_URL ?? 'https://garbagame.kz';
const PLAY_URL = `${PUBLIC_URL}/play/`;
// Секрет адреса для обновлений от Telegram — из токена, отдельная настройка не нужна.
const TELEGRAM_WEBHOOK_SECRET = TELEGRAM_TOKEN
  ? createHash('sha256').update(`webhook:${TELEGRAM_TOKEN}`).digest('hex').slice(0, 48)
  : '';
// Имя бота (@...) — узнаём у Telegram при старте; нужно для ссылок t.me/<бот>?startapp=.
let telegramBotUsername = process.env.TELEGRAM_BOT_USERNAME ?? '';

function telegramLaunch(req: express.Request, res: express.Response): TelegramLaunch | null {
  if (!TELEGRAM_TOKEN) {
    res.status(503).json({ error: 'telegram disabled' });
    return null;
  }
  const launch = verifyInitData(req.body?.initData, TELEGRAM_TOKEN, Math.floor(Date.now() / 1000));
  if (!launch) {
    res.status(401).json({ error: 'bad telegram data' });
    return null;
  }
  return launch;
}

// Вход: Telegram уже привязан — новый токен этому устройству. Нет — 404 и имя из
// профиля Telegram для экрана первого входа (игрок может его поменять).
app.post('/accounts/telegram/login', (req, res) => {
  const launch = telegramLaunch(req, res);
  if (!launch) return;
  const account = findAccountByTelegram(db, launch.user.id);
  if (!account) {
    const start = parseStartParam(launch.startParam);
    return res.status(404).json({
      error: 'telegram not linked',
      suggestedName: suggestedName(launch.user, NAME_MAX_LENGTH),
      inviteCode: start?.kind === 'invite' ? start.value : null,
    });
  }
  const token = issueExtraToken(db, account.id);
  // Игра открылась заново посреди партии — значит, Telegram её перезапустил (11.10.2026):
  // видно, как часто и на каком телефоне.
  const room = activeRoomOf(account.id);
  if (room?.status === 'started') {
    const ua = String(req.headers['user-agent'] ?? '').slice(0, 160);
    console.log(`[ROOM ${room.id}] ${account.name} открыл игру заново (${ua})`);
  }
  return res.json({ ...account, token });
});

// Новый аккаунт из Telegram: имя проверяется как обычно, лимит по адресу тот же.
app.post('/accounts/telegram', (req, res) => {
  const launch = telegramLaunch(req, res);
  if (!launch) return;
  if (findAccountByTelegram(db, launch.user.id)) {
    return res.status(409).json({ error: 'telegram already linked' });
  }
  const ip = req.ip ?? 'unknown';
  const limit = rateCheck(accountsByIp.get(ip) ?? [], Date.now(), ACCOUNT_LIMITS);
  if (!limit.allowed && !LOOPBACK.includes(ip)) {
    return res.status(429).json({ error: 'too many accounts, try later' });
  }
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'name must be 1 to 20 characters' });
  if (nameNotAllowed(name)) return res.status(400).json({ error: 'name not allowed' });
  const inviteCode = normalizeCode(req.body?.inviteCode);
  const inviter = inviteCode ? findAccountByCode(db, inviteCode) : null;
  if (inviteCode && !inviter) return res.status(400).json({ error: 'invite code not found' });

  const { account, recoveryCode } = createAccount(db, name, inviter?.id ?? null);
  accountsByIp.set(ip, limit.times);
  linkTelegram(db, account.id, launch.user.id);
  const token = issueExtraToken(db, account.id);
  console.log(`[ACCOUNT] created ${account.name} (${account.id}) via Telegram`);
  return res.status(201).json({ ...account, token, recoveryCode });
});

// Уже играю в приложении — подключаю тот же аккаунт к Telegram кодом восстановления.
// Телефон остаётся в аккаунте; код одноразовый — в ответе новый.
app.post('/accounts/telegram/link', (req, res) => {
  const launch = telegramLaunch(req, res);
  if (!launch) return;
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
  const account = playerCode ? checkRecoveryCode(db, playerCode, req.body?.recoveryCode) : null;
  if (!account) return res.status(401).json({ error: 'invalid recovery credentials' });

  linkTelegram(db, account.id, launch.user.id);
  const recoveryCode = replaceRecoveryCode(db, account.id);
  const token = issueExtraToken(db, account.id);
  console.log(`[ACCOUNT] ${account.name} (${account.id}) linked Telegram`);
  return res.json({ ...account, token, recoveryCode });
});

// Сообщение игроку от бота. Не привязан Telegram или нет токена бота — тихо ничего.
// Одно и то же (ключ) — не чаще раза в 10 минут, чтобы бот не надоедал.
const telegramNotified = new Map<string, number>();
function notifyTelegram(accountId: string, key: string, text: string, startParam?: string) {
  if (!TELEGRAM_TOKEN) return;
  const chatId = telegramIdOf(db, accountId);
  if (!chatId) return;
  const now = Date.now();
  const mark = `${accountId}:${key}`;
  if (now - (telegramNotified.get(mark) ?? 0) < 10 * 60_000) return;
  telegramNotified.set(mark, now);
  const button =
    startParam && telegramBotUsername
      ? { text: 'ОТКРЫТЬ ИГРУ', url: startAppLink(telegramBotUsername, startParam) }
      : { text: 'ОТКРЫТЬ ИГРУ', web_app: { url: PLAY_URL } };
  void sendTelegram(TELEGRAM_TOKEN, 'sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: { inline_keyboard: [[button]] },
  });
}
setInterval(() => {
  const now = Date.now();
  for (const [mark, at] of telegramNotified) if (now - at > 10 * 60_000) telegramNotified.delete(mark);
}, 60_000);

// Обновления от Telegram: на /start бот отвечает кнопкой «ИГРАТЬ».
app.post('/telegram/webhook', (req, res) => {
  if (!TELEGRAM_TOKEN || req.get('x-telegram-bot-api-secret-token') !== TELEGRAM_WEBHOOK_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const message = req.body?.message;
  const chatId = message?.chat?.id;
  if (typeof chatId === 'number' && typeof message?.text === 'string' && message.text.startsWith('/start')) {
    void sendTelegram(TELEGRAM_TOKEN, 'sendMessage', {
      chat_id: chatId,
      text:
        'ГАРБА — казахская карточная игра на 4–7 игроков.\n' +
        'Нажми «ИГРАТЬ», чтобы сесть за стол. Монеты в игре ненастоящие: их нельзя купить или вывести.',
      reply_markup: { inline_keyboard: [[{ text: 'ИГРАТЬ', web_app: { url: PLAY_URL } }]] },
    });
  }
  return res.json({ ok: true });
});

// При старте на сервере в интернете: узнаём имя бота, говорим Telegram, куда слать
// обновления, и ставим кнопку меню «Играть». На своём компьютере — только имя бота,
// чтобы проверка не перехватила обновления у настоящего сервера.
async function setupTelegram() {
  if (!TELEGRAM_TOKEN) return;
  const me = (await sendTelegram(TELEGRAM_TOKEN, 'getMe', {})) as { username?: string } | null;
  if (me?.username) telegramBotUsername = me.username;
  if (process.env.NODE_ENV !== 'production') return;
  await sendTelegram(TELEGRAM_TOKEN, 'setWebhook', {
    url: `${PUBLIC_URL}/telegram/webhook`,
    secret_token: TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ['message'],
  });
  await sendTelegram(TELEGRAM_TOKEN, 'setChatMenuButton', {
    menu_button: { type: 'web_app', text: 'Играть', web_app: { url: PLAY_URL } },
  });
  console.log(`[TELEGRAM] бот @${telegramBotUsername} готов`);
}
void setupTelegram();

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
  dropSocketsOf(recovered.account.id);
  return res.json({ ...recovered.account, token: recovered.token, recoveryCode: recovered.recoveryCode });
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
  // В незаконченном турнире — сначала доиграть: на нём турнирные монеты и обязательства (§19.2).
  const tournamentId = unfinishedEntryOf(db, account.id);
  if (tournamentId) {
    return res.status(409).json({ error: 'finish your tournament first', tournamentId });
  }
  deleteAccountEverywhere(account);
  return res.json({ ok: true });
});

// Аккаунт — из базы, из комнат в памяти и из сокетов. Вызывать, только когда он не за столом.
function deleteAccountEverywhere(account: Account) {
  transaction(db, () => deleteAccountData(db, account.id));
  // Закрытые комнаты ещё полчаса в памяти и сохраняются заново (смайлики) — имя и там
  // заменяем, иначе оно вернулось бы в базу.
  for (const r of rooms.values()) {
    if (r.players.some((p) => p.id === account.id) || r.rating?.[account.id] || r.stats?.[account.id]) {
      Object.assign(r, anonymize(r, account.id));
      delete r.rating?.[account.id];
      delete r.stats?.[account.id];
    }
  }
  console.log(`[ACCOUNT] deleted ${account.name} (${account.id})`);
  looks.delete(account.id);
  dropSocketsOf(account.id);
}

// Сколько у игрока монет вне стола (09.10.2026): за столом — запас, который он не взял
// с собой; не за столом — весь баланс. tableBalance — сколько сейчас на столе, или null.
// Турнирный стол (§19.4): турнирные монеты — не кошелёк, в «всего» их не складываем.
function walletSplit(account: Account): { balance: number; tableBalance: number | null } {
  const room = activeRoomOf(account.id);
  const player = room?.players.find((p) => p.id === account.id);
  if (!player) return { balance: account.balance, tableBalance: null };
  if (room?.tournament) return { balance: account.balance, tableBalance: null };
  return { balance: player.reserve ?? 0, tableBalance: player.balance };
}

// Кто я: по токену. roomId — незаконченная комната, если игрок в ней сидит.
// balance — монеты вне стола, tableBalance — за столом (09.10.2026).
// daily — ежедневный бонус (ТЗ §3): взят ли сегодня, какой день серии, сколько даст.
// Бан за выход из начатой игры (§13d, 23.10.2026): { secondsLeft, count } или null.
// Турнирный бан (§19.6, 24 часа) — тот же запрет за стол; tournament: true — бан за турнир.
function leaveBanOf(accountId: string): { secondsLeft: number; count: number; tournament: boolean } | null {
  const now = Date.now();
  const rec = leaveRecordOf(db, accountId);
  const leave = banSecondsLeft(rec, now);
  const tournament = Math.max(0, Math.ceil((tournamentBanUntil(db, accountId) - now) / 1000));
  const secondsLeft = Math.max(leave, tournament);
  return secondsLeft > 0 ? { secondsLeft, count: rec?.count ?? 0, tournament: tournament >= leave } : null;
}

// Во время бана за стол нельзя: ни создать игру, ни сесть в чужую (403).
function banError(accountId: string): { error: string; secondsLeft: number; count: number } | null {
  const ban = leaveBanOf(accountId);
  return ban ? { error: 'banned for leaving', ...ban } : null;
}

app.get('/me', (req, res) => {
  const account = accountOf(req);
  if (!account) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const today = dayKey(Date.now());
  const claim = dailyClaim(account.dailyDay, account.dailyStreak, today);

  return res.json({
    ...account,
    ...walletSplit(account),
    avatar: avatarOf(account.id),
    rating: shownRating(accountRating(account.id)),
    roomId: activeRoomOf(account.id)?.id ?? null,
    daily: {
      claimedToday: !claim.claimable,
      streak: claim.streak,
      amount: claim.claimable ? claim.amount : 0,
    },
    // Подарил ли уже весь дневной лимит; giftLeftToday — сколько ещё можно (08.10.2026).
    giftSentToday: giftLeftToday(giftedOn(db, account.id, today)) === 0,
    giftLeftToday: giftLeftToday(giftedOn(db, account.id, today)),
    invitedCount: invitedCount(db, account.id),
    // Сколько человек зовут меня в друзья — цифра у кнопки «ДРУЗЬЯ».
    friendRequests: friendRequests(db, account.id).incoming.length,
    hasRecoveryCode: hasRecoveryCode(db, account.id),
    // Друзья зовут в комнату (25.09.2026) — только те, куда ещё можно сесть.
    roomInvites: invitesFor(account.id),
    // Магазин (§17): что куплено и что надето — сукно и наборы смайликов нужны приложению за столом.
    shop: { owned: ownedItems(db, account.id), look: lookFor(account.id) },
    // Бан за выход из начатой игры (§13d, 23.10.2026): сколько ещё нельзя за стол. Нет — null.
    leaveBan: leaveBanOf(account.id),
    // Еженедельный турнир (§19): идёт ли, зарегистрирован ли я, мой стол. Нет турнира — null.
    tournament: tournamentBrief(account.id),
    tournamentWins: winsOf(account.id),
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
    balance: walletSplit(getAccount(db, account.id)!).balance,
    days: dailySchedule(), // монеты за дни 1…7 — для окна бонуса (26.10.2026)
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

// Игра в браузере и в Telegram (07.10.2026) — веб-сборка приложения:
// flutter build web --base-href /play/. Папка — GARBA_WEB_DIR (на сервере /opt/garba/web).
// index.html не кешируем: после выкладки игроки сразу получают новую версию.
const WEB_DIR = process.env.GARBA_WEB_DIR ?? join(process.cwd(), '../mobile/build/web');
app.get('/play', (req, res, next) => (req.originalUrl === '/play' ? res.redirect(301, '/play/') : next()));
app.use(
  '/play',
  express.static(WEB_DIR, {
    index: 'index.html',
    setHeaders: (res, file) => {
      if (file.endsWith('index.html') || file.endsWith('flutter_bootstrap.js')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }),
);

// Политика конфиденциальности (26.09.2026): страница для App Store и Google Play,
// ?format=json — для экрана в приложении. Без токена. Почта — GARBA_CONTACT_EMAIL.
const CONTACT_EMAIL = process.env.GARBA_CONTACT_EMAIL?.trim() || null;
app.get('/privacy', (req, res) => {
  if (req.query.format === 'json') {
    return res.json({ updated: PRIVACY_UPDATED, sections: privacySections(CONTACT_EMAIL) });
  }
  res.type('html').send(privacyHtml(CONTACT_EMAIL));
});
// Поддержка и удаление аккаунта — адрес для карточек App Store и Google Play.
app.get(['/', '/support'], (_req, res) => {
  res.type('html').send(supportHtml(CONTACT_EMAIL));
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
// Фото выключены (26.09.2026, решение владельца): пока без юриста не храним фото игроков.
// Включить — GARBA_AVATARS=1 (и avatarsEnabled в lib/core.dart). Выключены — у всех null.
const AVATARS_ON = process.env.GARBA_AVATARS === '1';
function avatarOf(accountId: string): string | null {
  return AVATARS_ON ? avatarPath(db, accountId) : null;
}

// Что надето из магазина (§17). Состояние комнаты строится на каждую рассылку для каждого
// смотрящего — поэтому держим в памяти, а меняется только в /shop/buy и /shop/equip.
const looks = new Map<string, Look>();
function lookFor(accountId: string): Look {
  let look = looks.get(accountId);
  if (!look) {
    look = lookOf(db, accountId);
    looks.set(accountId, look);
  }
  return look;
}
// Рамка аватарки — везде, где виден игрок: за столом, в лобби, в рейтинге, у друзей, в карточке.
function frameOf(accountId: string): string | null {
  return lookFor(accountId).frame;
}

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
    if (!AVATARS_ON) {
      return res.status(403).json({ error: 'avatars disabled' });
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

    return res.json({ avatar: avatarOf(account.id) });
  },
);

// Картинка аватара. Без токена: её грузит виджет картинки, а адрес знают только
// те, кому сервер его отдал (id аккаунта угадать нельзя).
app.get('/avatars/:id', (req, res) => {
  const avatar = AVATARS_ON ? loadAvatar(db, req.params.id) : null;
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
    ...walletSplit(account),
    createdAt: account.createdAt,
    avatar: avatarOf(account.id),
    frame: frameOf(account.id),
    rating: shownRating(accountRating(account.id)),
    stats: profileStats(db, account.id),
    // Медали за монеты (§16.9, 23.10.2026): полученные и следующая закрытая.
    medals: coinMedals(peakBalanceOf(db, account.id)),
    // Победы в еженедельном турнире (§19.12): значок 🏆×N в «ДОСТИЖЕНИЯХ».
    tournamentWins: winsOf(account.id),
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
    avatar: avatarOf(player.id),
    frame: frameOf(player.id),
    // Монеты видны всем, как за столом (решение владельца, 08.10.2026).
    balance: player.balance,
    rating: shownRating(accountRating(player.id)),
    stats: profileStats(db, player.id),
    medals: coinMedals(peakBalanceOf(db, player.id)),
    tournamentWins: winsOf(player.id),
    isFriend: areFriends(db, me.id, player.id),
    // friends | outgoing (я позвал) | incoming (он зовёт меня) | none
    friendStatus: friendStatus(db, me.id, player.id),
    // Я заблокировал этого игрока (29.09.2026).
    blocked: hasBlocked(db, me.id, player.id),
  });
});

// --- Блокировка и жалобы (29.09.2026, Apple Guideline 1.2; moderation.ts) ---

// Заблокировать: дружба и заявки между нами снимаются, его приглашения в комнаты — тоже.
app.post('/players/:code/block', (req, res) => {
  const me = accountOf(req);
  if (!me) return res.status(401).json({ error: 'unauthorized' });
  const other = findAccountByCode(db, normalizeCode(req.params.code));
  if (!other) return res.status(404).json({ error: 'player not found' });
  if (other.id === me.id) return res.status(400).json({ error: 'self' });
  // removeFriend сама пишет транзакцией — вложить её в ещё одну SQLite не даст.
  blockPlayer(db, me.id, other.id);
  removeFriend(db, me.id, other.id);
  dropRequests(db, me.id, other.id);
  roomInvites.set(me.id, (roomInvites.get(me.id) ?? []).filter((inv) => inv.fromId !== other.id));
  roomInvites.set(other.id, (roomInvites.get(other.id) ?? []).filter((inv) => inv.fromId !== me.id));
  console.log(`[BLOCK] ${me.name} заблокировал ${other.name}`);
  return res.json({ blocked: true });
});

app.delete('/players/:code/block', (req, res) => {
  const me = accountOf(req);
  if (!me) return res.status(401).json({ error: 'unauthorized' });
  const other = findAccountByCode(db, normalizeCode(req.params.code));
  if (!other) return res.status(404).json({ error: 'player not found' });
  unblockPlayer(db, me.id, other.id);
  return res.json({ blocked: false });
});

// Кого я заблокировал — список в профиле, чтобы можно было разблокировать.
app.get('/me/blocks', (req, res) => {
  const me = accountOf(req);
  if (!me) return res.status(401).json({ error: 'unauthorized' });
  const players = blockedIds(db, me.id)
    .map((id) => getAccount(db, id))
    .filter((a): a is Account => a !== null)
    .map((a) => ({ code: a.code, name: a.name }));
  return res.json({ players });
});

// Пожаловаться: reason — name (имя) | behavior (поведение за столом) | other.
// roomId — где это было, если жалоба из-за стола. Разбирает владелец: deploy/reports.sh.
app.post('/players/:code/report', (req, res) => {
  const me = accountOf(req);
  if (!me) return res.status(401).json({ error: 'unauthorized' });
  const other = findAccountByCode(db, normalizeCode(req.params.code));
  if (!other) return res.status(404).json({ error: 'player not found' });
  if (other.id === me.id) return res.status(400).json({ error: 'self' });
  const reason = req.body?.reason;
  if (!isReportReason(reason)) return res.status(400).json({ error: 'bad reason' });
  const roomId = isRoomCode(req.body?.roomId) ? String(req.body.roomId) : null;
  const result = addReport(db, { fromId: me.id, toId: other.id, toName: other.name, reason, roomId });
  if (result === 'already reported') return res.status(409).json({ error: 'already reported' });
  console.log(`[REPORT] ${me.name} → ${other.name} (${other.code}): ${reason}${roomId ? `, комната ${roomId}` : ''}`);
  return res.status(201).json({ ok: true });
});

// --- Рейтинг (ТЗ §38, RULES.md §16) ---
// scope=friends — я и мои друзья; scope=all — все игроки (первые 50 и моё место).
app.get('/rating', (req, res) => {
  const me = accountOf(req);
  if (!me) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  // По монетам (23.10.2026): весь баланс — кошелёк и за столом, первые 50.
  if (req.query.scope === 'coins') {
    const places = coinLeaders(db).map((p, i) => ({
      place: i + 1,
      code: p.code,
      name: p.name,
      avatar: avatarOf(p.id),
      frame: frameOf(p.id),
      coins: p.coins,
      rating: shownRating(accountRating(p.id)),
      me: p.id === me.id,
    }));
    return res.json({
      scope: 'coins',
      total: places.length,
      myPlace: places.find((p) => p.me)?.place ?? null,
      players: places.slice(0, 50),
    });
  }
  const friendsOnly = req.query.scope === 'friends';
  const list = friendsOnly
    ? ratedPlayers(db, [me.id, ...listFriends(db, me.id).map((f) => f.id)])
    : ratedPlayers(db);

  const places = list.map((p, i) => ({
    place: i + 1,
    code: p.code,
    name: p.name,
    avatar: avatarOf(p.id),
    frame: frameOf(p.id),
    rating: shownRating(p.rating),
    me: p.id === me.id,
  }));
  const myPlace = places.find((p) => p.me)?.place ?? null;
  const top = friendsOnly ? places : places.slice(0, 50);

  return res.json({ scope: friendsOnly ? 'friends' : 'all', total: places.length, myPlace, players: top });
});

// ТОП-3 недели (23.10.2026, §16.8): чистый плюс за столами с понедельника 00:00 по
// Казахстану. Только кто в плюсе; myCoins — мой итог недели (может быть и минус).
app.get('/rating/week', (req, res) => {
  const me = accountOf(req);
  if (!me) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const week = weekKey(Date.now());
  const rows = weekCoins(db, week);
  const top = weekTop(rows).map((p, i) => ({
    place: i + 1,
    code: p.code,
    name: p.name,
    avatar: avatarOf(p.id),
    frame: frameOf(p.id),
    coins: p.coins,
    me: p.id === me.id,
  }));
  return res.json({ week, players: top, myCoins: rows.find((r) => r.id === me.id)?.coins ?? 0 });
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
      avatar: avatarOf(f.id),
      frame: frameOf(f.id),
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
  if (blockedBetween(db, me.id, friend.id)) {
    return res.status(403).json({ error: 'blocked' });
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
  if (result !== 'friends') notifyTelegram(friend.id, `friend:${me.id}`, `${me.name} хочет добавить тебя в друзья в ГАРБЕ.`);
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
    avatar: avatarOf(a.id),
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
  if (!Number.isInteger(amount) || amount === 0 || walletSplit(account).balance + amount < 0) {
    return res.status(400).json({ error: 'bad amount' });
  }
  moveCoins([{ accountId: account.id, delta: amount }]);
  const balance = getAccount(db, account.id)!.balance;
  console.log(`[ADMIN] ${account.name}: ${amount > 0 ? '+' : ''}${amount} → ${balance}`);
  return res.json({ name: account.name, amount, balance });
});

// Жалобы — только с этого компьютера, как /admin/coins (29.09.2026). На сервере в интернете —
// через deploy/reports.sh (ssh + curl). Apple ждёт, что на жалобу отреагируют за сутки.
function localOnly(req: express.Request): boolean {
  return LOOPBACK.includes(req.socket.remoteAddress ?? '') && req.headers['x-forwarded-for'] === undefined;
}

app.get('/admin/reports', (req, res) => {
  if (!localOnly(req)) return res.status(403).json({ error: 'local only' });
  const reports = listReports(db, req.query.all === '1').map((r) => {
    const to = getAccount(db, r.toId);
    return {
      id: r.id,
      reason: r.reason,
      toCode: to?.code ?? null,
      toNameThen: r.toName,
      toNameNow: to?.name ?? null,
      fromName: getAccount(db, r.fromId)?.name ?? null,
      roomId: r.roomId,
      at: new Date(r.createdAt).toISOString(),
      resolved: r.resolvedAt !== null,
    };
  });
  return res.json({ reports });
});

// Разобрать жалобу — закрываются все открытые жалобы на того же игрока.
app.post('/admin/reports/:id/resolve', (req, res) => {
  if (!localOnly(req)) return res.status(403).json({ error: 'local only' });
  const closed = resolveReport(db, Number(req.params.id));
  if (closed === 0) return res.status(404).json({ error: 'no open report' });
  return res.json({ closed });
});

// Сменить игроку недопустимое имя. За столом — тоже, со следующего состояния комнаты.
app.post('/admin/rename', (req, res) => {
  if (!localOnly(req)) return res.status(403).json({ error: 'local only' });
  const account = findAccountByCode(db, normalizeCode(req.body?.code) ?? '');
  if (!account) return res.status(404).json({ error: 'player not found' });
  const name = cleanName(req.body?.name);
  if (!name || nameNotAllowed(name)) return res.status(400).json({ error: 'bad name' });
  setName(db, account.id, name);
  for (const room of rooms.values()) {
    const seat = room.players.find((p) => p.id === account.id);
    if (!seat) continue;
    seat.name = name;
    persistRoom(room);
    broadcastRoom(room.id).catch((e) => console.error(`[ROOM ${room.id}] broadcast failed:`, e));
  }
  console.log(`[ADMIN] имя ${account.name} → ${name} (${account.code})`);
  return res.json({ code: account.code, name });
});

// Удалить аккаунт нарушителя (повторные жалобы) — как «Удалить аккаунт» в профиле.
// Сидит за столом — 409: сначала пусть игра закончится, его деньги в ней.
app.post('/admin/delete', (req, res) => {
  if (!localOnly(req)) return res.status(403).json({ error: 'local only' });
  const account = findAccountByCode(db, normalizeCode(req.body?.code) ?? '');
  if (!account) return res.status(404).json({ error: 'player not found' });
  const room = activeRoomOf(account.id);
  if (room) return res.status(409).json({ error: 'player is in a game', roomId: room.id });
  if (unfinishedEntryOf(db, account.id)) return res.status(409).json({ error: 'player is in a tournament' });
  deleteAccountEverywhere(account);
  return res.json({ ok: true, name: account.name });
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

  if (blockedBetween(db, from.id, to.id)) {
    return res.status(403).json({ error: 'blocked' });
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
    sentToday: giftedOn(db, from.id, today),
    toSelf: to.id === from.id,
  });
  if (error) {
    const leftToday = giftLeftToday(giftedOn(db, from.id, today));
    return res
      .status(error === 'already gifted today' || error === 'over daily limit' ? 409 : 400)
      .json({ error, leftToday });
  }

  moveCoins(
    [
      { accountId: from.id, delta: -amount },
      { accountId: to.id, delta: amount },
    ],
    () => recordGift(db, from.id, to.id, amount, today),
  );
  console.log(`[GIFT] ${from.name} → ${to.name}: ${amount}`);

  return res.json({
    amount,
    balance: from.balance - amount,
    to: { code: to.code, name: to.name },
    leftToday: giftLeftToday(giftedOn(db, from.id, today)),
  });
});

// --- Магазин (RULES.md §17, 13.10.2026; shop.ts) ---
// Только внешний вид. Монеты за покупку сгорают, купленное — навсегда.

// Витрина: все вещи с ценами, что куплено и что надето, сколько монет вне стола.
function shopState(account: Account) {
  const owned = ownedItems(db, account.id);
  const look = lookFor(account.id);
  return {
    items: SHOP_ITEMS.map((item) => ({
      ...item,
      owned: owned.includes(item.id),
      equipped: item.kind !== 'pack' && look[item.kind] === item.id,
    })),
    look,
    balance: walletSplit(account).balance,
    // Сидит за столом — купить нельзя, надеть можно.
    roomId: activeRoomOf(account.id)?.id ?? null,
  };
}

app.get('/shop', (req, res) => {
  const account = accountOf(req);
  if (!account) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return res.json(shopState(account));
});

// Купить: монеты сгорают, вещь сразу надевается (набор — сразу в окне смайликов).
// За столом нельзя, как и дарить: монеты за столом считаются в комнате.
app.post('/shop/buy', (req, res) => {
  const account = accountOf(req);
  if (!account) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const busyIn = activeRoomOf(account.id);
  if (busyIn) {
    return res.status(409).json({ error: 'finish your game first', roomId: busyIn.id });
  }

  const error = buyError(req.body?.itemId, account.balance, ownedItems(db, account.id));
  if (error === 'unknown item') return res.status(404).json({ error });
  if (error === 'already owned') return res.status(409).json({ error });
  const item = shopItem(req.body?.itemId)!;
  if (error === 'not enough coins') {
    return res.status(400).json({ error, price: item.price, balance: account.balance });
  }

  moveCoins([{ accountId: account.id, delta: -item.price }], () => {
    recordPurchase(db, account.id, item, Date.now());
    if (item.kind !== 'pack') setEquipped(db, account.id, item.kind, item.id);
  });
  looks.delete(account.id);
  console.log(`[SHOP] ${account.name}: купил ${item.name} (${item.id}) за ${item.price}`);

  return res.json(shopState(getAccount(db, account.id)!));
});

// Надеть купленное или снять (itemId: null — вернуть бесплатное, как у всех). Можно и за столом:
// остальные увидят новую рамку и рубашку сразу.
app.post('/shop/equip', (req, res) => {
  const account = accountOf(req);
  if (!account) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const slot = req.body?.slot;
  const itemId = req.body?.itemId ?? null;
  const error = equipError(slot, itemId, ownedItems(db, account.id));
  if (error === 'not owned') return res.status(403).json({ error });
  if (error) return res.status(400).json({ error });

  setEquipped(db, account.id, slot as Slot, itemId);
  looks.delete(account.id);

  const room = activeRoomOf(account.id);
  if (room) broadcastRoom(room.id).catch((e) => console.error(`[ROOM ${room.id}] broadcast failed:`, e));

  return res.json(shopState(account));
});

// Продажи магазина — только с этого компьютера: что купили и сколько монет сгорело.
app.get('/admin/shop', (req, res) => {
  if (!localOnly(req)) return res.status(403).json({ error: 'local only' });
  const sales = shopSales(db).map((s) => ({ ...s, name: shopItem(s.itemId)?.name ?? s.itemId }));
  return res.json({ sales, burned: sales.reduce((sum, s) => sum + s.coins, 0) });
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

// Адрес игрока для сокета — как у Express с 'trust proxy loopback': Caddy дописывает
// настоящий адрес в конец X-Forwarded-For, верим только ему (28.09.2026).
function socketIp(req: IncomingMessage): string {
  const chain = [req.socket.remoteAddress ?? 'unknown'];
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') chain.push(...forwarded.split(',').map((a) => a.trim()).reverse());
  return chain.find((a) => !LOOPBACK.includes(a)) ?? chain[0];
}

// Сокет не проходит через Express — общий лимит с адреса проверяем и здесь, при
// подключении, плюс не больше MAX_SOCKETS_PER_IP открытых сокетов с одного адреса
// (у мобильных операторов много игроков за одним адресом — запас большой).
const MAX_SOCKETS_PER_IP = 200;
const socketsByIp = new Map<string, number>();
function socketAllowed(req: IncomingMessage): boolean {
  const ip = socketIp(req);
  if (LOOPBACK.includes(ip)) return true;
  if ((socketsByIp.get(ip) ?? 0) >= MAX_SOCKETS_PER_IP) return false;
  const check = rateCheck(requestsByIp.get(ip) ?? [], Date.now(), REQUEST_LIMIT);
  requestsByIp.set(ip, check.times);
  return check.allowed;
}

const io = new SocketServer(httpServer, {
  cors: { origin: '*' },
  allowRequest: (req, callback) => callback(null, socketAllowed(req)),
  // От приложения приходит только 'watch' в пару строк — большие сообщения не нужны.
  maxHttpBufferSize: 16_000,
});

// Частые 'watch' с одного сокета: каждый — поиск токена в базе и состояние комнаты.
const WATCH_LIMIT = [{ max: 10, windowMs: 10_000 }];

io.on('connection', (socket) => {
  const ip = socketIp(socket.request);
  socketsByIp.set(ip, (socketsByIp.get(ip) ?? 0) + 1);
  // Ушёл зритель — счётчик 👁 у стола меньше (§18). В 'disconnect' комнаты сокета уже пусты.
  socket.on('disconnecting', () => {
    socket.data.lastRooms = [...socket.rooms].filter((r) => r !== socket.id);
  });
  socket.on('disconnect', (reason) => {
    const watcher = socket.data.playerId;
    if (typeof watcher === 'string') {
      for (const roomId of (socket.data.lastRooms as string[] | undefined) ?? []) broadcastSpectators(roomId, watcher);
    }
    const left = (socketsByIp.get(ip) ?? 1) - 1;
    if (left > 0) socketsByIp.set(ip, left);
    else socketsByIp.delete(ip);
    // Почему рвётся связь посреди игры (10.10.2026): «transport close» / «ping timeout» —
    // телефон свернул игру или пропала сеть; «client namespace disconnect» — сменился экран.
    const playerId = socket.data.playerId;
    if (typeof playerId !== 'string') return;
    for (const room of rooms.values()) {
      if (room.status !== 'started' || !room.players.some((p) => p.id === playerId)) continue;
      const name = room.players.find((p) => p.id === playerId)?.name;
      console.log(`[ROOM ${room.id}] socket closed: ${name} (${reason})`);
    }
  });

  socket.on('watch', (payload: { roomId?: unknown; token?: unknown }) => {
    const watchCheck = rateCheck((socket.data.watchTimes as number[] | undefined) ?? [], Date.now(), WATCH_LIMIT);
    socket.data.watchTimes = watchCheck.times;
    if (!watchCheck.allowed) return;

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

    // Наблюдатель (§18): сам в начатой игре или за столом тот, с кем блок, — нельзя.
    const refusal = spectateRefusalFor(room, playerId);
    if (refusal) {
      socket.emit('room_error', { error: refusal });
      return;
    }

    // Один сокет — одна комната: при повторном watch уходим из прежней.
    // Ушёл зритель — у той комнаты счётчик 👁 меньше.
    for (const joined of socket.rooms) {
      if (joined === socket.id || joined === roomId || joined === TOURNAMENT_ROOM) continue;
      socket.leave(joined);
      if (typeof socket.data.playerId === 'string') broadcastSpectators(joined, socket.data.playerId);
    }

    socket.data.playerId = playerId;
    const wasWatching = socket.rooms.has(roomId);
    socket.join(roomId);
    // Пришёл новый зритель — игрокам и зрителям новое число 👁.
    if (!wasWatching) broadcastSpectators(roomId, playerId);

    // Игрок сам открыл стол — значит, вернулся: «ушёл» снимается (§13a), иначе
    // пауза держалась бы, пока он не найдёт кнопку «Я ЗДЕСЬ».
    if (room.game?.awayAt?.[playerId] !== undefined && room.players.some((p) => p.id === playerId)) {
      markBack(room, playerId);
      persistRoom(room);
      broadcastRoom(room.id).catch((e) => console.error(`[ROOM ${room.id}] broadcast failed:`, e));
    }
    socket.emit('room', publicRoom(room, playerId));
  });

  // Экран «ТУРНИР» (§19): следить за турниром — сразу и после каждого изменения.
  socket.on('watch_tournament', (payload: { token?: unknown }) => {
    const watchCheck = rateCheck((socket.data.watchTimes as number[] | undefined) ?? [], Date.now(), WATCH_LIMIT);
    socket.data.watchTimes = watchCheck.times;
    if (!watchCheck.allowed) return;
    const account = findAccountByToken(db, String(payload?.token ?? ''));
    if (!account) {
      socket.emit('tournament_error', { error: 'unauthorized' });
      return;
    }
    socket.data.tournamentViewer = account.id;
    socket.join(TOURNAMENT_ROOM);
    socket.emit('tournament', tournamentView(account.id));
  });
});

// Разослать состояние комнаты всем, кто за ней следит, — каждому со своей рукой.
// Токен сменился (восстановление по коду) или аккаунт удалён — уже открытые сокеты
// с этим аккаунтом больше не получают его руку (28.09.2026).
function dropSocketsOf(accountId: string) {
  io.fetchSockets()
    .then((list) => {
      for (const s of list) if (s.data.playerId === accountId) s.disconnect(true);
    })
    .catch((e) => console.error('drop sockets failed:', e));
}

// Сколько зрителей у стола (§18): разные аккаунты среди сокетов комнаты, кроме сидящих.
function spectatorsOf(room: Room): number {
  const watcherIds: string[] = [];
  for (const socketId of io.sockets.adapter.rooms.get(room.id) ?? []) {
    const id = io.sockets.sockets.get(socketId)?.data.playerId;
    if (typeof id === 'string') watcherIds.push(id);
  }
  return spectatorCount(room.status, watcherIds, room.players.map((p) => p.id));
}

// Можно ли этому аккаунту смотреть стол (§18) — null, если можно.
function spectateRefusalFor(room: Room, accountId: string) {
  const member = room.players.some((p) => p.id === accountId);
  if (member || room.status !== 'started') return null;
  const elsewhere = activeRoomOf(accountId);
  const avoid = avoidIds(db, accountId);
  return spectateRefusal({
    member,
    status: room.status,
    playingElsewhere: elsewhere !== undefined && elsewhere.status === 'started',
    blocked: room.players.some((p) => avoid.has(p.id)),
  });
}

// Зритель пришёл или ушёл — разослать новое число 👁. Игрок своего стола сокет открывает
// и закрывает постоянно (свернул приложение) — тогда рассылать нечего.
function broadcastSpectators(roomId: string, accountId: string) {
  const room = rooms.get(roomId);
  if (!room || room.status === 'lobby' || room.players.some((p) => p.id === accountId)) return;
  broadcastRoom(roomId).catch((e) => console.error(`[ROOM ${roomId}] broadcast failed:`, e));
}

async function broadcastRoom(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  const sockets = await io.in(roomId).fetchSockets();
  const viewerOf = (s: (typeof sockets)[number]) =>
    typeof s.data.playerId === 'string' ? (s.data.playerId as string) : undefined;
  // Право смотреть (§18) проверяем при каждой рассылке, а не только при 'watch': зритель
  // мог с тех пор сесть за другую игру, или появилась блокировка, или он следил за лобби,
  // а игра началась. Сначала убираем таких — чтобы остальным ушло уже верное число 👁.
  const allowed = sockets.filter((s) => {
    const viewer = viewerOf(s);
    const refusal = viewer === undefined ? null : spectateRefusalFor(room, viewer);
    if (!refusal) return true;
    s.leave(roomId);
    s.emit('room_error', { error: refusal });
    return false;
  });
  for (const s of allowed) s.emit('room', publicRoom(room, viewerOf(s)));
  // Турнирный стол поменялся — на экране «ТУРНИР» тоже (кто сел, игра идёт, итог).
  if (room.tournament) scheduleTournamentBroadcast();
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
// Запас на отлучку этой комнаты (выбирает создатель, 1…5 минут). Для проверок — GARBA_DISCONNECT_MS.
const absenceMsOf = (room: Room) =>
  process.env.GARBA_DISCONNECT_MS ? presenceOpts.timeoutMs : absenceMsFor(room.settings.absenceMinutes);
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
    absenceMsOf(room),
    room.game?.absenceFreeMs ?? {},
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
  // Боты сервера сокета не держат, но всегда на месте.
  return [...ids, ...(rooms.get(roomId)?.botIds ?? [])];
}

// Игрок ушёл из игры: «Выйти» между раздачами или кончился запас на отлучку (1…5 минут).
// Кон сразу делится между оставшимися (остаток — тому, кто больше всех проиграл, как в
// §12.2), ушедшему −1.0 рейтинга (§16.3a), и игра заканчивается (08.10.2026).
// close = false — вызывающий уберёт ещё кого-то и закроет игру сам (finishLeaving), один раз:
// иначе итог комнаты и рейтинг оставшимся посчитались бы дважды.
function vacateSeat(room: Room, playerId: string, reason: 'left' | 'gone', close = true) {
  const game = room.game!;
  const player = room.players.find((p) => p.id === playerId);
  if (!player || room.status === 'finished') return;
  // Турнирный стол: кон остаётся на столе, ушедший наказан, стол меньше (§19.4, §19.6).
  if (room.tournament) {
    tournamentDrop(room, playerId, reason);
    if (close) finishLeaving(room);
    return;
  }
  const rest = room.players.filter((p) => p.id !== playerId);

  // Место уже пустовало до него — уход без штрафа к рейтингу (§16.3a, 08.10.2026).
  const seatAlreadyEmpty = (room.vacancies?.length ?? 0) > 0;
  // Шла просьба докупить (§9.1c) — состав стола меняется, спрашивать некого: отменяется.
  game.topUpVote = null;
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

  // Сначала итог его партий за этим столом (§16.3b), потом штраф за уход (§16.3a) — отдельно.
  const r = ratingState(room, playerId);
  r.skill = applyLeave(settleRating(r), leavePenalty(seatAlreadyEmpty));

  // Раздавать должен был он — раздаёт следующий по кругу (§13c).
  if (rest.length > 0) {
    game.dealerId = dealerAfterLeave(room.players.map((p) => p.id), game.dealerId, playerId);
    game.dealerName = rest.find((p) => p.id === game.dealerId)?.name ?? game.dealerName;
  }

  // Его баланс и рейтинг уходят с ним: пишем в аккаунт сейчас — комната его больше
  // не сохраняет. На тренировке с ботами всё не настоящее — аккаунт не трогаем.
  if (!room.practice) {
    setBalance(db, playerId, player.balance + (player.reserve ?? 0));
    setSkill(db, playerId, r.skill);
  }
  // Для «ИТОГОВ ИГРЫ»: ушедший тоже играл — его строка остаётся (11.10.2026).
  // На тренировке рейтинг не меняется — как и у сидящих, показываем тот, что в аккаунте.
  room.departed = [
    ...(room.departed ?? []).filter((d) => d.id !== playerId),
    {
      id: playerId,
      name: player.name,
      startBalance: player.startBalance,
      balance: player.balance,
      ratingStart: shownRating(room.practice ? accountRating(playerId) : startRating(room, playerId)),
      rating: shownRating(room.practice ? accountRating(playerId) : liveRating(room, playerId)),
      bot: room.botIds?.includes(playerId) ?? false,
    },
  ];
  // Вернётся за этот стол — рейтинг возьмём из аккаунта заново: он мог сыграть где-то ещё.
  delete room.rating?.[playerId];
  room.departedIds = [...(room.departedIds ?? []).filter((id) => id !== playerId), playerId];
  room.players = rest;
  forgetSeat(room, playerId);

  console.log(
    `[ROOM ${room.id}] ${player.name} ${reason === 'left' ? 'вышел из игры' : 'не вернулся (кончился запас на отлучку)'} — ` +
      `кон ${game.lastLeave.kon} разделён: по ${perPlayer}`,
  );
  if (close) finishLeaving(room);
}

// Всё, что про ушедшего помнили пауза и таймер хода.
function forgetSeat(room: Room, playerId: string) {
  const game = room.game!;
  const drop = <T>(rec: Record<string, T> | undefined) => {
    if (!rec) return rec;
    const copy = { ...rec };
    delete copy[playerId];
    return copy;
  };
  game.awayAt = drop(game.awayAt);
  game.missedTurns = drop(game.missedTurns);
  game.absenceUsedMs = drop(game.absenceUsedMs);
  game.absenceFreeMs = drop(game.absenceFreeMs);
  game.goneIds = (game.goneIds ?? []).filter((id) => id !== playerId);
  const pres = presence.get(room.id);
  if (pres) presence.set(room.id, { lastSeen: drop(pres.lastSeen)!, disconnectedAt: drop(pres.disconnectedAt)! });
  absentSince.set(room.id, drop(absentSince.get(room.id)) ?? {});
}

// Кто-то ушёл. Кон уже поделён. Осталось 4 и больше — спрашиваем всех: играть дальше
// без него или закрыть (§13c, 09.10.2026). Меньше 4 — игра заканчивается, остальным —
// итог комнаты по §16.3b (как с 08.10.2026). Комнаты со старым пустым местом (до 08.10)
// закрываются, как раньше.
function finishLeaving(room: Room) {
  if (room.status === 'finished') return;
  if (room.tournament) {
    finishTournamentLeaving(room);
    return;
  }
  const game = room.game!;
  if (room.players.length === 0) {
    game.stage = 'room_done';
    game.closeReason = 'player_left';
    room.status = 'finished';
    return;
  }
  const humans = room.players.filter((p) => !room.botIds?.includes(p.id)).length;
  if (!room.vacancies?.length && canKeepPlaying(room.players.length, humans)) {
    // Если шло «закончить игру» — его заменяет этот вопрос; ушёл ещё кто-то во время
    // голосования — спрашиваем заново, уже про новый состав.
    game.endVote = null;
    game.shrinkVote = { leftName: game.lastLeave?.name ?? '', yes: [], startedAt: Date.now() };
    console.log(`[ROOM ${room.id}] спрашиваем: играть дальше вчетвером+ (${room.players.length}) или закрыть`);
    return;
  }
  game.shrinkVote = null;
  closeWithSplit(room, 'player_left');
}

// Подвести голосование «играть без ушедшего» (§13c): все люди «продолжаем» — стол
// становится меньше; 30 секунд без ответа — закрываем.
function settleShrinkVote(room: Room) {
  const game = room.game;
  const vote = game?.shrinkVote;
  if (!game || !vote || room.status === 'finished') return;
  const humanIds = room.players.map((p) => p.id).filter((id) => !room.botIds?.includes(id));
  const outcome = shrinkVoteOutcome(vote, humanIds, Date.now());
  if (outcome === 'pending') return;
  game.shrinkVote = null;
  if (outcome === 'close') {
    console.log(`[ROOM ${room.id}] не все ответили «продолжаем» — игра закончена`);
    closeWithSplit(room, 'player_left');
    return;
  }
  shrinkTable(room);
}

// Играем дальше меньшим столом: места заново 0…n−1 в том же порядке, колода, РАЗ, ДВА,
// ИЗЖОГА и базовый кон — по новому числу игроков (§3, §6, §9). Новый игрок на место
// ушедшего не садится — стол просто меньше.
function shrinkTable(room: Room) {
  const game = room.game!;
  const from = room.capacity;
  const seats = renumberSeats(room.players.map((p) => p.seat ?? 0));
  room.players.forEach((p, i) => (p.seat = seats[i]));
  room.players.sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
  room.capacity = room.players.length;
  game.lastShrink = { from, to: room.capacity };
  // «Последний кон» (§12.1) кончился: кон поделили при уходе. Обедневший мог уйти сам,
  // а базовый кон стал меньше — смотрим заново по новому столу (11.10.2026: впятером
  // Кайрат обеднел и вышел, вчетвером комната закрылась после первого же взятого кона).
  game.closing = false;
  updateClosing(room);
  console.log(`[ROOM ${room.id}] все согласны — играем дальше: ${from} → ${room.capacity} игроков`);
}

// Пропал на 5 минут посреди раздачи: главный — сразу проигрыш (как сдался, §10.7),
// дальше за него доигрывает таймер хода; после раздачи место освобождается.
function markGone(room: Room, playerId: string) {
  const game = room.game!;
  if (game.goneIds?.includes(playerId)) return;
  game.goneIds = [...(game.goneIds ?? []), playerId];
  const name = room.players.find((p) => p.id === playerId)?.name;
  console.log(`[ROOM ${room.id}] ${name} не вернулся (кончился запас на отлучку) — доигрываем раздачу за него`);
  if (concedeAllowed(game, playerId)) concede(room, playerId);
}

// Место пустует 10 минут — никто не сел: игра заканчивается, кон (обычно уже пуст —
// его разделили при уходе) делится между оставшимися. Для проверок — GARBA_VACANCY_MS.
const vacancyMs = Number(process.env.GARBA_VACANCY_MS ?? 10 * 60_000);

setInterval(guarded('vacancies', () => {
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
}), 1000);

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
    const wasOffline = presenceOf(room.id).disconnectedAt;
    presence.set(room.id, { lastSeen: step.lastSeen, disconnectedAt: step.disconnectedAt });
    // Пропал из игры — бот в Telegram напомнит, что стол ждёт.
    for (const id of Object.keys(step.disconnectedAt)) {
      if (wasOffline[id] === undefined) {
        notifyTelegram(id, `offline:${room.id}`, `Игра #${room.id} на паузе — стол ждёт тебя. Вернись в течение ${Math.round(absenceMsOf(room) / 60_000)} мин.`, `room_${room.id}`);
      }
    }

    // Общий запас 5 минут на всю игру — и на потерю связи, и на «ушёл» (§13, §13a).
    const absence = absenceOf(room, now);
    absentSince.set(room.id, absence.since);
    const usedChanged =
      JSON.stringify(absence.usedMs) !== JSON.stringify(room.game!.absenceUsedMs ?? {}) ||
      JSON.stringify(absence.freeUsedMs) !== JSON.stringify(room.game!.absenceFreeMs ?? {});
    room.game!.absenceUsedMs = absence.usedMs;
    room.game!.absenceFreeMs = absence.freeUsedMs;
    const expired = absence.expired;

    // Пропавшие посреди раздачи: раздача сыграна — освобождаем места.
    const gone = room.game!.goneIds ?? [];
    const goneNow = betweenDeals(room.game!.stage) ? gone : [];

    if (expired.length > 0 || goneNow.length > 0) {
      // Сначала убираем всех ушедших, игру закрываем один раз.
      const between = betweenDeals(room.game!.stage);
      let leftSomeone = false;
      for (const id of goneNow) {
        vacateSeat(room, id, 'gone', false);
        leftSomeone = true;
      }
      for (const id of expired) {
        if (!room.players.some((p) => p.id === id)) continue;
        if (between) {
          vacateSeat(room, id, 'gone', false);
          leftSomeone = true;
        } else markGone(room, id);
      }
      if (leftSomeone) finishLeaving(room);
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

setInterval(guarded('presence', sweepPresence), 1000);

// Голосование «закончить игру» без ответа 30 секунд — считается «нет» (§12.3).
// Проверяем раз в секунду, иначе при раздающем-боте оно висело бы, пока кто-то не нажмёт.
setInterval(guarded('end vote', () => {
  for (const room of rooms.values()) {
    if (room.game?.endVote) {
      settleEndVote(room);
      if (!room.game.endVote) {
        persistRoom(room);
        broadcastRoom(room.id).catch((e) => console.error(`[ROOM ${room.id}] broadcast failed:`, e));
      }
    }
    // То же для «играть без ушедшего» (§13c): 30 секунд без ответа — закрываем.
    if (room.game?.shrinkVote) {
      settleShrinkVote(room);
      if (!room.game.shrinkVote) {
        persistRoom(room);
        broadcastRoom(room.id).catch((e) => console.error(`[ROOM ${room.id}] broadcast failed:`, e));
      }
    }
    // И «докупить» (§9.1c): 30 секунд без ответа — докупки нет.
    if (room.game?.topUpVote) {
      settleTopUpVote(room);
      if (!room.game.topUpVote) {
        persistRoom(room);
        broadcastRoom(room.id).catch((e) => console.error(`[ROOM ${room.id}] broadcast failed:`, e));
      }
    }
  }
}), 1000);

// Запрос игрока к своей комнате — тоже знак, что он на месте (приложение без сокета
// опрашивает сервер). На паузе ходы не принимаются: ждём отключившегося.
const LOBBY_ACTIONS = ['/join', '/leave', '/ready', '/back', '/react', '/invite'];
app.use('/rooms/:id', (req, res, next) => {
  const room = rooms.get(req.params.id);
  // Ход по таймеру выбран для решения, которого сервер ждал тогда. Ждём уже другого —
  // игрок успел сам, устаревший ход не делаем (28.09.2026).
  const moveKey = req.headers['x-garba-move-key'];
  if (res.locals.internal && typeof moveKey === 'string') {
    const awaitedKey = room ? awaitedMoves(room)?.key : undefined;
    if (awaitedKey === undefined || encodeURIComponent(awaitedKey) !== moveKey) {
      return res.status(409).json({ error: 'stale timed move' });
    }
  }
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
  // «Играть без ушедшего» — отвечают и на паузе: молчание всё равно закроет игру (§13c).
  if (req.method === 'POST' && req.path === '/shrink-vote') return next();
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

// Анимация раздачи у игроков (27.09.2026): время на ход и ходы ботов — только после неё.
// Живёт в памяти: после перезапуска приложение тоже покажет раздачу заново.
const dealShows = new Map<string, DealShow>();
const DEAL_SHOWN_STAGES = ['bidding', 'special', 'special_discard', 'kon_trump'];

// Раздача сыграна — до какого момента все смотрят открытые карты (§10.8, 22.10.2026):
// следующую раздачу раздать нельзя, часы раздающего и боты ждут. 0 — смотреть нечего.
function handsShownAt(room: Room): number {
  const g = room.game;
  if (!g || g.stage !== 'round_done' || !g.result || !g.roundDoneAt) return 0;
  const reveal = g.result.some((r) => r.garba || (r.instant && r.declaration === 'ДВА'));
  return g.roundDoneAt + roundShowMs(reveal);
}

// Когда у игроков закончится анимация текущей раздачи (0 — раздачи нет).
// Раздача сыграна — когда все досмотрят открытые карты.
function dealShownAt(room: Room): number {
  const g = room.game;
  if (!g) return 0;
  const hands = handsShownAt(room);
  if (hands) return hands;
  // Первый раздающий: сначала все досматривают вскрытие на туза.
  if (g.stage === 'dealer_found' && !g.openCard) {
    const prev = dealShows.get(room.id);
    if (prev?.key === 'reveal') return prev.shownAt;
    const shownAt = Date.now() + revealShowMs(g.revealLog?.length ?? 0);
    dealShows.set(room.id, { key: 'reveal', dealt: 0, shownAt });
    return shownAt;
  }
  // Пересдача после трёх ИЗЖОГ: раздающий ждёт, пока у всех покажутся эти ИЗЖОГИ.
  if (g.stage === 'awaiting_deal' && g.lastRedeal === 'three_izzhoga') {
    const izzhogaKey = `izzhoga:${g.dealNumber ?? 0}`;
    const prev = dealShows.get(room.id);
    if (prev?.key === izzhogaKey) return prev.shownAt;
    const shownAt = Date.now() + threeIzzhogaShowMs(g.izzhoga?.length ?? 0);
    dealShows.set(room.id, { key: izzhogaKey, dealt: 0, shownAt });
    return shownAt;
  }
  if (!g.openCard) return 0;
  const key = String(g.dealNumber ?? 0);
  const prev = dealShows.get(room.id);
  // Приложение начинает показ раздачи только в этих стадиях — сервер так же.
  if (!DEAL_SHOWN_STAGES.includes(g.stage) && prev?.key !== key) return prev?.shownAt ?? 0;
  // Сколько карт видно на столе — как handCounts (в слепом круге туза — 0).
  const visible = visibleCardCount(g);
  const counts = Object.values(g.hands).map((cards) => Math.min(cards.length, visible ?? cards.length));
  const cards = Math.min(5, Math.max(0, ...counts));
  const next = dealShowStep(prev, key, cards, room.players.length, g.izzhoga?.length ?? 0, Date.now());
  if (next) dealShows.set(room.id, next);
  return next?.shownAt ?? 0;
}
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
      // Пока голосуют «закончить игру», «играть без ушедшего» или «докупить», раздавать
      // нельзя (§12.3, §13c, §9.1c).
      if (g.endVote || g.shrinkVote || g.topUpVote) return null;
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
  const clock = clockFor(turnClocks.get(room.id), awaited?.key ?? null, Date.now(), dealShownAt(room));
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

// awaitedKey — какое решение ждал таймер, когда выбирал ход. Пока запрос шёл, игрок
// мог успеть сам (нажал на последней секунде) — тогда сервер отклонит устаревший ход,
// а не сыграет за него случайной картой уже в новой взятке (28.09.2026).
async function internalMove(roomId: string, move: TimedMove, awaitedKey?: string): Promise<boolean> {
  const res = await fetch(`http://127.0.0.1:${PORT}/rooms/${roomId}/${move.path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-garba-internal': INTERNAL_SECRET,
      'x-garba-player': move.playerId,
      ...(awaitedKey !== undefined ? { 'x-garba-move-key': encodeURIComponent(awaitedKey) } : {}),
    },
    body: JSON.stringify(move.body),
  });
  // Сервер отказал ходу за игрока или бота — в журнал, иначе такие ошибки не видно.
  if (!res.ok) {
    console.error(`[ROOM ${roomId}] ход ${move.path} за ${move.playerId} отклонён: ${res.status} ${await res.text()}`);
  }
  return res.ok;
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
        const ok = await internalMove(room.id, move, awaited.key);
        if (!room.game || room.status !== 'started') break;
        // Ход не прошёл (игрок успел сам) — это не пропуск.
        if (!ok) continue;
        const name = room.players.find((p) => p.id === move.playerId)?.name;
        console.log(`[ROOM ${room.id}] время вышло — за ${name}: ${move.path} ${JSON.stringify(move.body)}`);
        // Боту пропуски не считаем: «Я ЗДЕСЬ» он не нажмёт, и стол встал бы на паузу.
        if (gone.includes(move.playerId) || room.botIds?.includes(move.playerId)) continue;
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
  room.weekly = addWeekly(room.weekly ?? {}, weekKey(Date.now()), playerId, delta);
}

// Комната закрылась — отмечаем победителя (§36).
function markWinners(room: Room) {
  room.game!.winnerIds = roomWinners(
    room.players.map((p) => ({ id: p.id, diff: p.balance - p.startBalance })),
  );

  // Комната закончилась — накопленное за партии становится мастерством (§16.3b): монеты
  // за комнату на рейтинг не влияют. Не вернувшемуся (§13) — ещё штраф за уход (§16.3a).
  const leftIds = room.game!.leftPlayerIds ?? [];
  for (const p of room.players) {
    const r = ratingState(room, p.id);
    r.skill = settleRating(r);
    if (leftIds.includes(p.id)) r.skill = applyLeave(r.skill, leavePenalty(false));
  }
}

// Итог партий игрока за этим столом: накопленное × время игры, потеря — не больше 0.25.
// Второй раз не засчитывается.
function settleRating(r: NonNullable<Room['rating']>[string]): number {
  const skill = settleRoom(r.skill, r.pending ?? 0, r.activeMs ?? 0);
  r.pending = 0;
  r.activeMs = 0;
  return skill;
}

// --- Рейтинг (RULES.md §16, этап 9.6) ---

// Мастерство и опыт игрока за этим столом. Заводится при старте игры; для комнат,
// поднятых из базы до этапа 9.6, — при первом обращении.
function ratingState(room: Room, playerId: string) {
  room.rating ??= {};
  if (!room.rating[playerId]) {
    const account = getAccount(db, playerId);
    const skill = account?.skill ?? START_SKILL;
    room.rating[playerId] = { skill, startSkill: skill, startExp: playerExperience(db, playerId, room), pending: 0, activeMs: 0 };
  }
  return room.rating[playerId];
}

// Рейтинг прямо сейчас: мастерство + опыт, включая время и партии этой комнаты.
function liveRating(room: Room, playerId: string): number {
  return ratingOf(ratingState(room, playerId).skill, playerExperience(db, playerId, room));
}

// Время и партии игрока за столом в этот день (опыт, §16.1).
function activityOf(room: Room, playerId: string, day: string) {
  room.activity ??= {};
  room.activity[playerId] ??= {};
  return (room.activity[playerId][day] ??= { ms: 0, deals: 0 });
}

// Реальное игровое время (§16.1, §16.3b): раз в секунду — всем, кто сидит за начатым
// столом, если игра не на паузе (отключился, «ушёл», пустое место). Лобби не считается.
// Сервер стоял — разрыв больше 5 секунд не засчитываем.
let lastActiveTick = Date.now();
setInterval(guarded('active time', () => {
  const now = Date.now();
  const dt = Math.min(5_000, Math.max(0, now - lastActiveTick));
  lastActiveTick = now;
  const day = dayKey(now);
  for (const room of rooms.values()) {
    if (room.status !== 'started' || !room.game || room.game.stage === 'room_done' || isPaused(room)) continue;
    for (const p of room.players) {
      const r = ratingState(room, p.id);
      r.activeMs = (r.activeMs ?? 0) + dt;
      activityOf(room, p.id, day).ms += dt;
    }
  }
}), 1000);

// С каким рейтингом игрок сел за стол. Комнаты до 26.10.2026 помнили число партий.
function startRating(room: Room, playerId: string): number {
  const r = ratingState(room, playerId);
  r.startExp ??= Math.min(2, (r.startDeals ?? 0) * 0.01);
  return ratingOf(r.startSkill, r.startExp);
}

// Первая десятка общего рейтинга (09.10.2026): за столом и в лобби у таких игроков — «ТОП-N».
// Таблица считается по всем аккаунтам, а publicRoom зовётся на каждую рассылку — поэтому
// храним готовые места 30 секунд.
const TOP_PLACES = 10;
let topCache: { at: number; places: Map<string, number> } | null = null;
function topPlaceOf(playerId: string): number | null {
  const now = Date.now();
  if (!topCache || now - topCache.at > 30_000) {
    const places = new Map<string, number>();
    ratedPlayers(db).slice(0, TOP_PLACES).forEach((p, i) => places.set(p.id, i + 1));
    topCache = { at: now, places };
  }
  return topCache.places.get(playerId) ?? null;
}

// Рейтинг игрока вне стола — из базы.
function accountRating(playerId: string): number {
  const account = getAccount(db, playerId);
  return ratingOf(account?.skill ?? START_SKILL, playerExperience(db, playerId));
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
  // В турнире «последнего кона» нет: обедневший выбывает, стол играет дальше (§19.4).
  if (game.closing || room.tournament) return;
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

  // В турнире голосования нет (§19.4): кон делится сразу, и стол играет дальше.
  if (room.tournament) {
    tournamentSplitKon(room);
    return;
  }

  // Недавно решили продолжать — ждём, пока раздача обойдёт круг (§12.2).
  if (dealsUntilNextVote(game.dealsSinceContinue, room.players.length) > 0) return;

  game.dealsSinceContinue = null;
  game.vote = { votes: {}, resumeStage: game.stage, cheapest };
  game.stage = 'vote';
  console.log(
    `[ROOM ${room.id}] nobody can afford even the cheapest bid (${cheapest}), kon ${game.kon}: vote`,
  );
}

// Турнир (§19.4, решение владельца 31.10.2026): кон не по карману никому — делим поровну
// между сидящими, остаток — тому, кто за этим столом проиграл больше всех (как §12.2).
// Стол не закрывается: следующая раздача — с новым взносом.
function tournamentSplitKon(room: Room) {
  const game = room.game!;
  const { shares, perPlayer, remainder, remainderTo } = splitKon(
    game.kon,
    room.players.map((p) => ({ id: p.id, lost: p.startBalance - p.balance })),
  );
  for (const p of room.players) {
    p.balance += shares[p.id];
    recordMoney(room, p.id, shares[p.id]);
  }
  game.konSplit = { kon: game.kon, perPlayer, remainder, remainderTo };
  game.kon = 0;
  game.emptyStreak = 0; // новый кон — счёт пустых раздач сначала
  console.log(`[ROOM ${room.id}] tournament: kon ${game.konSplit.kon} nobody can take — split ${perPlayer} each, play on`);
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
function closeWithSplit(
  room: Room,
  reason: 'nobody_can_play' | 'agreed_end' | 'seat_empty' | 'player_left' | 'tournament_end' = 'nobody_can_play',
) {
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
  game.shrinkVote = null;
  game.topUpVote = null;
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
  // И попросить докупить (§9.1c).
  game.topUpVote = null;
  game.topUpRequestedIds = [];
  game.lastTopUp = null;
  game.roundDoneAt = null;
  // Отдать часть выигрыша — только до следующей раздачи (§11.8).
  game.winShare = null;
  game.konSplit = null;
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

  // Сила руки главных — сейчас: главный и риск определены, розыгрыша ещё не было (§16.2a).
  game.handDifficulty = Object.fromEntries(
    game.mains.map((m) => [m.playerId, calculateHandDifficulty(game.hands[m.playerId] ?? [], game.trumpSuit!, room.capacity)]),
  );

  // Главный пропал на 5 минут ещё до розыгрыша — сказал заявку и отключился, держал
  // спецкарту, выиграл КОН — сразу проигрыш, как если бы сдался (RULES.md §13, §10.7).
  // Отметка «пропал» ставится один раз, а главным он мог стать уже после неё.
  const gone = game.goneIds ?? [];
  game.concededIds = game.mains.map((m) => m.playerId).filter((id) => gone.includes(id));
  if (game.concededIds.length > 0) {
    for (const id of game.concededIds) {
      const name = game.mains.find((m) => m.playerId === id)!.playerName;
      console.log(`[ROOM ${room.id}] ${name} пропал и стал главным — сразу проигрыш`);
    }
    const statuses = mainStatuses(game.mains, game.tricksWon, 0, game.concededIds);
    if (statuses.every((st) => st !== 'open')) {
      finishRound(room, statuses.map((st) => st === 'won'));
      return;
    }
  }

  const instantIndex = instantWinIndex(game.mains, game.hands, game.trumpSuit!, game.concededIds);
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
  game.roundDoneAt = Date.now();
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

  // Турнир: счёт для ничьей (§19.7) — победы на РАЗ (спецкарта — как РАЗ), на ДВА, лучший риск.
  if (room.tournament) {
    const scores = (room.tournament.scores ??= {});
    for (const r of game.result.filter((x) => x.won)) {
      const sc = (scores[r.playerId] ??= { razWins: 0, dvaWins: 0, maxRisk: 0 });
      if (r.declaration === 'РАЗ') sc.razWins += 1;
      if (r.declaration === 'ДВА') sc.dvaWins += 1;
      sc.maxRisk = Math.max(sc.maxRisk, risk);
    }
  }

  // Партия — в опыт (§16.1): активный день — 20 минут и 5 партий.
  const today = dayKey(Date.now());
  for (const p of room.players) activityOf(room, p.id, today).deals += 1;

  // И рейтинг (RULES.md §16.2): сила соперников (рейтинг на начало комнаты), сила руки,
  // риск, отбились ли противники. Копится до конца комнаты — там умножится на время.
  const deltas = dealDeltas(
    room.players.map((p) => ({ id: p.id, skill: ratingState(room, p.id).skill, rating: startRating(room, p.id) })),
    game.result.map((r) => ({ id: r.playerId, won: r.won, risk, handDifficulty: game.handDifficulty?.[r.playerId] })),
    room.capacity,
  );
  for (const [id, d] of Object.entries(deltas)) {
    const r = ratingState(room, id);
    r.pending = (r.pending ?? 0) + d;
  }

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

function reactionsFor(room: Room, viewerId?: string): ReactionEntry[] {
  const list = room.reactions ?? [];
  if (!viewerId || list.length === 0) return list;
  const blocked = new Set(blockedIds(db, viewerId));
  return blocked.size === 0 ? list : list.filter((r) => !blocked.has(r.playerId));
}

function publicRoom(room: Room, viewerId?: string) {
  let game: any = null;
  // Своя рука и свои кнопки (my…) — только сидящему за столом. Наблюдателю (§18) и
  // вышедшему — только то, что открыто всем.
  const seatedId = viewerId !== undefined && room.players.some((p) => p.id === viewerId) ? viewerId : undefined;

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
        seatedId !== undefined &&
        room.game.dvaSuit !== null &&
        room.game.bids.some((b) => b.playerId === seatedId && b.bid === 'ДВА')
          ? room.game.dvaSuit
          : null,
      // Из каких мастей можно выбрать ДВА — только тому, чья очередь и кому ДВА доступен.
      myDvaSuitOptions:
        room.game.stage === 'bidding' &&
        seatedId !== undefined &&
        seatedId === room.game.activeBidderId &&
        room.game.razSuit &&
        allowedBidsFor(
          room.capacity as Capacity,
          room.game.bids,
          walletOf(room, seatedId),
        ).includes('ДВА')
          ? dvaSuitOptions(room.capacity as Capacity, room.game.razSuit)
          : [],
      mains: room.game.mains,
      lastRedeal: room.game.lastRedeal,
      // Кнопки заявок решает сервер: клиент только включает те, что пришли.
      // Не-активному игроку — пустой список.
      myAllowedBids:
        room.game.stage === 'bidding' &&
        seatedId !== undefined &&
        seatedId === room.game.activeBidderId
          ? allowedBidsFor(
              room.capacity as Capacity,
              room.game.bids,
              walletOf(room, seatedId),
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
        seatedId !== undefined &&
        seatedId === room.game.mains[0]?.playerId &&
        room.game.razSuit
          ? konTrumpOptions(room.capacity as Capacity, room.game.razSuit)
          : [],
      emptyStreak: room.game.emptyStreak,
      lastAnte: room.game.lastAnte,
      konSplit: room.game.konSplit ?? null,
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
        room.game.vote && seatedId
          ? (room.game.vote.votes[seatedId] ?? null)
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
        seatedId !== undefined &&
        seatedId === room.game.turnPlayerId &&
        room.game.trumpSuit
          ? playableCards(
              room.game.hands[seatedId] ?? [],
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
        seatedId && room.game.hands[seatedId]
          ? room.game.hands[seatedId].slice(
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
      // Раздача сыграна или игра закончилась — оставшиеся карты открыты всем (§10.8).
      openHands: openHands(room.game.stage, !!room.game.result, room.game.hands),
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
        seatedId !== undefined &&
        nextActor(room.game.special.contest) === seatedId
          ? riskOptions(room.game.special.contest).filter((r) =>
              canAffordSpecial(room, seatedId, r),
            )
          : [],
      // Может ли запросивший сдаться и сколько тогда положит в кон (§10.7).
      myCanConcede: seatedId !== undefined && concedeAllowed(room.game, seatedId),
      myConcedeLoss: seatedId !== undefined ? concedeLoss(room, seatedId) : 0,
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
      myEndVote: room.game.endVote && seatedId
        ? room.game.endVote.yes.includes(seatedId)
          ? 'yes'
          : room.game.endVote.no.includes(seatedId)
            ? 'no'
            : null
        : null,
      myCanProposeEnd:
        seatedId !== undefined &&
        !room.tournament &&
        canProposeEnd({
          stage: room.game.stage,
          voteActive: !!room.game.endVote || !!room.game.shrinkVote || !!room.game.topUpVote,
          proposedIds: room.game.endProposedIds ?? [],
          playerId: seatedId,
        }),
      lastEndVote: room.game.lastEndVote ?? null,
      // Игрок ушёл — играть дальше без него или закрыть (§13c). Голосуют только люди.
      shrinkVote: room.game.shrinkVote
        ? {
            leftName: room.game.shrinkVote.leftName,
            players: room.players.length,
            yesIds: room.game.shrinkVote.yes,
            voterIds: room.players.map((p) => p.id).filter((id) => !room.botIds?.includes(id)),
            secondsLeft: Math.max(
              0,
              Math.ceil((room.game.shrinkVote.startedAt + SHRINK_VOTE_MS - Date.now()) / 1000),
            ),
          }
        : null,
      myShrinkVote:
        room.game.shrinkVote && seatedId && room.game.shrinkVote.yes.includes(seatedId) ? 'continue' : null,
      lastShrink: room.game.lastShrink ?? null,
      // Докупить из кошелька (§9.1c): идущая просьба, мой ответ, могу ли попросить, чем кончилась.
      topUpVote: room.game.topUpVote
        ? {
            requesterId: room.game.topUpVote.requesterId,
            requesterName:
              room.players.find((p) => p.id === room.game!.topUpVote!.requesterId)?.name ?? '',
            amount: room.game.topUpVote.amount,
            yesIds: room.game.topUpVote.yes,
            noIds: room.game.topUpVote.no,
            voterIds: topUpVoterIds(room, room.game.topUpVote.requesterId),
            secondsLeft: Math.max(
              0,
              Math.ceil((room.game.topUpVote.startedAt + TOP_UP_VOTE_MS - Date.now()) / 1000),
            ),
          }
        : null,
      myTopUpVote: room.game.topUpVote && seatedId
        ? room.game.topUpVote.yes.includes(seatedId)
          ? 'yes'
          : room.game.topUpVote.no.includes(seatedId)
            ? 'no'
            : null
        : null,
      myCanRequestTopUp: seatedId !== undefined && topUpAllowed(room, seatedId),
      lastTopUp: room.game.lastTopUp ?? null,
      // Часть выигрыша другому (§11.8): кто кому сколько отдал — видят все; сколько могу
      // отдать я — только выигравшему главному, пока не роздали следующую раздачу.
      winShare: room.game.winShare ?? null,
      myShareLimits: seatedId !== undefined ? shareLimitsFor(room, seatedId) : null,
      // Время на ход (§13a): сколько секунд осталось тому, кого ждём; кого ждём.
      turnSecondsLeft: turnSecondsLeft(turnClockOf(room), Date.now(), turnMsOf(room)),
      // Сколько ещё идёт анимация раздачи (вскрытия на туза): открыл стол позже —
      // приложение не показывает её заново, а догоняет (28.09.2026).
      dealShowLeftMs: Math.max(0, dealShownAt(room) - Date.now()),
      awaitedIds: awaitedMoves(room)?.moves.map((m) => m.playerId) ?? [],
      // Владелец спецкарты сбрасывает одну свою карту — кроме самой спецкарты (§7.5).
      myDiscardOptions:
        room.game.stage === 'special_discard' &&
        seatedId !== undefined &&
        seatedId === room.game.mains[0]?.playerId &&
        room.game.special
          ? room.game.hands[seatedId]
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
    // Лобби: через сколько секунд закроется, если игра не начнётся; закрылось ли по времени.
    lobbySecondsLeft: room.status === 'lobby' && !room.tournament ? lobbySecondsLeft(room.createdAt, Date.now(), lobbyMs) : null,
    lobbyTimedOut: !!room.lobbyTimedOut,
    // У каждого игрока — адрес его фото (этап 9.5) или null.
    // И рейтинг (этап 9.6): сейчас и с каким сел за стол — для итогов «4.0 → 4.9».
    // Тренировка с ботами: монеты и рейтинг за столом — не настоящие.
    practice: !!room.practice,
    version: room.version ?? 0,
    // Сколько зрителей смотрит стол (§18) — видят все: «👁 7».
    spectators: spectatorsOf(room),
    players: room.players.map((p) => {
      // На тренировке и в турнире рейтинг за партии не меняется — показываем тот, что в аккаунте.
      const atTable = room.practice || room.tournament ? undefined : room.rating?.[p.id];
      return {
        ...p,
        // Код игрока — нажать на него за столом и открыть карточку (в друзья, подарок).
        code: codeOf(p.id),
        bot: room.botIds?.includes(p.id) ?? false,
        avatar: avatarOf(p.id),
        // Магазин (§17): рамка, рубашка карт в его веере, эффект его победы. Сукно — личное,
        // каждый видит своё (решение владельца), поэтому его здесь нет.
        frame: lookFor(p.id).frame,
        cardBack: lookFor(p.id).back,
        winEffect: lookFor(p.id).effect,
        rating: shownRating(atTable ? liveRating(room, p.id) : accountRating(p.id)),
        ratingStart: shownRating(atTable ? startRating(room, p.id) : accountRating(p.id)),
        // Место в общем рейтинге, если игрок в первой десятке, иначе null.
        top: topPlaceOf(p.id),
        // Сколько раз выигрывал еженедельный турнир (§19.12): значок 🏆×N, объявление в лобби.
        tournamentWins: winsOf(p.id),
      };
    }),
    // Объявление перед обычной игрой: за столом победитель турнира (§19.12).
    winnerBanner: room.tournament ? null : winnerBanner(room.players.map((p) => winsOf(p.id))),
    // Турнирный стол (§19): этап, номер, сколько осталось от часа, казна, кто выбыл.
    tournament: room.tournament ? tournamentRoomView(room) : null,
    status: room.status,
    // Пауза из-за отключения (§13): кто отключился и сколько секунд у него осталось.
    pause: publicPause(room),
    // Смайлики после раздачи и после игры (§14). Клиент показывает новые по id.
    // Смайлики тех, кого смотрящий заблокировал, ему не показываем (29.09.2026).
    reactions: reactionsFor(room, viewerId),
    // Статистика игроков за комнату (ТЗ §35) — для экрана «ИТОГИ ИГРЫ».
    stats: room.stats ?? null,
    // Кто ушёл посреди игры — в итогах тоже, с пометкой «вышел» (11.10.2026).
    departedPlayers: room.departed ?? [],
    // Мои монеты вне стола (09.10.2026) — только смотрящему; всего = на столе + это.
    myReserve: room.players.find((p) => p.id === viewerId)?.reserve ?? null,
    createdAt: room.createdAt,
    game,
  };
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/rooms', (req, res) => {
  const { playerId, name, capacity, ante, emptyLimit, konThreshold, minBalance, turnSeconds, absenceMinutes } =
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

  // Сумма за стол (минимум для входа) — любая, кратно 1 000, не меньше взноса × 10
  // (RULES.md §9.1a; с 22.10.2026 — не только 1 000…10 000).
  const lowestEntry = lowestEntryFor(anteValue);
  if (!entryAllowed(minBalanceValue, anteValue)) {
    return res.status(400).json({
      error: `minBalance must be from ${lowestEntry} to ${MAX_ENTRY}, multiple of ${ENTRY_STEP}`,
    });
  }

  // Время на ход — 20 или 40 секунд (§13a). Не прислали — 20, как было раньше.
  const turnSecondsValue = turnSeconds === undefined ? 20 : Number(turnSeconds);
  if (!TURN_SECONDS_OPTIONS.includes(turnSecondsValue)) {
    return res.status(400).json({ error: `turnSeconds must be one of ${TURN_SECONDS_OPTIONS.join(', ')}` });
  }

  // Запас на отлучку — 1…5 минут (§13, 08.10.2026). Не прислали — 5, как было раньше.
  const absenceValue = absenceMinutes === undefined ? NEW_ROOM_ABSENCE_MINUTES : Number(absenceMinutes);
  if (!ABSENCE_MINUTES_OPTIONS.includes(absenceValue)) {
    return res.status(400).json({ error: `absenceMinutes must be one of ${ABSENCE_MINUTES_OPTIONS.join(', ')}` });
  }

  // Играть можно только в одной комнате за раз — roomId, чтобы вернуться в неё.
  const busyIn = activeRoomOf(me(res).id);
  if (busyIn) {
    return res.status(409).json({ error: 'already in another room', roomId: busyIn.id });
  }
  const banned = banError(me(res).id);
  if (banned) return res.status(403).json(banned);

  // Создатель тоже должен проходить по минимуму и выбрать сумму за стол.
  const creatorBalance = me(res).balance;
  const buyIn = checkBuyIn(req.body?.buyIn, creatorBalance, minBalanceValue);
  if (!buyIn.ok) {
    return res.status(buyIn.status).json({
      error: buyIn.error,
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
      absenceMinutes: absenceValue,
    },
    req.body?.isPublic === true,
    buyIn.amount,
  );
  return res.status(201).json(publicRoom(room, String(playerId)));
});

// Новая комната с создателем за столом. Условия и сумма за стол уже проверены.
function makeRoom(account: Account, capacity: number, settings: RoomSettings, isPublic: boolean, buyIn: number): Room {
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
        balance: buyIn,
        reserve: account.balance - buyIn,
        startBalance: buyIn,
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
// rawBuyIn — сколько монет берёт за стол (buyIn.ts); нет — весь баланс.
// tournamentBalance — турнирный стол (§19): садится со своим турнирным балансом, а не с
// суммой из кошелька. Без него за турнирный стол не сесть (tournamentSit проверяет участие).
function joinRoom(
  room: Room,
  account: Account,
  wantedSeat?: number,
  rawBuyIn?: unknown,
  tournamentBalance?: number,
): { status: number; body: unknown } {
  if (room.players.some((p) => p.id === account.id)) {
    return { status: 200, body: publicRoom(room, account.id) };
  }
  if (room.tournament && tournamentBalance === undefined) {
    return { status: 403, body: { error: 'tournament table' } };
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
  const banned = banError(account.id);
  if (banned) return { status: 403, body: banned };
  // Войти можно, только если денег не меньше минимума комнаты (RULES.md §9.1a);
  // за стол — от минимума до всего баланса.
  const buyIn = room.tournament ? null : checkBuyIn(rawBuyIn, account.balance, room.settings.minBalance);
  if (buyIn && !buyIn.ok) {
    return {
      status: buyIn.status,
      body: { error: buyIn.error, minBalance: room.settings.minBalance, balance: account.balance },
    };
  }
  // За турнирным столом — турнирные монеты; кошелёк целиком остаётся вне стола (§19.4).
  const onTable = buyIn ? buyIn.amount : tournamentBalance!;

  room.players.push({
    id: account.id,
    name: account.name,
    ready: true,
    joinedAt: Date.now(),
    balance: onTable,
    reserve: account.balance - (buyIn ? onTable : 0),
    startBalance: onTable,
    seat,
  });
  sortSeats(room);
  console.log(`[ROOM ${room.id}] ${account.name} joined ${room.players.length}/${room.capacity}, место ${seat}`);
  if (midGame) {
    // Сел на свободное место посреди игры: со следующей раздачи он играет.
    const vacancy = room.vacancies!.find((v) => v.seat === seat)!;
    room.vacancies = room.vacancies!.filter((v) => v.seat !== seat);
    room.departedIds = (room.departedIds ?? []).filter((id) => id !== account.id);
    room.departed = (room.departed ?? []).filter((d) => d.id !== account.id);
    room.stats ??= {};
    room.stats[account.id] ??= emptyStats();
    ratingState(room, account.id);
    if (vacancy.wasDealer) {
      room.game!.dealerId = account.id;
      room.game!.dealerName = account.name;
    }
    return { status: 200, body: publicRoom(room, account.id) };
  }
  if (tableFull(room)) {
    room.readyCheck = startReadyCheck(Date.now());
    console.log(`[ROOM ${room.id}] набралась — ждём «ГОТОВ» от всех`);
    for (const p of room.players) {
      if (p.id !== account.id && !room.botIds?.includes(p.id)) {
        notifyTelegram(p.id, `ready:${room.id}`, `Стол #${room.id} собран! Нажми «ГОТОВ» — на это 30 секунд.`, `room_${room.id}`);
      }
    }
  }
  return { status: 200, body: publicRoom(room, account.id) };
}

// Открытые комнаты, куда можно сесть: лобби, есть место, хватает монет (19.09.2026).
// coins — с чем игрок сядет за стол (быстрая игра — выбранная сумма), по умолчанию весь баланс.
function openRoomsForAccount(account: Account, coins = account.balance) {
  const now = Date.now();
  // За один стол с тем, кого я заблокировал или кто заблокировал меня, не сажаем (29.09.2026).
  const avoid = avoidIds(db, account.id);
  return openRoomsFor(
    [...rooms.values()]
      // Лобби, которое вот-вот закроется само (меньше минуты), не предлагаем.
      .filter((r) => r.status !== 'lobby' || lobbySecondsLeft(r.createdAt, now, lobbyMs) >= 60)
      .filter((r) => !r.players.some((p) => avoid.has(p.id)))
      .map((r) => ({
      id: r.id,
      isPublic: !!r.isPublic,
      status: r.status,
      capacity: r.capacity,
      memberIds: r.players.map((p) => p.id),
      vacancies: r.status === 'started' ? (r.vacancies?.length ?? 0) : 0,
      minBalance: r.settings.minBalance,
      createdAt: r.createdAt,
    })),
    coins,
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
  return res.json({ rooms: list, live: liveRoomsForAccount(me(res)) });
});

// Идущие столы — смотреть или сесть на освободившееся место (RULES.md §18, 28.10.2026).
// Все начатые, и открытые, и «только по коду» (решение владельца).
function liveRoomsForAccount(account: Account) {
  return liveRoomsFor(
    [...rooms.values()].map((r) => ({
      room: r,
      id: r.id,
      status: r.status,
      memberIds: r.players.map((p) => p.id),
      spectators: spectatorsOf(r),
      createdAt: r.createdAt,
    })),
    account.id,
    avoidIds(db, account.id),
  ).map(({ room, spectators }) => {
    const vacancies = room.vacancies?.length ?? 0;
    return {
      id: room.id,
      capacity: room.capacity,
      players: room.players.length,
      creatorName: room.players.find((p) => p.id === room.creatorId)?.name ?? '',
      settings: room.settings,
      practice: !!room.practice,
      dealNumber: room.game?.dealNumber ?? 0,
      spectators,
      vacancies,
      // Сесть можно, если есть место и хватает монет на минимум стола (§13b, §9.1a).
      canSit: vacancies > 0 && room.settings.minBalance <= account.balance,
    };
  });
}

// «Быстрая игра»: сесть в самую заполненную открытую комнату, куда хватает монет;
// таких нет — создать открытую комнату (5 игроков, взнос 100) и ждать людей.
app.post('/rooms/quick', (req, res) => {
  const account = me(res);
  const busyIn = activeRoomOf(account.id);
  if (busyIn) {
    return res.status(409).json({ error: 'already in another room', roomId: busyIn.id });
  }
  const banned = banError(account.id);
  if (banned) return res.status(403).json(banned);

  // Сумма за стол: сажаем только туда, где её хватает на минимум комнаты.
  const rawBuyIn = req.body?.buyIn;
  const wantBuyIn = rawBuyIn === undefined || rawBuyIn === null ? account.balance : Number(rawBuyIn);
  for (const summary of openRoomsForAccount(account, wantBuyIn)) {
    const room = rooms.get(summary.id)!;
    const joined = joinRoom(room, account, undefined, rawBuyIn);
    if (joined.status === 200) {
      persistRoom(room);
      broadcastRoom(room.id).catch((e) => console.error(`[ROOM ${room.id}] broadcast failed:`, e));
      return res.json(joined.body);
    }
  }

  const buyIn = checkBuyIn(rawBuyIn, account.balance, QUICK_ROOM.minBalance);
  if (!buyIn.ok) {
    return res.status(buyIn.status).json({
      error: buyIn.error,
      minBalance: QUICK_ROOM.minBalance,
      balance: account.balance,
    });
  }
  const { capacity, ...settings } = QUICK_ROOM;
  const room = makeRoom(account, capacity, settings, true, buyIn.amount);
  return res.status(201).json(publicRoom(room, account.id));
});

app.get('/rooms/:id', (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room) {
    return res.status(404).json({ error: 'room not found' });
  }

  // Наблюдатель (§18): сам в начатой игре или за столом тот, с кем блок, — нельзя.
  const refusal = spectateRefusalFor(room, me(res).id);
  if (refusal) return res.status(403).json({ error: refusal });

  // Свою руку видит только тот, чей токен. ?playerId=... больше не читается.
  return res.json(publicRoom(room, me(res).id));
});

app.post('/rooms/:id/join', (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room) {
    return res.status(404).json({ error: 'room not found' });
  }

  const wanted = req.body?.seat === undefined ? undefined : Number(req.body.seat);
  // Турнирный стол (§19.3): садится только участник, со своим турнирным балансом.
  if (room.tournament) {
    const sat = tournamentSit(room, me(res), Number.isInteger(wanted) ? wanted : undefined);
    return res.status(sat.status).json(sat.body);
  }
  const joined = joinRoom(room, me(res), Number.isInteger(wanted) ? wanted : undefined, req.body?.buyIn);
  return res.status(joined.status).json(joined.body);
});

// --- Позвать друга в комнату (решение владельца, 25.09.2026) ---
// Из лобби или на свободное место посреди игры — друга из списка «Друзья». Приглашение
// видно у друга на главном экране 10 минут (без push-уведомлений: приложение должно быть
// открыто). Живёт в памяти: после перезапуска сервера пропадает — не страшно.
const INVITE_TTL_MS = 10 * 60_000;
const roomInvites = new Map<string, { roomId: string; fromId: string; fromName: string; at: number }[]>();

// Раз в час забываем старые адреса и просроченные приглашения — иначе карты росли бы вечно.
setInterval(guarded('cleanup', () => {
  const now = Date.now();
  for (const map of [accountsByIp, recoveriesByIp]) {
    for (const [ip, times] of map) {
      if (!times.length || now - times[times.length - 1] > 86_400_000) map.delete(ip);
    }
  }
  for (const [id, list] of roomInvites) {
    const alive = list.filter((inv) => now - inv.at < INVITE_TTL_MS);
    if (alive.length) roomInvites.set(id, alive);
    else roomInvites.delete(id);
  }
}), 3_600_000);

function roomHasSeat(room: Room): boolean {
  return (room.status === 'lobby' && room.players.length < room.capacity) ||
    (room.status === 'started' && (room.vacancies?.length ?? 0) > 0);
}

function invitesFor(accountId: string) {
  const now = Date.now();
  const list = (roomInvites.get(accountId) ?? []).filter((inv) => {
    const room = rooms.get(inv.roomId);
    return now - inv.at < INVITE_TTL_MS && !!room && roomHasSeat(room) &&
      !room.players.some((p) => p.id === accountId);
  });
  roomInvites.set(accountId, list);
  // tableNo — зовут за турнирный стол (§19.3): приложение сажает без суммы за стол.
  return list.map((inv) => ({
    roomId: inv.roomId,
    fromName: inv.fromName,
    at: inv.at,
    tableNo: rooms.get(inv.roomId)?.tournament?.tableNo ?? null,
  }));
}

app.post('/rooms/:id/invite', (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'room not found' });
  const from = me(res);
  if (!room.players.some((p) => p.id === from.id)) {
    return res.status(403).json({ error: 'player is not in this room' });
  }
  if (!roomHasSeat(room)) return res.status(409).json({ error: 'no free seat' });
  const friend = findAccountByCode(db, normalizeCode(req.body?.code) ?? '');
  if (!friend) return res.status(404).json({ error: 'player not found' });
  // За турнирный стол зовут любого участника турнира, не только друга (§19.3).
  if (room.tournament) {
    if (!tournamentSeatAllowed(room, friend.id)) return res.status(403).json({ error: 'not a tournament participant' });
    if (blockedBetween(db, from.id, friend.id)) return res.status(403).json({ error: 'blocked' });
  } else if (!areFriends(db, from.id, friend.id)) return res.status(403).json({ error: 'not a friend' });
  if (room.players.some((p) => p.id === friend.id)) return res.status(409).json({ error: 'already in this room' });

  const list = (roomInvites.get(friend.id) ?? []).filter((inv) => inv.roomId !== room.id);
  roomInvites.set(friend.id, [...list, { roomId: room.id, fromId: from.id, fromName: from.name, at: Date.now() }]);
  console.log(`[ROOM ${room.id}] ${from.name} зовёт друга ${friend.name}`);
  notifyTelegram(
    friend.id,
    `invite:${room.id}`,
    room.tournament
      ? `${from.name} зовёт тебя за турнирный стол №${room.tournament.tableNo} ГАРБЫ.`
      : `${from.name} зовёт тебя за стол ГАРБЫ — комната #${room.id}.`,
    `room_${room.id}`,
  );
  return res.json({ ok: true });
});

// Отказаться от приглашения — убрать его с главного экрана.
app.delete('/me/invites/:roomId', (req, res) => {
  const account = accountOf(req);
  if (!account) return res.status(401).json({ error: 'unauthorized' });
  roomInvites.set(account.id, (roomInvites.get(account.id) ?? []).filter((inv) => inv.roomId !== req.params.roomId));
  return res.json({ ok: true });
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
    // Сам вышел из начатой игры — бан на вход за стол (§13d, 23.10.2026): 10 минут за
    // первый выход, дальше +10, не больше часа; 6 часов без выходов — счёт сначала.
    // Тренировка с ботами никому не мешает — там бана нет. Турнир — своё наказание (§19.6).
    if (!room.practice && !room.tournament) {
      const ban = nextLeaveBan(leaveRecordOf(db, playerId), Date.now());
      setLeaveRecord(db, playerId, ban);
      console.log(`[ROOM ${room.id}] ${me(res).name} вышел из игры — бан ${Math.round((ban.until - ban.lastAt) / 60_000)} мин (${ban.count}-й выход)`);
    }
    return res.json({ left: true });
  }
  if (room.status !== 'lobby') {
    return res.status(409).json({ error: 'game already started' });
  }

  // Турнирный стол до начала игры: встал — место свободно, регистрация остаётся (§19.3).
  if (room.tournament) {
    room.players = room.players.filter((p) => p.id !== playerId);
    room.readyCheck = null;
    console.log(`[ROOM ${room.id}] ${me(res).name} встал из-за турнирного стола ${room.players.length}/${room.capacity}`);
    return res.json(publicRoom(room, playerId));
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
// «ДОБАВИТЬ БОТОВ» (решение владельца, 27.09.2026): создатель в лобби сажает ботов сервера
// на все свободные места. Бот — обычный аккаунт с пометкой; свободные боты используются
// снова, не хватает — заводятся новые. Перед посадкой боту докладываем монеты до 30 000
// (или до минимума комнаты). Ходит за ботов сервер — driveBots ниже.
app.post('/rooms/:id/bots', (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'room not found' });
  const playerId = me(res).id;
  if (room.creatorId !== playerId || room.tournament) return res.status(403).json({ error: 'only creator can add bots' });
  if (room.status !== 'lobby') return res.status(409).json({ error: 'game already started' });
  if (room.players.length >= room.capacity) return res.status(409).json({ error: 'room is full' });

  const pool = botAccounts(db).filter((b) => !activeRoomOf(b.id));
  while (room.players.length < room.capacity) {
    const taken = room.players.map((p) => p.name);
    let bot = pool.find((b) => !taken.includes(b.name));
    if (bot) pool.splice(pool.indexOf(bot), 1);
    else {
      bot = createAccount(db, freeBotName(taken)).account;
      markBot(db, bot.id);
    }
    const topUp = botTopUp(bot.balance, room.settings.minBalance, STARTING_COINS);
    if (topUp > 0) moveCoins([{ accountId: bot.id, delta: topUp }]);
    const joined = joinRoom(room, getAccount(db, bot.id)!);
    if (joined.status !== 200) {
      console.error(`[ROOM ${room.id}] бот ${bot.name} не сел:`, joined.body);
      break;
    }
    room.botIds = [...(room.botIds ?? []), bot.id];
    room.practice = true;
  }
  console.log(`[ROOM ${room.id}] ${me(res).name} добавил ботов — ${room.players.length}/${room.capacity}`);
  return res.json(publicRoom(room, playerId));
});

// Раз в четверть секунды: боту пора ходить — ходим за него запросом самому себе, как
// таймер хода. Решение бот «обдумывает» паузу (BotAction.delay), а после раздачи ждёт,
// пока у людей закончится анимация. За раз — один ход в комнате: дальше состояние новое.
const botPlans = new Map<string, { sig: string; dueAt: number }>();
const botBusy = new Set<string>();

async function driveBots() {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (!room.botIds?.length || room.status === 'finished' || botBusy.has(room.id)) continue;
    const shownAt = dealShownAt(room);
    for (const botId of room.botIds) {
      if (!room.players.some((p) => p.id === botId)) continue;
      const planKey = `${room.id}:${botId}`;
      const view = publicRoom(room, botId);
      const action: BotAction | null = botAction(botId, view);
      if (!action) {
        botPlans.delete(planKey);
        continue;
      }
      // Одинаковое действие в другой стадии или раздаче — новое решение, пауза заново.
      const g = view.game as { stage?: string; dealNumber?: number; trickNumber?: number } | null;
      const sig = JSON.stringify([action.path, action.body, view.status, g?.stage, g?.dealNumber, g?.trickNumber]);
      let plan = botPlans.get(planKey);
      if (!plan || plan.sig !== sig) {
        plan = { sig, dueAt: Math.max(now + action.delay, shownAt + BOT_STEP_MS) };
        botPlans.set(planKey, plan);
      }
      if (now < plan.dueAt) continue;

      botPlans.delete(planKey);
      botBusy.add(room.id);
      try {
        await internalMove(room.id, { playerId: botId, path: action.path, body: action.body });
      } catch (e) {
        console.error(`[ROOM ${room.id}] ход бота не прошёл:`, e);
      } finally {
        botBusy.delete(room.id);
      }
      break;
    }
  }
}

setInterval(() => {
  driveBots().catch((e) => console.error('bots failed:', e));
}, 250);

// Закрытые комнаты не держим в памяти вечно (28.09.2026): через 30 минут после закрытия —
// выгружаем вместе со всем, что о них помнят таймеры. Итоги остаются в базе.
const UNLOAD_FINISHED_MS = 30 * 60_000;
const finishedAt = new Map<string, number>();
setInterval(guarded('unload rooms', () => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.status !== 'finished') continue;
    const since = finishedAt.get(room.id) ?? now;
    finishedAt.set(room.id, since);
    if (now - since < UNLOAD_FINISHED_MS) continue;
    rooms.delete(room.id);
    finishedAt.delete(room.id);
    for (const map of [presence, absentSince, turnClocks, dealShows]) map.delete(room.id);
    referralsChecked.delete(room.id);
    for (const key of botPlans.keys()) if (key.startsWith(`${room.id}:`)) botPlans.delete(key);
  }
}), 60_000);

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
  if (room.tournament) return settleTournamentReady(room);
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
  // Создателем бот не становится: следующий по входу человек, людей нет — комнату закрываем.
  if (outcome.creatorId !== null && room.botIds?.includes(outcome.creatorId)) {
    outcome.creatorId = room.players.find((p) => !room.botIds!.includes(p.id))?.id ?? null;
  }
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
  if (room.tournament) tournamentGameStarted(room);

  console.log(
    `[ROOM ${room.id}] GAME STARTED, dealer=${room.game.dealerName}`,
  );
}

// Стол набрался — пора «ГОТОВ». Турнирный финал с ботами: набрались все люди (§19.7).
function tableFull(room: Room): boolean {
  return room.players.length === room.capacity - (room.tournament?.reserveBots ?? 0);
}

// Для проверок время на «ГОТОВ» можно укоротить.
const readyMs = Number(process.env.GARBA_READY_MS ?? READY_MS);
// Сколько лобби ждёт начала игры — для проверок можно укоротить.
const lobbyMs = Number(process.env.GARBA_LOBBY_MS ?? LOBBY_MS);

// Раз в секунду: набравшееся лобби без проверки (например, после перезапуска) — начинаем
// её; у кого вышли 30 секунд — выходят. Игра не началась за 10 минут — лобби закрывается.
setInterval(guarded('lobby', () => {
  for (const room of rooms.values()) {
    if (room.status !== 'lobby') continue;
    let changed = false;
    if (!room.readyCheck && tableFull(room)) {
      room.readyCheck = startReadyCheck(Date.now());
      changed = true;
    }
    if (settleReadyCheck(room)) changed = true;
    // Турнирный стол ждёт игроков весь этап (§19.3), а не 10 минут.
    if (room.status === 'lobby' && !room.tournament && lobbyExpired(room.createdAt, Date.now(), !!room.readyCheck, lobbyMs)) {
      room.status = 'finished';
      room.lobbyTimedOut = true;
      changed = true;
      console.log(`[ROOM ${room.id}] игра не началась за ${Math.round(lobbyMs / 1000)} с — комната закрыта`);
    }
    if (changed) {
      persistRoom(room);
      broadcastRoom(room.id).catch((e) => console.error(`[ROOM ${room.id}] broadcast failed:`, e));
    }
  }
}), 1000);

app.post('/rooms/:id/dealer/continue', (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room) {
    return res.status(404).json({ error: 'room not found' });
  }

  const { playerId } = req.body ?? {};

  if (!room.game) {
    return res.status(409).json({ error: 'game not started' });
  }

  // Турнир между раздачами: вышел час, кто-то выбыл или осталось трое — стол меняется
  // раньше, чем раздают (§19.4).
  if (tournamentBetweenDeals(room)) {
    return res.status(409).json({ error: 'table changed' });
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

  // Раздача только что сыграна — 3 секунды все смотрят открытые карты (§10.8, 22.10.2026).
  const showLeft = handsShownAt(room) - Date.now();
  if (showLeft > 0) {
    return res.status(409).json({ error: 'cards on show', msLeft: showLeft });
  }

  // Идёт голосование «закончить игру» — раздавать нельзя, пока не решится (§12.3).
  settleEndVote(room);
  settleShrinkVote(room);
  if (room.game.stage === 'room_done') {
    return res.status(409).json({ error: 'room finished', stage: room.game.stage });
  }
  if (room.game.endVote) {
    return res.status(409).json({ error: 'end vote in progress' });
  }
  // Игрок ушёл — пока не решили, играть ли без него, раздавать нельзя (§13c).
  if (room.game.shrinkVote) {
    return res.status(409).json({ error: 'shrink vote in progress' });
  }
  // Кто-то просит докупить — сначала ответ стола, потом раздача (§9.1c).
  settleTopUpVote(room);
  if (room.game.topUpVote) {
    return res.status(409).json({ error: 'top-up vote in progress' });
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

  // Предлагать и голосовать — только тем, кто за столом (посторонний или ушедший
  // иначе держал бы раздачу по 30 секунд или срывал голосование своим «нет»).
  if (!room.players.some((p) => p.id === id)) {
    return res.status(403).json({ error: 'player is not in this room' });
  }
  // Турнирный стол по согласию не заканчивается — только трое осталось или час (§19.4).
  if (room.tournament) {
    return res.status(409).json({ error: 'not in tournament' });
  }

  if (choice !== 'yes' && choice !== 'no') {
    return res.status(400).json({ error: 'choice must be yes or no' });
  }

  settleEndVote(room);
  if (!game.endVote) {
    // Голосования нет — это предложение закончить.
    const allowed = canProposeEnd({
      stage: game.stage,
      voteActive: !!game.shrinkVote || !!game.topUpVote,
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

// --- Докупить из кошелька за столом (RULES.md §9.1c, решение владельца, 22.10.2026) ---

// Кто отвечает на просьбу: все за столом, кроме просящего. Боты сервера не голосуют —
// решают люди (как в §13c); за столом одни боты — докупка сразу.
function topUpVoterIds(room: Room, requesterId: string): string[] {
  return room.players.map((p) => p.id).filter((id) => id !== requesterId && !room.botIds?.includes(id));
}

// Деньги за столом поменялись не игрой — докупили (§9.1c) или отдали часть выигрыша (§11.8):
// «последний кон» (§12.1) смотрим заново. У всех снова не меньше базового кона — кон не последний.
function recheckClosing(room: Room) {
  const game = room.game!;
  if (room.tournament) return;
  const closing = someoneBelowBase(room.players.map((p) => p.balance), roomBaseKon(room));
  if (closing !== game.closing) {
    console.log(`[ROOM ${room.id}] ${closing ? 'у кого-то меньше базового кона — последний кон' : 'у всех снова не меньше базового кона — кон не последний'}`);
  }
  game.closing = closing;
}

// Подвести просьбу, если она решилась: все согласны — монеты из кошелька на стол;
// хоть одно «против» или 30 секунд без ответа — докупки нет.
function settleTopUpVote(room: Room) {
  const game = room.game;
  const vote = game?.topUpVote;
  if (!game || !vote) return;
  const requester = room.players.find((p) => p.id === vote.requesterId);
  if (!requester || room.status !== 'started') {
    game.topUpVote = null;
    return;
  }
  const outcome = topUpOutcome(vote, topUpVoterIds(room, vote.requesterId), Date.now());
  if (outcome === 'pending') return;
  game.topUpVote = null;
  // Кошелёк мог стать меньше, пока спрашивали (списание владельцем, /admin/coins).
  const amount = Math.min(vote.amount, requester.reserve ?? 0);
  if (outcome === 'approved' && amount > 0) {
    const next = applyTopUp(
      { balance: requester.balance, reserve: requester.reserve ?? 0, startBalance: requester.startBalance },
      amount,
    );
    requester.balance = next.balance;
    requester.reserve = next.reserve;
    requester.startBalance = next.startBalance;
    recheckClosing(room);
  }
  const noId = vote.no[0];
  game.lastTopUp = {
    playerId: requester.id,
    name: requester.name,
    amount,
    result: outcome === 'approved' && amount === 0 ? 'rejected' : outcome,
    byName: noId ? (room.players.find((p) => p.id === noId)?.name ?? null) : null,
  };
  console.log(
    outcome === 'approved'
      ? `[ROOM ${room.id}] ${requester.name} докупил ${amount} из кошелька — на столе ${requester.balance}`
      : `[ROOM ${room.id}] ${requester.name} не докупил: ${outcome === 'rejected' ? 'кто-то против' : 'не все ответили'}`,
  );
}

// Может ли игрок сейчас попросить докупить: между раздачами, никто ничего не решает,
// в кошельке есть монеты, между этими раздачами ещё не просил. Боты не просят.
function topUpAllowed(room: Room, playerId: string): boolean {
  const game = room.game;
  const player = room.players.find((p) => p.id === playerId);
  if (!game || !player || room.status !== 'started' || room.botIds?.includes(playerId)) return false;
  if (room.tournament) return false; // турнир: докупки нет (§19.4)
  return canRequestTopUp({
    stage: game.stage,
    voteActive: !!game.endVote || !!game.shrinkVote || !!game.topUpVote,
    requestedIds: game.topUpRequestedIds ?? [],
    playerId,
    reserve: player.reserve ?? 0,
  });
}

// Попросить докупить: amount — сколько монет перенести из кошелька на стол.
app.post('/rooms/:id/top-up', (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room || !room.game) {
    return res.status(404).json({ error: 'room/game not found' });
  }
  const game = room.game;
  const id = me(res).id;
  const player = room.players.find((p) => p.id === id);
  if (!player) {
    return res.status(403).json({ error: 'player is not in this room' });
  }
  settleTopUpVote(room);
  if (!topUpAllowed(room, id)) {
    return res.status(409).json({ error: 'cannot request top-up now', stage: game.stage });
  }
  const amount = checkTopUpAmount(req.body?.amount, player.reserve ?? 0);
  if (amount === null) {
    return res.status(400).json({ error: 'bad top-up amount', reserve: player.reserve ?? 0 });
  }
  game.topUpRequestedIds = [...(game.topUpRequestedIds ?? []), id];
  game.topUpVote = { requesterId: id, amount, yes: [], no: [], startedAt: Date.now() };
  game.lastTopUp = null;
  console.log(`[ROOM ${room.id}] ${player.name} просит докупить ${amount} из кошелька`);
  // За столом, кроме него, одни боты — спрашивать некого, докупка сразу.
  settleTopUpVote(room);
  return res.json(publicRoom(room, id));
});

// Ответ на просьбу докупить: choice — yes | no. Одно «нет» — докупки не будет.
app.post('/rooms/:id/top-up-vote', (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room || !room.game) {
    return res.status(404).json({ error: 'room/game not found' });
  }
  const game = room.game;
  const id = me(res).id;
  if (!room.players.some((p) => p.id === id)) {
    return res.status(403).json({ error: 'player is not in this room' });
  }
  const choice = req.body?.choice;
  if (choice !== 'yes' && choice !== 'no') {
    return res.status(400).json({ error: 'choice must be yes or no' });
  }
  settleTopUpVote(room);
  const vote = game.topUpVote;
  if (!vote) {
    return res.status(409).json({ error: 'no top-up vote now' });
  }
  if (!topUpVoterIds(room, vote.requesterId).includes(id)) {
    return res.status(409).json({ error: 'you do not vote on this' });
  }
  if (vote.yes.includes(id) || vote.no.includes(id)) {
    return res.status(409).json({ error: 'already voted' });
  }
  if (choice === 'yes') vote.yes.push(id);
  else vote.no.push(id);
  settleTopUpVote(room);
  return res.json(publicRoom(room, id));
});

// --- Отдать часть выигрыша другому игроку (RULES.md §11.8, решение владельца, 22.10.2026) ---

// Сколько игрок может отдать сейчас: выиграл РАЗ или ДВА в этой раздаче и ещё не отдавал.
// null — нельзя. Боты сервера не отдают.
function shareLimitsFor(room: Room, playerId: string): { min: number; max: number } | null {
  const game = room.game;
  if (!game || room.status !== 'started' || room.botIds?.includes(playerId)) return null;
  if (room.tournament) return null; // турнир: делиться выигрышем нельзя (§19.4)
  if (!room.players.some((p) => p.id === playerId)) return null;
  return canShare({
    stage: game.stage,
    result: game.result,
    shared: !!game.winShare,
    playerId,
    ante: room.settings.ante,
  });
}

// Отдать: toId — кому (любой за столом, кроме себя), amount — сколько.
app.post('/rooms/:id/share', (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room || !room.game) {
    return res.status(404).json({ error: 'room/game not found' });
  }
  const game = room.game;
  const id = me(res).id;
  const giver = room.players.find((p) => p.id === id);
  if (!giver) {
    return res.status(403).json({ error: 'player is not in this room' });
  }
  const limits = shareLimitsFor(room, id);
  if (!limits) {
    return res.status(409).json({ error: 'cannot share now', stage: game.stage });
  }
  const receiver = room.players.find((p) => p.id === req.body?.toId);
  if (!receiver || receiver.id === id) {
    return res.status(400).json({ error: 'bad share recipient' });
  }
  const amount = checkShareAmount(req.body?.amount, limits);
  if (amount === null) {
    return res.status(400).json({ error: 'bad share amount', ...limits });
  }

  // Монеты за столом — от одного к другому. В статистике — как деньги за столом (recordMoney):
  // иначе она разойдётся с балансом. Выигравший оставляет себе не меньше 90% выигрыша — на
  // следующую заявку ему хватит, голосование «делим кон» (§12.2) отсюда не начнётся.
  giver.balance -= amount;
  receiver.balance += amount;
  recordMoney(room, giver.id, -amount);
  recordMoney(room, receiver.id, amount);
  const won = game.result?.find((r) => r.playerId === id)?.delta ?? 0;
  game.winShare = { fromId: id, fromName: giver.name, toId: receiver.id, toName: receiver.name, amount, won };
  // Обедневший получил монеты — «последний кон» (§12.1) мог отмениться.
  recheckClosing(room);
  console.log(`[ROOM ${room.id}] ${giver.name} выиграл ${won} и отдал ${amount} игроку ${receiver.name}`);
  return res.json(publicRoom(room, id));
});

// Игрок ушёл — ответ оставшихся (§13c): choice — continue | close. Одно «закрыть» —
// игра заканчивается сразу; все люди «продолжаем» — играем меньшим столом.
app.post('/rooms/:id/shrink-vote', (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room || !room.game) {
    return res.status(404).json({ error: 'room/game not found' });
  }
  const game = room.game;
  const id = String(req.body?.playerId);
  const choice = req.body?.choice;
  if (!room.players.some((p) => p.id === id)) {
    return res.status(403).json({ error: 'player is not in this room' });
  }
  if (choice !== 'continue' && choice !== 'close') {
    return res.status(400).json({ error: 'choice must be continue or close' });
  }
  settleShrinkVote(room);
  if (!game.shrinkVote) {
    return res.status(409).json({ error: 'no shrink vote now' });
  }
  if (choice === 'close') {
    game.shrinkVote = null;
    console.log(`[ROOM ${room.id}] ${me(res).name} — закрыть: игра закончена`);
    closeWithSplit(room, 'player_left');
  } else {
    if (!game.shrinkVote.yes.includes(id)) game.shrinkVote.yes.push(id);
    settleShrinkVote(room);
  }
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
  const result = addReaction(
    room.reactions ?? [],
    room.game?.stage ?? 'lobby',
    playerId,
    req.body?.emoji,
    Date.now(),
    ownedItems(db, playerId), // наборы смайликов из магазина (§17)
  );
  if (result === 'not now') {
    return res.status(409).json({ error: 'reactions only after a deal' });
  }
  if (result === 'unknown emoji') {
    return res.status(400).json({ error: 'unknown emoji' });
  }
  if (result === 'not owned') {
    return res.status(403).json({ error: 'buy it in the shop' });
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

// --- Еженедельный турнир (RULES.md §19, решение владельца 28.10 и 31.10.2026) ---
//
// Турнир живёт в базе (tournamentDb.ts), столы — обычные комнаты с room.tournament: та же игра,
// те же проверки и рассылка. Раз в секунду tournamentTick двигает турнир по времени: открыть
// регистрацию в понедельник 20:00, закрыть её через 24 часа (отменить или создать столы),
// последний шанс за 30 мин, итоги столов, финалисты, финал, выплата. Каждый шаг меняет
// состояние только из ожидаемого (moveTournament / moveTable / moveEntry), деньги — только через
// журнал с уникальным ключом: повторный тик, запрос или перезапуск второй раз ничего не сделает.

// Для проверок сроки укорачиваются переменными окружения; GARBA_TOUR_AUTO=0 — без недельного.
const envMs = (name: string, fallback: number) => (process.env[name] ? Number(process.env[name]) : fallback);
const TOUR_TIMES: TournamentTimes = {
  registrationMs: envMs('GARBA_TOUR_REG_MS', DEFAULT_TIMES.registrationMs),
  qualificationMs: envMs('GARBA_TOUR_QUAL_MS', DEFAULT_TIMES.qualificationMs),
  finalMs: envMs('GARBA_TOUR_FINAL_MS', DEFAULT_TIMES.finalMs),
  tablePlayMs: envMs('GARBA_TOUR_TABLE_MS', DEFAULT_TIMES.tablePlayMs),
  lastCallLeadMs: envMs('GARBA_TOUR_LASTCALL_LEAD_MS', DEFAULT_TIMES.lastCallLeadMs),
  lastCallMs: envMs('GARBA_TOUR_LASTCALL_MS', DEFAULT_TIMES.lastCallMs),
};
const TOUR_AUTO = process.env.GARBA_TOUR_AUTO !== '0';
// Взнос турнирного стола — 100 (§19.4). Больший — только живой проверке: за пару минут кто-то
// успевает обеднеть и выбыть.
const TOUR_SETTINGS = { ...TOURNAMENT_SETTINGS, ante: envMs('GARBA_TOUR_ANTE', TOURNAMENT_SETTINGS.ante) };
const TOURNAMENT_ROOM = 'tournament'; // комната сокетов экрана «ТУРНИР»

// Победы в турнире у каждого игрока — для значка и объявления в лобби; меняется только при выплате.
const winsCache = new Map<string, number>();
function winsOf(accountId: string): number {
  if (!winsCache.has(accountId)) winsCache.set(accountId, tournamentWinsOf(db, accountId));
  return winsCache.get(accountId)!;
}

// Казна — на каждую рассылку стола; считаем не чаще раза в секунду.
const treasuryCache = new Map<string, { at: number; value: number }>();
function treasuryNow(tournamentId: string): number {
  const now = Date.now();
  const cached = treasuryCache.get(tournamentId);
  if (cached && now - cached.at < 1000) return cached.value;
  const value = treasuryOf(db, tournamentId);
  treasuryCache.set(tournamentId, { at: now, value });
  return value;
}

const playingStatus = (stage: TableStage): EntryStatus => (stage === 'qual' ? 'playing' : 'final_playing');
const doneStatus = (stage: TableStage): EntryStatus => (stage === 'qual' ? 'played' : 'final_done');
const seatStatus = (stage: TableStage): EntryStatus => (stage === 'qual' ? 'registered' : 'finalist');
const botKey = (tr: TournamentRoom, botId: string) => `bot:${tr.id}:${tr.stage}:${tr.tableNo}:${botId}`;

// Движение денег турнира: журнал и кошельки — одной транзакцией. pay — в кошелёк игрока; сидит
// он за обычным столом — в монеты вне стола (changeCoins), как бонус и подарок.
function tournamentTx<T>(fn: (pay: (accountId: string, delta: number) => void) => T): T {
  const undo: (() => void)[] = [];
  const touched = new Set<Room>();
  let result: T;
  try {
    result = transaction(db, () =>
      fn((accountId, delta) => {
        const room = changeCoins(accountId, delta, undo);
        if (room) touched.add(room);
      }),
    );
  } catch (e) {
    for (const u of undo.reverse()) u();
    throw e;
  }
  treasuryCache.clear();
  for (const room of touched) broadcastRoom(room.id).catch((e) => console.error(`[ROOM ${room.id}] broadcast failed:`, e));
  return result;
}

// Рейтинг за турнир (§19.10) — один раз. Игрок сидит за обычным столом — поправить и там:
// иначе следующее сохранение той комнаты вернуло бы старое мастерство.
function applyTournamentRating(tournamentId: string, accountId: string, delta: number) {
  if (!rateEntry(db, tournamentId, accountId, delta)) return;
  const room = activeRoomOf(accountId);
  const r = room && !room.practice && !room.tournament ? room.rating?.[accountId] : undefined;
  if (r) r.skill = Math.round(Math.min(8, Math.max(0, r.skill + delta)) * 1000) / 1000;
}

// Наказание (§19.6): турнирные монеты — в казну, −1.5 рейтинга, бан на 24 часа, исключён.
// from — из каких статусов (наказать дважды нельзя).
function penalize(tournamentId: string, accountId: string, coins: number, from: EntryStatus[], why: string) {
  const done = transaction(db, () => {
    if (!moveEntry(db, tournamentId, accountId, from, 'penalized', { balance: 0 })) return false;
    ledgerAdd(db, `penalty:${tournamentId}:${accountId}`, tournamentId, 'penalty', accountId, coins);
    setTournamentBan(db, accountId, Date.now() + PENALTY_BAN_MS);
    return true;
  });
  if (!done) return;
  applyTournamentRating(tournamentId, accountId, PENALTY_RATING);
  treasuryCache.clear();
  console.log(`[TOURNAMENT ${tournamentId}] ${getAccount(db, accountId)?.name ?? accountId} наказан (${why}): ${coins} в казну, −1.5, бан 24 ч`);
  notifyTelegram(accountId, `tour-penalty:${tournamentId}`, `Турнир ГАРБЫ: ${why}. Бан на 24 часа, −1.5 рейтинга, турнирные монеты ушли в казну.`);
}

// Пустой турнирный стол — обычная комната без игроков и без создателя.
function makeTournamentRoom(tournamentId: string, stage: TableStage, tableNo: number, capacity: number, reserveBots = 0): Room {
  const room: Room = {
    id: makeRoomId(),
    capacity,
    creatorId: '',
    settings: { ...TOUR_SETTINGS },
    players: [],
    status: 'lobby',
    createdAt: Date.now(),
    isPublic: false,
    tournament: { id: tournamentId, stage, tableNo, reserveBots },
  };
  rooms.set(room.id, room);
  return room;
}

// Может ли игрок сесть за этот турнирный стол: зарегистрирован и ещё не играл (отбор) или
// прошёл в финал (финал).
function tournamentSeatAllowed(room: Room, accountId: string): boolean {
  const tr = room.tournament;
  if (!tr) return false;
  return entryOf(db, tr.id, accountId)?.status === seatStatus(tr.stage);
}

// Сесть за турнирный стол (§19.3): только участник, со своим турнирным балансом.
function tournamentSit(room: Room, account: Account, seat?: number): { status: number; body: unknown } {
  const tr = room.tournament!;
  const t = activeTournament(db);
  if (!t || t.id !== tr.id || t.status !== (tr.stage === 'qual' ? 'qualification' : 'final')) {
    return { status: 409, body: { error: 'tournament stage is over' } };
  }
  if (room.players.some((p) => p.id === account.id)) return { status: 200, body: publicRoom(room, account.id) };
  if (room.status !== 'lobby') return { status: 409, body: { error: 'game already started' } };
  // «ГОТОВ» последнего шанса уже идёт — дальше садятся только боты (§19.5).
  if (tr.launch) return { status: 409, body: { error: 'table is starting' } };
  const entry = entryOf(db, tr.id, account.id);
  if (!entry) return { status: 403, body: { error: 'not registered' } };
  if (entry.status !== seatStatus(tr.stage)) return { status: 403, body: { error: 'cannot sit', status: entry.status } };
  return joinRoom(room, account, seat, undefined, entry.balance);
}

// Свободные места — ботам (последний шанс §19.5, финал с недобором §19.7). Бот садится
// с 10 000 от игры: кошелёк бота не трогается, все его монеты потом уйдут в казну.
function addTournamentBots(room: Room) {
  const pool = botAccounts(db).filter((b) => !activeRoomOf(b.id));
  while (room.players.length < room.capacity) {
    const taken = room.players.map((p) => p.name);
    let bot = pool.find((b) => !taken.includes(b.name));
    if (bot) pool.splice(pool.indexOf(bot), 1);
    else {
      bot = createAccount(db, freeBotName(taken)).account;
      markBot(db, bot.id);
    }
    const seat = seatFor(room.players.map((p) => p.seat ?? 0), room.capacity);
    if (seat === null) break;
    room.players.push({
      id: bot.id,
      name: bot.name,
      ready: true,
      joinedAt: Date.now(),
      balance: ENTRY_FEE,
      reserve: 0,
      startBalance: ENTRY_FEE,
      seat,
    });
    room.botIds = [...(room.botIds ?? []), bot.id];
  }
  sortSeats(room);
  room.tournament!.reserveBots = 0;
  console.log(`[ROOM ${room.id}] турнир: боты на свободные места — ${room.players.length}/${room.capacity}`);
}

// «ГОТОВ» за турнирным столом (§19.3, §19.5). Нажали все — старт (последний шанс и финал
// с недобором — сначала боты на свободные места). 30 секунд вышли — не нажавшие встают,
// регистрация у них остаётся; в последний шанс их места отдаются ботам, людей нет — стол
// не играется.
function settleTournamentReady(room: Room): boolean {
  const tr = room.tournament!;
  const check = room.readyCheck!;
  const humans = room.players.filter((p) => !room.botIds?.includes(p.id));
  const allReady = humans.every((p) => check.readyIds.includes(p.id));
  if (allReady && humans.length > 0 && (tableFull(room) || tr.launch)) {
    if (room.players.length < room.capacity) addTournamentBots(room);
    startGame(room);
    return true;
  }
  if (Date.now() - check.startedAt < readyMs) return false;

  const drop = humans.filter((p) => !check.readyIds.includes(p.id)).map((p) => p.id);
  const names = room.players.filter((p) => drop.includes(p.id)).map((p) => p.name);
  room.players = room.players.filter((p) => !drop.includes(p.id));
  room.readyCheck = null;
  room.readyDroppedIds = drop;
  console.log(`[ROOM ${room.id}] турнир: не нажали «ГОТОВ» — встали: ${names.join(', ')}`);
  if (tr.launch) {
    if (room.players.filter((p) => !room.botIds?.includes(p.id)).length === 0) {
      room.status = 'finished';
      console.log(`[ROOM ${room.id}] турнир: последний шанс — людей нет, стол не играется`);
      return true;
    }
    addTournamentBots(room);
    startGame(room);
  }
  return true;
}

// Игра за турнирным столом началась: состав зафиксирован, пошёл час (§19.3, §19.4).
function tournamentGameStarted(room: Room) {
  const tr = room.tournament!;
  tr.startedAt = Date.now();
  tr.scores = {};
  tr.eliminatedIds = [];
  tr.penalizedIds = [];
  transaction(db, () => {
    moveTable(db, tr.id, tr.stage, tr.tableNo, ['waiting'], 'playing', tr.startedAt);
    for (const p of room.players) {
      if (room.botIds?.includes(p.id)) continue;
      moveEntry(db, tr.id, p.id, [seatStatus(tr.stage)], playingStatus(tr.stage), tr.stage === 'qual' ? { tableNo: tr.tableNo } : {});
    }
  });
  console.log(`[TOURNAMENT ${tr.id}] ${tr.stage === 'qual' ? `стол №${tr.tableNo}` : 'финал'} начался: ${room.players.map((p) => p.name).join(', ')}`);
}

// Игрок уходит из-за турнирного стола: выбыл (меньше взноса), сам вышел или не вернулся.
// Кон остаётся на столе (§19.4). Выбывший сохраняет свой остаток — это его итог; ушедший
// наказан (§19.6). Монеты бота — в казну.
function tournamentDrop(room: Room, playerId: string, why: 'eliminated' | 'left' | 'gone') {
  const tr = room.tournament!;
  const game = room.game!;
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return;
  const bot = room.botIds?.includes(playerId) ?? false;
  const rest = room.players.filter((p) => p.id !== playerId);
  game.topUpVote = null;
  if (rest.length > 0) {
    game.dealerId = dealerAfterLeave(room.players.map((p) => p.id), game.dealerId, playerId);
    game.dealerName = rest.find((p) => p.id === game.dealerId)?.name ?? game.dealerName;
  }
  const rating = shownRating(accountRating(playerId));
  room.departed = [
    ...(room.departed ?? []).filter((d) => d.id !== playerId),
    { id: playerId, name: player.name, startBalance: player.startBalance, balance: player.balance, ratingStart: rating, rating, bot },
  ];
  room.departedIds = [...(room.departedIds ?? []).filter((id) => id !== playerId), playerId];
  room.players = rest;
  forgetSeat(room, playerId);
  game.lastLeave = null;
  tr.lastOut = { name: player.name, reason: why };
  if (why === 'eliminated') tr.eliminatedIds = [...(tr.eliminatedIds ?? []), playerId];
  else tr.penalizedIds = [...(tr.penalizedIds ?? []), playerId];

  if (bot) {
    ledgerAdd(db, botKey(tr, playerId), tr.id, 'bot', playerId, player.balance);
    treasuryCache.clear();
  } else if (why === 'eliminated') {
    const score = tr.scores?.[playerId] ?? { razWins: 0, dvaWins: 0, maxRisk: 0 };
    transaction(db, () => {
      writeEntryPlay(db, tr.id, playerId, tr.stage, player.balance, score);
      moveEntry(db, tr.id, playerId, [playingStatus(tr.stage)], doneStatus(tr.stage), {
        balance: player.balance,
        ...(tr.stage === 'qual' ? { qualBalance: player.balance } : {}),
      });
    });
  } else {
    penalize(tr.id, playerId, player.balance, [playingStatus(tr.stage)], why === 'left' ? 'ты вышел из турнирной игры' : 'ты не вернулся за турнирный стол');
  }
  console.log(`[ROOM ${room.id}] турнир: ${player.name} ${why === 'eliminated' ? `выбыл (${player.balance})` : why === 'left' ? 'вышел — наказан' : 'не вернулся — наказан'}, осталось ${rest.length}`);
}

// После ухода: осталось трое, одни боты или вышел час — стол заканчивается; иначе стол
// меньше, без голосования (§19.4).
function finishTournamentLeaving(room: Room) {
  const tr = room.tournament!;
  const humans = room.players.filter((p) => !room.botIds?.includes(p.id)).length;
  const end = tableEndReason(room.players.length, humans, tr.startedAt ?? Date.now(), Date.now(), TOUR_TIMES.tablePlayMs);
  if (end) closeTournamentTable(room, end);
  else shrinkTable(room);
}

// Стол закончился: кон — между оставшимися поровну, остаток — проигравшему больше всех (§19.4).
function closeTournamentTable(room: Room, reason: TableEnd) {
  const tr = room.tournament!;
  tr.endReason = reason;
  const kon = room.game?.kon ?? 0;
  // Делить не с кем — кон в казну (за столом никого не осталось).
  if (room.players.length === 0 && kon > 0) {
    ledgerAdd(db, `kon:${tr.id}:${tr.stage}:${tr.tableNo}`, tr.id, 'leftover', null, kon);
    treasuryCache.clear();
  }
  closeWithSplit(room, 'tournament_end');
  console.log(`[TOURNAMENT ${tr.id}] ${tr.stage === 'qual' ? `стол №${tr.tableNo}` : 'финал'} закончен: ${reason}`);
}

// Между раздачами за турнирным столом (все досмотрели открытые карты): вышел час — стол
// закрывается, раздачу не начинаем; у кого меньше взноса — выбывают; одни боты — конец.
// true — стол изменился.
function tournamentBetweenDeals(room: Room): boolean {
  const tr = room.tournament;
  const game = room.game;
  if (!tr || !game || room.status !== 'started' || !betweenDeals(game.stage)) return false;
  const now = Date.now();
  if (handsShownAt(room) > now) return false;
  if (now - (tr.startedAt ?? now) >= TOUR_TIMES.tablePlayMs) {
    closeTournamentTable(room, 'time_up');
    return true;
  }
  const out = eliminatedIds(room.players, room.settings.ante);
  if (out.length > 0) {
    for (const id of out) tournamentDrop(room, id, 'eliminated');
    finishTournamentLeaving(room);
    return true;
  }
  if (room.players.every((p) => room.botIds?.includes(p.id))) {
    closeTournamentTable(room, 'no_humans');
    return true;
  }
  return false;
}

// Итог сыгранного стола — в турнир: балансы участников, монеты ботов в казну. Один раз
// (стол «идёт» → «сыгран»). Комната могла уже уйти из памяти — берём из базы.
function reportTable(t: Tournament, table: TournamentTable): boolean {
  if (!table.roomId) return false;
  const room = rooms.get(table.roomId) ?? loadRoom<Room>(db, table.roomId);
  if (!room || room.status !== 'finished' || !room.tournament) return false;
  const tr = room.tournament;
  const done = transaction(db, () => {
    if (!moveTable(db, t.id, table.stage, table.tableNo, ['playing'], 'finished')) return false;
    for (const p of room.players) {
      if (room.botIds?.includes(p.id)) {
        ledgerAdd(db, botKey(tr, p.id), t.id, 'bot', p.id, p.balance);
        continue;
      }
      writeEntryPlay(db, t.id, p.id, table.stage, p.balance, tr.scores?.[p.id] ?? { razWins: 0, dvaWins: 0, maxRisk: 0 });
      moveEntry(db, t.id, p.id, [playingStatus(table.stage)], doneStatus(table.stage), {
        balance: p.balance,
        ...(table.stage === 'qual' ? { qualBalance: p.balance } : {}),
      });
    }
    for (const d of room.departed ?? []) if (d.bot) ledgerAdd(db, botKey(tr, d.id), t.id, 'bot', d.id, d.balance);
    return true;
  });
  if (done) {
    treasuryCache.clear();
    console.log(`[TOURNAMENT ${t.id}] итог ${table.stage === 'qual' ? `стола №${table.tableNo}` : 'финала'}: ${room.players.map((p) => `${p.name} ${p.balance}`).join(', ')}`);
  }
  return done;
}

// Ждущие столы этапа: последний шанс (§19.5) и итоги сыгранных. true — что-то изменилось.
function stepTables(t: Tournament, stage: TableStage, endsAt: number, now: number): boolean {
  let changed = false;
  for (const table of tablesOf(db, t.id, stage)) {
    if (table.status === 'playing') {
      if (reportTable(t, table)) changed = true;
      continue;
    }
    if (table.status !== 'waiting' || !table.roomId) continue;
    const room = rooms.get(table.roomId);
    if (!room || room.status === 'started') continue;
    if (room.status === 'finished') {
      // Последний шанс: людей не было — стол не играется (его +50 000 уже в казне).
      if (moveTable(db, t.id, stage, table.tableNo, ['waiting'], 'skipped', now)) changed = true;
      continue;
    }
    const tr = room.tournament!;
    const phase = lastCallPhase(now, endsAt, TOUR_TIMES);
    if (phase !== 'wait' && !tr.lastCall) {
      tr.lastCall = true;
      notifyLastCall(t, stage, room);
      persistRoom(room);
      broadcastRoom(room.id).catch((e) => console.error(`[ROOM ${room.id}] broadcast failed:`, e));
      changed = true;
    }
    // Пора стартовать с ботами. «ГОТОВ» нет (только что или после перезапуска сервера,
    // или кто-то встал во время проверки) — начинаем её заново.
    if (phase === 'launch' && (!tr.launch || !room.readyCheck)) {
      tr.launch = true;
      const name = stage === 'qual' ? `стол №${table.tableNo}` : 'финал';
      if (room.players.length === 0) {
        room.status = 'finished';
        moveTable(db, t.id, stage, table.tableNo, ['waiting'], 'skipped', now);
        console.log(`[TOURNAMENT ${t.id}] ${name} не собрался — не играется`);
      } else if (!room.readyCheck) {
        // Уже идёт «ГОТОВ» (стол только что набрался) — не сбрасываем нажатое.
        room.readyCheck = startReadyCheck(now);
        console.log(`[TOURNAMENT ${t.id}] ${name}: последний шанс — «ГОТОВ», пустые места займут боты`);
      }
      persistRoom(room);
      broadcastRoom(room.id).catch((e) => console.error(`[ROOM ${room.id}] broadcast failed:`, e));
      changed = true;
    }
  }
  return changed;
}

// Последнее уведомление (§19.5): всем, кто ещё обязан сыграть и не сидит за столом.
function notifyLastCall(t: Tournament, stage: TableStage, room: Room) {
  for (const e of entriesOf(db, t.id)) {
    if (e.status !== seatStatus(stage) || activeRoomOf(e.accountId)?.tournament) continue;
    notifyTelegram(
      e.accountId,
      `tour-last:${t.id}:${stage}`,
      stage === 'qual'
        ? 'Турнир ГАРБЫ: последние 10 минут, чтобы сесть за свой стол! Не сыграешь — бан на 24 часа и −1.5 рейтинга.'
        : 'Финал турнира ГАРБЫ: последние 10 минут, чтобы сесть за финальный стол!',
      `room_${room.id}`,
    );
  }
}

// Регистрация закончилась (§19.2, §19.3): меньше 8 — отмена и возврат; иначе — столы отбора
// и +50 000 в казну за каждый.
function closeRegistration(t: Tournament): boolean {
  const regs = entriesOf(db, t.id).filter((e) => e.status === 'registered');
  if (regs.length < MIN_PARTICIPANTS) {
    const cancelled = tournamentTx((pay) => {
      if (!moveTournament(db, t.id, 'registration', 'cancelled', { finishedAt: Date.now() })) return false;
      for (const e of regs) {
        if (!ledgerAdd(db, `refund:${t.id}:${e.accountId}`, t.id, 'refund', e.accountId, ENTRY_FEE)) continue;
        moveEntry(db, t.id, e.accountId, ['registered'], 'refunded');
        pay(e.accountId, ENTRY_FEE);
      }
      return true;
    });
    if (!cancelled) return false;
    console.log(`[TOURNAMENT ${t.id}] отменён: участников ${regs.length} из ${MIN_PARTICIPANTS}, всем вернули ${ENTRY_FEE}`);
    for (const e of regs) {
      notifyTelegram(e.accountId, `tour-cancel:${t.id}`, `Турнир ГАРБЫ не состоялся: участников меньше ${MIN_PARTICIPANTS}. 10 000 монет вернулись в кошелёк.`);
    }
    return true;
  }

  const sizes = tableSizes(regs.length);
  const made = sizes.map((capacity, i) => makeTournamentRoom(t.id, 'qual', i + 1, capacity));
  let ok = false;
  try {
    ok = transaction(db, () => {
      if (!moveTournament(db, t.id, 'registration', 'qualification')) return false;
      made.forEach((room, i) => {
        writeRoom(db, room);
        addTable(db, t.id, 'qual', i + 1, room.capacity, room.id);
        ledgerAdd(db, `table:${t.id}:qual:${i + 1}`, t.id, 'table', null, TABLE_BONUS);
      });
      return true;
    });
  } finally {
    if (!ok) for (const room of made) rooms.delete(room.id);
  }
  if (!ok) return false;
  treasuryCache.clear();
  console.log(`[TOURNAMENT ${t.id}] регистрация закрыта: ${regs.length} участников, столы ${sizes.join('+')}`);
  for (const e of regs) {
    notifyTelegram(e.accountId, `tour-qual:${t.id}`, `Турнир ГАРБЫ: регистрация закрыта, столы готовы — выбери свободное место. На отбор 72 часа.`);
  }
  return true;
}

// Отбор закончился (§19.6, §19.7): не сыгравшие наказаны, общий список, финалисты, остатки
// не прошедших — в казну, финальный стол и его +50 000.
function closeQualification(t: Tournament) {
  for (const e of entriesOf(db, t.id).filter((x) => x.status === 'registered')) {
    penalize(t.id, e.accountId, e.balance, ['registered'], 'ты не сыграл свой отборочный стол');
  }
  const played = entriesOf(db, t.id).filter((e) => e.status === 'played');
  const { finalists, out, bots } = selectFinalists(played, TOUR_SETTINGS.ante);
  const finalRoom = finalists.length > 0 ? makeTournamentRoom(t.id, 'final', 1, finalists.length + bots, bots) : null;
  let ok = false;
  try {
    ok = transaction(db, () => {
      if (!moveTournament(db, t.id, 'qualification', 'final', { finalEndsAt: Date.now() + TOUR_TIMES.finalMs })) return false;
      for (const e of out) {
        moveEntry(db, t.id, e.accountId, ['played'], 'out');
        ledgerAdd(db, `leftover:${t.id}:${e.accountId}`, t.id, 'leftover', e.accountId, e.balance);
      }
      for (const e of finalists) moveEntry(db, t.id, e.accountId, ['played'], 'finalist');
      if (finalRoom) {
        writeRoom(db, finalRoom);
        addTable(db, t.id, 'final', 1, finalRoom.capacity, finalRoom.id);
        ledgerAdd(db, `table:${t.id}:final:1`, t.id, 'table', null, TABLE_BONUS);
      }
      return true;
    });
  } finally {
    if (!ok && finalRoom) rooms.delete(finalRoom.id);
  }
  if (!ok) return;
  treasuryCache.clear();
  console.log(
    `[TOURNAMENT ${t.id}] отбор закончен. Финалисты: ${finalists.map((e) => `${e.name} ${e.balance}`).join(', ') || 'нет'}` +
      (bots ? `, ботов ${bots}` : '') + `; казна ${treasuryOf(db, t.id)}`,
  );
  for (const e of finalists) {
    notifyTelegram(e.accountId, `tour-final:${t.id}`, `Ты в финале турнира ГАРБЫ с ${e.balance} монетами! Финальный стол открыт на 48 часов.`, finalRoom ? `room_${finalRoom.id}` : undefined);
  }
}

// Финал сыгран (или не состоялся): победитель, выплаты, значок, рейтинг (§19.9, §19.10).
function finishTournament(t: Tournament) {
  // Финал не сыгран совсем — за последние 10 минут не сел ни один финалист (§19.13): никого
  // не наказываем, победитель и места — по общему списку отбора (баланс и ничья — из отбора).
  const finalTables = tablesOf(db, t.id, 'final');
  const noFinal = finalTables.length > 0 && finalTables.every((x) => x.status === 'skipped');
  if (!noFinal) {
    for (const e of entriesOf(db, t.id).filter((x) => x.status === 'finalist')) {
      penalize(t.id, e.accountId, e.balance, ['finalist'], 'ты не пришёл на финал');
    }
  }
  const placedFrom: EntryStatus = noFinal ? 'finalist' : 'final_done';
  const entries = entriesOf(db, t.id);
  const standings: Standing[] = entries
    .filter((e) => e.status === placedFrom)
    .map((e) =>
      noFinal
        ? { id: e.accountId, balance: e.balance, razWins: e.razWins, dvaWins: e.dvaWins, maxRisk: e.maxRisk, registeredAt: e.registeredAt }
        : { id: e.accountId, balance: e.balance, razWins: e.finalRazWins, dvaWins: e.finalDvaWins, maxRisk: e.finalMaxRisk, registeredAt: e.registeredAt },
    );
  const ranked = rankStandings(standings);
  const rated: { id: string; delta: number }[] = [];
  const result = tournamentTx((pay) => {
    const treasury = treasuryOf(db, t.id);
    const { winnerId, payments } = payouts(standings, treasury);
    const prize = payments.find((p) => p.id === winnerId)?.amount;
    if (!moveTournament(db, t.id, 'final', 'finished', { winnerId: winnerId ?? undefined, winnerPrize: prize, finishedAt: Date.now() })) {
      return null;
    }
    ranked.forEach((s, i) => moveEntry(db, t.id, s.id, [placedFrom], 'final_done', { finalPlace: i + 1 }));
    for (const p of payments) {
      if (!ledgerAdd(db, `payout:${t.id}:${p.id}`, t.id, 'payout', p.id, p.amount)) continue;
      if (p.amount > 0) pay(p.id, p.amount);
      if (p.id === winnerId) db.prepare('UPDATE accounts SET tournament_wins = tournament_wins + 1 WHERE id = ?').run(p.id);
    }
    // Рейтинг (§19.10) — одна категория; наказанные уже получили −1.5.
    for (const e of entries) {
      if (e.status === 'penalized' || e.status === 'refunded') continue;
      const place = ranked.findIndex((s) => s.id === e.accountId);
      const delta = tournamentRating(place >= 0 ? place + 1 : null);
      if (rateEntry(db, t.id, e.accountId, delta)) rated.push({ id: e.accountId, delta });
    }
    return { winnerId, prize, treasury };
  });
  if (!result) return;
  // Мастерство у тех, кто сейчас за обычным столом, — и в комнате (иначе её сохранение затрёт).
  for (const { id, delta } of rated) {
    const room = activeRoomOf(id);
    const r = room && !room.practice && !room.tournament ? room.rating?.[id] : undefined;
    if (r) r.skill = Math.round(Math.min(8, Math.max(0, r.skill + delta)) * 1000) / 1000;
  }
  if (result.winnerId) winsCache.delete(result.winnerId);
  const winner = result.winnerId ? entries.find((e) => e.accountId === result.winnerId) : null;
  console.log(
    winner
      ? `[TOURNAMENT ${t.id}] победитель ${winner.name}${noFinal ? ' (финал не сыгран — по отбору)' : ''}: ${winner.balance} + казна ${result.treasury} = ${result.prize}`
      : `[TOURNAMENT ${t.id}] закончен без победителя — в финал некого вести, казна ${result.treasury} не выплачена`,
  );
  for (const s of ranked) {
    notifyTelegram(
      s.id,
      `tour-done:${t.id}`,
      (noFinal ? 'Финал турнира ГАРБЫ не сыгран — места по отбору. ' : '') +
        (s.id === result.winnerId
          ? `🏆 Ты выиграл турнир ГАРБЫ! ${result.prize} монет — в кошельке.`
          : `Турнир ГАРБЫ закончен. Победитель — ${winner?.name}. Твои ${s.balance} монет — в кошельке.`),
    );
  }
}

// Раз в секунду: турнир по времени (§19.1–19.9) и турнирные столы между раздачами (§19.4).
function tournamentTick() {
  const now = Date.now();
  let changed = false;
  if (TOUR_AUTO && weeklyRegistrationOpen(now, TOUR_TIMES) && !activeTournament(db)) {
    const start = weeklyStartAt(now);
    if (createTournament(db, tournamentIdFor(start), start, TOUR_TIMES.registrationMs, TOUR_TIMES.qualificationMs)) {
      console.log(`[TOURNAMENT ${tournamentIdFor(start)}] регистрация открыта`);
      changed = true;
    }
  }
  const t = activeTournament(db);
  if (t?.status === 'registration' && now >= t.regEndsAt) {
    if (closeRegistration(t)) changed = true;
  } else if (t?.status === 'qualification') {
    if (stepTables(t, 'qual', t.qualEndsAt, now)) changed = true;
    const tables = tablesOf(db, t.id, 'qual');
    if (now >= t.qualEndsAt && tables.every((x) => x.status === 'finished' || x.status === 'skipped')) {
      closeQualification(t);
      changed = true;
    }
  } else if (t?.status === 'final') {
    if (stepTables(t, 'final', t.finalEndsAt ?? now, now)) changed = true;
    if (tablesOf(db, t.id, 'final').every((x) => x.status === 'finished' || x.status === 'skipped')) {
      finishTournament(t);
      changed = true;
    }
  }
  for (const room of rooms.values()) {
    if (!room.tournament || !tournamentBetweenDeals(room)) continue;
    persistRoom(room);
    broadcastRoom(room.id).catch((e) => console.error(`[ROOM ${room.id}] broadcast failed:`, e));
  }
  if (changed) scheduleTournamentBroadcast();
}
setInterval(guarded('tournament', tournamentTick), 1000);

// --- Турнир для экрана ---

// Этап для экрана: финал — ждём финалистов или игра идёт.
function phaseOf(t: Tournament): string {
  if (t.status !== 'final') return t.status;
  const table = tablesOf(db, t.id, 'final')[0];
  return table?.status === 'playing' ? 'final_playing' : 'final_waiting';
}

// Турнирный стол для состояния комнаты: этап, номер, сколько осталось от часа, казна.
function tournamentRoomView(room: Room) {
  const tr = room.tournament!;
  const now = Date.now();
  const t = activeTournament(db) ?? latestTournament(db);
  const stageEndsAt = t?.id === tr.id ? (tr.stage === 'qual' ? t.qualEndsAt : t.finalEndsAt) : null;
  return {
    id: tr.id,
    stage: tr.stage,
    tableNo: tr.tableNo,
    secondsLeft: tr.startedAt ? Math.max(0, Math.ceil((tr.startedAt + TOUR_TIMES.tablePlayMs - now) / 1000)) : null,
    treasury: treasuryNow(tr.id),
    eliminatedIds: tr.eliminatedIds ?? [],
    penalizedIds: tr.penalizedIds ?? [],
    lastOut: tr.lastOut ?? null,
    endReason: tr.endReason ?? null,
    lastCall: !!tr.lastCall,
    launch: !!tr.launch,
    // Сколько мест займут боты, когда соберутся люди (финал с недобором).
    reserveBots: tr.reserveBots ?? 0,
    stageSecondsLeft: stageEndsAt ? Math.max(0, Math.ceil((stageEndsAt - now) / 1000)) : null,
  };
}

// Коротко для главного экрана (/me): идёт ли турнир, зарегистрирован ли я, где мой стол.
function tournamentBrief(accountId: string) {
  const t = activeTournament(db);
  if (!t) return null;
  const entry = entryOf(db, t.id, accountId);
  const room = activeRoomOf(accountId);
  return {
    id: t.id,
    phase: phaseOf(t),
    registered: !!entry && entry.status !== 'refunded',
    entryStatus: entry?.status ?? null,
    roomId: room?.tournament?.id === t.id ? room.id : null,
  };
}

// Всё о турнире для экрана «ТУРНИР» — одинаковое для всех (личное — tournamentView).
function tournamentShared(now: number) {
  const t = activeTournament(db) ?? latestTournament(db);
  const next = t && t.status !== 'finished' && t.status !== 'cancelled' ? null : (() => {
    const start = weeklyStartAt(now);
    return TOUR_AUTO && now < start + TOUR_TIMES.registrationMs && t?.id !== tournamentIdFor(start) ? start : nextWeeklyStartAt(now);
  })();
  if (!t) return { t: null, view: null, nextStartsAt: next, entries: [] as Entry[], tables: [] as TournamentTable[] };
  const entries = entriesOf(db, t.id);
  const tables = tablesOf(db, t.id);
  const phase = phaseOf(t);
  const deadline =
    t.status === 'registration' ? t.regEndsAt
    : t.status === 'qualification' ? t.qualEndsAt
    : t.status === 'final' ? t.finalEndsAt
    : null;
  const person = (accountId: string) => {
    const a = getAccount(db, accountId);
    return { code: a?.code ?? null, avatar: avatarOf(accountId), frame: frameOf(accountId), wins: winsOf(accountId) };
  };
  // Порядок списка (§19.11): после отбора — сверху финалисты; сыгравшие — по общему списку;
  // ещё не сыгравшие — по времени регистрации.
  const rank = (e: Entry) => ({ ...e, id: e.accountId, ...(e.status.startsWith('final') ? { razWins: e.finalRazWins, dvaWins: e.finalDvaWins, maxRisk: e.finalMaxRisk } : {}) });
  const group = (e: Entry) =>
    ['finalist', 'final_playing', 'final_done'].includes(e.status) ? 0
    : ['played', 'out', 'playing'].includes(e.status) ? 1
    : e.status === 'registered' ? 2
    : 3;
  const ordered = [...entries].sort((a, b) => group(a) - group(b) || (group(a) < 2 ? compareStandings(rank(a), rank(b)) : a.registeredAt - b.registeredAt));
  const winner = t.winnerId ? entries.find((e) => e.accountId === t.winnerId) : null;
  // Кто за каким столом сидит, пока игра не началась (звать его уже не нужно).
  const seatedAt = new Map<string, number>();
  for (const table of tables) {
    const room = table.roomId ? rooms.get(table.roomId) : undefined;
    if (room?.status === 'lobby') for (const p of room.players) seatedAt.set(p.id, table.tableNo);
  }
  const view = {
    id: t.id,
    status: t.status,
    phase,
    startsAt: t.startsAt,
    regEndsAt: t.regEndsAt,
    qualEndsAt: t.qualEndsAt,
    finalEndsAt: t.finalEndsAt,
    secondsLeft: deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null,
    treasury: treasuryNow(t.id),
    participantsCount: entries.filter((e) => e.status !== 'refunded').length,
    participants: ordered.map((e) => ({
      ...person(e.accountId),
      name: e.name,
      status: e.status,
      balance: e.balance,
      qualBalance: e.qualBalance,
      tableNo: e.tableNo,
      seatedAt: seatedAt.get(e.accountId) ?? null,
      finalPlace: e.finalPlace,
      ratingDelta: e.ratingDelta,
    })),
    tables: tables.map((table) => {
      const room = table.roomId ? rooms.get(table.roomId) : undefined;
      const seated = room && room.status !== 'finished' ? room.players : [];
      return {
        stage: table.stage,
        tableNo: table.tableNo,
        capacity: table.capacity,
        roomId: table.roomId,
        status: table.status,
        players: seated.map((p) => ({ code: codeOf(p.id), name: p.name, bot: room?.botIds?.includes(p.id) ?? false, balance: p.balance })),
        free: table.status === 'waiting' && room ? Math.max(0, room.capacity - (room.tournament?.reserveBots ?? 0) - room.players.length) : 0,
        secondsLeft: table.status === 'playing' && table.startedAt ? Math.max(0, Math.ceil((table.startedAt + TOUR_TIMES.tablePlayMs - now) / 1000)) : null,
        lastCall: !!room?.tournament?.lastCall && table.status === 'waiting',
        bots: room?.tournament?.reserveBots ?? 0,
      };
    }),
    winner: winner
      ? {
          ...person(winner.accountId),
          name: winner.name,
          balance: winner.balance,
          prize: t.winnerPrize,
          treasury: (t.winnerPrize ?? 0) - winner.balance,
          // Финал не сыгран — победитель по отбору (§19.13).
          byQualification: tables.some((x) => x.stage === 'final') && tables.filter((x) => x.stage === 'final').every((x) => x.status === 'skipped'),
        }
      : null,
  };
  return { t, view, nextStartsAt: next, entries, tables };
}

// Экран «ТУРНИР» для этого игрока: общее + моё (зарегистрирован ли, мой стол, можно ли).
function tournamentPersonal(shared: ReturnType<typeof tournamentShared>, accountId: string) {
  const base = {
    fee: ENTRY_FEE,
    minParticipants: MIN_PARTICIPANTS,
    finalMin: FINAL_MIN,
    finalMax: FINAL_MAX,
    qualifyAbove: QUALIFY_ABOVE,
    nextStartsAt: shared.nextStartsAt,
    serverNow: Date.now(),
    tournament: shared.view,
  };
  if (!shared.t || !shared.view) return { ...base, me: null };
  const t = shared.t;
  const entry = shared.entries.find((e) => e.accountId === accountId) ?? null;
  const account = getAccount(db, accountId);
  const wallet = account ? walletSplit(account).balance : 0;
  const ban = leaveBanOf(accountId);
  const room = activeRoomOf(accountId);
  const registerError =
    t.status !== 'registration' ? 'registration closed'
    : entry ? 'already registered'
    : ban ? 'banned'
    : wallet < ENTRY_FEE ? 'not enough coins'
    : null;
  return {
    ...base,
    me: {
      registered: !!entry && entry.status !== 'refunded',
      status: entry?.status ?? null,
      balance: entry?.balance ?? null,
      tableNo: entry?.tableNo ?? null,
      roomId: room?.tournament?.id === t.id ? room.id : null,
      wallet,
      canRegister: registerError === null,
      registerError,
      canSit: !!entry && entry.status === (t.status === 'final' ? 'finalist' : 'registered') && !room,
      banSecondsLeft: ban?.secondsLeft ?? 0,
      wins: winsOf(accountId),
      badge: winsBadge(winsOf(accountId)),
    },
  };
}

function tournamentView(accountId: string) {
  return tournamentPersonal(tournamentShared(Date.now()), accountId);
}

// Разослать экран «ТУРНИР» всем, кто его смотрит. Частые изменения (садятся за стол) —
// одной рассылкой раз в 300 мс.
let tournamentBroadcastTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleTournamentBroadcast() {
  if (tournamentBroadcastTimer) return;
  tournamentBroadcastTimer = setTimeout(() => {
    tournamentBroadcastTimer = null;
    broadcastTournament().catch((e) => console.error('[TOURNAMENT] broadcast failed:', e));
  }, 300);
}

async function broadcastTournament() {
  const sockets = await io.in(TOURNAMENT_ROOM).fetchSockets();
  if (sockets.length === 0) return;
  const shared = tournamentShared(Date.now());
  for (const s of sockets) {
    const id = s.data.tournamentViewer;
    if (typeof id === 'string') s.emit('tournament', tournamentPersonal(shared, id));
  }
}

app.get('/tournament', (req, res) => {
  const account = accountOf(req);
  if (!account) return res.status(401).json({ error: 'unauthorized' });
  return res.json(tournamentView(account.id));
});

// «ПОДТВЕРДИТЬ УЧАСТИЕ» (§19.2): confirm: true — игрок видел предупреждение. 10 000 из
// кошелька (сидит за обычным столом — из монет вне стола), один раз.
app.post('/tournament/register', (req, res) => {
  const account = accountOf(req);
  if (!account) return res.status(401).json({ error: 'unauthorized' });
  if (req.body?.confirm !== true) return res.status(400).json({ error: 'confirm required' });
  const t = activeTournament(db);
  if (!t || t.status !== 'registration' || Date.now() >= t.regEndsAt) {
    return res.status(409).json({ error: 'registration closed' });
  }
  const ban = banError(account.id);
  if (ban) return res.status(403).json(ban);
  if (entryOf(db, t.id, account.id)) return res.status(409).json({ error: 'already registered' });
  const wallet = walletSplit(account).balance;
  if (wallet < ENTRY_FEE) return res.status(400).json({ error: 'not enough coins', balance: wallet, fee: ENTRY_FEE });

  const registered = tournamentTx((pay) => {
    if (!ledgerAdd(db, `fee:${t.id}:${account.id}`, t.id, 'fee', account.id, -ENTRY_FEE)) return false;
    addEntry(db, t.id, account.id, account.name, Date.now());
    pay(account.id, -ENTRY_FEE);
    return true;
  });
  if (!registered) return res.status(409).json({ error: 'already registered' });
  console.log(`[TOURNAMENT ${t.id}] ${account.name} зарегистрирован`);
  scheduleTournamentBroadcast();
  return res.json(tournamentView(account.id));
});

// «СЕСТЬ» за стол этапа (§19.3): ответ — состояние комнаты, приложение открывает стол.
app.post('/tournament/tables/:no/sit', (req, res) => {
  const account = accountOf(req);
  if (!account) return res.status(401).json({ error: 'unauthorized' });
  const t = activeTournament(db);
  const stage: TableStage | null = t?.status === 'qualification' ? 'qual' : t?.status === 'final' ? 'final' : null;
  if (!t || !stage) return res.status(409).json({ error: 'no tables now' });
  const table = tablesOf(db, t.id, stage).find((x) => x.tableNo === Number(req.params.no));
  const room = table?.roomId ? rooms.get(table.roomId) : undefined;
  if (!table || !room) return res.status(404).json({ error: 'table not found' });
  if (table.status !== 'waiting') return res.status(409).json({ error: 'game already started' });
  const wanted = req.body?.seat === undefined ? undefined : Number(req.body.seat);
  const sat = tournamentSit(room, account, Number.isInteger(wanted) ? wanted : undefined);
  if (sat.status === 200) {
    persistRoom(room);
    broadcastRoom(room.id).catch((e) => console.error(`[ROOM ${room.id}] broadcast failed:`, e));
  }
  return res.status(sat.status).json(sat.body);
});

// Только с этого компьютера — запустить турнир сейчас, не дожидаясь понедельника. Для живой
// проверки (tests/live-tournament.ts); первый настоящий турнир — по расписанию (§19.1).
app.post('/admin/tournament/start', (req, res) => {
  if (!localOnly(req)) return res.status(403).json({ error: 'local only' });
  if (activeTournament(db)) return res.status(409).json({ error: 'tournament in progress' });
  const now = Date.now();
  const id = `test-${now}`;
  createTournament(db, id, now, TOUR_TIMES.registrationMs, TOUR_TIMES.qualificationMs);
  console.log(`[TOURNAMENT ${id}] запущен вручную (проверка)`);
  scheduleTournamentBroadcast();
  return res.json({ id });
});

// HTTP и Socket.IO слушают один и тот же порт.
// HOST — какой адрес слушать. На сервере в интернете — 127.0.0.1: снаружи ходят только
// через Caddy по https. Дома по умолчанию 0.0.0.0 — чтобы достучался эмулятор.
const HOST = process.env.HOST ?? '0.0.0.0';
httpServer.listen(PORT, HOST, () => {
  console.log(`GARBA backend running on :${PORT} (HTTP + Socket.IO)`);
});
