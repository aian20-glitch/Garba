// Боты сервера (решение владельца, 27.09.2026): создатель комнаты в лобби жмёт
// «ДОБАВИТЬ БОТОВ» — сервер сажает ботов на свободные места и сам ходит за них.
// Нужно, чтобы сыграть, когда людей мало, — и проверяющему App Store.
//
// Бот видит комнату своими глазами (publicRoom для его id) и выбирает только из того,
// что разрешил сервер (myAllowedBids, myPlayableCardIds…). Ходит запросом серверу самому
// себе — через те же проверки, что и человек. Стратегии нет — это та же логика, что у
// ботов для проверки (scripts/bots-online.ts), а не правило игры.
// Чистые функции; таймер и запросы — в index.ts.

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

// Когда брать РАЗ: 3+ карты масти РАЗ или 2 со старшей (туз / король). Иначе ПАС.
// ДВА и КОН боты не говорят — чтобы боты иногда играли главными.
export function wantsRaz(hand: { suit: string; rank: string }[], razSuit: string): boolean {
  const trumps = hand.filter((c) => c.suit === razSuit);
  return trumps.length >= 3 || (trumps.length >= 2 && trumps.some((c) => c.rank === 'A' || c.rank === 'K'));
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
      const allowed: string[] = g.myAllowedBids ?? [];
      if (allowed.length === 0) return null;
      const bid = allowed.includes('РАЗ') && wantsRaz(g.hand ?? [], g.razSuit) ? 'РАЗ' : 'ПАС';
      return { path: 'bid', body: { bid }, delay: BOT_STEP_MS };
    }

    case 'playing': {
      const cardId = g.myPlayableCardIds?.[0];
      return cardId ? { path: 'play', body: { cardId }, delay: BOT_STEP_MS } : null;
    }

    case 'special':
      // Спецкарту боты не берут. Очередь — по activeId: пас доступен всегда.
      if (g.special?.activeId !== botId) return null;
      return { path: 'special', body: { action: 'pass' }, delay: BOT_STEP_MS };

    case 'special_discard': {
      const cardId = g.myDiscardOptions?.[0];
      return cardId ? { path: 'discard', body: { cardId }, delay: BOT_STEP_MS } : null;
    }

    case 'kon_trump': {
      const option = g.myKonTrumpOptions?.[0];
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
