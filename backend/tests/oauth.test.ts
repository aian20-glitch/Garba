// Проверки oauth.ts: вход через Google/Apple (23.09.2026). Ключи — свои тестовые,
// токены подписываем сами, как это делают Google и Apple. Запуск: npm test

import { generateKeyPairSync, sign } from 'node:crypto';
import { check, section } from './check.js';
import { JwksCache, PROVIDER_INFO, verifyIdToken, type Jwk } from '../src/oauth.js';
import {
  accountByLogin, addLogin, createAccount, deleteAccountData, findAccountByToken,
  issueToken, loginsOf, openDb, removeLogin,
} from '../src/accounts.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk: Jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1' };
const now = 1_800_000_000;

export function makeToken(payload: Record<string, unknown>, opts: { kid?: string; alg?: string; key?: typeof privateKey } = {}) {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'k1' });
  const body = b(payload);
  const sig = sign('RSA-SHA256', Buffer.from(`${head}.${body}`), opts.key ?? privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

const google = { iss: 'https://accounts.google.com', aud: 'garba-web', sub: '1001', exp: now + 3600, iat: now, name: 'Аян' };
const opts = { issuers: PROVIDER_INFO.google.issuers, audiences: ['garba-ios', 'garba-web'], keys: [jwk], nowS: now };

section('вход через Google/Apple: токен проверяет сервер');
check('настоящий токен — пускаем, sub и имя-подсказка', verifyIdToken(makeToken(google), opts), { ok: true, sub: '1001', name: 'Аян' });
check('подпись чужим ключом — нет', verifyIdToken(makeToken(google, { key: other.privateKey }), opts), { ok: false, error: 'bad signature' });
{
  const t = makeToken(google).split('.');
  const forged = Buffer.from(JSON.stringify({ ...google, sub: '666' })).toString('base64url');
  check('подменили sub в готовом токене — нет', verifyIdToken(`${t[0]}.${forged}.${t[2]}`, opts), { ok: false, error: 'bad signature' });
}
check('токен для чужого приложения (aud) — нет', verifyIdToken(makeToken({ ...google, aud: 'other-app' }), opts), { ok: false, error: 'bad audience' });
check('выдал не Google — нет', verifyIdToken(makeToken({ ...google, iss: 'https://evil.com' }), opts), { ok: false, error: 'bad issuer' });
check('просрочен больше минуты — нет', verifyIdToken(makeToken({ ...google, exp: now - 61 }), opts), { ok: false, error: 'token expired' });
check('часы разошлись на полминуты — ещё можно', verifyIdToken(makeToken({ ...google, exp: now - 30 }), opts).ok, true);
check('незнакомый ключ — нет', verifyIdToken(makeToken(google, { kid: 'zzz' }), opts), { ok: false, error: 'unknown key' });
check('alg не RS256 (например, none) — нет', verifyIdToken(makeToken(google, { alg: 'none' }), opts), { ok: false, error: 'bad algorithm' });
check('мусор вместо токена — нет', [verifyIdToken('abc', opts).ok, verifyIdToken(undefined, opts).ok], [false, false]);
check('вход не настроен (aud не задан) — никого не пускаем', verifyIdToken(makeToken(google), { ...opts, audiences: [] }).ok, false);
check('Apple: aud — bundle id, выдал appleid.apple.com',
  verifyIdToken(makeToken({ iss: 'https://appleid.apple.com', aud: 'kz.garba.app', sub: 'a.1', exp: now + 60 }),
    { issuers: PROVIDER_INFO.apple.issuers, audiences: ['kz.garba.app'], keys: [jwk], nowS: now }),
  { ok: true, sub: 'a.1', name: null });

section('ключи Google/Apple: держим час, при незнакомом ключе — скачиваем снова');
{
  let fetches = 0;
  const cache = new JwksCache('x', async () => { fetches++; return { keys: [jwk] }; });
  await cache.get('k1', 0);
  await cache.get('k1', 30 * 60_000);
  check('знакомый ключ в течение часа — без скачивания', fetches, 1);
  await cache.get('new', 30 * 60_000 + 1);
  check('незнакомый ключ — скачали снова', fetches, 2);
  await cache.get('new', 30 * 60_000 + 2);
  check('но не чаще раза в минуту', fetches, 2);
}

section('привязка входа к аккаунту: один Google — один аккаунт');
{
  const db = openDb(':memory:');
  const a = createAccount(db, 'Аян').account;
  const b = createAccount(db, 'Сико').account;
  check('привязали Google', addLogin(db, a.id, 'google', '1001'), 'ok');
  check('входит через Google — это Аян', accountByLogin(db, 'google', '1001')?.name, 'Аян');
  check('тот же Google к Сико — нельзя', addLogin(db, b.id, 'google', '1001'), 'taken');
  check('второй Google к Аяну — сначала отвязать', addLogin(db, a.id, 'google', '2002'), 'already');
  addLogin(db, a.id, 'apple', 'a.1');
  check('у Аяна Google и Apple', loginsOf(db, a.id), ['apple', 'google']);
  const token = issueToken(db, a.id);
  check('вход с нового телефона — новый токен работает', findAccountByToken(db, token)?.name, 'Аян');
  check('отвязал Apple', [removeLogin(db, a.id, 'apple'), loginsOf(db, a.id)], [true, ['google']]);
  deleteAccountData(db, a.id);
  check('аккаунт удалён — его Google свободен', accountByLogin(db, 'google', '1001'), null);
}
