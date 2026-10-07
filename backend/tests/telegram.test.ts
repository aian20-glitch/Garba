// Проверки telegram.ts. Запуск всех проверок: npm test

import { check, section } from './check.js';
import { initDataHash, parseStartParam, suggestedName, verifyInitData } from '../src/telegram.js';

const TOKEN = '123456:TEST-token';
const NOW = 1_800_000_000;

// Данные запуска так, как их подписывает Telegram.
function signed(fields: Record<string, string>, token = TOKEN): string {
  const map = new Map(Object.entries(fields));
  map.set('hash', initDataHash(map, token));
  return new URLSearchParams([...map.entries()]).toString();
}

const user = JSON.stringify({ id: 4242, first_name: 'Серик', last_name: 'Ахметов', username: 'serik' });

section('telegram: подпись данных запуска');
{
  const good = signed({ auth_date: String(NOW - 60), user, query_id: 'AAA', start_param: 'room_12345' });
  const launch = verifyInitData(good, TOKEN, NOW);
  check('правильная подпись — игрок найден', launch?.user.id, 4242);
  check('имя из Telegram', launch?.user.firstName, 'Серик');
  check('параметр ссылки', launch?.startParam, 'room_12345');
  check('чужой токен бота — нет', verifyInitData(good, '999:other', NOW), null);
  check('подменили игрока — нет', verifyInitData(good.replace('4242', '4243'), TOKEN, NOW), null);
  check('без подписи — нет', verifyInitData('auth_date=1&user=%7B%7D', TOKEN, NOW), null);
  check('пусто — нет', verifyInitData('', TOKEN, NOW), null);
  check('не строка — нет', verifyInitData({ hash: 'x' }, TOKEN, NOW), null);
  check('токен бота не задан — нет', verifyInitData(good, '', NOW), null);
  const old = signed({ auth_date: String(NOW - 2 * 86_400), user });
  check('старше суток — нет', verifyInitData(old, TOKEN, NOW), null);
  const noUser = signed({ auth_date: String(NOW) });
  check('без игрока — нет', verifyInitData(noUser, TOKEN, NOW), null);
}

section('telegram: имя и ссылки');
check('имя и фамилия', suggestedName({ id: 1, firstName: 'Серик', lastName: 'Ахметов', username: null }), 'Серик Ахметов');
check('длиннее 20 — обрезаем', suggestedName({ id: 1, firstName: 'Абылайхан', lastName: 'Нурмухамедов', username: null }), 'Абылайхан Нурмухамед');
check('пустое — пусто', suggestedName({ id: 1, firstName: ' ', lastName: '', username: null }), '');
check('комната', parseStartParam('room_12345'), { kind: 'room', value: '12345' });
check('приглашение', parseStartParam('invite_ab12cd'), { kind: 'invite', value: 'AB12CD' });
check('мусор — нет', parseStartParam('room_12/../leave'), null);
check('не строка — нет', parseStartParam(5), null);
