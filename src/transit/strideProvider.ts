import { TransitProvider } from './provider';
import {
  RealtimeRequest,
  RealtimeResult,
  TransitOption,
  TransitOptionsRequest,
  TransitStop,
} from './types';

/**
 * Israel's official public-transport timetable (Ministry of Transport GTFS),
 * read through the open-bus Stride API run by Hasadna.
 *
 * Why this source: it serves the official GTFS feed, it needs **no API key**, and
 * it sends `Access-Control-Allow-Origin: *`, so the app can read it directly with
 * no backend and no secret to leak. Nothing here is invented — every line number,
 * stop and time comes from the feed.
 */

const BASE = 'https://open-bus-stride-api.hasadna.org.il';

/** The API refuses larger pages. */
const MAX_PAGE = 15000;

/** Stop rows exist per schedule date; ingestion can lag, so we walk back. */
const MAX_DATE_LOOKBACK_DAYS = 4;

/** A live position older than this is not live any more. */
const FRESH_REALTIME_MINUTES = 10;

/** How far back from the target arrival to look for departures. */
const SEARCH_WINDOW_HOURS = 3;

type StrideStop = {
  id: number;
  date: string;
  code: number;
  lat: number | null;
  lon: number | null;
  name: string | null;
  city: string | null;
};

type StrideRideStop = {
  gtfs_ride_id: number;
  arrival_time: string;
  departure_time: string;
  stop_sequence: number;
  gtfs_stop__code: number;
  gtfs_stop__name: string;
  gtfs_stop__lat: number | null;
  gtfs_stop__lon: number | null;
  gtfs_route__route_short_name: string | null;
  gtfs_route__route_long_name: string | null;
  gtfs_route__agency_name: string | null;
  gtfs_route__line_ref: number | null;
  gtfs_route__operator_ref: number | null;
};

function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function getJson<T>(
  path: string,
  params: Record<string, string | number>,
  signal?: AbortSignal,
): Promise<T> {
  const url = new URL(BASE + path);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  const response = await fetch(url.toString(), { signal });
  if (!response.ok) {
    throw new Error('transit source responded ' + response.status);
  }
  return (await response.json()) as T;
}

/* ------------------------------------------------------------- stop index --- */

/**
 * The source has no geographic or name filter, so nearby/search need the day's
 * stop list (about 30k rows, ~4MB). It is therefore fetched lazily — only when
 * the user actually asks for stops — and kept for the session only, never
 * written to storage, so it can never crowd out the user's own data.
 */
let stopIndex: { date: string; stops: TransitStop[] } | null = null;
let stopIndexLoading: Promise<TransitStop[]> | null = null;

/** Most recent date the source actually has stops for. */
async function latestScheduleDate(signal?: AbortSignal): Promise<string> {
  const today = new Date();
  for (let back = 0; back <= MAX_DATE_LOOKBACK_DAYS; back += 1) {
    const probe = new Date(today);
    probe.setDate(today.getDate() - back);
    const date = isoDate(probe);
    const rows = await getJson<StrideStop[]>(
      '/gtfs_stops/list',
      { get_count: 'false', limit: 1, date_from: date, date_to: date },
      signal,
    );
    if (rows.length > 0) return date;
  }
  throw new Error('no schedule data available');
}

async function loadStopIndex(signal?: AbortSignal): Promise<TransitStop[]> {
  if (stopIndex) return stopIndex.stops;
  if (stopIndexLoading) return stopIndexLoading;

  stopIndexLoading = (async () => {
    const date = await latestScheduleDate(signal);
    const stops: TransitStop[] = [];
    const seenCodes = new Set<number>();

    for (let offset = 0; offset < 60000; offset += MAX_PAGE) {
      const rows = await getJson<StrideStop[]>(
        '/gtfs_stops/list',
        {
          get_count: 'false',
          limit: MAX_PAGE,
          offset,
          date_from: date,
          date_to: date,
        },
        signal,
      );
      for (const row of rows) {
        // The feed contains rows with a missing name or city; keep them usable.
        if (typeof row.lat !== 'number' || typeof row.lon !== 'number') continue;
        if (seenCodes.has(row.code)) continue;
        seenCodes.add(row.code);
        stops.push({
          code: row.code,
          name: row.name ?? 'תחנה ' + row.code,
          city: row.city ?? '',
          lat: row.lat,
          lon: row.lon,
        });
      }
      if (rows.length < MAX_PAGE) break;
    }

    stopIndex = { date, stops };
    return stops;
  })();

  try {
    return await stopIndexLoading;
  } finally {
    stopIndexLoading = null;
  }
}

/** True once the one-time stop list is in memory. */
export function isStopIndexReady(): boolean {
  return stopIndex !== null;
}

/** Straight-line distance, good enough for ranking nearby stops. */
function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function normalize(text: string | null | undefined): string {
  return (text ?? '')
    .trim()
    .replace(/['"׳״]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/* ----------------------------------------------------------- trip planning --- */

/** Resolves a stop code to the source's row id for a usable schedule date. */
async function resolveStop(
  code: number,
  preferredDate: Date,
  signal?: AbortSignal,
): Promise<{ id: number; date: string; name: string } | null> {
  for (let back = 0; back <= MAX_DATE_LOOKBACK_DAYS; back += 1) {
    const probe = new Date(preferredDate);
    probe.setDate(preferredDate.getDate() - back);
    const date = isoDate(probe);
    const rows = await getJson<StrideStop[]>(
      '/gtfs_stops/list',
      { get_count: 'false', limit: 1, code, date_from: date, date_to: date },
      signal,
    );
    if (rows.length > 0) return { id: rows[0].id, date, name: rows[0].name ?? '' };
  }
  return null;
}

async function rideStops(
  params: Record<string, string | number>,
  signal?: AbortSignal,
): Promise<StrideRideStop[]> {
  return getJson<StrideRideStop[]>(
    '/gtfs_ride_stops/list',
    { get_count: 'false', ...params },
    signal,
  );
}

/** Builds a Date on `date` (YYYY-MM-DD) at the same wall-clock time as `time`. */
function onScheduleDate(date: string, time: Date): Date {
  const hh = String(time.getHours()).padStart(2, '0');
  const mm = String(time.getMinutes()).padStart(2, '0');
  return new Date(date + 'T' + hh + ':' + mm + ':00');
}

export const strideProvider: TransitProvider = {
  id: 'stride-gtfs-il',
  sourceLabel: 'לוח זמנים רשמי (GTFS משרד התחבורה, דרך open-bus של הסדנא)',

  async getNearbyStops(lat, lon, options) {
    const stops = await loadStopIndex(options?.signal);
    return stops
      .map((stop) => ({
        ...stop,
        distanceMeters: Math.round(distanceMeters(lat, lon, stop.lat, stop.lon)),
      }))
      .sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0))
      .slice(0, options?.limit ?? 12);
  },

  async searchStops(query, options) {
    const needle = normalize(query);
    if (needle.length < 2) return [];

    const stops = await loadStopIndex(options?.signal);
    const limit = options?.limit ?? 20;
    const startsWith: TransitStop[] = [];
    const contains: TransitStop[] = [];

    for (const stop of stops) {
      const name = normalize(stop.name);
      if (name.startsWith(needle)) startsWith.push(stop);
      else if (name.includes(needle) || normalize(stop.city).startsWith(needle)) {
        contains.push(stop);
      }
      if (startsWith.length >= limit) break;
    }

    return [...startsWith, ...contains].slice(0, limit);
  },

  async getTransitOptions(request: TransitOptionsRequest, options) {
    const signal = options?.signal;

    let origin = await resolveStop(request.originCode, request.arriveBy, signal);
    let destination = await resolveStop(request.destinationCode, request.arriveBy, signal);
    if (!origin || !destination) return [];

    // Both stops must come from the same schedule date to share ride ids.
    if (origin.date !== destination.date) {
      const date = origin.date < destination.date ? origin.date : destination.date;
      const anchor = new Date(date + 'T12:00:00');
      origin = await resolveStop(request.originCode, anchor, signal);
      destination = await resolveStop(request.destinationCode, anchor, signal);
      if (!origin || !destination || origin.date !== destination.date) return [];
    }

    const date = origin.date;

    // Align the requested wall-clock time onto the schedule date we actually have.
    const scheduleTarget = onScheduleDate(date, request.arriveBy);
    const windowStart = new Date(
      scheduleTarget.getTime() - SEARCH_WINDOW_HOURS * 3600_000,
    );

    const departures = await rideStops(
      {
        limit: 300,
        gtfs_stop_ids: origin.id,
        arrival_time_from: windowStart.toISOString(),
        arrival_time_to: scheduleTarget.toISOString(),
      },
      signal,
    );
    if (departures.length === 0) return [];

    // Keep the URL sane while still covering the window generously.
    const rideIds = [...new Set(departures.map((row) => row.gtfs_ride_id))].slice(0, 120);

    const arrivals = await rideStops(
      {
        limit: 500,
        gtfs_ride_ids: rideIds.join(','),
        gtfs_stop_ids: destination.id,
        arrival_time_from: windowStart.toISOString(),
        arrival_time_to: new Date(scheduleTarget.getTime() + 3600_000).toISOString(),
      },
      signal,
    );

    const arrivalByRide = new Map<number, StrideRideStop>();
    for (const row of arrivals) arrivalByRide.set(row.gtfs_ride_id, row);

    const found: TransitOption[] = [];
    for (const departure of departures) {
      const arrival = arrivalByRide.get(departure.gtfs_ride_id);
      if (!arrival) continue;
      // The destination must come later along the same ride.
      if (arrival.stop_sequence <= departure.stop_sequence) continue;
      if (new Date(arrival.arrival_time) > scheduleTarget) continue;

      found.push({
        id: departure.gtfs_ride_id + ':' + departure.stop_sequence,
        lineNumber: departure.gtfs_route__route_short_name ?? '—',
        agency: departure.gtfs_route__agency_name ?? '',
        headsign: departure.gtfs_route__route_long_name ?? '',
        boardStopName: departure.gtfs_stop__name,
        boardStopCode: departure.gtfs_stop__code,
        departure: departure.departure_time || departure.arrival_time,
        alightStopName: arrival.gtfs_stop__name,
        alightStopCode: arrival.gtfs_stop__code,
        arrival: arrival.arrival_time,
        scheduleDate: date,
        // Already in the rows we fetched — carrying it costs nothing and is what
        // lets the live lookup ask about this exact line.
        lineRef: departure.gtfs_route__line_ref ?? undefined,
        operatorRef: departure.gtfs_route__operator_ref ?? undefined,
        boardStopLat: departure.gtfs_stop__lat ?? undefined,
        boardStopLon: departure.gtfs_stop__lon ?? undefined,
      });
    }

    // Latest arrival that still makes the target comes first — the useful one.
    found.sort((a, b) => new Date(b.arrival).getTime() - new Date(a.arrival).getTime());

    const seen = new Set<string>();
    const unique = found.filter((option) => {
      const key = option.lineNumber + ':' + option.departure;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return unique.slice(0, request.limit ?? 4);
  },

  /**
   * Live positions. The source exposes SIRI snapshots, but a useful answer needs
   * a ride already under way, so this reports honestly when it has nothing
   * rather than guessing.
   *
   * Identity matters more than it looks here. Live reports are keyed by the
   * feed's `line_ref`, not by the number painted on the bus: dozens of unrelated
   * lines across the country are called "54". Asking by the published number
   * returns strangers' buses, so without a `lineRef` this reports nothing at all
   * rather than something wrong.
   */
  async getRealtimeTransitData(
    request: RealtimeRequest,
    options,
  ): Promise<RealtimeResult> {
    if (request.lineRef == null) {
      return { available: false, reason: 'אין מזהה קו לבדיקת זמן אמת' };
    }

    try {
      const rows = await getJson<
        {
          lat: number;
          lon: number;
          recorded_at_time: string;
          siri_route__line_ref: number | null;
        }[]
      >(
        '/siri_vehicle_locations/list',
        {
          get_count: 'false',
          limit: 20,
          recorded_at_time_from: new Date(Date.now() - 10 * 60_000).toISOString(),
          recorded_at_time_to: new Date().toISOString(),
          // Singular: the plural spelling is not a parameter this API knows, and
          // an unknown filter is ignored silently — which returns every line.
          siri_routes__line_ref: request.lineRef,
          ...(request.operatorRef != null
            ? { siri_routes__operator_ref: request.operatorRef }
            : {}),
        },
        options?.signal,
      );

      /*
       * The source does not honour the recorded_at_time filters, and a filter it
       * does not recognise it drops entirely, so both conditions are enforced
       * here: a position is used only when it is fresh *and* provably this line's.
       * Stale or foreign positions must never be presented as live.
       */
      const cutoff = Date.now() - FRESH_REALTIME_MINUTES * 60_000;
      const fresh = (Array.isArray(rows) ? rows : []).filter((row) => {
        if (row.siri_route__line_ref !== request.lineRef) return false;
        if (typeof row.lat !== 'number' || typeof row.lon !== 'number') return false;
        const at = new Date(row.recorded_at_time).getTime();
        return Number.isFinite(at) && at >= cutoff;
      });

      if (fresh.length === 0) {
        return { available: false, reason: 'אין כרגע נתוני זמן אמת לקו הזה' };
      }

      return {
        available: true,
        vehicles: fresh.map((row) => ({
          lineNumber: request.lineNumber,
          lat: row.lat,
          lon: row.lon,
          recordedAt: row.recorded_at_time,
        })),
      };
    } catch {
      return { available: false, reason: 'מידע בזמן אמת אינו זמין כרגע' };
    }
  },
};
