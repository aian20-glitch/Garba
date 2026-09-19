// Проверки rateLimit.ts. Запуск: npm test

import { check, section } from './check.js';
import { rateCheck } from '../src/rateLimit.js';

section('новые аккаунты с одного адреса — не чаще лимита');
const HOUR = 3_600_000;
const rules = [{ max: 5, windowMs: HOUR }, { max: 20, windowMs: 24 * HOUR }];
let times: number[] = [];
let allowed = true;
for (let i = 0; i < 5; i++) ({ allowed, times } = rateCheck(times, i * 1000, rules));
check('5 аккаунтов за час — можно', [allowed, times.length], [true, 5]);
({ allowed, times } = rateCheck(times, 6_000, rules));
check('шестой в тот же час — нельзя', allowed, false);
({ allowed, times } = rateCheck(times, HOUR + 10_000, rules));
check('через час — снова можно', allowed, true);
const day = Array.from({ length: 20 }, (_, i) => i * 2 * HOUR / 3);
check('20 за сутки — больше нельзя, даже если в этот час мало', rateCheck(day, 14 * HOUR, rules).allowed, false);
check('через сутки — можно', rateCheck(day, 40 * HOUR, rules).allowed, true);
