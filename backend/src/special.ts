// Спецкарты: туз, король, дама, 6, 10 — борьба за открытую карту (RULES.md §7).
// Только чистые функции: что это за карта, кто сейчас говорит, какие множители можно
// назвать, чем закончилась борьба. Без HTTP и без состояния комнаты.
//
// Места за столом — массив id в порядке против часовой стрелки:
// следующий элемент = сосед справа.

import { eligibleTrumpSuits } from './config.js';
import type { Card } from './types.js';

export type SpecialKind = 'A' | 'K' | 'Q' | '6' | '10';

export const MAX_RISK = 5;

// Спецкарта — открытая карта ранга туз, король, дама, 6 или 10 масти, которая может быть
// козырем. При 4 игроках — только черви (RULES.md §5.1, §7).
export function specialKindOf(capacity: number, openCard: Card): SpecialKind | null {
  const kinds: Record<string, SpecialKind> = { A: 'A', K: 'K', Q: 'Q', '6': '6', '10': '10' };
  const kind = kinds[openCard.rank];
  if (!kind) return null;

  const eligible =
    capacity === 4
      ? openCard.suit === 'hearts'
      : eligibleTrumpSuits(capacity as 4 | 5 | 6 | 7).includes(openCard.suit);
  return eligible ? kind : null;
}

// Сводка §7.1: есть ли слепой круг, с какого множителя берут, есть ли перехват.
export const SPECIAL_RULES: Record<
  SpecialKind,
  { blind: boolean; startRisk: number; interception: boolean }
> = {
  A: { blind: true, startRisk: 1, interception: true },
  K: { blind: false, startRisk: 2, interception: true },
  Q: { blind: false, startRisk: 2, interception: true },
  '6': { blind: false, startRisk: 1, interception: false },
  '10': { blind: false, startRisk: 1, interception: false },
};

// Состояние борьбы за карту.
//   blind  — слепой круг туза: карт ещё никто не видел, берут только за ×1 (§7.2);
//   window — окно после раздачи по одной карте: берут и перехватывают (§7.3, §7.4).
export type Contest = {
  kind: SpecialKind;
  phase: 'blind' | 'window';
  seats: string[];
  dealerId: string;
  // Кто говорил последним. Следующий — ближайший справа от него, кто ещё в борьбе.
  lastActorId: string;
  holderId: string | null;
  risk: number; // текущий множитель; 0 — карту ещё никто не взял
  passed: string[]; // спасовавшие — окончательно вне борьбы (§7.4)
  blindAsked: string[]; // кого уже спросили в слепом круге
};

// Начало борьбы. Опрос всегда идёт справа от раздающего, против часовой (§7.2, §7.4).
export function startContest(kind: SpecialKind, seats: string[], dealerId: string): Contest {
  return {
    kind,
    phase: SPECIAL_RULES[kind].blind ? 'blind' : 'window',
    seats,
    dealerId,
    lastActorId: dealerId,
    holderId: null,
    risk: 0,
    passed: [],
    blindAsked: [],
  };
}

// Слепой круг закончился, туза взял holderId на ×1 — открывается окно перехвата.
// Окно — новый опрос, снова справа от раздающего. Отказ брать вслепую из борьбы не
// выводит: карт тогда никто не видел (см. RULES.md «Открытые вопросы»).
function openWindowAfterBlind(c: Contest, holderId: string): Contest {
  return { ...c, phase: 'window', holderId, risk: 1, lastActorId: c.dealerId, passed: [] };
}

// Кто говорит следующим, или null — борьба окончена.
export function nextActor(c: Contest): string | null {
  const n = c.seats.length;
  const from = c.seats.indexOf(c.lastActorId);

  if (c.phase === 'blind') {
    // Один проход: справа от раздающего и вплоть до самого раздающего (§7.2).
    for (let step = 1; step <= n; step++) {
      const id = c.seats[(from + step) % n];
      if (!c.blindAsked.includes(id)) return id;
    }
    return null;
  }

  if (c.risk >= MAX_RISK) return null; // на ×5 борьба заканчивается (§7.4)
  // У 6 и 10 перехвата нет: как только кто-то взял — всё (§7.3).
  if (!SPECIAL_RULES[c.kind].interception && c.holderId) return null;

  for (let step = 1; step <= n; step++) {
    const id = c.seats[(from + step) % n];
    if (id !== c.holderId && !c.passed.includes(id)) return id;
  }
  return null;
}

// Какие множители может назвать тот, чья очередь (без проверки баланса).
export function riskOptions(c: Contest): number[] {
  if (c.phase === 'blind') return [1];
  const rules = SPECIAL_RULES[c.kind];
  if (!rules.interception) return c.holderId ? [] : [rules.startRisk];

  // Первый берущий — от стартового множителя; дальше — любой выше текущего, до ×5.
  const from = c.holderId ? c.risk + 1 : rules.startRisk;
  const options: number[] = [];
  for (let r = from; r <= MAX_RISK; r++) options.push(r);
  return options;
}

// Игрок называет множитель — карта переходит к нему.
export function takeCard(c: Contest, playerId: string, risk: number): Contest {
  if (nextActor(c) !== playerId) throw new Error('not your turn');
  if (!riskOptions(c).includes(risk)) throw new Error(`risk ×${risk} is not allowed`);

  if (c.phase === 'blind') {
    return openWindowAfterBlind({ ...c, blindAsked: [...c.blindAsked, playerId] }, playerId);
  }
  return { ...c, holderId: playerId, risk, lastActorId: playerId };
}

// Игрок пасует. В окне пас — окончательный выход из борьбы (§7.4).
export function passCard(c: Contest, playerId: string): Contest {
  if (nextActor(c) !== playerId) throw new Error('not your turn');

  if (c.phase === 'blind') {
    return { ...c, blindAsked: [...c.blindAsked, playerId], lastActorId: playerId };
  }
  return { ...c, passed: [...c.passed, playerId], lastActorId: playerId };
}

// Кому не хватает монет ни на один доступный множитель, того не спрашивают — он сразу
// пасует (§7.4a, решение владельца правил). Пас окончательный, как обычный: монеты за время
// борьбы не меняются, так что позже денег у него не прибавится. canAfford(игрок, риск) —
// хватает ли на проигрыш «кон × риск» (§11.7), считает вызывающий.
export function passUnaffordable(
  c: Contest,
  canAfford: (playerId: string, risk: number) => boolean,
): Contest {
  let current = c;
  for (let actor = nextActor(current); actor !== null; actor = nextActor(current)) {
    const id = actor;
    if (riskOptions(current).some((r) => canAfford(id, r))) break;
    current = passCard(current, id);
  }
  return current;
}

// Чем закончилась борьба (вызывать, когда nextActor вернул null):
// карта у holderId на множителе risk, или её не взял никто — тогда обычные торги.
export function contestResult(c: Contest): { holderId: string; risk: number } | null {
  if (c.holderId === null) return null;
  return { holderId: c.holderId, risk: c.risk };
}

// Первый ход первой взятки в спецраздаче (RULES.md §10.4):
// 6 — главный ходит сам; 10 — сосед справа от главного, чтобы главный был последним;
// туз, король, дама — как обычно, сосед слева.
export function specialLeader(kind: SpecialKind, seats: string[], mainId: string): string {
  const i = seats.indexOf(mainId);
  const n = seats.length;
  if (kind === '6') return mainId;
  if (kind === '10') return seats[(i + 1) % n];
  return seats[(i - 1 + n) % n];
}
