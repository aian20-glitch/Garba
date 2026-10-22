// Живая проверка: магазин (RULES.md §17, 13.10.2026).
// Настоящий сервер на порту 3094, база в памяти. Запуск: npm run test:live

import { spawn } from 'node:child_process';
import { check, section, summary } from './check.js';

const PORT = 3094;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), GARBA_DB: ':memory:' },
  stdio: 'ignore',
});

async function request(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function main() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/health')).ok) break; } catch {}
    await wait(200);
  }

  section('магазин: купить (§17)');
  const rich = (await request('POST', '/accounts', undefined, { name: 'Бай' })).body;
  const poor = (await request('POST', '/accounts', undefined, { name: 'Жарлы' })).body;
  const richCode = (await request('GET', '/me', rich.token)).body.code;
  check('без токена — 401', (await request('GET', '/shop')).status, 401);
  const shop = (await request('GET', '/shop', rich.token)).body;
  check('витрина: 20 вещей (с 22.10.2026 — и фразы «Воин», «Воин 2»), ничего не куплено, всё снято',
    [shop.items.length, shop.items.some((i: any) => i.owned), shop.look], [20, false, { frame: null, back: null, cloth: null, effect: null }]);
  const expensive = await request('POST', '/shop/buy', rich.token, { itemId: 'frame_muiz' });
  check('40 000 при 30 000 — не хватает', [expensive.status, expensive.body.error, expensive.body.price], [400, 'not enough coins', 40_000]);
  check('нет такой вещи — 404', (await request('POST', '/shop/buy', rich.token, { itemId: 'title_khan' })).status, 404);
  await request('POST', '/admin/coins', undefined, { code: richCode, amount: 640_000 });
  const bought = await request('POST', '/shop/buy', rich.token, { itemId: 'frame_khan' });
  check('купил «Ханский трон»: −250 000, сразу надето', [bought.status, bought.body.balance, bought.body.look.frame], [200, 420_000, 'frame_khan']);
  check('второй раз — 409', (await request('POST', '/shop/buy', rich.token, { itemId: 'frame_khan' })).status, 409);
  await request('POST', '/shop/buy', rich.token, { itemId: 'back_tulpar' });
  await request('POST', '/shop/buy', rich.token, { itemId: 'cloth_syrmak' });
  await request('POST', '/shop/buy', rich.token, { itemId: 'win_stars' });
  const pack = await request('POST', '/shop/buy', rich.token, { itemId: 'pack_mazak' });
  check('набор не надевается — только в списке купленного',
    [pack.body.look, pack.body.items.find((i: any) => i.id === 'pack_mazak').owned],
    [{ frame: 'frame_khan', back: 'back_tulpar', cloth: 'cloth_syrmak', effect: 'win_stars' }, true]);
  check('баланс в базе: 670 000 − 250 000 − 50 000 − 60 000 − 30 000 − 200 000',
    (await request('GET', '/me', rich.token)).body.balance, 80_000);
  check('/me — что куплено и надето', (await request('GET', '/me', rich.token)).body.shop.look.cloth, 'cloth_syrmak');

  section('магазин: надеть и снять');
  check('не купил — 403', (await request('POST', '/shop/equip', poor.token, { slot: 'frame', itemId: 'frame_khan' })).status, 403);
  check('рубашку на место рамки — 400', (await request('POST', '/shop/equip', rich.token, { slot: 'frame', itemId: 'back_tulpar' })).status, 400);
  check('снять сукно — снова обычное', (await request('POST', '/shop/equip', rich.token, { slot: 'cloth', itemId: null })).body.look.cloth, null);
  check('надеть обратно', (await request('POST', '/shop/equip', rich.token, { slot: 'cloth', itemId: 'cloth_syrmak' })).body.look.cloth, 'cloth_syrmak');

  section('магазин: что видят другие');
  const card = (await request('GET', `/players/${richCode}`, poor.token)).body;
  check('в карточке игрока — рамка', card.frame, 'frame_khan');
  const room = (await request('POST', '/rooms', rich.token, { capacity: 4, ante: 100, emptyLimit: 5, konThreshold: 10, minBalance: 1000, buyIn: 20_000 })).body;
  await request('POST', `/rooms/${room.id}/join`, poor.token);
  const seen = (await request('GET', `/rooms/${room.id}`, poor.token)).body.players.find((p: any) => p.code === richCode);
  check('за столом: рамка, рубашка, эффект; сукна — нет (у каждого своё)',
    [seen.frame, seen.cardBack, seen.winEffect, 'cloth' in seen], ['frame_khan', 'back_tulpar', 'win_stars', false]);

  section('магазин: за столом');
  check('купить в комнате нельзя — как дарить', (await request('POST', '/shop/buy', rich.token, { itemId: 'win_shashu' })).body.error, 'finish your game first');
  check('витрина знает, что я за столом', (await request('GET', '/shop', rich.token)).body.roomId, room.id);
  await request('POST', '/shop/equip', rich.token, { slot: 'back', itemId: null });
  check('снял рубашку за столом — все видят сразу',
    (await request('GET', `/rooms/${room.id}`, poor.token)).body.players.find((p: any) => p.code === richCode).cardBack, null);
  check('стикер «Насмешки» — купившему можно', (await request('POST', `/rooms/${room.id}/react`, rich.token, { emoji: '🐑' })).status, 200);
  const notOwned = await request('POST', `/rooms/${room.id}/react`, poor.token, { emoji: '🐑' });
  check('не купил — 403, в магазин', [notOwned.status, notOwned.body.error], [403, 'buy it in the shop']);
  check('обычный смайлик — всем', (await request('POST', `/rooms/${room.id}/react`, poor.token, { emoji: '👍' })).status, 200);

  section('магазин: продажи и удаление аккаунта');
  const sales = (await request('GET', '/admin/shop')).body;
  check('владелец видит, сколько монет сгорело', sales.burned, 590_000);
  check('продажи — не из интернета', (await fetch(BASE + '/admin/shop', { headers: { 'X-Forwarded-For': '7.7.7.7' } })).status, 403);
  await request('POST', `/rooms/${room.id}/leave`, poor.token);
  await request('POST', `/rooms/${room.id}/leave`, rich.token);
  check('удалил аккаунт', (await request('DELETE', '/me', rich.token)).status, 200);
  check('его покупок больше нет', (await request('GET', '/admin/shop')).body.burned, 0);
}

main()
  .catch((e) => {
    console.error(e);
    check('без исключений', String(e), '');
  })
  .finally(() => {
    server.kill();
    process.exit(summary() === 0 ? 0 : 1);
  });
