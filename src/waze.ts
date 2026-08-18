import { Linking, Platform } from 'react-native';

/**
 * Hand a destination off to Waze.
 *
 * The app never renders navigation data of its own — it only opens Waze with
 * the destination name the user already typed, and reports back what happened
 * so the caller can tell the user if nothing could be opened.
 */

export type WazeResult = 'app' | 'web' | 'failed';

/**
 * What to hand Waze for a destination: its address when the user gave one,
 * otherwise its name. A name like "אימון כדורגל" is not something Waze can
 * resolve to a place, so the address is what makes navigation land correctly.
 */
export function navigationQuery(destination: {
  name: string;
  address?: string;
}): string {
  const address = destination.address?.trim();
  return address && address.length > 0 ? address : destination.name;
}

/** Universal link: opens the Waze app when installed, the Live Map otherwise. */
export function wazeWebUrl(query: string): string {
  return `https://waze.com/ul?q=${encodeURIComponent(query)}&navigate=yes`;
}

/** Direct app scheme — only meaningful on a phone. */
function wazeAppUrl(query: string): string {
  return `waze://?q=${encodeURIComponent(query)}&navigate=yes`;
}

export async function openWaze(query: string): Promise<WazeResult> {
  const q = query.trim();
  if (!q) return 'failed';

  // On a phone, try the installed app first: it goes straight into navigation.
  // On web there is no app to hand off to, and an unhandled custom scheme fails
  // silently instead of throwing, so we skip it and use the universal link.
  if (Platform.OS !== 'web') {
    try {
      await Linking.openURL(wazeAppUrl(q));
      return 'app';
    } catch {
      // Waze is not installed — fall through to the browser.
    }
  }

  try {
    await Linking.openURL(wazeWebUrl(q));
    return 'web';
  } catch {
    return 'failed';
  }
}
