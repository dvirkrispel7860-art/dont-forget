import { TransitPlan, TransitStopRef, TravelMode } from './transit/types';
import { Coords } from './weather/types';

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
  /**
   * Coordinates for the destination, once something has established them.
   *
   * Written by the weather layer after it geocodes the address successfully, and
   * by "📍 בחר מיקום" when the user sets the point themselves — never guessed,
   * and never overwritten once set. Whoever has it uses it directly, which is why
   * the address is only ever geocoded once.
   */
  coords?: Coords;
  /**
   * What those coordinates are actually of — "תל אביב-יפו, ישראל" for a town the
   * geocoder matched, "המיקום שלך" for a point the user set from their device.
   * Kept so the forecast can name its real location instead of implying it was
   * resolved to the street the address names.
   */
  coordsLabel?: string;
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
 * A travel mode chosen for the departure happening right now, per destination.
 *
 * In memory only, exactly like the skips: the destination keeps the mode it was
 * set up with, and this is "today I am driving instead". Cleared when a departure
 * starts or ends, so it never leaks into the next one.
 */
export type DepartureModes = Record<string, TravelMode>;

/**
 * A boarding stop the user picked by hand for the departure happening now.
 *
 * In memory only, like the travel mode above: the destination's own transit setup
 * is never rewritten by it, and it is dropped when the departure starts or ends.
 * Absent means "use the stop the app found near you".
 */
export type DepartureStops = Record<string, TransitStopRef>;

/**
 * Destinations with a departure in progress, mapped to when it started.
 * Persisted so a refresh in the middle of one keeps the ticks instead of
 * starting the list over.
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

/** One completed exit check, written by "מוכן לצאת". */
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

/**
 * What a brand-new install starts with.
 *
 * These apply only where a stored value is missing — `loadSettings` keeps
 * whatever the user chose, including a deliberate "off", so changing a default
 * here never overrides somebody's decision.
 *
 * `notifications: true` is the app-level switch, not permission. The operating
 * system or browser still has to agree, and until it does nothing is sent; the
 * settings screen shows the real permission state rather than implying this
 * switch is the whole story.
 */
export const defaultSettings: Settings = {
  userName: '',
  notifications: true,
  // Leaving is the moment navigation is wanted, so the app offers it by default
  // rather than making it something to discover. Turning it off still sticks.
  autoOpenWaze: true,
};
