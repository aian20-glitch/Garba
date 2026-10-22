// Деньги: кон, взносы, стоимость заявок, расчёт после раздачи.
// Только чистые функции. Правила — RULES.md §9, §11, §12.

export const MIN_ANTE = 100;
export const MAX_ANTE = 1000;
export const MIN_EMPTY_LIMIT = 3;
export const MAX_EMPTY_LIMIT = 10;

// Порог КОН — во сколько раз кон должен превысить базовый (RULES.md §6.7).
export const MIN_KON_THRESHOLD = 3;
export const MAX_KON_THRESHOLD = 10;

// Минимальный баланс для входа в комнату — «сумма за стол» (RULES.md §9.1a): шагом 1 000,
// не меньше взноса × 10. С 22.10.2026 создатель вписывает любую сумму — 25 000, 50 000,
// 100 000… (раньше — только 1 000 … 10 000). Потолок — только от ошибок ввода.
export const MIN_ENTRY = 1000;
export const MAX_ENTRY = 10_000_000;
export const ENTRY_STEP = 1000;
export const ENTRY_PER_ANTE = 10;

export function lowestEntryFor(ante: number): number {
  return Math.max(MIN_ENTRY, ante * ENTRY_PER_ANTE);
}

// Можно ли создать стол с такой суммой: целое число, кратно 1 000, не меньше взноса × 10.
export function entryAllowed(value: number, ante: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= lowestEntryFor(ante) &&
    value <= MAX_ENTRY &&
    value % ENTRY_STEP === 0
  );
}

// Все суммы кратны сотне: взнос кратен 100, половина кона для ДВА
// округляется вниз до сотни (RULES.md §11.4).
export const COIN_STEP = 100;

export type Declaration = 'РАЗ' | 'ДВА' | 'КОН';

// Базовый кон = число игроков × взнос (RULES.md §9.1).
export function baseKon(playerCount: number, ante: number): number {
  return playerCount * ante;
}

// Сколько стоит заявка при текущем коне: столько главный заберёт при победе
// и столько же положит в кон при поражении (до умножения на риск).
//
// РАЗ — весь кон (RULES.md §11.3).
// ДВА — половина кона, но только когда кон дорос до ×2 базового. Пока кон
// меньше ×2 базового, делить нечего: ДВА стоит весь кон, как и РАЗ (RULES.md §11.4).
// Пример: 5 × 100, кон 800 — меньше 1000, поэтому РАЗ и ДВА оба стоят 800.
// КОН — всегда базовый кон, сколько бы ни лежало (RULES.md §6.7, §11.6).
export function stakeFor(declaration: Declaration, kon: number, base: number): number {
  if (declaration === 'РАЗ') return kon;
  if (declaration === 'КОН') return base;
  if (kon >= 2 * base) {
    // Половина округляется вниз до сотни, чтобы в коне всегда оставалось
    // не меньше, чем забирает ДВА: кон 1500 → ДВА 700, в коне 800.
    return Math.floor(kon / 2 / COIN_STEP) * COIN_STEP;
  }
  return kon;
}

export type MainOutcome = {
  playerId: string;
  declaration: Declaration;
  won: boolean;
  // Множитель риска. Пока всегда 1 — спецкарты с риском ×2…×5 будут на этапе 7.
  risk: number;
};

export type Settlement = {
  // Изменение баланса главных: плюс — забрал из кона, минус — положил в кон.
  deltas: Record<string, number>;
  konAfter: number;
};

// Расчёт после раздачи. Все суммы считаются от кона на момент начала расчёта.
//
// Выиграл — забирает свою ставку из кона. Риск на выигрыш не влияет (§11.1).
// Проиграл — кладёт в кон ставку × риск (§11.2).
//
// Для двух РАЗ это даёт ровно то, что в правилах (§11.5):
//   один выиграл  → +кон победителю, −кон проигравшему, кон сохраняется;
//   оба проиграли → каждый кладёт полный кон, кон утраивается.
export function settleRound(
  mains: MainOutcome[],
  kon: number,
  base: number,
): Settlement {
  const deltas: Record<string, number> = {};
  let konAfter = kon;

  for (const m of mains) {
    const stake = stakeFor(m.declaration, kon, base);
    if (m.won) {
      deltas[m.playerId] = stake;
      konAfter -= stake;
    } else {
      const loss = stake * m.risk;
      deltas[m.playerId] = -loss;
      konAfter += loss;
    }
  }

  return { deltas, konAfter };
}

// Взнос со всех игроков. Доливают все или никто: если хотя бы у одного не хватает
// денег на взнос, доливка отключается у всех и кон остаётся как был (RULES.md §9.2).
export function collectAnte(
  balances: Record<string, number>,
  ante: number,
): { paid: Record<string, number>; total: number; brokePlayerIds: string[] } {
  const brokePlayerIds = Object.entries(balances)
    .filter(([, balance]) => balance < ante)
    .map(([playerId]) => playerId);

  const everyonePays = brokePlayerIds.length === 0;
  const paid: Record<string, number> = {};
  let total = 0;

  for (const playerId of Object.keys(balances)) {
    paid[playerId] = everyonePays ? ante : 0;
    total += paid[playerId];
  }

  return { paid, total, brokePlayerIds };
}

// С какого кона открывается заявка КОН (RULES.md §6.7).
export function konUnlockAt(base: number, threshold: number): number {
  return base * threshold;
}

// Открыт ли КОН при этом коне. Порог проверяется в каждой раздаче заново.
export function konAvailable(kon: number, base: number, threshold: number): boolean {
  return kon >= konUnlockAt(base, threshold);
}

// Самая дешёвая из заявок РАЗ и ДВА при этом коне — по ней решается, можно ли
// голосовать «продолжаем / делим» (RULES.md §12.2).
// При 4 игроках ДВА нет — только РАЗ. При 5+ — ДВА (с кона ×2 базового он вдвое
// дешевле РАЗ, до этого стоит столько же).
// КОН сюда намеренно не входит: по правилам заявка КОН голосованию не мешает.
export function cheapestStake(capacity: number, kon: number, base: number): number {
  return capacity === 4 ? stakeFor('РАЗ', kon, base) : stakeFor('ДВА', kon, base);
}

// Доливка после всеобщего ПАСа бессмысленна, если на РАЗ не хватает ни у кого: весь кон
// всё равно никто не может забрать (§9.2a, решение владельца правил). ДВА не в счёт.
// Смотрим на кон до доливки. Три ИЗЖОГИ — не касается, там доливаем как раньше.
export function refillPointless(
  reason: 'all_pass' | 'three_izzhoga',
  balances: number[],
  kon: number,
  base: number,
): boolean {
  if (reason !== 'all_pass') return false;
  const raz = stakeFor('РАЗ', kon, base);
  return balances.every((b) => b < raz);
}

// Кон никто не может взять: ни у кого не хватает даже на самую дешёвую заявку.
// Тогда голосуем: продолжаем или делим кон поровну (RULES.md §12.2).
export function nobodyCanPlay(balances: number[], cheapest: number): boolean {
  return balances.every((b) => b < cheapest);
}

// Делим кон поровну. Остаток — тому, кто за игру проиграл больше всех
// (то же правило, что при отключении, RULES.md §13). При равенстве — первому по месту.
export function splitKon(
  kon: number,
  players: { id: string; lost: number }[],
): { shares: Record<string, number>; perPlayer: number; remainder: number; remainderTo: string | null } {
  // Делить не между кем (ушёл последний) — кон никому не уходит.
  if (players.length === 0) return { shares: {}, perPlayer: 0, remainder: 0, remainderTo: null };
  const perPlayer = Math.floor(kon / players.length);
  const remainder = kon - perPlayer * players.length;

  const shares: Record<string, number> = {};
  for (const p of players) shares[p.id] = perPlayer;

  let remainderTo: string | null = null;
  if (remainder > 0) {
    const biggestLoser = players.reduce((a, b) => (b.lost > a.lost ? b : a));
    shares[biggestLoser.id] += remainder;
    remainderTo = biggestLoser.id;
  }

  return { shares, perPlayer, remainder, remainderTo };
}

// Комната начинает доигрывать последний кон, как только у кого-то баланс
// опустился ниже базового кона (RULES.md §12).
export function someoneBelowBase(balances: number[], base: number): boolean {
  return balances.some((b) => b < base);
}
