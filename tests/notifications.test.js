/*
 * Tests for the real notification scheduling code (compiled from src/, not
 * reimplemented), running against a fake operating system.
 *
 * The fake stands in for expo-notifications and behaves the way the real one
 * does in the ways that matter here: it keys scheduled notifications by
 * identifier, so scheduling the same id twice replaces rather than duplicates.
 */
const Module = require('module');
const path = require('path');

const stubs = {};
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return realLoad(request, parent, isMain);
};

let now = new Date('2026-08-20T09:00:00').getTime();
Date.now = () => now;

/* ------------------------------------------------------------- the fake OS */

function makeOs() {
  const os = {
    /** identifier → { content, trigger } */
    scheduled: new Map(),
    channels: new Map(),
    handler: null,
    permission: { status: 'granted', granted: true, canAskAgain: true },
    /** Every call, so a test can assert nothing was scheduled twice. */
    scheduleCalls: [],
    cancelCalls: [],
  };

  os.module = {
    PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
    IosAuthorizationStatus: {
      NOT_DETERMINED: 'NOT_DETERMINED',
      DENIED: 'DENIED',
      AUTHORIZED: 'AUTHORIZED',
      PROVISIONAL: 'PROVISIONAL',
    },
    AndroidImportance: { NONE: 0, MIN: 1, LOW: 2, DEFAULT: 3, HIGH: 4, MAX: 5 },
    SchedulableTriggerInputTypes: {
      DATE: 'date',
      DAILY: 'daily',
      WEEKLY: 'weekly',
      TIME_INTERVAL: 'timeInterval',
    },
    setNotificationHandler: (handler) => {
      os.handler = handler;
    },
    setNotificationChannelAsync: async (id, input) => {
      os.channels.set(id, input);
      return { id, ...input };
    },
    getPermissionsAsync: async () => os.permission,
    requestPermissionsAsync: async () => {
      os.requested = (os.requested || 0) + 1;
      return os.permission;
    },
    scheduleNotificationAsync: async ({ identifier, content, trigger }) => {
      const id = identifier || `auto-${os.scheduled.size + 1}`;
      os.scheduleCalls.push(id);
      // The real API replaces an existing identifier rather than adding.
      os.scheduled.set(id, { content, trigger });
      return id;
    },
    cancelScheduledNotificationAsync: async (id) => {
      os.cancelCalls.push(id);
      os.scheduled.delete(id);
    },
    getAllScheduledNotificationsAsync: async () =>
      [...os.scheduled.entries()].map(([identifier, value]) => ({ identifier, ...value })),
  };

  return os;
}

/* -------------------------------------------------- the app, freshly loaded */

const DIR = __dirname;
/** Storage survives a "restart"; that is the point of it. */
let disk = new Map();

function boot({ os, platform = 'ios' } = {}) {
  const theOs = os || makeOs();

  stubs['expo-notifications'] = theOs.module;
  stubs['react-native'] = {
    Platform: { OS: platform },
    Linking: { openSettings: async () => {} },
  };
  stubs['@react-native-async-storage/async-storage'] = {
    getItem: async (k) => (disk.has(k) ? disk.get(k) : null),
    setItem: async (k, v) => {
      disk.set(k, v);
    },
    removeItem: async (k) => {
      disk.delete(k);
    },
    multiRemove: async (keys) => {
      for (const k of keys) disk.delete(k);
    },
  };

  for (const file of [
    'nativeNotifications.native.js',
    'notifications.js',
    'notificationSchedule.js',
    'storage.js',
  ]) {
    delete require.cache[require.resolve(path.join(DIR, file))];
  }
  delete require.cache[require.resolve(path.join(DIR, 'transit/index.js'))];

  // The bundler picks the .native file on a phone; here we point the import at it.
  const native = require(path.join(DIR, 'nativeNotifications.native.js'));
  stubs['./nativeNotifications'] =
    platform === 'web' ? { nativeNotifications: null } : native;

  const notifications = require(path.join(DIR, 'notifications.js'));
  const schedule = require(path.join(DIR, 'notificationSchedule.js'));
  const storage = require(path.join(DIR, 'storage.js'));
  return { os: theOs, notifications, schedule, storage };
}

/* ------------------------------------------------------------------ helpers */

const destination = (id, reminder, extra = {}) => ({
  id,
  name: `יעד ${id}`,
  icon: '🏫',
  favorite: false,
  items: [],
  createdAt: 1,
  ...(reminder ? { reminder } : {}),
  ...extra,
});

const reminder = (time, days, enabled = true) => ({ enabled, time, days });

let pass = 0;
let fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
}

/** Scheduled ids, sorted, so a comparison does not depend on insertion order. */
const ids = (os) => [...os.scheduled.keys()].sort();
const triggerOf = (os, id) => os.scheduled.get(id)?.trigger;

async function main() {
  /* ============================================ 1 · granted → it schedules */
  {
    disk = new Map();
    const { os, schedule } = boot();
    const report = await schedule.reconcileReminders({
      destinations: [destination('d1', reminder('07:30', [0, 1, 2, 3, 4]))],
      enabled: true,
      now: new Date(now),
    });
    check('1 · permission granted → reminders scheduled', report.scheduled.length, 5);
    check('1b · nothing skipped', report.skipped, null);
    check('1c · one notification per chosen weekday', ids(os), [
      'dontforget:reminder:d1:0',
      'dontforget:reminder:d1:1',
      'dontforget:reminder:d1:2',
      'dontforget:reminder:d1:3',
      'dontforget:reminder:d1:4',
    ]);
    check('1d · weekly trigger, Sunday is weekday 1', triggerOf(os, 'dontforget:reminder:d1:0'), {
      type: 'weekly',
      weekday: 1,
      hour: 7,
      minute: 30,
      channelId: 'departures',
    });
    check('1e · Thursday is weekday 5', triggerOf(os, 'dontforget:reminder:d1:4').weekday, 5);
    check(
      '1f · the message is the plain reminder, with no invented bus time',
      /קו |יוצא ב-/.test(os.scheduled.get('dontforget:reminder:d1:0').content.body),
      false,
    );
    check(
      '1g · tapping it opens that destination',
      os.scheduled.get('dontforget:reminder:d1:0').content.data.url,
      '/destination/d1/check',
    );
  }

  /* ================================================ 2 · denied → nothing */
  {
    disk = new Map();
    const os = makeOs();
    const first = boot({ os });
    await first.schedule.reconcileReminders({
      destinations: [destination('d1', reminder('07:30', [0, 1]))],
      enabled: true,
      now: new Date(now),
    });
    check('2 · scheduled while granted', ids(os).length, 2);

    // The user turns notifications off in the OS settings.
    os.permission = { status: 'denied', granted: false, canAskAgain: false };
    const report = await first.schedule.reconcileReminders({
      destinations: [destination('d1', reminder('07:30', [0, 1]))],
      enabled: true,
      now: new Date(now),
    });
    check('2b · permission denied → reported as such', report.skipped, 'not-granted');
    check('2c · and the pending ones are withdrawn, not left to fire', ids(os), []);
  }

  /* ======================================== 3 · the Android channel */
  {
    disk = new Map();
    const { os, schedule } = boot({ platform: 'android' });
    await schedule.reconcileReminders({
      destinations: [destination('d1', reminder('07:30', [0]))],
      enabled: true,
      now: new Date(now),
    });
    check('3 · Android channel created', os.channels.has('departures'), true);
    const channel = os.channels.get('departures');
    check('3b · with high importance', channel.importance, 4);
    check('3c · and a name the user can read', channel.name, 'תזכורות יציאה');
    check('3d · notifications land on that channel', triggerOf(os, 'dontforget:reminder:d1:0').channelId, 'departures');
    check('3e · a foreground handler is registered', typeof os.handler?.handleNotification, 'function');
    const behaviour = await os.handler.handleNotification();
    check('3f · and it actually shows the notification', behaviour.shouldShowBanner, true);
  }

  /* ============================================== 4 · every day */
  {
    disk = new Map();
    const { os, schedule } = boot();
    await schedule.reconcileReminders({
      destinations: [destination('d1', reminder('06:05', [0, 1, 2, 3, 4, 5, 6]))],
      enabled: true,
      now: new Date(now),
    });
    check('4 · a daily reminder → seven weekly triggers', ids(os).length, 7);
    check('4b · weekdays 1–7 covered', [...os.scheduled.values()].map((v) => v.trigger.weekday).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7]);
    check('4c · minutes carried through', triggerOf(os, 'dontforget:reminder:d1:3').minute, 5);
  }

  /* ====================================== 5 · several destinations at once */
  {
    disk = new Map();
    const { os, schedule } = boot();
    await schedule.reconcileReminders({
      destinations: [
        destination('a', reminder('07:00', [0, 2])),
        destination('b', reminder('16:45', [5])),
        destination('c'), // no reminder at all
        destination('d', reminder('08:00', [], true)), // no days chosen
        destination('e', reminder('09:00', [1], false)), // switched off
      ],
      enabled: true,
      now: new Date(now),
    });
    check('5 · only real reminders scheduled', ids(os), [
      'dontforget:reminder:a:0',
      'dontforget:reminder:a:2',
      'dontforget:reminder:b:5',
    ]);
    check('5b · an empty day list schedules nothing', ids(os).some((id) => id.includes(':d:')), false);
    check('5c · a switched-off reminder schedules nothing', ids(os).some((id) => id.includes(':e:')), false);
  }

  /* ================================================ 6 · the time changes */
  {
    disk = new Map();
    const os = makeOs();
    const app = boot({ os });
    await app.schedule.reconcileReminders({
      destinations: [destination('d1', reminder('07:30', [0, 1]))],
      enabled: true,
      now: new Date(now),
    });
    os.scheduleCalls.length = 0;
    os.cancelCalls.length = 0;

    const report = await app.schedule.reconcileReminders({
      destinations: [destination('d1', reminder('08:15', [0, 1]))],
      enabled: true,
      now: new Date(now),
    });
    check('6 · time change → the old ones are cancelled', os.cancelCalls.sort(), [
      'dontforget:reminder:d1:0',
      'dontforget:reminder:d1:1',
    ]);
    check('6b · and rescheduled at the new time', triggerOf(os, 'dontforget:reminder:d1:0'), {
      type: 'weekly',
      weekday: 1,
      hour: 8,
      minute: 15,
      channelId: 'departures',
    });
    check('6c · still exactly two, not four', ids(os).length, 2);
    check('6d · reported as rescheduled', report.scheduled.length, 2);
  }

  /* ================================================ 7 · the days change */
  {
    disk = new Map();
    const os = makeOs();
    const app = boot({ os });
    await app.schedule.reconcileReminders({
      destinations: [destination('d1', reminder('07:30', [0, 1, 2]))],
      enabled: true,
      now: new Date(now),
    });
    await app.schedule.reconcileReminders({
      destinations: [destination('d1', reminder('07:30', [1, 5]))],
      enabled: true,
      now: new Date(now),
    });
    check('7 · days change → exactly the new set is scheduled', ids(os), [
      'dontforget:reminder:d1:1',
      'dontforget:reminder:d1:5',
    ]);
  }

  /* ============================================ 8 · reminder switched off */
  {
    disk = new Map();
    const os = makeOs();
    const app = boot({ os });
    await app.schedule.reconcileReminders({
      destinations: [destination('d1', reminder('07:30', [0, 1]))],
      enabled: true,
      now: new Date(now),
    });
    await app.schedule.reconcileReminders({
      destinations: [destination('d1', reminder('07:30', [0, 1], false))],
      enabled: true,
      now: new Date(now),
    });
    check('8 · a reminder switched off is withdrawn', ids(os), []);
    const stored = await app.storage.loadNotificationSchedule();
    check('8b · and forgotten from the record', Object.keys(stored.reminders), []);
  }

  /* ================================================ 9 · destination deleted */
  {
    disk = new Map();
    const os = makeOs();
    const app = boot({ os });
    await app.schedule.reconcileReminders({
      destinations: [
        destination('keep', reminder('07:00', [0])),
        destination('gone', reminder('08:00', [0, 1])),
      ],
      enabled: true,
      now: new Date(now),
    });
    check('9 · both scheduled', ids(os).length, 3);
    await app.schedule.reconcileReminders({
      destinations: [destination('keep', reminder('07:00', [0]))],
      enabled: true,
      now: new Date(now),
    });
    check('9b · the deleted destination\'s reminders are withdrawn', ids(os), [
      'dontforget:reminder:keep:0',
    ]);
  }

  /* ========================================== 10 · no duplicates, ever */
  {
    disk = new Map();
    const os = makeOs();
    const app = boot({ os });
    const destinations = [
      destination('a', reminder('07:00', [0, 1, 2, 3, 4])),
      destination('b', reminder('19:30', [5, 6])),
    ];
    await app.schedule.reconcileReminders({ destinations, enabled: true, now: new Date(now) });
    const afterFirst = ids(os);
    os.scheduleCalls.length = 0;

    for (let i = 0; i < 10; i++) {
      const report = await app.schedule.reconcileReminders({
        destinations,
        enabled: true,
        now: new Date(now),
      });
      if (report.scheduled.length > 0) {
        check(`10 · run ${i + 2} scheduled nothing new`, report.scheduled, []);
      }
    }
    check('10 · ten more reconciles change nothing', ids(os), afterFirst);
    check('10b · and touch the OS not at all', os.scheduleCalls, []);
    check('10c · seven notifications, not seventy', ids(os).length, 7);
  }

  /* ================================== 11 · "time to leave", one-shot */
  {
    disk = new Map();
    const os = makeOs();
    const app = boot({ os });
    const leaveAt = now + 9 * 60_000;
    const content = {
      title: '🚀 זמן לצאת',
      body: 'קו 54 יוצא מ"אריה תגר" ב-09:18',
      url: '/destination/d1/check',
      tag: 'leave:d1',
    };
    const result = await app.schedule.scheduleLeaveReminder({
      destinationId: 'd1',
      content,
      at: leaveAt,
      rideKey: app.schedule.leaveRideKey('ride-1', leaveAt),
      now,
    });
    check('11 · scheduled with the OS', result.status, 'scheduled');
    check('11b · at the leave moment, as a one-off date trigger', triggerOf(os, 'dontforget:leave:d1'), {
      type: 'date',
      date: new Date(leaveAt),
      channelId: 'departures',
    });
    check('11c · with the message it was given', os.scheduled.get('dontforget:leave:d1').content.title, '🚀 זמן לצאת');

    // Arming the same ride again must not add a second one.
    const again = await app.schedule.scheduleLeaveReminder({
      destinationId: 'd1',
      content,
      at: leaveAt,
      rideKey: app.schedule.leaveRideKey('ride-1', leaveAt),
      now,
    });
    check('11d · the same ride again → unchanged, not duplicated', again.status, 'unchanged');
    check('11e · still one', ids(os).length, 1);

    // A moment already past is refused rather than fired immediately.
    const late = await app.schedule.scheduleLeaveReminder({
      destinationId: 'd2',
      content,
      at: now - 60_000,
      rideKey: 'x@1',
      now,
    });
    check('11f · a leave time in the past is refused', late, {
      status: 'skipped',
      reason: 'in-the-past',
    });
    check('11g · and nothing was scheduled for it', ids(os).length, 1);
  }

  /* ============================================ 12 · cancelling it */
  {
    disk = new Map();
    const os = makeOs();
    const app = boot({ os });
    const leaveAt = now + 9 * 60_000;
    const content = { title: 't', body: 'b', url: '/u', tag: 'leave:d1' };
    await app.schedule.scheduleLeaveReminder({
      destinationId: 'd1',
      content,
      at: leaveAt,
      rideKey: 'r@1',
      now,
    });
    const cancelled = await app.schedule.cancelLeaveReminder('d1');
    check('12 · cancelled', cancelled, true);
    check('12b · withdrawn from the OS', ids(os), []);
    check('12c · and forgotten', await app.schedule.pendingLeaveReminder('d1'), null);
    check('12d · cancelling nothing is harmless', await app.schedule.cancelLeaveReminder('d1'), false);
  }

  /* ==================================== 13 · the bus time changes */
  {
    disk = new Map();
    const os = makeOs();
    const app = boot({ os });
    const content = { title: 't', body: 'b', url: '/u', tag: 'leave:d1' };
    const firstLeave = now + 9 * 60_000;
    await app.schedule.scheduleLeaveReminder({
      destinationId: 'd1',
      content,
      at: firstLeave,
      rideKey: app.schedule.leaveRideKey('ride-1', firstLeave),
      now,
    });
    os.cancelCalls.length = 0;

    // The timetable moves the ride 16 minutes later.
    const movedLeave = firstLeave + 16 * 60_000;
    const result = await app.schedule.scheduleLeaveReminder({
      destinationId: 'd1',
      content,
      at: movedLeave,
      rideKey: app.schedule.leaveRideKey('ride-1', movedLeave),
      now,
    });
    check('13 · rescheduled for the new time', result.status, 'scheduled');
    check('13b · the old one was cancelled first', os.cancelCalls, ['dontforget:leave:d1']);
    check('13c · one pending, not two', ids(os).length, 1);
    check('13d · at the new moment', triggerOf(os, 'dontforget:leave:d1').date, new Date(movedLeave));

    // A different ride entirely replaces it too.
    const otherRide = movedLeave + 30 * 60_000;
    await app.schedule.scheduleLeaveReminder({
      destinationId: 'd1',
      content,
      at: otherRide,
      rideKey: app.schedule.leaveRideKey('ride-2', otherRide),
      now,
    });
    check('13e · a different ride replaces it as well', ids(os).length, 1);
    const pending = await app.schedule.pendingLeaveReminder('d1');
    check('13f · and the record follows', pending.rideKey, `ride-2@${otherRide}`);
  }

  /* ================================ 14 · the app is closed and reopened */
  {
    disk = new Map();
    const os = makeOs();
    const first = boot({ os });
    const destinations = [destination('d1', reminder('07:30', [0, 1, 2]))];
    await first.schedule.reconcileReminders({ destinations, enabled: true, now: new Date(now) });
    const leaveAt = now + 20 * 60_000;
    await first.schedule.scheduleLeaveReminder({
      destinationId: 'd1',
      content: { title: 't', body: 'b', url: '/u', tag: 'l' },
      at: leaveAt,
      rideKey: `r@${leaveAt}`,
      now,
    });
    const before = ids(os);
    check('14 · three reminders plus one leave', before.length, 4);

    // Relaunch: fresh modules, same disk, same OS-held notifications.
    const second = boot({ os });
    os.scheduleCalls.length = 0;
    os.cancelCalls.length = 0;
    const report = await second.schedule.reconcileReminders({
      destinations,
      enabled: true,
      now: new Date(now),
    });
    check('14b · a relaunch recognises its own work', report.unchanged.length, 4);
    check('14c · schedules nothing new', os.scheduleCalls, []);
    check('14d · cancels nothing', os.cancelCalls, []);
    check('14e · the set is identical', ids(os), before);

    // Later still: the leave moment has passed, so that one is cleaned up.
    now += 30 * 60_000;
    const third = boot({ os });
    await third.schedule.reconcileReminders({
      destinations,
      enabled: true,
      now: new Date(now),
    });
    check('14f · a leave reminder whose moment passed is cleaned up', ids(os), [
      'dontforget:reminder:d1:0',
      'dontforget:reminder:d1:1',
      'dontforget:reminder:d1:2',
    ]);
    now -= 30 * 60_000;
  }

  /* ============== 14g · a lost record still converges (no stranded copies) */
  {
    disk = new Map();
    const os = makeOs();
    const app = boot({ os });
    const destinations = [destination('d1', reminder('07:30', [0, 1]))];
    await app.schedule.reconcileReminders({ destinations, enabled: true, now: new Date(now) });
    // Storage wiped, OS still holding the notifications.
    disk = new Map();
    const after = boot({ os });
    await after.schedule.reconcileReminders({ destinations, enabled: true, now: new Date(now) });
    check('14g · a wiped record does not double the notifications', ids(os), [
      'dontforget:reminder:d1:0',
      'dontforget:reminder:d1:1',
    ]);
  }

  /* ===================================== 15 · the master switch is off */
  {
    disk = new Map();
    const os = makeOs();
    const app = boot({ os });
    const destinations = [destination('d1', reminder('07:30', [0, 1]))];
    await app.schedule.reconcileReminders({ destinations, enabled: true, now: new Date(now) });
    const report = await app.schedule.reconcileReminders({
      destinations,
      enabled: false,
      now: new Date(now),
    });
    check('15 · switch off → reported', report.skipped, 'switched-off');
    check('15b · and everything withdrawn', ids(os), []);

    // Back on: they come back.
    await app.schedule.reconcileReminders({ destinations, enabled: true, now: new Date(now) });
    check('15c · switching back on restores them', ids(os).length, 2);
  }

  /* ============================ 16 · the record keeps the next firing time */
  {
    disk = new Map();
    const app = boot();
    // Thursday 2026-08-20 09:00. A 07:30 Sunday-only reminder fires next Sunday.
    await app.schedule.reconcileReminders({
      destinations: [destination('d1', reminder('07:30', [0]))],
      enabled: true,
      now: new Date(now),
    });
    const stored = await app.storage.loadNotificationSchedule();
    const entry = stored.reminders.d1;
    check('16 · the signature is recorded', entry.signature, 'on|07:30|0');
    check('16b · so are the ids', entry.ids, ['dontforget:reminder:d1:0']);
    const next = new Date(entry.nextAt);
    check('16c · nextOccurrence recorded, and it is a Sunday', next.getDay(), 0);
    check('16d · at the reminder time', [next.getHours(), next.getMinutes()], [7, 30]);
    check('16e · and it is in the future', entry.nextAt > now, true);
  }

  /* ===================================== 17 · web keeps its in-page clock */
  {
    disk = new Map();
    const app = boot({ platform: 'web' });
    const report = await app.schedule.reconcileReminders({
      destinations: [destination('d1', reminder('07:30', [0]))],
      enabled: true,
      now: new Date(now),
    });
    check('17 · web has no OS schedule to hand off to', report.skipped, 'no-schedule-support');
    check('17b · so it schedules nothing', report.scheduled, []);
    check('17c · and the web channel says so', app.notifications.notificationChannel.canSchedule, false);
    const leave = await app.schedule.scheduleLeaveReminder({
      destinationId: 'd1',
      content: { title: 't', body: 'b', url: '/u', tag: 'l' },
      at: now + 60_000,
      rideKey: 'r@1',
      now,
    });
    check('17d · and the leave reminder falls back to the in-page timer', leave, {
      status: 'skipped',
      reason: 'no-schedule-support',
    });
  }

  /* ======================================== 18 · permission plumbing */
  {
    disk = new Map();
    const os = makeOs();
    const app = boot({ os });
    check('18 · native reports the real permission', await app.notifications.notificationPermission(), 'granted');
    check('18b · and it is not "unsupported" just for being native', app.notifications.permissionState(), 'granted');
    check('18c · the OS settings can be opened on a phone', app.notifications.canOpenNotificationSettings(), true);

    os.permission = { status: 'undetermined', granted: false, canAskAgain: true };
    const undetermined = boot({ os });
    check('18d · not asked yet → default', await undetermined.notifications.notificationPermission(), 'default');
    check('18e · requesting prompts', await undetermined.notifications.requestPermission(), 'default');
    check('18f · exactly once', os.requested, 1);

    os.permission = { status: 'denied', granted: false, canAskAgain: false };
    const denied = boot({ os });
    os.requested = 0;
    check('18g · finally denied → denied', await denied.notifications.requestPermission(), 'denied');
    check('18h · and it does not ask again pointlessly', os.requested, 0);

    os.permission = {
      status: 'undetermined',
      granted: false,
      canAskAgain: true,
      ios: { status: 'PROVISIONAL' },
    };
    const provisional = boot({ os });
    check('18i · iOS provisional counts as granted', await provisional.notifications.notificationPermission(), 'granted');
  }

  /* ============================================== 19 · the build check */
  {
    disk = new Map();
    const os = makeOs();
    const app = boot({ os });
    const result = await app.schedule.scheduleTestNotification(5);
    check('19 · the internal check schedules', result.ok, true);
    check('19b · a few seconds out', triggerOf(os, 'dontforget:test:5'), {
      type: 'timeInterval',
      seconds: 5,
      repeats: false,
      channelId: 'departures',
    });

    os.permission = { status: 'denied', granted: false, canAskAgain: false };
    const blocked = boot({ os });
    const refused = await blocked.schedule.scheduleTestNotification(5);
    check('19c · and refuses when the permission is not there', refused.ok, false);
  }

  /* ==================== 20 · a reconcile leaves other apps'/ids alone */
  {
    disk = new Map();
    const os = makeOs();
    // Something else in the OS list that is not ours.
    os.scheduled.set('someone-elses-notification', { content: {}, trigger: {} });
    const app = boot({ os });
    await app.schedule.reconcileReminders({
      destinations: [destination('d1', reminder('07:30', [0]))],
      enabled: true,
      now: new Date(now),
    });
    check('20 · foreign notifications are left alone', os.scheduled.has('someone-elses-notification'), true);
    await app.schedule.reconcileReminders({ destinations: [], enabled: true, now: new Date(now) });
    check('20b · even when clearing everything of ours', ids(os), ['someone-elses-notification']);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
