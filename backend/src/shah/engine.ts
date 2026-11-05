// Движок игры ШАХ (SHAH_RULES.md) — этап 1, 04.11.2026. Чистые функции, без сервера и сети.
//
// act(матч, игрок, ход) проверяет ход и возвращает НОВОЕ состояние матча; старое не меняется,
// поэтому отклонённый ход ничего не портит. Случайность приходит снаружи: перетасованную
// колоду даёт вызывающий (сервер — shuffle из deck.ts, проверки — заданный порядок).
//
// Места — по кругу против часовой стрелки, как в Гарбе (RULES.md §2): следующий индекс —
// сосед справа. Стороны: при 2 и 3 игроках каждый сам за себя (сторона = место), при 4 и 6 —
// две команды через одного: места 0, 2, 4 — сторона 0; места 1, 3, 5 — сторона 1.
//
// Где правило владельца ещё не решено (SHAH_RULES.md, «Открытые вопросы»), движок умеет оба
// варианта — ShahOptions. По умолчанию везде вариант «а»; решение владельца = поменять умолчание.

import type { Card, Suit } from '../types.js';
import { beats, createShahDeck, isLegalLead, isShah, matchCovers, pointsOf, TOTAL_POINTS } from './cards.js';
import { matchResult, nextMultiplier, partyOutcome, type SideResult } from './score.js';

export type ShahFormat = 2 | 3 | 4 | 6;
export const SHAH_FORMATS: readonly ShahFormat[] = [2, 3, 4, 6];
export const HAND_SIZE = 6;
export const DECK_SIZE = 36;

export type ShahOptions = {
  // В1. Первый козырь при 2/3/4 — верхняя карта колоды после раздачи: 'top' — остаётся открытой
  // наверху (её берёт первый добирающий); 'bottom' — открытой под низ (её берут последней).
  firstTrumpCard: 'top' | 'bottom';
  // В2. При 6 открытая до раздачи карта: 'dealer' — достаётся сдающему (все знают, что она у него);
  // 'shuffle' — уходит в раздачу как все, у кого она — никто не знает.
  sixOpenCard: 'dealer' | 'shuffle';
  // В5. Конец взятки: 'early' — сразу, как бороться больше некому, кроме того, чья комбинация
  // сверху; 'fullCircle' — очередь доходит до него, выбывшие по пути ещё раз кладут рубашкой.
  trickEnd: 'early' | 'fullCircle';
  // В6. После ШАХ рубашкой кладут: 'circle' — кто в этом круге ещё не клал (круг идёт от
  // зашедшего); 'everyone' — все остальные по разу, и зашедший тоже.
  afterShah: 'circle' | 'everyone';
  // В8. Сколько карт можно зайти: 'free' — сколько угодно своих; 'minHand' — не больше, чем у
  // того из остальных, у кого карт меньше всех.
  leadLimit: 'free' | 'minHand';
  // В9. Добор: 'exactN' — каждый ровно столько, сколько карт было в заходе; 'upTo6' — до 6.
  drawMode: 'exactN' | 'upTo6';
  // В10. Добор по одной карте по кругу, начиная с: 'winner' — выигравшего взятку; 'leader' —
  // зашедшего; 'dealerRight' — соседа справа от сдающего.
  drawStart: 'winner' | 'leader' | 'dealerRight';
  // В13. Закрытые карты в конце партии: false — видны только очки; true — все стопки открыто.
  revealPilesAtEnd: boolean;
  // В15. Две ничьи подряд: 'fixed' — всё равно ×2; 'stacking' — ×2, ×4, ×8…
  drawMultiplier: 'fixed' | 'stacking';
  // В16. Конец матча при 3 игроках — см. matchResult в score.ts.
  threeWinners: 'both' | 'best';
};

export const DEFAULT_SHAH_OPTIONS: Readonly<ShahOptions> = {
  firstTrumpCard: 'top',
  sixOpenCard: 'dealer',
  trickEnd: 'early',
  afterShah: 'circle',
  leadLimit: 'free',
  drawMode: 'exactN',
  drawStart: 'winner',
  revealPilesAtEnd: false,
  drawMultiplier: 'fixed',
  threeWinners: 'both',
};

// Рубашкой: fold — отказался бить; out — выбывший докладывает в новом круге; shah — докладывает
// после ШАХ; short — карт меньше, чем надо положить, — все, что есть (вопрос 7).
export type ClosedReason = 'fold' | 'out' | 'shah' | 'short';

export type TrickMove =
  | { seat: number; kind: 'lead'; cards: Card[] }
  // covers[i] — id верхней карты, которую бьёт cards[i].
  | { seat: number; kind: 'beat'; cards: Card[]; covers: string[]; shah: boolean }
  | { seat: number; kind: 'closed'; cards: Card[]; reason: ClosedReason };

// Чего ждём от игрока: заход; «ПОБИТЬ или НЕ БИТЬ» (борется); карты рубашкой (выбыл или после ШАХ).
export type Awaiting = 'lead' | 'beat' | 'closed';

export type ShahTrick = {
  leader: number;
  n: number; // сколько карт в заходе — столько кладёт каждый в каждом круге
  moves: TrickMove[];
  topSeat: number; // чья комбинация сверху — её и бьют
  topCards: Card[];
  shah: boolean; // сверху комбинация с 6♣ — бить нельзя
  inTrick: boolean[]; // участвует: были карты, когда зашли
  out: boolean[]; // выбыл из борьбы (отказался бить)
  circle: number; // номер круга, круг начинается с зашедшего
  mustClose: number[]; // после ШАХ: кто ещё кладёт рубашкой, по очереди
};

export type FinishedTrick = {
  leader: number;
  n: number;
  winnerSeat: number;
  shah: boolean;
  circles: number;
  moves: TrickMove[];
};

export type PartyResult = {
  number: number;
  dealerSeat: number;
  points: number[]; // очки сторон
  penalties: number[]; // штрафы сторон за эту партию (0, −2, −4, −12, с множителем)
  draw: boolean;
  multiplier: number; // какой множитель действовал
  totals: number[]; // счёт сторон после партии
};

export type ShahParty = {
  number: number; // номер партии в матче, с 1
  dealerSeat: number;
  hands: Card[][];
  deck: Card[]; // deck[0] — следующая карта добора
  openCard: Card; // карта, открытая для первого козыря
  deckOpenCard: Card | null; // открытая карта, пока она лежит в колоде
  trump: Suit;
  trumpCard: Card; // карта, по которой назначен нынешний козырь
  shown: { cardId: string; seat: number }[]; // карты в руках, которые видели все
  piles: Card[][]; // выигранные карты сторон
  phase: 'lead' | 'fight' | 'done';
  leaderSeat: number;
  turnSeat: number | null;
  awaiting: Awaiting | null;
  trick: ShahTrick | null;
  lastTrick: FinishedTrick | null;
  lastDraw: { seats: number[]; card: Card; seat: number } | null; // кто по очереди взял, показанная карта
  tricksPlayed: number;
  lastDrawSeat: number | null; // кто последним взял карту из колоды — сдаёт следующую партию (2/3/4)
  leftover: { side: number; count: number } | null; // остаток без розыгрыша — бить некому (вопрос 12)
  result: PartyResult | null;
};

export type ShahMatch = {
  format: ShahFormat;
  players: string[]; // id игроков по местам
  options: ShahOptions;
  firstDealer: { reveals: { seat: number; card: Card }[]; seat: number };
  dealerSeat: number; // сдающий идущей партии, а после её конца — следующей
  totals: number[]; // штрафы сторон, 0 и ниже
  multiplier: number; // множитель штрафов для следующей результативной партии
  party: ShahParty | null;
  history: PartyResult[];
  over: boolean;
  result: SideResult[] | null; // итог матча по сторонам
};

export type ShahAction =
  | { type: 'lead'; cardIds: string[] }
  // targetIds[i] — какую верхнюю карту бьёт cardIds[i]; нет — движок подберёт сам.
  | { type: 'beat'; cardIds: string[]; targetIds?: string[] }
  // НЕ БИТЬ (если борется) или доложить рубашкой (выбыл, после ШАХ).
  | { type: 'closed'; cardIds: string[] };

export type ShahError = { ok: false; error: string; need?: number; max?: number };
export type ActResult = { ok: true; match: ShahMatch } | ShahError;

// ——— места и стороны ———

export function isTeamFormat(format: ShahFormat): boolean {
  return format === 4 || format === 6;
}

export function sideCount(format: ShahFormat): number {
  return isTeamFormat(format) ? 2 : format;
}

export function sideOf(format: ShahFormat, seat: number): number {
  return isTeamFormat(format) ? seat % 2 : seat;
}

export function seatsOfSide(format: ShahFormat, side: number): number[] {
  return seatsFrom(0, format).filter((s) => sideOf(format, s) === side);
}

export function nextSeat(seat: number, count: number): number {
  return (seat + 1) % count;
}

// Все места по кругу, начиная с from.
function seatsFrom(from: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => (from + i) % count);
}

// ——— начало матча и партии ———

function assertFullDeck(deck: Card[]) {
  const all = new Set(createShahDeck().map((c) => c.id));
  const ids = new Set(deck.map((c) => c.id));
  const valid = deck.every((c) => all.has(c.id) && c.id === `${c.suit}-${c.rank}`);
  if (deck.length !== DECK_SIZE || ids.size !== DECK_SIZE || !valid) {
    throw new Error('ШАХ: колода — ровно 36 разных карт');
  }
}

// §5: первый сдающий — карты из колоды 36 открываются по кругу с места 0, кому первым выпал
// туз, тот и сдаёт (как в Гарбе, RULES.md §4; вопрос 3 — подтвердить).
export function findFirstDealer(deck: Card[], count: number): ShahMatch['firstDealer'] {
  const reveals: { seat: number; card: Card }[] = [];
  for (let i = 0; i < deck.length; i++) {
    const seat = i % count;
    reveals.push({ seat, card: deck[i] });
    if (deck[i].rank === 'A') return { reveals, seat };
  }
  throw new Error('ШАХ: в колоде нет туза');
}

// dealerDeck — перетасованная колода для вскрытия на туза.
export function createMatch(players: string[], dealerDeck: Card[], options: Partial<ShahOptions> = {}): ShahMatch {
  if (!SHAH_FORMATS.includes(players.length as ShahFormat)) throw new Error('ШАХ: 2, 3, 4 или 6 игроков');
  if (new Set(players).size !== players.length) throw new Error('ШАХ: игроки повторяются');
  assertFullDeck(dealerDeck);
  const format = players.length as ShahFormat;
  const firstDealer = structuredClone(findFirstDealer(dealerDeck, format));
  return {
    format,
    players: [...players],
    options: { ...DEFAULT_SHAH_OPTIONS, ...options },
    firstDealer,
    dealerSeat: firstDealer.seat,
    totals: new Array(sideCount(format)).fill(0),
    multiplier: 1,
    party: null,
    history: [],
    over: false,
    result: null,
  };
}

// Следующая игра до −24 за тем же столом (владелец 05.11.2026: за столом — несколько партий до −24
// подряд). Счёт и множитель — с нуля; сдающий — по §5, как между раздачами (тот, кого прошлая игра
// назначила следующим), вскрытия на туза заново нет — решено при реализации.
export function nextMatch(prev: ShahMatch): ShahMatch {
  if (!prev.over) throw new Error('ШАХ: прошлая игра не окончена');
  return {
    format: prev.format,
    players: [...prev.players],
    options: { ...prev.options },
    firstDealer: { reveals: [], seat: prev.dealerSeat },
    dealerSeat: prev.dealerSeat,
    totals: new Array(sideCount(prev.format)).fill(0),
    multiplier: 1,
    party: null,
    history: [],
    over: false,
    result: null,
  };
}

// Новая партия (§3, §4): раздача по одной карте по кругу с соседа справа от сдающего, по 6 каждому.
// deck — перетасованная колода 36. rng нужен только при 6 игроках и sixOpenCard = 'shuffle'.
export function startParty(match: ShahMatch, deck: Card[], rng: () => number = Math.random): ShahMatch {
  if (match.over) throw new Error('ШАХ: матч окончен');
  if (match.party && match.party.phase !== 'done') throw new Error('ШАХ: партия ещё идёт');
  assertFullDeck(deck);
  const m = structuredClone(match);
  const cards = structuredClone(deck);
  const k = m.format;
  const dealer = m.dealerSeat;
  const order = seatsFrom(nextSeat(dealer, k), k); // сдающий получает последним
  const hands: Card[][] = Array.from({ length: k }, () => []);
  const shown: ShahParty['shown'] = [];
  let openCard: Card;
  let rest: Card[] = [];
  let deckOpenCard: Card | null = null;

  if (k === 6) {
    // §4: при 6 карта открывается до раздачи, козырь — её масть до конца партии; раздаётся вся колода.
    if (m.options.sixOpenCard === 'dealer') {
      openCard = cards[DECK_SIZE - 1]; // последняя карта раздачи — сдающему
      shown.push({ cardId: openCard.id, seat: dealer });
    } else {
      openCard = cards[Math.min(DECK_SIZE - 1, Math.floor(rng() * DECK_SIZE))];
    }
    cards.forEach((card, i) => hands[order[i % k]].push(card));
  } else {
    // §4: при 2/3/4 сначала раздача, потом открывается верхняя карта колоды.
    for (let i = 0; i < HAND_SIZE * k; i++) hands[order[i % k]].push(cards[i]);
    const left = cards.slice(HAND_SIZE * k);
    openCard = left[0];
    rest = m.options.firstTrumpCard === 'top' ? left : [...left.slice(1), openCard];
    deckOpenCard = openCard;
  }

  const first = nextSeat(dealer, k); // §5: первым ходит сосед справа от сдающего
  m.party = {
    number: m.history.length + 1,
    dealerSeat: dealer,
    hands,
    deck: rest,
    openCard,
    deckOpenCard,
    trump: openCard.suit,
    trumpCard: openCard,
    shown,
    piles: Array.from({ length: sideCount(k) }, () => []),
    phase: 'lead',
    leaderSeat: first,
    turnSeat: first,
    awaiting: 'lead',
    trick: null,
    lastTrick: null,
    lastDraw: null,
    tricksPlayed: 0,
    lastDrawSeat: null,
    leftover: null,
    result: null,
  };
  return m;
}

// ——— подсказки для сервера и приложения ———

// Сколько карт можно зайти (§6, вопрос 8).
export function leadLimitFor(match: ShahMatch, seat: number): number {
  const p = match.party;
  if (!p) return 0;
  const own = p.hands[seat].length;
  if (match.options.leadLimit === 'free') return own;
  const others = p.hands.filter((h, s) => s !== seat && h.length > 0).map((h) => h.length);
  return Math.min(own, ...others);
}

// Кого ждём и сколько карт он должен положить (min…max; у побить и рубашки min = max).
export function awaitedOf(
  match: ShahMatch,
): { playerId: string; seat: number; awaiting: Awaiting; min: number; max: number } | null {
  const p = match.party;
  if (!p || p.phase === 'done' || p.turnSeat === null || !p.awaiting) return null;
  const seat = p.turnSeat;
  if (p.awaiting === 'lead') {
    return { playerId: match.players[seat], seat, awaiting: 'lead', min: 1, max: leadLimitFor(match, seat) };
  }
  const need = Math.min(p.trick!.n, p.hands[seat].length);
  return { playerId: match.players[seat], seat, awaiting: p.awaiting, min: need, max: need };
}

// ——— ход ———

function fail(error: string, extra: { need?: number; max?: number } = {}): ShahError {
  return { ok: false, error, ...extra };
}

export function act(match: ShahMatch, playerId: string, action: ShahAction): ActResult {
  const seat = match.players.indexOf(playerId);
  if (seat < 0) return fail('player is not in this match');
  const party = match.party;
  if (!party || party.phase === 'done') return fail('no party in progress');
  if (party.turnSeat !== seat) return fail('not your turn');
  const ids = action?.cardIds;
  if (!Array.isArray(ids) || ids.length === 0 || new Set(ids).size !== ids.length) return fail('bad cards');
  if (ids.some((id) => !party.hands[seat].some((c) => c.id === id))) return fail('card not in hand');

  const m = cloneForMove(match);
  const error = apply(m, seat, action);
  return error ?? { ok: true, match: m };
}

// Копия состояния для хода. Карты, сыгранные ходы, итоги партий и вскрытие на туза после
// создания не меняются — их не копируем; массивы и всё, что движок меняет на месте, — копируем.
// Старое состояние после хода остаётся прежним (это проверяет shah-sim.test.ts).
function cloneForMove(match: ShahMatch): ShahMatch {
  const p = match.party!;
  const t = p.trick;
  return {
    ...match,
    options: { ...match.options },
    totals: [...match.totals],
    history: [...match.history],
    party: {
      ...p,
      hands: p.hands.map((h) => [...h]),
      deck: [...p.deck],
      shown: p.shown.map((x) => ({ ...x })),
      piles: p.piles.map((pile) => [...pile]),
      trick: t && {
        ...t,
        moves: [...t.moves],
        topCards: [...t.topCards],
        inTrick: [...t.inTrick],
        out: [...t.out],
        mustClose: [...t.mustClose],
      },
    },
  };
}

function apply(m: ShahMatch, seat: number, action: ShahAction): ShahError | null {
  const p = m.party!;
  const cards = action.cardIds.map((id) => p.hands[seat].find((c) => c.id === id)!);

  if (action.type === 'lead') {
    if (p.awaiting !== 'lead') return fail('wrong move');
    if (!isLegalLead(cards)) return fail('bad lead');
    const max = leadLimitFor(m, seat);
    if (cards.length > max) return fail('lead too big', { max });
    const inTrick = p.hands.map((h) => h.length > 0);
    takeFromHand(p, seat, cards);
    p.trick = {
      leader: seat,
      n: cards.length,
      moves: [{ seat, kind: 'lead', cards }],
      topSeat: seat,
      topCards: cards,
      shah: false,
      inTrick,
      out: p.hands.map(() => false),
      circle: 1,
      mustClose: [],
    };
    p.phase = 'fight';
    p.lastTrick = null;
    p.lastDraw = null;
    proceed(m);
    return null;
  }

  const t = p.trick;
  if (p.phase !== 'fight' || !t) return fail('wrong move');

  if (action.type === 'beat') {
    // Выбывший к борьбе не возвращается; накрытую ШАХом комбинацию не бьют (тогда ждём рубашку).
    if (p.awaiting !== 'beat') return fail('wrong move');
    if (cards.length !== t.n) return fail('wrong card count', { need: t.n });
    const covers = coversFor(cards, t.topCards, p.trump, action.targetIds);
    if (!covers) return fail('cannot beat');
    takeFromHand(p, seat, cards);
    const shah = cards.some(isShah);
    t.moves.push({ seat, kind: 'beat', cards, covers, shah });
    t.topSeat = seat;
    t.topCards = cards;
    if (shah) {
      t.shah = true;
      t.mustClose = shahObligations(m, seat);
    }
    proceed(m);
    return null;
  }

  if (action.type === 'closed') {
    if (p.awaiting !== 'beat' && p.awaiting !== 'closed') return fail('wrong move');
    const need = Math.min(t.n, p.hands[seat].length);
    if (cards.length !== need) return fail('wrong card count', { need });
    takeFromHand(p, seat, cards);
    const reason: ClosedReason = t.shah ? 'shah' : p.awaiting === 'beat' ? 'fold' : 'out';
    t.moves.push({ seat, kind: 'closed', cards, reason });
    if (p.awaiting === 'beat') t.out[seat] = true;
    if (t.shah) t.mustClose.shift();
    proceed(m);
    return null;
  }

  return fail('unknown move');
}

// Какую верхнюю карту бьёт каждая накрывающая. Каждое накрытие проверяется отдельно (§7).
function coversFor(cards: Card[], top: Card[], trump: Suit, targetIds?: string[]): string[] | null {
  if (targetIds === undefined) {
    const idx = matchCovers(cards, top, trump);
    return idx ? idx.map((j) => top[j].id) : null;
  }
  if (!Array.isArray(targetIds) || targetIds.length !== cards.length) return null;
  if (new Set(targetIds).size !== targetIds.length) return null;
  for (let i = 0; i < cards.length; i++) {
    const target = top.find((c) => c.id === targetIds[i]);
    if (!target || !beats(cards[i], target, trump)) return null;
  }
  return [...targetIds];
}

// §10: после ШАХ рубашкой кладут те, кто ещё не ответил (вопрос 6).
function shahObligations(m: ShahMatch, shahSeat: number): number[] {
  const t = m.party!.trick!;
  const k = m.format;
  const list: number[] = [];
  for (let s = nextSeat(shahSeat, k); s !== shahSeat; s = nextSeat(s, k)) {
    if (m.options.afterShah === 'circle' && s === t.leader) break; // круг кончился
    if (t.inTrick[s]) list.push(s);
  }
  return list;
}

function othersInFight(t: ShahTrick): boolean {
  return t.inTrick.some((inTrick, s) => inTrick && !t.out[s] && s !== t.topSeat);
}

function awaitMove(p: ShahParty, seat: number, awaiting: Awaiting) {
  p.turnSeat = seat;
  p.awaiting = awaiting;
}

// Положить рубашкой все оставшиеся карты — выбора нет (карт не больше, чем надо).
function closeAll(p: ShahParty, seat: number, reason: ClosedReason) {
  const cards = [...p.hands[seat]];
  takeFromHand(p, seat, cards);
  p.trick!.moves.push({ seat, kind: 'closed', cards, reason });
}

// Очередь идёт дальше (§8, §9): от того, кто только что положил карты, против часовой.
function proceed(m: ShahMatch) {
  const p = m.party!;
  const t = p.trick!;
  const k = m.format;

  if (t.shah) {
    while (t.mustClose.length > 0) {
      const s = t.mustClose[0];
      const h = p.hands[s].length;
      if (h > t.n) return awaitMove(p, s, 'closed');
      if (h > 0) closeAll(p, s, 'shah');
      t.mustClose.shift();
    }
    return finishTrick(m);
  }

  let s = p.turnSeat!;
  for (;;) {
    if (m.options.trickEnd === 'early' && !othersInFight(t)) return finishTrick(m);
    s = nextSeat(s, k);
    if (s === t.topSeat) return finishTrick(m); // круг вернулся к верхнему — никто не перебил
    if (s === t.leader) t.circle++;
    if (!t.inTrick[s]) continue;
    const h = p.hands[s].length;
    if (t.out[s]) {
      // §8: выбывший в новом круге снова кладёт N рубашкой (меньше карт — все, что есть).
      if (h > t.n) return awaitMove(p, s, 'closed');
      if (h > 0) closeAll(p, s, 'out');
      continue;
    }
    if (h >= t.n) return awaitMove(p, s, 'beat');
    // Вопрос 7: карт меньше N — бить нечем, все оставшиеся рубашкой, выбыл.
    if (h > 0) closeAll(p, s, 'short');
    t.out[s] = true;
  }
}

function takeFromHand(p: ShahParty, seat: number, cards: Card[]) {
  const ids = new Set(cards.map((c) => c.id));
  p.hands[seat] = p.hands[seat].filter((c) => !ids.has(c.id));
  p.shown = p.shown.filter((x) => !ids.has(x.cardId));
}

function addShown(p: ShahParty, card: Card, seat: number) {
  if (!p.shown.some((x) => x.cardId === card.id)) p.shown.push({ cardId: card.id, seat });
}

// §9: взятку забирает тот, чья комбинация сверху, — все карты стола, и рубашки тоже.
function finishTrick(m: ShahMatch) {
  const p = m.party!;
  const t = p.trick!;
  const k = m.format;
  const winner = t.topSeat;
  const pile = p.piles[sideOf(k, winner)];
  for (const move of t.moves) pile.push(...move.cards);
  p.lastTrick = { leader: t.leader, n: t.n, winnerSeat: winner, shah: t.shah, circles: t.circle, moves: t.moves };
  p.trick = null;
  p.tricksPlayed++;

  // §11: добор только при 2/3/4, пока колода не кончилась.
  if (k !== 6 && p.deck.length > 0) drawCards(m, drawStartSeat(m, t.leader, winner), t.n);

  const withCards = seatsFrom(0, k).filter((s) => p.hands[s].length > 0);
  if (withCards.length === 0) return endParty(m); // §12: у всех кончились карты
  if (p.deck.length === 0 && new Set(withCards.map((s) => sideOf(k, s))).size === 1) {
    // Вопрос 12: карты остались только у одной стороны — бить некому, всё ей без розыгрыша.
    const side = sideOf(k, withCards[0]);
    let count = 0;
    for (const s of withCards) {
      count += p.hands[s].length;
      p.piles[side].push(...p.hands[s]);
      p.hands[s] = [];
    }
    p.shown = [];
    p.leftover = { side, count };
    return endParty(m);
  }

  // §5: заходит выигравший взятку; у него нет карт — следующий по кругу, у кого есть (вопрос 12).
  let leader = winner;
  while (p.hands[leader].length === 0) leader = nextSeat(leader, k);
  p.phase = 'lead';
  p.leaderSeat = leader;
  awaitMove(p, leader, 'lead');
}

function drawStartSeat(m: ShahMatch, leader: number, winner: number): number {
  const mode = m.options.drawStart;
  if (mode === 'leader') return leader;
  if (mode === 'dealerRight') return nextSeat(m.party!.dealerSeat, m.format);
  return winner;
}

// §11: добор по одной карте по кругу. Последний взявший показывает последнюю взятую карту —
// её масть становится козырем, карта остаётся у него (§4). Колоды не хватает — берём, пока есть.
function drawCards(m: ShahMatch, start: number, n: number) {
  const p = m.party!;
  const order = seatsFrom(start, m.format);
  const seats: number[] = [];
  let last: Card | null = null;
  let lastSeat = -1;
  for (let round = 0; p.deck.length > 0; round++) {
    let took = false;
    for (const s of order) {
      if (p.deck.length === 0) break;
      const wants = m.options.drawMode === 'exactN' ? round < n : p.hands[s].length < HAND_SIZE;
      if (!wants) continue;
      const card = p.deck.shift()!;
      p.hands[s].push(card);
      seats.push(s);
      took = true;
      last = card;
      lastSeat = s;
      // Открытую карту козыря видели все — у кого она, известно (§4).
      if (p.deckOpenCard && card.id === p.deckOpenCard.id) {
        p.deckOpenCard = null;
        addShown(p, card, s);
      }
    }
    if (!took) break;
  }
  if (last === null) return;
  p.lastDrawSeat = lastSeat;
  p.trump = last.suit;
  p.trumpCard = last;
  addShown(p, last, lastSeat);
  p.lastDraw = { seats, card: last, seat: lastSeat };
}

// §12–§16: подсчёт очков, штраф, множитель после ничьей, конец матча, сдающий следующей партии.
function endParty(m: ShahMatch) {
  const p = m.party!;
  const points = p.piles.map(pointsOf);
  const cardsInPiles = p.piles.reduce((sum, pile) => sum + pile.length, 0);
  if (cardsInPiles !== DECK_SIZE || points.reduce((a, b) => a + b, 0) !== TOTAL_POINTS) {
    throw new Error('ШАХ: в стопках не 36 карт или не 120 очков');
  }
  const multiplier = m.multiplier;
  const outcome = partyOutcome(points, multiplier);
  m.totals = m.totals.map((total, i) => total + outcome.penalties[i]);
  m.multiplier = nextMultiplier(multiplier, outcome.draw, m.options.drawMultiplier);
  const result: PartyResult = {
    number: p.number,
    dealerSeat: p.dealerSeat,
    points,
    penalties: outcome.penalties,
    draw: outcome.draw,
    multiplier,
    totals: [...m.totals],
  };
  p.result = result;
  p.phase = 'done';
  p.turnSeat = null;
  p.awaiting = null;
  m.history.push(result);
  // §5: при 2/3/4 сдаёт тот, кто последним взял карту из колоды; при 6 — по очереди (вопрос 3).
  m.dealerSeat = m.format === 6 ? nextSeat(p.dealerSeat, 6) : (p.lastDrawSeat ?? nextSeat(p.dealerSeat, m.format));
  const res = matchResult(m.totals, m.options.threeWinners);
  if (res) {
    m.over = true;
    m.result = res;
  }
}
