// Проверки tableTimer.ts: время игры за столом и продление по согласию всех (RULES.md §20,
// решение владельца 01.11.2026). Запуск: npm test

import { check, section } from './check.js';
import {
  ask,
  cast,
  checkTimeLimit,
  secondsLeft,
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
check('60 минут от первой раздачи', [c.endsAt - t0, secondsLeft(c, t0), c.reached], [60 * MIN, 3600, false]);
check('за 6 минут до конца ещё не спрашиваем', shouldAsk(c, t0 + 54 * MIN), false);
check('за 5 минут — спрашиваем', shouldAsk(c, t0 + 55 * MIN), true);
c = ask(c);
check('вопрос задан к этому времени окончания', [c.vote?.forEndsAt, c.askedForEndsAt], [c.endsAt, c.endsAt]);
check('второй раз по тому же времени окончания не спрашиваем (§20.10)', shouldAsk(c, t0 + 56 * MIN), false);

section('все «да» — +10 минут (сценарий 2)');
let s2 = ask(startClock(30, t0));
s2 = voteAll(s2, six.slice(0, 5), 'yes', t0 + 26 * MIN);
check('пятеро из шести «да» — ещё ждём шестого', [s2.vote?.yes.length, s2.endsAt - t0], [5, 30 * MIN]);
s2 = voteAll(s2, ['Тимур'], 'yes', t0 + 26 * MIN);
check('шестой «да» — стол на 40 минут, голосование закрыто', [s2.endsAt - t0, s2.extensions, s2.vote, s2.lastVote?.result], [40 * MIN, 1, null, 'approved']);
check('итог не прибавляет второй раз (повторный подсчёт)', settle(s2, six, t0 + 26 * MIN).endsAt - t0, 40 * MIN);
const again = cast(s2, six, 'Тимур', 'yes', t0 + 30 * MIN, t0 + 26 * MIN);
check('старое нажатие после продления — вопроса уже нет', again.ok ? 'ok' : again.error, 'no extension vote');

section('один против — продления нет (сценарий 3, §20.7)');
let s3 = ask(startClock(60, t0));
s3 = voteAll(s3, six.slice(0, 5), 'yes', t0 + 56 * MIN);
s3 = voteAll(s3, ['Тимур'], 'no', t0 + 56 * MIN);
check('5 «да», 1 «нет» — отказ сразу, время прежнее', [s3.endsAt - t0, s3.vote, s3.lastVote?.result, s3.lastVote?.byId], [60 * MIN, null, 'rejected', 'Тимур']);
check('хозяин не решает за всех: первый «нет» — тоже отказ', (() => {
  let x = ask(startClock(60, t0));
  x = voteAll(x, ['Айдар'], 'no', t0 + 56 * MIN);
  return x.lastVote?.result;
})(), 'rejected');
check('после отказа по этому времени окончания больше не спрашиваем', shouldAsk(s3, t0 + 58 * MIN), false);
s3 = settle(s3, six, t0 + 60 * MIN);
check('в 00:00 время вышло', s3.reached, true);

section('не ответил до 00:00 — продления нет (сценарий 4, §20.6)');
let s4 = ask(startClock(60, t0));
s4 = voteAll(s4, six.slice(0, 5), 'yes', t0 + 57 * MIN);
const late = cast(s4, six, 'Тимур', 'yes', s4.vote!.forEndsAt, t0 + 60 * MIN);
check('голос ровно в 00:00 — уже не принимается', late.ok ? 'ok' : late.error, 'no extension vote');
s4 = settle(s4, six, t0 + 60 * MIN);
check('00:00 — вопрос закрыт без продления, время вышло', [s4.endsAt - t0, s4.lastVote?.result, s4.reached], [60 * MIN, 'expired', true]);

section('продлевать можно снова — каждый раз новым голосованием (сценарии 5, 6, §20.9)');
let s5 = ask(startClock(60, t0));
s5 = voteAll(s5, six, 'yes', t0 + 55 * MIN);
check('первое продление — 70 минут', s5.endsAt - t0, 70 * MIN);
check('за 6 минут до нового конца не спрашиваем', shouldAsk(s5, t0 + 64 * MIN), false);
check('за 5 минут до нового конца — новый вопрос', shouldAsk(s5, t0 + 65 * MIN), true);
s5 = ask(s5);
s5 = voteAll(s5, six, 'yes', t0 + 65 * MIN);
check('второе продление — 80 минут', [s5.endsAt - t0, s5.extensions], [80 * MIN, 2]);
s5 = ask(s5);
s5 = voteAll(s5, ['Серик'], 'yes', t0 + 76 * MIN);
s5 = voteAll(s5, ['Дана'], 'no', t0 + 76 * MIN);
check('третье — один против: остаётся 80 минут', [s5.endsAt - t0, s5.extensions, s5.lastVote?.result], [80 * MIN, 2, 'rejected']);
check('и больше не спрашиваем', shouldAsk(s5, t0 + 78 * MIN), false);

section('дубли и чужие голоса (§20.19)');
let d = ask(startClock(60, t0));
const first = cast(d, six, 'Серик', 'yes', d.vote!.forEndsAt, t0 + 56 * MIN);
d = first.ok ? first.clock : d;
const twice = cast(d, six, 'Серик', 'yes', d.vote!.forEndsAt, t0 + 56 * MIN);
check('нажал дважды — второй раз «already voted»', twice.ok ? 'ok' : twice.error, 'already voted');
const flip = cast(d, six, 'Серик', 'no', d.vote!.forEndsAt, t0 + 56 * MIN);
check('передумать нельзя', flip.ok ? 'ok' : flip.error, 'already voted');
const stale = cast(d, six, 'Айдар', 'yes', d.vote!.forEndsAt - 10 * MIN, t0 + 56 * MIN);
check('голос к старому вопросу — «stale»', stale.ok ? 'ok' : stale.error, 'stale extension vote');
const stranger = cast(d, six, 'Зритель', 'yes', d.vote!.forEndsAt, t0 + 56 * MIN);
check('не за столом — не голосует', stranger.ok ? 'ok' : stranger.error, 'you do not vote on this');
check('без вопроса голосовать нельзя', (() => {
  const r = cast(startClock(60, t0), six, 'Серик', 'yes', t0 + 60 * MIN, t0 + 10 * MIN);
  return r.ok ? 'ok' : r.error;
})(), 'no extension vote');

section('ушёл со стола во время вопроса — его голос не нужен (§20.16)');
let g = ask(startClock(60, t0));
g = voteAll(g, six.slice(0, 5), 'yes', t0 + 56 * MIN);
const five = six.slice(0, 5);
g = settle(g, five, t0 + 57 * MIN);
check('Тимур ушёл, остальные пятеро «да» — продлили', [g.endsAt - t0, g.lastVote?.result], [70 * MIN, 'approved']);
check('за столом никого из голосующих — не продлеваем', settle(ask(startClock(60, t0)), [], t0 + 56 * MIN).endsAt - t0, 60 * MIN);
