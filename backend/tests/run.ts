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
import './lobbyTimer.test.js';
import './serverBots.test.js';
import './moderation.test.js';
import './telegram.test.js';
import './buyIn.test.js';
import './shrinkVote.test.js';
import './shop.test.js';
import './topUp.test.js';
import './share.test.js';
import './leaders.test.js';
import './spectators.test.js';
import './tournament.test.js';
import './tableTimer.test.js';
import './personalPause.test.js';
// Игра ШАХ (ветка shah, 04.11.2026) — SHAH_RULES.md.
import './shah-cards.test.js';
import './shah-score.test.js';
import './shah-engine.test.js';
import './shah-sim.test.js';
import './shah-rooms.test.js';
import { summary } from './check.js';

process.exit(summary() === 0 ? 0 : 1);
