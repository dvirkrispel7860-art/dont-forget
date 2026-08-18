import { Animated, Platform } from 'react-native';

/** The JS animation driver is the only one available on web. */
export const useNative = Platform.OS !== 'web';

/**
 * Starts an animation and guarantees its end state is applied.
 *
 * Animated's JS driver runs on requestAnimationFrame, which browsers freeze
 * while a tab or an embedded webview is hidden or throttled. Without a safety
 * net an entrance animation can stay stuck at its starting value — which for a
 * fade-in means invisible content, i.e. a blank screen. Timers keep firing in
 * that state, so we use one to snap to the final value if the animation has not
 * gotten there on its own.
 *
 * Returns a cleanup function for useEffect.
 */
export function runSafely(
  animation: Animated.CompositeAnimation,
  value: Animated.Value,
  finalValue: number,
  guardMs: number,
): () => void {
  let settled = false;
  animation.start(() => {
    settled = true;
  });

  const guard = setTimeout(() => {
    if (!settled) value.setValue(finalValue);
  }, guardMs);

  return () => {
    clearTimeout(guard);
    animation.stop();
  };
}
