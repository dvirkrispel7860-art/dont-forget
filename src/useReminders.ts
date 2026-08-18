import { useEffect, useRef } from 'react';
import {
  buildReminder,
  isDueNow,
  notificationChannel,
  occurrenceKey,
  permissionState,
} from './notifications';
import { useStore } from './store';

/** How often due reminders are checked. */
const TICK_MS = 20_000;

/**
 * Runs the reminder clock for the whole app. Mounted once in the root layout.
 *
 * A short interval rather than long timers on purpose: timers drift badly when a
 * device sleeps, while a cheap minute-level check stays accurate.
 */
export function useReminders(): void {
  const { destinations, settings, hydrated } = useStore();
  // Occurrences already delivered, so one reminder is not sent twice.
  const delivered = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!hydrated) return;
    // Master switch off → nothing is ever sent.
    if (!settings.notifications) return;
    const channel = notificationChannel;
    if (!channel) return;
    if (permissionState() !== 'granted') return;

    const check = () => {
      const now = new Date();
      for (const destination of destinations) {
        const reminder = destination.reminder;
        if (!reminder || !isDueNow(reminder, now)) continue;

        const key = occurrenceKey(destination.id, now);
        if (delivered.current.has(key)) continue;
        delivered.current.add(key);

        // Bus destinations get the real next ride folded into the message.
        void buildReminder(destination).then((content) => channel.deliver(content));
      }

      // Keep the guard from growing without bound.
      if (delivered.current.size > 200) delivered.current.clear();
    };

    check();
    const id = setInterval(check, TICK_MS);
    return () => clearInterval(id);
  }, [destinations, settings.notifications, hydrated]);
}
