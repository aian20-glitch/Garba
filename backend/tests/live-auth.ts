// Живая проверка входа через Google/Apple (23.09.2026): настоящий сервер на порту 3097,
// база в памяти. Вместо Google — свой маленький сервер с тестовыми ключами: адрес ключей
// меняется переменной GARBA_GOOGLE_JWKS_URL, токены подписываем сами.
// Запуск: npm run test:live

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { check, section, summary } from './check.js';

const PORT = 3097;
const KEYS_PORT = 3095;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keysServer = createServer((_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test' }] }));
}).listen(KEYS_PORT);

const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  env: {
    ...process.env, PORT: String(PORT), GARBA_DB: ':memory:',
    GARBA_GOOGLE_CLIENT_IDS: 'garba-ios,garba-web',
    GARBA_GOOGLE_JWKS_URL: `http://127.0.0.1:${KEYS_PORT}/`,
  },
  stdio: 'ignore',
});

function googleToken(sub: string, extra: Record<string, unknown> = {}) {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b({ alg: 'RS256', kid: 'test' });
  const body = b({ iss: 'https://accounts.google.com', aud: 'garba-ios', sub, iat: now, exp: now + 3600, name: 'Аян Google', ...extra });
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
}

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

  section('вход через Google: новый игрок');
  const unknown = await request('POST', '/auth/google', undefined, { idToken: googleToken('g-1') });
  check('Google ещё ни к кому не привязан — 404 и подсказка имени', [unknown.status, unknown.body.suggestedName], [404, 'Аян Google']);
  const created = await request('POST', '/auth/google', undefined, { idToken: googleToken('g-1'), name: 'Аян' });
  check('с именем — новый аккаунт, 30 000 монет, токен', [created.status, created.body.name, created.body.balance, typeof created.body.token], [201, 'Аян', 30000, 'string']);
  check('/me знает, что аккаунт привязан к Google', (await request('GET', '/me', created.body.token)).body.logins, ['google']);
  check('email нигде не хранится и не отдаётся', JSON.stringify((await request('GET', '/me', created.body.token)).body).includes('@'), false);

  section('вход через Google: тот же игрок с другого телефона');
  const again = await request('POST', '/auth/google', undefined, { idToken: googleToken('g-1') });
  check('тот же аккаунт, новый токен', [again.status, again.body.id, again.body.token !== created.body.token], [200, created.body.id, true]);
  check('прежний телефон вышел (токен один)', (await request('GET', '/me', created.body.token)).status, 401);
  check('новый токен работает', (await request('GET', '/me', again.body.token)).body.name, 'Аян');

  section('поддельные токены сервер не пускает');
  const forged = googleToken('g-1').split('.');
  check('подпись от другого токена — 401', (await request('POST', '/auth/google', undefined, { idToken: `${forged[0]}.${googleToken('g-2').split('.')[1]}.${forged[2]}` })).status, 401);
  check('токен для чужого приложения — 401', (await request('POST', '/auth/google', undefined, { idToken: googleToken('g-1', { aud: 'evil' }) })).status, 401);
  check('токен Google под видом Apple — не пускаем', (await request('POST', '/auth/apple', undefined, { idToken: googleToken('g-1') })).status >= 400, true);
  check('неизвестный способ входа — 404', (await request('POST', '/auth/facebook', undefined, { idToken: 'x' })).status, 404);

  section('привязка Google к аккаунту, созданному по имени');
  const sico = (await request('POST', '/accounts', undefined, { name: 'Сико' })).body;
  check('чужой Google (уже у Аяна) — 409', (await request('POST', '/me/logins/google', sico.token, { idToken: googleToken('g-1') })).status, 409);
  const linked = await request('POST', '/me/logins/google', sico.token, { idToken: googleToken('g-2') });
  check('свой Google — привязан', [linked.status, linked.body.logins], [200, ['google']]);
  const viaGoogle = await request('POST', '/auth/google', undefined, { idToken: googleToken('g-2') });
  check('теперь Сико входит через Google — в свой аккаунт с его монетами', [viaGoogle.body.id, viaGoogle.body.balance], [sico.id, sico.balance]);
  check('без токена привязать нельзя — 401', (await request('POST', '/me/logins/google', undefined, { idToken: googleToken('g-3') })).status, 401);
  const unlinked = await request('DELETE', '/me/logins/google', viaGoogle.body.token);
  check('отвязал — вход через этот Google больше не ведёт в аккаунт',
    [unlinked.body.logins, (await request('POST', '/auth/google', undefined, { idToken: googleToken('g-2') })).status], [[], 404]);
}

main()
  .catch((e) => {
    console.error('Живая проверка упала:', e);
    process.exitCode = 1;
  })
  .finally(() => {
    server.kill();
    keysServer.close();
    const failed = summary();
    process.exit(failed === 0 && process.exitCode !== 1 ? 0 : 1);
  });
