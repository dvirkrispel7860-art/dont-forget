import { walkingMinutes } from './walking';
import { TransitOption, TransitStopRef } from './types';

/**
 * Choosing the best way to get there, rather than the nearest stop.
 *
 * The old rule was "the nearest stop that has a ride". It is a reasonable rule
 * and it is often right, but it loses in a case that happens constantly: a stop
 * fifty metres away whose bus is forty minutes off, against one three hundred
 * metres away whose bus is leaving now. Walking three minutes further to arrive
 * half an hour earlier is obviously the better journey, and distance alone cannot
 * see that.
 *
 * So this ranks whole journeys. Every candidate stop is turned into one or more
 * `RouteOption`s — walk, wait, ride, walk — and they compete on when the user
 * actually gets where they are going.
 *
 * Pure functions only: no network, no clock of its own, no provider. It is handed
 * timetable options that were already fetched and returns an ordering. That is
 * what makes it testable, and what will let a transfer-capable search feed the
 * same scoring later without any of this changing (see `transfers`, which is
 * scored today and always zero until the search can produce one).
 */

/** One boarding-to-alighting hop, plus the walking around it. */
export type RouteLeg = {
  kind: 'bus';
  lineNumber: string;
  agency: string;
  /** Where the line is headed, as the timetable names it. Empty when it does not. */
  direction: string;
  departureStop: TransitStopRef;
  arrivalStop: TransitStopRef;
  /** Epoch millis. */
  departureAt: number;
  arrivalAt: number;
  /** Walking to reach this leg's boarding stop. */
  walkBeforeMinutes: number;
  /** Walking after getting off — only non-zero on the last leg. */
  walkAfterMinutes: number;
  rideMinutes: number;
  /**
   * The timetable option this leg came from.
   *
   * Carried so live data can be asked about *this* leg and no other: a position
   * report belongs to one line's vehicle, and showing it against a different leg
   * of the journey would be inventing information.
   */
  option: TransitOption;
};

export type RouteOption = {
  /** Stable across a re-plan of the same journey, so React lists and reminders can key on it. */
  id: string;
  originStop: TransitStopRef;
  destinationStop: TransitStopRef;
  legs: RouteLeg[];
  totalWalkingMinutes: number;
  /**
   * Minutes between being able to leave now and the first bus going. Slack, not
   * standing time — the user leaves later — but it is what pushes the arrival
   * later, which is what the score is really about.
   */
  totalWaitingMinutes: number;
  totalRideMinutes: number;
  /** From now until standing at the destination. The number that matters. */
  totalMinutes: number;
  transfers: number;
  /** Epoch millis: the first bus leaves. */
  departureTime: number;
  /** Epoch millis: at the destination, after the final walk. */
  arrivalTime: number;
  /** Lower is better. See `scoreRoute`. */
  score: number;
  /** Straight-line metres to the boarding stop, when the search measured them. */
  metresToOrigin?: number;
};

/* ------------------------------------------------------------------ scoring --- */

/**
 * How much worse a minute of walking is than a minute of sitting on a bus.
 *
 * 1 means it counts double overall, since the walk is already inside
 * `totalMinutes`. Transit research puts the real figure higher; this stays
 * conservative so the planner does not start sending people on long rides to
 * avoid short walks.
 */
export const WALKING_PENALTY_PER_MINUTE = 1;

/**
 * What a change of bus is worth, in minutes.
 *
 * A penalty rather than a prohibition, deliberately: a journey with one change
 * that arrives twenty minutes earlier is the better journey, and a rule banning
 * changes could never say so. Five minutes is roughly what people are willing to
 * pay to stay in their seat.
 */
export const TRANSFER_PENALTY_MINUTES = 5;

/**
 * The cost of a journey, in minutes-equivalent. Lower wins.
 *
 * Arrival time does most of the work, because it is what the user actually cares
 * about; walking and changes are the corrections on top.
 */
export function scoreRoute(route: {
  totalMinutes: number;
  totalWalkingMinutes: number;
  transfers: number;
}): number {
  return (
    route.totalMinutes +
    route.totalWalkingMinutes * WALKING_PENALTY_PER_MINUTE +
    route.transfers * TRANSFER_PENALTY_MINUTES
  );
}

/* ------------------------------------------------------------------ building --- */

/** A stop the user could board at, as the search found it. */
export type OriginCandidate = {
  stop: TransitStopRef;
  /** Straight-line metres from the user. Absent for a hand-picked stop. */
  metresFromUser?: number;
  /** The rides this stop offers, as the timetable returned them. */
  options: TransitOption[];
};

/** Where the journey ends, and how far that leaves the user from the destination. */
export type DestinationTarget = {
  stop: TransitStopRef;
  /** Straight-line metres from the stop to the destination, when measured. */
  metresToDestination?: number;
};

function minutesBetween(from: number, to: number): number {
  return Math.max(0, Math.round((to - from) / 60_000));
}

/**
 * One journey, from a candidate stop and one of its rides.
 *
 * Returns null when the ride has already gone — a journey the user cannot take is
 * not an alternative, and offering it would be worse than offering nothing.
 */
export function buildRouteOption(params: {
  candidate: OriginCandidate;
  option: TransitOption;
  target: DestinationTarget;
  now: number;
}): RouteOption | null {
  const { candidate, option, target, now } = params;

  const departureTime = new Date(option.departure).getTime();
  const arriveAtStop = new Date(option.arrival).getTime();
  if (!Number.isFinite(departureTime) || !Number.isFinite(arriveAtStop)) return null;
  // Already left: not an option.
  if (departureTime < now) return null;

  const walkBeforeMinutes =
    candidate.metresFromUser != null ? walkingMinutes(candidate.metresFromUser) : 0;
  const walkAfterMinutes =
    target.metresToDestination != null ? walkingMinutes(target.metresToDestination) : 0;

  const rideMinutes = minutesBetween(departureTime, arriveAtStop);
  const totalWalkingMinutes = walkBeforeMinutes + walkAfterMinutes;
  /*
   * Slack between "could set off now" and the bus going. Not time spent standing
   * — the leave-time calculation has the user setting off later — but it is what
   * makes an earlier bus from a further stop the better journey.
   */
  const totalWaitingMinutes = Math.max(
    0,
    minutesBetween(now, departureTime) - walkBeforeMinutes,
  );
  const arrivalTime = arriveAtStop + walkAfterMinutes * 60_000;

  const legs: RouteLeg[] = [
    {
      kind: 'bus',
      lineNumber: option.lineNumber,
      agency: option.agency,
      direction: option.headsign,
      departureStop: candidate.stop,
      arrivalStop: target.stop,
      departureAt: departureTime,
      arrivalAt: arriveAtStop,
      walkBeforeMinutes,
      walkAfterMinutes,
      rideMinutes,
      option,
    },
  ];

  const transfers = legs.length - 1;
  const totalMinutes = minutesBetween(now, arrivalTime);

  return {
    id: `${candidate.stop.code}:${option.id}`,
    originStop: candidate.stop,
    destinationStop: target.stop,
    legs,
    totalWalkingMinutes,
    totalWaitingMinutes,
    totalRideMinutes: rideMinutes,
    totalMinutes,
    transfers,
    departureTime,
    arrivalTime,
    score: scoreRoute({ totalMinutes, totalWalkingMinutes, transfers }),
    ...(candidate.metresFromUser != null ? { metresToOrigin: candidate.metresFromUser } : {}),
  };
}

/**
 * A journey of one or more legs, as a search handed it over.
 *
 * This is the shape the route proxy returns (see routeProxy.ts). Scoring stays
 * here rather than in the search, so a one-leg journey found on the device and a
 * two-leg journey found by the proxy are ranked by the same function and can be
 * compared against each other honestly.
 */
export type PlannedJourney = {
  legs: {
    option: TransitOption;
    departureStop: TransitStopRef;
    arrivalStop: TransitStopRef;
    /** Walking to reach this leg's stop: from the user, or from the previous leg. */
    walkBeforeMinutes: number;
  }[];
  /** Walking from the final stop to the destination itself. */
  walkAfterMinutes: number;
  /** Straight-line metres from the user to the first stop, when measured. */
  metresToOrigin?: number;
};

/**
 * A multi-leg journey, scored like any other.
 *
 * Returns null when the first leg has already gone, or when a change does not
 * actually work — arriving after the next bus has left is not a journey, and
 * offering it would be worse than offering nothing.
 */
export function buildJourney(params: {
  journey: PlannedJourney;
  now: number;
}): RouteOption | null {
  const { journey, now } = params;
  if (journey.legs.length === 0) return null;

  const legs: RouteLeg[] = [];
  let totalWalkingMinutes = journey.walkAfterMinutes;
  let totalRideMinutes = 0;

  for (let i = 0; i < journey.legs.length; i += 1) {
    const source = journey.legs[i];
    const departureAt = new Date(source.option.departure).getTime();
    const arrivalAt = new Date(source.option.arrival).getTime();
    if (!Number.isFinite(departureAt) || !Number.isFinite(arrivalAt)) return null;

    // The first leg must still be catchable; a departed journey is not an option.
    if (i === 0 && departureAt < now) return null;

    /*
     * A change only counts if it can be made: off the previous bus, walk to this
     * stop, and still be there before it leaves. Without this check the planner
     * would happily propose a connection nobody can catch.
     */
    if (i > 0) {
      const previous = legs[i - 1];
      const readyAt = previous.arrivalAt + source.walkBeforeMinutes * 60_000;
      if (departureAt < readyAt) return null;
    }

    const rideMinutes = minutesBetween(departureAt, arrivalAt);
    totalRideMinutes += rideMinutes;
    totalWalkingMinutes += source.walkBeforeMinutes;

    legs.push({
      kind: 'bus',
      lineNumber: source.option.lineNumber,
      agency: source.option.agency,
      direction: source.option.headsign,
      departureStop: source.departureStop,
      arrivalStop: source.arrivalStop,
      departureAt,
      arrivalAt,
      walkBeforeMinutes: source.walkBeforeMinutes,
      // Only the last leg ends with a walk to the destination.
      walkAfterMinutes: i === journey.legs.length - 1 ? journey.walkAfterMinutes : 0,
      rideMinutes,
      option: source.option,
    });
  }

  const first = legs[0];
  const last = legs[legs.length - 1];
  const arrivalTime = last.arrivalAt + journey.walkAfterMinutes * 60_000;
  const transfers = legs.length - 1;
  const totalMinutes = minutesBetween(now, arrivalTime);
  /*
   * Everything that is neither walking nor riding: the wait for the first bus
   * and any wait at a change. Derived rather than summed so the three parts
   * always add up to the total the user is shown.
   */
  const totalWaitingMinutes = Math.max(
    0,
    totalMinutes - totalWalkingMinutes - totalRideMinutes,
  );

  return {
    id: `${first.departureStop.code}:${legs.map((leg) => leg.option.id).join('+')}`,
    originStop: first.departureStop,
    destinationStop: last.arrivalStop,
    legs,
    totalWalkingMinutes,
    totalWaitingMinutes,
    totalRideMinutes,
    totalMinutes,
    transfers,
    departureTime: first.departureAt,
    arrivalTime,
    score: scoreRoute({ totalMinutes, totalWalkingMinutes, transfers }),
    ...(journey.metresToOrigin != null ? { metresToOrigin: journey.metresToOrigin } : {}),
  };
}

/** How many journeys to offer. One recommendation and two alternatives. */
export const MAX_ROUTE_OPTIONS = 3;

/**
 * Ranks journeys from any source — the device's direct-only search, the proxy's
 * search with changes, or both together — and keeps the best few.
 *
 * Deduplicated by shape so the list is genuinely different choices.
 */
export function rankJourneys(params: {
  journeys: PlannedJourney[];
  now: number;
  limit?: number;
}): RouteOption[] {
  const built = params.journeys
    .map((journey) => buildJourney({ journey, now: params.now }))
    .filter((route): route is RouteOption => route !== null);

  built.sort((a, b) => a.score - b.score || a.arrivalTime - b.arrivalTime);

  const seen = new Set<string>();
  const chosen: RouteOption[] = [];
  for (const route of built) {
    const shape = `${route.originStop.code}|${route.legs.map((l) => l.lineNumber).join('>')}`;
    if (seen.has(shape)) continue;
    seen.add(shape);
    chosen.push(route);
    if (chosen.length >= (params.limit ?? MAX_ROUTE_OPTIONS)) break;
  }
  return chosen;
}

/**
 * Every journey worth offering, best first.
 *
 * Deduplicated so the list is three genuinely different choices rather than the
 * same bus three times: one entry per line per boarding stop, keeping whichever
 * departure scores best. Without that, a frequent line fills all three slots and
 * the user never sees the alternative that might suit them better.
 */
export function planRoutes(params: {
  candidates: OriginCandidate[];
  targets: DestinationTarget[];
  now: number;
  limit?: number;
}): RouteOption[] {
  const all: RouteOption[] = [];

  for (const candidate of params.candidates) {
    for (const option of candidate.options) {
      const target =
        params.targets.find((t) => t.stop.code === option.alightStopCode) ??
        params.targets[0];
      if (!target) continue;
      const route = buildRouteOption({ candidate, option, target, now: params.now });
      if (route) all.push(route);
    }
  }

  all.sort((a, b) => a.score - b.score || a.arrivalTime - b.arrivalTime);

  const seen = new Set<string>();
  const chosen: RouteOption[] = [];
  for (const route of all) {
    const shape = `${route.originStop.code}|${route.legs.map((l) => l.lineNumber).join('>')}`;
    if (seen.has(shape)) continue;
    seen.add(shape);
    chosen.push(route);
    if (chosen.length >= (params.limit ?? MAX_ROUTE_OPTIONS)) break;
  }

  return chosen;
}

/* ------------------------------------------------------------------ wording --- */

/** "🥇" / "🥈" / "🥉" — the rank, for a list of at most three. */
export function rankMedal(index: number): string {
  return ['🥇', '🥈', '🥉'][index] ?? '•';
}

export function rankLabel(index: number): string {
  return ['הכי מומלץ', 'חלופה', 'חלופה'][index] ?? 'חלופה';
}

/** "כ־52 דק׳ בסך הכול" — the headline number for a journey. */
export function totalTimePhrase(route: RouteOption): string {
  if (route.totalMinutes < 1) return 'פחות מדקה';
  if (route.totalMinutes === 1) return 'כדקה';
  return `כ־${route.totalMinutes} דק׳`;
}

/** "🔁 החלפה אחת" / "ללא החלפות" — said plainly, since it drives the choice. */
export function transfersPhrase(transfers: number): string {
  if (transfers === 0) return 'ללא החלפות';
  if (transfers === 1) return 'החלפה אחת';
  return `${transfers} החלפות`;
}
