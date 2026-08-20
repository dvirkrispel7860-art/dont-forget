import { Platform } from 'react-native';
import { nativeNotifications } from './nativeNotifications';
import { transit } from './transit';
import { Destination, Reminder } from './types';

/**
 * Departure reminders, delivered locally. No push server, no API key.
 *
 * One system, two channels behind the same `NotificationChannel` seam:
 *
 *   - **web** — the browser's Notification API, displayed through the service
 *     worker we already ship (which also handles the tap). It can only fire while
 *     the app is running: a tab open, or the installed PWA open. That limit is
 *     the browser's, and the UI says so rather than pretending otherwise.
 *   - **native** — `expo-notifications`, which hands the schedule to the
 *     operating system. Those arrive with the app backgrounded or killed,
 *     because iOS/Android hold them, not us.
 *
 * `canSchedule` is what tells the two apart, and it is the only thing callers
 * need to branch on: a channel that can schedule gets the timetable handed over
 * once (see notificationSchedule.ts); one that cannot is driven by the in-page
 * clock in useReminders.ts.
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

/** When a scheduled notification should fire. */
export type NotificationTrigger =
  /** Once, at a moment. */
  | { kind: 'date'; at: number }
  /** Every week on this weekday (0 = Sunday, matching `Reminder.days`). */
  | { kind: 'weekly'; day: number; hour: number; minute: number }
  /** After a number of seconds — used only by the internal build check. */
  | { kind: 'seconds'; seconds: number };

export type ScheduleRequest = {
  /**
   * A deterministic id, so the app can recognise its own scheduled work after a
   * restart and cancel or replace it instead of piling up duplicates.
   */
  id: string;
  content: NotificationContent;
  trigger: NotificationTrigger;
};

/* ------------------------------------------------------------- permission --- */

/** The browser's answer, read synchronously. Web only. */
function webPermission(): PermissionState {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported';
  }
  const current = Notification.permission;
  if (current === 'granted' || current === 'denied') return current;
  return 'default';
}

/**
 * The native permission last read, so `permissionState()` can stay synchronous
 * for the callers that need it in a render or a tick. Refreshed by
 * `notificationPermission()`, which useReminders and the settings screen call on
 * startup. Before the first read it says 'default' — "not asked yet" — never
 * 'unsupported', which would be a lie on a platform that supports this fully.
 */
let lastNativePermission: PermissionState = 'default';

/**
 * The permission as it is known right now, without prompting and without
 * awaiting. On web this is exact; on native it is the value from the most recent
 * `notificationPermission()`. Prefer that async one when accuracy matters.
 */
export function permissionState(): PermissionState {
  if (Platform.OS === 'web') return webPermission();
  return nativeNotifications ? lastNativePermission : 'unsupported';
}

/** The real permission, asked of the platform. Never prompts. */
export async function notificationPermission(): Promise<PermissionState> {
  const channel = notificationChannel;
  if (!channel) return 'unsupported';
  const state = await channel.permission();
  if (Platform.OS !== 'web') lastNativePermission = state;
  return state;
}

/**
 * Asks for the permission, prompting where the platform allows it. Tie this to a
 * user action — both platforms expect the prompt to follow a tap.
 */
export async function requestPermission(): Promise<PermissionState> {
  const channel = notificationChannel;
  if (!channel) return 'unsupported';
  const state = await channel.request();
  if (Platform.OS !== 'web') lastNativePermission = state;
  return state;
}

/**
 * Sends the user to the OS notification settings. Only a phone has such a place;
 * on web the permission lives in the browser's own site settings, which the app
 * cannot open, so this reports false and the UI explains the manual route.
 */
export function canOpenNotificationSettings(): boolean {
  return notificationChannel?.openSettings != null;
}

export async function openNotificationSettings(): Promise<boolean> {
  const open = notificationChannel?.openSettings;
  return open ? open() : false;
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
 * "צא עכשיו" for a bus departure — the builder the leave-time reminder uses.
 *
 * This is the seam described above, filled in: a second builder returning the
 * same `NotificationContent`, so scheduling and delivery are untouched. Every
 * value in the sentence is handed in by the caller from the timetable option it
 * is already showing — this function looks nothing up and rounds nothing off.
 */
export function leaveNowContent(
  destination: Destination,
  ride: {
    lineNumber: string;
    stopName: string;
    /** The bus's departure, epoch millis, as the timetable gives it. */
    departureAt: number;
    /** Walking minutes to the stop, as shown on the card. */
    walkMinutes: number;
  },
): NotificationContent {
  const departure = new Date(ride.departureAt).toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return {
    title: '🚀 זמן לצאת',
    body:
      `קו ${ride.lineNumber} יוצא מ"${ride.stopName}" ב-${departure} ` +
      `ל"${destination.name}" — כ-${ride.walkMinutes} דק׳ הליכה מכאן.`,
    url: `/destination/${destination.id}/check`,
    // Its own tag, so it never collapses onto the daily "מתכוננים לצאת" reminder.
    tag: `leave:${destination.id}`,
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
  /** Shows a notification now. */
  deliver: (content: NotificationContent) => Promise<boolean>;
  /** Reads the permission. Never prompts. */
  permission: () => Promise<PermissionState>;
  /** Asks for the permission, prompting where the platform allows it. */
  request: () => Promise<PermissionState>;
  /**
   * True when the operating system will hold a schedule for us — and therefore
   * when a reminder arrives with the app backgrounded or killed. False means the
   * app itself has to be running at the moment, which is what the in-page clock
   * in useReminders.ts is for.
   */
  canSchedule: boolean;
  /** Hands one notification to the OS. Returns its id, or null if it failed. */
  schedule?: (request: ScheduleRequest) => Promise<string | null>;
  cancel?: (id: string) => Promise<void>;
  /** Ids of everything this app currently has scheduled with the OS. */
  scheduled?: () => Promise<string[]>;
  /** Opens the OS notification settings for this app, where there are any. */
  openSettings?: () => Promise<boolean>;
};

/**
 * Web delivery. Prefers the service worker so the notification still appears
 * when the tab is in the background, and so tapping it can focus/open the app
 * at the right destination (see the notificationclick handler in public/sw.js).
 *
 * No `schedule`: a browser has nowhere to leave a future notification without a
 * push server, so `canSchedule` is false and the app keeps its in-page clock —
 * unchanged, and with the same honest limitation as before.
 */
export const webChannel: NotificationChannel = {
  canSchedule: false,

  permission: async () => webPermission(),

  request: async () => {
    if (webPermission() === 'unsupported') return 'unsupported';
    try {
      const result = await Notification.requestPermission();
      if (result === 'granted' || result === 'denied') return result;
      return 'default';
    } catch {
      return webPermission();
    }
  },

  deliver: async (content) => {
    if (webPermission() !== 'granted') return false;

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

/**
 * The channel for this platform.
 *
 * `nativeNotifications` resolves to the real expo-notifications channel on a
 * phone and to null everywhere else — the two files behind that import are
 * platform-selected by the bundler, which is what keeps expo-notifications out
 * of the web bundle entirely.
 */
export const notificationChannel: NotificationChannel | null =
  Platform.OS === 'web' ? webChannel : nativeNotifications;
