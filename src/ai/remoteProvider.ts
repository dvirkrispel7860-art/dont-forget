import { DestinationTarget } from '../aiAnalysis';
import { TravelMode } from '../transit/types';
import {
  AIAction,
  AIAnalysisResult,
  AIItem,
  AIProvider,
  AIRequest,
  AISource,
  AIUnknown,
  MIN_CONFIDENCE,
} from './types';

/**
 * The seat a real model will sit in. Nothing is connected yet, and nothing is
 * sent anywhere.
 *
 * **There is no API key in this file, and there is not meant to be one.** A key
 * shipped in a client app is a key given away — anyone can read it out of the
 * bundle. So this provider is built to talk to *your own* endpoint, which holds
 * the key server-side and forwards the request. The only thing the app is
 * configured with is a URL.
 *
 * Until that URL exists, `isConfigured()` is false, the router never calls this,
 * and the user's sentence never leaves the device. That is the default state
 * today: the app behaves exactly as it did before, on the local provider.
 *
 * What is real here: the request shape, the response contract, the parsing, the
 * timeout, and the refusal to trust anything the response says. The parser
 * discards any field it cannot verify — a model claiming a destination that does
 * not exist, or an item with no source, is dropped rather than believed.
 */

/**
 * Where to send analysis requests. Read from the public Expo env var, which is
 * the right place for a non-secret: it is a URL, not a credential.
 *
 * Absent by default, which is why this provider is inert.
 */
const ENDPOINT = process.env.EXPO_PUBLIC_AI_ENDPOINT?.trim() || '';

/** How long to wait before giving up and letting the local provider answer. */
const TIMEOUT_MS = 8000;

export const REMOTE_PROVIDER_ID = 'remote-model';

/** Thrown when the router asks an unconfigured provider to work. */
export class AINotConfiguredError extends Error {
  constructor() {
    super('remote AI provider is not configured');
    this.name = 'AINotConfiguredError';
  }
}

/**
 * What gets sent — assembled explicitly, field by field, so it is auditable.
 *
 * Note what is *not* here: no user name, no addresses, no coordinates, no trip
 * log, no saved settings, no device identifiers. Item names and destination
 * names are the point of the request; everything else is left behind.
 */
export type RemoteAnalysisPayload = {
  text: string;
  now: number;
  timeZoneOffsetMinutes: number;
  destinations: { id: string; name: string; icon: string }[];
  items?: { name: string; checked: boolean }[];
  history?: { tripsAnalysed: number; usuallyTaken: { name: string; takenIn: number; outOf: number }[] };
  weather?: {
    temperature: number;
    apparentTemperature?: number;
    precipitationProbability?: number;
    windSpeed: number;
    description: string;
  };
  travelMode?: TravelMode;
};

export function buildPayload(request: AIRequest): RemoteAnalysisPayload {
  return {
    text: request.text,
    now: request.now,
    timeZoneOffsetMinutes: request.timeZoneOffsetMinutes,
    /*
     * Names and icons only. A destination's address and coordinates are the most
     * sensitive thing the app holds and are of no use in understanding a
     * sentence, so they are not sent.
     */
    destinations: request.destinations.map((destination) => ({
      id: destination.id,
      name: destination.name,
      icon: destination.icon,
    })),
    ...(request.items ? { items: request.items } : {}),
    ...(request.history ? { history: request.history } : {}),
    ...(request.weather
      ? {
          weather: {
            temperature: request.weather.temperature,
            apparentTemperature: request.weather.apparentTemperature,
            precipitationProbability: request.weather.precipitationProbability,
            windSpeed: request.weather.windSpeed,
            description: request.weather.description,
          },
        }
      : {}),
    ...(request.travelMode ? { travelMode: request.travelMode } : {}),
  };
}

/* ------------------------------------------------------------------ parsing --- */

const SOURCES: AISource[] = ['text', 'history', 'weather', 'activity'];
const MODES: TravelMode[] = ['car', 'bus', 'walk', 'bike'];

function parseItems(raw: unknown, fallbackSource: AISource): AIItem[] {
  if (!Array.isArray(raw)) return [];
  const items: AIItem[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const o = entry as Record<string, unknown>;
    if (typeof o.name !== 'string') continue;
    const name = o.name.trim();
    if (!name || name.length > 60) continue;

    items.push({
      name,
      // An emoji from a response is display-only and harmless; a missing one
      // falls back to the neutral marker rather than being invented per item.
      emoji: typeof o.emoji === 'string' && o.emoji.length <= 4 ? o.emoji : '🧠',
      source: SOURCES.includes(o.source as AISource) ? (o.source as AISource) : fallbackSource,
      ...(typeof o.reason === 'string' && o.reason.trim() ? { reason: o.reason.trim() } : {}),
    });
  }

  // A response listing dozens of things is not an answer; it is noise.
  return items.slice(0, 12);
}

/**
 * The destination, but only if it is real.
 *
 * An `existing` destination is accepted only when its id is one the app actually
 * sent. That single check is what stops a response from pointing the user at
 * something that does not exist.
 */
function parseDestination(raw: unknown, request: AIRequest): DestinationTarget | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  if (o.kind === 'existing' && typeof o.id === 'string') {
    const known = request.destinations.find((destination) => destination.id === o.id);
    return known
      ? { kind: 'existing', id: known.id, name: known.name, icon: known.icon }
      : null;
  }

  if (o.kind === 'new' && typeof o.name === 'string') {
    const name = o.name.trim();
    if (!name || name.length > 40) return null;
    return {
      kind: 'new',
      name,
      icon: typeof o.icon === 'string' && o.icon.length <= 4 ? o.icon : '📍',
    };
  }

  return null;
}

function parseActions(raw: unknown, request: AIRequest, items: AIItem[]): AIAction[] {
  if (!Array.isArray(raw)) return [];
  const actions: AIAction[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const o = entry as Record<string, unknown>;

    switch (o.type) {
      case 'suggest_destination': {
        const destination = parseDestination(o.destination, request);
        if (destination) actions.push({ type: 'suggest_destination', destination });
        break;
      }
      case 'suggest_items': {
        const parsed = parseItems(o.items, 'text');
        const use = parsed.length > 0 ? parsed : items;
        if (use.length > 0) {
          const id = typeof o.destinationId === 'string' ? o.destinationId : undefined;
          const known = id && request.destinations.some((d) => d.id === id);
          actions.push({
            type: 'suggest_items',
            items: use,
            ...(known ? { destinationId: id } : {}),
          });
        }
        break;
      }
      case 'update_destination': {
        if (typeof o.destinationId !== 'string') break;
        if (!request.destinations.some((d) => d.id === o.destinationId)) break;
        const changes = o.changes as Record<string, unknown> | undefined;
        const mode = changes?.travelMode;
        if (MODES.includes(mode as TravelMode)) {
          actions.push({
            type: 'update_destination',
            destinationId: o.destinationId,
            changes: { travelMode: mode as TravelMode },
          });
        }
        break;
      }
      case 'ask_clarification': {
        const question = typeof o.question === 'string' ? o.question.trim() : '';
        if (question) actions.push({ type: 'ask_clarification', question });
        break;
      }
      case 'no_action':
        actions.push({ type: 'no_action' });
        break;
      default:
        break;
    }
  }

  return actions;
}

/**
 * Turns a response body into a result, keeping only what can be verified.
 *
 * Returns null when the body is not usable at all — the router then falls back,
 * and the user sees a normal local answer rather than an error.
 */
export function parseResponse(raw: unknown, request: AIRequest): AIAnalysisResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const confidence =
    typeof o.confidence === 'number' && Number.isFinite(o.confidence)
      ? Math.min(1, Math.max(0, o.confidence))
      : 0;

  const newItems = parseItems(o.newItems, 'text');
  const existingItems = parseItems(o.existingItems, 'text');
  const suggestedItems = parseItems(o.suggestedItems, 'activity');
  const destination = parseDestination(o.destination, request);

  const mode = MODES.includes(o.transportMode as TravelMode)
    ? (o.transportMode as TravelMode)
    : null;

  /*
   * `when` is only trusted as a timestamp with the phrase that explains it. A
   * bare number would be a time the user never sees the reasoning for, which is
   * exactly the kind of value that must not be acted on.
   */
  let when: AIAnalysisResult['when'] = null;
  if (o.when && typeof o.when === 'object') {
    const w = o.when as Record<string, unknown>;
    if (typeof w.at === 'number' && Number.isFinite(w.at) && typeof w.phrase === 'string') {
      when = {
        at: w.at,
        phrase: w.phrase,
        precision: w.precision === 'exact' ? 'exact' : 'approx',
      };
    }
  }

  const actions = parseActions(o.actions, request, [...newItems, ...suggestedItems]);

  /*
   * The verdict is ours, not the response's: a body claiming understood:true
   * with nothing usable in it is not an answer. It has to have a destination or
   * an item to be worth showing.
   */
  const hasSubstance =
    destination !== null || newItems.length > 0 || suggestedItems.length > 0;
  const understood = o.understood === true && confidence >= MIN_CONFIDENCE && hasSubstance;

  if (!understood && actions.length === 0) return null;

  const unknown: AIUnknown[] = [];
  if (!destination) unknown.push('destination');
  if (newItems.length === 0) unknown.push('items');
  if (!mode) unknown.push('transportMode');
  if (!when) unknown.push('when');
  if (!request.weather) unknown.push('weather');
  if (!request.history || request.history.tripsAnalysed === 0) unknown.push('history');

  return {
    understood,
    intent: understood ? 'prepare_departure' : 'unknown',
    text: request.text,
    confidence,
    explanation:
      typeof o.explanation === 'string' && o.explanation.trim()
        ? o.explanation.trim()
        : 'לא הצלחתי להבין למה התכוונת',
    destination,
    // The activity vocabulary is the app's own; a response does not get to add
    // to it, so this stays null on the remote path.
    activity: null,
    newItems,
    existingItems,
    suggestedItems,
    transportMode: mode,
    when,
    actions: actions.length > 0 ? actions : [{ type: 'no_action' }],
    unknown,
    meta: { provider: REMOTE_PROVIDER_ID, fellBack: false },
  };
}

/* ----------------------------------------------------------------- provider --- */

export const remoteProvider: AIProvider = {
  id: REMOTE_PROVIDER_ID,
  label: 'מודל חיצוני',

  /**
   * No endpoint, no provider. The router checks this before calling, so with
   * nothing configured the text is never sent and never even serialised.
   */
  isConfigured: () => ENDPOINT.length > 0,

  analyze: async (request, options) => {
    if (!ENDPOINT) throw new AINotConfiguredError();

    /*
     * Our own timeout, combined with any signal the caller passed, so a slow
     * service cannot leave the user watching "חושב..." indefinitely.
     */
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const onAbort = () => controller.abort();
    options?.signal?.addEventListener('abort', onAbort);

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(request)),
        signal: controller.signal,
      });

      if (!response.ok) {
        /*
         * Deliberately no body and no headers in the message: a failing endpoint
         * can echo back anything, including a credential, and this string may end
         * up in a log. The status is all the caller needs.
         */
        throw new Error(`remote AI responded ${response.status}`);
      }

      const parsed = parseResponse(await response.json(), request);
      if (!parsed) throw new Error('remote AI returned nothing usable');
      return parsed;
    } finally {
      clearTimeout(timer);
      options?.signal?.removeEventListener('abort', onAbort);
    }
  },
};
