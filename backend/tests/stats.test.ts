// Проверки stats.ts. Запуск всех проверок: npm test

import { check, section } from './check.js';
import { addDeal, addMoney, emptyStats, roomWinners } from '../src/stats.js';

section('статистика игрока (ТЗ §2, §35)');

let s = emptyStats();
s = addMoney(s, -100); // взнос
check('взнос — ушедшие монеты', [s.coinsWon, s.coinsLost], [0, 100]);

s = addDeal(s, null);
check('играл против главного — партия засчитана, главным не был', [s.deals, s.mains, s.wins, s.losses], [1, 0, 0, 0]);

s = addMoney(s, 500);
s = addDeal(s, { declaration: 'РАЗ', won: true, delta: 500, garba: false, risk: 1 });
check('выиграл РАЗ', [s.deals, s.mains, s.wins, s.raz, s.maxWin, s.maxRisk, s.coinsWon], [2, 1, 1, 1, 500, 1, 500]);

s = addMoney(s, -1_500);
s = addDeal(s, { declaration: 'РАЗ', won: false, delta: -1_500, garba: false, risk: 3 });
check('проиграл спецкарту на ×3 — поражение, риск не засчитан', [s.losses, s.raz, s.maxRisk, s.coinsLost], [1, 2, 1, 1_600]);

s = addDeal(s, { declaration: 'ДВА', won: true, delta: 300, garba: false, risk: 1 });
check('ДВА выиграл меньше прежнего — максимальный выигрыш прежний', [s.dva, s.maxWin], [1, 500]);

s = addDeal(s, { declaration: 'КОН', won: true, delta: 400, garba: true, risk: 1 });
check('ГАРБА на КОНЕ', [s.kon, s.garba, s.wins], [1, 1, 3]);

s = addDeal(s, { declaration: 'РАЗ', won: true, delta: 2_000, garba: false, risk: 4 });
check('выиграл на ×4 — максимальный риск ×4', [s.maxRisk, s.maxWin], [4, 2_000]);
check('ноль — не движение денег', addMoney(s, 0), s);

section('победитель комнаты (ТЗ §36)');
check('лучший итог', roomWinners([{ id: 'a', diff: 300 }, { id: 'b', diff: -500 }, { id: 'c', diff: 200 }]), ['a']);
check('ничья — оба', roomWinners([{ id: 'a', diff: 300 }, { id: 'b', diff: 300 }, { id: 'c', diff: -600 }]), ['a', 'b']);
check('никто не в плюсе — победителя нет', roomWinners([{ id: 'a', diff: 0 }, { id: 'b', diff: 0 }]), []);
