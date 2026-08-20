import {
  emptyWeatherCache,
  loadWeatherCache,
  saveWeatherCache,
  StoredWeatherCache,
} from '../storage';
import { WeatherLocation, WeatherProvider, WeatherReading } from './types';

/**
 * The cache in front of the weather source.
 *
 * Two jobs: never ask the network for something we already know, and never let
 * two cards on the same screen fire the same request twice. It lives outside the
 * React store on purpose — this is a copy of somebody else's data, not the
 * user's, and it must not re-render the app when it changes.
 *
 * Everything is persisted (see storage.ts), so reopening the app inside the
 * freshness window costs no request at all.
 */

/** A forecast older than this is asked for again. */
const FORECAST_TTL_MS = 30 * 60_000;

/** A place does not move. */
const GEOCODE_TTL_MS = 30 * 24 * 60 * 60_000;

/** A miss might be a typo the user is about to fix — forget it sooner. */
const GEOCODE_MISS_TTL_MS = 6 * 60 * 60_000;

/** Keep the cache small; these are the newest entries that get kept. */
const MAX_FORECASTS = 20;
const MAX_GEOCODES = 60;

let cache: StoredWeatherCache = emptyWeatherCache;
let loading: Promise<void> | null = null;

/** In-flight requests, so simultaneous callers share one network round trip. */
const inflightForecasts = new Map<string, Promise<WeatherReading[]>>();
const inflightGeocodes = new Map<string, Promise<WeatherLocation | null>>();

async function ready(): Promise<void> {
  if (!loading) {
    loading = loadWeatherCache().then((loaded) => {
      cache = loaded;
    });
  }
  await loading;
}

function persist(): void {
  void saveWeatherCache(cache);
}

/** Newest-first trim, so the cache cannot grow without bound. */
function trim<T>(entries: Record<string, T>, max: number, at: (entry: T) => number) {
  const keys = Object.keys(entries);
  if (keys.length <= max) return entries;

  const kept = keys
    .sort((a, b) => at(entries[b]) - at(entries[a]))
    .slice(0, max);

  const next: Record<string, T> = {};
  for (const key of kept) next[key] = entries[key];
  return next;
}

/* -------------------------------------------------------------- geocoding --- */

export function geocodeKey(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Coordinates for an address, from the cache when possible.
 *
 * A miss is cached too (as `null`): an address the geocoder cannot place must
 * not cost a request every time the user opens the screen.
 */
export async function cachedGeocode(
  provider: WeatherProvider,
  query: string,
  signal?: AbortSignal,
): Promise<WeatherLocation | null> {
  const key = geocodeKey(query);
  if (!key) return null;

  await ready();

  const entry = cache.geocodes[key];
  if (entry) {
    const ttl = entry.location ? GEOCODE_TTL_MS : GEOCODE_MISS_TTL_MS;
    if (Date.now() - entry.at < ttl) return entry.location;
  }

  const existing = inflightGeocodes.get(key);
  if (existing) return existing;

  /*
   * The caller's signal is deliberately not forwarded into a shared request.
   * One screen unmounting must not cancel the answer another screen is still
   * waiting for — a caller that walked away simply ignores the result, and the
   * provider's own timeout keeps the request from hanging around.
   */
  void signal;

  const request = provider
    .geocode(query)
    .then((location) => {
      cache.geocodes = trim(
        { ...cache.geocodes, [key]: { location, at: Date.now() } },
        MAX_GEOCODES,
        (row) => row.at,
      );
      persist();
      return location;
    })
    .finally(() => {
      inflightGeocodes.delete(key);
    });

  inflightGeocodes.set(key, request);
  return request;
}

/* --------------------------------------------------------------- forecast --- */

/** ~1km grid — finer than the forecast model itself, so it is a safe key. */
export function forecastKey(location: WeatherLocation): string {
  return `${location.latitude.toFixed(2)},${location.longitude.toFixed(2)}`;
}

/** Does this series actually have an hour near the time being asked about? */
function covers(hours: WeatherReading[], at: number): boolean {
  if (hours.length === 0) return false;
  const hour = 60 * 60_000;
  return at >= hours[0].at - hour && at <= hours[hours.length - 1].at + hour;
}

/**
 * The hourly series for a location, from the cache when it is fresh enough and
 * actually covers the requested time.
 */
export async function cachedForecast(
  provider: WeatherProvider,
  location: WeatherLocation,
  at: Date,
  signal?: AbortSignal,
): Promise<{ hours: WeatherReading[]; fetchedAt: number }> {
  const key = forecastKey(location);
  const target = at.getTime();

  await ready();

  const entry = cache.forecasts[key];
  if (entry && Date.now() - entry.fetchedAt < FORECAST_TTL_MS && covers(entry.hours, target)) {
    return { hours: entry.hours, fetchedAt: entry.fetchedAt };
  }

  const existing = inflightForecasts.get(key);
  if (existing) {
    const hours = await existing;
    return { hours, fetchedAt: cache.forecasts[key]?.fetchedAt ?? Date.now() };
  }

  // Not forwarded, for the same reason as in cachedGeocode above.
  void signal;

  const request = provider
    .getWeatherForecast(location.latitude, location.longitude, at)
    .then((hours) => {
      cache.forecasts = trim(
        { ...cache.forecasts, [key]: { location, hours, fetchedAt: Date.now() } },
        MAX_FORECASTS,
        (row) => row.fetchedAt,
      );
      persist();
      return hours;
    })
    .finally(() => {
      inflightForecasts.delete(key);
    });

  inflightForecasts.set(key, request);
  const hours = await request;
  return { hours, fetchedAt: cache.forecasts[key]?.fetchedAt ?? Date.now() };
}

/**
 * Drops everything held in memory and on disk.
 *
 * Called by "מחק את כל הנתונים" so the promise it makes stays true — the key
 * itself is removed by clearAllData, this clears the copy in memory.
 */
export function resetWeatherCache(): void {
  cache = { forecasts: {}, geocodes: {} };
  loading = Promise.resolve();
  inflightForecasts.clear();
  inflightGeocodes.clear();
}
