// Сумма за стол (решение владельца, 09.10.2026). Входя в комнату, игрок выбирает, сколько
// монет взять с собой: от минимума комнаты до всего баланса. За столом он играет только
// ими (заявки, «обеднел» §12.1 — всё по сумме за столом), остальное лежит в запасе
// (players[].reserve) и в игре не участвует. Докупить нельзя. Бонус и подарок за столом
// идут в запас. В аккаунт всегда пишется сумма за столом + запас. Чистые функции.

export type BuyInResult =
  | { ok: true; amount: number }
  | { ok: false; status: 400 | 403; error: 'bad buyIn' | 'not enough coins to enter' };

// raw — что прислал клиент. Нет поля — берём весь баланс (так было до 09.10.2026,
// и так входят старые версии приложения и боты).
export function checkBuyIn(raw: unknown, balance: number, minBalance: number): BuyInResult {
  if (balance < minBalance) return { ok: false, status: 403, error: 'not enough coins to enter' };
  if (raw === undefined || raw === null) return { ok: true, amount: balance };
  const amount = Number(raw);
  if (!Number.isInteger(amount) || amount < minBalance || amount > balance) {
    return { ok: false, status: 400, error: 'bad buyIn' };
  }
  return { ok: true, amount };
}
