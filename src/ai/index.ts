import { Analysis, AnalysisContext } from '../aiAnalysis';
import { analyzeLocally, localProvider } from './localProvider';
import { AINotConfiguredError, remoteProvider } from './remoteProvider';
import { buildAIRequest, AIContextSources } from './requestContext';
import {
  AIAnalysisResult,
  AIFallbackReason,
  AIProvider,
  AIRequest,
  MIN_CONFIDENCE,
} from './types';

/**
 * The one door into the AI area.
 *
 * Screens call `analyze` (or the older `analyzeUserText`) and never touch a
 * provider directly, which is what makes swapping the engine a change in this
 * file alone.
 *
 * The order is: the remote provider when it is genuinely configured, the local
 * one otherwise — and the local one again whenever the remote attempt cannot
 * produce something usable. The user is never shown an API error; they get a
 * real answer from the device instead, and the result says which provider
 * produced it.
 *
 * Nothing here stores the sentence or the answer. Both live for the length of the
 * call and the screen that displays them; nothing is written to storage.
 */

export * from './types';
export { buildAIRequest } from './requestContext';
export type { AIContextSources } from './requestContext';
export { itemsFromText } from './itemsFromText';
export { localProvider, analyzeLocally, LOCAL_PROVIDER_ID } from './localProvider';
export {
  remoteProvider,
  REMOTE_PROVIDER_ID,
  AINotConfiguredError,
  buildPayload,
  parseResponse,
} from './remoteProvider';

/**
 * The providers, in the order they are tried.
 *
 * The local one is last on purpose: it is the floor, and it always answers.
 */
export const providers: AIProvider[] = [remoteProvider, localProvider];

/** The provider that would answer right now — for the provenance line in the UI. */
export function activeProvider(): AIProvider {
  return providers.find((provider) => provider.isConfigured()) ?? localProvider;
}

/** True when a real model is wired up. False today, and the UI says so. */
export function isRemoteConfigured(): boolean {
  return remoteProvider.isConfigured();
}

/** Turns whatever went wrong into one of the few reasons worth distinguishing. */
function fallbackReason(error: unknown): AIFallbackReason {
  if (error instanceof AINotConfiguredError) return 'not-configured';

  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error ?? '');

  if (name === 'AbortError') return 'timeout';
  if (/network|failed to fetch|load failed|offline/i.test(message)) return 'offline';
  if (/nothing usable|responded \d+/i.test(message)) return 'bad-response';
  return 'failed';
}

/**
 * Understands a sentence, using the best provider that can.
 *
 * Never throws: a failure anywhere becomes a local answer with `meta.fellBack`
 * set. That is what keeps "no internet" from turning into an error dialog.
 */
export async function analyze(
  request: AIRequest,
  options?: { signal?: AbortSignal },
): Promise<AIAnalysisResult> {
  for (const provider of providers) {
    if (provider === localProvider) break;
    if (!provider.isConfigured()) continue;

    try {
      return await provider.analyze(request, options);
    } catch (error) {
      /*
       * Deliberately not logged. A failing endpoint can echo anything back,
       * including a credential, and console output is the easiest place for that
       * to end up. The reason travels in the result instead.
       */
      const reason = fallbackReason(error);
      const local = analyzeLocally(request);
      return { ...local, meta: { ...local.meta, fellBack: true, fallbackReason: reason } };
    }
  }

  /*
   * Nothing else was configured, so this is not a fallback — it is simply how the
   * app works today, and `fellBack` stays false so the UI does not apologise for
   * a state that is entirely normal.
   */
  return analyzeLocally(request);
}

/* ------------------------------------------------------- the older interface --- */

/**
 * The shape the screens already use, now produced through the provider layer.
 *
 * Kept so the AI area, the plan screen and the suggestion sheet keep working
 * unchanged while the richer result is adopted screen by screen. It is a
 * narrowing of `AIAnalysisResult`, not a second engine: same call, same
 * fallback, fewer fields.
 */
export async function analyzeUserText(
  text: string,
  context: AnalysisContext & Omit<AIContextSources, 'destinations'>,
): Promise<Analysis> {
  const result = await analyze(buildAIRequest(text, context));
  return toLegacyAnalysis(result);
}

/** The rich result, expressed in the older `Analysis` shape. */
export function toLegacyAnalysis(result: AIAnalysisResult): Analysis {
  if (!result.understood || !result.destination) {
    return { understood: false, text: result.text };
  }

  /*
   * The older shape has one flat list of things. Items the user named come
   * first — they are the ones they actually asked for — then what the sources
   * suggest.
   */
  const suggestions = [...result.newItems, ...result.suggestedItems].map((item) => ({
    emoji: item.emoji,
    name: item.name,
  }));

  return {
    understood: true,
    text: result.text,
    /*
     * The older shape requires an activity. When a provider recognised none but
     * the sentence still made sense — because the user named what to take — the
     * explanation stands in, so the UI shows what was understood rather than a
     * label that was invented for it.
     */
    activity: result.activity ?? {
      id: 'family',
      label: result.explanation,
      emoji: result.destination.icon,
    },
    destination: result.destination,
    suggestions,
    // The older field is the matcher's raw score; the UI only compares it, and
    // the 0…1 confidence orders identically.
    confidence: result.confidence,
  };
}

export { MIN_CONFIDENCE };
