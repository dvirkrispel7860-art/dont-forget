import {
  RealtimeRequest,
  RealtimeResult,
  TransitOption,
  TransitOptionsRequest,
  TransitStop,
} from './types';

/**
 * The only surface the app is allowed to use for transit data.
 *
 * Screens and components never import a concrete provider — they import
 * `transit` from ./index. Swapping the data source (a different GTFS mirror, a
 * self-hosted OTP server, a paid API behind our own backend) means writing one
 * new object that satisfies this type.
 */
export type TransitProvider = {
  /** Short id for logging/diagnostics. */
  id: string;
  /** Human name of the data source, shown to the user for honesty. */
  sourceLabel: string;

  /** Stops closest to a coordinate, nearest first. */
  getNearbyStops: (
    lat: number,
    lon: number,
    options?: { limit?: number; signal?: AbortSignal },
  ) => Promise<TransitStop[]>;

  /** Stops whose name or city matches free text. */
  searchStops: (
    query: string,
    options?: { limit?: number; signal?: AbortSignal },
  ) => Promise<TransitStop[]>;

  /** Journeys between two stops arriving by a given time, from the timetable. */
  getTransitOptions: (
    request: TransitOptionsRequest,
    options?: { signal?: AbortSignal },
  ) => Promise<TransitOption[]>;

  /** Live vehicle positions, when the source exposes them. */
  getRealtimeTransitData: (
    request: RealtimeRequest,
    options?: { signal?: AbortSignal },
  ) => Promise<RealtimeResult>;
};
