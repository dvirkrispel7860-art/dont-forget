/**
 * WMO weather codes → Hebrew.
 *
 * The user never sees a numeric code. Every code the source can return has a
 * Hebrew label and an emoji here; an unrecognised code says so in words rather
 * than leaking the number or guessing a condition.
 */

export type WeatherCondition = {
  emoji: string;
  label: string;
};

const CONDITIONS: Record<number, WeatherCondition> = {
  0: { emoji: '☀️', label: 'בהיר' },
  1: { emoji: '🌤️', label: 'בהיר בעיקר' },
  2: { emoji: '⛅', label: 'מעונן חלקית' },
  3: { emoji: '☁️', label: 'מעונן' },

  45: { emoji: '🌫️', label: 'ערפל' },
  48: { emoji: '🌫️', label: 'ערפל מקפיא' },

  51: { emoji: '🌦️', label: 'טפטוף קל' },
  53: { emoji: '🌦️', label: 'טפטוף' },
  55: { emoji: '🌦️', label: 'טפטוף חזק' },
  56: { emoji: '🌧️', label: 'טפטוף מקפיא' },
  57: { emoji: '🌧️', label: 'טפטוף מקפיא חזק' },

  61: { emoji: '🌦️', label: 'גשם קל' },
  63: { emoji: '🌧️', label: 'גשם' },
  65: { emoji: '🌧️', label: 'גשם חזק' },
  66: { emoji: '🌧️', label: 'גשם מקפיא' },
  67: { emoji: '🌧️', label: 'גשם מקפיא חזק' },

  71: { emoji: '🌨️', label: 'שלג קל' },
  73: { emoji: '❄️', label: 'שלג' },
  75: { emoji: '❄️', label: 'שלג כבד' },
  77: { emoji: '🌨️', label: 'גרגרי שלג' },

  80: { emoji: '🌦️', label: 'ממטרים קלים' },
  81: { emoji: '🌧️', label: 'ממטרים' },
  82: { emoji: '🌧️', label: 'ממטרים עזים' },
  85: { emoji: '🌨️', label: 'ממטרי שלג' },
  86: { emoji: '❄️', label: 'ממטרי שלג כבדים' },

  95: { emoji: '⛈️', label: 'סופת רעמים' },
  96: { emoji: '⛈️', label: 'סופת רעמים עם ברד' },
  99: { emoji: '⛈️', label: 'סופת רעמים עם ברד כבד' },
};

/** Codes that mean water is falling out of the sky right now. */
const WET_CODES = new Set([
  51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99,
]);

export function describeWeatherCode(code: number): WeatherCondition {
  return (
    CONDITIONS[code] ?? {
      emoji: '🌡️',
      // Honest fallback: we have a temperature but no name for the condition.
      label: 'מזג אוויר לא מזוהה',
    }
  );
}

/** True when the code itself describes precipitation. */
export function isWetCode(code: number): boolean {
  return WET_CODES.has(code);
}
