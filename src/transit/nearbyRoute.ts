import { Coords } from '../weather/types';
import { transit } from './index';
import { planRoutes, RouteOption } from './routePlanner';
import { findRoutesViaProxy, isRouteProxyConfigured } from './routeProxy';
import { walkingMinutes } from './walking';
import { TransitOption, TransitStop, TransitStopRef } from './types';

/**
 * Finding the stop to board at, without asking the user to pick one.
 *
 * The rule that matters: **not** the nearest stop, but the nearest stop that
 * actually has a ride to the destination. A stop 80 metres away with no service
 * there is useless; one 300 metres away with a line that goes there is the
 * answer.
 *
 * Everything here goes through the existing transit provider — `getNearbyStops`
 * for candidates and `getTransitOptions` for "is there really a ride" — so the
 * transit system itself is untouched. Nothing is invented: a stop is only offered
 * with a real ride from the official timetable behind it.
 */

/** How many stops around the user are worth testing. */
const ORIGIN_CANDIDATES = 5;

/** How many stops around the destination are worth testing. */
const DESTINATION_CANDIDATES = 2;

/** A found route is reused for this long instead of searching again. */
const CACHE_TTL_MS = 5 * 60_000;

export type BusOriginSource = 'auto' | 'manual' | 'saved';

export type FoundBusRoute = {
  origin: TransitStopRef;
  /** Straight-line metres from the user's point — absent for a saved/manual stop. */
  metresFromUser?: number;
  originSource: BusOriginSource;
  destinationStop: TransitStopRef;
  /** The ride that made this stop the answer. */
  option: TransitOption;
  /** Every ride found from that stop, best first — what the card lists. */
  options: TransitOption[];
  /**
   * The ranked journeys, best first, at most three — 🥇🥈🥉.
   *
   * `origin` and `option` above are the first of these, kept as their own fields
   * so everything that already reads them keeps working unchanged. Empty when
   * every ride found has already departed.
   */
  routes: RouteOption[];
};

export type BusRouteResult =
  | { status: 'ok'; route: FoundBusRoute }
  /** The destination has no coordinates and no stop of its own to aim at. */
  | { status: 'no-destination-location' }
  /** There are no stops at all around the user's point. */
  | { status: 'no-stops-nearby' }
  /**
   * No ride to the destination. `forced` tells the two cases apart: the stops
   * around the user had none, or the one stop the user insisted on has none.
   */
  | { status: 'no-ride-nearby'; forced: boolean }
  | { status: 'failed'; reason: string };

/**
 * Re-exported so everything that already imports it from here keeps working. It
 * lives in walking.ts, which imports nothing — see the note there on why.
 */
export { walkingMinutes };

function toRef(stop: TransitStop | TransitStopRef): TransitStopRef {
  return { code: stop.code, name: stop.name, city: stop.city };
}

/**
 * A stop to aim at, plus how far it leaves the user from the destination itself.
 *
 * That distance is the final walk, and it is part of the journey — a stop that
 * gets you within fifty metres and one that leaves you a kilometre away are not
 * the same arrival. Absent when the destination has no coordinates to measure
 * against, in which case nothing here invents one.
 */
type DestinationStop = TransitStopRef & { metresToDestination?: number };

/* ------------------------------------------------------------------- cache --- */

type CacheEntry = { at: number; result: BusRouteResult };

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<BusRouteResult>>();

/** ~100m of user movement and 10-minute arrival buckets share one search. */
function cacheKey(params: {
  destinationId: string;
  userCoords?: Coords;
  arriveBy: Date;
  forcedStopCode?: number;
}): string {
  const lat = params.userCoords ? params.userCoords.latitude.toFixed(3) : '-';
  const lon = params.userCoords ? params.userCoords.longitude.toFixed(3) : '-';
  const bucket = Math.floor(params.arriveBy.getTime() / (10 * 60_000));
  return `${params.destinationId}|${lat},${lon}|${bucket}|${params.forcedStopCode ?? ''}`;
}

/** Drops what this destination remembers, e.g. after the user picks another stop. */
export function forgetBusRoutes(destinationId: string): void {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${destinationId}|`)) cache.delete(key);
  }
}

/* ------------------------------------------------------------------ search --- */

/**
 * Which stops near the destination to aim at.
 *
 * A stop the user already set up for this destination is the truth and is used
 * alone. Otherwise the destination's own coordinates give candidates — and with
 * no coordinates there is nothing to aim at, which is reported rather than
 * guessed around.
 */
async function destinationStops(
  savedStop: TransitStopRef | undefined,
  destinationCoords: Coords | undefined,
  signal?: AbortSignal,
): Promise<DestinationStop[]> {
  /*
   * A stop the user set up themselves is the truth, and nothing measured how far
   * it is from the destination — so the final walk is unknown rather than
   * guessed, and the journey simply does not count one.
   */
  if (savedStop) return [savedStop];
  if (!destinationCoords) return [];

  const near = await transit.getNearbyStops(
    destinationCoords.latitude,
    destinationCoords.longitude,
    { limit: DESTINATION_CANDIDATES, signal },
  );
  return near.map((stop) => ({
    ...toRef(stop),
    // Measured from the destination itself, by the same provider that ranked them.
    metresToDestination: stop.distanceMeters,
  }));
}

async function searchRoute(params: {
  destinationId: string;
  destinationCoords?: Coords;
  savedDestinationStop?: TransitStopRef;
  userCoords?: Coords;
  arriveBy: Date;
  /**
   * A stop to use instead of searching around the user: one they picked by hand,
   * or the one saved on the destination when there is no location to search from.
   */
  forcedStop?: { stop: TransitStopRef; source: BusOriginSource };
  signal?: AbortSignal;
}): Promise<BusRouteResult> {
  try {
    /*
     * The search server first, when one is configured.
     *
     * It is the only thing that can offer a journey with a change: assembling
     * one from stop_times costs about 14 MB on the phone, so it runs where
     * bandwidth is free (see routeProxy.ts). It is asked only when it can
     * actually help — both ends known as coordinates, and no stop the user
     * insisted on, since a forced stop is an instruction, not a search.
     *
     * A failure here is not an error the user should see. The on-device
     * direct-only search below runs instead, exactly as it did before any of
     * this existed.
     */
    if (
      isRouteProxyConfigured() &&
      !params.forcedStop &&
      params.userCoords &&
      params.destinationCoords
    ) {
      const viaProxy = await findRoutesViaProxy({
        from: params.userCoords,
        to: params.destinationCoords,
        arriveBy: params.arriveBy,
        signal: params.signal,
      });

      if (viaProxy.status === 'ok' && viaProxy.routes.length > 0) {
        const best = viaProxy.routes[0];
        return {
          status: 'ok',
          route: {
            origin: best.originStop,
            metresFromUser: best.metresToOrigin,
            originSource: 'auto',
            destinationStop: best.destinationStop,
            option: best.legs[0].option,
            // The chosen journey's own legs; later rides from the same stop are
            // an on-device notion and do not apply to a multi-leg journey.
            options: best.legs.map((leg) => leg.option),
            routes: viaProxy.routes,
          },
        };
      }
    }

    const targets = await destinationStops(
      params.savedDestinationStop,
      params.destinationCoords,
      params.signal,
    );
    if (targets.length === 0) return { status: 'no-destination-location' };

    // Candidate stops to board at, nearest first.
    let candidates: { ref: TransitStopRef; metres?: number; source: BusOriginSource }[];

    if (params.forcedStop) {
      candidates = [
        { ref: params.forcedStop.stop, source: params.forcedStop.source },
      ];
    } else {
      if (!params.userCoords) return { status: 'no-stops-nearby' };
      const near = await transit.getNearbyStops(
        params.userCoords.latitude,
        params.userCoords.longitude,
        { limit: ORIGIN_CANDIDATES, signal: params.signal },
      );
      if (near.length === 0) return { status: 'no-stops-nearby' };
      candidates = near.map((stop) => ({
        ref: toRef(stop),
        metres: stop.distanceMeters,
        source: 'auto' as const,
      }));
    }

    /*
     * The candidates are tested in parallel against one destination stop at a
     * time. Parallel because a serial walk over five stops would take as long as
     * five timetable lookups; one destination stop at a time because the first
     * one is almost always the right one, and the second is only worth the
     * requests when the first found nothing.
     */
    for (const target of targets) {
      const attempts = await Promise.all(
        candidates.map(async (candidate) => {
          try {
            const options = await transit.getTransitOptions(
              {
                originCode: candidate.ref.code,
                destinationCode: target.code,
                arriveBy: params.arriveBy,
                limit: 4,
              },
              { signal: params.signal },
            );
            return { candidate, options };
          } catch {
            // One stop failing must not sink the whole search.
            return { candidate, options: [] as TransitOption[] };
          }
        }),
      );

      const withRides = attempts.filter((attempt) => attempt.options.length > 0);
      if (withRides.length === 0) continue;

      /*
       * Every candidate stop's rides become whole journeys, and the journeys
       * compete on when the user actually arrives — see routePlanner.ts. This is
       * what replaced "the nearest stop that has a ride": a stop fifty metres
       * away whose bus is forty minutes off now loses to one three hundred metres
       * away whose bus is leaving, which is the right answer and the one distance
       * alone could never give.
       *
       * The request count is unchanged. The same lookups are made; only the
       * choice between their results is better.
       */
      const now = Date.now();
      const routes = planRoutes({
        candidates: withRides.map((attempt) => ({
          stop: attempt.candidate.ref,
          metresFromUser: attempt.candidate.metres,
          options: attempt.options,
        })),
        targets: [{ stop: target, metresToDestination: target.metresToDestination }],
        now,
      });

      if (routes.length > 0) {
        const best = routes[0];
        const winner = withRides.find(
          (attempt) => attempt.candidate.ref.code === best.originStop.code,
        );

        /*
         * The chosen stop's own later rides, kept for the existing "נסיעות
         * נוספות מאותה תחנה" list. Chronological and future-only, as before.
         */
        const upcoming = [...(winner?.options ?? [])]
          .sort((a, b) => new Date(a.departure).getTime() - new Date(b.departure).getTime())
          .filter((option) => new Date(option.departure).getTime() >= now - 60_000);

        return {
          status: 'ok',
          route: {
            origin: best.originStop,
            metresFromUser: best.metresToOrigin,
            originSource: winner?.candidate.source ?? 'auto',
            destinationStop: target,
            option: best.legs[0].option,
            options: upcoming.length > 0 ? upcoming : [best.legs[0].option],
            routes,
          },
        };
      }

      /*
       * Rides exist but every one of them has already gone. Report the last one
       * rather than hiding that the service is over for now — the same behaviour
       * as before the planner.
       */
      const stale = withRides[0];
      const last = [...stale.options].sort(
        (a, b) => new Date(a.departure).getTime() - new Date(b.departure).getTime(),
      )[stale.options.length - 1];
      return {
        status: 'ok',
        route: {
          origin: stale.candidate.ref,
          metresFromUser: stale.candidate.metres,
          originSource: stale.candidate.source,
          destinationStop: target,
          option: last,
          options: [last],
          routes: [],
        },
      };
    }

    return { status: 'no-ride-nearby', forced: params.forcedStop != null };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return {
      status: 'failed',
      reason: /network|failed to fetch|load failed/i.test(message)
        ? 'אין חיבור לאינטרנט'
        : 'לוח הזמנים לא זמין כרגע',
    };
  }
}

/**
 * The stop to board at, from the cache when a recent answer still holds.
 *
 * The cache is what keeps this from searching every few seconds: the same user
 * point (to ~100m), the same destination and the same arrival bucket reuse one
 * result for five minutes, and concurrent callers share a single search.
 */
export async function findBusRoute(params: {
  destinationId: string;
  destinationCoords?: Coords;
  savedDestinationStop?: TransitStopRef;
  userCoords?: Coords;
  arriveBy: Date;
  forcedStop?: { stop: TransitStopRef; source: BusOriginSource };
  signal?: AbortSignal;
}): Promise<BusRouteResult> {
  const key = cacheKey({
    destinationId: params.destinationId,
    userCoords: params.userCoords,
    arriveBy: params.arriveBy,
    forcedStopCode: params.forcedStop?.stop.code,
  });

  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

  const existing = inflight.get(key);
  if (existing) return existing;

  const request = searchRoute(params)
    .then((result) => {
      // Only worth remembering an answer; a failure should be retried.
      if (result.status === 'ok' || result.status === 'no-ride-nearby') {
        cache.set(key, { at: Date.now(), result });
      }
      return result;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, request);
  return request;
}
