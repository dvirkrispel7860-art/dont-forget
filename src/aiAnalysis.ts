import { Destination } from './types';

/**
 * The on-device matcher: free text in, an activity out. No network, no API key,
 * no service — everything below runs on the phone.
 *
 * This file is the *engine*, not the seam. The seam moved to `src/ai`, where a
 * provider layer decides who does the understanding and falls back to this when
 * nobody else can. `localAnalysis` below is what that layer calls, so the
 * keyword logic lives in exactly one place and is not duplicated anywhere.
 */

export type SuggestedThing = { emoji: string; name: string };

export type ActivityId =
  | 'beach'
  | 'school'
  | 'gym'
  | 'sport'
  | 'trip'
  | 'flight'
  | 'cinema'
  | 'shopping'
  | 'family'
  | 'friends';

export type Activity = { id: ActivityId; label: string; emoji: string };

/** Either an existing destination or a proposal to create one — never created automatically. */
export type DestinationTarget =
  | { kind: 'existing'; id: string; name: string; icon: string }
  | { kind: 'new'; name: string; icon: string };

export type Analysis =
  | { understood: false; text: string }
  | {
      understood: true;
      text: string;
      activity: Activity;
      destination: DestinationTarget;
      suggestions: SuggestedThing[];
      /** Matcher score; higher means a clearer signal. */
      confidence: number;
    };

export type AnalysisContext = { destinations: Destination[] };

/* --------------------------------------------------------------- keywords --- */

type Keyword = { word: string; weight: number };

type Category = {
  id: ActivityId;
  label: string;
  emoji: string;
  /** Name and icon proposed when no matching destination exists yet. */
  destinationName: string;
  /**
   * weight 3 = names the place or activity outright ("ים", "כדורגל")
   * weight 2 = strong hint that needs no other word ("שיעור", "חברים")
   * weight 1 = weak on its own; only helps break a tie
   */
  keywords: Keyword[];
  suggestions: SuggestedThing[];
};

const CATEGORIES: Category[] = [
  {
    id: 'beach',
    label: 'ים / חוף',
    emoji: '🏖️',
    destinationName: 'ים',
    keywords: [
      { word: 'ים', weight: 3 },
      { word: 'חוף', weight: 3 },
      { word: 'בריכה', weight: 3 },
      { word: 'שנורקל', weight: 3 },
      { word: 'שחייה', weight: 2 },
      { word: 'שחיה', weight: 2 },
      { word: 'גלים', weight: 2 },
      { word: 'מציל', weight: 1 },
    ],
    suggestions: [
      { emoji: '💧', name: 'מים' },
      { emoji: '🧴', name: 'קרם הגנה' },
      { emoji: '🧺', name: 'מגבת' },
      { emoji: '🕶️', name: 'משקפי שמש' },
      { emoji: '🧢', name: 'כובע' },
    ],
  },
  {
    id: 'school',
    label: 'בית ספר',
    emoji: '🏫',
    destinationName: 'בית ספר',
    keywords: [
      { word: 'בית ספר', weight: 3 },
      { word: 'ביתספר', weight: 3 },
      { word: 'לימודים', weight: 3 },
      { word: 'תיכון', weight: 3 },
      { word: 'יסודי', weight: 3 },
      { word: 'אוניברסיטה', weight: 3 },
      { word: 'מכללה', weight: 3 },
      { word: 'שיעור', weight: 2 },
      { word: 'מבחן', weight: 2 },
      { word: 'כיתה', weight: 2 },
      { word: 'הרצאה', weight: 2 },
      { word: 'סטודנט', weight: 2 },
      { word: 'מורה', weight: 1 },
    ],
    suggestions: [
      { emoji: '🎒', name: 'תיק' },
      { emoji: '✏️', name: 'קלמר' },
      { emoji: '📓', name: 'מחברות' },
      { emoji: '💧', name: 'בקבוק מים' },
    ],
  },
  {
    id: 'gym',
    label: 'חדר כושר',
    emoji: '🏋️',
    destinationName: 'חדר כושר',
    keywords: [
      { word: 'חדר כושר', weight: 3 },
      { word: 'כושר', weight: 3 },
      { word: 'משקולות', weight: 3 },
      { word: 'ספינינג', weight: 3 },
      { word: 'פילאטיס', weight: 3 },
      { word: 'יוגה', weight: 3 },
      { word: 'חוגים', weight: 1 },
    ],
    suggestions: [
      { emoji: '💧', name: 'בקבוק מים' },
      { emoji: '👕', name: 'בגדי ספורט' },
      { emoji: '👟', name: 'נעלי ספורט' },
      { emoji: '🧺', name: 'מגבת' },
    ],
  },
  {
    id: 'sport',
    label: 'ספורט / כדורגל',
    emoji: '⚽',
    destinationName: 'אימון',
    keywords: [
      { word: 'כדורגל', weight: 3 },
      { word: 'כדורסל', weight: 3 },
      { word: 'כדורעף', weight: 3 },
      { word: 'טניס', weight: 3 },
      { word: 'ספורט', weight: 3 },
      { word: 'קטרגל', weight: 3 },
      { word: 'אימון', weight: 2 },
      { word: 'מגרש', weight: 2 },
      { word: 'ריצה', weight: 2 },
      { word: 'אצטדיון', weight: 2 },
      { word: 'משחק', weight: 1 },
      { word: 'קבוצה', weight: 1 },
    ],
    suggestions: [
      { emoji: '💧', name: 'בקבוק מים' },
      { emoji: '👕', name: 'בגדי ספורט' },
      { emoji: '👟', name: 'נעלי ספורט' },
      { emoji: '🧺', name: 'מגבת' },
    ],
  },
  {
    id: 'trip',
    label: 'טיול / קמפינג',
    emoji: '🏕️',
    destinationName: 'טיול',
    keywords: [
      { word: 'טיול', weight: 3 },
      { word: 'מטייל', weight: 3 },
      { word: 'קמפינג', weight: 3 },
      { word: 'אוהל', weight: 3 },
      { word: 'מסלול', weight: 2 },
      { word: 'טבע', weight: 2 },
      { word: 'שביל', weight: 2 },
      { word: 'פיקניק', weight: 2 },
      { word: 'הליכה', weight: 1 },
    ],
    suggestions: [
      { emoji: '💧', name: 'מים' },
      { emoji: '🥪', name: 'אוכל' },
      { emoji: '🧢', name: 'כובע' },
      { emoji: '🎒', name: 'תיק' },
      { emoji: '🔌', name: 'מטען' },
    ],
  },
  {
    id: 'flight',
    label: 'טיסה / שדה תעופה',
    emoji: '✈️',
    destinationName: 'שדה תעופה',
    keywords: [
      { word: 'טיסה', weight: 3 },
      { word: 'שדה תעופה', weight: 3 },
      { word: 'נמל תעופה', weight: 3 },
      { word: 'מטוס', weight: 3 },
      { word: 'דרכון', weight: 3 },
      { word: 'נתבג', weight: 3 },
      { word: 'טס', weight: 2 },
      { word: 'צק אין', weight: 2 },
      { word: 'מזוודה', weight: 2 },
    ],
    suggestions: [
      { emoji: '🛂', name: 'דרכון' },
      { emoji: '🎫', name: 'כרטיס טיסה' },
      { emoji: '🧳', name: 'מזוודה' },
      { emoji: '🔌', name: 'מטען נייד' },
      { emoji: '🎧', name: 'אוזניות' },
    ],
  },
  {
    id: 'cinema',
    label: 'קולנוע',
    emoji: '🎬',
    destinationName: 'קולנוע',
    keywords: [
      { word: 'קולנוע', weight: 3 },
      { word: 'סינמה', weight: 3 },
      { word: 'סרט', weight: 3 },
      { word: 'הקרנה', weight: 2 },
      { word: 'פופקורן', weight: 2 },
    ],
    suggestions: [
      { emoji: '🎫', name: 'כרטיסים' },
      { emoji: '👛', name: 'ארנק' },
      { emoji: '🧥', name: 'קפוצ׳ון' },
      { emoji: '📱', name: 'טלפון' },
    ],
  },
  {
    id: 'shopping',
    label: 'קניות',
    emoji: '🛒',
    destinationName: 'קניות',
    keywords: [
      { word: 'קניות', weight: 3 },
      { word: 'סופר', weight: 3 },
      { word: 'סופרמרקט', weight: 3 },
      { word: 'מכולת', weight: 3 },
      { word: 'שופינג', weight: 3 },
      { word: 'קניון', weight: 3 },
      { word: 'מרכול', weight: 3 },
      { word: 'לקנות', weight: 2 },
      { word: 'קונה', weight: 2 },
    ],
    suggestions: [
      { emoji: '👛', name: 'ארנק' },
      { emoji: '🛍️', name: 'שקיות רב-פעמיות' },
      { emoji: '📝', name: 'רשימת קניות' },
    ],
  },
  {
    id: 'family',
    label: 'משפחה / ביקור',
    emoji: '👨‍👩‍👦',
    destinationName: 'משפחה',
    keywords: [
      { word: 'משפחה', weight: 3 },
      { word: 'סבתא', weight: 3 },
      { word: 'סבא', weight: 3 },
      { word: 'הורים', weight: 3 },
      { word: 'ביקור', weight: 2 },
      { word: 'דודה', weight: 2 },
      { word: 'דוד', weight: 2 },
      { word: 'אחים', weight: 2 },
    ],
    suggestions: [
      { emoji: '🎁', name: 'מתנה' },
      { emoji: '👛', name: 'ארנק' },
      { emoji: '📱', name: 'טלפון' },
    ],
  },
  {
    id: 'friends',
    label: 'חברים / משחקים',
    emoji: '🎮',
    destinationName: 'חבר',
    keywords: [
      { word: 'פלייסטיישן', weight: 3 },
      { word: 'גיימינג', weight: 3 },
      { word: 'ערב משחקים', weight: 3 },
      { word: 'חבר', weight: 2 },
      { word: 'חברים', weight: 2 },
      { word: 'חברה', weight: 2 },
      { word: 'משחקים', weight: 2 },
      { word: 'מסיבה', weight: 2 },
    ],
    suggestions: [
      { emoji: '👛', name: 'ארנק' },
      { emoji: '📱', name: 'טלפון' },
      { emoji: '🔌', name: 'מטען' },
      { emoji: '🥨', name: 'חטיפים' },
    ],
  },
];

/** Below this score the text is treated as not understood rather than guessed. */
const CONFIDENCE_THRESHOLD = 2;

/* --------------------------------------------------------------- matching --- */

/** Hebrew one-letter prefixes: "לים" → "ים", "בסופר" → "סופר". */
const PREFIXES = ['ל', 'ב', 'כ', 'מ', 'ש', 'ה', 'ו'];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** The prefix-stripped form of a token, or null when there is nothing to strip. */
function withoutPrefix(token: string): string | null {
  if (token.length < 3) return null;
  return PREFIXES.includes(token[0]) ? token.slice(1) : null;
}

function levenshteinAtMostOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length === b.length) {
      i += 1;
      j += 1;
    } else if (a.length > b.length) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Does a single-word keyword match one of the sentence's tokens? */
function wordMatches(keyword: string, forms: string[]): boolean {
  for (const form of forms) {
    if (form === keyword) return true;
    // Suffixed forms: "אימונים" for "אימון", "ספורטיבי" for "ספורט".
    // Both sides need length so short words like "ים" only match exactly —
    // otherwise the plural ending of "חברים" would look like the word "ים".
    if (keyword.length >= 3 && form.length > keyword.length && form.startsWith(keyword)) {
      return true;
    }
    if (form.length >= 3 && keyword.length > form.length && keyword.startsWith(form)) {
      return true;
    }
    // Tolerate a single typo, but only on words long enough to be unambiguous.
    if (form.length >= 4 && keyword.length >= 4 && levenshteinAtMostOne(form, keyword)) {
      return true;
    }
  }
  return false;
}

type ScoredCategory = {
  category: Category;
  score: number;
  strongest: number;
  matched: string[];
};

function scoreText(text: string): ScoredCategory[] {
  const sentence = normalize(text);
  if (!sentence) return [];

  const tokens = sentence.split(' ');
  // Keep both forms: stripping helps "לים", but would break "משקולות".
  const forms = tokens.map(
    (token) => [token, withoutPrefix(token)].filter(Boolean) as string[],
  );
  const strippedSentence = tokens.map((token) => withoutPrefix(token) ?? token).join(' ');

  return CATEGORIES.map((category) => {
    const phraseKeywords = category.keywords.filter((k) => k.word.includes(' '));
    const wordKeywords = category.keywords.filter((k) => !k.word.includes(' '));

    let score = 0;
    let strongest = 0;
    const matched: string[] = [];

    for (const keyword of phraseKeywords) {
      if (sentence.includes(keyword.word) || strippedSentence.includes(keyword.word)) {
        score += keyword.weight;
        strongest = Math.max(strongest, keyword.weight);
        matched.push(keyword.word);
      }
    }

    /*
     * Each word of the sentence contributes once, at its best weight. Without
     * this, overlapping synonyms stack: "חברים" would match both "חבר" and
     * "חברים" and outscore the actual destination in "לים עם חברים".
     */
    const tokensUsedByPhrase = new Set<string>();
    for (const phrase of matched) {
      for (const part of phrase.split(' ')) tokensUsedByPhrase.add(part);
    }

    forms.forEach((tokenForms) => {
      if (tokenForms.some((form) => tokensUsedByPhrase.has(form))) return;

      let best: Keyword | null = null;
      for (const keyword of wordKeywords) {
        if (!wordMatches(keyword.word, tokenForms)) continue;
        if (!best || keyword.weight > best.weight) best = keyword;
      }
      if (best) {
        score += best.weight;
        strongest = Math.max(strongest, best.weight);
        matched.push(best.word);
      }
    });

    return { category, score, strongest, matched };
  }).sort((a, b) => b.score - a.score || b.strongest - a.strongest);
}

/**
 * Picks the destination to use: an existing one whose name matches the detected
 * activity, otherwise a proposal to create one. Never creates anything.
 */
function pickDestination(category: Category, destinations: Destination[]): DestinationTarget {
  let best: { destination: Destination; score: number } | null = null;

  for (const destination of destinations) {
    const scored = scoreText(destination.name).find(
      (entry) => entry.category.id === category.id,
    );
    if (scored && scored.score > 0 && (!best || scored.score > best.score)) {
      best = { destination, score: scored.score };
    }
  }

  if (best) {
    return {
      kind: 'existing',
      id: best.destination.id,
      name: best.destination.name,
      icon: best.destination.icon,
    };
  }

  return { kind: 'new', name: category.destinationName, icon: category.emoji };
}

/* ------------------------------------------------------------- the matcher --- */

/** The strongest raw score a sentence can realistically reach. */
export const MAX_MATCH_SCORE = 6;

/** The threshold, exported so the provider layer reports the same verdict. */
export { CONFIDENCE_THRESHOLD };

/**
 * What the keyword engine makes of a sentence. Synchronous and pure — the
 * provider layer wraps it in the async contract, so this stays a plain function
 * that is trivial to test.
 *
 * Returns `understood: false` rather than guessing whenever the signal is weak.
 */
export function localAnalysis(text: string, context: AnalysisContext): Analysis {
  const trimmed = text.trim();
  if (!trimmed) return { understood: false, text: trimmed };

  const [best] = scoreText(trimmed);

  // Don't guess when the signal is weak — the UI says so instead.
  if (!best || best.score < CONFIDENCE_THRESHOLD) {
    return { understood: false, text: trimmed };
  }

  return {
    understood: true,
    text: trimmed,
    activity: {
      id: best.category.id,
      label: best.category.label,
      emoji: best.category.emoji,
    },
    destination: pickDestination(best.category, context.destinations),
    suggestions: best.category.suggestions,
    confidence: best.score,
  };
}
