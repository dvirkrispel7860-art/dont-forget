import { transit } from './index';
import { RealtimeResult, RealtimeVehicle, TransitOption } from './types';

/**
 * What the live feed can honestly say about a journey.
 *
 * The source reports **vehicle positions**, not predictions: it says where a bus
 * is and when that was recorded. So this layer reports presence, freshness and
 * measured distance — and never turns any of it into an arrival time. The times
 * shown next to a ride stay the timetable's.
 *
 * `summarizeRealtime` is a pure function over data we already have. It is what a
 * future "🔔 הגיע הזמן לצאת" decision would run on, which is why the departure
 * countdown lives here rather than inside a component.
 */

/** Matches the provider's own freshness rule. */
export const FRESH_REALTIME_MINUTES = 10;

/** A report younger than this is as good as now. */
const VERY_FRESH_MINUTES = 3;

export type RealtimeSummary = {
  /** True only when the feed reported this line's position recently. */
  live: boolean;
  /** Reason the feed had nothing, when it had nothing. */
  reason?: string;
  /** Whole minutes since the newest position report. */
  minutesSinceUpdate?: number;
  /** 'fresh' under three minutes, 'aging' up to the freshness limit. */
  freshness?: 'fresh' | 'aging';
  /** How many vehicles of this line are reporting. */
  vehicleCount?: number;
  /**
   * Straight-line metres from the nearest reporting vehicle to the boarding stop.
   * Absent when the timetable did not give the stop's position. Deliberately not
   * converted into minutes — road distance and traffic are not in this data.
   */
  metresToBoardStop?: number;
  /** Minutes until the scheduled departure. Negative once it has passed. */
  minutesToScheduledDeparture?: number;
};

function minutesBetween(from: number, to: number): number {
  return Math.round((to - from) / 60_000);
}

/** Straight-line distance in metres. Same maths the provider uses for stops. */
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

function newest(vehicles: RealtimeVehicle[]): RealtimeVehicle | null {
  let best: RealtimeVehicle | null = null;
  let bestAt = -Infinity;
  for (const vehicle of vehicles) {
    const at = new Date(vehicle.recordedAt).getTime();
    if (Number.isFinite(at) && at > bestAt) {
      best = vehicle;
      bestAt = at;
    }
  }
  return best;
}

export function summarizeRealtime(
  option: TransitOption | undefined,
  result: RealtimeResult | null,
  now: number = Date.now(),
): RealtimeSummary {
  const minutesToScheduledDeparture = option
    ? minutesBetween(now, new Date(option.departure).getTime())
    : undefined;

  if (!result || !result.available) {
    return {
      live: false,
      reason: result?.available === false ? result.reason : undefined,
      minutesToScheduledDeparture,
    };
  }

  const latest = newest(result.vehicles);
  if (!latest) {
    return { live: false, minutesToScheduledDeparture };
  }

  const minutesSinceUpdate = Math.max(
    0,
    minutesBetween(new Date(latest.recordedAt).getTime(), now),
  );

  // Only report a distance when the timetable gave us the stop's position.
  let metresToBoardStop: number | undefined;
  if (option?.boardStopLat != null && option?.boardStopLon != null) {
    const closest = result.vehicles.reduce<number | undefined>((best, vehicle) => {
      const metres = distanceMeters(
        vehicle.lat,
        vehicle.lon,
        option.boardStopLat as number,
        option.boardStopLon as number,
      );
      return best == null || metres < best ? metres : best;
    }, undefined);
    if (closest != null) metresToBoardStop = Math.round(closest);
  }

  return {
    live: true,
    minutesSinceUpdate,
    freshness: minutesSinceUpdate <= VERY_FRESH_MINUTES ? 'fresh' : 'aging',
    vehicleCount: result.vehicles.length,
    metresToBoardStop,
    minutesToScheduledDeparture,
  };
}

/* ------------------------------------------------------------ rate limiting --- */

/**
 * One request per line per window, shared by every screen.
 *
 * Live data is only refreshed on purpose — a mounted card, or the user pressing
 * "🔄 רענן" — and never more often than this, no matter how many cards ask or how
 * fast the button is tapped. The window is short enough that the answer is still
 * live and long enough that the public source is not hammered.
 */
export const MIN_REALTIME_INTERVAL_MS = 20_000;

type CacheEntry = { at: number; result: RealtimeResult };

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<RealtimeResult>>();

function keyFor(option: TransitOption): string {
  return `${option.lineRef ?? option.lineNumber}:${option.operatorRef ?? ''}`;
}

/** Milliseconds until this line may be asked about again. 0 when it may now. */
export function realtimeCooldownMs(
  option: TransitOption | undefined,
  now: number = Date.now(),
): number {
  if (!option) return 0;
  const entry = cache.get(keyFor(option));
  if (!entry) return 0;
  return Math.max(0, MIN_REALTIME_INTERVAL_MS - (now - entry.at));
}

/**
 * Live data for one timetable option, through the existing provider call.
 *
 * Inside the window the cached answer is returned without a request; concurrent
 * askers share one round trip.
 */
export async function getRealtimeFor(
  option: TransitOption,
  options?: { signal?: AbortSignal; force?: boolean },
): Promise<RealtimeResult> {
  const key = keyFor(option);
  const entry = cache.get(key);

  if (entry && (options?.force !== true || realtimeCooldownMs(option) > 0)) {
    if (Date.now() - entry.at < MIN_REALTIME_INTERVAL_MS) return entry.result;
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  /*
   * The caller's signal is not forwarded into the shared request: one card
   * unmounting must not cancel the answer another card is waiting for. A caller
   * that went away ignores the result.
   */
  const request = transit
    .getRealtimeTransitData({
      lineNumber: option.lineNumber,
      originCode: option.boardStopCode,
      lineRef: option.lineRef,
      operatorRef: option.operatorRef,
    })
    .then((result) => {
      cache.set(key, { at: Date.now(), result });
      return result;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, request);
  return request;
}
