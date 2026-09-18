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

// Масть ДВА — другая масть, которая в этом составе может быть козырем.
// При 5 игроках она ровно одна. При 6 и 7 игрок выбирает её сам и прячет от
// остальных (RULES.md §6.3) — это этап 5, пока возвращаем null.
export function dvaSuitFor(capacity: Capacity, razSuit: Suit): Suit | null {
  if (capacity !== 5) return null;
  const others = eligibleTrumpSuits(capacity).filter((s) => s !== razSuit);
  return others.length === 1 ? others[0] : null;
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

  // При 6 и 7 игроках ДВА требует выбора скрытой масти — этап 5.
  if (capacity !== 5) return ['РАЗ', 'ПАС'];

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
export function resolveBidding(
  capacity: Capacity,
  bids: BidEntry[],
  razSuit: Suit,
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
    const suit = dvaSuitFor(capacity, razSuit);
    if (!suit) {
      // allowedBidsFor() не даёт сказать ДВА там, где масть не определена,
      // так что сюда попасть нельзя. Если попали — это ошибка в коде.
      throw new Error(`ДВА без масти при ${capacity} игроках`);
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
