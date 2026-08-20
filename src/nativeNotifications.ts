import type { NotificationChannel } from './notifications';

/**
 * The native notification channel — web build.
 *
 * There is a sibling `nativeNotifications.native.ts` with the real
 * expo-notifications implementation, and the bundler picks that one for iOS and
 * Android. This file is what web resolves to, and it deliberately imports
 * nothing: expo-notifications never reaches the web bundle, and the browser path
 * stays exactly the code it always was.
 */
export const nativeNotifications: NotificationChannel | null = null;
