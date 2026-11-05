// Проверки shah/engine.ts и shah/view.ts — партия ШАХ по шагам (SHAH_RULES.md).
// Примеры — из задания владельца 04.11.2026; где правило ещё не решено — оба варианта.

import { check, section } from './check.js';
import { createShahDeck, pointsOf } from '../src/shah/cards.js';
import {
  act,
  awaitedOf,
  createMatch,
  leadLimitFor,
  sideOf,
  startParty,
  type ShahFormat,
  type ShahMatch,
  type ShahOptions,
} from '../src/shah/engine.js';
import { shahView } from '../src/shah/view.js';
import {
  beat,
  card,
  cards,
  cardsInPlay,
  closed,
  craftEndgame,
  dealerDeckFor,
  ids,
  lead,
  leaks,
  play,
  PLAYERS,
  refused,
  restAfter,
  seeded,
  setup,
  shuffled,
  throws,
} from './shah-helpers.js';

const party = (m: ShahMatch) => m.party!;
const lastMove = (m: ShahMatch) => party(m).trick!.moves.at(-1)!;

section('ШАХ: четыре формата — раздача по 6, колода, стороны');
const DECK_LEFT: Record<ShahFormat, number> = { 2: 24, 3: 18, 4: 12, 6: 0 };
const SIDES: Record<ShahFormat, number[]> = { 2: [0, 1], 3: [0, 1, 2], 4: [0, 1, 0, 1], 6: [0, 1, 0, 1, 0, 1] };
for (const format of [2, 3, 4, 6] as ShahFormat[]) {
  const random = seeded(format);
  const match = createMatch(PLAYERS.slice(0, format), dealerDeckFor(format - 1));
  const m = startParty(match, shuffled(createShahDeck(), random), random);
  const p = party(m);
  check(`${format}: у каждого по 6 карт`, p.hands.map((h) => h.length), new Array(format).fill(6));
  check(`${format}: в колоде ${DECK_LEFT[format]}`, p.deck.length, DECK_LEFT[format]);
  check(`${format}: все 36 карт на месте`, cardsInPlay(m), 36);
  check(`${format}: стороны по местам`, PLAYERS.slice(0, format).map((_, s) => sideOf(format, s)), SIDES[format]);
  check(`${format}: козырь — масть открытой карты`, p.trump, p.openCard.suit);
  check(`${format}: сдающий — последнее место, первым заходит сосед справа (место 0)`, [p.dealerSeat, p.turnSeat, p.awaiting], [format - 1, 0, 'lead']);
  check(`${format}: штрафов пока нет`, m.totals, new Array(format === 3 ? 3 : 2).fill(0));
}
check('1 игрок — нельзя', throws(() => createMatch(['A'], dealerDeckFor(0))), true);
check('5 игроков — нельзя', throws(() => createMatch(PLAYERS.slice(0, 5), dealerDeckFor(0))), true);
check('колода не из 36 разных карт — нельзя', throws(() => startParty(createMatch(['A', 'B'], dealerDeckFor(0)), createShahDeck().slice(1))), true);

section('ШАХ: первый сдающий — через туза');
{
  const m = createMatch(PLAYERS.slice(0, 4), dealerDeckFor(2));
  check('первый туз выпал месту 2 — он и сдаёт', m.firstDealer.seat, 2);
  check('карты открывали по кругу с места 0 до туза', m.firstDealer.reveals.map((r) => r.seat), [0, 1, 2]);
  check('последняя открытая — туз', m.firstDealer.reveals.at(-1)!.card.rank, 'A');
  const deck = [...createShahDeck().filter((c) => c.rank !== 'A').slice(0, 5), card('A♥')];
  const full = [...deck, ...createShahDeck().filter((c) => !ids(deck).includes(c.id))];
  check('туз шестой картой при 4 игроках — сдаёт место 1', createMatch(PLAYERS.slice(0, 4), full).firstDealer.seat, 1);
}

// ——— Пример владельца на 4 игроках: зашли двумя восьмёрками ———
// Сдающий D (место 3), первым заходит A. Команды: A и C — сторона 0, B и D — сторона 1.
const H1 = [
  cards('8♥ 8♣ J♥ A♣ 6♦ 7♦'), // A
  cards('6♥ 7♥ 9♣ J♦ 10♦ A♦'), // B
  cards('Q♥ K♥ 9♦ 8♦ J♣ 7♣'), // C
  cards('9♥ 10♣ 10♥ 6♣ K♦ Q♦'), // D
];
const R1 = cards('7♠ 6♠ 8♠ 9♠ 10♠ J♠ Q♠ K♠ A♠ A♥ K♣ Q♣'); // 7♠ — открытая, козырь ♠

function toDBeat(options: Partial<ShahOptions> = {}) {
  let m = setup(4, H1, R1, options);
  m = lead(m, 'A', '8♥ 8♣');
  m = closed(m, 'B', '6♥ 7♥');
  m = closed(m, 'C', '9♦ 8♦');
  return beat(m, 'D', '9♥ 10♣');
}

section('ШАХ: козырь при 2/3/4 — открытая карта колоды');
{
  const m = setup(4, H1, R1);
  check('козырь ♠ по открытой 7♠', [party(m).trump, party(m).deckOpenCard?.id], ['spades', 'spades-7']);
  check('открытая карта лежит сверху колоды (вариант «а»)', party(m).deck[0].id, 'spades-7');
  const bottom = setup(4, H1, R1, { firstTrumpCard: 'bottom' });
  check('вариант «б»: открытая карта — под низом колоды', party(bottom).deck.at(-1)!.id, 'spades-7');
  check('вариант «б»: козырь тот же — ♠', party(bottom).trump, 'spades');
}

section('ШАХ: заход — проверки');
{
  const m = setup(4, H1, R1);
  check('ходить не в свою очередь — нельзя', refused(m, 'B', { type: 'lead', cardIds: ['hearts-6'] }), 'not your turn');
  check('8♥ + Т♣ (разные масть и достоинство) — нельзя', refused(m, 'A', { type: 'lead', cardIds: ids(cards('8♥ A♣')) }), 'bad lead');
  check('чужой картой — нельзя', refused(m, 'A', { type: 'lead', cardIds: ['spades-9'] }), 'card not in hand');
  check('одну карту дважды — нельзя', refused(m, 'A', { type: 'lead', cardIds: ['hearts-8', 'hearts-8'] }), 'bad cards');
  check('игрока нет за столом — нельзя', refused(m, 'Z', { type: 'lead', cardIds: ['hearts-8'] }), 'player is not in this match');
  check('старое состояние после отказа не изменилось', party(m).hands[0].length, 6);
}

section('ШАХ: перебивание — пример с двумя восьмёрками');
{
  let m = setup(4, H1, R1);
  m = lead(m, 'A', '8♥ 8♣');
  check('после захода двумя картами бьют двумя: ждём B', [party(m).turnSeat, party(m).awaiting, party(m).trick!.n], [1, 'beat', 2]);
  check('одной картой две не побить', refused(m, 'B', { type: 'beat', cardIds: ['clubs-9'] }), 'wrong card count');
  check('9♣ бьёт 8♣, но 7♥ не бьёт 8♥ — не отбился', refused(m, 'B', { type: 'beat', cardIds: ids(cards('9♣ 7♥')) }), 'cannot beat');
  m = closed(m, 'B', '6♥ 7♥');
  check('B не стал бить — две карты рубашкой, выбыл', [lastMove(m).kind, party(m).trick!.out[1]], ['closed', true]);
  m = closed(m, 'C', '9♦ 8♦');
  m = beat(m, 'D', '9♥ 10♣');
  check('D побил: его комбинация сверху', party(m).trick!.topSeat, 3);
  check('D накрыл 9♥ → 8♥, 10♣ → 8♣', (lastMove(m) as { covers: string[] }).covers, ['hearts-8', 'clubs-8']);
  check('второй круг: снова очередь A — он может перебить D', [party(m).turnSeat, party(m).awaiting, party(m).trick!.circle], [0, 'beat', 2]);
  check('выбывший B к борьбе не возвращается (не его очередь)', refused(m, 'B', { type: 'beat', cardIds: ids(cards('9♣ J♦')) }), 'not your turn');
  m = beat(m, 'A', 'J♥ A♣', '9♥ 10♣');
  check('A перебил D (В♥ на 9♥, Т♣ на 10♣)', party(m).trick!.topSeat, 0);
  check('выбывший B в новом круге кладёт ещё две рубашкой', [party(m).turnSeat, party(m).awaiting], [1, 'closed']);
  check('бить ему уже нельзя', refused(m, 'B', { type: 'beat', cardIds: ids(cards('9♣ J♦')) }), 'wrong move');
  check('рубашкой — ровно две', refused(m, 'B', { type: 'closed', cardIds: ['clubs-9'] }), 'wrong card count');
  m = closed(m, 'B', '9♣ J♦');
  check('рубашки выбывшего — причина «out»', (lastMove(m) as { reason: string }).reason, 'out');
  m = closed(m, 'C', 'J♣ 7♣');
  check('D снова может перебить', [party(m).turnSeat, party(m).awaiting], [3, 'beat']);

  // Закрытые карты: другим — только число, хозяину — сами карты.
  const viewA = shahView(m, 'A');
  const viewB = shahView(m, 'B');
  const bClosed = viewA.party!.trick!.moves.filter((x) => x.seat === 1);
  check('A видит закрытые карты B только числом', bClosed.map((x) => [x.kind, 'cards' in x]), [['closed', false], ['closed', false]]);
  check('B видит свои закрытые карты', viewB.party!.trick!.moves.filter((x) => x.seat === 1).map((x) => ('cards' in x ? ids(x.cards!) : [])), [['hearts-6', 'hearts-7'], ['clubs-9', 'diamonds-J']]);
  check('ничьих закрытых карт и рук не видно A', leaks(m, 'A'), []);
  check('… и B, C, D', [leaks(m, 'B'), leaks(m, 'C'), leaks(m, 'D')], [[], [], []]);
  check('… и зрителю', leaks(m, null), []);
  check('в JSON для A нет 6♥ и 7♥ B', JSON.stringify(viewA).includes('hearts-6') || JSON.stringify(viewA).includes('hearts-7'), false);

  m = beat(m, 'D', '10♥ 6♣');
  const p = party(m);
  check('ШАХ: комбинация D с 6♣ — взятка сразу его', [p.lastTrick?.winnerSeat, p.lastTrick?.shah], [3, true]);
  check('ШАХ последним в круге — докладывать некому (вариант «а»)', p.lastTrick?.moves.length, 8);
  check('забрал все 16 карт стола, и рубашки тоже', p.piles.map((x) => x.length), [0, 16]);
  check('команда: в стопке B и D — 37 очков (13 + 2 + 2 + 20)', pointsOf(p.piles[1]), 37);
  check('очки стопок по ходу партии не видны', shahView(m, 'A').party!.result, null);
  check('добор по 2, по одной, с выигравшего D: D A B C D A B C', p.lastDraw?.seats, [3, 0, 1, 2, 3, 0, 1, 2]);
  check('у всех по 4 карты: ровно 2 добрали (вариант «а»)', p.hands.map((h) => h.length), [4, 4, 4, 4]);
  check('в колоде осталось 4', p.deck.length, 4);
  check('последним взял C — показал К♠, козырь ♠', [p.lastDrawSeat, p.trumpCard.id, p.trump], [2, 'spades-K', 'spades']);
  check('показанные карты: 7♠ у D (взял открытую), К♠ у C', p.shown, [{ cardId: 'spades-7', seat: 3 }, { cardId: 'spades-K', seat: 2 }]);
  check('открытая карта осталась у взявшего — у него в руке', p.hands[3].some((c) => c.id === 'spades-7'), true);
  check('все видят показанную у C карту', shahView(m, 'A').players[2].shown.map((c) => c.id), ['spades-K']);
  check('следующим заходит выигравший взятку D', [p.turnSeat, p.awaiting], [3, 'lead']);

  // Вторая взятка: напарник бьёт напарника, козырь меняется, колода кончается.
  m = lead(m, 'D', 'Q♦');
  m = closed(m, 'A', '6♦');
  m = beat(m, 'B', 'A♦');
  check('напарник может перебить напарника: B бьёт Д♦ своего D', party(m).trick!.topSeat, 1);
  m = beat(m, 'C', '9♠');
  check('9♠ (козырь) бьёт Т♦', party(m).trick!.topSeat, 2);
  m = beat(m, 'D', '10♠');
  check('A выбыл — докладывает одну рубашкой', [party(m).turnSeat, party(m).awaiting], [0, 'closed']);
  m = closed(m, 'A', '7♦');
  check('B (Д♠ и 8♠ слабее 10♠) — решает сам', [party(m).turnSeat, party(m).awaiting], [1, 'beat']);
  m = closed(m, 'B', '10♦');
  m = closed(m, 'C', 'Q♥');
  const p2 = party(m);
  check('бороться некому — взятку забрал D', p2.lastTrick?.winnerSeat, 3);
  check('добор по 1 с D: D A B C', p2.lastDraw?.seats, [3, 0, 1, 2]);
  check('C показал Д♣ — козырь сменился на ♣', [p2.trump, p2.trumpCard.id, p2.lastDrawSeat], ['clubs', 'clubs-Q', 2]);
  check('колода кончилась', p2.deck.length, 0);

  // Доигрываем: все отказываются бить, D забирает всё.
  while (party(m).phase !== 'done') {
    const aw = awaitedOf(m)!;
    const hand = party(m).hands[aw.seat];
    m = aw.awaiting === 'lead'
      ? play(m, PLAYERS[aw.seat], { type: 'lead', cardIds: [hand[0].id] })
      : play(m, PLAYERS[aw.seat], { type: 'closed', cardIds: ids(hand.slice(0, aw.min)) });
  }
  const done = party(m);
  check('колода кончилась — последний козырь ♣ до конца партии', done.trump, 'clubs');
  check('партия кончилась, когда у всех кончились карты', done.hands.map((h) => h.length), [0, 0, 0, 0]);
  check('очки: 0 : 120 — в сумме 120', done.result?.points, [0, 120]);
  check('A и C (0 очков) → −12', [done.result?.penalties, m.totals], [[-12, 0], [-12, 0]]);
  check('в конце видны очки, но не стопки (вариант «а»)', [shahView(m, 'A').party!.result?.points, shahView(m, 'A').party!.piles], [[0, 120], null]);
  check('следующую партию сдаёт C — последним взял карту из колоды (а не D, взявший последнюю взятку)', m.dealerSeat, 2);
  const next = startParty(m, createShahDeck());
  check('новая партия: сдаёт C, первым заходит D', [party(next).dealerSeat, party(next).turnSeat, party(next).number], [2, 3, 2]);
  check('ходы после конца партии не принимаются', refused(m, 'D', { type: 'lead', cardIds: ['spades-A'] }), 'no party in progress');
}

section('ШАХ: конец взятки — вопрос 5');
{
  const early = closed(toDBeat(), 'A', '6♦ 7♦');
  check('«а»: A не бьёт — бороться некому, D забрал сразу (10 карт)', [party(early).lastTrick?.winnerSeat, party(early).piles[1].length], [3, 10]);
  let full = closed(toDBeat({ trickEnd: 'fullCircle' }), 'A', '6♦ 7♦');
  check('«б»: круг до конца — B кладёт ещё две рубашкой', [party(full).turnSeat, party(full).awaiting], [1, 'closed']);
  full = closed(full, 'B', '9♣ J♦');
  full = closed(full, 'C', 'J♣ 7♣');
  check('«б»: потом D забирает 14 карт', [party(full).lastTrick?.winnerSeat, party(full).piles[1].length], [3, 14]);
}

section('ШАХ: после ШАХ — вопрос 6');
{
  let m = beat(toDBeat({ afterShah: 'everyone' }), 'A', 'J♥ A♣', '9♥ 10♣');
  m = closed(m, 'B', '9♣ J♦');
  m = closed(m, 'C', 'J♣ 7♣');
  m = beat(m, 'D', '10♥ 6♣');
  check('«б»: после ШАХ D все по разу — у A, B, C по 2 карты, кладут все сами', party(m).piles[1].length, 22);
  check('«б»: в руках у A, B, C пусто, добрали по 2', party(m).hands.map((h) => h.length), [2, 2, 2, 4]);
}

// ——— Второй пример: ШАХ в первом круге ———
const H2 = [cards('9♠ 7♠ 8♠ 6♠ J♠ Q♠'), cards('6♣ 7♣ 8♣ 9♣ J♣ Q♣'), cards('6♦ 7♦ 8♦ 9♦ J♦ Q♦'), cards('6♥ 7♥ 8♥ 9♥ J♥ Q♥')];
const R2 = cards('K♥ K♠ 10♠ A♠ K♣ 10♣ A♣ K♦ 10♦ A♦ 10♥ A♥'); // К♥ — открытая, козырь ♥

section('ШАХ: 6♣ на отбое — неперебиваемая комбинация');
{
  let m = setup(4, H2, R2);
  m = lead(m, 'A', '9♠');
  m = beat(m, 'B', '6♣');
  check('B побил ШАХом: дальше только рубашкой', [party(m).trick!.shah, party(m).turnSeat, party(m).awaiting], [true, 2, 'closed']);
  check('C не может бить комбинацию с ШАХ', refused(m, 'C', { type: 'beat', cardIds: ['diamonds-Q'] }), 'wrong move');
  m = closed(m, 'C', '6♦');
  check('даже козырем ♥ — нельзя', refused(m, 'D', { type: 'beat', cardIds: ['hearts-Q'] }), 'wrong move');
  check('обязан положить рубашкой', party(m).awaiting, 'closed');
  m = closed(m, 'D', '6♥');
  const p = party(m);
  check('«а»: докладывают C и D (зашедший A — нет): B забрал 4 карты', [p.lastTrick?.winnerSeat, p.piles[1].length], [1, 4]);
  check('ШАХ взял взятку — B заходит следующим', [p.turnSeat, p.awaiting], [1, 'lead']);
  check('добор с B: B взял открытую К♥ первым', [p.lastDraw?.seats, p.shown[0]], [[1, 2, 3, 0], { cardId: 'hearts-K', seat: 1 }]);
  check('последним взял A — Т♠: козырь сменился с ♥ на ♠', [p.trump, p.lastDrawSeat], ['spades', 0]);

  let all = setup(4, H2, R2, { afterShah: 'everyone' });
  all = lead(all, 'A', '9♠');
  all = beat(all, 'B', '6♣');
  check('«б»: обязаны C, D и зашедший A', party(all).trick!.mustClose, [2, 3, 0]);
  all = closed(closed(closed(all, 'C', '6♦'), 'D', '6♥'), 'A', '7♠');
  check('«б»: B забрал 5 карт', party(all).piles[1].length, 5);

  let lead1 = setup(4, H2, R2, { drawStart: 'leader' });
  lead1 = closed(closed(beat(lead(lead1, 'A', '9♠'), 'B', '6♣'), 'C', '6♦'), 'D', '6♥');
  check('вопрос 10 «б»: добор с зашедшего A — A B C D', [party(lead1).lastDraw?.seats, party(lead1).lastDrawSeat], [[0, 1, 2, 3], 3]);

  let bottom = setup(4, H2, R2, { firstTrumpCard: 'bottom' });
  bottom = closed(closed(beat(lead(bottom, 'A', '9♠'), 'B', '6♣'), 'C', '6♦'), 'D', '6♥');
  check('вопрос 1 «б»: открытая К♥ ещё под колодой', party(bottom).deckOpenCard?.id, 'hearts-K');
  check('вопрос 1 «б»: первым взяли К♠, а не К♥', party(bottom).hands[1].some((c) => c.id === 'spades-K'), true);
}

// ——— Двое: туз козырей, ШАХ, отказ, 6♣ в заходе ———
const H3 = [cards('10♠ 6♣ 9♥ 7♦ 8♦ 9♦'), cards('A♠ K♠ A♥ 7♣ J♦ Q♦')];
const R3 = restAfter(H3, cards('7♠')); // козырь ♠

section('ШАХ: двое — козырный туз, ШАХ во втором круге');
{
  let m = setup(2, H3, R3);
  m = lead(m, 'A', '10♠');
  check('К♠ козырную 10♠ не бьёт', refused(m, 'B', { type: 'beat', cardIds: ['spades-K'] }), 'cannot beat');
  m = beat(m, 'B', 'A♠');
  check('Т♠ бьёт 10♠', party(m).trick!.topSeat, 1);
  m = beat(m, 'A', '6♣');
  check('A бьёт козырного туза ШАХом — B обязан рубашкой', [party(m).trick!.shah, party(m).turnSeat, party(m).awaiting], [true, 1, 'closed']);
  check('B ШАХ не перебить', refused(m, 'B', { type: 'beat', cardIds: ['spades-K'] }), 'wrong move');
  m = closed(m, 'B', '7♣');
  check('A забрал 4 карты: 10♠ Т♠ 6♣ 7♣ = 21 очко', [party(m).piles[0].length, pointsOf(party(m).piles[0])], [4, 21]);
  check('A заходит следующим', [party(m).turnSeat, party(m).awaiting], [0, 'lead']);
}

section('ШАХ: отказ бить — по желанию');
{
  let m = setup(2, H3, R3);
  m = lead(m, 'A', '9♥');
  check('у B есть Т♥ — побить может', shahView(m, 'B').myCanBeat, true);
  m = closed(m, 'B', 'J♦');
  const p = party(m);
  check('B отказался — A забирает свою и закрытую', [p.lastTrick?.winnerSeat, p.piles[0].length], [0, 2]);
  check('закрытая В♦ не видна A', JSON.stringify(shahView(m, 'A')).includes('diamonds-J'), false);
  check('… и зрителю', JSON.stringify(shahView(m, null)).includes('diamonds-J'), false);
  check('B свою закрытую видит', JSON.stringify(shahView(m, 'B')).includes('diamonds-J'), true);
  check('ничего лишнего никому', [leaks(m, 'A'), leaks(m, 'B'), leaks(m, null)], [[], [], []]);
  check('зритель не видит ничьих рук', shahView(m, null).myHand, []);
}

section('ШАХ: 6♣ в заходе — обычная шестёрка');
{
  let m = setup(2, H3, R3);
  m = lead(m, 'A', '6♣');
  m = beat(m, 'B', '7♣');
  check('7♣ бьёт 6♣ из захода', party(m).trick!.topSeat, 1);
  check('A может перебить козырем', shahView(m, 'A').myCanBeat, true);
  m = beat(m, 'A', '10♠');
  check('10♠ бьёт 7♣ — сверху снова A', party(m).trick!.topSeat, 0);
}

section('ШАХ: при 6 игроках — козырь до раздачи, вся колода на руках');
{
  const deck = shuffled(createShahDeck(), seeded(66));
  const m = startParty(createMatch(PLAYERS, dealerDeckFor(5)), deck);
  const p = party(m);
  check('открытая карта — последняя в колоде, её получил сдающий', [p.openCard.id, p.hands[5].some((c) => c.id === p.openCard.id)], [deck[35].id, true]);
  check('все видят, что она у сдающего (вариант «а»)', p.shown, [{ cardId: deck[35].id, seat: 5 }]);
  check('козырь — её масть, колоды для добора нет', [p.trump, p.deck.length, p.deckOpenCard], [deck[35].suit, 0, null]);
  const shuffledOpen = startParty(createMatch(PLAYERS, dealerDeckFor(5), { sixOpenCard: 'shuffle' }), deck, () => 0);
  check('вариант «б»: у кого открытая карта — не показано', [party(shuffledOpen).openCard.id, party(shuffledOpen).shown], [deck[0].id, []]);

  let t = m;
  const leadCard = party(t).hands[0][0];
  t = play1(t, 'A', 'lead', [leadCard.id]);
  for (const id of ['B', 'C', 'D', 'E', 'F']) t = play1(t, id, 'closed', [party(t).hands[PLAYERS.indexOf(id)][0].id]);
  check('все отказались — A забрал 6 карт, добора нет, козырь не меняется', [party(t).piles[0].length, party(t).lastDraw, party(t).trump], [6, null, p.trump]);
  check('у всех по 5', party(t).hands.map((h) => h.length), [5, 5, 5, 5, 5, 5]);
}

function play1(m: ShahMatch, player: string, type: 'lead' | 'closed', cardIds: string[]): ShahMatch {
  const r = act(m, player, { type, cardIds });
  if (!r.ok) throw new Error(r.error);
  return r.match;
}

section('ШАХ: карт меньше, чем надо — вопрос 7; заход не больше — вопрос 8');
{
  // После первой взятки примера 1: у всех по 4, заходит D. У B оставляем одну карту.
  let m = toDBeat();
  m = beat(m, 'A', 'J♥ A♣', '9♥ 10♣');
  m = closed(closed(m, 'B', '9♣ J♦'), 'C', 'J♣ 7♣');
  m = beat(m, 'D', '10♥ 6♣');
  const crafted = structuredClone(m);
  const pb = party(crafted);
  pb.piles[1].push(...pb.hands[1].splice(1)); // у B только 10♦
  check('«а»: заходить можно всеми 4 картами', leadLimitFor(crafted, 3), 4);
  const minHand = structuredClone(crafted);
  minHand.options.leadLimit = 'minHand';
  check('«б»: не больше, чем у B (1 карта)', leadLimitFor(minHand, 3), 1);
  check('«б»: заход двумя — нельзя', refused(minHand, 'D', { type: 'lead', cardIds: ids(cards('K♦ Q♦')) }), 'lead too big');
  let s = lead(crafted, 'D', 'K♦ Q♦');
  s = closed(s, 'A', '6♠ J♠');
  const bMove = party(s).trick!.moves.find((x) => x.seat === 1)!;
  check('у B одна карта на две — бить не может, кладёт рубашкой все, что есть', [bMove.kind, (bMove as { reason: string }).reason, bMove.cards.length], ['closed', 'short', 1]);
  check('дальше решает C', [party(s).turnSeat, party(s).awaiting], [2, 'beat']);
}

section('ШАХ: конец партии без карт — вопрос 12');
{
  const base = startParty(createMatch(PLAYERS.slice(0, 3), dealerDeckFor(2)), createShahDeck());
  let m = craftEndgame(base, [cards('9♥'), cards('7♣ 8♣'), cards('7♦ 8♦')], 0);
  m = closed(closed(lead(m, 'A', '9♥'), 'B', '7♣'), 'C', '7♦');
  check('A взял взятку, но карт у него нет — заходит следующий, B', [party(m).lastTrick?.winnerSeat, party(m).turnSeat, party(m).awaiting], [0, 1, 'lead']);
  m = closed(lead(m, 'B', '8♣'), 'C', '8♦');
  check('у всех кончились карты — партия окончена', party(m).phase, 'done');
  check('очки сходятся: 120', party(m).result!.points.reduce((a, b) => a + b, 0), 120);

  let one = craftEndgame(base, [cards('9♥ 10♥'), cards('7♣'), []], 0);
  one = closed(lead(one, 'A', '9♥'), 'B', '7♣');
  check('карты остались только у A — бить некому, они сразу ему', [party(one).phase, party(one).leftover], ['done', { side: 0, count: 1 }]);
  check('10♥ ушла в стопку A', party(one).piles[0].some((c) => c.id === 'hearts-10'), true);

  const four = startParty(createMatch(PLAYERS.slice(0, 4), dealerDeckFor(3)), createShahDeck());
  let team = craftEndgame(four, [cards('9♥ 10♥'), cards('7♣'), cards('7♦ 8♦'), []], 0);
  team = closed(closed(lead(team, 'A', '9♥'), 'B', '7♣'), 'C', '7♦');
  check('карты остались только у команды A и C — всё ей', [party(team).phase, party(team).leftover], ['done', { side: 0, count: 2 }]);
}

section('ШАХ: штрафы в матче — ничья ×2 и немедленное поражение');
{
  const base = startParty(createMatch(['A', 'B'], dealerDeckFor(1)), createShahDeck());
  // 60 : 60 — ничья.
  let m = craftEndgame(base, [cards('6♥'), cards('7♥')], 0, 1, [cards('A♠ A♥ A♦ A♣ 10♠ K♠ J♠'), []]);
  m = beat(lead(m, 'A', '6♥'), 'B', '7♥');
  check('60:60 — ничья: штрафа нет, следующая ×2', [party(m).result?.points, party(m).result?.draw, m.totals, m.multiplier], [[60, 60], true, [0, 0], 2]);
  // Следующая партия 20 : 100 — штраф ×2.
  m = craftEndgame(startParty(m, createShahDeck()), [cards('6♥'), cards('7♥')], 0, 1, [cards('10♠ 10♦'), []]);
  m = beat(lead(m, 'A', '6♥'), 'B', '7♥');
  check('после ничьей 20:100 → −4 × 2 = −8, множитель снова ×1', [party(m).result?.penalties, m.totals, m.multiplier], [[-8, 0], [-8, 0], 1]);

  // Было −22, получил −4 → −26: матч окончен сразу.
  let end = craftEndgame(base, [cards('6♥'), cards('7♥')], 0, 1, [cards('10♠ 10♦'), []]);
  end.totals = [-22, 0];
  end = beat(lead(end, 'A', '6♥'), 'B', '7♥');
  check('−22 и −4 → −26: A проиграл матч', [end.totals, end.over, end.result], [[-26, 0], true, ['lose', 'win']]);
  check('после конца матча новую партию не начать', throws(() => startParty(end, createShahDeck())), true);
}

section('ШАХ: при 6 сдающий — по очереди');
{
  const base = startParty(createMatch(PLAYERS, dealerDeckFor(5)), createShahDeck());
  let m = craftEndgame(base, [cards('9♥'), cards('7♣'), [], [], [], []], 0);
  m = closed(lead(m, 'A', '9♥'), 'B', '7♣');
  check('партия окончена — следующий сдающий сосед справа: место 0', [party(m).phase, m.dealerSeat], ['done', 0]);
}

section('ШАХ: стопки в конце — вопрос 13');
{
  const base = startParty(createMatch(['A', 'B'], dealerDeckFor(1), { revealPilesAtEnd: true }), createShahDeck());
  let m = craftEndgame(base, [cards('6♥'), cards('7♥')], 0, 1, [cards('10♠ 10♦'), []]);
  m = closed(lead(m, 'A', '6♥'), 'B', '7♥');
  check('«б»: в конце партии стопки открыты всем', shahView(m, 'A').party!.piles?.map((x) => x.length), [4, 32]);
  check('«б»: и это не утечка — партия окончена', leaks(m, 'A'), []);
}
