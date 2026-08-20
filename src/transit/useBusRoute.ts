import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentLocation, LocationFailure } from '../location';
import { useStore } from '../store';
import { Destination } from '../types';
import { Coords } from '../weather/types';
import { BusRouteResult, findBusRoute, forgetBusRoutes } from './nearbyRoute';
import { TransitStopRef } from './types';

/**
 * The boarding stop for a bus departure, found rather than asked for.
 *
 * Location is requested only when this runs for a bus departure — and that is
 * when the device asks the user, which is the "clear request" the flow needs. A
 * failure is a state of its own, carrying *why* it failed, so the card can say
 * the true thing and offer picking a stop by hand instead.
 *
 * The search itself (and its cache) lives in nearbyRoute.ts, untouched; this hook
 * is the React side: getting a location from `src/location.ts`, one search per
 * departure, and the manual override.
 */

export type BusRouteState =
  | { phase: 'idle' }
  | { phase: 'locating' }
  | { phase: 'searching' }
  /**
   * No location, and no stop saved on the destination to fall back to. `reason`
   * is why — a refusal, a switched-off GPS and a timeout are not the same thing
   * and must not be shown as one.
   */
  | { phase: 'no-location'; reason: LocationFailure }
  | { phase: 'done'; result: BusRouteResult };

/** What the card gets: the current state plus the two actions it offers. */
export type BusRoute = {
  state: BusRouteState;
  /** The stop the user picked by hand for this departure, if any. */
  manualStop: TransitStopRef | undefined;
  /** Picks a stop by hand for this departure only. */
  chooseStop: (stop: TransitStopRef) => void;
  /** Drops that choice and goes back to searching around the user. */
  clearStop: () => void;
  /** Searches again from scratch — used by "נסה שוב". */
  retry: () => void;
};

export function useBusRoute(
  destination: Destination | undefined,
  /** True only while this departure is actually by bus. */
  active: boolean,
  /** The hour to arrive by, epoch millis. */
  arriveAt: number,
): BusRoute {
  const { departureStop, setDepartureStop, clearDepartureStop } = useStore();
  const [state, setState] = useState<BusRouteState>({ phase: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(true);

  const destinationId = destination?.id;
  const manualStop = destinationId ? departureStop(destinationId) : undefined;
  const savedPlan = destination?.transit;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!destination || !active) {
      setState({ phase: 'idle' });
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const run = async () => {
      setState({ phase: 'locating' });

      /*
       * A stop the user picked by hand needs no location at all — and neither does
       * the one saved on the destination, which is the fallback when location is
       * refused instead of a dead end.
       */
      let userCoords: Coords | undefined;
      if (!manualStop) {
        const located = await getCurrentLocation();
        if (cancelled || !alive.current) return;

        if (located.status === 'ok') {
          userCoords = {
            latitude: located.location.latitude,
            longitude: located.location.longitude,
          };
        } else {
          const savedStop = savedPlan?.originStop;
          if (!savedStop) {
            setState({ phase: 'no-location', reason: located.reason });
            return;
          }
          setState({ phase: 'searching' });
          const fallback = await findBusRoute({
            destinationId: destination.id,
            destinationCoords: destination.coords,
            savedDestinationStop: savedPlan?.destinationStop,
            arriveBy: new Date(arriveAt),
            forcedStop: { stop: savedStop, source: 'saved' },
            signal: controller.signal,
          });
          if (cancelled || !alive.current) return;
          setState({ phase: 'done', result: fallback });
          return;
        }
      }

      if (cancelled || !alive.current) return;
      setState({ phase: 'searching' });

      const result = await findBusRoute({
        destinationId: destination.id,
        destinationCoords: destination.coords,
        savedDestinationStop: savedPlan?.destinationStop,
        userCoords,
        arriveBy: new Date(arriveAt),
        forcedStop: manualStop ? { stop: manualStop, source: 'manual' } : undefined,
        signal: controller.signal,
      });

      if (cancelled || !alive.current) return;
      setState({ phase: 'done', result });
    };

    void run();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinationId, active, arriveAt, manualStop?.code, attempt]);

  const chooseStop = useCallback(
    (stop: TransitStopRef) => {
      if (!destinationId) return;
      // A hand-picked stop replaces the found one for this departure only.
      forgetBusRoutes(destinationId);
      setDepartureStop(destinationId, stop);
    },
    [destinationId, setDepartureStop],
  );

  const clearStop = useCallback(() => {
    if (!destinationId) return;
    forgetBusRoutes(destinationId);
    clearDepartureStop(destinationId);
  }, [destinationId, clearDepartureStop]);

  const retry = useCallback(() => {
    if (destinationId) forgetBusRoutes(destinationId);
    setAttempt((previous) => previous + 1);
  }, [destinationId]);

  return { state, manualStop, chooseStop, clearStop, retry };
}
