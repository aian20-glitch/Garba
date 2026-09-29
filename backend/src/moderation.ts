// Жалобы и блокировка игроков, фильтр имён (29.09.2026, решение владельца).
//
// Требование Apple (Guideline 1.2) для приложений, где люди видят друг друга: способ
// пожаловаться, способ заблокировать и фильтр недопустимого. У нас от игрока видны
// только имя и смайлики из готового набора — их и касается всё ниже.
//
// Блокировка односторонняя: заблокировал — его смайлики мне не показываются, он не может
// звать меня в друзья и дарить монеты, «Быстрая игра» и открытые комнаты не сажают нас
// за один стол. Дружба и заявки между нами снимаются. Он об этом не узнаёт.
// Жалоба — строка в базе; владелец разбирает их командой deploy/reports.sh.

import type { DatabaseSync } from 'node:sqlite';

export const REPORT_REASONS = ['name', 'behavior', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export function ensureModerationTables(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS blocks (
      owner_id    TEXT NOT NULL,
      blocked_id  TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      PRIMARY KEY (owner_id, blocked_id)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS blocks_blocked ON blocks (blocked_id)');
  // to_name — имя на момент жалобы: игрок может смениться или удалиться.
  db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id      TEXT NOT NULL,
      to_id        TEXT NOT NULL,
      to_name      TEXT NOT NULL,
      reason       TEXT NOT NULL,
      room_id      TEXT,
      created_at   INTEGER NOT NULL,
      resolved_at  INTEGER
    )
  `);
}

// --- Блокировка ---

export function blockPlayer(db: DatabaseSync, owner: string, blocked: string) {
  db.prepare('INSERT OR IGNORE INTO blocks (owner_id, blocked_id, created_at) VALUES (?, ?, ?)').run(
    owner,
    blocked,
    Date.now(),
  );
}

export function unblockPlayer(db: DatabaseSync, owner: string, blocked: string) {
  db.prepare('DELETE FROM blocks WHERE owner_id = ? AND blocked_id = ?').run(owner, blocked);
}

export function hasBlocked(db: DatabaseSync, owner: string, other: string): boolean {
  return db.prepare('SELECT 1 FROM blocks WHERE owner_id = ? AND blocked_id = ?').get(owner, other) !== undefined;
}

// Хоть один из двоих заблокировал другого — дружба, подарки и общий стол закрыты.
export function blockedBetween(db: DatabaseSync, a: string, b: string): boolean {
  return hasBlocked(db, a, b) || hasBlocked(db, b, a);
}

// Кого заблокировал я — новые сверху.
export function blockedIds(db: DatabaseSync, owner: string): string[] {
  return (
    db.prepare('SELECT blocked_id FROM blocks WHERE owner_id = ? ORDER BY created_at DESC').all(owner) as {
      blocked_id: string;
    }[]
  ).map((r) => r.blocked_id);
}

// С кем мне не сидеть за одним столом: кого заблокировал я и кто заблокировал меня.
export function avoidIds(db: DatabaseSync, id: string): Set<string> {
  const rows = db
    .prepare(
      'SELECT blocked_id AS other FROM blocks WHERE owner_id = ? UNION SELECT owner_id AS other FROM blocks WHERE blocked_id = ?',
    )
    .all(id, id) as { other: string }[];
  return new Set(rows.map((r) => r.other));
}

// --- Жалобы ---

export function isReportReason(value: unknown): value is ReportReason {
  return typeof value === 'string' && (REPORT_REASONS as readonly string[]).includes(value);
}

// Неразобранная жалоба от этого игрока на того уже есть — вторую не пишем.
export function addReport(
  db: DatabaseSync,
  report: { fromId: string; toId: string; toName: string; reason: ReportReason; roomId: string | null },
): 'added' | 'already reported' {
  const open = db
    .prepare('SELECT 1 FROM reports WHERE from_id = ? AND to_id = ? AND resolved_at IS NULL')
    .get(report.fromId, report.toId);
  if (open !== undefined) return 'already reported';
  db.prepare(
    'INSERT INTO reports (from_id, to_id, to_name, reason, room_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(report.fromId, report.toId, report.toName, report.reason, report.roomId, Date.now());
  return 'added';
}

export type ReportRow = {
  id: number;
  fromId: string;
  toId: string;
  toName: string;
  reason: ReportReason;
  roomId: string | null;
  createdAt: number;
  resolvedAt: number | null;
};

export function listReports(db: DatabaseSync, includeResolved: boolean): ReportRow[] {
  const rows = db
    .prepare(
      `SELECT id, from_id, to_id, to_name, reason, room_id, created_at, resolved_at FROM reports
       ${includeResolved ? '' : 'WHERE resolved_at IS NULL'} ORDER BY created_at`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    fromId: String(r.from_id),
    toId: String(r.to_id),
    toName: String(r.to_name),
    reason: r.reason as ReportReason,
    roomId: r.room_id === null ? null : String(r.room_id),
    createdAt: Number(r.created_at),
    resolvedAt: r.resolved_at === null ? null : Number(r.resolved_at),
  }));
}

// Разобрать жалобу — вместе с ней все неразобранные жалобы на того же игрока.
export function resolveReport(db: DatabaseSync, id: number): number {
  const row = db.prepare('SELECT to_id FROM reports WHERE id = ?').get(id) as { to_id: string } | undefined;
  if (!row) return 0;
  const result = db
    .prepare('UPDATE reports SET resolved_at = ? WHERE to_id = ? AND resolved_at IS NULL')
    .run(Date.now(), row.to_id);
  return Number(result.changes);
}

// Удалённый аккаунт: его блокировки и жалобы от него уходят; жалобы на него остаются
// (имя в них — на момент жалобы), но без id отправителя.
export function deleteModerationData(db: DatabaseSync, id: string) {
  db.prepare('DELETE FROM blocks WHERE owner_id = ? OR blocked_id = ?').run(id, id);
  db.prepare('DELETE FROM reports WHERE from_id = ?').run(id);
}

// --- Фильтр имён ---
// Мат и оскорбления на русском, казахском и английском — по корням. Имя сравниваем
// без пробелов, точек и цифр-заменителей, латинские двойники букв — как кириллица
// («cyka», «х.у.й», «6ля»). Корни подобраны так, чтобы не задеть обычные имена
// («Глеб», «Мандарин», «Хлебушек» — проходят). Список меняется только здесь.

const BAD_ROOTS_RU = [
  'хуй', 'хуе', 'хуя', 'хуи', 'пизд', 'ебан', 'ебат', 'ебал', 'ебло', 'ебуч', 'ебет', 'уеб', 'заеб', 'выеб',
  'наеб', 'ъеб', 'бляд', 'блят', 'бля', 'сука', 'суки', 'сучк', 'сучар', 'мудак', 'мудил', 'пидор', 'пидар',
  'педик', 'гандон', 'гондон', 'шлюх', 'залуп', 'дроч', 'шалав', 'говн', 'гитлер',
  // казахский (қ ғ ң і ү ұ ө ә → к г н и у у о а)
  'котак', 'сиктир', 'сигейин', 'сикейин', 'шешенди', 'аннанды',
];
const BAD_ROOTS_EN = [
  'fuck', 'shit', 'cunt', 'bitch', 'nigger', 'nigga', 'faggot', 'whore', 'slut', 'pussy', 'porn', 'hitler',
];

const TO_CYRILLIC: Record<string, string> = {
  a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у',
  '0': 'о', '3': 'з', '6': 'б', '@': 'а',
  ё: 'е', қ: 'к', ғ: 'г', ң: 'н', і: 'и', ү: 'у', ұ: 'у', ө: 'о', ә: 'а', һ: 'х',
};
const TO_LATIN: Record<string, string> = {
  а: 'a', в: 'b', с: 'c', е: 'e', н: 'h', к: 'k', м: 'm', о: 'o', р: 'p', т: 't', х: 'x', у: 'y',
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '@': 'a', '$': 's',
};

const squeeze = (s: string, map: Record<string, string>) =>
  [...s.toLowerCase()]
    .map((ch) => map[ch] ?? ch)
    .filter((ch) => /\p{L}/u.test(ch))
    .join('');

// true — имя с матом или оскорблением, такое не берём.
export function nameNotAllowed(name: string): boolean {
  const ru = squeeze(name, TO_CYRILLIC);
  const en = squeeze(name, TO_LATIN);
  return BAD_ROOTS_RU.some((root) => ru.includes(root)) || BAD_ROOTS_EN.some((root) => en.includes(root));
}
