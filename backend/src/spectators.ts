// Наблюдатели (RULES.md §18, решение владельца 28.10.2026): идущие столы видны в лобби —
// все, и открытые, и «только по коду»; зритель смотрит, не занимая места, видит только
// то, что открыто всем за столом. Чистые функции.

export type LiveRoomSummary = {
  id: string;
  status: string;
  memberIds: string[];
  spectators: number;
  createdAt: number;
};

// Сколько столов показываем в списке «Идут сейчас» — больше на телефоне не пролистают.
export const LIVE_ROOMS_LIMIT = 30;

// Идущие столы для списка: начатые, где меня нет и нет тех, с кем у меня блок (§18).
// Сверху — где больше зрителей, при равенстве — что началась раньше.
export function liveRoomsFor<T extends LiveRoomSummary>(rooms: T[], playerId: string, avoid: Set<string>): T[] {
  return rooms
    .filter(
      (r) =>
        r.status === 'started' &&
        !r.memberIds.includes(playerId) &&
        !r.memberIds.some((id) => avoid.has(id)),
    )
    .sort((a, b) => b.spectators - a.spectators || a.createdAt - b.createdAt)
    .slice(0, LIVE_ROOMS_LIMIT);
}

export type SpectateRefusal = 'playing elsewhere' | 'blocked';

// Можно ли смотреть стол, за которым не сидишь. Лобби и законченные столы — как раньше
// (их состояние видно по номеру комнаты). Начатую игру смотреть нельзя, если сам сидишь
// в другой начатой игре — твой стол встал бы на паузу (§13), — и если за столом тот,
// с кем у тебя блок.
export function spectateRefusal(s: {
  member: boolean;
  status: string;
  playingElsewhere: boolean;
  blocked: boolean;
}): SpectateRefusal | null {
  if (s.member || s.status !== 'started') return null;
  if (s.playingElsewhere) return 'playing elsewhere';
  if (s.blocked) return 'blocked';
  return null;
}

// Сколько зрителей: разные аккаунты среди следящих за столом, кроме сидящих за ним.
// У одного зрителя может быть несколько сокетов (телефон и Telegram) — он один.
// В лобби зрителей не считаем: там не на что смотреть.
export function spectatorCount(status: string, watcherIds: string[], memberIds: string[]): number {
  if (status === 'lobby') return 0;
  const members = new Set(memberIds);
  return new Set(watcherIds.filter((id) => !members.has(id))).size;
}
