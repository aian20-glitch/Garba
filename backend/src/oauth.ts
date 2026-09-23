// Вход через Google и Apple (решение владельца, 23.09.2026).
//
// Телефон получает от Google или Apple подписанный токен (JWT): «это пользователь sub».
// Сервер сам проверяет подпись открытыми ключами Google/Apple, кому выдан токен (aud —
// только наше приложение), кто выдал (iss) и срок. Приложению на слово не верим.
// Храним только provider + sub — ни email, ни имени из токена (решение владельца).
// Проверка — чистая функция, ключи передаются параметром; скачивание ключей — ниже.

import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';

export type Provider = 'google' | 'apple';
export const PROVIDERS: Provider[] = ['google', 'apple'];

export const PROVIDER_INFO: Record<Provider, { issuers: string[]; jwksUrl: string }> = {
  google: {
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
  },
  apple: {
    issuers: ['https://appleid.apple.com'],
    jwksUrl: 'https://appleid.apple.com/auth/keys',
  },
};

export type Jwk = JsonWebKey & { kid?: string };

// Часы телефона, сервера и Google расходятся — минута запаса.
const CLOCK_SKEW_S = 60;

export type Verified = { ok: true; sub: string; name: string | null } | { ok: false; error: string };

function part(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function verifyIdToken(
  token: unknown,
  opts: { issuers: string[]; audiences: string[]; keys: Jwk[]; nowS: number },
): Verified {
  if (typeof token !== 'string') return { ok: false, error: 'no token' };
  const pieces = token.split('.');
  if (pieces.length !== 3) return { ok: false, error: 'malformed token' };
  const [h, p, sig] = pieces;
  const header = part(h);
  const payload = part(p);
  if (!header || !payload) return { ok: false, error: 'malformed token' };
  // Только RS256 — так подписывают и Google, и Apple. «alg: none» и прочее — отказ.
  if (header.alg !== 'RS256') return { ok: false, error: 'bad algorithm' };

  const jwk = opts.keys.find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, error: 'unknown key' };
  let good = false;
  try {
    good = verify('RSA-SHA256', Buffer.from(`${h}.${p}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(sig, 'base64url'));
  } catch {
    good = false;
  }
  if (!good) return { ok: false, error: 'bad signature' };

  if (!opts.issuers.includes(String(payload.iss))) return { ok: false, error: 'bad issuer' };
  const aud = Array.isArray(payload.aud) ? payload.aud.map(String) : [String(payload.aud)];
  if (opts.audiences.length === 0 || !aud.some((a) => opts.audiences.includes(a))) {
    return { ok: false, error: 'bad audience' };
  }
  if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_S < opts.nowS) {
    return { ok: false, error: 'token expired' };
  }
  if (typeof payload.iat === 'number' && payload.iat - CLOCK_SKEW_S > opts.nowS) {
    return { ok: false, error: 'token from the future' };
  }
  if (typeof payload.sub !== 'string' || payload.sub === '') return { ok: false, error: 'no subject' };

  // Имя (только Google) — лишь подсказка для экрана имени, в базу не пишется.
  return { ok: true, sub: payload.sub, name: typeof payload.name === 'string' ? payload.name : null };
}

// Открытые ключи Google/Apple: скачиваем и держим час. Незнакомый kid (ключи сменились) —
// скачиваем заново, но не чаще раза в минуту, чтобы мусорные токены не гоняли нас в сеть.
export class JwksCache {
  private keys: Jwk[] = [];
  private fetchedAt = -Infinity; // ещё не скачивали

  constructor(
    private url: string,
    private fetchJson: (url: string) => Promise<{ keys?: Jwk[] }> = async (u) => (await fetch(u)).json(),
  ) {}

  async get(kid: string | undefined, nowMs = Date.now()): Promise<Jwk[]> {
    const stale = nowMs - this.fetchedAt > 3_600_000;
    const unknown = !this.keys.some((k) => k.kid === kid) && nowMs - this.fetchedAt > 60_000;
    if (stale || unknown) {
      const body = await this.fetchJson(this.url);
      this.keys = Array.isArray(body.keys) ? body.keys : [];
      this.fetchedAt = nowMs;
    }
    return this.keys;
  }
}

export function tokenKid(token: unknown): string | undefined {
  if (typeof token !== 'string') return undefined;
  const header = part(token.split('.')[0] ?? '');
  return typeof header?.kid === 'string' ? header.kid : undefined;
}
