import { normalizeItemName, suggestItems } from './suggestions';
import { Destination, Trip } from './types';
import { describeWeatherCode, isWetCode } from './weather/codes';
import { WeatherReading } from './weather/types';

/**
 * Everything known about one departure, in one plain object.
 *
 * This is the shape a real assistant would be handed: the destination, the list
 * as it stands, what the history says, and the weather for the relevant hour.
 * The provider layer in src/ai is where such a model plugs in — `requestContext`
 * there reuses the history counts below rather than recomputing them. No model is
 * configured today, and nothing here calls out to one.
 *
 * `checkSuggestions` below is what the app does with the context today: a handful
 * of rules over real numbers, from the two sources it actually has — the saved
 * trips and the forecast. It is deliberately the only consumer, so when the
 * assistant arrives it replaces one function instead of being threaded through
 * screens.
 */

export type DepartureContext = {
  destination: {
    id: string;
    name: string;
    icon: string;
    address?: string;
    travelMode?: string;
    /** Desired arrival, "HH:MM", when the destination has one. */
    arriveBy?: string;
  };
  /** The list as it stands right now. */
  items: { name: string; checked: boolean }[];
  history: {
    /** Recorded exits to this destination that carried item detail. */
    tripsAnalysed: number;
    /**
     * Items usually taken here that are not on the list right now, with the
     * counts behind them — the numbers the suggestion shows the user.
     */
    usuallyTaken: { name: string; takenIn: number; outOf: number }[];
  };
  /** null when there is no real forecast — never a placeholder. */
  weather:
    | (WeatherReading & { description: string; emoji: string; locationLabel: string })
    | null;
};

export function buildDepartureContext(
  destination: Destination,
  trips: Trip[],
  weather: { reading: WeatherReading; locationLabel: string } | null,
): DepartureContext {
  const { suggestions, tripsAnalysed } = suggestItems(destination, trips);
  const condition = weather ? describeWeatherCode(weather.reading.code) : null;

  return {
    destination: {
      id: destination.id,
      name: destination.name,
      icon: destination.icon,
      address: destination.address,
      travelMode: destination.travelMode,
      arriveBy: destination.transit?.arriveBy,
    },
    items: destination.items
      .filter((item) => item.active)
      .map((item) => ({ name: item.name, checked: item.checked })),
    history: {
      tripsAnalysed,
      usuallyTaken: suggestions.map((suggestion) => ({
        name: suggestion.name,
        takenIn: suggestion.takenIn,
        outOf: suggestion.outOf,
      })),
    },
    weather:
      weather && condition
        ? {
            ...weather.reading,
            description: condition.label,
            emoji: condition.emoji,
            locationLabel: weather.locationLabel,
          }
        : null,
  };
}

/* ------------------------------------------------------ weather-driven tips --- */

export type DepartureTip = {
  id: 'umbrella' | 'water' | 'layer' | 'cold';
  emoji: string;
  /** The condition behind it, in real numbers: "🌧️ צפוי גשם — 70% סיכוי". */
  because: string;
  /** What to consider: "מטרייה יכולה להיות שימושית". */
  text: string;
  /** The item name "➕ הוסף לרשימה" would add. */
  item: string;
  /** Words that mean the list already covers this, so the tip is not repeated. */
  covered: string[];
};

/** Rain is worth a tip at this chance, in percent. */
const RAIN_CHANCE = 50;
/** …or at this much actual precipitation in the hour, in mm. */
const RAIN_MM = 0.2;
/** °C from which a water bottle is worth mentioning. */
const HOT_C = 28;
/** °C below which an extra layer is worth mentioning. */
const COLD_C = 12;
/** km/h from which wind is worth mentioning. */
const WINDY_KMH = 30;
/** km/h of gusts that count as windy on their own. */
const GUSTY_KMH = 45;

const TIPS: Omit<DepartureTip, 'because'>[] = [
  {
    id: 'umbrella',
    emoji: '☔',
    text: 'מטרייה יכולה להיות שימושית',
    item: 'מטרייה',
    covered: ['מטרייה', 'מטריה', 'פונצו', 'מעיל גשם'],
  },
  {
    id: 'water',
    emoji: '💧',
    text: 'כדאי לקחת מים',
    item: 'בקבוק מים',
    covered: ['מים', 'בקבוק'],
  },
  {
    id: 'layer',
    emoji: '🧥',
    text: 'מעיל יכול להיות שימושי ברוח כזאת',
    item: 'מעיל',
    covered: ['מעיל', "ז'קט", 'סווטשירט', 'קפוצון', 'שכבה', 'סוודר'],
  },
  {
    id: 'cold',
    emoji: '🧣',
    text: 'כדאי מעיל או שכבה נוספת',
    item: 'מעיל',
    covered: ['מעיל', 'צעיף', 'כפפות', 'סוודר', 'שכבה'],
  },
];

/** Which conditions the reading actually justifies. */
function triggeredTipIds(reading: WeatherReading): DepartureTip['id'][] {
  const ids: DepartureTip['id'][] = [];

  const chance = reading.precipitationProbability ?? 0;
  const millimetres = reading.precipitation ?? 0;
  if (chance >= RAIN_CHANCE || millimetres >= RAIN_MM || isWetCode(reading.code)) {
    ids.push('umbrella');
  }

  const feels = reading.apparentTemperature ?? reading.temperature;
  if (reading.temperature >= HOT_C || feels >= HOT_C) ids.push('water');

  const gusts = reading.windGusts ?? 0;
  if (reading.windSpeed >= WINDY_KMH || gusts >= GUSTY_KMH) ids.push('layer');

  // Cold speaks for itself; no need to also suggest a layer because of wind.
  if (feels <= COLD_C && !ids.includes('layer')) ids.push('cold');

  return ids;
}

/** The reason line for a tip, built from the numbers that triggered it. */
function reasonFor(id: DepartureTip['id'], reading: WeatherReading): string {
  const feels = Math.round(reading.apparentTemperature ?? reading.temperature);

  switch (id) {
    case 'umbrella': {
      const chance = reading.precipitationProbability;
      if (chance != null && chance >= RAIN_CHANCE) {
        return `🌧️ צפוי גשם — ${Math.round(chance)}% סיכוי`;
      }
      const millimetres = reading.precipitation ?? 0;
      if (millimetres >= RAIN_MM) return '🌧️ צפויים משקעים בשעה הזאת';
      return `🌧️ ${describeWeatherCode(reading.code).label}`;
    }
    case 'water':
      return `☀️ צפוי להיות חם — ${feels}°`;
    case 'layer': {
      const gusts = reading.windGusts;
      const speed = Math.round(reading.windSpeed);
      return gusts != null && gusts >= GUSTY_KMH
        ? `💨 משבי רוח עד ${Math.round(gusts)} קמ"ש`
        : `💨 רוח חזקה — ${speed} קמ"ש`;
    }
    case 'cold':
      return `❄️ צפוי קר — ${feels}°`;
  }
}

/**
 * Suggestions the weather genuinely justifies, and that the list does not already
 * cover. Nothing is ever added to a list here.
 */
export function departureTips(context: DepartureContext): DepartureTip[] {
  const reading = context.weather;
  if (!reading) return [];

  const onList = context.items.map((item) => normalizeItemName(item.name));
  const alreadyCovered = (tip: Omit<DepartureTip, 'because'>) =>
    tip.covered.some((word) => {
      const needle = normalizeItemName(word);
      return onList.some((name) => name.includes(needle));
    });

  const triggered = triggeredTipIds(reading);

  return TIPS.filter((tip) => triggered.includes(tip.id))
    .filter((tip) => !alreadyCovered(tip))
    .map((tip) => ({ ...tip, because: reasonFor(tip.id, reading) }));
}

/* ------------------------------------------------------- 🧠 כדאי לבדוק --- */

export type CheckSuggestion = {
  /** Stable key for lists. */
  id: string;
  emoji: string;
  /** The thing itself — this is what gets added if the user taps. */
  name: string;
  /** Why it is suggested, in real numbers. */
  reason: string;
  source: 'history' | 'weather' | 'text';
};

/** "לקחת אותו ב-4 מתוך 5 יציאות קודמות" */
function historyReason(takenIn: number, outOf: number): string {
  if (takenIn === 1) return `לקחת אותו ביציאה אחת מתוך ${outOf} קודמות`;
  return `לקחת אותו ב-${takenIn} מתוך ${outOf} יציאות קודמות`;
}

/**
 * Everything worth checking before leaving, from every source the app really
 * has: what the history says is usually taken here, what the forecast justifies,
 * and — when a screen has one — what the user's own sentence implied.
 *
 * Anything already on the list is left out, and so is a second suggestion for the
 * same thing. The result is display-only: adding happens when the user taps.
 */
export function checkSuggestions(
  context: DepartureContext,
  extra: { name: string; emoji?: string; reason: string }[] = [],
): CheckSuggestion[] {
  const onList = new Set(context.items.map((item) => normalizeItemName(item.name)));
  const seen = new Set<string>();
  const out: CheckSuggestion[] = [];

  const push = (suggestion: CheckSuggestion) => {
    const key = normalizeItemName(suggestion.name);
    if (!key || onList.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push(suggestion);
  };

  for (const item of context.history.usuallyTaken) {
    push({
      id: `history:${item.name}`,
      // No per-item emoji is stored anywhere, and guessing one from a name would
      // be invented data — so history rows share a neutral one.
      emoji: '🎒',
      name: item.name,
      reason: historyReason(item.takenIn, item.outOf),
      source: 'history',
    });
  }

  for (const tip of departureTips(context)) {
    push({
      id: `weather:${tip.id}`,
      emoji: tip.emoji,
      name: tip.item,
      reason: `${tip.because} · ${tip.text}`,
      source: 'weather',
    });
  }

  for (const item of extra) {
    push({
      id: `text:${item.name}`,
      emoji: item.emoji ?? '🧠',
      name: item.name,
      reason: item.reason,
      source: 'text',
    });
  }

  return out;
}
