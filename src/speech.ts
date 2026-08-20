import { Platform } from 'react-native';

/**
 * Speech-to-Text, through whatever the platform itself can do.
 *
 * On web this is the browser's own Speech Recognition. The app records nothing,
 * keeps no audio, and sends nothing anywhere itself — it receives text from the
 * browser and puts it in the composer. (Be aware that a browser engine may do
 * its transcription in its vendor's cloud; that is the engine's behaviour, not
 * ours, and it is the same capability any site's dictation button uses.)
 *
 * On iOS/Android there is no Web Speech API, and nothing is faked: the recognizer
 * is simply absent, `isSpeechAvailable()` returns false, and the UI says so. A
 * native recogniser (expo-speech-recognition, a platform API) plugs in by
 * assigning `speechRecognizer` below — nothing else in the app changes.
 */

export type SpeechEvents = {
  /** Text so far, while the user is still speaking. */
  onPartial?: (text: string) => void;
  /** Final transcription. */
  onFinal: (text: string) => void;
  /** A message ready to show the user, or null when there is nothing to say. */
  onError?: (message: string | null) => void;
  /** Recognition ended, for any reason — including a normal finish. */
  onEnd?: () => void;
};

export type SpeechRecognizer = {
  /** Whether this device/build can actually transcribe. */
  isAvailable: () => boolean;
  start: (events: SpeechEvents) => void;
  stop: () => void;
};

/** What the UI shows when the device cannot transcribe at all. */
export const SPEECH_UNSUPPORTED_MESSAGE =
  '🎙️ זיהוי דיבור לא נתמך במכשיר הזה. אפשר להקליד במקום.';

/* ------------------------------------------------------ the browser engine --- */

/*
 * Minimal shapes for the browser API. React Native's TypeScript lib does not
 * describe it, and only these members are ever touched.
 */

type RecognitionAlternative = { transcript?: unknown };
type RecognitionResult = { isFinal?: boolean; 0?: RecognitionAlternative };
type RecognitionEvent = {
  results?: { length?: number; [index: number]: RecognitionResult };
};
type RecognitionErrorEvent = { error?: unknown };

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
};

type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/** The message for a browser error code, or null when it needs no words. */
function errorMessage(code: unknown): string | null {
  switch (code) {
    // The user stopped it themselves; nothing went wrong.
    case 'aborted':
      return null;
    case 'not-allowed':
    case 'service-not-allowed':
      return 'אין הרשאת מיקרופון. אפשר לאשר אותה בהגדרות הדפדפן, או להקליד במקום.';
    case 'no-speech':
      return 'לא זיהינו דיבור. אפשר לנסות שוב או להקליד.';
    case 'audio-capture':
      return 'לא נמצא מיקרופון במכשיר הזה. אפשר להקליד במקום.';
    case 'network':
      return 'זיהוי הדיבור דורש חיבור לאינטרנט.';
    default:
      return 'זיהוי הדיבור נכשל. אפשר להקליד במקום.';
  }
}

/** Joins the transcript, keeping track of whether the sentence is finished. */
function readTranscript(event: RecognitionEvent): { text: string; final: boolean } {
  const results = event.results;
  const length = typeof results?.length === 'number' ? results.length : 0;

  let text = '';
  let final = false;

  for (let i = 0; i < length; i += 1) {
    const result = results?.[i];
    const transcript = result?.[0]?.transcript;
    if (typeof transcript === 'string') text += transcript;
    if (result?.isFinal === true) final = true;
  }

  return { text: text.trim(), final };
}

/**
 * The web recogniser. Created per session and thrown away on stop, because a
 * reused instance keeps state from the previous sentence.
 */
function createWebRecognizer(): SpeechRecognizer {
  let active: Recognition | null = null;

  const release = () => {
    if (!active) return;
    active.onresult = null;
    active.onerror = null;
    active.onend = null;
    active = null;
  };

  return {
    isAvailable: () => recognitionConstructor() !== null,

    start(events) {
      const Constructor = recognitionConstructor();
      if (!Constructor) {
        events.onError?.(SPEECH_UNSUPPORTED_MESSAGE);
        events.onEnd?.();
        return;
      }

      // A second press should restart cleanly rather than stack listeners.
      if (active) this.stop();

      let recognition: Recognition;
      try {
        recognition = new Constructor();
      } catch {
        events.onError?.(errorMessage(undefined));
        events.onEnd?.();
        return;
      }

      recognition.lang = 'he-IL';
      // One sentence at a time: the composer wants a phrase, not a monologue.
      recognition.continuous = false;
      // Interim text lets the box fill in while the user is still talking.
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event) => {
        const { text, final } = readTranscript(event);
        if (!text) return;
        if (final) events.onFinal(text);
        else events.onPartial?.(text);
      };

      recognition.onerror = (event) => {
        events.onError?.(errorMessage(event?.error));
      };

      recognition.onend = () => {
        release();
        events.onEnd?.();
      };

      active = recognition;

      try {
        // This is what asks the browser for microphone permission, if needed.
        recognition.start();
      } catch {
        release();
        events.onError?.(errorMessage(undefined));
        events.onEnd?.();
      }
    },

    stop() {
      if (!active) return;
      const recognition = active;
      // Keep whatever was already recognised: stop() still delivers a final
      // result, unlike abort(), which throws the sentence away.
      try {
        recognition.stop();
      } catch {
        try {
          recognition.abort();
        } catch {
          /* the engine is already gone */
        }
        release();
      }
    },
  };
}

/**
 * The active recogniser, or null when this platform cannot transcribe.
 * Native builds are the null case today — see the note at the top of the file.
 */
export const speechRecognizer: SpeechRecognizer | null =
  Platform.OS === 'web' ? createWebRecognizer() : null;

/** A real check: is there an engine on this device that can transcribe? */
export function isSpeechAvailable(): boolean {
  return speechRecognizer !== null && speechRecognizer.isAvailable();
}

/** Begins listening. Safe to call when unsupported — it reports and stops. */
export function startSpeechRecognition(events: SpeechEvents): void {
  if (!speechRecognizer) {
    events.onError?.(SPEECH_UNSUPPORTED_MESSAGE);
    events.onEnd?.();
    return;
  }
  speechRecognizer.start(events);
}

/** Stops listening. Text already recognised is kept. */
export function stopSpeechRecognition(): void {
  speechRecognizer?.stop();
}
