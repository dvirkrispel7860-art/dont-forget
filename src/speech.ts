/**
 * Seam for real Speech-to-Text.
 *
 * Nothing is connected yet, on purpose. The microphone button drives the
 * "מקשיב..." state through this interface, so wiring a real recogniser later
 * (expo-speech-recognition, the Web Speech API, a cloud STT service…) means
 * assigning `speechRecognizer` below — no UI changes.
 */

export type SpeechEvents = {
  /** Text so far, while the user is still speaking. */
  onPartial?: (text: string) => void;
  /** Final transcription. */
  onFinal: (text: string) => void;
  onError?: (message: string) => void;
};

export type SpeechRecognizer = {
  /** Whether this device/build can actually transcribe. */
  isAvailable: () => boolean;
  start: (events: SpeechEvents) => void;
  stop: () => void;
};

/**
 * null = no recogniser wired up. The mic still shows a listening state so the
 * flow can be seen end to end, but nothing is recorded or sent anywhere.
 */
export const speechRecognizer: SpeechRecognizer | null = null;

export function isSpeechAvailable(): boolean {
  return speechRecognizer !== null && speechRecognizer.isAvailable();
}
