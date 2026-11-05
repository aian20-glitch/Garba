// Проверки shah/rooms.ts — настройки комнаты ШАХ, монеты матча, ход по таймеру, бот (этап 2).

import { check, section } from './check.js';
import { createShahDeck } from '../src/shah/cards.js';
import { awaitedOf, createMatch, nextMatch, startParty, act } from '../src/shah/engine.js';
import {
  anteRange,
  botAction,
  castMoreVote,
  checkShahSettings,
  cheapest,
  forfeitSplit,
  matchDeltas,
  maxLoss,
  moreVoteOutcome,
  potPayouts,
  resultByLeaver,
  seatOutcomes,
  tableTotals,
  timeoutAction,
} from '../src/shah/rooms.js';
import { openDb } from '../src/accounts.js';
import { ensureShahTables, shahStatsOf } from '../src/shah/db.js';
import { beat, cards, closed, dealerDeckFor, ids, lead, PLAYERS, seeded, setup, shuffled } from './shah-helpers.js';

section('ШАХ: настройки комнаты');
const ok = checkShahSettings({ capacity: 4, ante: 15_000 });
check('2×2, взнос 15 000 — можно; без остального — 1 минута, 20 с, 3 партии', ok, {
  ok: true,
  capacity: 4,
  settings: { ante: 15_000, absenceMinutes: 1, turnSeconds: 20, matches: 3 },
  isPublic: false,
});
check('игроков 2, 3, 4, 6 — можно', [2, 3, 4, 6].map((n) => checkShahSettings({ capacity: n, ante: anteRange(n as 2).min }).ok), [true, true, true, true]);
check('5 игроков — нельзя', checkShahSettings({ capacity: 5, ante: 1000 }).ok, false);

section('ШАХ: взнос — вопрос 17 (владелец 05.11.2026)');
check('командная игра (2×2, 3×3) — 10 000…20 000', [anteRange(4), anteRange(6)], [{ min: 10_000, max: 20_000 }, { min: 10_000, max: 20_000 }]);
check('1×1 и 1×1×1 — 1 000…10 000', [anteRange(2), anteRange(3)], [{ min: 1_000, max: 10_000 }, { min: 1_000, max: 10_000 }]);
check('2×2: 9 000 и 21 000 — нельзя, 10 000 и 20 000 — можно',
  [9_000, 21_000, 10_000, 20_000].map((a) => checkShahSettings({ capacity: 4, ante: a }).ok), [false, false, true, true]);
check('1×1: 500 и 11 000 — нельзя, 1 000 и 10 000 — можно',
  [500, 11_000, 1_000, 10_000].map((a) => checkShahSettings({ capacity: 2, ante: a }).ok), [false, false, true, true]);
check('1×1×1: взнос 10 000 можно, а у 3×3 1 000 — нельзя',
  [checkShahSettings({ capacity: 3, ante: 10_000 }).ok, checkShahSettings({ capacity: 6, ante: 1_000 }).ok], [true, false]);
check('шаг 1 000: 1 500 нельзя', checkShahSettings({ capacity: 2, ante: 1_500 }).ok, false);
check('ошибка говорит, сколько можно', checkShahSettings({ capacity: 6, ante: 5_000 }), { ok: false, error: 'bad ante', min: 10_000, max: 20_000 });

section('ШАХ: сколько партий — вопрос 18 (владелец 05.11.2026)');
check('партий 1…30', [0, 1, 30, 31, 2.5].map((m) => checkShahSettings({ capacity: 2, ante: 1000, matches: m }).ok), [false, true, true, false, false]);
check('ошибка — с пределами', checkShahSettings({ capacity: 2, ante: 1000, matches: 40 }), { ok: false, error: 'bad matches', min: 1, max: 30 });
check('времени игры у ШАХ нет — timeLimitMinutes не читается', (checkShahSettings({ capacity: 2, ante: 1000, matches: 5, timeLimitMinutes: 15 }) as { settings: object }).settings,
  { ante: 1000, absenceMinutes: 1, turnSeconds: 20, matches: 5 });
check('ожидание 1…5 минут', [0, 1, 5, 6].map((m) => checkShahSettings({ capacity: 2, ante: 1000, absenceMinutes: m }).ok), [false, true, true, false]);
check('время на ход 20 или 40', [20, 30, 40].map((s) => checkShahSettings({ capacity: 2, ante: 1000, turnSeconds: s }).ok), [true, false, true]);
check('открытая комната', (checkShahSettings({ capacity: 2, ante: 1000, isPublic: true }) as { isPublic: boolean }).isPublic, true);

section('ШАХ: «ещё 3 партии?» — все «да», одно «нет» или 30 с — стол закрыт');
{
  const v0 = { startedAt: 0, yesIds: [] as string[], noIds: [] as string[] };
  check('никто не ответил — ждём', moreVoteOutcome(v0, ['A', 'B'], 10_000), 'wait');
  const a = castMoreVote(v0, ['A', 'B'], 'A', 'yes');
  check('A «да»', a.ok, true);
  const v1 = (a as { vote: typeof v0 }).vote;
  check('один «да», второй молчит — ждём', moreVoteOutcome(v1, ['A', 'B'], 10_000), 'wait');
  check('все «да» — ещё 3', moreVoteOutcome((castMoreVote(v1, ['A', 'B'], 'B', 'yes') as { vote: typeof v0 }).vote, ['A', 'B'], 10_000), 'approved');
  check('одно «нет» — нет', moreVoteOutcome((castMoreVote(v1, ['A', 'B'], 'B', 'no') as { vote: typeof v0 }).vote, ['A', 'B'], 10_000), 'rejected');
  check('30 с прошли — нет', moreVoteOutcome(v1, ['A', 'B'], 30_000), 'expired');
  check('второй раз голосовать нельзя', castMoreVote(v1, ['A', 'B'], 'A', 'no'), { ok: false, error: 'already voted' });
  check('бот (не голосующий) — нельзя', castMoreVote(v0, ['A'], 'BOT', 'yes'), { ok: false, error: 'you do not vote on this' });
  check('не yes/no — нельзя', castMoreVote(v0, ['A'], 'A', 'maybe'), { ok: false, error: 'bad choice' });
}

section('ШАХ: монеты партии — взнос за каждую партию, банк выигравшим (вопрос 17)');
check('сесть — нужно иметь взнос', maxLoss(6, 15_000, 'pot'), 15_000);
check('1×1: выигравший +взнос, проигравший −взнос', matchDeltas(2, 1000, 'pot', ['win', 'lose']), [1000, -1000]);
check('2×2: команда выигравших по +взносу', matchDeltas(4, 10_000, 'pot', ['win', 'lose', 'win', 'lose']), [10_000, -10_000, 10_000, -10_000]);
check('3×3: тоже по +взносу', matchDeltas(6, 20_000, 'pot', ['lose', 'win', 'lose', 'win', 'lose', 'win']), [-20_000, 20_000, -20_000, 20_000, -20_000, 20_000]);
check('1×1×1, один проиграл: двое делят банк — по +½ взноса', matchDeltas(3, 1000, 'pot', ['lose', 'win', 'win']), [-1000, 500, 500]);
check('1×1×1, «ни то ни другое» забирает свой взнос', matchDeltas(3, 3000, 'pot', ['lose', 'none', 'win']), [-3000, 0, 3000]);
check('ничья — всем взнос назад', matchDeltas(4, 10_000, 'pot', seatOutcomes(4, null)), [0, 0, 0, 0]);
check('выплаты из банка: трое, двое победителей — 1 500 и 1 500', potPayouts(3, 1000, ['lose', 'win', 'win']), [0, 1500, 1500]);
check('банк делится без остатка и без лишнего', potPayouts(6, 17_000, ['win', 'lose', 'win', 'lose', 'win', 'lose']).reduce((a, b) => a + b, 0), 102_000);

section('ШАХ: монеты матча — «б» проигравший платит (не выбран)');
check('двое: сесть — взнос', maxLoss(2, 1000, 'loserPays'), 1000);
check('трое: проиграть можно двоим — 2 взноса', maxLoss(3, 1000, 'loserPays'), 2000);
check('трое, один проиграл — платит каждому по взносу', matchDeltas(3, 1000, 'loserPays', ['lose', 'win', 'win']), [-2000, 1000, 1000]);

section('ШАХ: ушёл — вопрос 19 (владелец 05.11.2026)');
check('2×2: ушёл игрок места 1 — проиграла его команда (банк — другой)', resultByLeaver(4, [1]), ['win', 'lose']);
check('1×1×1: ушёл один — двое других делят банк пополам', matchDeltas(3, 2000, 'pot', seatOutcomes(3, resultByLeaver(3, [2]))), [1000, 1000, -2000]);
check('1×1: ушёл — теряет свой взнос', matchDeltas(2, 5000, 'pot', seatOutcomes(2, resultByLeaver(2, [0]))), [-5000, 5000]);
check('3×3: ушёл один — вся его команда теряет взнос', matchDeltas(6, 10_000, 'pot', seatOutcomes(6, resultByLeaver(6, [3]))),
  [10_000, -10_000, 10_000, -10_000, 10_000, -10_000]);
check('итог сторон → итог мест (3 на 3)', seatOutcomes(6, ['lose', 'win']), ['lose', 'win', 'lose', 'win', 'lose', 'win']);

section('ШАХ: ушёл между партиями — следующая засчитана проигранной («бан + проигрыш»)');
check('2×2: проигравшие платят взнос, выигравшие получают по взносу',
  forfeitSplit(['win', 'lose', 'win', 'lose'], [0, 10_000, 0, 10_000]), [10_000, -10_000, 10_000, -10_000]);
check('1×1×1: ушедший платит взнос, двое — пополам', forfeitSplit(['win', 'win', 'lose'], [0, 0, 3000]), [1500, 1500, -3000]);
check('у проигравшего меньше взноса — сколько есть', forfeitSplit(['lose', 'win'], [700, 0]), [-700, 700]);
check('нечётный остаток — первому выигравшему', forfeitSplit(['win', 'win', 'lose'], [0, 0, 1001]), [501, 500, -1001]);
check('сумма — ноль: монеты не берутся из ниоткуда', forfeitSplit(['lose', 'win', 'lose', 'win', 'lose', 'win'], [10_000, 0, 3_000, 0, 10_000, 0]).reduce((a, b) => a + b, 0), 0);

section('ШАХ: итог стола — все партии вместе');
check('монеты, выигранные и проигранные партии',
  tableTotals(['A', 'B'], [
    { outcomes: { A: 'win', B: 'lose' }, deltas: { A: 1000, B: -1000 } },
    { outcomes: { A: 'lose', B: 'win' }, deltas: { A: -1000, B: 1000 } },
    { outcomes: { A: 'win', B: 'lose' }, deltas: { A: 1000, B: -1000 } },
  ]),
  { coins: { A: 1000, B: -1000 }, wins: { A: 2, B: 1 }, losses: { A: 1, B: 2 } });

section('ШАХ: следующая партия за тем же столом');
{
  const random = seeded(77);
  let m = startParty(createMatch(PLAYERS.slice(0, 2), dealerDeckFor(1)), shuffled(createShahDeck(), random));
  while (!m.over) {
    while (m.party!.phase !== 'done') {
      const aw = awaitedOf(m)!;
      const r = act(m, aw.playerId, botAction(m, aw.playerId)!);
      if (!r.ok) throw new Error(r.error);
      m = r.match;
    }
    if (!m.over) m = startParty(m, shuffled(createShahDeck(), random));
  }
  const n = nextMatch(m);
  check('счёт с нуля, множитель ×1, раздач нет', [n.totals, n.multiplier, n.history.length, n.over, n.result], [[0, 0], 1, 0, false, null]);
  check('сдающий — тот, кого назначила прошлая (§5), без вскрытия на туза', [n.dealerSeat, n.firstDealer.reveals.length], [m.dealerSeat, 0]);
  check('первая раздача новой партии — №1', startParty(n, shuffled(createShahDeck(), random)).party!.number, 1);
  let threw = false;
  try {
    nextMatch(n);
  } catch {
    threw = true;
  }
  check('из неоконченной партии следующую не начать', threw, true);
}

section('ШАХ: статистика — старые строки (один матч на стол) переносятся');
{
  const db = openDb(':memory:');
  db.exec(`CREATE TABLE shah_results (room_id TEXT NOT NULL, player_id TEXT NOT NULL, format INTEGER NOT NULL, outcome TEXT NOT NULL,
    coins INTEGER NOT NULL, parties INTEGER NOT NULL, skill_before REAL NOT NULL, skill_after REAL NOT NULL, active_ms INTEGER NOT NULL,
    finished_at INTEGER NOT NULL, PRIMARY KEY (room_id, player_id))`);
  db.exec(`INSERT INTO shah_results VALUES ('1', 'P', 2, 'win', 100, 9, 4, 4.1, 0, 0), ('2', 'P', 2, 'lose', -100, 7, 4.1, 4, 0, 0)`);
  ensureShahTables(db);
  check('2 стола по одному матчу: партий 2, побед 1, поражений 1', shahStatsOf(db, 'P'), { matches: 2, wins: 1, losses: 1, parties: 16, coins: 0 });
}

section('ШАХ: ход по таймеру — вопрос 24 «а»');
{
  // Двое, козырь ♠: у A 10♠ 6♣ 9♥ 7♦ 8♦ 9♦ — самая слабая без очков и не козырь — 7♦.
  const H = [cards('10♠ 6♣ 9♥ 7♦ 8♦ 9♦'), cards('A♠ K♠ A♥ 7♣ J♦ Q♦')];
  const rest = [cards('7♠')[0], ...createShahDeck().filter((c) => ![...H.flat(), ...cards('7♠')].some((x) => x.id === c.id))];
  let m = setup(2, H, rest);
  check('заход за игрока — самая слабая карта 7♦', timeoutAction(m), { playerId: 'A', action: { type: 'lead', cardIds: ['diamonds-7'] } });
  check('ШАХ и козыри отдаются последними', ids(cheapest(cards('6♣ 10♠ 7♦ A♥'), 4, 'spades')), ['diamonds-7', 'spades-10', 'hearts-A', 'clubs-6']);
  m = lead(m, 'A', '9♥');
  check('бить за игрока не бьёт — рубашкой самую дешёвую', timeoutAction(m), { playerId: 'B', action: { type: 'closed', cardIds: ['clubs-7'] } });
}

section('ШАХ: бот-тренировка');
{
  const H = [cards('10♠ 6♣ 9♥ 7♦ 8♦ 9♦'), cards('A♠ K♠ A♥ 7♣ J♦ Q♦')];
  const rest = [cards('7♠')[0], ...createShahDeck().filter((c) => ![...H.flat(), ...cards('7♠')].some((x) => x.id === c.id))];
  let m = setup(2, H, rest);
  check('бот не ходит не в свою очередь', botAction(m, 'B'), null);
  m = lead(m, 'A', '9♥');
  check('без козыря отбиться можно (Т♥ на 9♥) — бьёт', botAction(m, 'B'), { type: 'beat', cardIds: ['hearts-A'] });
  let n = setup(2, H, rest);
  n = lead(n, 'A', '7♦');
  check('на 7♦ — бьёт валетом бубен, а не козырем', botAction(n, 'B'), { type: 'beat', cardIds: ['diamonds-J'] });
  let t = setup(2, H, rest);
  t = lead(t, 'A', '10♠');
  check('козырную 10♠ (10 очков) — бьёт тузом козырей', botAction(t, 'B'), { type: 'beat', cardIds: ['spades-A'] });
  t = beat(t, 'B', 'A♠');
  check('ШАХ на 21 очко на столе — тратит', botAction(t, 'A'), { type: 'beat', cardIds: ['clubs-6'] });
  // Напарника не перебивает: 4 игрока, A зашёл, B не бьёт, C — напарник A.
  const H4 = [cards('9♠ 7♠ 8♠ 6♠ J♠ Q♠'), cards('6♣ 7♣ 8♣ 9♣ J♣ Q♣'), cards('6♦ 7♦ 8♦ 9♦ J♦ Q♦'), cards('6♥ 7♥ 8♥ 9♥ J♥ Q♥')];
  const R4 = cards('K♥ K♠ 10♠ A♠ K♣ 10♣ A♣ K♦ 10♦ A♦ 10♥ A♥');
  let four = setup(4, H4, R4);
  four = closed(lead(four, 'A', '9♠'), 'B', '7♣');
  check('C (напарник A) не бьёт своего — рубашкой', botAction(four, 'C')?.type, 'closed');
  check('D бьёт козырем ♥: на столе 0 очков — не тратит козырь', botAction(closed(four, 'C', '6♦'), 'D')?.type, 'closed');
}

section('ШАХ: таймер и боты доигрывают партию до конца');
for (const format of [2, 3, 4, 6] as const) {
  const random = seeded(format * 7);
  let m = startParty(createMatch(PLAYERS.slice(0, format), dealerDeckFor(format - 1)), shuffled(createShahDeck(), random));
  let steps = 0;
  let bad = 0;
  while (m.party!.phase !== 'done' && steps++ < 500) {
    const aw = awaitedOf(m)!;
    const move = steps % 2 === 0 ? timeoutAction(m)!.action : botAction(m, aw.playerId)!;
    const r = act(m, aw.playerId, move);
    if (!r.ok) bad++;
    else m = r.match;
  }
  check(`${format}: ходы таймера и бота всегда разрешены, партия доиграна`, [bad, m.party!.phase, m.party!.result!.points.reduce((a, b) => a + b, 0)], [0, 'done', 120]);
}
