// Аватар игрока — любое фото (ТЗ §2, этап 9.5).
//
// Телефон сам уменьшает фото (до 256 точек по стороне) и присылает картинку целиком.
// Сервер хранит её в базе и отдаёт по адресу /avatars/<id аккаунта>?v=<время загрузки>:
// «v» меняется при каждой новой фотке, поэтому телефон не показывает старую из кэша.

import type { DatabaseSync } from 'node:sqlite';

export const MAX_AVATAR_BYTES = 300 * 1024;

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';

export function ensureAvatarTable(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS avatars (
      account_id  TEXT PRIMARY KEY,
      mime        TEXT NOT NULL,
      data        BLOB NOT NULL,
      updated_at  INTEGER NOT NULL
    )
  `);
}

// Что за картинка — по первым байтам, а не по тому, что прислал клиент.
// null — это не JPEG, PNG или WebP.
export function detectImageType(bytes: Uint8Array): ImageType | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  ) {
    return 'image/webp';
  }
  return null;
}

// Сохранить аватар. Возвращает время загрузки — оно же версия картинки.
export function saveAvatar(db: DatabaseSync, accountId: string, mime: ImageType, data: Uint8Array): number {
  const at = Date.now();
  db.prepare(
    `INSERT INTO avatars (account_id, mime, data, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET mime = excluded.mime, data = excluded.data,
                                           updated_at = excluded.updated_at`,
  ).run(accountId, mime, data, at);
  return at;
}

export function loadAvatar(
  db: DatabaseSync,
  accountId: string,
): { mime: string; data: Uint8Array; updatedAt: number } | null {
  const row = db
    .prepare('SELECT mime, data, updated_at FROM avatars WHERE account_id = ?')
    .get(accountId) as { mime: string; data: Uint8Array; updated_at: number } | undefined;
  return row ? { mime: row.mime, data: row.data, updatedAt: Number(row.updated_at) } : null;
}

// Адрес аватара для клиента (без адреса сервера) или null, если фото нет.
export function avatarPath(db: DatabaseSync, accountId: string): string | null {
  const row = db
    .prepare('SELECT updated_at FROM avatars WHERE account_id = ?')
    .get(accountId) as { updated_at: number } | undefined;
  return row ? `/avatars/${accountId}?v=${row.updated_at}` : null;
}
