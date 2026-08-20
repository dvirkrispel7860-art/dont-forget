/** How the user gets to a destination. */
export type TravelMode = 'car' | 'bus' | 'walk' | 'bike';

export const TRAVEL_MODES: { id: TravelMode; label: string; emoji: string }[] = [
  { id: 'car', label: 'רכב', emoji: '🚗' },
  { id: 'bus', label: 'אוטובוס', emoji: '🚌' },
  { id: 'walk', label: 'הליכה', emoji: '🚶' },
  { id: 'bike', label: 'אופניים', emoji: '🚲' },
];

/**
 * A stop, identified by its official GTFS stop code.
 *
 * The code is stored rather than the provider's internal row id, because that id
 * is scoped to one schedule date and changes daily; the code is stable.
 */
export type TransitStop = {
  code: number;
  name: string;
  city: string;
  lat: number;
  lon: number;
  /** Metres from the point that was searched, when the search was positional. */
  distanceMeters?: number;
};

/** What gets saved on a destination. Kept minimal and provider-agnostic. */
export type TransitStopRef = {
  code: number;
  name: string;
  city: string;
};

export type TransitPlan = {
  originStop?: TransitStopRef;
  destinationStop?: TransitStopRef;
  /** Desired arrival time, "HH:MM" 24-hour. */
  arriveBy?: string;
};

/** One concrete journey found in the official timetable. */
export type TransitOption = {
  id: string;
  /** Line number as published, e.g. "54". */
  lineNumber: string;
  agency: string;
  headsign: string;
  boardStopName: string;
  boardStopCode: number;
  /** ISO timestamps. */
  departure: string;
  alightStopName: string;
  alightStopCode: number;
  arrival: string;
  /** The schedule date the answer came from — may lag today by a day or two. */
  scheduleDate: string;
  /**
   * The line's internal reference in the national feed.
   *
   * Not for display — this is the id live vehicle reports are keyed by. The
   * published number ("54") is shared by many unrelated lines around the
   * country, so asking for live data by that number returns other people's
   * buses; this is what makes a live lookup point at *this* line.
   */
  lineRef?: number;
  /** Operator reference in the same feed, used to narrow a live lookup. */
  operatorRef?: number;
  /** Boarding stop position, when the feed reported it. */
  boardStopLat?: number;
  boardStopLon?: number;
};

export type TransitOptionsRequest = {
  originCode: number;
  destinationCode: number;
  /** Target arrival, as a Date. */
  arriveBy: Date;
  /** Maximum options to return. */
  limit?: number;
};

/**
 * Live data is a separate call on purpose: static timetables are always
 * available, real-time only sometimes.
 */
export type RealtimeResult =
  | { available: false; reason: string }
  | { available: true; vehicles: RealtimeVehicle[] };

export type RealtimeVehicle = {
  lineNumber: string;
  lat: number;
  lon: number;
  recordedAt: string;
};

export type RealtimeRequest = {
  lineNumber: string;
  originCode: number;
  /**
   * The line's feed reference, from the timetable option this request is about.
   *
   * Without it there is no way to ask the live feed about one specific line, so
   * the provider reports "no live data" instead of returning vehicles that
   * belong to some other line with the same published number.
   */
  lineRef?: number;
  operatorRef?: number;
};
