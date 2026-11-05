// Проверки shah/rooms.ts — настройки комнаты ШАХ, монеты матча, ход по таймеру, бот (этап 2).

import { check, section } from './check.js';
import { createShahDeck } from '../src/shah/cards.js';
import { awaitedOf, createMatch, startParty, act } from '../src/shah/engine.js';
import {
  botAction,
  checkShahSettings,
  cheapest,
  matchDeltas,
  maxLoss,
  potPayouts,
  resultByLeaver,
  resultByTotals,
  seatOutcomes,
  timeoutAction,
} from '../src/shah/rooms.js';
import { beat, cards, closed, dealerDeckFor, ids, lead, PLAYERS, seeded, setup, shuffled } from './shah-helpers.js';

section('ШАХ: настройки комнаты');
const ok = checkShahSettings({ capacity: 4, ante: 300 });
check('4 игрока, взнос 300 — можно; без остального — 1 минута, 20 с, без ограничения', ok, {
  ok: true,
  capacity: 4,
  settings: { ante: 300, absenceMinutes: 1, turnSeconds: 20, timeLimitMinutes: null },
  isPublic: false,
});
check('игроков 2, 3, 4, 6 — можно', [2, 3, 4, 6].map((n) => checkShahSettings({ capacity: n, ante: 100 }).ok), [true, true, true, true]);
check('5 игроков — нельзя', checkShahSettings({ capacity: 5, ante: 100 }).ok, false);
check('взнос 50, 1100, 150 — нельзя', [50, 1100, 150].map((a) => checkShahSettings({ capacity: 2, ante: a }).ok), [false, false, false]);
check('взнос 100 и 1000 — можно', [100, 1000].map((a) => checkShahSettings({ capacity: 2, ante: a }).ok), [true, true]);
check('ожидание 1…5 минут', [0, 1, 5, 6].map((m) => checkShahSettings({ capacity: 2, ante: 100, absenceMinutes: m }).ok), [false, true, true, false]);
check('время на ход 20 или 40', [20, 30, 40].map((s) => checkShahSettings({ capacity: 2, ante: 100, turnSeconds: s }).ok), [true, false, true]);
check('время игры 15…180 или без ограничения', [10, 15, 180, 200, null].map((t) => checkShahSettings({ capacity: 2, ante: 100, timeLimitMinutes: t }).ok), [false, true, true, false, true]);
check('открытая комната', (checkShahSettings({ capacity: 2, ante: 100, isPublic: true }) as { isPublic: boolean }).isPublic, true);

section('ШАХ: монеты матча — «а» ставка на матч');
check('сесть — нужно иметь взнос', maxLoss(6, 500, 'pot'), 500);
check('двое: победитель +взнос, проигравший −взнос', matchDeltas(2, 100, 'pot', ['win', 'lose']), [100, -100]);
check('2 на 2: команда победителей по +взносу', matchDeltas(4, 200, 'pot', ['win', 'lose', 'win', 'lose']), [200, -200, 200, -200]);
check('3 на 3: тоже по +взносу', matchDeltas(6, 100, 'pot', ['lose', 'win', 'lose', 'win', 'lose', 'win']), [-100, 100, -100, 100, -100, 100]);
check('трое, один проиграл: двое делят банк — по +½ взноса', matchDeltas(3, 100, 'pot', ['lose', 'win', 'win']), [-100, 50, 50]);
check('трое, «ни то ни другое» забирает свой взнос', matchDeltas(3, 300, 'pot', ['lose', 'none', 'win']), [-300, 0, 300]);
check('ничья — всем взнос назад', matchDeltas(4, 100, 'pot', seatOutcomes(4, null)), [0, 0, 0, 0]);
check('выплаты из банка: трое, двое победителей — 150 и 150', potPayouts(3, 100, ['lose', 'win', 'win']), [0, 150, 150]);
check('банк делится без остатка и без лишнего', potPayouts(6, 700, ['win', 'lose', 'win', 'lose', 'win', 'lose']).reduce((a, b) => a + b, 0), 4200);

section('ШАХ: монеты матча — «б» проигравший платит');
check('двое: сесть — взнос', maxLoss(2, 100, 'loserPays'), 100);
check('трое: проиграть можно двоим — 2 взноса', maxLoss(3, 100, 'loserPays'), 200);
check('2 на 2 — 2 взноса, 3 на 3 — 3', [maxLoss(4, 100, 'loserPays'), maxLoss(6, 100, 'loserPays')], [200, 300]);
check('трое, один проиграл — платит каждому по взносу', matchDeltas(3, 100, 'loserPays', ['lose', 'win', 'win']), [-200, 100, 100]);
check('2 на 2 — каждый проигравший каждому победителю', matchDeltas(4, 100, 'loserPays', ['win', 'lose', 'win', 'lose']), [200, -200, 200, -200]);

section('ШАХ: итог по времени — вопрос 18 «а»; ушёл — вопрос 19 «а»');
check('время вышло: −4 против −10 — выиграла сторона с −4', resultByTotals([-10, -4]), ['lose', 'win']);
check('поровну — ничья', resultByTotals([-6, -6]), null);
check('трое: −2, −2, −8 — двое выиграли', resultByTotals([-2, -2, -8]), ['win', 'win', 'lose']);
check('ушёл игрок места 1 при 2 на 2 — проиграла его команда', resultByLeaver(4, [1]), ['win', 'lose']);
check('ушёл один из троих — двое других выиграли', resultByLeaver(3, [2]), ['win', 'win', 'lose']);
check('итог сторон → итог мест (3 на 3)', seatOutcomes(6, ['lose', 'win']), ['lose', 'win', 'lose', 'win', 'lose', 'win']);

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
