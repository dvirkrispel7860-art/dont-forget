/**
 * Weather for the moment the user is about to leave.
 *
 * The shapes here are provider-agnostic on purpose: screens and components
 * never import a concrete source, exactly like the transit layer. Swapping
 * Open-Meteo for something else means writing one object that satisfies
 * `WeatherProvider`.
 *
 * Nothing in this layer ever produces a value the source did not return. Every
 * optional field below is optional because the source may omit it — and when it
 * does, the UI leaves that line out instead of filling it in.
 */

export type Coords = {
  latitude: number;
  longitude: number;
};

/** A place we can honestly ask for a forecast, plus what it is actually called. */
export type WeatherLocation = Coords & {
  /**
   * What the geocoder matched, e.g. "תל אביב-יפו, ישראל". Shown to the user so
   * the forecast never looks more precise than the location behind it — street
   * addresses resolve to their town, and the user gets to see that.
   */
  label: string;
};

/** One hour of forecast, as the source reported it. */
export type WeatherReading = {
  /** Epoch millis of the hour this reading describes. */
  at: number;
  /** °C */
  temperature: number;
  /** °C, "feels like". Absent when the source did not return it. */
  apparentTemperature?: number;
  /** WMO weather code. Never shown as a number — see codes.ts. */
  code: number;
  /** Chance of precipitation, %. */
  precipitationProbability?: number;
  /** Precipitation in that hour, mm. */
  precipitation?: number;
  /** km/h */
  windSpeed: number;
  /** km/h */
  windGusts?: number;
};

export type WeatherForecast = {
  location: WeatherLocation;
  /** The hour closest to the time that was asked for. */
  reading: WeatherReading;
  /** The time that was asked for, epoch millis. */
  requestedAt: number;
  /** When this came off the network, epoch millis — so cache age stays honest. */
  fetchedAt: number;
};

/**
 * Every outcome the UI has to be able to draw, failures included. There is no
 * "unknown" fallback that renders numbers: if we do not have real data, we say
 * so in words.
 */
export type WeatherResult =
  | { status: 'ok'; forecast: WeatherForecast }
  /**
   * No usable location. `code` tells the two cases apart so the UI can offer the
   * right way out: an address to add, or a location to set by hand.
   */
  | { status: 'no-location'; reason: string; code: 'no-address' | 'geocode-failed' }
  /** The device is offline. */
  | { status: 'offline' }
  /** The source answered with an error, or something unexpected came back. */
  | { status: 'error'; reason: string };

export type WeatherRequestOptions = {
  signal?: AbortSignal;
};

/** The only surface the app is allowed to use for weather data. */
export type WeatherProvider = {
  /** Short id for logging/diagnostics. */
  id: string;
  /** Human name of the source, shown to the user as the licence requires. */
  sourceLabel: string;
  sourceUrl: string;

  /** Address or place name → coordinates. null when nothing matched. */
  geocode: (
    query: string,
    options?: WeatherRequestOptions,
  ) => Promise<WeatherLocation | null>;

  /**
   * The hourly series covering `at`, straight from the source.
   *
   * A series rather than a single hour on purpose: one request answers the
   * departure time, the arrival time and the next look at the same screen.
   */
  getWeatherForecast: (
    latitude: number,
    longitude: number,
    at: Date,
    options?: WeatherRequestOptions,
  ) => Promise<WeatherReading[]>;
};
