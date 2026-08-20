import { Linking, Platform } from 'react-native';
import { TravelMode } from './transit/types';
import { Destination } from './types';
import { navigationQuery, openWaze } from './waze';

/**
 * Which app takes the user to a destination, by how they get there.
 *
 * This sits on top of the navigation the app already had: driving still goes
 * through `waze.ts`, untouched, and a bus is not a navigation action at all —
 * its rides are in the app's own "🚌 הדרך שלי" card. Walking and cycling are the
 * new cases, and they go to Google Maps with the matching directions mode.
 *
 * As everywhere else, the app renders no route and no ETA of its own: it hands
 * the destination over and lets the map app do the navigating.
 */

export type NavigationApp = 'waze' | 'google-maps' | 'transit';

export type NavigationOutcome =
  /** The map app (or its web version) was opened. */
  | { status: 'opened'; via: 'app' | 'web'; app: NavigationApp }
  /** The destination has neither coordinates nor an address. */
  | { status: 'no-location' }
  /** Nothing could be opened — no app, no browser, no connection. */
  | { status: 'failed'; app: NavigationApp }
  /** A bus destination: the ride details are in the app, not in a map app. */
  | { status: 'no-navigation' };

/**
 * Which app the navigation button should offer.
 *
 * `mode` overrides the destination's own travel mode, for a departure where the
 * user said they are getting there differently this time.
 */
export function navigationAppFor(
  destination: Destination,
  mode: TravelMode | undefined = destination.travelMode,
): NavigationApp {
  switch (mode) {
    case 'walk':
    case 'bike':
      return 'google-maps';
    case 'bus':
      return 'transit';
    // Driving, and destinations from before travel modes existed.
    default:
      return 'waze';
  }
}

/** What the button says, per app. */
export function navigationLabel(app: NavigationApp): string {
  switch (app) {
    case 'google-maps':
      return '🗺️ פתח Google Maps';
    case 'transit':
      return '🚌 פרטי נסיעה';
    case 'waze':
      return '🗺️ פתח Waze';
  }
}

/** Human name of the app, for a message about it. */
export function navigationAppName(app: NavigationApp): string {
  return app === 'google-maps' ? 'Google Maps' : 'Waze';
}

/* ------------------------------------------------------------------ target --- */

/**
 * What to hand the map app.
 *
 * A typed address beats the destination's coordinates on purpose: the saved
 * coordinates usually come from geocoding the address, and this app's geocoder
 * resolves to the *town* — so "חוף גורדון, תל אביב" navigates better than the
 * point it produced for it. Coordinates win only when the user set them
 * themselves ("📍 בחר מיקום"), because then they are the precise thing, or when
 * there is no address at all.
 *
 * Returns null when the destination has neither — a name like "אימון כדורגל" is
 * not a place, and sending it as one is worse than saying we cannot navigate.
 */
export function navigationTarget(destination: Destination): string | null {
  const address = destination.address?.trim();
  const coords = destination.coords;
  const coordsQuery =
    coords && typeof coords.latitude === 'number' && typeof coords.longitude === 'number'
      ? `${coords.latitude},${coords.longitude}`
      : null;
  const pickedByUser = coordsQuery != null && destination.coordsLabel === 'המיקום שבחרת';

  if (pickedByUser) return coordsQuery;
  if (address && address.length > 0) return address;
  return coordsQuery;
}

/* ------------------------------------------------------------ google maps --- */

type DirectionsMode = 'walking' | 'bicycling';

function directionsMode(mode: TravelMode | undefined): DirectionsMode {
  return mode === 'bike' ? 'bicycling' : 'walking';
}

/**
 * Universal Maps URL. Opens the installed Google Maps app on a phone and the web
 * version everywhere else — one link for both, which is why it is also the
 * fallback when the app-specific scheme is not handled.
 *
 * Whether cycling directions exist for a given area is Google's business: it is
 * asked for the mode, and if it has none it opens the destination and says so
 * itself. This app never fills that gap with a made-up route.
 */
export function googleMapsUrl(query: string, mode: DirectionsMode): string {
  return (
    'https://www.google.com/maps/dir/?api=1' +
    `&destination=${encodeURIComponent(query)}` +
    `&travelmode=${mode}`
  );
}

/** Google Maps' own scheme — only meaningful on a phone with the app installed. */
function googleMapsAppUrl(query: string, mode: DirectionsMode): string {
  return (
    `comgooglemaps://?daddr=${encodeURIComponent(query)}` +
    `&directionsmode=${mode}`
  );
}

/* -------------------------------------------------------------------- open --- */

/**
 * Opens navigation for a destination, choosing the app by its travel mode.
 *
 * Bus returns 'no-navigation': the caller shows the ride details it already has
 * instead (see `navigationAppFor`).
 */
export async function openNavigation(
  destination: Destination,
  mode: TravelMode | undefined = destination.travelMode,
): Promise<NavigationOutcome> {
  const app = navigationAppFor(destination, mode);
  if (app === 'transit') return { status: 'no-navigation' };

  const target = navigationTarget(destination);
  if (!target) return { status: 'no-location' };

  if (app === 'waze') {
    // The existing path, unchanged — including its own app-then-web fallback.
    const result = await openWaze(target);
    return result === 'failed'
      ? { status: 'failed', app }
      : { status: 'opened', via: result, app };
  }

  const directions = directionsMode(mode);

  // On a phone, try the app's own scheme first so it opens straight into
  // directions. On web there is nothing to hand off to, and an unhandled scheme
  // fails silently instead of throwing, so we skip it there.
  if (Platform.OS !== 'web') {
    try {
      await Linking.openURL(googleMapsAppUrl(target, directions));
      return { status: 'opened', via: 'app', app };
    } catch {
      // Google Maps is not installed — fall through to the browser.
    }
  }

  try {
    await Linking.openURL(googleMapsUrl(target, directions));
    return { status: 'opened', via: 'web', app };
  } catch {
    return { status: 'failed', app };
  }
}

/** The query a Waze-bound caller would use. Kept for the existing car path. */
export { navigationQuery };
