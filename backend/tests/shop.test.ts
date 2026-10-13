// Проверки shop.ts — магазин за игровые монеты (RULES.md §17, 13.10.2026). Запуск: npm test

import { check, section } from './check.js';
import { createAccount, deleteAccountData, openDb } from '../src/accounts.js';
import { addReaction, REACTIONS, PHRASES, type ReactionEntry } from '../src/reactions.js';
import {
  buyError,
  equipError,
  lookOf,
  ownedItems,
  PACK_CONTENT,
  packOf,
  recordPurchase,
  setEquipped,
  SHOP_ITEMS,
  shopItem,
  shopSales,
} from '../src/shop.js';

section('магазин: витрина (§17)');
check('21 вещь: 4 рамки, 4 рубашки, 4 сукна, 3 эффекта, 3 набора, титулов нет',
  ['frame', 'back', 'cloth', 'effect', 'pack', 'title'].map((k) => SHOP_ITEMS.filter((i) => i.kind === k).length),
  [4, 4, 4, 3, 3, 0]);
check('цены владельца: рамки 8 000 / 15 000 / 40 000 / 250 000',
  SHOP_ITEMS.filter((i) => i.kind === 'frame').map((i) => i.price), [8_000, 15_000, 40_000, 250_000]);
check('самое дорогое — сукно «Дворец» за 300 000', [...SHOP_ITEMS].sort((a, b) => b.price - a.price)[0].id, 'cloth_akorda');
check('наборы: Тролль и Подкол — 100 000, Насмешка — 200 000 (решение владельца, 14.10.2026)',
  SHOP_ITEMS.filter((i) => i.kind === 'pack').map((i) => i.price), [100_000, 100_000, 200_000]);
check('id вещей не повторяются', new Set(SHOP_ITEMS.map((i) => i.id)).size, SHOP_ITEMS.length);
const packItems = Object.values(PACK_CONTENT).flat();
check('смайлики наборов не совпадают с обычными и между собой',
  [packItems.some((e) => (REACTIONS as readonly string[]).includes(e) || (PHRASES as readonly string[]).includes(e)),
    new Set(packItems).size === packItems.length], [false, true]);
check('у каждого набора в витрине есть содержимое', SHOP_ITEMS.filter((i) => i.kind === 'pack').every((i) => PACK_CONTENT[i.id]?.length > 0), true);
check('клоун — из набора «Тролль», овца — из «Насмешки», 👍 — обычный', [packOf('🤡'), packOf('🐑'), packOf('👍')], ['pack_troll', 'pack_mazak', null]);

section('магазин: купить');
check('хватает монет — можно', buyError('frame_kumis', 8_000, []), null);
check('на 100 меньше — не хватает', buyError('frame_kumis', 7_900, []), 'not enough coins');
check('уже куплено — второй раз нельзя', buyError('frame_kumis', 50_000, ['frame_kumis']), 'already owned');
check('нет такой вещи', [buyError('title_khan', 1e9, []), buyError(undefined, 1e9, [])], ['unknown item', 'unknown item']);

section('магазин: надеть и снять');
check('надеть купленное', equipError('frame', 'frame_kumis', ['frame_kumis']), null);
check('не купил — нельзя', equipError('frame', 'frame_khan', ['frame_kumis']), 'not owned');
check('рубашку на место рамки — нельзя', equipError('frame', 'back_dala', ['back_dala']), 'wrong slot');
check('набор не надевается', equipError('pack', 'pack_troll', ['pack_troll']), 'bad slot');
check('снять (null) — всегда можно', equipError('cloth', null, []), null);
check('нет такого места', equipError('hat', null, []), 'bad slot');

section('магазин: наборы смайликов за столом');
check('не купил «Тролль» — клоуна слать нельзя', addReaction([], 'playing', 'a', '🤡', 0), 'not owned');
check('купил — можно', (addReaction([], 'playing', 'a', '🤡', 0, ['pack_troll']) as ReactionEntry[])[0].emoji, '🤡');
check('купил «Тролль», а стикер «Насмешки» — нельзя', addReaction([], 'playing', 'a', '🐑', 0, ['pack_troll']), 'not owned');
check('фраза «Подкол» — купившему', (addReaction([], 'lobby', 'a', 'Кон мой!', 0, ['pack_podkol']) as ReactionEntry[])[0].emoji, 'Кон мой!');
check('обычные смайлики — всем, как раньше', Array.isArray(addReaction([], 'lobby', 'a', '👍', 0)), true);

section('магазин: база');
const db = openDb(':memory:');
const a = createAccount(db, 'Айдар', null).account;
const b = createAccount(db, 'Дана', null).account;
check('сначала ничего не куплено и не надето', [ownedItems(db, a.id), lookOf(db, a.id)],
  [[], { frame: null, back: null, cloth: null, effect: null }]);
recordPurchase(db, a.id, shopItem('frame_muiz')!, 1);
recordPurchase(db, a.id, shopItem('cloth_syrmak')!, 2);
recordPurchase(db, b.id, shopItem('frame_muiz')!, 3);
setEquipped(db, a.id, 'frame', 'frame_muiz');
setEquipped(db, a.id, 'cloth', 'cloth_syrmak');
check('куплено по порядку', ownedItems(db, a.id), ['frame_muiz', 'cloth_syrmak']);
check('надето', lookOf(db, a.id), { frame: 'frame_muiz', back: null, cloth: 'cloth_syrmak', effect: null });
setEquipped(db, a.id, 'cloth', null);
check('сукно снято — снова обычное', lookOf(db, a.id).cloth, null);
check('продажи: рога купили дважды — 80 000 сгорело', shopSales(db)[0], { itemId: 'frame_muiz', count: 2, coins: 80_000 });
let twice = 'нет ошибки';
try {
  recordPurchase(db, a.id, shopItem('frame_muiz')!, 4);
} catch {
  twice = 'ошибка';
}
check('одну вещь дважды база не запишет', twice, 'ошибка');
deleteAccountData(db, a.id);
check('удалил аккаунт — покупок и надетого нет', [ownedItems(db, a.id), lookOf(db, a.id).frame], [[], null]);
check('у Даны всё осталось', ownedItems(db, b.id), ['frame_muiz']);
