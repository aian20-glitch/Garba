// Живая проверка: позвать друга в комнату из списка «Друзья» (25.09.2026).
// Настоящий сервер на порту 3097, база в памяти. Запуск: npm run test:live

import { spawn } from 'node:child_process';
import { check, section, summary } from './check.js';

const PORT = 3097;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), GARBA_DB: ':memory:', GARBA_REQS_PER_10S: '20' },
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

  section('позвать друга в комнату из списка друзей (25.09.2026)');
  const host = (await request('POST', '/accounts', undefined, { name: 'Хозяин' })).body;
  const pal = (await request('POST', '/accounts', undefined, { name: 'Друг' })).body;
  const stranger = (await request('POST', '/accounts', undefined, { name: 'Чужой' })).body;
  const palCode = (await request('GET', '/me', pal.token)).body.code;
  const hostCode = (await request('GET', '/me', host.token)).body.code;
  await request('POST', '/friends', host.token, { code: palCode });
  await request('POST', `/friends/requests/${hostCode}/accept`, pal.token);
  const room = (await request('POST', '/rooms', host.token, { capacity: 4, ante: 100, emptyLimit: 5, konThreshold: 10, minBalance: 1000 })).body;
  const strangerCode = (await request('GET', '/me', stranger.token)).body.code;
  check('не друга позвать нельзя', (await request('POST', `/rooms/${room.id}/invite`, host.token, { code: strangerCode })).status, 403);
  check('друга — можно', (await request('POST', `/rooms/${room.id}/invite`, host.token, { code: palCode })).status, 200);
  const invites = (await request('GET', '/me', pal.token)).body.roomInvites;
  check('у друга на главном — приглашение: от кого и куда', invites.map((i: any) => [i.roomId, i.fromName]), [[room.id, 'Хозяин']]);
  await request('POST', `/rooms/${room.id}/join`, pal.token);
  check('друг вошёл — приглашение пропало', (await request('GET', '/me', pal.token)).body.roomInvites, []);
  await request('POST', `/rooms/${room.id}/invite`, host.token, { code: strangerCode });
  check('чужой в комнате не сидит и приглашений не получил', (await request('GET', '/me', stranger.token)).body.roomInvites, []);

  section('общий лимит запросов с одного адреса (26.09.2026)');
  const from = (ip: string) => fetch(BASE + '/health', { headers: { 'X-Forwarded-For': ip } }).then((r) => r.status);
  const statuses: number[] = [];
  for (let i = 0; i < 22; i++) statuses.push(await from('5.5.5.5'));
  check('20 запросов с одного адреса — можно, дальше — 429',
    [statuses.slice(0, 20).every((st) => st === 200), statuses.slice(20)], [true, [429, 429]]);
  check('другой адрес при этом не задет', await from('6.6.6.6'), 200);
  check('свой компьютер (боты, таймер) — без лимита', (await fetch(BASE + '/health')).status, 200);
}

main()
  .catch((e) => {
    console.error('Живая проверка упала:', e);
    process.exitCode = 1;
  })
  .finally(() => {
    server.kill();
    const failed = summary();
    process.exit(failed === 0 && process.exitCode !== 1 ? 0 : 1);
  });
