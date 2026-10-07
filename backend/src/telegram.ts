// Telegram: игра как Mini App внутри Telegram (07.10.2026).
// Проверка подписи данных запуска (initData), имя из профиля, параметр ссылки
// t.me/<бот>?startapp=..., тексты уведомлений. Чистые функции — кроме sendTelegram.
//
// Подпись — по документации Telegram «Validating data received via the Mini App»:
// secret = HMAC-SHA256(ключ "WebAppData", токен бота);
// hash   = hex(HMAC-SHA256(secret, строки "ключ=значение" всех полей, кроме hash,
//          по алфавиту, через \n)).

import { createHmac, timingSafeEqual } from 'node:crypto';

// Данные запуска живут всю сессию Mini App; вход по ним — не старше суток.
export const INIT_DATA_MAX_AGE_SEC = 24 * 60 * 60;

export type TelegramUser = {
  id: number;
  firstName: string;
  lastName: string;
  username: string | null;
};

export type TelegramLaunch = {
  user: TelegramUser;
  authDate: number;
  startParam: string | null;
};

export function initDataHash(fields: Map<string, string>, botToken: string): string {
  const checkString = [...fields.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  return createHmac('sha256', secret).update(checkString).digest('hex');
}

// null — подпись не сошлась, данные устарели или в них нет игрока.
export function verifyInitData(
  initData: unknown,
  botToken: string,
  nowSec: number,
  maxAgeSec = INIT_DATA_MAX_AGE_SEC,
): TelegramLaunch | null {
  if (typeof initData !== 'string' || initData.length === 0 || initData.length > 4096) return null;
  if (!botToken) return null;

  const fields = new Map(new URLSearchParams(initData));
  const hash = fields.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;

  const expected = Buffer.from(initDataHash(fields, botToken), 'hex');
  const actual = Buffer.from(hash, 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  const authDate = Number(fields.get('auth_date'));
  if (!Number.isFinite(authDate) || nowSec - authDate > maxAgeSec || authDate - nowSec > 300) return null;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fields.get('user') ?? '');
  } catch {
    return null;
  }
  const id = raw?.id;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null;

  return {
    user: {
      id,
      firstName: typeof raw.first_name === 'string' ? raw.first_name : '',
      lastName: typeof raw.last_name === 'string' ? raw.last_name : '',
      username: typeof raw.username === 'string' ? raw.username : null,
    },
    authDate,
    startParam: fields.get('start_param') || null,
  };
}

// Имя для экрана первого входа: «Имя Фамилия» из Telegram, до 20 символов.
// Игрок его может поменять — сервер всё равно проверит имя как обычно.
export function suggestedName(user: TelegramUser, maxLength = 20): string {
  const full = `${user.firstName} ${user.lastName}`.trim().replace(/\s+/g, ' ');
  return [...full].slice(0, maxLength).join('').trim();
}

// Ссылка t.me/<бот>?startapp=room_12345 или invite_ABC123. Всё прочее не пускаем.
export type StartParam = { kind: 'room'; value: string } | { kind: 'invite'; value: string };

export function parseStartParam(raw: unknown): StartParam | null {
  if (typeof raw !== 'string') return null;
  const room = /^room_(\d{1,10})$/.exec(raw);
  if (room) return { kind: 'room', value: room[1] };
  const invite = /^invite_([A-Za-z0-9]{6})$/.exec(raw);
  if (invite) return { kind: 'invite', value: invite[1].toUpperCase() };
  return null;
}

export function startAppLink(botUsername: string, param: string): string {
  return `https://t.me/${botUsername}?startapp=${param}`;
}

// Отправить запрос Bot API. Ошибки только пишем в журнал: игрок мог не запускать
// бота или запретить ему писать — игре это не мешает.
export async function sendTelegram(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json()) as { ok?: boolean; result?: unknown; description?: string };
    if (!data.ok) {
      // 403 — игрок не запускал бота или заблокировал его; это обычное дело.
      if (res.status !== 403) console.log(`[TELEGRAM] ${method}: ${res.status} ${data.description ?? ''}`);
      return null;
    }
    return data.result ?? null;
  } catch (e) {
    console.log(`[TELEGRAM] ${method}: ${(e as Error).message}`);
    return null;
  }
}
