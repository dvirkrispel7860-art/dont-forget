import { useEffect, useMemo, useRef } from 'react';
import {
  buildReminder,
  isDueNow,
  notificationChannel,
  notificationPermission,
  occurrenceKey,
  permissionState,
} from './notifications';
import { reconcileReminders, reminderSignature } from './notificationSchedule';
import { useStore } from './store';

/** How often due reminders are checked, on a channel that cannot schedule. */
const TICK_MS = 20_000;

/**
 * Runs the reminder clock for the whole app. Mounted once in the root layout.
 *
 * Which half runs depends on one thing — whether the platform's channel can hand
 * a schedule to the operating system:
 *
 *  - **native (`canSchedule`)** — it can. The reminders are registered with
 *    iOS/Android once, and again whenever they change, and then this hook does
 *    nothing at all. No interval, no wake-ups, and the reminder arrives with the
 *    app backgrounded or killed because the OS is holding it.
 *  - **web** — it cannot. The in-page clock below is unchanged: a cheap
 *    minute-level check, with the same honest limit it always had, since a
 *    browser has nowhere to leave a future notification without a push server.
 */
export function useReminders(): void {
  const { destinations, settings, hydrated } = useStore();
  // Occurrences already delivered, so one reminder is not sent twice.
  const delivered = useRef<Set<string>>(new Set());

  const canSchedule = notificationChannel?.canSchedule === true;

  /*
   * One string describing every reminder in the app. The reconcile runs when
   * this changes — which is exactly when a time, a day, a switch, a new
   * destination or a deleted one changes it — and not when something unrelated
   * to reminders does, like ticking an item off a list.
   */
  const reminderState = useMemo(
    () =>
      destinations
        .map((destination) => `${destination.id}=${reminderSignature(destination.reminder)}`)
        .join('|'),
    [destinations],
  );

  /* ------------------------------------------------- native: hand it to the OS */
  useEffect(() => {
    if (!hydrated || !canSchedule) return;

    let alive = true;
    void (async () => {
      // Refreshes the cached permission other screens read synchronously, then
      // brings the OS schedule in line with the data.
      await notificationPermission();
      if (!alive) return;
      await reconcileReminders({
        destinations,
        enabled: settings.notifications,
      });
    })();

    return () => {
      alive = false;
    };
    // destinations is covered by reminderState — see the note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reminderState, settings.notifications, hydrated, canSchedule]);

  /* ------------------------------------------------------- web: the in-page clock */
  useEffect(() => {
    if (!hydrated) return;
    // The OS is holding these; a second clock would deliver them twice.
    if (canSchedule) return;
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
  }, [destinations, settings.notifications, hydrated, canSchedule]);
}
