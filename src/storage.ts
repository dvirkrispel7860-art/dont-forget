import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ActiveExits,
  defaultSettings,
  Destination,
  Item,
  Reminder,
  Settings,
  Trip,
  TripItem,
} from './types';
import { TransitPlan, TransitStopRef, TravelMode } from './transit/types';
import { Coords, WeatherLocation, WeatherReading } from './weather/types';

const KEY = 'dont-forget:destinations:v1';
const TRIPS_KEY = 'dont-forget:trips:v1';
const SETTINGS_KEY = 'dont-forget:settings:v1';
const ACTIVE_EXITS_KEY = 'dont-forget:active-exits:v1';
const WEATHER_KEY = 'dont-forget:weather:v1';
const NOTIFICATION_SCHEDULE_KEY = 'dont-forget:notification-schedule:v1';

/**
 * Every key the app owns — used by "delete all data" in settings.
 *
 * The notification schedule is in here so a wipe leaves nothing behind, and it
 * is safe to wipe: the ids are derived from destination ids, so with the
 * destinations gone the next reconcile finds every one of them orphaned in the
 * OS list and cancels it.
 */
export const ALL_KEYS = [
  KEY,
  TRIPS_KEY,
  SETTINGS_KEY,
  ACTIVE_EXITS_KEY,
  WEATHER_KEY,
  NOTIFICATION_SCHEDULE_KEY,
];

/** Defensive parsing — a corrupt or half-written value must never crash the app. */
function parseItem(raw: unknown): Item | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.name !== 'string') return null;
  return {
    id: o.id,
    name: o.name,
    checked: o.checked === true,
    active: o.active !== false,
  };
}

function parseTravelMode(raw: unknown): TravelMode | undefined {
  return raw === 'car' || raw === 'bus' || raw === 'walk' || raw === 'bike'
    ? raw
    : undefined;
}

function parseStopRef(raw: unknown): TransitStopRef | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.code !== 'number') return undefined;
  return {
    code: o.code,
    name: typeof o.name === 'string' ? o.name : '',
    city: typeof o.city === 'string' ? o.city : '',
  };
}

function parseTransitPlan(raw: unknown): TransitPlan | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const plan: TransitPlan = {
    originStop: parseStopRef(o.originStop),
    destinationStop: parseStopRef(o.destinationStop),
    arriveBy:
      typeof o.arriveBy === 'string' && /^\d{2}:\d{2}$/.test(o.arriveBy)
        ? o.arriveBy
        : undefined,
  };
  const hasAny = plan.originStop || plan.destinationStop || plan.arriveBy;
  return hasAny ? plan : undefined;
}

/** Coordinates are only kept when both numbers are actually there. */
function parseCoords(raw: unknown): Coords | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.latitude !== 'number' || typeof o.longitude !== 'number') return undefined;
  return { latitude: o.latitude, longitude: o.longitude };
}

function parseReminder(raw: unknown): Reminder | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.time !== 'string' || !/^\d{2}:\d{2}$/.test(o.time)) return undefined;
  const days = Array.isArray(o.days)
    ? o.days.filter((d): d is number => typeof d === 'number' && d >= 0 && d <= 6)
    : [];
  return { enabled: o.enabled === true, time: o.time, days };
}

function parseDestination(raw: unknown): Destination | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.name !== 'string') return null;
  return {
    id: o.id,
    name: o.name,
    icon: typeof o.icon === 'string' && o.icon.length > 0 ? o.icon : '📍',
    address: typeof o.address === 'string' ? o.address : undefined,
    coords: parseCoords(o.coords),
    coordsLabel: typeof o.coordsLabel === 'string' ? o.coordsLabel : undefined,
    favorite: o.favorite === true,
    reminder: parseReminder(o.reminder),
    travelMode: parseTravelMode(o.travelMode),
    transit: parseTransitPlan(o.transit),
    items: Array.isArray(o.items)
      ? o.items.map(parseItem).filter((i): i is Item => i !== null)
      : [],
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : Date.now(),
  };
}

export async function loadDestinations(): Promise<Destination[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseDestination)
      .filter((d): d is Destination => d !== null);
  } catch {
    return [];
  }
}

export async function saveDestinations(destinations: Destination[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(destinations));
  } catch {
    // Storage full or unavailable — the in-memory state stays usable.
  }
}

/* ------------------------------------------------------------------ trips --- */

function parseTripItem(raw: unknown): TripItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== 'string') return null;
  return {
    itemId: typeof o.itemId === 'string' ? o.itemId : '',
    name: o.name,
    taken: o.taken === true,
    skipped: o.skipped === true,
  };
}

function parseTrip(raw: unknown): Trip | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.destinationName !== 'string') return null;

  // `items` is absent on records written before snapshots existed; those keep
  // their counts instead of having a list invented for them.
  const items = Array.isArray(o.items)
    ? o.items.map(parseTripItem).filter((i): i is TripItem => i !== null)
    : undefined;

  return {
    id: o.id,
    destinationId: typeof o.destinationId === 'string' ? o.destinationId : '',
    destinationName: o.destinationName,
    icon: typeof o.icon === 'string' && o.icon.length > 0 ? o.icon : '📍',
    address: typeof o.address === 'string' ? o.address : undefined,
    at: typeof o.at === 'number' ? o.at : Date.now(),
    items,
    itemsTaken: typeof o.itemsTaken === 'number' ? o.itemsTaken : undefined,
    itemsSkipped: typeof o.itemsSkipped === 'number' ? o.itemsSkipped : undefined,
  };
}

export async function loadTrips(): Promise<Trip[]> {
  try {
    const raw = await AsyncStorage.getItem(TRIPS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(parseTrip).filter((t): t is Trip => t !== null);
  } catch {
    return [];
  }
}

export async function saveTrips(trips: Trip[]): Promise<void> {
  try {
    await AsyncStorage.setItem(TRIPS_KEY, JSON.stringify(trips));
  } catch {
    // ignored — history is not critical enough to interrupt the user
  }
}

/* --------------------------------------------------------------- settings --- */

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings;
    const o: unknown = JSON.parse(raw);
    if (!o || typeof o !== 'object') return defaultSettings;
    const s = o as Record<string, unknown>;
    return {
      userName: typeof s.userName === 'string' ? s.userName : defaultSettings.userName,
      notifications:
        typeof s.notifications === 'boolean'
          ? s.notifications
          : defaultSettings.notifications,
      autoOpenWaze:
        typeof s.autoOpenWaze === 'boolean'
          ? s.autoOpenWaze
          : defaultSettings.autoOpenWaze,
    };
  } catch {
    return defaultSettings;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignored
  }
}

/* ---------------------------------------------------------- active exits --- */

export async function loadActiveExits(): Promise<ActiveExits> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_EXITS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: ActiveExits = {};
    for (const [id, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof at === 'number') result[id] = at;
    }
    return result;
  } catch {
    return {};
  }
}

export async function saveActiveExits(activeExits: ActiveExits): Promise<void> {
  try {
    await AsyncStorage.setItem(ACTIVE_EXITS_KEY, JSON.stringify(activeExits));
  } catch {
    // ignored
  }
}

/* ------------------------------------------------------------ weather cache --- */

/**
 * The weather cache is not user data — it is a copy of what the source said, so
 * the app does not ask again on every screen. It is parsed as defensively as
 * everything else: a corrupt entry is dropped, never shown.
 */
export type StoredWeatherCache = {
  forecasts: Record<
    string,
    { location: WeatherLocation; hours: WeatherReading[]; fetchedAt: number }
  >;
  geocodes: Record<string, { location: WeatherLocation | null; at: number }>;
};

export const emptyWeatherCache: StoredWeatherCache = { forecasts: {}, geocodes: {} };

function parseWeatherLocation(raw: unknown): WeatherLocation | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.latitude !== 'number' || typeof o.longitude !== 'number') return null;
  return {
    latitude: o.latitude,
    longitude: o.longitude,
    label: typeof o.label === 'string' ? o.label : '',
  };
}

function parseWeatherReading(raw: unknown): WeatherReading | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const number = (value: unknown) => (typeof value === 'number' ? value : undefined);

  if (
    typeof o.at !== 'number' ||
    typeof o.temperature !== 'number' ||
    typeof o.code !== 'number' ||
    typeof o.windSpeed !== 'number'
  ) {
    return null;
  }

  return {
    at: o.at,
    temperature: o.temperature,
    apparentTemperature: number(o.apparentTemperature),
    code: o.code,
    precipitationProbability: number(o.precipitationProbability),
    precipitation: number(o.precipitation),
    windSpeed: o.windSpeed,
    windGusts: number(o.windGusts),
  };
}

export async function loadWeatherCache(): Promise<StoredWeatherCache> {
  try {
    const raw = await AsyncStorage.getItem(WEATHER_KEY);
    if (!raw) return emptyWeatherCache;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyWeatherCache;

    const o = parsed as Record<string, unknown>;
    const cache: StoredWeatherCache = { forecasts: {}, geocodes: {} };

    if (o.forecasts && typeof o.forecasts === 'object') {
      for (const [key, value] of Object.entries(o.forecasts as Record<string, unknown>)) {
        if (!value || typeof value !== 'object') continue;
        const entry = value as Record<string, unknown>;
        const location = parseWeatherLocation(entry.location);
        const hours = Array.isArray(entry.hours)
          ? entry.hours
              .map(parseWeatherReading)
              .filter((hour): hour is WeatherReading => hour !== null)
          : [];
        if (!location || hours.length === 0 || typeof entry.fetchedAt !== 'number') continue;
        cache.forecasts[key] = { location, hours, fetchedAt: entry.fetchedAt };
      }
    }

    if (o.geocodes && typeof o.geocodes === 'object') {
      for (const [key, value] of Object.entries(o.geocodes as Record<string, unknown>)) {
        if (!value || typeof value !== 'object') continue;
        const entry = value as Record<string, unknown>;
        if (typeof entry.at !== 'number') continue;
        // A remembered miss is a null location, and is meant to be kept.
        cache.geocodes[key] = {
          location: parseWeatherLocation(entry.location),
          at: entry.at,
        };
      }
    }

    return cache;
  } catch {
    return emptyWeatherCache;
  }
}

export async function saveWeatherCache(cache: StoredWeatherCache): Promise<void> {
  try {
    await AsyncStorage.setItem(WEATHER_KEY, JSON.stringify(cache));
  } catch {
    // ignored — a cache that cannot be written just means asking again later
  }
}

/* ------------------------------------------------------ notification schedule --- */

/**
 * What the app has handed to the operating system.
 *
 * Not user data — bookkeeping about state that lives outside the app. It is kept
 * on disk rather than in memory for one reason: after the app is killed and
 * relaunched, the OS still holds notifications scheduled weeks ago, and without
 * a record of what they were built from there is no way to tell a reminder that
 * is still correct from one that needs replacing. That is how duplicates happen.
 *
 * The ids are deterministic (see notificationSchedule.ts), so even a lost record
 * is recoverable — the OS list is always the authority on what exists, and this
 * is the authority on what it was made from.
 */
export type StoredReminderSchedule = {
  /** What the reminder looked like when these were scheduled. */
  signature: string;
  /** One notification id per weekday. */
  ids: string[];
  /** When the next one is expected to fire, from `nextOccurrence`. */
  nextAt: number | null;
};

export type StoredLeaveSchedule = {
  id: string;
  /** Epoch millis it will fire at. */
  at: number;
  /** The ride and leave time it was built for, so a change is detectable. */
  rideKey: string;
};

export type StoredNotificationSchedule = {
  /** Keyed by destination id. */
  reminders: Record<string, StoredReminderSchedule>;
  /** Keyed by destination id — at most one pending "time to leave" each. */
  leave: Record<string, StoredLeaveSchedule>;
};

export const emptyNotificationSchedule: StoredNotificationSchedule = {
  reminders: {},
  leave: {},
};

function parseReminderSchedule(raw: unknown): StoredReminderSchedule | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.signature !== 'string' || !Array.isArray(o.ids)) return null;
  const ids = o.ids.filter((id): id is string => typeof id === 'string');
  if (ids.length === 0) return null;
  return {
    signature: o.signature,
    ids,
    nextAt: typeof o.nextAt === 'number' ? o.nextAt : null,
  };
}

function parseLeaveSchedule(raw: unknown): StoredLeaveSchedule | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.at !== 'number') return null;
  return { id: o.id, at: o.at, rideKey: typeof o.rideKey === 'string' ? o.rideKey : '' };
}

export async function loadNotificationSchedule(): Promise<StoredNotificationSchedule> {
  try {
    const raw = await AsyncStorage.getItem(NOTIFICATION_SCHEDULE_KEY);
    if (!raw) return emptyNotificationSchedule;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyNotificationSchedule;
    const o = parsed as Record<string, unknown>;

    const schedule: StoredNotificationSchedule = { reminders: {}, leave: {} };

    if (o.reminders && typeof o.reminders === 'object') {
      for (const [id, value] of Object.entries(o.reminders as Record<string, unknown>)) {
        const entry = parseReminderSchedule(value);
        if (entry) schedule.reminders[id] = entry;
      }
    }
    if (o.leave && typeof o.leave === 'object') {
      for (const [id, value] of Object.entries(o.leave as Record<string, unknown>)) {
        const entry = parseLeaveSchedule(value);
        if (entry) schedule.leave[id] = entry;
      }
    }

    return schedule;
  } catch {
    return emptyNotificationSchedule;
  }
}

export async function saveNotificationSchedule(
  schedule: StoredNotificationSchedule,
): Promise<void> {
  try {
    await AsyncStorage.setItem(NOTIFICATION_SCHEDULE_KEY, JSON.stringify(schedule));
  } catch {
    // ignored — the OS list still exists, and the ids are re-derivable
  }
}

export async function clearAllData(): Promise<void> {
  try {
    await AsyncStorage.multiRemove(ALL_KEYS);
  } catch {
    // ignored
  }
}
