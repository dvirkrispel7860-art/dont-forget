import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isSpeechAvailable,
  SPEECH_UNSUPPORTED_MESSAGE,
  startSpeechRecognition,
  stopSpeechRecognition,
} from './speech';

/**
 * Dictation for the AI composer.
 *
 * The text goes exactly where typed text goes — the same box, the same state —
 * so everything downstream (including `analyzeUserText`) sees no difference
 * between a sentence that was spoken and one that was typed.
 *
 * Cancelling keeps whatever was recognised so far and does not analyse it: the
 * user gets their words in the box and decides what to do with them.
 */
export type SpeechInput = {
  /** Whether this device can transcribe at all. */
  supported: boolean;
  listening: boolean;
  /** A message for the user, or null. Cleared on the next attempt. */
  notice: string | null;
  /** Tap the mic: starts, or stops if already listening. */
  toggle: () => void;
  stop: () => void;
};

export function useSpeechInput({
  onPartial,
  onFinal,
}: {
  /** Interim text, while the user is still speaking. */
  onPartial: (text: string) => void;
  /** A finished sentence — this is what gets analysed. */
  onFinal: (text: string) => void;
}): SpeechInput {
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const supported = isSpeechAvailable();

  // Latest callbacks, so a long recognition session never calls a stale closure.
  const partialRef = useRef(onPartial);
  const finalRef = useRef(onFinal);
  partialRef.current = onPartial;
  finalRef.current = onFinal;

  // Set while the user cancels, so a final result that arrives on the way out
  // still reaches the box but is not analysed.
  const cancelling = useRef(false);

  // Never leave the microphone open behind us.
  useEffect(() => () => stopSpeechRecognition(), []);

  const start = useCallback(() => {
    if (!supported) {
      setNotice(SPEECH_UNSUPPORTED_MESSAGE);
      return;
    }

    setNotice(null);
    cancelling.current = false;
    setListening(true);

    startSpeechRecognition({
      onPartial: (text) => partialRef.current(text),
      onFinal: (text) => {
        if (cancelling.current) {
          // Cancelled: keep the words, skip the analysis.
          partialRef.current(text);
          return;
        }
        finalRef.current(text);
      },
      onError: (message) => {
        if (message) setNotice(message);
      },
      onEnd: () => {
        setListening(false);
        cancelling.current = false;
      },
    });
  }, [supported]);

  const stop = useCallback(() => {
    cancelling.current = true;
    stopSpeechRecognition();
    setListening(false);
  }, []);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  return { supported, listening, notice, toggle, stop };
}
