// Магазин за игровые монеты (RULES.md §17, решение владельца 13.10.2026).
//
// Только внешний вид, который видят другие: рамка аватарки, рубашка карт, сукно стола,
// эффект победы, наборы смайликов и фраз. Преимущества в игре вещи не дают.
// Монеты за покупку сгорают — никому не достаются. Купленное — навсегда, вернуть,
// продать и подарить нельзя. Покупать — только вне стола, как подарки.
// Рисунки вещей — в приложении (mobile/assets/shop), цены и состав — здесь.

import type { DatabaseSync } from 'node:sqlite';

// Что надевается: по одной вещи на каждое место. Наборы не надеваются — купил, и они
// появились в окне смайликов.
export const SLOTS = ['frame', 'back', 'cloth', 'effect'] as const;
export type Slot = (typeof SLOTS)[number];
export type ItemKind = Slot | 'pack';

export type ShopItem = {
  id: string;
  kind: ItemKind;
  price: number;
  name: string; // как называется
  title: string; // что это, коротко
};

// Цены — по балансам игроков на сервере за первую неделю (13.10.2026): три ступени —
// 8–20 тыс. доступно всем, 30–75 тыс. тем, кто играет, 200–300 тыс. — понты.
// Наборы смайликов — 100 000 и 200 000 (решение владельца, 14.10.2026).
export const SHOP_ITEMS: readonly ShopItem[] = [
  // Названия — по-русски, без казахских (решение владельца, 13.10.2026). id — внутренние, не меняются.
  { id: 'frame_kumis', kind: 'frame', price: 8_000, name: 'Серебряный узор', title: 'Серебро с гравировкой' },
  { id: 'frame_tumar', kind: 'frame', price: 15_000, name: 'Бирюзовый оберег', title: 'Бирюза и золото' },
  { id: 'frame_muiz', kind: 'frame', price: 40_000, name: 'Золотые рога', title: 'Золото с бараньими рогами' },
  { id: 'frame_khan', kind: 'frame', price: 250_000, name: 'Ханский трон', title: 'Золото, корона, рубины' },

  { id: 'back_kilem', kind: 'back', price: 12_000, name: 'Красный ковёр', title: 'Узор как на ковре' },
  { id: 'back_dala', kind: 'back', price: 20_000, name: 'Ночная степь', title: 'Полумесяц и звёзды' },
  { id: 'back_tulpar', kind: 'back', price: 50_000, name: 'Крылатый конь', title: 'Золотой конь на бордовом' },
  { id: 'back_altyn', kind: 'back', price: 200_000, name: 'Золотой человек', title: 'Воин в золоте' },

  { id: 'cloth_zhailau', kind: 'cloth', price: 20_000, name: 'Зелёный луг', title: 'Сукно с цветами' },
  { id: 'cloth_barkyt', kind: 'cloth', price: 35_000, name: 'Красный бархат', title: 'Бархат с золотой строчкой' },
  { id: 'cloth_syrmak', kind: 'cloth', price: 60_000, name: 'Войлочный ковёр', title: 'Войлок с узором' },
  { id: 'cloth_akorda', kind: 'cloth', price: 300_000, name: 'Дворец', title: 'Чёрный мрамор и золото' },

  { id: 'win_shashu', kind: 'effect', price: 15_000, name: 'Дождь из конфет', title: 'Конфеты и монеты' },
  { id: 'win_stars', kind: 'effect', price: 30_000, name: 'Звёзды', title: 'Золотые звёзды вокруг' },
  { id: 'win_burkit', kind: 'effect', price: 75_000, name: 'Беркут', title: 'Садится на аватарку' },

  { id: 'pack_troll', kind: 'pack', price: 100_000, name: 'Тролль', title: '6 смайликов-подколов' },
  { id: 'pack_podkol', kind: 'pack', price: 100_000, name: 'Подкол', title: '8 фраз-подколов' },
  { id: 'pack_mazak', kind: 'pack', price: 200_000, name: 'Насмешка', title: '6 рисованных стикеров' },
  // Игровые фразы владельца (22.10.2026): «Воин» — его 4 фразы; «Воин 2» — ещё 8, вдвое дороже.
  { id: 'pack_voin', kind: 'pack', price: 100_000, name: 'Воин', title: '«Сдавайся», «Тебе хана» и ещё 2 фразы' },
  { id: 'pack_voin2', kind: 'pack', price: 200_000, name: 'Воин 2', title: '8 фраз ещё жёстче' },
];

// Что внутри наборов. Шлются тем же полем emoji, что и обычные смайлики (§14).
// Стикеры «Насмешка» — тоже коды-смайлики: новое приложение рисует вместо них картинку,
// а старое просто покажет сам смайлик.
export const PACK_CONTENT: Record<string, readonly string[]> = {
  pack_troll: ['🤡', '🐔', '🍼', '🪦', '🐌', '🥱'],
  pack_podkol: [
    'Опять ПАС?',
    'Кон мой!',
    'Плати давай!',
    'Кто так ходит?',
    'Иди к ботам!',
    'Больно, да?',
    'Бәрекелді!',
    'Қап!',
  ],
  pack_mazak: ['🐑', '🐫', '🐓', '👵', '👶', '💸'],
  // Слова — владельца, как он их написал (22.10.2026).
  pack_voin: ['Сдавайся', 'Тебе хана', 'Кто ты, воин?', 'Ля ты крыса'],
  // «Пакет 2» — владелец разрешил добавить; фразы подобраны в том же духе.
  pack_voin2: [
    'Ты чё, бессмертный?',
    'Это фиаско, братан',
    'Давай, до свидания!',
    'Слабоумие и отвага',
    'Не по зубам',
    'Готовь монеты',
    'Здесь я хан!',
    'Беги, пока цел',
  ],
};

export function shopItem(id: unknown): ShopItem | undefined {
  return SHOP_ITEMS.find((i) => i.id === id);
}

// Из какого набора смайлик или фраза; null — из обычного набора или неизвестна.
export function packOf(reaction: string): string | null {
  for (const [pack, content] of Object.entries(PACK_CONTENT)) {
    if (content.includes(reaction)) return pack;
  }
  return null;
}

export type BuyError = 'unknown item' | 'already owned' | 'not enough coins';

// Можно ли купить. Сидит ли игрок за столом — проверяет сервер отдельно (как у подарков).
export function buyError(itemId: unknown, balance: number, owned: readonly string[]): BuyError | null {
  const item = shopItem(itemId);
  if (!item) return 'unknown item';
  if (owned.includes(item.id)) return 'already owned';
  if (balance < item.price) return 'not enough coins';
  return null;
}

export type EquipError = 'bad slot' | 'unknown item' | 'wrong slot' | 'not owned';

// Надеть вещь на место или снять (itemId = null — вернуть то, что у всех бесплатно).
export function equipError(slot: unknown, itemId: unknown, owned: readonly string[]): EquipError | null {
  if (!(SLOTS as readonly unknown[]).includes(slot)) return 'bad slot';
  if (itemId === null) return null;
  const item = shopItem(itemId);
  if (!item) return 'unknown item';
  if (item.kind !== slot) return 'wrong slot';
  if (!owned.includes(item.id)) return 'not owned';
  return null;
}

// Что надето: id вещи на каждом месте или null.
export type Look = Record<Slot, string | null>;
export const EMPTY_LOOK: Look = { frame: null, back: null, cloth: null, effect: null };

// --- База ---

export function ensureShopTables(db: DatabaseSync) {
  // Покупка — навсегда; цена — какой была в момент покупки (сколько монет сгорело).
  db.exec(`
    CREATE TABLE IF NOT EXISTS purchases (
      account_id  TEXT NOT NULL,
      item_id     TEXT NOT NULL,
      price       INTEGER NOT NULL,
      created_at  INTEGER NOT NULL,
      PRIMARY KEY (account_id, item_id)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS equipped (
      account_id  TEXT NOT NULL,
      slot        TEXT NOT NULL,
      item_id     TEXT NOT NULL,
      PRIMARY KEY (account_id, slot)
    )
  `);
}

export function ownedItems(db: DatabaseSync, accountId: string): string[] {
  const rows = db
    .prepare('SELECT item_id FROM purchases WHERE account_id = ? ORDER BY created_at')
    .all(accountId) as { item_id: string }[];
  return rows.map((r) => r.item_id);
}

export function recordPurchase(db: DatabaseSync, accountId: string, item: ShopItem, now: number) {
  db.prepare('INSERT INTO purchases (account_id, item_id, price, created_at) VALUES (?, ?, ?, ?)').run(
    accountId,
    item.id,
    item.price,
    now,
  );
}

export function setEquipped(db: DatabaseSync, accountId: string, slot: Slot, itemId: string | null) {
  if (itemId === null) {
    db.prepare('DELETE FROM equipped WHERE account_id = ? AND slot = ?').run(accountId, slot);
    return;
  }
  db.prepare(
    `INSERT INTO equipped (account_id, slot, item_id) VALUES (?, ?, ?)
     ON CONFLICT(account_id, slot) DO UPDATE SET item_id = excluded.item_id`,
  ).run(accountId, slot, itemId);
}

export function lookOf(db: DatabaseSync, accountId: string): Look {
  const rows = db.prepare('SELECT slot, item_id FROM equipped WHERE account_id = ?').all(accountId) as {
    slot: string;
    item_id: string;
  }[];
  const look: Look = { ...EMPTY_LOOK };
  for (const r of rows) {
    if ((SLOTS as readonly string[]).includes(r.slot) && shopItem(r.item_id)) look[r.slot as Slot] = r.item_id;
  }
  return look;
}

// Продажи для владельца: сколько каждой вещи купили и сколько монет сгорело.
export function shopSales(db: DatabaseSync): { itemId: string; count: number; coins: number }[] {
  return db
    .prepare(
      `SELECT item_id AS itemId, COUNT(*) AS count, SUM(price) AS coins
       FROM purchases GROUP BY item_id ORDER BY coins DESC`,
    )
    .all() as { itemId: string; count: number; coins: number }[];
}

// Удаление аккаунта: покупки и надетое — тоже.
export function deleteShopData(db: DatabaseSync, accountId: string) {
  db.prepare('DELETE FROM purchases WHERE account_id = ?').run(accountId);
  db.prepare('DELETE FROM equipped WHERE account_id = ?').run(accountId);
}
