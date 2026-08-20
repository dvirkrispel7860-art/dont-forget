import { Destination, Trip } from './types';

/**
 * Smart suggestions, computed locally from the trip history this app already
 * stores. No AI, no server, no invented data — every number below comes from a
 * real exit the user completed with "מוכן לצאת".
 */

/** Below this many recorded trips there is not enough signal to suggest anything. */
export const MIN_TRIPS_FOR_SUGGESTIONS = 3;

export type Suggestion = {
  name: string;
  /** Trips this item was taken in. */
  takenIn: number;
  /** Trips that were analysed. */
  outOf: number;
};

/**
 * Items are matched by name rather than by id: a row the user deleted and one
 * they later retype are the same thing to them, and ids do not survive that.
 */
export function normalizeItemName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export type SuggestionResult = {
  suggestions: Suggestion[];
  /** How many trips carried item detail and were actually used. */
  tripsAnalysed: number;
};

export function suggestItems(
  destination: Destination | undefined,
  trips: Trip[],
): SuggestionResult {
  if (!destination) return { suggestions: [], tripsAnalysed: 0 };

  // Only this destination's trips, and only ones that recorded their items.
  // Older count-only records carry no item detail, so they cannot contribute
  // evidence and are not counted towards the threshold either.
  const relevant = trips.filter(
    (trip) =>
      trip.destinationId === destination.id && trip.items && trip.items.length > 0,
  );

  if (relevant.length < MIN_TRIPS_FOR_SUGGESTIONS) {
    return { suggestions: [], tripsAnalysed: relevant.length };
  }

  // Anything currently on the list is not a suggestion. Items the user removed
  // are fair game — that is exactly the case worth surfacing.
  const onList = new Set(
    destination.items.filter((i) => i.active).map((i) => normalizeItemName(i.name)),
  );

  // trips are newest first, so the first spelling seen is the most recent one.
  const counts = new Map<string, { name: string; takenIn: number }>();

  for (const trip of relevant) {
    const countedInThisTrip = new Set<string>();

    for (const item of trip.items ?? []) {
      if (!item.taken) continue;

      const key = normalizeItemName(item.name);
      if (!key || countedInThisTrip.has(key)) continue;
      countedInThisTrip.add(key);

      const entry = counts.get(key);
      if (entry) entry.takenIn += 1;
      else counts.set(key, { name: item.name.trim(), takenIn: 1 });
    }
  }

  const suggestions = [...counts.entries()]
    .filter(
      ([key, entry]) =>
        !onList.has(key) &&
        // "Usually takes it" = taken in the majority of the analysed trips.
        entry.takenIn * 2 > relevant.length,
    )
    .map(([, entry]) => ({
      name: entry.name,
      takenIn: entry.takenIn,
      outOf: relevant.length,
    }))
    .sort((a, b) => b.takenIn - a.takenIn || a.name.localeCompare(b.name, 'he'));

  return { suggestions, tripsAnalysed: relevant.length };
}
