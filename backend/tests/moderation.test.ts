// Проверки moderation.ts: фильтр имён, блокировка, жалобы (29.09.2026). Запуск: npm test

import { check, section } from './check.js';
import { createAccount, deleteAccountData, openDb, transaction } from '../src/accounts.js';
import {
  addReport,
  avoidIds,
  blockedBetween,
  blockedIds,
  blockPlayer,
  hasBlocked,
  isReportReason,
  listReports,
  nameNotAllowed,
  resolveReport,
  unblockPlayer,
} from '../src/moderation.js';

section('moderation: фильтр имён');
for (const bad of ['хуй', 'Пиздец', 'ебанат', 'x.y.й', 'cyka', 'СУКА123', '6ля', 'fuck you', 'F.U.C.K', 'sh1t', 'қотақ', 'Hitler']) {
  check(`«${bad}» — нельзя`, nameNotAllowed(bad), true);
}
for (const ok of ['Айдар', 'Глеб', 'Мандарин', 'Хлебушек', 'Небо', 'Serik', 'Дана', 'Асель', 'Тимур', 'Мадина', 'Ержан', 'Ayan 007', 'Нұрсұлтан']) {
  check(`«${ok}» — можно`, nameNotAllowed(ok), false);
}

section('moderation: блокировка');
const db = openDb(':memory:');
const a = createAccount(db, 'Айдар', null).account;
const b = createAccount(db, 'Дана', null).account;
const c = createAccount(db, 'Ержан', null).account;
check('сначала никто не заблокирован', blockedBetween(db, a.id, b.id), false);
blockPlayer(db, a.id, b.id);
blockPlayer(db, a.id, b.id); // второй раз — без ошибки
check('Айдар заблокировал Дану', hasBlocked(db, a.id, b.id), true);
check('Дана Айдара — нет', hasBlocked(db, b.id, a.id), false);
check('между ними блок — в обе стороны', blockedBetween(db, b.id, a.id), true);
check('список Айдара', blockedIds(db, a.id), [b.id]);
check('Дане не сидеть с Айдаром', [...avoidIds(db, b.id)], [a.id]);
blockPlayer(db, c.id, a.id);
check('Айдару не сидеть ни с Даной, ни с Ержаном', [...avoidIds(db, a.id)].sort(), [b.id, c.id].sort());
unblockPlayer(db, a.id, b.id);
check('разблокировал', blockedBetween(db, a.id, b.id), false);

section('moderation: жалобы');
check('причина name', isReportReason('name'), true);
check('причина spam — нет', isReportReason('spam'), false);
const report = { fromId: a.id, toId: b.id, toName: 'Дана', reason: 'name' as const, roomId: '12345' };
check('жалоба принята', addReport(db, report), 'added');
check('вторая такая же, пока не разобрана', addReport(db, report), 'already reported');
check('от другого игрока — отдельная', addReport(db, { ...report, fromId: c.id }), 'added');
check('открытых жалоб две', listReports(db, false).length, 2);
check('разобрали — закрылись обе на Дану', resolveReport(db, listReports(db, false)[0].id), 2);
check('открытых нет', listReports(db, false).length, 0);
check('в полном списке остались', listReports(db, true).length, 2);
check('после разбора можно пожаловаться снова', addReport(db, report), 'added');
check('нет такой жалобы', resolveReport(db, 999), 0);

section('moderation: удаление аккаунта');
blockPlayer(db, a.id, b.id);
transaction(db, () => deleteAccountData(db, a.id));
check('его блокировки ушли', blockedIds(db, a.id), []);
check('блок Ержана на него — тоже', blockedIds(db, c.id), []);
check('его жалобы ушли, жалоба Ержана осталась', listReports(db, true).map((r) => r.fromId), [c.id]);
