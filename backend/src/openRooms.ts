// Открытые комнаты (решение владельца, 19.09.2026): в списке для всех, зайти может любой.
// Показываем только лобби со свободными местами, куда хватает монет; сверху — почти
// полные (их быстрее запустят), при равенстве — те, что ждут дольше. Чистые функции.

export type RoomSummary = {
  id: string;
  isPublic: boolean;
  status: string;
  capacity: number;
  memberIds: string[];
  minBalance: number;
  createdAt: number;
};

// «Быстрая игра», когда подходящих открытых комнат нет: создаём открытую с такими условиями.
export const QUICK_ROOM = { capacity: 5, ante: 100, emptyLimit: 5, konThreshold: 10, minBalance: 1_000 };

export function openRoomsFor<T extends RoomSummary>(rooms: T[], balance: number, playerId: string): T[] {
  return rooms
    .filter(
      (r) =>
        r.isPublic &&
        r.status === 'lobby' &&
        r.memberIds.length < r.capacity &&
        r.minBalance <= balance &&
        !r.memberIds.includes(playerId),
    )
    .sort(
      (a, b) =>
        a.capacity - a.memberIds.length - (b.capacity - b.memberIds.length) ||
        a.createdAt - b.createdAt,
    );
}
