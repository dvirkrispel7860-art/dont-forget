import { TransitPlan, TravelMode } from './transit/types';

/**
 * Data model for Don't Forget.
 *
 * Everything is stored locally on the device (see storage.ts). There is no
 * account and no server in this version, but the shapes below are the same
 * ones a future API would return, so the app can grow without a rewrite.
 */

export type Item = {
  id: string;
  /** What the user needs to take, e.g. "נעלי כדורגל". */
  name: string;
  /** Was it already picked up in the current exit check. */
  checked: boolean;
  /**
   * Is the item still part of the destination.
   * "הסר מהיעד" sets this to false instead of deleting the row, so nothing the
   * user typed is ever really lost.
   */
  active: boolean;
};

/** A repeating departure reminder for one destination. */
export type Reminder = {
  enabled: boolean;
  /** "HH:MM", 24-hour. */
  time: string;
  /** Weekdays the reminder runs on. 0 = Sunday … 6 = Saturday. */
  days: number[];
};

export const defaultReminder: Reminder = {
  enabled: true,
  time: '07:00',
  // Sunday–Thursday, the common Israeli work/school week.
  days: [0, 1, 2, 3, 4],
};

export type Destination = {
  id: string;
  /** e.g. "אימון כדורגל". */
  name: string;
  /** A single emoji, e.g. "⚽". */
  icon: string;
  /**
   * Street address used for navigation, e.g. "אצטדיון טדי, ירושלים".
   * Optional so destinations created before this field existed keep working —
   * those fall back to navigating by name.
   */
  address?: string;
  /** Favourites are listed first on the home screen. */
  favorite?: boolean;
  /** Optional departure reminder. Absent on destinations that never set one. */
  reminder?: Reminder;
  /** How the user gets here. Absent on destinations created before this existed. */
  travelMode?: TravelMode;
  /** Bus journey setup — only meaningful when travelMode is 'bus'. */
  transit?: TransitPlan;
  items: Item[];
  createdAt: number;
};

/** Items skipped with "רק הפעם" — kept in memory only, never persisted. */
export type SkipMap = Record<string, string[]>;

/**
 * Destinations with an exit in progress, mapped to when it started.
 * Persisted so a refresh mid-departure does not drop the user back to the
 * normal state while their ticks are still saved.
 */
export type ActiveExits = Record<string, number>;

/**
 * One line of a trip's snapshot.
 *
 * `itemId` is kept alongside the name on purpose: it lets a future feature group
 * the same item across many trips ("you take the water bottle 9 times out of 10")
 * even after the item has been renamed, while `name` keeps old trips readable
 * after the item is removed from the destination.
 */
export type TripItem = {
  itemId: string;
  name: string;
  /** Marked as taken during the exit check. */
  taken: boolean;
  /** Marked "לא צריך הפעם" during this trip. */
  skipped: boolean;
};

/** One completed exit check, written by "סיימתי את היציאה". */
export type Trip = {
  id: string;
  destinationId: string;
  /** Copied, not looked up, so history survives deleting the destination. */
  destinationName: string;
  icon: string;
  address?: string;
  /** Epoch millis. */
  at: number;
  /** The whole list as it stood at departure. */
  items?: TripItem[];
  /** Only on records written before the full snapshot existed. */
  itemsTaken?: number;
  itemsSkipped?: number;
};

/** Items marked as taken. */
export function tripTakenCount(trip: Trip): number {
  if (trip.items) return trip.items.filter((i) => i.taken).length;
  return trip.itemsTaken ?? 0;
}

/** Total items in the list, or null for older records that never stored it. */
export function tripTotalCount(trip: Trip): number | null {
  return trip.items ? trip.items.length : null;
}

export type Settings = {
  userName: string;
  notifications: boolean;
  /** Open Waze automatically when leaving. */
  autoOpenWaze: boolean;
};

export const defaultSettings: Settings = {
  userName: '',
  notifications: true,
  autoOpenWaze: false,
};
