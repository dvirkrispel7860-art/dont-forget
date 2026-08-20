/**
 * When the user says they are leaving — read locally, out of the sentence they
 * already typed or spoke.
 *
 * A small, explicit parser: no model, no service, no cleverness. It understands
 * the handful of ways people actually say it in Hebrew, and when it is not sure
 * it returns null instead of inventing a departure time. The caller then shows a
 * plan with no time, which is honest — a wrong time would send someone out the
 * door at the wrong hour.
 *
 * Anything the parser resolves is shown back with a clock ("מחר ב-08:00",
 * "בערב (19:00)") so the reading is always visible, never assumed.
 */

export type ParsedTime = {
  /** Epoch millis. */
  at: number;
  /** What was understood, phrased for the user, with the clock time in it. */
  phrase: string;
  /**
   * 'exact' — the sentence named a time ("עוד שעה", "מחר ב-8").
   * 'approx' — the sentence named a part of the day ("בערב"), so the hour below
   * is this app's reading of it and is disclosed as such.
   */
  precision: 'exact' | 'approx';
};

/** Word forms for small numbers, so "עוד שלוש שעות" works like "עוד 3 שעות". */
const NUMBER_WORDS: Record<string, number> = {
  שתי: 2,
  שני: 2,
  שלוש: 3,
  שלושה: 3,
  ארבע: 4,
  ארבעה: 4,
  חמש: 5,
  חמישה: 5,
  שש: 6,
  שישה: 6,
  שבע: 7,
  שבעה: 7,
  שמונה: 8,
  תשע: 9,
  תשעה: 9,
  עשר: 10,
  עשרה: 10,
};

/** Parts of the day, and the hour this app reads each one as. */
const DAY_PARTS: { pattern: RegExp; hour: number; label: string }[] = [
  { pattern: /בבוקר|בוקר/, hour: 8, label: 'בבוקר' },
  { pattern: /בצהריים|צהריים/, hour: 13, label: 'בצהריים' },
  { pattern: /אחר הצהריים|אחה"צ|אחהצ/, hour: 16, label: 'אחר הצהריים' },
  { pattern: /בערב|ערב/, hour: 19, label: 'בערב' },
  { pattern: /בלילה|לילה/, hour: 21, label: 'בלילה' },
];

/** Words that put an hour in the afternoon or evening. */
const PM_HINT = /בערב|ערב|בלילה|לילה|אחר הצהריים|אחה"צ|אחהצ|בצהריים|צהריים/;
const AM_HINT = /בבוקר|בוקר/;

/*
 * Hebrew letters are not "word characters" as far as JavaScript's \b is
 * concerned, so \b never fires next to them — "שעה\b" matches nothing at all.
 * Word edges are therefore spelled out: a space, the end of the string, or
 * punctuation.
 */
const AFTER = '(?:$|[\\s.,!?])';
const BEFORE = '(?:^|\\s)';

function normalize(text: string): string {
  return text
    .trim()
    // Hebrew maqaf and friends all mean "-" here ("מחר ב־8").
    .replace(/[־–—]/g, '-')
    .replace(/\s+/g, ' ');
}

/** Does the sentence contain this word as a word, not inside another one? */
function saysWord(text: string, word: string): boolean {
  return new RegExp(`${BEFORE}${word}${AFTER}`).test(text);
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

function minutesLabel(minutes: number): string {
  if (minutes === 60) return 'בעוד שעה';
  if (minutes === 120) return 'בעוד שעתיים';
  if (minutes % 60 === 0) return `בעוד ${minutes / 60} שעות`;
  if (minutes === 1) return 'בעוד דקה';
  return `בעוד ${minutes} דק׳`;
}

/** "עוד שעה", "בעוד 20 דקות", "עוד חצי שעה", "עוד שלוש שעות". */
function parseRelative(text: string, now: number): ParsedTime | null {
  if (!/(?:^|\s)(?:עוד|בעוד)\s/.test(text)) return null;

  const minutes = text.match(
    new RegExp(`(?:עוד|בעוד)\\s+(\\d{1,3})\\s*(?:דקות|דקה|דק['׳]?)${AFTER}`),
  );
  if (minutes) {
    const value = Number(minutes[1]);
    if (value > 0 && value <= 600) {
      return {
        at: now + value * 60_000,
        phrase: minutesLabel(value),
        precision: 'exact',
      };
    }
  }

  if (/(?:עוד|בעוד)\s+רבע\s+שעה/.test(text)) {
    return { at: now + 15 * 60_000, phrase: 'בעוד רבע שעה', precision: 'exact' };
  }
  if (/(?:עוד|בעוד)\s+חצי\s+שעה/.test(text)) {
    return { at: now + 30 * 60_000, phrase: 'בעוד חצי שעה', precision: 'exact' };
  }
  if (/(?:עוד|בעוד)\s+שעה\s+וחצי/.test(text)) {
    return { at: now + 90 * 60_000, phrase: 'בעוד שעה וחצי', precision: 'exact' };
  }
  if (/(?:עוד|בעוד)\s+שעתיים/.test(text)) {
    return { at: now + 120 * 60_000, phrase: 'בעוד שעתיים', precision: 'exact' };
  }

  const numeric = text.match(/(?:עוד|בעוד)\s+(\d{1,2})\s*שעות/);
  if (numeric) {
    const value = Number(numeric[1]);
    if (value > 0 && value <= 24) {
      return {
        at: now + value * 3600_000,
        phrase: minutesLabel(value * 60),
        precision: 'exact',
      };
    }
  }

  const worded = text.match(/(?:עוד|בעוד)\s+([֐-׿]+)\s*שעות/);
  if (worded) {
    const value = NUMBER_WORDS[worded[1]];
    if (value) {
      return {
        at: now + value * 3600_000,
        phrase: minutesLabel(value * 60),
        precision: 'exact',
      };
    }
  }

  // A bare "עוד שעה" — checked last so "עוד שעתיים" and "עוד שעה וחצי" win first.
  if (new RegExp(`(?:עוד|בעוד)\\s+שעה${AFTER}`).test(text)) {
    return { at: now + 3600_000, phrase: 'בעוד שעה', precision: 'exact' };
  }

  return null;
}

/** Builds a timestamp for a wall-clock time today or tomorrow. */
function atClock(now: number, hour: number, minute: number, tomorrow: boolean): number {
  const date = new Date(now);
  if (tomorrow) date.setDate(date.getDate() + 1);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

/** "מחר ב-8", "היום ב-19:30", "ב-8:15". */
function parseClock(text: string, now: number): ParsedTime | null {
  const match = text.match(/(?:ב-?|בשעה\s*)(\d{1,2})(?::(\d{2}))?\b/);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (hour > 23 || minute > 59) return null;

  // "ב-8 בערב" is 20:00; "ב-8 בבוקר" is 08:00. Without a hint the hour is read
  // exactly as written, and the label shows what that came out as.
  if (hour <= 11 && PM_HINT.test(text) && !AM_HINT.test(text)) hour += 12;

  const saysTomorrow = saysWord(text, 'מחר');
  let at = atClock(now, hour, minute, saysTomorrow);

  // A time already gone means the next one — unless the sentence said today.
  if (!saysTomorrow && at < now - 5 * 60_000 && !saysWord(text, 'היום')) {
    at = atClock(now, hour, minute, true);
  }

  const isTomorrow = new Date(at).getDate() !== new Date(now).getDate();
  return {
    at,
    phrase: `${isTomorrow ? 'מחר' : 'היום'} ב-${clock(at)}`,
    precision: 'exact',
  };
}

/** "בערב", "מחר בבוקר" — understood, but only to the nearest part of the day. */
function parseDayPart(text: string, now: number): ParsedTime | null {
  const part = DAY_PARTS.find((candidate) => candidate.pattern.test(text));
  if (!part) return null;

  const saysTomorrow = saysWord(text, 'מחר');
  let at = atClock(now, part.hour, 0, saysTomorrow);
  if (!saysTomorrow && at < now - 5 * 60_000) at = atClock(now, part.hour, 0, true);

  const isTomorrow = new Date(at).getDate() !== new Date(now).getDate();
  return {
    at,
    phrase: `${isTomorrow ? 'מחר ' : ''}${part.label} (${clock(at)})`,
    precision: 'approx',
  };
}

/**
 * The departure time in a sentence, or null when the sentence does not carry one
 * clearly. "מחר" on its own is null on purpose: a day without an hour is not a
 * departure time, and picking one would be a guess.
 */
export function parseTimePhrase(text: string, now: number = Date.now()): ParsedTime | null {
  const normalized = normalize(text);
  if (!normalized) return null;

  if (/(?:^|\s)(?:עכשיו|מיד|כבר עכשיו)(?:$|\s|[.,!])/.test(normalized)) {
    return { at: now, phrase: 'עכשיו', precision: 'exact' };
  }

  return (
    parseRelative(normalized, now) ??
    parseClock(normalized, now) ??
    parseDayPart(normalized, now)
  );
}
