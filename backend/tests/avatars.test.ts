// Проверки avatars.ts. Запуск всех проверок: npm test

import { check, section } from './check.js';
import { createAccount, openDb } from '../src/accounts.js';
import { avatarPath, detectImageType, loadAvatar, saveAvatar } from '../src/avatars.js';

section('аватар — какая картинка (этап 9.5)');
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
check('JPEG узнаётся по первым байтам', detectImageType(jpeg), 'image/jpeg');
check('PNG узнаётся', detectImageType(png), 'image/png');
check('WebP узнаётся', detectImageType(webp), 'image/webp');
check('текст под видом картинки — не картинка', detectImageType(new TextEncoder().encode('<html>')), null);
check('пусто — не картинка', detectImageType(new Uint8Array()), null);

section('аватар — хранение');
const db = openDb(':memory:');
const { account } = createAccount(db, 'Серик');
check('фото ещё нет', [avatarPath(db, account.id), loadAvatar(db, account.id)], [null, null]);

const at = saveAvatar(db, account.id, 'image/jpeg', jpeg);
check('адрес с версией для кэша', avatarPath(db, account.id), `/avatars/${account.id}?v=${at}`);
const stored = loadAvatar(db, account.id);
check('картинка сохранилась байт в байт', [stored?.mime, Array.from(stored?.data ?? [])], ['image/jpeg', Array.from(jpeg)]);

saveAvatar(db, account.id, 'image/png', png);
check('новое фото заменяет старое', loadAvatar(db, account.id)?.mime, 'image/png');
