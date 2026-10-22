// Боты сервера (решение владельца, 27.09.2026): создатель комнаты в лобби жмёт
// «ДОБАВИТЬ БОТОВ» — сервер сажает ботов на свободные места и сам ходит за них.
// Нужно, чтобы сыграть, когда людей мало, — и проверяющему App Store.
//
// Бот видит комнату своими глазами (publicRoom для его id) и выбирает только из того,
// что разрешил сервер (myAllowedBids, myPlayableCardIds…). Ходит запросом серверу самому
// себе — через те же проверки, что и человек. Чужих карт бот не знает — только свои и
// уже сыгранные (§10.6).
//
// Простая стратегия (11.10.2026, «боты чуть умнее») — это не правило игры: заявляется
// по силе руки (РАЗ, ДВА, КОН), берёт спецкарту с хорошей картой, в розыгрыше бьёт
// главного, а своих не перебивает. Решения без случайности: driveBots сравнивает
// действие каждые 250 мс, и другое решение сбивало бы паузу на обдумывание.
// Чистые функции; таймер и запросы — в index.ts.

import { LOW_TO_HIGH, ranksForSuit } from './config.js';
import type { Card, Suit } from './types.js';

// Имена ботов: «Бот …», чтобы за столом было видно, что это не человек.
export const BOT_NAMES = ['Айдар', 'Дана', 'Ержан', 'Асель', 'Тимур', 'Мадина'].map((n) => `Бот ${n}`);

// Паузы — чтобы живой игрок успевал видеть, что происходит за столом.
export const BOT_STEP_MS = 1_200; // заявка, ход картой, голос
const DEAL_MS = 2_500; // раздача после вскрытия на туза
const NEXT_DEAL_MS = 10_000; // следующая раздача — сначала прочитать итог
const REDEAL_MS = 6_000; // пересдача после всеобщего ПАСа
const THREE_IZZHOGA_MS = 11_000; // три ИЗЖОГИ открываются по 3 секунды

// path — после /rooms/<номер>/; delay — через сколько после появления решения ходить.
export type BotAction = { path: string; body: Record<string, unknown>; delay: number };

const rankOf = (c: { rank: string }) => LOW_TO_HIGH.indexOf(c.rank as Card['rank']);

// Сколько взяток примерно возьмёт рука при таком козыре: старший козырь — почти верная
// взятка, младший — половина, туз другой масти — неплохой шанс.
export function handTricks(hand: { suit: string; rank: string }[], trump: string): number {
  let sum = 0;
  for (const c of hand) {
    if (c.suit === trump) sum += ['A', 'K', 'Q'].includes(c.rank) ? 1 : ['J', '10'].includes(c.rank) ? 0.7 : 0.55;
    else if (c.rank === 'A') sum += 0.7;
    else if (c.rank === 'K') sum += 0.3;
  }
  return sum;
}

// Порог заявки: 3 взятки из 5 — с запасом на то, что карт противников бот не видит.
const BID_THRESHOLD = 2.5;
// Второй РАЗ — двое главных, выиграть может только один: нужна рука сильнее.
const SECOND_RAZ_THRESHOLD = 3;

const hasGarba = (hand: { suit: string; rank: string }[], trump: string) =>
  ['Q', 'K', 'A'].every((r) => hand.some((c) => c.suit === trump && c.rank === r));

// Когда брать РАЗ: ГАРБА — всегда, иначе по силе руки с козырем РАЗ.
export function wantsRaz(hand: { suit: string; rank: string }[], razSuit: string, second = false): boolean {
  if (hasGarba(hand, razSuit)) return true;
  return handTricks(hand, razSuit) >= (second ? SECOND_RAZ_THRESHOLD : BID_THRESHOLD);
}

// Лучшая масть из предложенных: где рука возьмёт больше взяток (при равенстве — первая).
function bestSuit<T>(hand: Card[], options: T[], suitOf: (o: T) => string): { option: T; score: number } | null {
  let best: { option: T; score: number } | null = null;
  for (const o of options) {
    const score = hasGarba(hand, suitOf(o)) ? 5 : handTricks(hand, suitOf(o));
    if (!best || score > best.score) best = { option: o, score };
  }
  return best;
}

// Заявка: РАЗ, если рука сильна в масти РАЗ; иначе ДВА в лучшей своей масти; иначе КОН
// (козырь назовёт потом — смотрим все масти, из которых будет выбирать); иначе ПАС.
export function chooseBid(g: any): { bid: string; suit?: string } {
  const allowed: string[] = g.myAllowedBids ?? [];
  const hand: Card[] = g.hand ?? [];
  const razSaid = (g.bids ?? []).some((b: any) => b.bid === 'РАЗ');
  if (allowed.includes('РАЗ') && g.razSuit && wantsRaz(hand, g.razSuit, razSaid)) return { bid: 'РАЗ' };
  if (allowed.includes('ДВА')) {
    const best = bestSuit(hand, (g.myDvaSuitOptions ?? []) as string[], (s) => s);
    if (best && best.score >= BID_THRESHOLD) return { bid: 'ДВА', suit: best.option };
  }
  if (allowed.includes('КОН') && g.razSuit) {
    const suits = [g.razSuit, ...((g.myDvaSuitOptions ?? []) as string[])];
    const best = bestSuit(hand, suits, (s) => s);
    if (best && best.score >= BID_THRESHOLD) return { bid: 'КОН' };
  }
  return { bid: 'ПАС' };
}

// Спецкарта: с одной видимой картой много не поймёшь, поэтому бот берёт её только
// по самому низкому множителю (не выше ×2) и только если и видимая карта — козырь:
// у туза, короля и дамы — от валета, у 6 и 10 — дама, король или туз. Вслепую не берёт.
export function specialRisk(g: any): number | null {
  const sp = g.special;
  const risks: number[] = g.mySpecialRisks ?? [];
  if (!sp || sp.phase === 'blind' || risks.length === 0) return null;
  const risk = Math.min(...risks);
  if (risk > 2) return null;
  const trump = sp.card?.suit;
  const minRank = ['A', 'K', 'Q'].includes(sp.kind) ? 'J' : 'Q';
  const good = (g.hand ?? []).some(
    (c: Card) => c.suit === trump && c.id !== sp.card?.id && rankOf(c) >= rankOf({ rank: minRank }),
  );
  return good ? risk : null;
}

// Самая слабая карта: сперва не козырь, младшая по рангу.
function weakest(cards: Card[], trump: string | null): Card {
  return [...cards].sort((a, b) => (a.suit === trump ? 1 : 0) - (b.suit === trump ? 1 : 0) || rankOf(a) - rankOf(b))[0];
}

// Бьёт ли карта a карту b во взятке с мастью хода lead.
function beats(a: Card, b: Card, lead: string, trump: string | null): boolean {
  const score = (c: Card) => (c.suit === trump ? 200 : c.suit === lead ? 100 : 0) + rankOf(c);
  return score(a) > score(b);
}

// Каких карт бот ещё не видел: состав колоды по числу игроков (§3) без своей руки,
// сыгранных карт и открытой карты (если её никто не забрал спецкартой — тогда она у кого-то).
function unseenCards(capacity: number, g: any, hand: Card[]): Card[] {
  const seen = new Set<string>(hand.map((c) => c.id));
  for (const t of g.playedTricks ?? []) for (const x of t.cards) seen.add(x.card.id);
  for (const x of g.currentTrick ?? []) seen.add(x.card.id);
  const taken = g.special?.outcome && g.special.outcome !== 'nobody';
  if (g.openCard && !taken) seen.add(g.openCard.id);
  const cap = capacity as 4 | 5 | 6 | 7;
  const all: Card[] = [];
  for (const suit of ['hearts', 'diamonds', 'clubs', 'spades'] as Suit[]) {
    for (const rank of ranksForSuit(cap, suit)) all.push({ id: `${suit}-${rank}`, suit, rank });
  }
  return all.filter((c) => !seen.has(c.id));
}

// Ход картой. Главный старается взять взятку, противники — не дать ему: бьют главного,
// а если взятку уже берёт свой (не главный) и главный за ним не ходит — кладут слабую.
export function chooseCard(botId: string, room: any): string | null {
  const g = room.game;
  const ids: string[] = g.myPlayableCardIds ?? [];
  if (ids.length <= 1) return ids[0] ?? null;
  const hand: Card[] = g.hand ?? [];
  const cards = ids.map((id) => hand.find((c) => c.id === id)).filter((c): c is Card => !!c);
  if (cards.length !== ids.length) return ids[0];

  const trump: string | null = g.trumpSuit ?? null;
  const conceded: string[] = g.concededIds ?? [];
  const mains = ((g.mains ?? []) as { playerId: string }[]).map((m) => m.playerId).filter((id) => !conceded.includes(id));
  const iAmMain = mains.includes(botId);
  const trick: { playerId: string; card: Card }[] = g.currentTrick ?? [];
  const unseen = unseenCards(room.capacity, g, hand);
  // Старшая в своей масти из оставшихся: перебить её можно только козырем.
  const isBoss = (c: Card) => !unseen.some((u) => u.suit === c.suit && rankOf(u) > rankOf(c));
  const strongest = (list: Card[]) =>
    [...list].sort((a, b) => (b.suit === trump ? 1 : 0) - (a.suit === trump ? 1 : 0) || rankOf(b) - rankOf(a))[0];

  if (trick.length === 0) {
    // Первый во взятке: старшую карту, которую не перебить (козырь — в первую очередь,
    // главному это выбивает козыри у противников), иначе — слабую.
    const bosses = cards.filter(isBoss);
    if (bosses.length > 0) {
      const trumpBoss = bosses.filter((c) => c.suit === trump);
      if (iAmMain && trumpBoss.length > 0) return strongest(trumpBoss).id;
      const side = bosses.filter((c) => c.suit !== trump);
      return (side.length > 0 ? strongest(side) : strongest(bosses)).id;
    }
    return weakest(cards, trump).id;
  }

  const lead = trick[0].card.suit;
  let win = trick[0];
  for (const x of trick.slice(1)) if (beats(x.card, win.card, lead, trump)) win = x;

  // Кто ещё положит карту после бота: следующие по кругу (сосед справа).
  const seats: string[] = (room.players ?? []).map((p: any) => p.id);
  const me = seats.indexOf(botId);
  const after = Array.from({ length: Math.max(0, seats.length - trick.length - 1) }, (_, i) => seats[(me + 1 + i) % seats.length]);
  const mainAfter = after.some((id) => mains.includes(id));

  const winners = cards.filter((c) => beats(c, win.card, lead, trump)).sort((a, b) => rankOf(a) - rankOf(b) || (a.suit === trump ? 1 : 0) - (b.suit === trump ? 1 : 0));
  const friendlyWin = iAmMain ? false : !mains.includes(win.playerId);

  if (friendlyWin && !mainAfter) return weakest(cards, trump).id;
  if (winners.length === 0) return weakest(cards, trump).id;
  // Последний (или после — только свои): хватит самой младшей бьющей.
  const opponentsAfter = iAmMain ? after.length > 0 : mainAfter;
  if (!opponentsAfter) return winners[0].id;
  // Своя уже берёт, главный ходит после: перебивать своих есть смысл, только если
  // её карту главный легко перебьёт, а у бота — старшая, которую не перебить.
  const bossWinners = winners.filter(isBoss);
  if (friendlyWin) {
    if (isBoss(win.card) || bossWinners.length === 0) return weakest(cards, trump).id;
    return bossWinners[0].id;
  }
  // Соперник ещё будет ходить: младшую из тех, что не перебить, иначе — старшую бьющую.
  return (bossWinners[0] ?? winners[winners.length - 1]).id;
}

// Что сбросить после спецкарты: самую слабую (козыри — последними).
export function chooseDiscard(g: any): string | null {
  const ids: string[] = g.myDiscardOptions ?? [];
  const cards = ids.map((id) => (g.hand ?? []).find((c: Card) => c.id === id)).filter(Boolean) as Card[];
  if (cards.length === 0) return ids[0] ?? null;
  return weakest(cards, g.special?.card?.suit ?? g.trumpSuit ?? null).id;
}

// Что бот должен сделать в этом состоянии комнаты (room — publicRoom для бота).
export function botAction(botId: string, room: any): BotAction | null {
  // Комната набралась — бот жмёт «ГОТОВ».
  if (room.status === 'lobby') {
    if (!room.readyCheck || room.readyCheck.readyIds.includes(botId)) return null;
    return { path: 'ready', body: {}, delay: BOT_STEP_MS };
  }
  const g = room.game;
  if (!g || room.status === 'finished') return null;

  // Кто-то предложил закончить игру (§12.3): боты согласны — решают живые игроки.
  // Стол стоит только из-за свободного места (все за столом на связи) — голосовать
  // можно, как и людям (§13b); иначе на паузе бот ничего не делает.
  const onlyVacancy = !room.pause || (room.pause.players ?? []).length === 0;
  if (g.endVote && onlyVacancy) {
    if (g.myEndVote) return null;
    return { path: 'end-game', body: { choice: 'yes' }, delay: BOT_STEP_MS };
  }
  if (room.pause) return null;
  // Игрок ушёл — играть ли без него, решают люди (§13c); пока решают, не раздаём.
  if (g.shrinkVote) return null;
  // Кто-то просит докупить (§9.1c) — отвечают люди, боты не голосуют; пока ждём, не раздаём.
  if (g.topUpVote) return null;

  switch (g.stage) {
    case 'dealer_found':
    case 'awaiting_deal':
    case 'round_done': {
      if (g.dealerId !== botId) return null;
      // Первый круг: карты открываются по одной до туза — даём досмотреть.
      const selectionMs = Math.max(DEAL_MS, (g.revealLog?.length ?? 0) * 900 + 2_200);
      const delay =
        g.stage === 'round_done' ? NEXT_DEAL_MS
        : g.stage === 'awaiting_deal' && g.lastRedeal === 'three_izzhoga' ? THREE_IZZHOGA_MS
        : g.stage === 'awaiting_deal' ? REDEAL_MS
        : selectionMs;
      return { path: 'dealer/continue', body: {}, delay };
    }

    case 'bidding': {
      if ((g.myAllowedBids ?? []).length === 0) return null;
      return { path: 'bid', body: chooseBid(g), delay: BOT_STEP_MS };
    }

    case 'playing': {
      const cardId = chooseCard(botId, room);
      return cardId ? { path: 'play', body: { cardId }, delay: BOT_STEP_MS } : null;
    }

    case 'special': {
      // Очередь — по activeId: пас доступен всегда.
      if (g.special?.activeId !== botId) return null;
      const risk = specialRisk(g);
      const body = risk ? { action: 'take', risk } : { action: 'pass' };
      return { path: 'special', body, delay: BOT_STEP_MS };
    }

    case 'special_discard': {
      const cardId = chooseDiscard(g);
      return cardId ? { path: 'discard', body: { cardId }, delay: BOT_STEP_MS } : null;
    }

    case 'kon_trump': {
      // Козырь — масть, где рука сильнее.
      const option = bestSuit(g.hand ?? [], g.myKonTrumpOptions ?? [], (o: any) => o.suit)?.option as any;
      return option ? { path: 'kon-trump', body: { suit: option.suit }, delay: BOT_STEP_MS } : null;
    }

    case 'vote':
      // Делим только единогласно (§12.2): боты за «делим», решает живой игрок.
      if (g.myVote) return null;
      return { path: 'vote', body: { choice: 'split' }, delay: BOT_STEP_MS };
  }
  return null;
}

// Сколько монет положить боту перед посадкой: чтобы хватило на вход и было как у нового
// игрока. Больше — не трогаем.
export function botTopUp(balance: number, minBalance: number, startingCoins: number): number {
  return Math.max(0, Math.max(minBalance, startingCoins) - balance);
}

// Имя для нового бота: первое, которого нет за этим столом.
export function freeBotName(taken: string[]): string {
  return BOT_NAMES.find((n) => !taken.includes(n)) ?? BOT_NAMES[taken.length % BOT_NAMES.length];
}
