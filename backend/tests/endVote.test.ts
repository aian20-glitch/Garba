// Проверки endVote.ts: закончить игру по общему согласию (RULES.md §12.3). Запуск: npm test

import { check, section } from './check.js';
import { canProposeEnd, endVoteOutcome, END_VOTE_MS } from '../src/endVote.js';

const players = ['Серик', 'Айдар', 'Дана', 'Ержан', 'Асель'];

section('кто и когда может предложить закончить игру (§12.3)');
check('после сыгранной раздачи — можно', canProposeEnd({ stage: 'round_done', voteActive: false, proposedIds: [], playerId: 'Серик' }), true);
check('при пересдаче — можно', canProposeEnd({ stage: 'awaiting_deal', voteActive: false, proposedIds: [], playerId: 'Серик' }), true);
check('посреди торгов и розыгрыша — нельзя', [canProposeEnd({ stage: 'bidding', voteActive: false, proposedIds: [], playerId: 'Серик' }), canProposeEnd({ stage: 'playing', voteActive: false, proposedIds: [], playerId: 'Серик' })], [false, false]);
check('уже идёт голосование — нельзя', canProposeEnd({ stage: 'round_done', voteActive: true, proposedIds: [], playerId: 'Дана' }), false);
check('Серик уже предлагал между этими раздачами — второй раз нельзя', canProposeEnd({ stage: 'round_done', voteActive: false, proposedIds: ['Серик'], playerId: 'Серик' }), false);
check('а Дана — может', canProposeEnd({ stage: 'round_done', voteActive: false, proposedIds: ['Серик'], playerId: 'Дана' }), true);

section('итог голосования — только единогласно (§12.3)');
const t0 = 1_000_000;
check('все «да» — заканчиваем', endVoteOutcome({ proposerId: 'Серик', yes: players, no: [], startedAt: t0 }, players, t0 + 5_000), 'ended');
check('одно «нет» — играем дальше', endVoteOutcome({ proposerId: 'Серик', yes: ['Серик', 'Айдар'], no: ['Дана'], startedAt: t0 }, players, t0 + 5_000), 'rejected');
check('ещё не все ответили — ждём', endVoteOutcome({ proposerId: 'Серик', yes: ['Серик', 'Айдар'], no: [], startedAt: t0 }, players, t0 + 5_000), 'pending');
check('не ответили за 30 секунд — как «нет»', endVoteOutcome({ proposerId: 'Серик', yes: ['Серик'], no: [], startedAt: t0 }, players, t0 + END_VOTE_MS), 'expired');
