// Проверки reactions.ts. Запуск всех проверок: npm test

import { check, section } from './check.js';
import { addReaction, isPlayerCode, isRoomCode, REACTIONS_KEPT, type ReactionEntry } from '../src/reactions.js';

section('реакции и смайлики (§14)');
check('во время торгов — нельзя', addReaction([], 'bidding', 'a', '👍', 0), 'not now');
check('во время розыгрыша — нельзя', addReaction([], 'playing', 'a', '👍', 0), 'not now');
check('свой текст — нельзя, это был бы чат', addReaction([], 'round_done', 'a', 'привет', 0), 'unknown emoji');

let list = addReaction([], 'round_done', 'a', '👍', 1_000) as ReactionEntry[];
check('после раздачи — можно', list, [{ id: 1, playerId: 'a', emoji: '👍', at: 1_000 }]);
check('тот же игрок через секунду — слишком часто', addReaction(list, 'round_done', 'a', '😂', 2_000), 'too fast');
list = addReaction(list, 'round_done', 'b', '😂', 2_000) as ReactionEntry[];
check('другой игрок — можно сразу', list.map((r) => [r.id, r.playerId]), [[1, 'a'], [2, 'b']]);
list = addReaction(list, 'room_done', 'a', '🎉', 3_100) as ReactionEntry[];
check('через 2 секунды — снова можно; после закрытия комнаты тоже', list.at(-1), { id: 3, playerId: 'a', emoji: '🎉', at: 3_100 });

let many: ReactionEntry[] = [];
for (let i = 0; i < 30; i++) many = addReaction(many, 'round_done', `p${i}`, '🔥', i) as ReactionEntry[];
check('комната помнит только последние 20, номера продолжают расти',
  [many.length, many[0].id, many.at(-1)!.id], [REACTIONS_KEPT, 11, 30]);

section('коды в ссылках-приглашениях');
check('номер комнаты — 5 цифр', [isRoomCode('12345'), isRoomCode('1234'), isRoomCode('12a45')], [true, false, false]);
check('код игрока', [isPlayerCode('K7MP2X'), isPlayerCode('k7mp2x'), isPlayerCode('<b>xx')], [true, false, false]);
