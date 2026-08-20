import { walkingMinutes } from './walking';
import { TransitOption } from './types';

/**
 * "מתי צריך לצאת?" for a bus departure.
 *
 * One subtraction, and nothing else:
 *
 *     leave at = the bus's departure − walking time to the stop − a safety margin
 *
 * Every term comes from data the app already has. The departure is the official
 * timetable's, straight off the `TransitOption` the stop search returned. The
 * walking time is the transit layer's own estimate for the distance it already
 * measured (`walkingMinutes`, 80 m/min) — this file computes no distances and
 * knows nothing about geography. The margin is a fixed few minutes, disclosed to
 * the user rather than hidden inside the number.
 *
 * What it refuses to do matters as much: with no measured distance to the stop
 * there is no walking time, so there is no answer — `planLeaveTime` returns null
 * instead of guessing one. And a leave time that has already passed is reported
 * as exactly that, never as a negative countdown or a time in the past.
 *
 * On live data: the national feed publishes vehicle *positions*, not predicted
 * departures (see realtime.ts), so there is no live departure time to substitute
 * here. `timing` therefore says whether the line is confirmed to be running right
 * now or whether the time is only the plan — the number itself stays the
 * timetable's, and the card says so.
 */

/** Minutes of slack between arriving at the stop and the bus leaving. */
export const SAFETY_MARGIN_MINUTES = 5;

/** Where this ride stands relative to now. */
export type LeaveStatus =
  /** There is still time: leave at `leaveAt`. */
  | 'ahead'
  /** The moment to leave has passed, but the bus has not left yet. */
  | 'too-late'
  /** The bus's departure time itself has passed. */
  | 'departed';

/** Whether the departure time is backed by a live sighting of the line. */
export type LeaveTiming = 'scheduled' | 'live';

export type LeavePlan = {
  option: TransitOption;
  /** Epoch millis of the departure, as the timetable gives it. */
  departureAt: number;
  /** Walking minutes to the stop, from the distance the transit layer measured. */
  walkMinutes: number;
  /** The margin included in `leaveAt`, in minutes. */
  marginMinutes: number;
  /** Epoch millis to leave by. Only meaningful while `status` is 'ahead'. */
  leaveAt: number;
  /** Whole minutes from now until `leaveAt`. Never negative. */
  minutesUntilLeave: number;
  /** Whole minutes from now until the bus leaves. Never negative. */
  minutesUntilDeparture: number;
  status: LeaveStatus;
  timing: LeaveTiming;
};

/**
 * The leave time for one ride, or null when the data does not support one.
 *
 * `metresFromUser` is the distance the stop search already measured. It is absent
 * for a stop the user picked by hand and for one saved on the destination —
 * nothing measured the way there, so nothing here estimates it.
 */
export function planLeaveTime(params: {
  option: TransitOption;
  /** Straight-line metres to the boarding stop, when the search measured them. */
  metresFromUser: number | undefined;
  /** Overrides the default margin. */
  marginMinutes?: number;
  /** True when the live feed is reporting this line right now. */
  live?: boolean;
  now?: number;
}): LeavePlan | null {
  const { option, metresFromUser } = params;
  if (metresFromUser == null || !Number.isFinite(metresFromUser)) return null;

  const departureAt = new Date(option.departure).getTime();
  if (!Number.isFinite(departureAt)) return null;

  const now = params.now ?? Date.now();
  const marginMinutes = params.marginMinutes ?? SAFETY_MARGIN_MINUTES;
  const walkMinutes = walkingMinutes(metresFromUser);
  const leaveAt = departureAt - (walkMinutes + marginMinutes) * 60_000;

  const status: LeaveStatus =
    departureAt <= now ? 'departed' : leaveAt <= now ? 'too-late' : 'ahead';

  return {
    option,
    departureAt,
    walkMinutes,
    marginMinutes,
    leaveAt,
    // Floored, not rounded: "about 9 minutes" must never be nine and a half.
    minutesUntilLeave: Math.max(0, Math.floor((leaveAt - now) / 60_000)),
    minutesUntilDeparture: Math.max(0, Math.floor((departureAt - now) / 60_000)),
    status,
    timing: params.live ? 'live' : 'scheduled',
  };
}

/**
 * The first ride in the list that can still be caught — the one to offer when the
 * nearest one is already too close.
 *
 * The list is the timetable's own, in the order the stop search returned it, so
 * this only picks; it never reorders and never invents a ride.
 */
export function nextCatchableRide(params: {
  options: TransitOption[];
  metresFromUser: number | undefined;
  marginMinutes?: number;
  now?: number;
}): LeavePlan | null {
  for (const option of params.options) {
    const plan = planLeaveTime({
      option,
      metresFromUser: params.metresFromUser,
      marginMinutes: params.marginMinutes,
      now: params.now,
    });
    if (plan && plan.status === 'ahead') return plan;
  }
  return null;
}

/* ---------------------------------------------------------------- wording --- */

/** "22:09" in the user's locale. */
export function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

/** "יש לך כ־9 דקות" — the countdown, in words that fit the number. */
export function timeLeftPhrase(minutes: number): string {
  if (minutes <= 0) return 'צריך לצאת עכשיו';
  if (minutes === 1) return 'יש לך כדקה';
  if (minutes === 2) return 'יש לך כ־2 דקות';
  return `יש לך כ־${minutes} דקות`;
}

/** "כ־4 דקות הליכה" — the walk, phrased for one minute too. */
export function walkPhrase(minutes: number): string {
  return minutes === 1 ? 'כדקה הליכה' : `כ־${minutes} דקות הליכה`;
}
