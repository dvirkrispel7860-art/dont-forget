import { Activity, DestinationTarget } from '../aiAnalysis';
import { TravelMode } from '../transit/types';

/**
 * The contract between the app and whatever is doing the understanding.
 *
 * There is one rule behind every shape here, and it is the reason the types look
 * the way they do: **nothing may be invented.** Every value a provider returns
 * either came from the user's own sentence or from data the app already holds,
 * and it says which (`source`). Anything asked about but not known is named in
 * `unknown` rather than filled in with a plausible guess — a wrong item on a
 * packing list is worse than a missing one, and an invented departure time sends
 * someone out of the door at the wrong hour.
 *
 * A provider also never *does* anything. It returns `actions` — proposals — and
 * the app performs them after the user agrees. That is what keeps a model from
 * quietly editing someone's data.
 */

/* ------------------------------------------------------------------ request --- */

/**
 * What a provider is given. Assembled by requestContext.ts, deliberately narrow:
 * the destination names it needs to match against, the items of the one
 * destination in question, the history rows that already exist, and the forecast
 * the weather layer already fetched. Not the storage, not the trip log, not
 * anything a model has no use for.
 */
export type AIRequest = {
  /** Exactly what the user typed or dictated. */
  text: string;
  /** Enough of each destination to match a sentence against it. */
  destinations: AIRequestDestination[];
  /**
   * The destination the sentence is about, when the app already knows which —
   * from the screen the user is on. Absent on the home screen, where finding it
   * is the provider's job.
   */
  focusedDestinationId?: string;
  /** Items of the focused (or matched) destination, when there is one. */
  items?: AIRequestItem[];
  /**
   * What previous departures to this destination actually recorded. Counts only,
   * as the app already computed them — a provider may report these, never invent
   * one.
   */
  history?: AIRequestHistory;
  /** The real forecast for the relevant hour, or absent. Never a placeholder. */
  weather?: AIRequestWeather;
  /** A travel mode the user has already chosen for this departure. */
  travelMode?: TravelMode;
  /** Epoch millis "now", so a relative phrase like "מחר" resolves consistently. */
  now: number;
  /** IANA-ish label, only so a provider can phrase a time correctly. */
  timeZoneOffsetMinutes: number;
};

export type AIRequestDestination = {
  id: string;
  name: string;
  icon: string;
  travelMode?: TravelMode;
};

export type AIRequestItem = {
  name: string;
  checked: boolean;
};

export type AIRequestHistory = {
  /** How many recorded departures carried item detail. */
  tripsAnalysed: number;
  /** Items usually taken here, with the counts behind them. */
  usuallyTaken: { name: string; takenIn: number; outOf: number }[];
};

export type AIRequestWeather = {
  /** °C */
  temperature: number;
  apparentTemperature?: number;
  /** % */
  precipitationProbability?: number;
  /** km/h */
  windSpeed: number;
  /** What the app's own weather layer called it. */
  description: string;
  emoji: string;
  /** What the forecast is *of*, so nothing claims more precision than it has. */
  locationLabel: string;
};

/* ------------------------------------------------------------------- result --- */

export type AIIntent =
  /** The sentence is about getting ready to go somewhere. */
  | 'prepare_departure'
  /** Understood as being about a destination, but not what to do about it. */
  | 'unknown';

/** Where a value came from. There is no "the model thought so" option on purpose. */
export type AISource =
  /** The user said it in this sentence. */
  | 'text'
  /** Recorded in the user's own departure history. */
  | 'history'
  /** Justified by the real forecast the app fetched. */
  | 'weather'
  /** From the app's own list for the activity it recognised. */
  | 'activity';

export type AIItem = {
  name: string;
  /** Only ever an emoji the app already had for it; never invented per item. */
  emoji: string;
  source: AISource;
  /** Why, in words the user can check — e.g. "לקחת אותו ב-4 מתוך 5 יציאות". */
  reason?: string;
};

/** Resolved from the sentence by the app's own parser. Absent when not said. */
export type AIWhen = {
  at: number;
  /** What was understood, with the clock in it, so the reading is visible. */
  phrase: string;
  precision: 'exact' | 'approx';
};

/**
 * What the app may do next — a proposal, never a change. The UI performs it only
 * after the user agrees.
 */
export type AIAction =
  /** No destination matched; offer to create this one. */
  | { type: 'suggest_destination'; destination: DestinationTarget }
  /** Offer to add these to a list. */
  | {
      type: 'suggest_items';
      items: AIItem[];
      /** Which destination they would go to, when one is already known. */
      destinationId?: string;
    }
  /** Offer to change something about an existing destination. */
  | {
      type: 'update_destination';
      destinationId: string;
      changes: { travelMode?: TravelMode };
    }
  /** Nothing worth proposing. */
  | { type: 'no_action' }
  /** Not enough to act on; ask this. */
  | { type: 'ask_clarification'; question: string };

export type AIAnalysisResult = {
  /** False whenever the provider is not confident — see `confidence`. */
  understood: boolean;
  intent: AIIntent;
  /** The user's sentence, unchanged. Never persisted anywhere. */
  text: string;
  /** 0…1. Below `MIN_CONFIDENCE` the result is reported as not understood. */
  confidence: number;
  /** One line the user can read to check the app understood them. */
  explanation: string;
  /** An existing destination, a proposal to create one, or null when unclear. */
  destination: DestinationTarget | null;
  /** The activity recognised, when one was. */
  activity: Activity | null;
  /** Named by the user and not already on the destination's list. */
  newItems: AIItem[];
  /** Named by the user and already on the list — so nothing is added twice. */
  existingItems: AIItem[];
  /** Offered from history, weather or the activity list. Always sourced. */
  suggestedItems: AIItem[];
  /** Only when the user actually said how they are getting there. */
  transportMode: TravelMode | null;
  /** Only when the user actually said when. */
  when: AIWhen | null;
  actions: AIAction[];
  /** Fields a fuller answer would have had, and honestly does not. */
  unknown: AIUnknown[];
  /** Which provider answered, and whether it had to fall back. */
  meta: AIResultMeta;
};

export type AIUnknown =
  | 'destination'
  | 'items'
  | 'transportMode'
  | 'when'
  | 'weather'
  | 'history';

export type AIResultMeta = {
  /** The provider that produced this. */
  provider: string;
  /** True when a remote provider was asked first and could not answer. */
  fellBack: boolean;
  /** Why it fell back — for diagnostics, never shown as a raw API error. */
  fallbackReason?: AIFallbackReason;
};

export type AIFallbackReason =
  /** No endpoint configured, so nothing was sent anywhere. */
  | 'not-configured'
  /** The request could not leave the device, or nothing came back. */
  | 'offline'
  /** The service answered, but not with something usable. */
  | 'bad-response'
  /** It took too long. */
  | 'timeout'
  /** Anything else. */
  | 'failed';

/* ----------------------------------------------------------------- provider --- */

export type AIProvider = {
  /** Stable id, used in `meta.provider` and in logs. Never a secret. */
  id: string;
  /** Human name, for the one line of provenance the UI already shows. */
  label: string;
  /**
   * False when the provider has nothing to work with — no endpoint, no engine.
   * The router checks this *before* calling, so an unconfigured provider never
   * sees the user's text at all.
   */
  isConfigured: () => boolean;
  analyze: (
    request: AIRequest,
    options?: { signal?: AbortSignal },
  ) => Promise<AIAnalysisResult>;
};

/** Below this the answer is reported as not understood rather than guessed at. */
export const MIN_CONFIDENCE = 0.4;
