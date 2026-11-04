// Проверки еженедельного турнира (RULES.md §19): tournament.ts и журнал денег tournamentDb.ts.
// Примеры — из задания владельца (28.10 и 31.10.2026). Запуск: npm test

import { check, section } from './check.js';
import { createAccount, getAccount, openDb, transaction } from '../src/accounts.js';
import {
  compareListed,
  compareStandings,
  ENTRY_FEE,
  eliminatedIds,
  lastCallPhase,
  nextWeeklyStartAt,
  payouts,
  rankStandings,
  selectFinalists,
  tableEndReason,
  tableSizes,
  TABLE_BONUS,
  tournamentIdFor,
  tournamentRating,
  weeklyRegistrationOpen,
  weeklyStartAt,
  winnerBanner,
  winsBadge,
  type ListedEntry,
  type Standing,
} from '../src/tournament.js';
import {
  addEntry,
  addTable,
  createTournament,
  entriesOf,
  entryOf,
  ledgerAdd,
  ledgerOf,
  moveEntry,
  moveTable,
  moveTournament,
  getTournament,
  rateEntry,
  tablesOf,
  treasuryOf,
} from '../src/tournamentDb.js';

const H = 3_600_000;
const st = (id: string, balance: number, more: Partial<Standing> = {}): Standing => ({
  id,
  balance,
  razWins: 0,
  dvaWins: 0,
  maxRisk: 0,
  registeredAt: 0,
  ...more,
});

section('турнир: расписание — понедельник 20:00 по Казахстану (§19.1)');
// Понедельник 02.11.2026 20:00 UTC+5 = 15:00 UTC.
const mon = Date.UTC(2026, 10, 2, 15, 0, 0);
check('в понедельник 20:00 — начало этой недели', weeklyStartAt(mon), mon);
check('в понедельник 19:59 — ещё прошлая неделя', weeklyStartAt(mon - 60_000), mon - 7 * 24 * H);
check('в воскресенье 23:00 — с прошлого понедельника', weeklyStartAt(mon + 6 * 24 * H + 3 * H), mon);
check('имя турнира — дата понедельника', tournamentIdFor(mon), '2026-11-02');
check('следующий — через неделю', nextWeeklyStartAt(mon + H), mon + 7 * 24 * H);
check('регистрация открыта 24 часа', [weeklyRegistrationOpen(mon), weeklyRegistrationOpen(mon + 23 * H), weeklyRegistrationOpen(mon + 24 * H)], [true, true, false]);

section('турнир: столы отбора — как можно больше, как можно ровнее (§19.3)');
check('7 участников — турнира нет', tableSizes(7), []);
check('8 → 4+4', tableSizes(8), [4, 4]);
check('9 → 4+5', tableSizes(9), [4, 5]);
check('10 → 5+5', tableSizes(10), [5, 5]);
check('11 → 5+6', tableSizes(11), [5, 6]);
check('12 → 4+4+4', tableSizes(12), [4, 4, 4]);
check('13 → 4+4+5', tableSizes(13), [4, 4, 5]);
check('14 → 4+5+5', tableSizes(14), [4, 5, 5]);
check('15 → 5+5+5', tableSizes(15), [5, 5, 5]);
check('16 → 4+4+4+4', tableSizes(16), [4, 4, 4, 4]);
check('17 → 4+4+4+5', tableSizes(17), [4, 4, 4, 5]);
check('25 → 4+4+4+4+4+5', tableSizes(25), [4, 4, 4, 4, 4, 5]);
check('40 → десять столов по 4', tableSizes(40), Array(10).fill(4));
const allOk = Array.from({ length: 300 }, (_, i) => i + 8).every((n) => {
  const s = tableSizes(n);
  return s.reduce((a, b) => a + b, 0) === n && s.every((x) => x >= 4 && x <= 7) && Math.max(...s) - Math.min(...s) <= 1;
});
check('8…307 участников: всех рассадили, за столом 4–7, разница не больше 1', allOk, true);

section('турнир: выбывание и конец стола (§19.4)');
check('меньше 100 — выбыл, 100 — играет', eliminatedIds([{ id: 'a', balance: 0 }, { id: 'b', balance: 99 }, { id: 'c', balance: 100 }], 100), ['a', 'b']);
check('6 игроков, 39 минут — играем', tableEndReason(6, 6, 0, 39 * 60_000), null);
check('выбыл один — 5 — играем', tableEndReason(5, 5, 0, 10), null);
check('ещё один — 4 — играем', tableEndReason(4, 4, 0, 10), null);
check('осталось 3 — стол заканчивается', tableEndReason(3, 3, 0, 10), 'three_left');
check('прошло ровно 40 минут — стол заканчивается', tableEndReason(5, 5, 0, 40 * 60_000), 'time_up');
check('одни боты — стол заканчивается', tableEndReason(4, 0, 0, 10), 'no_humans');

section('турнир: последний шанс за 50 мин (§19.5)');
const end = 100 * H;
check('за 51 мин — обычный сбор', lastCallPhase(end - 51 * 60_000, end), 'wait');
check('за 50 мин — последние 10 минут', lastCallPhase(end - 50 * 60_000, end), 'last_call');
check('за 41 мин — ещё последние 10 минут', lastCallPhase(end - 41 * 60_000, end), 'last_call');
check('за 40 минут — старт с ботами', lastCallPhase(end - 40 * 60_000, end), 'launch');

section('турнир: финалисты (§19.7)');
// Пример владельца: стол из 5 — 20 000, 15 000, 9 000, 6 000, 0.
const table1 = [st('p1', 20_000), st('p2', 15_000), st('p3', 9_000), st('p4', 6_000), st('p5', 0)];
const table2 = [st('q1', 30_000), st('q2', 12_000), st('q3', 5_000), st('q4', 3_000)];
const f1 = selectFinalists([...table1, ...table2]);
check('больше 10 000 — в финале: q1, p1, p2, q2', f1.finalists.map((s) => s.id), ['q1', 'p1', 'p2', 'q2']);
check('игрок с 9 000 не проходит автоматически', f1.out.some((s) => s.id === 'p3'), true);
check('ботов не нужно', f1.bots, 0);
check('с одного стола могут пройти двое, с другого — двое: квот нет',
  selectFinalists([st('a', 40_000), st('b', 30_000), st('c', 20_000), st('d', 15_000), st('e', 9_000), st('f', 1_000)]).finalists.map((s) => s.id),
  ['a', 'b', 'c', 'd']);
// Пример владельца: 22 000 … 11 000 — восемь подходящих, проходят семь.
const eight = [22_000, 19_000, 18_000, 16_000, 15_000, 14_000, 12_000, 11_000].map((b, i) => st(`x${i}`, b));
const f8 = selectFinalists(eight);
check('кандидатов 8 — проходят TOP 7', f8.finalists.length, 7);
check('игрок с 11 000 выбывает', f8.out.map((s) => s.balance), [11_000]);
const fewer = selectFinalists([st('a', 25_000), st('b', 18_000), st('c', 14_000), st('d', 9_500), st('e', 7_000), st('f', 50)]);
check('больше 10 000 только трое — четвёртым добирается 9 500', fewer.finalists.map((s) => s.id), ['a', 'b', 'c', 'd']);
check('добор только до 4', fewer.finalists.length, 4);
const poor = selectFinalists([st('a', 60_000), st('b', 19_900), st('c', 50), st('d', 0)]);
check('взнос платят только двое — в финале двое и два бота', [poor.finalists.map((s) => s.id), poor.bots], [['a', 'b'], 2]);
check('ровно 10 000 — не «больше 10 000», но добор берёт',
  selectFinalists([st('a', 10_000), st('b', 10_000), st('c', 10_000), st('d', 10_000), st('e', 10_000)]).finalists.length, 4);

section('турнир: ничья (§19.7)');
check('одинаковые монеты — больше побед на РАЗ выше',
  rankStandings([st('a', 15_000, { razWins: 1 }), st('b', 15_000, { razWins: 3 })]).map((s) => s.id), ['b', 'a']);
check('РАЗ поровну — больше побед на ДВА выше',
  rankStandings([st('a', 15_000, { razWins: 2, dvaWins: 0 }), st('b', 15_000, { razWins: 2, dvaWins: 1 })]).map((s) => s.id), ['b', 'a']);
check('и ДВА поровну — выше риск',
  rankStandings([st('a', 15_000, { maxRisk: 2 }), st('b', 15_000, { maxRisk: 5 })]).map((s) => s.id), ['b', 'a']);
check('всё совпало — кто раньше зарегистрировался',
  rankStandings([st('a', 15_000, { registeredAt: 20 }), st('b', 15_000, { registeredAt: 10 })]).map((s) => s.id), ['b', 'a']);
check('на границе 7-го места ничья решается так же',
  selectFinalists([...[30, 29, 28, 27, 26, 25].map((k, i) => st(`t${i}`, k * 1000)), st('late', 20_000, { registeredAt: 9 }), st('early', 20_000, { registeredAt: 1 })])
    .out.map((s) => s.id), ['late']);
check('порядок стабильный: сравнение симметрично', compareStandings(st('a', 1), st('b', 1)) === -compareStandings(st('b', 1), st('a', 1)), true);

section('турнир: порядок общего списка (§19.11, §19.13)');
{
  // Счёт отбора — razWins…; счёт финала — finalRazWins…; место — finalPlace (после конца турнира).
  const le = (id: string, status: string, balance: number, more: Partial<ListedEntry> = {}): ListedEntry => ({
    ...st(id, balance),
    status,
    finalPlace: null,
    finalRazWins: 0,
    finalDvaWins: 0,
    finalMaxRisk: 0,
    ...more,
  });
  const order = (list: ListedEntry[]) => [...list].sort(compareListed).map((e) => e.id);
  // Монеты поровну: у «a» больше побед на РАЗ в отборе, но «b» зарегистрировался раньше.
  const a = { razWins: 2, registeredAt: 20 };
  const b = { razWins: 0, registeredAt: 10 };
  check('финалисты до финала — по отбору (как их выбрали), а не по пустому счёту финала',
    order([le('b', 'finalist', 12_000, b), le('a', 'finalist', 12_000, a)]), ['a', 'b']);
  check('финал не сыгран: места по отбору — и в списке так же (одинаковые монеты)',
    order([le('b', 'final_done', 12_000, { ...b, finalPlace: 2 }), le('a', 'final_done', 12_000, { ...a, finalPlace: 1 })]), ['a', 'b']);
  check('финал сыгран, места розданы — по местам',
    order([le('a', 'final_done', 9_000, { ...a, finalPlace: 3 }), le('b', 'final_done', 9_000, { ...b, finalPlace: 2 }), le('c', 'final_done', 25_000, { finalPlace: 1 })]),
    ['c', 'b', 'a']);
  check('финал идёт — по счёту финала',
    order([le('a', 'final_playing', 14_000, a), le('b', 'final_playing', 14_000, { ...b, finalRazWins: 1 })]), ['b', 'a']);
  check('сверху финалисты, потом сыгравшие, потом не сыгравшие по регистрации, в конце остальные',
    order([
      le('refund', 'refunded', 10_000),
      le('late', 'registered', 10_000, { registeredAt: 9 }),
      le('early', 'registered', 10_000, { registeredAt: 1 }),
      le('out', 'out', 1_000),
      le('played', 'played', 8_000),
      le('fin', 'finalist', 11_000),
    ]),
    ['fin', 'played', 'out', 'early', 'late', 'refund']);
}

section('турнир: победитель и выплаты (§19.9)');
// Пример владельца: баланс победителя 42 000, казна 184 000 → 226 000.
const pay = payouts([st('w', 42_000), st('s', 20_000), st('z', 0)], 184_000);
check('победитель — больше всех монет', pay.winnerId, 'w');
check('победитель получает свой баланс + казну = 226 000', pay.payments.find((p) => p.id === 'w')?.amount, 226_000);
check('старого бонуса +100 000 нет', pay.payments.reduce((a, p) => a + p.amount, 0), 42_000 + 20_000 + 184_000);
check('остальные — свой оставшийся баланс, 0 — ничего', pay.payments.filter((p) => p.id !== 'w').map((p) => p.amount), [20_000, 0]);
check('ничья в финале — по победам на РАЗ', payouts([st('a', 30_000), st('b', 30_000, { razWins: 1 })], 0).winnerId, 'b');

section('турнир: рейтинг и значок (§19.10, §19.12)');
check('1-е +1.0, 2-е +0.5, 3-е +0.3, финалист +0.2, участник +0.1',
  [tournamentRating(1), tournamentRating(2), tournamentRating(3), tournamentRating(5), tournamentRating(null)], [1, 0.5, 0.3, 0.2, 0.1]);
check('значок: 1 → 🏆, 2 → 🏆×2, 10 → 🏆×10, 0 — нет', [winsBadge(1), winsBadge(2), winsBadge(10), winsBadge(0)], ['🏆', '🏆×2', '🏆×10', '']);
check('объявление: 1 победа', winnerBanner([0, 1]), 'В игре есть победитель турнира 🏆');
check('объявление: самый титулованный — 3 победы', winnerBanner([2, 3, 0]), 'В игре есть 3-кратный победитель турнира 🏆×3');
check('победителей нет — объявления нет', winnerBanner([0, 0]), null);

section('турнир: журнал денег — каждое движение один раз (§19.8)');
const db = openDb(':memory:');
const t0 = Date.UTC(2026, 10, 2, 15);
check('турнир создаётся один раз', [createTournament(db, 'T', t0, 24 * H, 72 * H), createTournament(db, 'T', t0, 24 * H, 72 * H)], [true, false]);
const players = Array.from({ length: 9 }, (_, i) => createAccount(db, `Игрок${i}`).account);
const fee = (id: string) =>
  transaction(db, () => {
    if (!ledgerAdd(db, `fee:T:${id}`, 'T', 'fee', id, -ENTRY_FEE)) return false;
    addEntry(db, 'T', id, 'x', Date.now());
    db.prepare('UPDATE accounts SET balance = balance - ? WHERE id = ?').run(ENTRY_FEE, id);
    return true;
  });
check('регистрация — 10 000 списаны', [fee(players[0].id), getAccount(db, players[0].id)!.balance], [true, 20_000]);
check('нельзя зарегистрироваться дважды — второй раз не списывается', [fee(players[0].id), getAccount(db, players[0].id)!.balance], [false, 20_000]);
check('и запись участника одна', [addEntry(db, 'T', players[0].id, 'x', 1), entriesOf(db, 'T').length], [false, 1]);
const refund = (id: string) =>
  transaction(db, () => {
    if (!ledgerAdd(db, `refund:T:${id}`, 'T', 'refund', id, ENTRY_FEE)) return false;
    db.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?').run(ENTRY_FEE, id);
    return true;
  });
check('возврат при отмене — 10 000 вернулись', [refund(players[0].id), getAccount(db, players[0].id)!.balance], [true, 30_000]);
check('двойной возврат невозможен', [refund(players[0].id), getAccount(db, players[0].id)!.balance], [false, 30_000]);

createTournament(db, 'U', t0, 24 * H, 72 * H);
check('каждый отборочный стол — ровно +50 000', [ledgerAdd(db, 'table:U:qual:1', 'U', 'table', null, TABLE_BONUS), treasuryOf(db, 'U')], [true, 50_000]);
check('повторный event не добавляет +50 000 второй раз', [ledgerAdd(db, 'table:U:qual:1', 'U', 'table', null, TABLE_BONUS), treasuryOf(db, 'U')], [false, 50_000]);
ledgerAdd(db, 'table:U:qual:2', 'U', 'table', null, TABLE_BONUS);
check('два отборочных стола → +100 000', treasuryOf(db, 'U'), 100_000);
ledgerAdd(db, 'table:U:final:1', 'U', 'table', null, TABLE_BONUS);
check('финальный стол → ещё +50 000, системная часть 150 000', treasuryOf(db, 'U'), 150_000);
// Остатки не прошедших (пример владельца): 9 000 + 6 000 + 0, со второго стола ещё 19 000.
for (const [k, v] of [['p3', 9_000], ['p4', 6_000], ['p5', 0], ['q3', 19_000]] as const) ledgerAdd(db, `leftover:U:${k}`, 'U', 'leftover', k, v);
check('остатки не прошедших — в казну: 150 000 + 34 000 = 184 000', treasuryOf(db, 'U'), 184_000);
check('двойной сбор остатка выбывшего невозможен', [ledgerAdd(db, 'leftover:U:p3', 'U', 'leftover', 'p3', 9_000), treasuryOf(db, 'U')], [false, 184_000]);
ledgerAdd(db, 'payout:U:w', 'U', 'payout', 'w', 226_000);
check('выплата из казны не уменьшает её подсчёт', treasuryOf(db, 'U'), 184_000);
check('двойная выплата невозможна', ledgerAdd(db, 'payout:U:w', 'U', 'payout', 'w', 226_000), false);
check('журнал помнит каждое движение по одному разу', ledgerOf(db, 'U').length, 8);

section('турнир: состояния и столы в базе');
check('регистрация → отбор один раз', [moveTournament(db, 'T', 'registration', 'qualification'), moveTournament(db, 'T', 'registration', 'qualification')], [true, false]);
check('финал со сроком', [moveTournament(db, 'T', 'qualification', 'final', { finalEndsAt: 123 }), getTournament(db, 'T')!.finalEndsAt], [true, 123]);
check('стол заводится один раз', [addTable(db, 'T', 'qual', 1, 4, '11111'), addTable(db, 'T', 'qual', 1, 4, '11111')], [true, false]);
check('стол: ждёт → идёт → сыгран, второй старт не проходит',
  [moveTable(db, 'T', 'qual', 1, ['waiting'], 'playing', 5), moveTable(db, 'T', 'qual', 1, ['waiting'], 'playing', 6), moveTable(db, 'T', 'qual', 1, ['playing'], 'finished', 7)],
  [true, false, true]);
check('у стола — время старта и конца', [tablesOf(db, 'T')[0].startedAt, tablesOf(db, 'T')[0].finishedAt], [5, 7]);
check('участник: играет → сыграл с балансом 20 000',
  [moveEntry(db, 'T', players[0].id, ['registered'], 'playing', { tableNo: 1 }), moveEntry(db, 'T', players[0].id, ['playing'], 'played', { balance: 20_000, qualBalance: 20_000 })],
  [true, true]);
check('итоговый баланс сохранён', [entryOf(db, 'T', players[0].id)!.balance, entryOf(db, 'T', players[0].id)!.qualBalance, entryOf(db, 'T', players[0].id)!.tableNo], [20_000, 20_000, 1]);
const skill0 = getAccount(db, players[0].id)!.skill;
check('рейтинг за турнир — один раз', [rateEntry(db, 'T', players[0].id, 1.0), rateEntry(db, 'T', players[0].id, 1.0)], [true, false]);
check('мастерство выросло на 1.0', Math.round((getAccount(db, players[0].id)!.skill - skill0) * 10) / 10, 1);
