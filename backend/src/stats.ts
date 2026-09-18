// Статистика игрока — за комнату (ТЗ §35) и за всё время в профиле (ТЗ §2). Этап 9.4.
// Чистые функции: комната копит статистику по ходу игры, профиль складывает комнаты.

export type PlayerStats = {
  deals: number; // сыгранные партии: раздачи, где кто-то играл главным (пустые не в счёт)
  mains: number; // сколько раз был главным
  wins: number; // побед главным
  losses: number; // поражений главным
  raz: number; // играл РАЗ (и спецкарту — она играется как РАЗ)
  dva: number; // играл ДВА
  kon: number; // играл КОН
  garba: number; // ГАРБА (только РАЗ и КОН — §8)
  coinsWon: number; // сколько монет пришло за столом: выигрыши главным, доли кона
  coinsLost: number; // сколько ушло за столом: взносы и проигрыши главным
  maxWin: number; // самый большой выигрыш за одну партию
  maxRisk: number; // самый большой риск, на котором выиграл главным; 0 — не выигрывал
};

export function emptyStats(): PlayerStats {
  return {
    deals: 0, mains: 0, wins: 0, losses: 0, raz: 0, dva: 0, kon: 0, garba: 0,
    coinsWon: 0, coinsLost: 0, maxWin: 0, maxRisk: 0,
  };
}

// Движение денег за столом: плюс — пришло, минус — ушло.
// Бонусы и подарки сюда не попадают — это не игра.
export function addMoney(s: PlayerStats, delta: number): PlayerStats {
  if (delta > 0) return { ...s, coinsWon: s.coinsWon + delta };
  if (delta < 0) return { ...s, coinsLost: s.coinsLost - delta };
  return s;
}

export type MainOutcome = {
  declaration: 'РАЗ' | 'ДВА' | 'КОН';
  won: boolean;
  delta: number;
  garba: boolean;
  risk: number;
};

// Сыгранная партия. main — если игрок был главным в ней, иначе он играл против.
export function addDeal(s: PlayerStats, main: MainOutcome | null): PlayerStats {
  const next = { ...s, deals: s.deals + 1 };
  if (!main) return next;

  next.mains += 1;
  if (main.declaration === 'РАЗ') next.raz += 1;
  if (main.declaration === 'ДВА') next.dva += 1;
  if (main.declaration === 'КОН') next.kon += 1;
  if (main.garba) next.garba += 1;

  if (main.won) {
    next.wins += 1;
    next.maxWin = Math.max(next.maxWin, main.delta);
    next.maxRisk = Math.max(next.maxRisk, main.risk);
  } else {
    next.losses += 1;
  }
  return next;
}

// Лучший результат комнаты (§36): у кого больше всех прибавилось за игру.
// Ничья — победителей несколько. Никто не в плюсе — победителя нет.
export function roomWinners(results: { id: string; diff: number }[]): string[] {
  const best = Math.max(...results.map((r) => r.diff));
  if (!(best > 0)) return [];
  return results.filter((r) => r.diff === best).map((r) => r.id);
}
