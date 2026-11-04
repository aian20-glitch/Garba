// Проверки подсказок приложению в shah/view.ts (этап 3, 04.11.2026): какими наборами карт игрок
// может зайти (§6) и побить (§7, §10). Сервер решает — приложение только включает кнопки.

import { check, section } from './check.js';
import { beatOptions, leadOptions, shahView } from '../src/shah/view.js';
import { cards, lead, restAfter, setup } from './shah-helpers.js';

const sorted = (sets: string[][]) => sets.map((s) => [...s].sort().join(' ')).sort();

section('ШАХ: подсказка — чем можно зайти (§6)');
{
  const hand = cards('8♥ 8♣ 10♥ K♥ 6♣ A♠');
  const all = leadOptions(hand, 6);
  // 6 одиночных + черви по 2–3 (8♥ 10♥ K♥: 3 пары и тройка) + крести 8♣ 6♣ + две восьмёрки.
  check('всего 12 заходов', all.length, 12);
  check('две восьмёрки — можно', sorted(all).includes('clubs-8 hearts-8'), true);
  check('три черви разных достоинств — можно', sorted(all).includes('hearts-10 hearts-8 hearts-K'), true);
  check('8♥ + Т♠ (разные масть и достоинство) — нельзя', sorted(all).includes('hearts-8 spades-A'), false);
  check('не больше max (вопрос 8): max 1 — только по одной', leadOptions(hand, 1).every((s) => s.length === 1), true);
  check('max 1 — шесть вариантов', leadOptions(hand, 1).length, 6);
}

section('ШАХ: подсказка — чем можно побить (§7, §10), козырь ♠');
{
  const hand = cards('8♥ 8♣ 10♥ K♥ 6♣ A♠');
  check('10♥: король ♥ не бьёт (10 старше), бьют Т♠ (козырь) и ШАХ — сначала дешёвый', beatOptions(hand, cards('10♥'), 'spades'), [['spades-A'], ['clubs-6']]);
  check('две карты 8♦ 7♦ — только Т♠ и ШАХ вместе', beatOptions(hand, cards('8♦ 7♦'), 'spades'), [['clubs-6', 'spades-A']]);
  check('9♥: бьют 10♥, К♥, Т♠ и ШАХ — четыре варианта', beatOptions(hand, cards('9♥'), 'spades').length, 4);
  check('9♥: дешевле всех — К♥ (не козырь, младше 10)', beatOptions(hand, cards('9♥'), 'spades')[0], ['hearts-K']);
  check('козырный туз бьёт только ШАХ', beatOptions(cards('K♠ 6♣ 7♥'), cards('A♠'), 'spades'), [['clubs-6']]);
  check('нечем — пусто', beatOptions(cards('7♥ 8♥'), cards('A♠'), 'spades'), []);
}

section('ШАХ: подсказки — только тому, чей ход');
{
  const H = [cards('10♠ 6♣ 9♥ 7♦ 8♦ 9♦'), cards('A♠ K♠ A♥ 7♣ J♦ Q♦')];
  let m = setup(2, H, restAfter(H, cards('7♠'))); // козырь ♠, заходит A (сосед справа от сдающего B)
  check('A заходит: варианты есть', shahView(m, 'A').myLeadOptions.length > 0, true);
  check('B ждёт: вариантов нет', [shahView(m, 'B').myLeadOptions, shahView(m, 'B').myBeatOptions], [[], []]);
  check('зрителю — ничего', [shahView(m, null).myLeadOptions, shahView(m, null).myBeatOptions], [[], []]);
  m = lead(m, 'A', '9♥');
  const b = shahView(m, 'B');
  check('B бьёт 9♥: Т♥ или козыри К♠ / Т♠ — дешевле Т♥', [b.myBeatOptions.length, b.myBeatOptions[0]], [3, ['hearts-A']]);
  check('A теперь ждёт — у него вариантов нет', shahView(m, 'A').myBeatOptions, []);
}
