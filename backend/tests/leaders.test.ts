// Проверки leaders.ts и leaveBan.ts: ТОП-3 недели, медали за монеты, бан за выход
// (решения владельца, 23.10.2026; RULES.md §13d, §16.8, §16.9). Запуск: npm test

import { check, section } from './check.js';
import { addWeekly, coinMedals, weekKey, weekTop } from '../src/leaders.js';
import { banSecondsLeft, nextLeaveBan } from '../src/leaveBan.js';
import { coinLeaders, createAccount, leaveRecordOf, openDb, peakBalanceOf, setBalance, setLeaveRecord } from '../src/accounts.js';
import { weekCoins, writeRoom } from '../src/roomDb.js';

section('неделя — с понедельника 00:00 по Казахстану (§16.8)');
// 23.10.2026 — пятница. Понедельник той недели — 19.10.2026.
const kz = (iso: string) => Date.parse(iso + '+05:00');
check('пятница 23.10 — неделя с 19.10', weekKey(kz('2026-10-23T12:00:00')), '2026-10-19');
check('понедельник 19.10 в 00:00 — уже новая неделя', weekKey(kz('2026-10-19T00:00:00')), '2026-10-19');
check('воскресенье 18.10 в 23:59 — ещё прошлая', weekKey(kz('2026-10-18T23:59:00')), '2026-10-12');
check('воскресенье 25.10 вечером — та же неделя', weekKey(kz('2026-10-25T22:00:00')), '2026-10-19');

section('монеты за неделю копятся по игрокам');
let w = addWeekly({}, '2026-10-19', 'a', -100);
w = addWeekly(w, '2026-10-19', 'a', 900);
w = addWeekly(w, '2026-10-19', 'b', 300);
w = addWeekly(w, '2026-10-26', 'a', 50);
check('взнос −100, выигрыш +900 — за неделю +800', w['2026-10-19'].a, 800);
check('новая неделя — отдельно', w['2026-10-26'], { a: 50 });
check('ноль ничего не меняет', addWeekly(w, '2026-10-19', 'c', 0), w);

section('ТОП-3 недели — только кто в плюсе');
const rows = [
  { name: 'Аян', coins: 5_000 },
  { name: 'Серик', coins: 12_000 },
  { name: 'Дана', coins: -3_000 },
  { name: 'Ержан', coins: 700 },
  { name: 'Асель', coins: 2_000 },
];
check('три лучших по плюсу', weekTop(rows).map((r) => r.name), ['Серик', 'Аян', 'Асель']);
check('в минусе и по нулям — не в ТОПе', weekTop([{ name: 'Дана', coins: -1 }, { name: 'Аян', coins: 0 }]), []);

section('медали за монеты — каждый миллион (§16.9)');
check('999 999 — ни одной, первая закрыта', coinMedals(999_999), [{ coins: 1_000_000, earned: false }]);
check('ровно 1 000 000 — первая получена, вторая закрыта', coinMedals(1_000_000), [
  { coins: 1_000_000, earned: true },
  { coins: 2_000_000, earned: false },
]);
check('3 500 000 — три получены, 4 млн закрыта', coinMedals(3_500_000).map((m) => [m.coins, m.earned]), [
  [1_000_000, true],
  [2_000_000, true],
  [3_000_000, true],
  [4_000_000, false],
]);

section('медаль не пропадает: считается самый большой баланс');
const db = openDb(':memory:');
const rich = createAccount(db, 'Серик').account;
check('новый аккаунт — пик равен балансу', peakBalanceOf(db, rich.id), rich.balance);
setBalance(db, rich.id, 2_300_000);
setBalance(db, rich.id, 400_000);
check('дошёл до 2,3 млн и проиграл до 400 000 — пик 2,3 млн', peakBalanceOf(db, rich.id), 2_300_000);
check('медали за 1 и 2 млн остались', coinMedals(peakBalanceOf(db, rich.id)).filter((m) => m.earned).length, 2);
const poor = createAccount(db, 'Аян').account;
const top = coinLeaders(db);
check('по монетам — по убыванию баланса', top.map((p) => [p.name, p.coins]), [
  ['Серик', 400_000],
  ['Аян', poor.balance],
]);

section('монеты за неделю — из комнат в базу');
writeRoom(db, {
  id: '11111',
  status: 'started',
  players: [{ id: rich.id, balance: 400_000 }, { id: poor.id, balance: poor.balance }],
  weekly: { '2026-10-19': { [rich.id]: 1_500, [poor.id]: -1_500 } },
});
writeRoom(db, {
  id: '22222',
  status: 'finished',
  players: [{ id: rich.id, balance: 400_000 }],
  weekly: { '2026-10-19': { [rich.id]: 500 }, '2026-10-12': { [rich.id]: 9_000 } },
});
const week = weekCoins(db, '2026-10-19').sort((a, b) => b.coins - a.coins);
check('сумма по двум комнатам за эту неделю', week.map((r) => [r.name, r.coins]), [
  ['Серик', 2_000],
  ['Аян', -1_500],
]);
writeRoom(db, {
  id: '33333',
  status: 'started',
  practice: true,
  players: [{ id: poor.id, balance: poor.balance }],
  weekly: { '2026-10-19': { [poor.id]: 50_000 } },
});
check('тренировка с ботами в неделю не идёт', weekCoins(db, '2026-10-19').find((r) => r.id === poor.id)?.coins, -1_500);

section('бан за выход из начатой игры (§13d) — пример владельца');
const MIN = 60_000;
const t0 = kz('2026-10-23T12:00:00');
let ban = nextLeaveBan(null, t0);
check('1-й выход — 10 минут', [ban.count, (ban.until - t0) / MIN], [1, 10]);
const minutes: number[] = [10];
let t = t0;
for (let i = 2; i <= 8; i++) {
  t += 30 * MIN; // выходит каждые полчаса — 6 часов не проходит
  ban = nextLeaveBan(ban, t);
  minutes.push((ban.until - t) / MIN);
}
check('выходы 1…8 подряд — 10, 20, 30, 40, 50, 60, 60, 60 минут', minutes, [10, 20, 30, 40, 50, 60, 60, 60]);
const later = t + 6 * 60 * MIN;
check('6 часов без выходов — снова первый, 10 минут', nextLeaveBan(ban, later), {
  count: 1,
  lastAt: later,
  until: later + 10 * MIN,
});
check('5 ч 59 мин — счёт не сбросился', nextLeaveBan(ban, later - MIN).count, 9);
check('во время бана — сколько осталось', banSecondsLeft({ count: 1, lastAt: t0, until: t0 + 10 * MIN }, t0 + 4 * MIN), 360);
check('бан кончился — 0', banSecondsLeft({ count: 1, lastAt: t0, until: t0 + 10 * MIN }, t0 + 10 * MIN), 0);
check('не выходил — 0', banSecondsLeft(null, t0), 0);
check('в базе: не выходил — null', leaveRecordOf(db, rich.id), null);
setLeaveRecord(db, rich.id, { count: 2, lastAt: t0, until: t0 + 20 * MIN });
check('в базе: записали и прочитали', leaveRecordOf(db, rich.id), { count: 2, lastAt: t0, until: t0 + 20 * MIN });
