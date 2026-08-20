/**
 * Items the user named out loud, and nothing else.
 *
 * "אני הולך לסבתא וצריך לקחת את התרופות והמטען" → תרופות, מטען.
 *
 * The whole design is built around not inventing. A word only becomes an item
 * when it follows a phrase that means "I am taking" — "לקחת", "לשכוח", "צריך",
 * "עם". No cue, no items: a sentence like "אני הולך לים" returns an empty list
 * rather than a guess at what someone brings to a beach. (Beach suggestions do
 * exist, but they come from the app's own activity list and are labelled as such,
 * which is a different and honest thing.)
 *
 * It is a small explicit parser, like timePhrase.ts — no model, no cleverness,
 * and it gives up rather than guessing.
 */

/** Phrases after which a list of things is expected. */
const CUES = [
  'אסור לי לשכוח',
  'אסור לשכוח',
  'לא לשכוח',
  'שלא אשכח',
  'לא רוצה לשכוח',
  'צריך לקחת',
  'צריכה לקחת',
  'חייב לקחת',
  'חייבת לקחת',
  'רוצה לקחת',
  'כדאי לקחת',
  'לקחת איתי',
  'לוקח איתי',
  'לוקחת איתי',
  'להביא איתי',
  'תזכיר לי לקחת',
  'תזכיר לי',
  'לשכוח',
  'לקחת',
  'לוקח',
  'לוקחת',
  'להביא',
  'מביא',
  'מביאה',
  'צריך',
  'צריכה',
  'עם',
];

/**
 * Words that are never the thing itself — grammar that survives the split.
 * Deliberately short: anything not listed here is kept, because dropping a real
 * item is worse than keeping an odd one the user can untick.
 */
const STOPWORDS = new Set([
  'את',
  'של',
  'לי',
  'גם',
  'עוד',
  'את ה',
  'איתי',
  'אותי',
  'הכל',
  'משהו',
  'דברים',
  'אני',
  'הוא',
  'היא',
  'זה',
  'וגם',
  'או',
  'כל',
]);

/** Words that end the list — what follows them is not a thing to take. */
const TERMINATORS = [
  'כי',
  'אבל',
  'בגלל',
  'כדי',
  'אחרי',
  'לפני',
  'בשעה',
  'מחר',
  'היום',
  'הערב',
  'בבוקר',
  'בצהריים',
  'בערב',
  'בלילה',
];

function tidy(text: string): string {
  return text.replace(/[^\p{L}\p{N}\s,]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Strips the conjunction and article a list item picks up: "והמטען" → "מטען".
 * Only the leading "ו" plus at most one more prefix — more than that starts
 * eating real words ("מחברת" must not become "חברת").
 */
function stripPrefixes(word: string): string {
  let out = word;
  if (out.length > 3 && out.startsWith('ו')) out = out.slice(1);
  if (out.length > 3 && out.startsWith('ה')) out = out.slice(1);
  return out;
}

/**
 * Drops the definite article, but only where the grammar guarantees there is
 * one — after "את", which forces a definite object: "את התרופות" → "תרופות".
 *
 * Without that guard a word that simply begins with ה would lose its first
 * letter ("המבורגר" → "מבורגר"), so the article is only removed when the
 * sentence structure says it is an article.
 */
function stripArticle(word: string): string {
  return word.length > 3 && word.startsWith('ה') ? word.slice(1) : word;
}

/** Where the list of things begins, or -1. The last cue wins: it is the closest. */
function cueEnd(sentence: string): number {
  let best = -1;
  for (const cue of CUES) {
    // Word-boundary-ish: the cue must start a word.
    const pattern = new RegExp(`(?:^|\\s)${cue}(?=\\s)`, 'g');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sentence)) !== null) {
      const end = match.index + match[0].length;
      if (end > best) best = end;
    }
  }
  return best;
}

/** Cuts the list short at the first word that clearly ends it. */
function untilTerminator(text: string): string {
  const words = text.split(' ');
  const stop = words.findIndex((word) => TERMINATORS.includes(stripPrefixes(word)));
  return stop === -1 ? text : words.slice(0, stop).join(' ');
}

/**
 * Splits "מחשבון, מחברת ובקבוק מים" into its three parts.
 *
 * Commas split, and so does a word starting with "ו" — but only when what is
 * left is long enough to be a word in its own right, so "ולנעליים" splits while
 * a genuine word beginning with vav does not get cut in half.
 */
function splitList(text: string): string[] {
  const parts: string[] = [];

  for (const chunk of text.split(',')) {
    let current: string[] = [];
    for (const word of chunk.trim().split(' ').filter(Boolean)) {
      const isConjunction = word.length > 3 && word.startsWith('ו');
      if (isConjunction && current.length > 0) {
        parts.push(current.join(' '));
        current = [stripPrefixes(word)];
        continue;
      }
      current.push(current.length === 0 ? stripPrefixes(word) : word);
    }
    if (current.length > 0) parts.push(current.join(' '));
  }

  return parts;
}

function clean(part: string): string | null {
  const raw = part
    .split(' ')
    .map((word) => word.trim())
    .filter((word) => word.length > 0);

  /*
   * "את" is dropped as grammar, but it is also the signal that the noun after it
   * is definite — so note it before it goes.
   */
  const definite = raw.includes('את');
  const words = raw.filter((word) => !STOPWORDS.has(word));
  if (words.length === 0) return null;

  if (definite) words[0] = stripArticle(words[0]);

  const name = words.join(' ').trim();
  // One letter is never a thing; a whole clause is never one either.
  if (name.length < 2 || words.length > 4) return null;
  return name;
}

/**
 * The things the sentence explicitly says to take, in the order they were said.
 * An empty array means the sentence named none — which is the common case.
 */
export function itemsFromText(text: string): string[] {
  const sentence = tidy(text);
  if (!sentence) return [];

  const start = cueEnd(sentence);
  if (start < 0) return [];

  const listText = untilTerminator(sentence.slice(start).trim());
  if (!listText) return [];

  const seen = new Set<string>();
  const names: string[] = [];

  for (const part of splitList(listText)) {
    const name = clean(part);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  // A "list" longer than this is almost certainly a misread sentence, not a
  // packing list. Better to offer nothing than a screen of noise.
  return names.length > 6 ? [] : names;
}
