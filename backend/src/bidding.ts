// Торги: кто может что сказать, когда торги заканчиваются и чем.
// Только чистые функции, без HTTP и без состояния комнаты. Правила — RULES.md §6.

import { eligibleTrumpSuits } from './config.js';
import type { Card, Suit } from './types.js';

export type Bid = 'РАЗ' | 'ДВА' | 'ПАС';
export type Capacity = 4 | 5 | 6 | 7;

export type BidEntry = {
  playerId: string;
  playerName: string;
  bid: Bid;
};

export type MainPlayer = {
  playerId: string;
  playerName: string;
  declaration: 'РАЗ' | 'ДВА';
};

export type BiddingOutcome =
  | { kind: 'main'; mains: MainPlayer[]; trumpSuit: Suit }
  | { kind: 'all_pass' };

// Масть РАЗ — масть открытой карты. Исключение: при 4 игроках козырь всегда
// черви, что бы ни открылось (RULES.md §5.1).
export function razSuitFor(capacity: Capacity, openCard: Card): Suit {
  if (capacity === 4) return 'hearts';
  return openCard.suit;
}

// Из каких мастей можно выбрать ДВА — это другие масти, которые в этом составе
// могут быть козырем (RULES.md §6.3).
// 4 игрока — ДВА нет, пусто. 5 — ровно одна, выбирать нечего.
// 6 — две, 7 — три: игрок выбирает сам и прячет выбор от остальных.
export function dvaSuitOptions(capacity: Capacity, razSuit: Suit): Suit[] {
  if (capacity === 4) return [];
  return eligibleTrumpSuits(capacity).filter((s) => s !== razSuit);
}

// Кошелёк игрока, чья очередь: баланс и сколько стоит каждая заявка при текущем коне.
export type Wallet = {
  balance: number;
  razStake: number;
  dvaStake: number;
};

// Какие заявки доступны игроку, чья сейчас очередь.
export function allowedBidsFor(
  capacity: Capacity,
  bids: BidEntry[],
  wallet: Wallet,
): Bid[] {
  const byRules = allowedByRules(capacity, bids);

  // Заявиться можно, только если баланс покрывает возможный проигрыш именно
  // по этой заявке (RULES.md §6.6). ПАС доступен всегда.
  return byRules.filter((bid) => {
    if (bid === 'РАЗ') return wallet.balance >= wallet.razStake;
    if (bid === 'ДВА') return wallet.balance >= wallet.dvaStake;
    return true;
  });
}

function allowedByRules(capacity: Capacity, bids: BidEntry[]): Bid[] {
  // При 4 игроках ДВА не существует (RULES.md §6.2).
  if (capacity === 4) return ['РАЗ', 'ПАС'];

  // Нельзя сказать заявку ниже уже прозвучавшей (RULES.md §6.4): после РАЗ
  // ДВА не говорят, второго ДВА не бывает.
  const dvaOrRazSaid = bids.some((b) => b.bid === 'ДВА' || b.bid === 'РАЗ');
  if (dvaOrRazSaid) return ['РАЗ', 'ПАС'];

  return ['РАЗ', 'ДВА', 'ПАС'];
}

// Закончились ли торги после очередной заявки.
// Заканчиваются, когда высказались все, либо сразу после второго РАЗ —
// остальных уже не спрашивают (RULES.md §6.4).
export function isBiddingOver(bids: BidEntry[], playerCount: number): boolean {
  const razCount = bids.filter((b) => b.bid === 'РАЗ').length;
  if (razCount >= 2) return true;
  return bids.length >= playerCount;
}

// Итог торгов. Вызывать, когда isBiddingOver() вернул true.
// chosenDvaSuit — масть, которую выбрал сказавший ДВА (при 6 и 7 игроках);
// при 5 игроках выбирать нечего и можно передать null.
export function resolveBidding(
  capacity: Capacity,
  bids: BidEntry[],
  razSuit: Suit,
  chosenDvaSuit: Suit | null,
): BiddingOutcome {
  // РАЗ всегда старше ДВА. Сказавших РАЗ не больше двух — тогда играют оба,
  // а ДВА выбывает в обычные противники.
  const raz = bids.filter((b) => b.bid === 'РАЗ');
  if (raz.length > 0) {
    return {
      kind: 'main',
      mains: raz.map((b) => ({
        playerId: b.playerId,
        playerName: b.playerName,
        declaration: 'РАЗ',
      })),
      trumpSuit: razSuit,
    };
  }

  // РАЗ не прозвучал — играет ДВА, если был. ДВА меняет козырь на свою масть.
  const dva = bids.find((b) => b.bid === 'ДВА');
  if (dva) {
    const options = dvaSuitOptions(capacity, razSuit);
    const suit = options.length === 1 ? options[0] : chosenDvaSuit;
    if (!suit || !options.includes(suit)) {
      // Масть ДВА проверяется при заявке, так что сюда попасть нельзя.
      // Если попали — это ошибка в коде.
      throw new Error(`ДВА без допустимой масти при ${capacity} игроках`);
    }
    return {
      kind: 'main',
      mains: [
        { playerId: dva.playerId, playerName: dva.playerName, declaration: 'ДВА' },
      ],
      trumpSuit: suit,
    };
  }

  // Все спасовали — пересдача (RULES.md §6.5).
  return { kind: 'all_pass' };
}
