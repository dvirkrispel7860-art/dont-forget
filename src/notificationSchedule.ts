import {
  NotificationContent,
  nextOccurrence,
  notificationChannel,
  parseTime,
  reminderContent,
} from './notifications';
import {
  emptyNotificationSchedule,
  loadNotificationSchedule,
  saveNotificationSchedule,
  StoredNotificationSchedule,
} from './storage';
import { Destination, Reminder } from './types';

/**
 * Handing the reminder timetable to the operating system, and keeping it honest.
 *
 * On a platform whose channel can schedule (native), the app does not watch the
 * clock at all: every reminder is registered with iOS/Android once, and the OS
 * delivers it whether the app is open, backgrounded or killed. This module is
 * what decides *what* should be registered, and — the harder half — what should
 * no longer be.
 *
 * Two rules keep it from turning into a pile of duplicate notifications:
 *
 *  1. **Deterministic ids.** A reminder's notification id is derived from the
 *     destination and the weekday, never generated. So a launch weeks later
 *     recognises its own work and replaces it instead of adding to it.
 *  2. **The OS list is the authority on what exists**; the stored record is the
 *     authority on what it was built from. Reconciling compares both, so a lost
 *     record, a wiped install or a notification the user cleared all converge
 *     back to the right set rather than drifting.
 *
 * What it deliberately does not do: bake a bus time into a recurring
 * notification. A weekly reminder is registered days in advance, and no
 * timetable read now is true then — so the recurring text is the plain "מתכוננים
 * לצאת?", and the live journey stays where it can be looked up for real (the
 * card, and the immediate reminder on web). The one-shot "time to leave" is
 * different: it is scheduled minutes ahead from a ride already in hand.
 */

/** Everything this app schedules is prefixed, so its own work is recognisable. */
const PREFIX = 'dontforget';

/** The recurring departure reminder for one destination, on one weekday. */
export function reminderNotificationId(destinationId: string, day: number): string {
  return `${PREFIX}:reminder:${destinationId}:${day}`;
}

/** The one-shot "time to leave" for one destination. */
export function leaveNotificationId(destinationId: string): string {
  return `${PREFIX}:leave:${destinationId}`;
}

/** Is this id one of ours? Used to leave anything else alone. */
export function isOwnNotificationId(id: string): boolean {
  return id.startsWith(`${PREFIX}:`);
}

/**
 * What a reminder currently says, as one comparable string. A change to the
 * time, the days or the switch changes this, and that is what triggers a
 * reschedule — nothing else does, so an unrelated edit to a destination leaves
 * the OS schedule untouched.
 */
export function reminderSignature(reminder: Reminder | undefined): string {
  if (!reminder) return 'none';
  const days = [...new Set(reminder.days)].sort((a, b) => a - b).join(',');
  return `${reminder.enabled ? 'on' : 'off'}|${reminder.time}|${days}`;
}

/** Why a reconcile did nothing, when it did nothing. */
export type ReconcileSkip =
  /** This platform has no notification channel at all. */
  | 'no-channel'
  /** The channel cannot schedule — web keeps its in-page clock instead. */
  | 'no-schedule-support'
  /** The app-wide notifications switch is off. */
  | 'switched-off'
  /** The OS has not granted permission. */
  | 'not-granted';

export type ReconcileReport = {
  /** Notification ids newly handed to the OS. */
  scheduled: string[];
  /** Notification ids withdrawn from the OS. */
  cancelled: string[];
  /** Already correct, and left alone. */
  unchanged: string[];
  skipped: ReconcileSkip | null;
};

const emptyReport: ReconcileReport = {
  scheduled: [],
  cancelled: [],
  unchanged: [],
  skipped: null,
};

type Desired = {
  id: string;
  destinationId: string;
  content: NotificationContent;
  day: number;
  hour: number;
  minute: number;
};

/** Every notification the current data says should exist. */
function desiredReminders(destinations: Destination[], now: Date): Desired[] {
  const wanted: Desired[] = [];

  for (const destination of destinations) {
    const reminder = destination.reminder;
    if (!reminder?.enabled) continue;
    /*
     * `nextOccurrence` is the existing answer to "when does this fire next", and
     * a null from it means never — no days chosen, or the reminder is off. There
     * is nothing to register for that, and registering a weekly trigger anyway
     * would create a reminder the app itself says does not exist.
     */
    if (nextOccurrence(reminder, now) == null) continue;

    const { hour, minute } = parseTime(reminder.time);
    for (const day of new Set(reminder.days)) {
      if (!Number.isInteger(day) || day < 0 || day > 6) continue;
      wanted.push({
        id: reminderNotificationId(destination.id, day),
        destinationId: destination.id,
        // Deliberately the plain reminder: see the note at the top of the file.
        content: reminderContent(destination),
        day,
        hour,
        minute,
      });
    }
  }

  return wanted;
}

/**
 * Brings the OS schedule in line with the app's data.
 *
 * Safe to call as often as the data changes: it schedules only what is missing or
 * stale, and cancels only ids of its own.
 */
export async function reconcileReminders(params: {
  destinations: Destination[];
  /** The app-wide notifications switch. */
  enabled: boolean;
  now?: Date;
}): Promise<ReconcileReport> {
  const channel = notificationChannel;
  if (!channel) return { ...emptyReport, skipped: 'no-channel' };
  if (!channel.canSchedule || !channel.schedule || !channel.cancel) {
    return { ...emptyReport, skipped: 'no-schedule-support' };
  }

  const now = params.now ?? new Date();
  const stored = await loadNotificationSchedule();
  const live = new Set((await channel.scheduled?.()) ?? []);

  const report: ReconcileReport = {
    scheduled: [],
    cancelled: [],
    unchanged: [],
    skipped: null,
  };

  /** Withdraws one of ours and forgets it. */
  const cancel = async (id: string) => {
    await channel.cancel!(id);
    report.cancelled.push(id);
    live.delete(id);
  };

  /*
   * The switch being off, or the permission missing, is not a reason to leave
   * yesterday's notifications sitting in the OS — they would still fire. So both
   * cases clear everything of ours first and only then report why.
   */
  if (!params.enabled || (await channel.permission()) !== 'granted') {
    for (const id of [...live]) {
      if (isOwnNotificationId(id)) await cancel(id);
    }
    await saveNotificationSchedule(emptyNotificationSchedule);
    return {
      ...report,
      skipped: params.enabled ? 'not-granted' : 'switched-off',
    };
  }

  const wanted = desiredReminders(params.destinations, now);
  const wantedIds = new Set(wanted.map((entry) => entry.id));

  /* -------- anything of ours the data no longer asks for: withdraw it. This is
     what covers a deleted destination, a reminder switched off, days removed,
     and a record that was wiped while the OS kept the notifications. */
  for (const id of [...live]) {
    if (!isOwnNotificationId(id)) continue;
    if (id.includes(':reminder:') && !wantedIds.has(id)) await cancel(id);
  }

  /* -------- what should exist: schedule it if it is missing or was built from
     something that has since changed. */
  const byDestination = new Map<string, Desired[]>();
  for (const entry of wanted) {
    const list = byDestination.get(entry.destinationId) ?? [];
    list.push(entry);
    byDestination.set(entry.destinationId, list);
  }

  const reminders: StoredNotificationSchedule['reminders'] = {};

  for (const [destinationId, entries] of byDestination) {
    const destination = params.destinations.find((d) => d.id === destinationId);
    const signature = reminderSignature(destination?.reminder);
    const previous = stored.reminders[destinationId];
    const sameSignature = previous?.signature === signature;
    const allPresent = entries.every((entry) => live.has(entry.id));

    if (sameSignature && allPresent) {
      for (const entry of entries) report.unchanged.push(entry.id);
      reminders[destinationId] = {
        signature,
        ids: entries.map((entry) => entry.id),
        nextAt: destination?.reminder
          ? (nextOccurrence(destination.reminder, now)?.getTime() ?? null)
          : null,
      };
      continue;
    }

    // Replace rather than add: cancel first, so a changed time never leaves the
    // old one behind.
    for (const entry of entries) {
      if (live.has(entry.id)) await cancel(entry.id);
    }

    const ids: string[] = [];
    for (const entry of entries) {
      const id = await channel.schedule({
        id: entry.id,
        content: entry.content,
        trigger: {
          kind: 'weekly',
          day: entry.day,
          hour: entry.hour,
          minute: entry.minute,
        },
      });
      if (id) {
        ids.push(entry.id);
        report.scheduled.push(entry.id);
        live.add(entry.id);
      }
    }

    if (ids.length > 0) {
      reminders[destinationId] = {
        signature,
        ids,
        nextAt: destination?.reminder
          ? (nextOccurrence(destination.reminder, now)?.getTime() ?? null)
          : null,
      };
    }
  }

  /* -------- pending "time to leave" notifications: keep the ones still ahead,
     drop the ones whose moment has passed or whose destination is gone. */
  const leave: StoredNotificationSchedule['leave'] = {};
  for (const [destinationId, entry] of Object.entries(stored.leave)) {
    const destinationExists = params.destinations.some((d) => d.id === destinationId);
    const stillAhead = entry.at > now.getTime();
    if (destinationExists && stillAhead && live.has(entry.id)) {
      leave[destinationId] = entry;
      report.unchanged.push(entry.id);
    } else if (live.has(entry.id)) {
      await cancel(entry.id);
    }
  }

  // Anything of ours still in the OS list that nothing claims — a leftover from
  // an older build, or a record we lost. Withdraw it.
  const claimed = new Set([
    ...Object.values(reminders).flatMap((entry) => entry.ids),
    ...Object.values(leave).map((entry) => entry.id),
  ]);
  for (const id of [...live]) {
    if (isOwnNotificationId(id) && !claimed.has(id)) await cancel(id);
  }

  await saveNotificationSchedule({ reminders, leave });
  return report;
}

/* --------------------------------------------------------- time to leave --- */

/**
 * The ride and moment a pending "time to leave" was built for. A different ride,
 * or the same ride at a different time, is a different key — which is how a
 * timetable change gets the old notification withdrawn instead of firing for a
 * bus that is no longer the answer.
 */
export function leaveRideKey(rideId: string, leaveAt: number): string {
  return `${rideId}@${leaveAt}`;
}

/**
 * One queue per destination, so scheduling and cancelling a "time to leave"
 * never interleave.
 *
 * They share a single deterministic notification id, which is what makes the
 * ordering matter: if a cancel started before an arm resolved after it, it would
 * withdraw the notification the arm had just registered — leaving the user with
 * a reminder they asked for and will never get. Running them in order removes
 * that possibility rather than making it unlikely.
 */
const leaveQueues = new Map<string, Promise<unknown>>();

function inOrder<T>(destinationId: string, work: () => Promise<T>): Promise<T> {
  const previous = leaveQueues.get(destinationId) ?? Promise.resolve();
  // Runs after the previous operation settles, whether it worked or threw.
  const next = previous.then(work, work);
  leaveQueues.set(
    destinationId,
    next.catch(() => undefined),
  );
  return next;
}

export type LeaveScheduleResult =
  | { status: 'scheduled'; id: string; at: number }
  /** Already scheduled for exactly this ride and moment — nothing to do. */
  | { status: 'unchanged'; id: string; at: number }
  | {
      status: 'skipped';
      reason: 'no-channel' | 'no-schedule-support' | 'not-granted' | 'in-the-past';
    };

/**
 * Hands one "🚀 זמן לצאת" to the OS, replacing whatever was pending for this
 * destination.
 *
 * The caller supplies the moment and the message — this schedules no time of its
 * own and reads no timetable. A moment already past is refused rather than
 * rounded up to "now": a notification telling someone to leave for a bus that has
 * gone is worse than none.
 */
export function scheduleLeaveReminder(params: {
  destinationId: string;
  content: NotificationContent;
  /** Epoch millis to fire at. */
  at: number;
  /** From `leaveRideKey` — what this notification is about. */
  rideKey: string;
  now?: number;
}): Promise<LeaveScheduleResult> {
  return inOrder(params.destinationId, () => runScheduleLeaveReminder(params));
}

async function runScheduleLeaveReminder(params: {
  destinationId: string;
  content: NotificationContent;
  at: number;
  rideKey: string;
  now?: number;
}): Promise<LeaveScheduleResult> {
  const channel = notificationChannel;
  if (!channel) return { status: 'skipped', reason: 'no-channel' };
  if (!channel.canSchedule || !channel.schedule || !channel.cancel) {
    return { status: 'skipped', reason: 'no-schedule-support' };
  }
  if ((await channel.permission()) !== 'granted') {
    return { status: 'skipped', reason: 'not-granted' };
  }

  const now = params.now ?? Date.now();
  if (params.at <= now) return { status: 'skipped', reason: 'in-the-past' };

  const schedule = await loadNotificationSchedule();
  const existing = schedule.leave[params.destinationId];

  if (existing && existing.rideKey === params.rideKey && existing.at > now) {
    return { status: 'unchanged', id: existing.id, at: existing.at };
  }

  // Replace: the old one is for a ride or a time that no longer applies.
  if (existing) await channel.cancel(existing.id);

  const id = leaveNotificationId(params.destinationId);
  const scheduled = await channel.schedule({
    id,
    content: params.content,
    trigger: { kind: 'date', at: params.at },
  });

  if (!scheduled) {
    delete schedule.leave[params.destinationId];
    await saveNotificationSchedule(schedule);
    return { status: 'skipped', reason: 'no-schedule-support' };
  }

  schedule.leave[params.destinationId] = {
    id,
    at: params.at,
    rideKey: params.rideKey,
  };
  await saveNotificationSchedule(schedule);
  return { status: 'scheduled', id, at: params.at };
}

/** Withdraws the pending "time to leave" for a destination, if there is one. */
export function cancelLeaveReminder(destinationId: string): Promise<boolean> {
  return inOrder(destinationId, () => runCancelLeaveReminder(destinationId));
}

async function runCancelLeaveReminder(destinationId: string): Promise<boolean> {
  const channel = notificationChannel;
  if (!channel?.cancel) return false;

  const schedule = await loadNotificationSchedule();
  const existing = schedule.leave[destinationId];
  // Cancel by the deterministic id either way: a lost record must not leave a
  // notification stranded in the OS.
  await channel.cancel(existing?.id ?? leaveNotificationId(destinationId));

  if (existing) {
    delete schedule.leave[destinationId];
    await saveNotificationSchedule(schedule);
  }
  return existing != null;
}

/** What the app believes is pending for a destination. For diagnostics and tests. */
export async function pendingLeaveReminder(destinationId: string) {
  const schedule = await loadNotificationSchedule();
  return schedule.leave[destinationId] ?? null;
}

/* ---------------------------------------------------------------- checking --- */

/**
 * Internal build check: schedules one notification a few seconds out so a real
 * device can be verified without waiting for a real reminder hour.
 *
 * Deliberately not wired to any button in the app — it exists to be called from
 * a debug console or a temporary line during development, and it uses the same
 * channel and the same code path as everything else, so a pass here means the
 * plumbing works.
 */
export async function scheduleTestNotification(
  seconds = 10,
): Promise<{ ok: boolean; id: string | null; reason?: string }> {
  const channel = notificationChannel;
  if (!channel) return { ok: false, id: null, reason: 'no-channel' };
  if (!channel.canSchedule || !channel.schedule) {
    return { ok: false, id: null, reason: 'no-schedule-support' };
  }
  const permission = await channel.permission();
  if (permission !== 'granted') return { ok: false, id: null, reason: permission };

  const id = await channel.schedule({
    id: `${PREFIX}:test:${seconds}`,
    content: {
      title: '🔔 בדיקת התראה',
      body: `אם ההתראה הזאת הגיעה, התזמון עובד (${seconds} שניות).`,
      url: '/home',
      tag: 'test',
    },
    trigger: { kind: 'seconds', seconds },
  });

  return { ok: id != null, id };
}
