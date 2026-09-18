// Проверки accounts.ts на базе в памяти. Запуск всех проверок: npm test

import { check, section } from './check.js';
import {
  cleanName,
  createAccount,
  findAccountByToken,
  getAccount,
  openDb,
  setBalance,
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
