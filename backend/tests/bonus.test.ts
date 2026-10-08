// Проверки bonus.ts. Запуск всех проверок: npm test

import { check, section } from './check.js';
import { referralDue,
  dailyClaim,
  dayKey,
  giftError,
  giftLeftToday,
  makePlayerCode,
  normalizeCode,
  previousDay,
} from '../src/bonus.js';

section('сутки по времени Казахстана (UTC+5)');
check('23:00 UTC 1 марта — в Казахстане уже 2 марта', dayKey(Date.parse('2026-03-01T23:00:00Z')), '2026-03-02');
check('18:59 UTC — ещё тот же день', dayKey(Date.parse('2026-03-01T18:59:00Z')), '2026-03-01');
check('вчера для 1 марта — 28 февраля', previousDay('2026-03-01'), '2026-02-28');
check('вчера для 1 января — 31 декабря', previousDay('2026-01-01'), '2025-12-31');

section('ежедневный бонус (ТЗ §3)');
check('первый вход — день 1/7, 1 000', dailyClaim(null, 0, '2026-09-18'), { claimable: true, streak: 1, amount: 1_000 });
check('второй раз в тот же день — нельзя', dailyClaim('2026-09-18', 1, '2026-09-18'), { claimable: false, streak: 1 });
check('на следующий день — 2/7', dailyClaim('2026-09-18', 1, '2026-09-19'), { claimable: true, streak: 2, amount: 1_000 });
check('6-й день подряд — ещё обычный бонус', dailyClaim('2026-09-22', 5, '2026-09-23'), { claimable: true, streak: 6, amount: 1_000 });
check('7-й день подряд — 1 000 + 5 000 = 6 000', dailyClaim('2026-09-23', 6, '2026-09-24'), { claimable: true, streak: 7, amount: 6_000 });
check('после 7/7 серия начинается с 1/7', dailyClaim('2026-09-24', 7, '2026-09-25'), { claimable: true, streak: 1, amount: 1_000 });
check('пропустил день — серия заново', dailyClaim('2026-09-20', 4, '2026-09-22'), { claimable: true, streak: 1, amount: 1_000 });
check('пропустил на 6-м дне — 6 000 не будет', dailyClaim('2026-09-21', 6, '2026-09-23'), { claimable: true, streak: 1, amount: 1_000 });

let day = '2026-09-18';
let last: string | null = null;
let streak = 0;
let total = 0;
for (let i = 0; i < 7; i++) {
  const c = dailyClaim(last, streak, day);
  if (c.claimable) { total += c.amount; streak = c.streak; last = day; }
  day = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}
check('7 дней подряд — всего 6×1 000 + 6 000 = 12 000', total, 12_000);

section('подарки (ТЗ §5)');
const ok = { amount: 400, balance: 5_000, sentToday: 0, toSelf: false };
check('400 монет — можно (пример из ТЗ)', giftError(ok), null);
check('10 000 — максимум, можно (с 25.09.2026)', giftError({ ...ok, amount: 10_000, balance: 30_000 }), null);
check('10 100 — больше максимума', giftError({ ...ok, amount: 10_100, balance: 30_000 }), 'bad amount');
check('0 — нельзя', giftError({ ...ok, amount: 0 }), 'bad amount');
check('150 — не кратно сотне', giftError({ ...ok, amount: 150 }), 'bad amount');
check('сегодня уже дарил 400 — ещё 400 можно (10 000 в сутки на всех, 08.10.2026)', giftError({ ...ok, sentToday: 400 }), null);
check('девятерым по 1 000 — десятому ещё 1 000 можно', giftError({ ...ok, amount: 1_000, sentToday: 9_000 }), null);
check('подарил 9 000 — 2 000 уже не влезает', giftError({ ...ok, amount: 2_000, sentToday: 9_000 }), 'over daily limit');
check('подарил все 10 000 — сегодня больше нельзя', giftError({ ...ok, amount: 100, sentToday: 10_000 }), 'already gifted today');
check('остаток на сегодня', [giftLeftToday(0), giftLeftToday(9_000), giftLeftToday(10_000)], [10_000, 1_000, 0]);
check('себе — нельзя', giftError({ ...ok, toSelf: true }), 'self');
check('не хватает монет', giftError({ ...ok, balance: 300 }), 'not enough coins');

section('код игрока');
const code = makePlayerCode();
check('6 символов, без похожих 0 O 1 I L', /^[A-HJKMNP-Z2-9]{6}$/.test(code), true);
check('ввод с пробелами и маленькими буквами понимается', normalizeCode(' ab c12 '), 'ABC12');
check('не строка — пустой код', normalizeCode(null), '');

section('бонус за приглашение — после 3 комнат друга (решение владельца правил)');
check('друг только зарегистрировался — бонуса нет', referralDue(0, false), false);
check('доиграл 2 комнаты — ещё нет', referralDue(2, false), false);
check('доиграл 3 — пригласившему +1 000', referralDue(3, false), true);
check('уже выплачено — второй раз нет', referralDue(7, true), false);
