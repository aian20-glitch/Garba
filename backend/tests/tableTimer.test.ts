// Проверки tableTimer.ts: время игры за столом и продление по согласию всех (RULES.md §20,
// решение владельца 01.11.2026; часы на паузе стоят и второй вопрос за 1 минуту — 04.11.2026).
// Запуск: npm test

import { check, section } from './check.js';
import {
  ask,
  cast,
  checkTimeLimit,
  normalizeClock,
  remainingMs,
  secondsLeft,
  setRunning,
  settle,
  shouldAsk,
  startClock,
  type TableClock,
} from '../src/tableTimer.js';

const MIN = 60_000;
const six = ['Серик', 'Айдар', 'Дана', 'Ержан', 'Асель', 'Тимур'];
const t0 = 1_000_000_000;

// Все из списка ответили одинаково; итог — сразу.
function voteAll(c: TableClock, ids: string[], choice: 'yes' | 'no', now: number): TableClock {
  for (const id of ids) {
    const r = cast(c, six, id, choice, c.vote!.forEndsAt, now);
    if (!r.ok) throw new Error(`${id}: ${r.error}`);
    c = settle(r.clock, six, now);
  }
  return c;
}
// Подвести и задать вопрос, если пора, — как каждую секунду на сервере.
function tick(c: TableClock, now: number, voters = six): TableClock {
  c = settle(c, voters, now);
  return shouldAsk(c, now) ? ask(c, now) : c;
}
const limit = (c: TableClock) => c.limitMs / MIN;

section('настройка «Время игры» (§20.1)');
check('30, 60, 90 минут — можно', [30, 60, 90].map((m) => checkTimeLimit(m)), [30, 60, 90].map((m) => ({ ok: true, minutes: m })));
check('своё время 45 минут — можно (сценарий 14)', checkTimeLimit(45), { ok: true, minutes: 45 });
check('15 и 180 — края, можно', [checkTimeLimit(15), checkTimeLimit(180)], [{ ok: true, minutes: 15 }, { ok: true, minutes: 180 }]);
check('10 минут — нельзя (сценарий 15)', checkTimeLimit(10), { ok: false, error: 'time limit too short' });
check('200 минут — нельзя (сценарий 16)', checkTimeLimit(200), { ok: false, error: 'time limit too long' });
check('без ограничения — null (сценарий 17)', checkTimeLimit(null), { ok: true, minutes: null });
check('не прислали (старое приложение) — без ограничения', checkTimeLimit(undefined), { ok: true, minutes: null });
check('дробное, текст, true — ошибка', [checkTimeLimit(45.5).ok, checkTimeLimit('abc').ok, checkTimeLimit(true).ok], [false, false, false]);

section('часы стола (§20.3–20.4)');
let c = startClock(60, t0);
check('60 минут от первой раздачи', [limit(c), secondsLeft(c, t0), c.reached], [60, 3600, false]);
check('за 6 минут до конца ещё не спрашиваем', shouldAsk(c, t0 + 54 * MIN), false);
check('за 5 минут — спрашиваем', shouldAsk(c, t0 + 55 * MIN), true);
c = ask(c, t0 + 55 * MIN);
check('вопрос — первый, к этому сроку', [c.vote?.forEndsAt, c.vote?.round], [60 * MIN, 1]);
check('пока вопрос идёт — второй не задаём', shouldAsk(c, t0 + 56 * MIN), false);

section('на паузе часы стоят (§20.3, 04.11.2026)');
let p = startClock(60, t0);
p = setRunning(p, false, t0 + 10 * MIN); // стол ждёт отключившегося
check('остановили на 10-й минуте — осталось 50', secondsLeft(p, t0 + 10 * MIN), 50 * 60);
check('пауза 4 минуты — всё ещё 50', secondsLeft(p, t0 + 14 * MIN), 50 * 60);
p = setRunning(p, true, t0 + 14 * MIN);
check('пустили — отсчёт с того же места', secondsLeft(p, t0 + 15 * MIN), 49 * 60);
check('повторная остановка тем же состоянием — ничего не меняет', setRunning(p, true, t0 + 20 * MIN) === p, true);
p = setRunning(setRunning(p, false, t0 + 20 * MIN), false, t0 + 25 * MIN);
check('две причины паузы сразу — одна остановка, время не пропало', secondsLeft(p, t0 + 30 * MIN), 44 * 60);
p = setRunning(p, true, t0 + 30 * MIN);
check('на паузе за 5 минут до конца не спрашиваем — до конца ещё 44', shouldAsk(p, t0 + 30 * MIN), false);
check('конец сдвинулся на всю паузу: 60 + 4 + 10 = 74-я минута', [settle(p, six, t0 + 73 * MIN).reached, settle(p, six, t0 + 74 * MIN).reached], [false, true]);
const frozen = setRunning(startClock(15, t0), false, t0 + 14 * MIN);
check('на паузе у последней минуты 00:00 не наступает', settle(frozen, six, t0 + 60 * MIN).reached, false);

section('все «да» — +10 минут (сценарий 2)');
let s2 = ask(startClock(30, t0), t0 + 26 * MIN);
s2 = voteAll(s2, six.slice(0, 5), 'yes', t0 + 26 * MIN);
check('пятеро из шести «да» — ещё ждём шестого', [s2.vote?.yes.length, limit(s2)], [5, 30]);
s2 = voteAll(s2, ['Тимур'], 'yes', t0 + 26 * MIN);
check('шестой «да» — стол на 40 минут, голосование закрыто', [limit(s2), s2.extensions, s2.vote, s2.lastVote?.result], [40, 1, null, 'approved']);
check('итог не прибавляет второй раз (повторный подсчёт)', limit(settle(s2, six, t0 + 26 * MIN)), 40);
const again = cast(s2, six, 'Тимур', 'yes', 30 * MIN, t0 + 26 * MIN);
check('старое нажатие после продления — вопроса уже нет', again.ok ? 'ok' : again.error, 'no extension vote');
check('после продления к старому сроку не спрашиваем (за 1 минуту до старого конца)', shouldAsk(s2, t0 + 29 * MIN), false);

section('один против — за 1 минуту спросим ещё раз (сценарий 3, 04.11.2026)');
let s3 = ask(startClock(60, t0), t0 + 55 * MIN);
s3 = voteAll(s3, six.slice(0, 5), 'yes', t0 + 56 * MIN);
s3 = voteAll(s3, ['Тимур'], 'no', t0 + 56 * MIN);
check('5 «да», 1 «нет» — отказ сразу, время прежнее', [limit(s3), s3.vote, s3.lastVote?.result, s3.lastVote?.byId], [60, null, 'rejected', 'Тимур']);
check('до последней минуты больше не спрашиваем', shouldAsk(s3, t0 + 58 * MIN + 59_000), false);
s3 = tick(s3, t0 + 59 * MIN);
check('за 1 минуту — второй вопрос к тому же сроку', [s3.vote?.round, s3.vote?.forEndsAt], [2, 60 * MIN]);
const oldRound = cast(s3, six, 'Серик', 'yes', s3.vote!.forEndsAt, t0 + 59 * MIN, 1);
check('нажатие к первому вопросу во второй не попадает', oldRound.ok ? 'ok' : oldRound.error, 'stale extension vote');
s3 = voteAll(s3, six, 'yes', t0 + 59 * MIN + 30_000);
check('второй раз согласились все — +10 минут', [limit(s3), s3.extensions, s3.lastVote?.round], [70, 1, 2]);
check('новый срок — снова первый вопрос за 5 минут', tick(s3, t0 + 65 * MIN).vote?.round, 1);

section('второй вопрос — последний (сценарий 4)');
let s4 = ask(startClock(60, t0), t0 + 55 * MIN);
s4 = voteAll(s4, ['Айдар'], 'no', t0 + 55 * MIN);
s4 = tick(s4, t0 + 59 * MIN);
s4 = voteAll(s4, ['Айдар'], 'no', t0 + 59 * MIN);
check('и во второй раз «нет» — продления нет', [limit(s4), s4.lastVote?.result, s4.lastVote?.round], [60, 'rejected', 2]);
check('третьего вопроса не будет', shouldAsk(s4, t0 + 59 * MIN + 30_000), false);
s4 = tick(s4, t0 + 60 * MIN);
check('в 00:00 время вышло', s4.reached, true);

section('первый вопрос не решён к последней минуте — его сменяет второй');
let s5 = ask(startClock(60, t0), t0 + 55 * MIN);
s5 = voteAll(s5, six.slice(0, 5), 'yes', t0 + 57 * MIN);
s5 = tick(s5, t0 + 59 * MIN);
check('первый закрыт как «не ответили», задан второй, голоса — заново', [s5.lastVote, s5.vote?.round, s5.vote?.yes.length], [null, 2, 0]);
s5 = voteAll(s5, six.slice(0, 5), 'yes', t0 + 59 * MIN + 10_000);
const late = cast(s5, six, 'Тимур', 'yes', s5.vote!.forEndsAt, t0 + 60 * MIN);
check('голос ровно в 00:00 — уже не принимается', late.ok ? 'ok' : late.error, 'no extension vote');
s5 = tick(s5, t0 + 60 * MIN);
check('00:00 — вопрос закрыт без продления, время вышло', [limit(s5), s5.lastVote?.result, s5.reached], [60, 'expired', true]);

section('продлевать можно снова — каждый раз новым голосованием (сценарии 5, 6, §20.9)');
let s6 = ask(startClock(60, t0), t0 + 55 * MIN);
s6 = voteAll(s6, six, 'yes', t0 + 55 * MIN);
check('первое продление — 70 минут', limit(s6), 70);
check('за 6 минут до нового конца не спрашиваем', shouldAsk(s6, t0 + 64 * MIN), false);
s6 = tick(s6, t0 + 65 * MIN);
s6 = voteAll(s6, six, 'yes', t0 + 65 * MIN);
check('второе продление — 80 минут', [limit(s6), s6.extensions], [80, 2]);

section('дубли и чужие голоса (§20.19)');
let d = ask(startClock(60, t0), t0 + 56 * MIN);
const first = cast(d, six, 'Серик', 'yes', d.vote!.forEndsAt, t0 + 56 * MIN);
d = first.ok ? first.clock : d;
const twice = cast(d, six, 'Серик', 'yes', d.vote!.forEndsAt, t0 + 56 * MIN);
check('нажал дважды — второй раз «already voted»', twice.ok ? 'ok' : twice.error, 'already voted');
const flip = cast(d, six, 'Серик', 'no', d.vote!.forEndsAt, t0 + 56 * MIN);
check('передумать нельзя', flip.ok ? 'ok' : flip.error, 'already voted');
const stale = cast(d, six, 'Айдар', 'yes', d.vote!.forEndsAt - 10 * MIN, t0 + 56 * MIN);
check('голос к старому сроку — «stale»', stale.ok ? 'ok' : stale.error, 'stale extension vote');
const stranger = cast(d, six, 'Зритель', 'yes', d.vote!.forEndsAt, t0 + 56 * MIN);
check('не за столом — не голосует', stranger.ok ? 'ok' : stranger.error, 'you do not vote on this');
check('без вопроса голосовать нельзя', (() => {
  const r = cast(startClock(60, t0), six, 'Серик', 'yes', 60 * MIN, t0 + 10 * MIN);
  return r.ok ? 'ok' : r.error;
})(), 'no extension vote');

section('ушёл со стола во время вопроса — его голос не нужен (§20.16)');
let g = ask(startClock(60, t0), t0 + 56 * MIN);
g = voteAll(g, six.slice(0, 5), 'yes', t0 + 56 * MIN);
g = settle(g, six.slice(0, 5), t0 + 57 * MIN);
check('Тимур ушёл, остальные пятеро «да» — продлили', [limit(g), g.lastVote?.result], [70, 'approved']);
check('за столом никого из голосующих — не продлеваем', limit(settle(ask(startClock(60, t0), t0 + 56 * MIN), [], t0 + 56 * MIN)), 60);

section('турнирный стол — те же часы на 40 «минут» (§19.4)');
const tourMin = 30_000; // живая проверка: стол 20 минут → «минута» 30 с
let tc = startClock(40, t0, tourMin);
check('спрашиваем за 5 «минут» стола', [shouldAsk(tc, t0 + 34 * tourMin), shouldAsk(tc, t0 + 35 * tourMin)], [false, true]);
tc = ask(tc, t0 + 35 * tourMin);
tc = voteAll(tc, six, 'yes', t0 + 35 * tourMin);
check('продление — +10 «минут» стола', tc.limitMs, 50 * tourMin);

section('часы из базы до 04.11.2026');
const old = { minutes: 60, startedAt: t0, endsAt: t0 + 70 * MIN, extensions: 1, askedForEndsAt: t0 + 70 * MIN, vote: { forEndsAt: t0 + 70 * MIN, yes: ['Серик'], no: [] }, lastVote: null, reached: false };
const n = normalizeClock(old, t0 + 66 * MIN);
check('срок 70 минут, сыграно 66 — осталось 4, вопрос тот же', [n.limitMs / MIN, remainingMs(n, t0 + 66 * MIN) / MIN, n.vote?.forEndsAt, n.vote?.round, n.vote?.yes], [70, 4, 70 * MIN, 1, ['Серик']]);
check('за 1 минуту спросим второй раз', tick(n, t0 + 69 * MIN).vote?.round, 2);
