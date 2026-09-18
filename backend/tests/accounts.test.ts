// Проверки accounts.ts на базе в памяти. Запуск всех проверок: npm test

import { DatabaseSync } from 'node:sqlite';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, section } from './check.js';
import {
  cleanName,
  createAccount,
  findAccountByCode,
  findAccountByToken,
  getAccount,
  giftedOn,
  invitedCount,
  openDb,
  recordGift,
  setBalance,
  setDaily,
  tokenFromHeader,
} from '../src/accounts.js';

const db = openDb(':memory:');

section('аккаунты (этап 9.1)');

const { account, token } = createAccount(db, 'Серик');
check('новый аккаунт получает стартовые 10 000', account.balance, 10_000);
check('имя сохраняется как есть, кириллица целая', getAccount(db, account.id)?.name, 'Серик');
check('по токену находится свой аккаунт', findAccountByToken(db, token)?.id, account.id);
check('чужой токен не подходит', findAccountByToken(db, 'x'.repeat(64)), null);
check('пустой токен не подходит', findAccountByToken(db, ''), null);

const row = db.prepare('SELECT token_hash FROM accounts WHERE id = ?').get(account.id) as { token_hash: string };
check('в базе лежит не сам токен, а его хеш', row.token_hash !== token && row.token_hash.length === 64, true);

const second = createAccount(db, 'Серик');
check('одинаковые имена можно — это разные аккаунты', second.account.id !== account.id, true);
check('и токены у них разные', second.token !== token, true);

setBalance(db, account.id, 7_300);
check('баланс сохраняется в базе', findAccountByToken(db, token)?.balance, 7_300);
check('баланс второго аккаунта не задет', getAccount(db, second.account.id)?.balance, 10_000);

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
