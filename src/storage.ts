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

const KEY = 'dont-forget:destinations:v1';
const TRIPS_KEY = 'dont-forget:trips:v1';
const SETTINGS_KEY = 'dont-forget:settings:v1';
const ACTIVE_EXITS_KEY = 'dont-forget:active-exits:v1';

/** Every key the app owns — used by "delete all data" in settings. */
export const ALL_KEYS = [KEY, TRIPS_KEY, SETTINGS_KEY, ACTIVE_EXITS_KEY];

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

export async function clearAllData(): Promise<void> {
  try {
    await AsyncStorage.multiRemove(ALL_KEYS);
  } catch {
    // ignored
  }
}
