// Запуск всех проверок: npm test
// Проверки чистых модулей backend по правилам из RULES.md — без сервера и без сети.

import './bidding.test.js';
import './deal.test.js';
import './garba-kon.test.js';
import './special.test.js';
import './play.test.js';
import './money.test.js';
import './vote.test.js';
import './accounts.test.js';
import './presence.test.js';
import './bonus.test.js';
import './stats.test.js';
import './avatars.test.js';
import './rating.test.js';
import './reactions.test.js';
import './endVote.test.js';
import './readyCheck.test.js';
import './seats.test.js';
import './turnTimer.test.js';
import './rateLimit.test.js';
import './openRooms.test.js';
import { summary } from './check.js';

process.exit(summary() === 0 ? 0 : 1);
