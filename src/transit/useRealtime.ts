import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getRealtimeFor,
  MIN_REALTIME_INTERVAL_MS,
  realtimeCooldownMs,
  RealtimeSummary,
  summarizeRealtime,
} from './realtime';
import { RealtimeResult, TransitOption } from './types';

/**
 * Live status for one timetable option.
 *
 * Refreshing is bounded on three sides: the card asks once when it appears, then
 * on a slow interval while it stays open, and the "🔄 רענן" button is disabled
 * until the shared rate limit allows another request. Nothing polls in the
 * background — when the screen is gone, so are the requests.
 */

/** While a card is open, this is how often it takes another look. */
const AUTO_REFRESH_MS = 60_000;

/** Keeps the button's countdown moving without touching the network. */
const COOLDOWN_TICK_MS = 1_000;

export type RealtimeState = {
  summary: RealtimeSummary;
  loading: boolean;
  /** Seconds until another refresh is allowed; 0 when it is allowed now. */
  cooldownSeconds: number;
  refresh: () => void;
};

export function useRealtime(option: TransitOption | undefined): RealtimeState {
  const [result, setResult] = useState<RealtimeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(true);

  const key = option ? `${option.lineRef ?? option.lineNumber}:${option.id}` : '';

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!option) {
      setResult(null);
      return;
    }

    const controller = new AbortController();
    let timer: ReturnType<typeof setInterval> | null = null;

    const look = () => {
      setLoading(true);
      void getRealtimeFor(option, { signal: controller.signal }).then((next) => {
        if (!alive.current) return;
        setResult(next);
        setLoading(false);
        setCooldownSeconds(Math.ceil(realtimeCooldownMs(option) / 1000));
      });
    };

    look();
    timer = setInterval(look, AUTO_REFRESH_MS);

    return () => {
      controller.abort();
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  // Counts the cooldown down locally — no requests involved.
  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      if (!option) return;
      setCooldownSeconds(Math.ceil(realtimeCooldownMs(option) / 1000));
    }, COOLDOWN_TICK_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cooldownSeconds > 0, key]);

  const refresh = useCallback(() => {
    // A press inside the window does nothing at all: the button is disabled, and
    // even if it were not, the rate limit would answer from the cache.
    if (!option || realtimeCooldownMs(option) > 0) return;
    setAttempt((previous) => previous + 1);
  }, [option]);

  return {
    summary: summarizeRealtime(option, result),
    loading: loading && result === null,
    cooldownSeconds,
    refresh,
  };
}

export { AUTO_REFRESH_MS, MIN_REALTIME_INTERVAL_MS };
