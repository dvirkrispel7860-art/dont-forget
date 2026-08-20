import { suggestItems } from '../suggestions';
import { TravelMode } from '../transit/types';
import { Destination, Trip } from '../types';
import { describeWeatherCode } from '../weather/codes';
import { WeatherReading } from '../weather/types';
import { AIRequest, AIRequestHistory, AIRequestWeather } from './types';

/**
 * Assembling the request — and, just as importantly, deciding what to leave out.
 *
 * The app knows a lot: addresses, coordinates, the full trip log, settings, the
 * user's name. Almost none of that helps understand a sentence, so almost none of
 * it is included. What goes in:
 *
 *  - the sentence
 *  - destination **names and icons** (needed to match "אני הולך לים" to a
 *    destination) — never their addresses or coordinates
 *  - the items of the one destination in question, when there is one
 *  - history as counts the app already computed, not the trips themselves
 *  - the forecast the weather layer already fetched, when it exists
 *  - now, so "מחר" resolves against the right day
 *
 * This is the same discipline as `buildDepartureContext`, which it deliberately
 * reuses for the history counts rather than recomputing them.
 */

export type AIContextSources = {
  destinations: Destination[];
  /** Recorded departures. Used only to derive the counts, never sent as trips. */
  trips?: Trip[];
  /** The destination the screen is about, when the screen knows. */
  focusedDestinationId?: string;
  /** The forecast the weather layer already has for the relevant hour. */
  weather?: { reading: WeatherReading; locationLabel: string } | null;
  /** A mode chosen for this departure, when one was. */
  travelMode?: TravelMode;
  now?: number;
};

/** The counts behind "usually taken here" — from the app's own suggestion layer. */
function historyFor(
  destination: Destination | undefined,
  trips: Trip[] | undefined,
): AIRequestHistory | undefined {
  if (!destination || !trips || trips.length === 0) return undefined;

  const { suggestions, tripsAnalysed } = suggestItems(destination, trips);
  if (tripsAnalysed === 0) return undefined;

  return {
    tripsAnalysed,
    usuallyTaken: suggestions.map((suggestion) => ({
      name: suggestion.name,
      takenIn: suggestion.takenIn,
      outOf: suggestion.outOf,
    })),
  };
}

/** The forecast, described in the app's own words. Absent when there is none. */
function weatherFor(
  weather: { reading: WeatherReading; locationLabel: string } | null | undefined,
): AIRequestWeather | undefined {
  if (!weather) return undefined;
  const condition = describeWeatherCode(weather.reading.code);
  return {
    temperature: weather.reading.temperature,
    apparentTemperature: weather.reading.apparentTemperature,
    precipitationProbability: weather.reading.precipitationProbability,
    windSpeed: weather.reading.windSpeed,
    description: condition.label,
    emoji: condition.emoji,
    locationLabel: weather.locationLabel,
  };
}

export function buildAIRequest(text: string, sources: AIContextSources): AIRequest {
  const now = sources.now ?? Date.now();
  const focused = sources.focusedDestinationId
    ? sources.destinations.find((d) => d.id === sources.focusedDestinationId)
    : undefined;

  return {
    text,
    destinations: sources.destinations.map((destination) => ({
      id: destination.id,
      name: destination.name,
      icon: destination.icon,
      travelMode: destination.travelMode,
    })),
    ...(focused ? { focusedDestinationId: focused.id } : {}),
    ...(focused
      ? {
          items: focused.items
            .filter((item) => item.active)
            .map((item) => ({ name: item.name, checked: item.checked })),
        }
      : {}),
    ...(() => {
      const history = historyFor(focused, sources.trips);
      return history ? { history } : {};
    })(),
    ...(() => {
      const weather = weatherFor(sources.weather);
      return weather ? { weather } : {};
    })(),
    ...(sources.travelMode ? { travelMode: sources.travelMode } : {}),
    now,
    // Only so a provider can phrase a time in the user's own day, never as an
    // identifier — the offset is shared by whole countries.
    timeZoneOffsetMinutes: -new Date(now).getTimezoneOffset(),
  };
}
