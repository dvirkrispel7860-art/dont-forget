/**
 * Turning a distance into minutes on foot.
 *
 * A leaf module on purpose: it imports nothing. Half the transit layer needs this
 * one function — the stop search, the planner, the proxy, the leave-time
 * calculation and the card — and having it live in any of them made those files
 * import each other in a circle. Circular imports do not fail at compile time;
 * they fail at runtime, once, in whichever module happened to load first, and the
 * symptom is an undefined function rather than an error. Not worth the risk for
 * two lines of arithmetic.
 */

/** Walking pace used everywhere. Deliberately modest. */
export const WALK_METRES_PER_MINUTE = 80;

/**
 * Minutes of walking for a straight-line distance. An estimate, and labelled as
 * one wherever it is shown.
 *
 * Never returns zero: a stop you are standing at is still a minute away by the
 * time you have crossed the road and found the right side of it.
 */
export function walkingMinutes(metres: number): number {
  return Math.max(1, Math.round(metres / WALK_METRES_PER_MINUTE));
}
