import {
  WeatherLocation,
  WeatherProvider,
  WeatherReading,
  WeatherRequestOptions,
} from './types';

/**
 * Open-Meteo — the weather source.
 *
 * Why this source: the free non-commercial tier needs **no API key and no
 * signup**, and it answers with `Access-Control-Allow-Origin: *`, so the app
 * reads it directly with no backend and no secret to leak — the same reasoning
 * as the transit source. Data is licensed CC-BY 4.0, so the app credits it
 * wherever a forecast is shown (see WeatherCard and the settings screen).
 *
 * Nothing here invents a value. Missing numbers stay missing.
 */

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';

/** A forecast is not worth waiting for longer than this. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Enough to cover "now" and any arrival time later today or tomorrow. */
const FORECAST_DAYS = 2;

const HOURLY_FIELDS = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation_probability',
  'precipitation',
  'weather_code',
  'wind_speed_10m',
  'wind_gusts_10m',
].join(',');

type HourlyResponse = {
  hourly?: {
    time?: unknown;
    temperature_2m?: unknown;
    apparent_temperature?: unknown;
    precipitation_probability?: unknown;
    precipitation?: unknown;
    weather_code?: unknown;
    wind_speed_10m?: unknown;
    wind_gusts_10m?: unknown;
  };
  error?: boolean;
  reason?: string;
};

type GeocodingResponse = {
  results?: {
    name?: unknown;
    latitude?: unknown;
    longitude?: unknown;
    country?: unknown;
  }[];
};

async function getJson<T>(
  base: string,
  params: Record<string, string | number>,
  options?: WeatherRequestOptions,
): Promise<T> {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  // Own controller so a hanging request cannot keep a card spinning forever,
  // while still honouring the caller's signal (unmount, screen change).
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  options?.signal?.addEventListener('abort', onAbort);

  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`weather source responded ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
    options?.signal?.removeEventListener('abort', onAbort);
  }
}

/* -------------------------------------------------------------- geocoding --- */

/**
 * The geocoding API matches place names, not house numbers: asking it for
 * "שדרות הרצל 12, תל אביב" returns nothing at all, and its fuzzy matching turns
 * the street part of that address into "הרצליה" — a different town.
 *
 * So the address is read the way it is written: the last comma-separated part is
 * the town, and that is tried first. Earlier parts, and finally the address as a
 * whole, are only fallbacks for addresses written without a town. Digits are
 * dropped everywhere, since a house number never helps.
 *
 * Whatever matches is shown to the user by name, so a town-level answer is never
 * presented as a street-level one.
 */
export function geocodeCandidates(address: string): string[] {
  const clean = (value: string) => value.replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim();

  const segments = address
    .split(',')
    .map(clean)
    .filter((segment) => segment.length >= 2);

  const candidates: string[] = [];
  const push = (value: string) => {
    if (value.length >= 2 && !candidates.includes(value)) candidates.push(value);
  };

  // Town first — the most specific thing this source can actually resolve.
  for (let i = segments.length - 1; i >= 0; i -= 1) push(segments[i]);
  push(clean(address));

  return candidates;
}

function parseLocation(raw: GeocodingResponse): WeatherLocation | null {
  const first = raw.results?.[0];
  if (!first) return null;
  if (typeof first.latitude !== 'number' || typeof first.longitude !== 'number') {
    return null;
  }

  const name = typeof first.name === 'string' && first.name.length > 0 ? first.name : '';
  const country = typeof first.country === 'string' ? first.country : '';
  const label = [name, country].filter((part) => part.length > 0).join(', ');

  return {
    latitude: first.latitude,
    longitude: first.longitude,
    label: label.length > 0 ? label : name,
  };
}

/* ---------------------------------------------------------------- forecast --- */

/** Reads one column of the hourly block, tolerating nulls and missing fields. */
function column(raw: unknown): (number | null)[] {
  return Array.isArray(raw)
    ? raw.map((value) => (typeof value === 'number' ? value : null))
    : [];
}

function optional(value: number | null | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function parseReadings(raw: HourlyResponse): WeatherReading[] {
  const hourly = raw.hourly;
  if (!hourly) return [];

  // timeformat=unixtime, so these are epoch seconds — no timezone guessing.
  const time = column(hourly.time);
  const temperature = column(hourly.temperature_2m);
  const apparent = column(hourly.apparent_temperature);
  const probability = column(hourly.precipitation_probability);
  const precipitation = column(hourly.precipitation);
  const code = column(hourly.weather_code);
  const wind = column(hourly.wind_speed_10m);
  const gusts = column(hourly.wind_gusts_10m);

  const readings: WeatherReading[] = [];

  for (let i = 0; i < time.length; i += 1) {
    const at = time[i];
    const temp = temperature[i];
    const weatherCode = code[i];
    const windSpeed = wind[i];

    // An hour without these is not a reading we can honestly show.
    if (at === null || temp === null || weatherCode === null || windSpeed === null) {
      continue;
    }

    readings.push({
      at: at * 1000,
      temperature: temp,
      apparentTemperature: optional(apparent[i]),
      code: weatherCode,
      precipitationProbability: optional(probability[i]),
      precipitation: optional(precipitation[i]),
      windSpeed,
      windGusts: optional(gusts[i]),
    });
  }

  return readings;
}

export const openMeteoProvider: WeatherProvider = {
  id: 'open-meteo',
  sourceLabel: 'Open-Meteo',
  sourceUrl: 'https://open-meteo.com',

  async geocode(query, options) {
    for (const candidate of geocodeCandidates(query)) {
      const raw = await getJson<GeocodingResponse>(
        GEOCODING_URL,
        { name: candidate, count: 1, language: 'he', format: 'json' },
        options,
      );

      const location = parseLocation(raw);
      if (location) return location;
    }
    return null;
  },

  async getWeatherForecast(latitude, longitude, at, options) {
    const raw = await getJson<HourlyResponse>(
      FORECAST_URL,
      {
        latitude,
        longitude,
        hourly: HOURLY_FIELDS,
        timezone: 'auto',
        timeformat: 'unixtime',
        forecast_days: FORECAST_DAYS,
        // Keeps a departure that started earlier today inside the series.
        past_hours: 6,
      },
      options,
    );

    if (raw.error) {
      throw new Error(raw.reason ?? 'weather source returned an error');
    }

    const readings = parseReadings(raw);
    if (readings.length === 0) {
      throw new Error('weather source returned no usable hours');
    }

    // `at` is what the caller cares about; the series is returned whole so the
    // cache can answer other times without another request.
    void at;
    return readings;
  },
};
