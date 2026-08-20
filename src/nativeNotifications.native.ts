import { Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type {
  NotificationChannel,
  NotificationContent,
  PermissionState,
  ScheduleRequest,
} from './notifications';

/**
 * The native notification channel: `expo-notifications`, behind the app's own
 * `NotificationChannel` seam.
 *
 * The whole point of this file is the schedule. Everything here goes through
 * `scheduleNotificationAsync`, which hands the notification to iOS/Android — so
 * it arrives whether the app is in the foreground, in the background, or not
 * running at all. Nothing in the app has to be awake for a reminder to appear,
 * which is exactly what the in-page clock could never do.
 *
 * Only local notifications. No push token, no server, no remote anything.
 *
 * The bundler picks this file for iOS and Android only; web resolves to
 * `nativeNotifications.ts`, which is an empty stub.
 */

/** The Android channel departures land on. Named in app.json as defaultChannel. */
const CHANNEL_ID = 'departures';

/** Weekly triggers count weekdays 1–7 with 1 = Sunday; `Reminder.days` uses 0–6. */
function toWeekday(day: number): number {
  return day + 1;
}

function toPermissionState(
  response: Notifications.NotificationPermissionsStatus,
): PermissionState {
  if (response.granted) return 'granted';
  /*
   * iOS "provisional" authorisation delivers quietly rather than not at all, so
   * it counts as granted — reporting it as denied would send the user off to fix
   * something that is already working.
   */
  if (response.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return 'granted';
  }
  if (response.status === Notifications.PermissionStatus.DENIED) return 'denied';
  return 'default';
}

/**
 * How a notification behaves when it fires while the app is open. Without this
 * the OS hands it to the app and nothing is shown — the reminder would simply
 * vanish for anyone looking at the screen.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * The Android channel, created once and awaited by everything that schedules.
 * Android silently drops importance settings for a channel that does not exist
 * yet, so this has to land before the first notification does.
 */
let channelReady: Promise<void> | null = null;

function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  if (!channelReady) {
    channelReady = Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'תזכורות יציאה',
      description: 'תזכורת לפני יציאה, וזמן היציאה לאוטובוס.',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      enableVibrate: true,
      lightColor: '#4B5BF5',
      showBadge: false,
    })
      .then(() => undefined)
      .catch(() => {
        // A channel we could not create must not stop the reminder: Android
        // falls back to its default channel, which still delivers.
        channelReady = null;
      });
  }
  return channelReady;
}

/** The app's content shape, as expo-notifications wants it. */
function toContentInput(
  content: NotificationContent,
): Notifications.NotificationContentInput {
  return {
    title: content.title,
    body: content.body,
    sound: 'default',
    // The tap handler reads `url` — same field the service worker reads on web.
    data: { url: content.url, tag: content.tag },
  };
}

function toTrigger(
  trigger: ScheduleRequest['trigger'],
): Notifications.NotificationTriggerInput {
  switch (trigger.kind) {
    case 'date':
      return {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(trigger.at),
        channelId: CHANNEL_ID,
      };
    case 'weekly':
      return {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: toWeekday(trigger.day),
        hour: trigger.hour,
        minute: trigger.minute,
        channelId: CHANNEL_ID,
      };
    case 'seconds':
      return {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: trigger.seconds,
        repeats: false,
        channelId: CHANNEL_ID,
      };
  }
}

export const nativeNotifications: NotificationChannel = {
  canSchedule: true,

  permission: async () => {
    try {
      return toPermissionState(await Notifications.getPermissionsAsync());
    } catch {
      return 'default';
    }
  },

  request: async () => {
    try {
      await ensureAndroidChannel();
      const current = await Notifications.getPermissionsAsync();
      /*
       * `canAskAgain` is the platform's own answer to "may I prompt". Once it is
       * false the refusal is final until the user changes it in the system
       * settings, and asking again would do nothing at all.
       */
      if (current.granted || !current.canAskAgain) return toPermissionState(current);
      return toPermissionState(await Notifications.requestPermissionsAsync());
    } catch {
      return 'default';
    }
  },

  deliver: async (content) => {
    try {
      await ensureAndroidChannel();
      // A null trigger means "now" — the same immediate delivery web does.
      await Notifications.scheduleNotificationAsync({
        content: toContentInput(content),
        trigger: null,
      });
      return true;
    } catch {
      return false;
    }
  },

  schedule: async (request) => {
    try {
      await ensureAndroidChannel();
      /*
       * Our own identifier, not a generated one. It is what lets a fresh launch
       * recognise work it scheduled weeks ago and replace it instead of adding a
       * second copy — see notificationSchedule.ts.
       */
      return await Notifications.scheduleNotificationAsync({
        identifier: request.id,
        content: toContentInput(request.content),
        trigger: toTrigger(request.trigger),
      });
    } catch {
      return null;
    }
  },

  cancel: async (id) => {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
      // Already gone (fired, or cancelled before) — nothing to undo.
    }
  },

  scheduled: async () => {
    try {
      const requests = await Notifications.getAllScheduledNotificationsAsync();
      return requests.map((request) => request.identifier);
    } catch {
      return [];
    }
  },

  openSettings: async () => {
    try {
      await Linking.openSettings();
      return true;
    } catch {
      return false;
    }
  },
};
