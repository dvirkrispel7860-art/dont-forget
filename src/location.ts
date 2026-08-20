import { Linking, Platform } from 'react-native';
import * as ExpoLocation from 'expo-location';
import { Coords } from './weather/types';

/**
 * The device's location — one module for web and for a native build.
 *
 * Before this, three screens each called `navigator.geolocation` themselves, so
 * location worked in the browser and silently did nothing in a native build, and
 * every refusal, timeout and switched-off GPS came out as the same sentence
 * ("no permission"). This is that logic, once:
 *
 *   - web: `navigator.geolocation`, exactly as before, so the PWA is unchanged.
 *   - native: `expo-location`, with the permission asked for at the moment a
 *     feature needs a location — never on launch.
 *
 * Both sides return the same `LocationResult`, and every way it can fail is its
 * own reason with its own sentence. Nothing here tracks the user: no
 * `watchPosition`, no history, one last fix held in memory for a few minutes so a
 * momentary GPS failure has something to fall back on, and no location ever
 * leaves the device.
 *
 * Navigation is deliberately untouched for now: `navigation.ts` still hands the
 * map app only a destination and lets it decide where the user is starting from.
 * When passing an origin becomes worth it, `getCurrentLocation()` is the seam —
 * it already returns exactly the `Coords` such a link would need.
 */

export type { Coords };

/**
 * What the app is allowed to do, as four states the UI can speak about.
 *
 * `unknown` is "not asked yet" (and, in a browser without the Permissions API,
 * "cannot be told without asking") — deliberately not the same thing as `denied`.
 */
export type LocationPermission = 'granted' | 'denied' | 'unavailable' | 'unknown';

/** Why there is no location. Each one is a different sentence to the user. */
export type LocationFailure =
  /** The user refused. */
  | 'denied'
  /** Location services / GPS are switched off on the device. */
  | 'services-off'
  /** Asked, allowed, but no fix arrived in time. */
  | 'timeout'
  /** This platform or browser has no geolocation at all. */
  | 'unavailable'
  /** Anything else the platform reported. */
  | 'failed';

/** A single fix, with the moment it was taken — see `lastKnownLocation`. */
export type UserLocation = Coords & {
  /** Epoch millis of the fix itself, as the platform reported it. */
  at: number;
  /** Radius in metres the platform claims for it, when it gives one. */
  accuracy?: number;
};

export type LocationResult =
  | {
      status: 'ok';
      location: UserLocation;
      /**
       * True when this is the remembered fix rather than a fresh one — the
       * device could not produce a position just now. Callers may say so.
       */
      stale: boolean;
    }
  | { status: 'error'; reason: LocationFailure };

/* -------------------------------------------------------------- constants --- */

/** A fix this new is good enough to reuse without asking the device again. */
const FRESH_MS = 60_000;

/**
 * The oldest a remembered fix may be to stand in for one we cannot get. Past
 * this it is thrown away rather than used: a five-minute-old point is still the
 * right neighbourhood for finding a bus stop, an hour-old one is not.
 */
const STALE_LIMIT_MS = 5 * 60_000;

/** How long to wait for a fix before giving up. Matches the old web timeout. */
const TIMEOUT_MS = 15_000;

/* --------------------------------------------------------------- last fix --- */

/**
 * The one fix we remember. Deliberately a single slot in memory:
 *
 *   - one fix, not a list — there is no location history to leak.
 *   - never written to storage — it dies with the session.
 *   - timestamped, and unusable past `STALE_LIMIT_MS`.
 */
let lastFix: UserLocation | null = null;

/** The remembered fix, if it is still young enough to mean anything. */
export function lastKnownLocation(maxAgeMs: number = STALE_LIMIT_MS): UserLocation | null {
  if (!lastFix) return null;
  return Date.now() - lastFix.at <= maxAgeMs ? lastFix : null;
}

/** Drops the remembered fix. */
export function forgetLastLocation(): void {
  lastFix = null;
}

function remember(location: UserLocation): UserLocation {
  lastFix = location;
  return location;
}

/* ------------------------------------------------------------- capability --- */

const isWeb = Platform.OS === 'web';

function webGeolocation(): Geolocation | null {
  if (!isWeb) return null;
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
  return navigator.geolocation;
}

/** Can this platform produce a location at all, permission aside? */
export function locationSupported(): boolean {
  return isWeb ? webGeolocation() != null : true;
}

/**
 * Whether the app can send the user to the system's own settings — true on a
 * phone, false in a browser, where the permission lives in the site settings the
 * app cannot open.
 */
export function canOpenLocationSettings(): boolean {
  return !isWeb;
}

/** Opens the OS settings page for this app. Returns false if it could not. */
export async function openLocationSettings(): Promise<boolean> {
  if (!canOpenLocationSettings()) return false;
  try {
    await Linking.openSettings();
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------- permission --- */

function fromExpoStatus(
  response: ExpoLocation.LocationPermissionResponse,
): LocationPermission {
  if (response.granted) return 'granted';
  if (response.status === ExpoLocation.PermissionStatus.DENIED) return 'denied';
  return 'unknown';
}

/**
 * What the permission is right now, without prompting for it.
 *
 * On web this leans on the Permissions API, which not every browser has — and
 * where it is missing the honest answer is `unknown`, because the only way to
 * find out is to ask, and asking is not this function's job.
 */
export async function getLocationPermissionStatus(): Promise<LocationPermission> {
  if (isWeb) {
    if (!webGeolocation()) return 'unavailable';
    try {
      if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unknown';
      const permission = await navigator.permissions.query({
        name: 'geolocation' as PermissionName,
      });
      if (permission.state === 'granted') return 'granted';
      if (permission.state === 'denied') return 'denied';
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  try {
    return fromExpoStatus(await ExpoLocation.getForegroundPermissionsAsync());
  } catch {
    return 'unknown';
  }
}

/**
 * Asks for the permission, prompting if that is what it takes.
 *
 * Web has no "request permission" call of its own: the prompt only appears when
 * something asks for a position, so that is what happens here — one position
 * request, whose answer is the permission answer. It is also why this must only
 * be called from a real user action.
 */
export async function requestLocationPermission(): Promise<LocationPermission> {
  if (isWeb) {
    if (!webGeolocation()) return 'unavailable';
    const result = await getCurrentLocation({ allowStale: false, maxAgeMs: 0 });
    if (result.status === 'ok') return 'granted';
    if (result.reason === 'denied') return 'denied';
    if (result.reason === 'unavailable') return 'unavailable';
    // A timeout or a switched-off GPS says nothing about the permission.
    return getLocationPermissionStatus();
  }

  try {
    return fromExpoStatus(await ExpoLocation.requestForegroundPermissionsAsync());
  } catch {
    return 'unknown';
  }
}

/* ---------------------------------------------------------------- reading --- */

type GetOptions = {
  /** How long to wait for a fix. Default 15s. */
  timeoutMs?: number;
  /**
   * A remembered fix younger than this is returned straight away, without
   * touching the device. Default one minute; pass 0 to force a fresh read.
   */
  maxAgeMs?: number;
  /**
   * Whether a fix up to `STALE_LIMIT_MS` old may stand in when the device
   * cannot produce one now. Default true. Never used after a refusal.
   */
  allowStale?: boolean;
};

function webPosition(timeoutMs: number, maxAgeMs: number): Promise<UserLocation> {
  return new Promise((resolve, reject) => {
    const geolocation = webGeolocation();
    if (!geolocation) {
      reject(new LocationError('unavailable'));
      return;
    }
    geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy ?? undefined,
          // Browsers report the fix's own age; trust it over "now".
          at: position.timestamp || Date.now(),
        }),
      (error) => reject(new LocationError(webFailure(error))),
      { timeout: timeoutMs, maximumAge: maxAgeMs },
    );
  });
}

/** The browser's three error codes, kept apart instead of all being "denied". */
function webFailure(error: GeolocationPositionError): LocationFailure {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return 'denied';
    case error.POSITION_UNAVAILABLE:
      // No fix available: GPS off, no signal, or no provider to ask.
      return 'services-off';
    case error.TIMEOUT:
      return 'timeout';
    default:
      return 'failed';
  }
}

/**
 * The native failure, from the error code `expo-location` raises.
 *
 * The codes come from the module's own exceptions on both platforms
 * (`LocationUnauthorizedException`, `LocationServicesDisabled`, …); the message
 * is only consulted when there is no code to read, so a refusal is never
 * reported as a general failure and a switched-off GPS is never reported as a
 * refusal.
 */
function nativeFailure(error: unknown): LocationFailure {
  const coded = error as { code?: unknown; message?: unknown };
  const code = typeof coded?.code === 'string' ? coded.code : '';
  const message = typeof coded?.message === 'string' ? coded.message : '';
  const text = `${code} ${message}`.toUpperCase();

  if (/UNAUTHORIZED|DENIED|PERMISSION/.test(text)) return 'denied';
  if (/SERVICES_DISABLED|SETTINGS_UNSATISFIED|SERVICES ARE DISABLED/.test(text)) {
    return 'services-off';
  }
  // Everything else — cancelled, rejected, no fix, unknown — is a plain failure.
  return 'failed';
}

class LocationError extends Error {
  constructor(readonly reason: LocationFailure) {
    super(reason);
  }
}

/** `expo-location` has no timeout of its own, so one is imposed here. */
function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LocationError('timeout')), timeoutMs);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

async function nativePosition(timeoutMs: number): Promise<UserLocation> {
  /*
   * Services first, permission second. A device with location switched off is
   * not a permission problem, and prompting for a permission that cannot deliver
   * anything is both noise and a misleading message.
   */
  try {
    if (!(await ExpoLocation.hasServicesEnabledAsync())) {
      throw new LocationError('services-off');
    }
  } catch (error) {
    if (error instanceof LocationError) throw error;
    // Could not even be asked — carry on and let the position request answer.
  }

  /*
   * The one place the prompt appears: a feature is asking for a location now.
   * `canAskAgain` is the platform's own answer to "may I" — true when it has
   * never been asked, and true again on Android after a single refusal, which is
   * what makes "נסה שוב" actually do something there. Once it is false, the
   * refusal is final until the user changes it in the system settings, and this
   * stops asking.
   */
  let response = await ExpoLocation.getForegroundPermissionsAsync();
  if (!response.granted && response.canAskAgain) {
    response = await ExpoLocation.requestForegroundPermissionsAsync();
  }
  if (!response.granted) throw new LocationError('denied');

  const position = await withTimeout(
    ExpoLocation.getCurrentPositionAsync({
      // ~100m: plenty for "which stop is near me", and far cheaper on battery
      // than a navigation-grade fix.
      accuracy: ExpoLocation.Accuracy.Balanced,
    }),
    timeoutMs,
  );

  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy ?? undefined,
    at: position.timestamp || Date.now(),
  };
}

/**
 * The device's position — the one call every feature uses.
 *
 * Order: the remembered fix if it is fresh, then the device, then the remembered
 * fix again as a fallback if the device failed for a reason that has nothing to
 * do with consent. A refusal is returned as a refusal; it is never papered over
 * with a point from before it.
 */
export async function getCurrentLocation(options: GetOptions = {}): Promise<LocationResult> {
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const maxAgeMs = options.maxAgeMs ?? FRESH_MS;
  const allowStale = options.allowStale ?? true;

  const fresh = maxAgeMs > 0 ? lastKnownLocation(maxAgeMs) : null;
  if (fresh) return { status: 'ok', location: fresh, stale: false };

  if (!locationSupported()) return { status: 'error', reason: 'unavailable' };

  try {
    const location = isWeb
      ? await webPosition(timeoutMs, maxAgeMs)
      : await nativePosition(timeoutMs);
    return { status: 'ok', location: remember(location), stale: false };
  } catch (error) {
    const reason =
      error instanceof LocationError
        ? error.reason
        : isWeb
          ? 'failed'
          : nativeFailure(error);

    /*
     * A refusal (or a platform with nothing to ask) must stay visible — the user
     * said no, and answering with a point from before that would be both
     * misleading and a small betrayal. Everything else is "no GPS right now",
     * which is exactly what the remembered fix is for.
     */
    if (allowStale && reason !== 'denied' && reason !== 'unavailable') {
      const stale = lastKnownLocation();
      if (stale) return { status: 'ok', location: stale, stale: true };
    }

    return { status: 'error', reason };
  }
}

/* ---------------------------------------------------------------- wording --- */

/**
 * One sentence per failure, shared by every screen so that a timeout is never
 * shown as a refusal. Callers add their own way out after it ("…אפשר לחפש תחנה
 * לפי שם").
 */
export function locationErrorMessage(reason: LocationFailure): string {
  switch (reason) {
    case 'denied':
      return 'לא קיבלנו הרשאת מיקום.';
    case 'services-off':
      return 'איתור המיקום כבוי או לא זמין במכשיר.';
    case 'timeout':
      return 'לא הצלחנו לאתר את המיקום בזמן.';
    case 'unavailable':
      return 'המכשיר הזה לא מאפשר איתור מיקום.';
    case 'failed':
      return 'לא הצלחנו לאתר את המיקום כרגע.';
  }
}

/** How to fix it, per failure — the second half of the message. */
export function locationErrorHint(reason: LocationFailure): string {
  switch (reason) {
    case 'denied':
      return canOpenLocationSettings()
        ? 'אפשר לאשר מיקום בהגדרות המכשיר ולנסות שוב.'
        : 'אפשר לאשר מיקום בהגדרות הדפדפן ולנסות שוב.';
    case 'services-off':
      return 'הפעל את איתור המיקום במכשיר ונסה שוב.';
    case 'timeout':
      return 'נסה שוב, עדיף במקום פתוח.';
    case 'unavailable':
      return '';
    case 'failed':
      return 'נסה שוב עוד רגע.';
  }
}

/** What the permission is, in words — for the settings screen. */
export function locationPermissionLabel(status: LocationPermission): string {
  switch (status) {
    case 'granted':
      return '✅ מאושרת';
    case 'denied':
      return '⛔ נדחתה';
    case 'unavailable':
      return 'לא נתמכת במכשיר הזה';
    case 'unknown':
      return 'עדיין לא נשאלת';
  }
}
