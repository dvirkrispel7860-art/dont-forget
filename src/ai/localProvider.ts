import {
  CONFIDENCE_THRESHOLD,
  DestinationTarget,
  localAnalysis,
  MAX_MATCH_SCORE,
} from '../aiAnalysis';
import { normalizeItemName } from '../suggestions';
import { parseTimePhrase } from '../timePhrase';
import { TravelMode, TRAVEL_MODES } from '../transit/types';
import { itemsFromText } from './itemsFromText';
import {
  AIAction,
  AIAnalysisResult,
  AIItem,
  AIProvider,
  AIRequest,
  AIRequestHistory,
  AIRequestWeather,
  AIUnknown,
  MIN_CONFIDENCE,
} from './types';

/**
 * The provider that runs on the device.
 *
 * It composes what the app already has rather than re-deciding any of it:
 *
 *  - the activity and destination match → `localAnalysis` (aiAnalysis.ts)
 *  - the things the sentence named       → `itemsFromText`
 *  - when the user said they are going   → `parseTimePhrase` (timePhrase.ts)
 *  - what history says is usually taken  → the counts already in the request
 *  - what the weather justifies          → the reading already in the request
 *
 * None of that logic is duplicated here. What this file adds is the assembly: it
 * turns those answers into one structured result, labels every value with where
 * it came from, and proposes actions instead of taking them.
 *
 * Always available, never fails, never leaves the device. That is what makes it
 * the fallback for everything else.
 */

/** Travel modes, only recognised when the sentence actually names one. */
const MODE_WORDS: { mode: TravelMode; words: string[] }[] = [
  { mode: 'bus', words: ['אוטובוס', 'באוטובוס', 'תחבורה ציבורית', 'קו'] },
  { mode: 'car', words: ['רכב', 'ברכב', 'אוטו', 'באוטו', 'מכונית', 'נוסע ברכב'] },
  { mode: 'walk', words: ['הליכה', 'ברגל', 'רגלי', 'הולך ברגל'] },
  { mode: 'bike', words: ['אופניים', 'באופניים', 'קורקינט', 'אופנוע'] },
];

function normalizeSentence(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * The travel mode the user named, or null.
 *
 * "קו" only counts next to a number ("קו 54") — on its own it is far too common
 * a word to read as "by bus".
 */
function modeFromText(text: string): TravelMode | null {
  const sentence = ` ${normalizeSentence(text)} `;

  for (const entry of MODE_WORDS) {
    for (const word of entry.words) {
      if (word === 'קו') {
        if (/ קו \d/.test(sentence)) return entry.mode;
        continue;
      }
      if (sentence.includes(` ${word} `)) return entry.mode;
    }
  }
  return null;
}

/** The 0…1 confidence, from the matcher's raw score. */
function toConfidence(score: number): number {
  return Math.min(1, Math.max(0, score / MAX_MATCH_SCORE));
}

/** "לקחת אותו ב-4 מתוך 5 יציאות קודמות" — the app's own wording for history. */
function historyReason(takenIn: number, outOf: number): string {
  if (takenIn === 1) return `לקחת אותו ביציאה אחת מתוך ${outOf} קודמות`;
  return `לקחת אותו ב-${takenIn} מתוך ${outOf} יציאות קודמות`;
}

/**
 * Items history genuinely supports. Straight from the counts the app computed —
 * this invents nothing and adds nothing of its own.
 */
function itemsFromHistory(history: AIRequestHistory | undefined): AIItem[] {
  if (!history || history.tripsAnalysed === 0) return [];
  return history.usuallyTaken.map((entry) => ({
    name: entry.name,
    // No per-item emoji is stored anywhere, and inventing one per name would be
    // made-up data, so history rows share the neutral one the app already uses.
    emoji: '🎒',
    source: 'history' as const,
    reason: historyReason(entry.takenIn, entry.outOf),
  }));
}

/**
 * What the forecast justifies — interpretation only. The numbers are the weather
 * layer's; this never states a forecast of its own, and returns nothing at all
 * when there is no reading.
 */
function itemsFromWeather(weather: AIRequestWeather | undefined): AIItem[] {
  if (!weather) return [];

  const items: AIItem[] = [];
  const feels = weather.apparentTemperature ?? weather.temperature;
  const chance = weather.precipitationProbability ?? 0;

  if (chance >= 50) {
    items.push({
      name: 'מטרייה',
      emoji: '☔',
      source: 'weather',
      reason: `🌧️ ${Math.round(chance)}% סיכוי לגשם ב${weather.locationLabel}`,
    });
  }
  if (feels >= 28) {
    items.push({
      name: 'בקבוק מים',
      emoji: '💧',
      source: 'weather',
      reason: `☀️ צפוי חם — ${Math.round(feels)}°`,
    });
  }
  if (feels <= 12) {
    items.push({
      name: 'מעיל',
      emoji: '🧥',
      source: 'weather',
      reason: `❄️ צפוי קר — ${Math.round(feels)}°`,
    });
  }
  return items;
}

/** One line the user can read to check we understood them. */
function explain(params: {
  activityLabel: string | null;
  destination: DestinationTarget | null;
  named: string[];
  mode: TravelMode | null;
  whenPhrase: string | null;
}): string {
  const parts: string[] = [];

  if (params.destination) {
    parts.push(
      params.destination.kind === 'existing'
        ? `יעד: ${params.destination.name}`
        : `יעד חדש: ${params.destination.name}`,
    );
  } else if (params.activityLabel) {
    parts.push(params.activityLabel);
  }

  if (params.whenPhrase) parts.push(params.whenPhrase);

  if (params.mode) {
    const meta = TRAVEL_MODES.find((m) => m.id === params.mode);
    if (meta) parts.push(`${meta.emoji} ${meta.label}`);
  }

  if (params.named.length > 0) parts.push(`לקחת: ${params.named.join(', ')}`);

  return parts.length > 0 ? parts.join(' · ') : 'לא הצלחתי להבין למה התכוונת';
}

/** The result for a sentence nothing could be made of. */
function notUnderstood(request: AIRequest, providerId: string): AIAnalysisResult {
  return {
    understood: false,
    intent: 'unknown',
    text: request.text,
    confidence: 0,
    explanation: 'לא הצלחתי להבין למה התכוונת',
    destination: null,
    activity: null,
    newItems: [],
    existingItems: [],
    suggestedItems: [],
    transportMode: null,
    when: null,
    actions: [
      {
        type: 'ask_clarification',
        question: 'לאן אתה יוצא, ומה חשוב לקחת?',
      },
    ],
    unknown: ['destination', 'items', 'transportMode', 'when'],
    meta: { provider: providerId, fellBack: false },
  };
}

export const LOCAL_PROVIDER_ID = 'local-keywords';

/**
 * Runs the on-device analysis and assembles the structured result.
 *
 * Exported separately from the provider object so the router can use it as a
 * fallback without going through `isConfigured`, and so tests can call it
 * directly.
 */
export function analyzeLocally(
  request: AIRequest,
  providerId: string = LOCAL_PROVIDER_ID,
): AIAnalysisResult {
  const text = request.text.trim();
  if (!text) return notUnderstood({ ...request, text }, providerId);

  const match = localAnalysis(text, {
    destinations: request.destinations.map((destination) => ({
      id: destination.id,
      name: destination.name,
      icon: destination.icon,
      travelMode: destination.travelMode,
      items: [],
      createdAt: 0,
    })),
  });

  /* Things the sentence itself named — the one source that needs no matching. */
  const named = itemsFromText(text);
  const mode = modeFromText(text);
  const when = parseTimePhrase(text, request.now);

  /*
   * A sentence can be understood on the strength of what it names, even when no
   * activity matched: "לקחת את התרופות והמטען" is perfectly clear about the
   * items. So either signal is enough — but with neither, we say we did not
   * understand rather than inventing a destination.
   */
  if (!match.understood && named.length === 0) {
    const bare = notUnderstood({ ...request, text }, providerId);
    // A mode or a time on its own is still not enough to act on, but it is worth
    // reflecting back so the user can see what did land.
    if (mode || when) {
      return {
        ...bare,
        transportMode: mode,
        when: when ? { at: when.at, phrase: when.phrase, precision: when.precision } : null,
        explanation: explain({
          activityLabel: null,
          destination: null,
          named: [],
          mode,
          whenPhrase: when?.phrase ?? null,
        }),
      };
    }
    return bare;
  }

  const activity = match.understood ? match.activity : null;
  const destination = match.understood ? match.destination : null;
  const rawConfidence = match.understood ? toConfidence(match.confidence) : 0;

  /*
   * Named items are hard evidence of intent, so they raise confidence on their
   * own — but only to the floor that counts as understood, never above what the
   * matcher itself earned.
   */
  const confidence =
    named.length > 0 ? Math.max(rawConfidence, MIN_CONFIDENCE) : rawConfidence;

  /* Which of the named things the list already has. */
  const onList = new Set((request.items ?? []).map((item) => normalizeItemName(item.name)));
  const newItems: AIItem[] = [];
  const existingItems: AIItem[] = [];
  for (const name of named) {
    const item: AIItem = { name, emoji: '🧠', source: 'text' };
    if (onList.has(normalizeItemName(name))) existingItems.push(item);
    else newItems.push(item);
  }

  /*
   * Everything else worth offering, in order of how well it is evidenced:
   * the user's own history first, then the real forecast, then the app's list for
   * the activity. Nothing already named or already on the list is repeated.
   */
  const seen = new Set<string>([
    ...onList,
    ...named.map((name) => normalizeItemName(name)),
  ]);
  const suggestedItems: AIItem[] = [];
  const pushSuggestion = (item: AIItem) => {
    const key = normalizeItemName(item.name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    suggestedItems.push(item);
  };

  itemsFromHistory(request.history).forEach(pushSuggestion);
  itemsFromWeather(request.weather).forEach(pushSuggestion);
  if (match.understood) {
    for (const thing of match.suggestions) {
      pushSuggestion({ name: thing.name, emoji: thing.emoji, source: 'activity' });
    }
  }

  /* What the app may offer to do — proposals only. */
  const actions: AIAction[] = [];
  if (destination?.kind === 'new') {
    actions.push({ type: 'suggest_destination', destination });
  }
  const offerable = [...newItems, ...suggestedItems];
  if (offerable.length > 0) {
    actions.push({
      type: 'suggest_items',
      items: offerable,
      ...(destination?.kind === 'existing' ? { destinationId: destination.id } : {}),
    });
  }
  if (mode && destination?.kind === 'existing') {
    const current = request.destinations.find((d) => d.id === destination.id);
    if (current && current.travelMode !== mode) {
      actions.push({
        type: 'update_destination',
        destinationId: destination.id,
        changes: { travelMode: mode },
      });
    }
  }
  if (actions.length === 0) actions.push({ type: 'no_action' });

  /* What a fuller answer would have had, and honestly does not. */
  const unknown: AIUnknown[] = [];
  if (!destination) unknown.push('destination');
  if (named.length === 0) unknown.push('items');
  if (!mode) unknown.push('transportMode');
  if (!when) unknown.push('when');
  if (!request.weather) unknown.push('weather');
  if (!request.history || request.history.tripsAnalysed === 0) unknown.push('history');

  const understood = confidence >= MIN_CONFIDENCE;

  return {
    understood,
    intent: understood ? 'prepare_departure' : 'unknown',
    text,
    confidence,
    explanation: understood
      ? explain({
          activityLabel: activity?.label ?? null,
          destination,
          named,
          mode,
          whenPhrase: when?.phrase ?? null,
        })
      : 'לא הצלחתי להבין למה התכוונת',
    destination,
    activity,
    newItems,
    existingItems,
    suggestedItems,
    transportMode: mode,
    when: when ? { at: when.at, phrase: when.phrase, precision: when.precision } : null,
    actions: understood
      ? actions
      : [{ type: 'ask_clarification', question: 'לאן אתה יוצא, ומה חשוב לקחת?' }],
    unknown,
    meta: { provider: providerId, fellBack: false },
  };
}

export const localProvider: AIProvider = {
  id: LOCAL_PROVIDER_ID,
  label: 'ניתוח מקומי במכשיר',
  // Always. It is the floor everything else falls back to.
  isConfigured: () => true,
  analyze: async (request) => analyzeLocally(request),
};

/** Re-exported so the provider layer reports the same threshold as the engine. */
export { CONFIDENCE_THRESHOLD };
