import { Platform } from 'react-native';
import { transit } from './transit';
import { Destination, Reminder } from './types';

/**
 * Departure reminders, delivered locally.
 *
 * No external notification service, no push server, no API key. On web the
 * browser's own Notification API is used, and the service worker we already
 * ship displays the notification and handles the click.
 *
 * Honest limitation: a locally scheduled reminder can only fire while the app is
 * running (a tab open, or the installed PWA open). Real background delivery
 * needs either Web Push (a server) or a native build with expo-notifications.
 * `NotificationChannel` below is the seam for that.
 */

export type PermissionState = 'unsupported' | 'default' | 'granted' | 'denied';

/** What a reminder says. */
export type NotificationContent = {
  title: string;
  body: string;
  /** In-app route to open when the notification is tapped. */
  url: string;
  /** Collapses repeats of the same reminder. */
  tag: string;
};

/* ------------------------------------------------------------- permission --- */

export function permissionState(): PermissionState {
  if (Platform.OS !== 'web') return 'unsupported';
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported';
  }
  const current = Notification.permission;
  if (current === 'granted' || current === 'denied') return current;
  return 'default';
}

export async function requestPermission(): Promise<PermissionState> {
  if (permissionState() === 'unsupported') return 'unsupported';
  try {
    const result = await Notification.requestPermission();
    if (result === 'granted' || result === 'denied') return result;
    return 'default';
  } catch {
    return permissionState();
  }
}

/* ----------------------------------------------------------------- timing --- */

export const DAY_LABELS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

export function isEveryDay(days: number[]): boolean {
  return days.length === 7;
}

export function reminderDaysLabel(days: number[]): string {
  if (days.length === 0) return 'לא נבחרו ימים';
  if (isEveryDay(days)) return 'כל יום';
  return [...days]
    .sort((a, b) => a - b)
    .map((day) => DAY_LABELS[day])
    .join(', ');
}

export function parseTime(time: string): { hour: number; minute: number } {
  const [hour, minute] = time.split(':');
  return { hour: Number(hour) || 0, minute: Number(minute) || 0 };
}

export function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Is this reminder due at `now` (same weekday, same minute)? */
export function isDueNow(reminder: Reminder, now: Date): boolean {
  if (!reminder.enabled || reminder.days.length === 0) return false;
  if (!reminder.days.includes(now.getDay())) return false;
  const { hour, minute } = parseTime(reminder.time);
  return now.getHours() === hour && now.getMinutes() === minute;
}

/** The next time this reminder will fire, or null when it never will. */
export function nextOccurrence(reminder: Reminder, now: Date): Date | null {
  if (!reminder.enabled || reminder.days.length === 0) return null;
  const { hour, minute } = parseTime(reminder.time);

  for (let offset = 0; offset < 8; offset += 1) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + offset);
    candidate.setHours(hour, minute, 0, 0);
    if (candidate > now && reminder.days.includes(candidate.getDay())) return candidate;
  }
  return null;
}

/** Identifies one specific firing, so it is not delivered twice. */
export function occurrenceKey(destinationId: string, now: Date): string {
  return `${destinationId}:${now.toDateString()}:${now.getHours()}:${now.getMinutes()}`;
}

/* ---------------------------------------------------------------- content --- */

/**
 * The one place that decides what a reminder says.
 *
 * Future smarter triggers plug in here without touching delivery or scheduling:
 * travel time from Waze ("צא עוד 10 דקות"), history-based nudges, items the user
 * tends to forget, or something driven by the AI area. Each would add its own
 * builder returning this same shape.
 */
export function reminderContent(destination: Destination): NotificationContent {
  return {
    title: '🔔 מתכוננים לצאת?',
    body: `יש לך יציאה ל"${destination.name}" בקרוב. כדאי לבדוק את רשימת הדברים שלך.`,
    url: `/destination/${destination.id}/check`,
    tag: `reminder:${destination.id}`,
  };
}

/**
 * Adds the real bus journey to a reminder when the destination travels by bus.
 *
 * Only ever uses what the timetable returns — if the lookup finds nothing or
 * fails, the generic message is sent rather than an invented one.
 */
export async function buildReminder(
  destination: Destination,
): Promise<NotificationContent> {
  const base = reminderContent(destination);

  const plan = destination.transit;
  if (
    destination.travelMode !== 'bus' ||
    !plan?.originStop ||
    !plan?.destinationStop
  ) {
    return base;
  }

  try {
    const [hh, mm] = (plan.arriveBy ?? '08:00').split(':');
    const arriveBy = new Date();
    arriveBy.setHours(Number(hh) || 0, Number(mm) || 0, 0, 0);

    const options = await transit.getTransitOptions({
      originCode: plan.originStop.code,
      destinationCode: plan.destinationStop.code,
      arriveBy,
      limit: 1,
    });

    const best = options[0];
    if (!best) return base;

    const departure = new Date(best.departure).toLocaleTimeString('he-IL', {
      hour: '2-digit',
      minute: '2-digit',
    });

    return {
      ...base,
      title: '🚌 מתכוננים לצאת?',
      body:
        `קו ${best.lineNumber} יוצא מ"${best.boardStopName}" ב-${departure} ` +
        `ל"${destination.name}". כדאי לבדוק את רשימת הדברים שלך.`,
    };
  } catch {
    return base;
  }
}

/* --------------------------------------------------------------- delivery --- */

export type NotificationChannel = {
  deliver: (content: NotificationContent) => Promise<boolean>;
};

/**
 * Web delivery. Prefers the service worker so the notification still appears
 * when the tab is in the background, and so tapping it can focus/open the app
 * at the right destination (see the notificationclick handler in public/sw.js).
 */
export const webChannel: NotificationChannel = {
  deliver: async (content) => {
    if (permissionState() !== 'granted') return false;

    try {
      const registration = await navigator.serviceWorker?.getRegistration?.();
      if (registration?.showNotification) {
        await registration.showNotification(content.title, {
          body: content.body,
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag: content.tag,
          data: { url: content.url },
        });
        return true;
      }

      // No service worker (e.g. the dev server): fall back to a page notification.
      const notification = new Notification(content.title, {
        body: content.body,
        icon: '/icons/icon-192.png',
        tag: content.tag,
      });
      notification.onclick = () => {
        window.focus();
        window.location.assign(content.url);
      };
      return true;
    } catch {
      return false;
    }
  },
};

/** Chosen per platform. Native builds would supply an expo-notifications channel. */
export const notificationChannel: NotificationChannel | null =
  Platform.OS === 'web' ? webChannel : null;
