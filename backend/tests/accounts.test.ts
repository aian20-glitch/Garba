// Проверки accounts.ts на базе в памяти. Запуск всех проверок: npm test

import { DatabaseSync } from 'node:sqlite';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, section } from './check.js';
import {
  acceptFriend,
  addFriend,
  friendStatus,
  requestFriend,
  deleteAccountData,
  DELETED_NAME,
  areFriends,
  cleanName,
  createAccount,
  findAccountByCode,
  findAccountByToken,
  getAccount,
  hasRecoveryCode,
  giftedOn,
  invitedCount,
  listFriends,
  openDb,
  normalizeRecoveryCode,
  recoverAccount,
  recordGift,
  removeFriend,
  replaceRecoveryCode,
  setBalance,
  setDaily,
  tokenFromHeader,
} from '../src/accounts.js';

const db = openDb(':memory:');

section('аккаунты (этап 9.1)');

const { account, token, recoveryCode } = createAccount(db, 'Серик');
check('новый аккаунт получает стартовые 10 000', account.balance, 10_000);
check('имя сохраняется как есть, кириллица целая', getAccount(db, account.id)?.name, 'Серик');
check('по токену находится свой аккаунт', findAccountByToken(db, token)?.id, account.id);
check('чужой токен не подходит', findAccountByToken(db, 'x'.repeat(64)), null);
check('пустой токен не подходит', findAccountByToken(db, ''), null);
check('новый аккаунт сразу защищён кодом восстановления', hasRecoveryCode(db, account.id), true);
check(
  'код восстановления удобно разбит на четыре группы',
  /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/.test(recoveryCode),
  true,
);

const row = db.prepare('SELECT token_hash FROM accounts WHERE id = ?').get(account.id) as { token_hash: string };
check('в базе лежит не сам токен, а его хеш', row.token_hash !== token && row.token_hash.length === 64, true);

const second = createAccount(db, 'Серик');
check('одинаковые имена можно — это разные аккаунты', second.account.id !== account.id, true);
check('и токены у них разные', second.token !== token, true);

setBalance(db, account.id, 7_300);
check('баланс сохраняется в базе', findAccountByToken(db, token)?.balance, 7_300);
check('баланс второго аккаунта не задет', getAccount(db, second.account.id)?.balance, 10_000);

section('восстановление аккаунта');
check('дефисы, пробелы и регистр кода не важны', normalizeRecoveryCode(` ${recoveryCode.toLowerCase()} `), recoveryCode.replaceAll('-', ''));
check('неполный код отклоняется', normalizeRecoveryCode('ABCD'), null);
const recovered = recoverAccount(db, account.code, recoveryCode)!;
check('вернулся тот же аккаунт', recovered.account.id, account.id);
check('старый токен после восстановления не работает', findAccountByToken(db, token), null);
check('новый токен работает', findAccountByToken(db, recovered.token)?.id, account.id);
check('использованный код больше не работает', recoverAccount(db, account.code, recoveryCode), null);
const recoveredAgain = recoverAccount(db, account.code, recovered.recoveryCode)!;
check('новый код можно использовать один раз', recoveredAgain.account.id, account.id);
const profileCode = replaceRecoveryCode(db, account.id)!;
check('код можно перевыпустить из профиля', recoverAccount(db, account.code, profileCode)?.account.id, account.id);

section('имя игрока');
check('пробелы по краям убираются', cleanName('  Дана  '), 'Дана');
check('двойные пробелы внутри схлопываются', cleanName('Асель   Б'), 'Асель Б');
check('пустое имя не подходит', cleanName('   '), null);
check('не строка — не подходит', cleanName(42), null);
check('20 символов — можно', cleanName('а'.repeat(20)), 'а'.repeat(20));
check('21 символ — слишком длинно', cleanName('а'.repeat(21)), null);

section('заголовок Authorization');
check('Bearer <токен>', tokenFromHeader('Bearer abc123'), 'abc123');
check('регистр слова Bearer не важен', tokenFromHeader('bearer abc123'), 'abc123');
check('без заголовка — пусто', tokenFromHeader(undefined), '');
check('без слова Bearer — пусто', tokenFromHeader('abc123'), '');

section('код игрока, подарки, приглашения (этап 9.3)');

check('у нового аккаунта есть код из 6 символов', /^[A-Z2-9]{6}$/.test(account.code), true);
check('по коду находится аккаунт', findAccountByCode(db, account.code)?.id, account.id);
check('чужой код — никого', findAccountByCode(db, 'ZZZZZZ')?.id ?? null, null);

const friend = createAccount(db, 'Дана', account.id).account;
check('пришёл по приглашению — записано, кто пригласил', friend.invitedBy, account.id);
check('у пригласившего 1 приглашённый', invitedCount(db, account.id), 1);

check('сегодня ещё не дарил', giftedOn(db, account.id, '2026-09-18'), false);
recordGift(db, account.id, friend.id, 400, '2026-09-18');
check('подарил 400 — сегодня уже дарил', giftedOn(db, account.id, '2026-09-18'), true);
check('завтра — снова можно', giftedOn(db, account.id, '2026-09-19'), false);
check('получатель при этом может дарить сам', giftedOn(db, friend.id, '2026-09-18'), false);

setDaily(db, account.id, '2026-09-18', 3);
check('серия бонусов сохраняется', [getAccount(db, account.id)?.dailyDay, getAccount(db, account.id)?.dailyStreak], ['2026-09-18', 3]);

section('друзья (этап 9.4)');
const third = createAccount(db, 'Ержан').account;
check('сначала не друзья', areFriends(db, account.id, third.id), false);
addFriend(db, account.id, third.id);
check('добавил — дружба взаимная', [areFriends(db, account.id, third.id), areFriends(db, third.id, account.id)], [true, true]);
addFriend(db, third.id, account.id);
check('повторное добавление не дублирует', listFriends(db, account.id).map((a) => a.name), ['Ержан']);
addFriend(db, account.id, friend.id);
check('список друзей по имени', listFriends(db, account.id).map((a) => a.name), ['Дана', 'Ержан']);
removeFriend(db, third.id, account.id);
check('удалил — пропало у обоих', [listFriends(db, account.id).map((a) => a.name), listFriends(db, third.id)], [['Дана'], []]);

// База, созданная на этапе 9.1 (без кодов и бонусов), открывается без потери аккаунтов.
const oldFile = join(tmpdir(), `garba-migrate-${Date.now()}.db`);
const old = new DatabaseSync(oldFile);
old.exec('CREATE TABLE accounts (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL, balance INTEGER NOT NULL, created_at INTEGER NOT NULL)');
old.prepare("INSERT INTO accounts VALUES ('old-1', 'hash', 'Ержан', 7300, 1)").run();
old.close();
const migrated = openDb(oldFile);
const oldAccount = getAccount(migrated, 'old-1');
check('старый аккаунт на месте, баланс тот же', [oldAccount?.name, oldAccount?.balance], ['Ержан', 7300]);
check('старому аккаунту выдан код', /^[A-Z2-9]{6}$/.test(oldAccount?.code ?? ''), true);
check('серия бонусов у старого аккаунта — с нуля', [oldAccount?.dailyDay, oldAccount?.dailyStreak], [null, 0]);
migrated.close();
rmSync(oldFile, { force: true });

section('удалить аккаунт навсегда (требование Apple и Google)');
{
  const db2 = openDb(':memory:');
  const gone = createAccount(db2, 'Уходящий').account;
  const stays = createAccount(db2, 'Остаётся', gone.id).account;
  addFriend(db2, gone.id, stays.id);
  db2.prepare("INSERT INTO avatars (account_id, mime, data, updated_at) VALUES (?, 'image/png', x'00', 0)").run(gone.id);
  const room = { id: '12345', players: [{ id: gone.id, name: 'Уходящий' }, { id: stays.id, name: 'Остаётся' }],
    game: { dealerId: gone.id, dealerName: 'Уходящий', mains: [{ playerId: gone.id, playerName: 'Уходящий' }] } };
  db2.prepare("INSERT INTO rooms (id, status, data, updated_at) VALUES ('12345', 'finished', ?, 0)").run(JSON.stringify(room));
  deleteAccountData(db2, gone.id);
  const count = (sql: string, ...args: string[]) => (db2.prepare(sql).get(...args) as { n: number }).n;
  check('аккаунта нет — токен больше не работает', getAccount(db2, gone.id), null);
  check('друзья и фото стёрты', [count('SELECT COUNT(*) AS n FROM friends WHERE owner_id = ? OR friend_id = ?', gone.id, gone.id), count('SELECT COUNT(*) AS n FROM avatars WHERE account_id = ?', gone.id)], [0, 0]);
  check('приглашённый им остался, без ссылки на него', getAccount(db2, stays.id)?.invitedBy, null);
  const saved = JSON.parse((db2.prepare("SELECT data FROM rooms WHERE id = '12345'").get() as { data: string }).data);
  check('в старой комнате имя заменено, у остальных — как было',
    [saved.players[0].name, saved.players[1].name, saved.game.dealerName, saved.game.mains[0].playerName],
    [DELETED_NAME, 'Остаётся', DELETED_NAME, DELETED_NAME]);
}

section('заявки в друзья — только с согласия (решение владельца, 19.09.2026)');
{
  const db3 = openDb(':memory:');
  const x = createAccount(db3, 'Серик').account;
  const y = createAccount(db3, 'Случайный').account;
  check('позвал — это заявка', [requestFriend(db3, x.id, y.id), friendStatus(db3, x.id, y.id), friendStatus(db3, y.id, x.id)], ['requested', 'outgoing', 'incoming']);
  check('без согласия дружбы нет', areFriends(db3, x.id, y.id), false);
  check('принять может только тот, кого позвали', acceptFriend(db3, x.id, y.id), false);
  check('он принял — друзья у обоих', [acceptFriend(db3, y.id, x.id), areFriends(db3, x.id, y.id), areFriends(db3, y.id, x.id)], [true, true, true]);
  const z = createAccount(db3, 'Третий').account;
  requestFriend(db3, x.id, z.id);
  check('встречная заявка — сразу друзья', requestFriend(db3, z.id, x.id), 'friends');
}
