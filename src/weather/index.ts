import { Destination } from '../types';
import { cachedForecast, cachedGeocode } from './cache';
import { openMeteoProvider } from './openMeteoProvider';
import {
  Coords,
  WeatherLocation,
  WeatherProvider,
  WeatherReading,
  WeatherResult,
} from './types';

/**
 * The active weather source. Screens and components import from here and never
 * from a concrete provider, so replacing the source is a one-line change.
 *
 * `getDestinationWeather` is the only entry point the UI uses. It resolves a
 * location, goes through the cache, and returns one of four honest outcomes —
 * never a fabricated forecast.
 */
export const weather: WeatherProvider = openMeteoProvider;

export * from './types';
export { describeWeatherCode, isWetCode } from './codes';
export type { WeatherCondition } from './codes';
export { resetWeatherCache } from './cache';

/** How far off the requested hour a reading may be and still be worth showing. */
const MAX_READING_DISTANCE_MS = 3 * 60 * 60_000;

/** An arrival time that has already passed by more than this means "now". */
const STALE_ARRIVAL_MS = 30 * 60_000;

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** Network failures and timeouts, told apart so the user gets the right message. */
function classifyFailure(error: unknown): WeatherResult {
  if (isOffline()) return { status: 'offline' };

  const message = error instanceof Error ? error.message : '';
  const name = error instanceof Error ? error.name : '';

  if (name === 'AbortError') {
    return { status: 'error', reason: 'הבקשה לתחזית לקחה יותר מדי זמן' };
  }
  if (/network|failed to fetch|load failed/i.test(message)) {
    return { status: 'offline' };
  }
  return { status: 'error', reason: 'שירות מזג האוויר לא זמין כרגע' };
}

/**
 * The moment the forecast should describe.
 *
 * A destination with a desired arrival time (the bus setup's "להגיע עד") gets
 * the forecast for that hour — that is when the user will actually be outside.
 * Everything else gets now, which is when they are leaving.
 */
export function weatherTargetTime(
  destination: Destination | undefined,
  now: number = Date.now(),
): number {
  const arriveBy = destination?.transit?.arriveBy;
  if (!arriveBy || !/^\d{2}:\d{2}$/.test(arriveBy)) return now;

  const [hour, minute] = arriveBy.split(':');
  const target = new Date(now);
  target.setHours(Number(hour) || 0, Number(minute) || 0, 0, 0);

  // Already been and gone today: the relevant weather is the weather now.
  if (target.getTime() < now - STALE_ARRIVAL_MS) return now;
  return target.getTime();
}

/** Coordinates saved on the destination itself, when it has them. */
function savedCoords(destination: Destination): Coords | undefined {
  const coords = destination.coords;
  if (!coords) return undefined;
  if (typeof coords.latitude !== 'number' || typeof coords.longitude !== 'number') {
    return undefined;
  }
  return coords;
}

type LocationFailure = { reason: string; code: 'no-address' | 'geocode-failed' };

/**
 * Where to ask about.
 *
 * Saved coordinates win. Otherwise the address is geocoded — and if there is no
 * address, or nothing matches it, we say we cannot place the destination instead
 * of guessing a point on the map. A successful geocode is kept on the
 * destination by the hook (see useWeather), so this lookup happens once.
 */
async function resolveLocation(
  destination: Destination,
  signal?: AbortSignal,
): Promise<WeatherLocation | LocationFailure> {
  const coords = savedCoords(destination);
  if (coords) {
    return {
      ...coords,
      // What the point is of, not what the user typed: a town-level match must
      // not be presented as if the street address itself was resolved.
      label:
        destination.coordsLabel?.trim() || destination.address?.trim() || destination.name,
    };
  }

  const address = destination.address?.trim();
  if (!address) {
    return {
      code: 'no-address',
      reason: 'ליעד הזה אין כתובת ואין מיקום שמור, ובלי אחד מהם אין תחזית.',
    };
  }

  const located = await cachedGeocode(weather, address, signal);
  if (!located) {
    return {
      code: 'geocode-failed',
      reason: `לא מצאנו את "${address}" במקור המיקומים.`,
    };
  }
  return located;
}

/** The hour nearest the requested time, or null when nothing is near enough. */
function nearestReading(hours: WeatherReading[], at: number): WeatherReading | null {
  let best: WeatherReading | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const hour of hours) {
    const distance = Math.abs(hour.at - at);
    if (distance < bestDistance) {
      best = hour;
      bestDistance = distance;
    }
  }

  if (!best || bestDistance > MAX_READING_DISTANCE_MS) return null;
  return best;
}

export async function getDestinationWeather(
  destination: Destination | undefined,
  at: number,
  signal?: AbortSignal,
): Promise<WeatherResult> {
  if (!destination) {
    return { status: 'no-location', reason: 'אין יעד', code: 'no-address' };
  }

  try {
    const location = await resolveLocation(destination, signal);
    if ('reason' in location) {
      return { status: 'no-location', reason: location.reason, code: location.code };
    }

    const { hours, fetchedAt } = await cachedForecast(
      weather,
      location,
      new Date(at),
      signal,
    );

    const reading = nearestReading(hours, at);
    if (!reading) {
      return { status: 'error', reason: 'אין תחזית לשעה הזאת' };
    }

    return {
      status: 'ok',
      forecast: { location, reading, requestedAt: at, fetchedAt },
    };
  } catch (error) {
    return classifyFailure(error);
  }
}
