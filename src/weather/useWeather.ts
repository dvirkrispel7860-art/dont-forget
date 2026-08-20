import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildDepartureContext,
  CheckSuggestion,
  checkSuggestions,
} from '../departureContext';
import { useStore } from '../store';
import { Destination, Trip } from '../types';
import { getDestinationWeather, weatherTargetTime } from './index';
import { WeatherResult } from './types';

/**
 * The forecast for one destination, for one moment.
 *
 * Components use this and never touch the provider or the network themselves.
 * The request goes through the cache, so mounting this on two screens at once
 * (the destination screen and מצב יציאה) costs at most one round trip.
 */
export type WeatherState = {
  /** True while the first answer for the current inputs is still on its way. */
  loading: boolean;
  /** null only before the first answer arrives. */
  result: WeatherResult | null;
  /** "נסה שוב" — asks again from scratch. */
  reload: () => void;
};

export function useDestinationWeather(
  destination: Destination | undefined,
  at: number,
): WeatherState {
  const { updateDestination } = useStore();
  const [result, setResult] = useState<WeatherResult | null>(null);
  const [loading, setLoading] = useState(destination != null);
  const [attempt, setAttempt] = useState(0);
  /** Destinations whose geocode result was already written back this session. */
  const stored = useRef<Set<string>>(new Set());

  const id = destination?.id;
  const address = destination?.address;
  const latitude = destination?.coords?.latitude;
  const longitude = destination?.coords?.longitude;

  useEffect(() => {
    if (!destination) {
      setResult(null);
      setLoading(false);
      return;
    }

    let alive = true;
    const controller = new AbortController();
    setLoading(true);

    void getDestinationWeather(destination, at, controller.signal).then((next) => {
      if (!alive) return;
      setResult(next);
      setLoading(false);
    });

    return () => {
      alive = false;
      controller.abort();
    };
    // Re-runs when the destination's location inputs, the target hour, or the
    // retry counter change — not on every unrelated render of the destination.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, address, latitude, longitude, at, attempt]);

  /*
   * Keep a geocode result on the destination.
   *
   * The address had to be turned into coordinates for this forecast anyway;
   * saving them means the next forecast — and every screen after this one — skips
   * the lookup entirely. Only ever written when the destination has none, and
   * only from a real answer: this never overwrites something the user set, and
   * never stores a guess.
   */
  useEffect(() => {
    if (!destination || destination.coords) return;
    if (result?.status !== 'ok') return;
    if (stored.current.has(destination.id)) return;

    const { location } = result.forecast;
    stored.current.add(destination.id);
    updateDestination(destination.id, {
      coords: { latitude: location.latitude, longitude: location.longitude },
      coordsLabel: location.label,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination?.id, destination?.coords, result]);

  const reload = useCallback(() => setAttempt((previous) => previous + 1), []);

  return { loading, result, reload };
}

/**
 * What a screen about to send someone out the door needs: the forecast for the
 * relevant hour, plus everything worth checking before leaving — the history's
 * suggestions and the weather's, already merged and de-duplicated against the
 * list (see checkSuggestions).
 *
 * The hour is the destination's desired arrival time when it has one, otherwise
 * now — decided once per mount so the card does not chase the clock.
 */
export type DepartureWeather = WeatherState & { suggestions: CheckSuggestion[] };

export function useDepartureWeather(
  destination: Destination | undefined,
  trips: Trip[],
): DepartureWeather {
  const arriveBy = destination?.transit?.arriveBy;
  const id = destination?.id;

  const at = useMemo(
    () => weatherTargetTime(destination),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, arriveBy],
  );

  const state = useDestinationWeather(destination, at);

  /*
   * Built even without a forecast: the history has plenty to say on its own, and
   * a missing forecast should not silence it.
   */
  const suggestions = useMemo(() => {
    if (!destination) return [];
    const forecast = state.result?.status === 'ok' ? state.result.forecast : null;
    return checkSuggestions(
      buildDepartureContext(
        destination,
        trips,
        forecast
          ? { reading: forecast.reading, locationLabel: forecast.location.label }
          : null,
      ),
    );
  }, [destination, trips, state.result]);

  return { ...state, suggestions };
}
