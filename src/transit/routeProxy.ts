import { Coords } from '../weather/types';
import { walkingMinutes } from './walking';
import { PlannedJourney, rankJourneys, RouteOption } from './routePlanner';
import { TransitOption, TransitStopRef } from './types';

/**
 * The route search, when it is running on a server instead of the phone.
 *
 * The data source has no journey planner, so a search with a change has to be
 * assembled from stop_times. Measured on the phone that costs about 14 MB for one
 * change and 25-35 MB for two — not something to do to somebody's mobile data. So
 * `server/routes-proxy.js` runs the same search where bandwidth is free and sends
 * back a few kilobytes of journeys.
 *
 * There is **no API key here and none is needed**: Stride requires none. The only
 * configuration is a URL, which is why it can live in a public env var. Until that
 * URL is set this module reports itself unconfigured, is never called, and the app
 * keeps doing its own on-device direct-only search — exactly as it did before.
 *
 * Ranking is deliberately *not* done here. The proxy finds journeys; scoring stays
 * in routePlanner.ts, so a one-leg journey found on the device and a two-leg
 * journey found by the proxy are compared by the same function.
 */

/** Where the search runs. A URL, not a credential. Absent by default. */
const ENDPOINT = process.env.EXPO_PUBLIC_TRANSIT_ROUTES_ENDPOINT?.trim() || '';

/** Long enough for a cold isolate to build its stop index, short enough to bail. */
const TIMEOUT_MS = 12_000;

export type RouteProxyFailure =
  /** No endpoint, so nothing was sent anywhere. */
  | 'not-configured'
  /** The request could not leave the device, or nothing came back. */
  | 'offline'
  /** It answered, but not with anything usable. */
  | 'bad-response'
  | 'timeout'
  | 'failed';

export type RouteProxyResult =
  | { status: 'ok'; routes: RouteOption[]; transfersSearched: number }
  | { status: 'error'; reason: RouteProxyFailure };

/** True when a route search server is wired up. False today. */
export function isRouteProxyConfigured(): boolean {
  return ENDPOINT.length > 0;
}

/* ------------------------------------------------------------------ parsing --- */

type RawStop = { code: number; name: string; city: string; lat?: number; lon?: number };

function parseStop(raw: unknown): RawStop | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.code !== 'number') return null;
  return {
    code: o.code,
    name: typeof o.name === 'string' ? o.name : `תחנה ${o.code}`,
    city: typeof o.city === 'string' ? o.city : '',
    lat: typeof o.lat === 'number' ? o.lat : undefined,
    lon: typeof o.lon === 'number' ? o.lon : undefined,
  };
}

const toRef = (stop: RawStop): TransitStopRef => ({
  code: stop.code,
  name: stop.name,
  city: stop.city,
});

/**
 * One leg, turned into the `TransitOption` the rest of the app already speaks.
 *
 * Returns null on anything unverifiable. A leg with no usable times is not a leg,
 * and passing it on would put an invented journey in front of the user.
 */
function parseLeg(
  raw: unknown,
  scheduleDate: string,
): { option: TransitOption; from: RawStop; to: RawStop } | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const from = parseStop(o.from);
  const to = parseStop(o.to);
  if (!from || !to) return null;

  const departure = typeof o.departure === 'string' ? o.departure : '';
  const arrival = typeof o.arrival === 'string' ? o.arrival : '';
  if (!Number.isFinite(new Date(departure).getTime())) return null;
  if (!Number.isFinite(new Date(arrival).getTime())) return null;

  return {
    from,
    to,
    option: {
      id: typeof o.id === 'string' ? o.id : `${from.code}-${to.code}-${departure}`,
      lineNumber: typeof o.lineNumber === 'string' ? o.lineNumber : '—',
      agency: typeof o.agency === 'string' ? o.agency : '',
      headsign: typeof o.headsign === 'string' ? o.headsign : '',
      boardStopName: from.name,
      boardStopCode: from.code,
      departure,
      alightStopName: to.name,
      alightStopCode: to.code,
      arrival,
      scheduleDate,
      // Carried so live data can be asked about this exact line and no other.
      lineRef: typeof o.lineRef === 'number' ? o.lineRef : undefined,
      operatorRef: typeof o.operatorRef === 'number' ? o.operatorRef : undefined,
      boardStopLat: from.lat,
      boardStopLon: from.lon,
    },
  };
}

/** Straight-line metres between two stops, when both reported a position. */
function metresBetween(a: RawStop, b: RawStop): number | null {
  if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) return null;
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/**
 * The response, turned into journeys the planner can rank.
 *
 * Anything that cannot be verified is dropped rather than trusted. Returns null
 * when the body yields nothing at all, so the caller falls back instead of showing
 * an empty result as though it were an answer.
 */
export function parseJourneys(raw: unknown): { journeys: PlannedJourney[]; transfersSearched: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;
  if (!Array.isArray(body.journeys)) return null;

  const scheduleDate = typeof body.scheduleDate === 'string' ? body.scheduleDate : '';
  const journeys: PlannedJourney[] = [];

  for (const entry of body.journeys) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (!Array.isArray(e.legs) || e.legs.length === 0) continue;

    const parsed = e.legs.map((leg) => parseLeg(leg, scheduleDate));
    // One unusable leg makes the whole journey unusable.
    if (parsed.some((leg) => leg === null)) continue;
    const legs = parsed as NonNullable<(typeof parsed)[number]>[];

    const originMetres = typeof e.originMetres === 'number' ? e.originMetres : null;
    const destinationMetres =
      typeof e.destinationMetres === 'number' ? e.destinationMetres : null;

    journeys.push({
      legs: legs.map((leg, index) => {
        /*
         * The walk before each leg: from the user for the first, and between the
         * two stops of a change for the rest. Where nothing measured it, it is
         * zero rather than estimated.
         */
        let walkBeforeMinutes = 0;
        if (index === 0) {
          if (originMetres != null) walkBeforeMinutes = walkingMinutes(originMetres);
        } else {
          const metres = metresBetween(legs[index - 1].to, leg.from);
          // Standing at the same stop is not a walk.
          if (metres != null && metres > 30) walkBeforeMinutes = walkingMinutes(metres);
        }
        return {
          option: leg.option,
          departureStop: toRef(leg.from),
          arrivalStop: toRef(leg.to),
          walkBeforeMinutes,
        };
      }),
      walkAfterMinutes: destinationMetres != null ? walkingMinutes(destinationMetres) : 0,
      ...(originMetres != null ? { metresToOrigin: originMetres } : {}),
    });
  }

  if (journeys.length === 0) return null;

  return {
    journeys,
    transfersSearched: typeof body.transfersSearched === 'number' ? body.transfersSearched : 0,
  };
}

/* ------------------------------------------------------------------ the call --- */

/**
 * Asks the search server for journeys, ranked.
 *
 * Never throws: every failure is a reason the caller can fall back on. The user
 * is never shown an API error — they get the on-device answer instead.
 */
export async function findRoutesViaProxy(params: {
  from: Coords;
  to: Coords | { stopCode: number };
  /** Target arrival, when the departure has one. */
  arriveBy?: Date;
  now?: number;
  signal?: AbortSignal;
}): Promise<RouteProxyResult> {
  if (!ENDPOINT) return { status: 'error', reason: 'not-configured' };

  const now = params.now ?? Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onAbort = () => controller.abort();
  params.signal?.addEventListener('abort', onAbort);

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: { lat: params.from.latitude, lon: params.from.longitude },
        to:
          'stopCode' in params.to
            ? { stopCode: params.to.stopCode }
            : { lat: params.to.latitude, lon: params.to.longitude },
        departAfter: new Date(now).toISOString(),
        ...(params.arriveBy ? { arriveBy: params.arriveBy.toISOString() } : {}),
        maxTransfers: 1,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // The status only; a failing endpoint can echo anything back.
      return { status: 'error', reason: response.status >= 500 ? 'bad-response' : 'failed' };
    }

    const parsed = parseJourneys(await response.json());
    if (!parsed) return { status: 'error', reason: 'bad-response' };

    return {
      status: 'ok',
      routes: rankJourneys({ journeys: parsed.journeys, now }),
      transfersSearched: parsed.transfersSearched,
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const message = error instanceof Error ? error.message : '';
    if (name === 'AbortError') return { status: 'error', reason: 'timeout' };
    if (/network|failed to fetch|load failed/i.test(message)) {
      return { status: 'error', reason: 'offline' };
    }
    return { status: 'error', reason: 'failed' };
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener('abort', onAbort);
  }
}
