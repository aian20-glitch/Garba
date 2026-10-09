// Проверки buyIn.ts: сумма за стол (решение владельца, 09.10.2026). Запуск: npm test

import { check, section } from './check.js';
import { checkBuyIn } from '../src/buyIn.js';

section('сумма за стол — от минимума комнаты до всего баланса');
check('баланс 30 000, минимум 5 000, берёт 8 000', checkBuyIn(8000, 30000, 5000), { ok: true, amount: 8000 });
check('можно взять ровно минимум', checkBuyIn(5000, 30000, 5000), { ok: true, amount: 5000 });
check('можно взять всё', checkBuyIn(30000, 30000, 5000), { ok: true, amount: 30000 });
check('меньше минимума — нельзя', checkBuyIn(4000, 30000, 5000), { ok: false, status: 400, error: 'bad buyIn' });
check('больше баланса — нельзя', checkBuyIn(31000, 30000, 5000), { ok: false, status: 400, error: 'bad buyIn' });
check('не число — нельзя', checkBuyIn('много', 30000, 5000), { ok: false, status: 400, error: 'bad buyIn' });
check('дробное — нельзя', checkBuyIn(5000.5, 30000, 5000), { ok: false, status: 400, error: 'bad buyIn' });
check('не прислал сумму — берёт весь баланс (старое приложение, боты)', checkBuyIn(undefined, 30000, 5000), { ok: true, amount: 30000 });
check('денег меньше минимума — вход закрыт (§9.1a)', checkBuyIn(undefined, 4000, 5000), { ok: false, status: 403, error: 'not enough coins to enter' });
