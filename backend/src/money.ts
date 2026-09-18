// Деньги: кон, взносы, стоимость заявок, расчёт после раздачи.
// Только чистые функции. Правила — RULES.md §9, §11, §12.

export const MIN_ANTE = 100;
export const MAX_ANTE = 1000;
export const MIN_EMPTY_LIMIT = 3;
export const MAX_EMPTY_LIMIT = 10;

// Порог КОН — во сколько раз кон должен превысить базовый (RULES.md §6.7).
export const MIN_KON_THRESHOLD = 3;
export const MAX_KON_THRESHOLD = 10;

// Минимальный баланс для входа в комнату (RULES.md §9.1a):
// 1 000 … 10 000 шагом 1 000, но не меньше взноса × 10.
export const MIN_ENTRY = 1000;
export const MAX_ENTRY = 10_000;
export const ENTRY_STEP = 1000;
export const ENTRY_PER_ANTE = 10;

export function lowestEntryFor(ante: number): number {
  return Math.max(MIN_ENTRY, ante * ENTRY_PER_ANTE);
}

// Все суммы кратны сотне: взнос кратен 100, половина кона для ДВА
// округляется вниз до сотни (RULES.md §11.4).
export const COIN_STEP = 100;

export type Declaration = 'РАЗ' | 'ДВА';

// Базовый кон = число игроков × взнос (RULES.md §9.1).
export function baseKon(playerCount: number, ante: number): number {
  return playerCount * ante;
}

// Сколько стоит заявка при текущем коне: столько главный заберёт при победе
// и столько же положит в кон при поражении (до умножения на риск).
//
// РАЗ — весь кон (RULES.md §11.3).
// ДВА — весь кон, пока он базовый; половина, когда кон вырос (RULES.md §11.4).
export function stakeFor(declaration: Declaration, kon: number, base: number): number {
  if (declaration === 'РАЗ') return kon;
  if (kon > base) {
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

// С какого кона открывается заявка КОН (RULES.md §6.7). Сама заявка — этап 6.
export function konUnlockAt(base: number, threshold: number): number {
  return base * threshold;
}

// Самая дешёвая заявка при этом коне. При 4 игроках ДВА нет — только РАЗ.
// При 5+ — ДВА (при выросшем коне он вдвое дешевле РАЗ).
// Когда появится КОН (этап 6), он тоже должен попасть сюда — см. RULES.md §14.
export function cheapestStake(capacity: number, kon: number, base: number): number {
  if (capacity === 4) return stakeFor('РАЗ', kon, base);
  return stakeFor('ДВА', kon, base);
}

// Кон никто не может взять: ни у кого не хватает даже на самую дешёвую заявку.
// Тогда комната закрывается и кон делится поровну (RULES.md §12.2).
export function nobodyCanPlay(balances: number[], cheapest: number): boolean {
  return balances.every((b) => b < cheapest);
}

// Делим кон поровну. Остаток — тому, кто за игру проиграл больше всех
// (то же правило, что при отключении, RULES.md §13). При равенстве — первому по месту.
export function splitKon(
  kon: number,
  players: { id: string; lost: number }[],
): { shares: Record<string, number>; perPlayer: number; remainder: number; remainderTo: string | null } {
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
