/*
 * The native half of the end-to-end flow, in order, through the real compiled
 * modules (src/transit/leaveTime.ts + src/notificationSchedule.ts +
 * src/nativeNotifications.native.ts) against a fake iOS/Android.
 *
 * This is not the UI. It covers steps 7–16 — the ride, the walk, the leave time,
 * arming, rescheduling, cancelling, changing stop, and finishing the departure —
 * with the notification actually handed to a stand-in operating system, since no
 * real device is available.
 */
const Module = require('module');
const path = require('path');

const stubs = {};
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return realLoad(request, parent, isMain);
};

let clock = new Date('2026-08-20T17:20:00').getTime();
Date.now = () => clock;

/* ------------------------------------------------------------- fake device */

function makeOs() {
  const os = { scheduled: new Map(), channels: new Map(), cancelCalls: [], scheduleCalls: [] };
  os.permission = { status: 'granted', granted: true, canAskAgain: true };
  os.module = {
    PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
    IosAuthorizationStatus: { PROVISIONAL: 'PROVISIONAL' },
    AndroidImportance: { HIGH: 4 },
    SchedulableTriggerInputTypes: { DATE: 'date', WEEKLY: 'weekly', TIME_INTERVAL: 'timeInterval' },
    setNotificationHandler: () => {},
    setNotificationChannelAsync: async (id, input) => {
      os.channels.set(id, input);
      return { id };
    },
    getPermissionsAsync: async () => os.permission,
    requestPermissionsAsync: async () => os.permission,
    scheduleNotificationAsync: async ({ identifier, content, trigger }) => {
      const id = identifier || `auto-${os.scheduled.size}`;
      os.scheduleCalls.push(id);
      os.scheduled.set(id, { content, trigger });
      return id;
    },
    cancelScheduledNotificationAsync: async (id) => {
      os.cancelCalls.push(id);
      os.scheduled.delete(id);
    },
    getAllScheduledNotificationsAsync: async () =>
      [...os.scheduled.entries()].map(([identifier, v]) => ({ identifier, ...v })),
  };
  return os;
}

let disk = new Map();

function boot(os) {
  stubs['expo-notifications'] = os.module;
  stubs['react-native'] = { Platform: { OS: 'android' }, Linking: { openSettings: async () => {} } };
  stubs['@react-native-async-storage/async-storage'] = {
    getItem: async (k) => (disk.has(k) ? disk.get(k) : null),
    setItem: async (k, v) => void disk.set(k, v),
    removeItem: async (k) => void disk.delete(k),
    multiRemove: async (ks) => ks.forEach((k) => disk.delete(k)),
  };
  for (const f of ['nativeNotifications.native.js', 'notifications.js', 'notificationSchedule.js', 'storage.js', 'transit/leaveTime.js']) {
    delete require.cache[require.resolve(path.join(__dirname, f))];
  }
  const native = require(path.join(__dirname, 'nativeNotifications.native.js'));
  stubs['./nativeNotifications'] = native;
  return {
    notifications: require(path.join(__dirname, 'notifications.js')),
    schedule: require(path.join(__dirname, 'notificationSchedule.js')),
    leaveTime: require(path.join(__dirname, 'transit/leaveTime.js')),
  };
}

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
}

const ride = (id, minsFromNow, line = '54') => ({
  id,
  lineNumber: line,
  agency: 'דן בדרום',
  headsign: '',
  boardStopName: 'אריה תגר/אריאל שרון',
  boardStopCode: 1002,
  departure: new Date(clock + minsFromNow * 60_000).toISOString(),
  alightStopName: 'שדרות הציונות/אהרון חייבי',
  alightStopCode: 2001,
  arrival: new Date(clock + (minsFromNow + 18) * 60_000).toISOString(),
  scheduleDate: '2026-08-20',
});

const leaveContent = (plan) => ({
  title: '🚀 זמן לצאת',
  body: `קו ${plan.option.lineNumber} יוצא מ"${plan.option.boardStopName}" ב-${L.clockTime(plan.departureAt)}`,
  url: '/destination/e2e/check',
  tag: 'leave:e2e',
});

let L; // leaveTime, set after boot

async function main() {
  disk = new Map();
  const os = makeOs();
  const app = boot(os);
  L = app.leaveTime;
  const S = app.schedule;

  const ids = () => [...os.scheduled.keys()].sort();
  const triggerOf = (id) => os.scheduled.get(id)?.trigger;

  /* ---- 7/8/9/10 · the ride, its departure, the walk, the leave time ------- */
  // 300 m to the boarding stop — the distance the stop search measured.
  const plan = L.planLeaveTime({ option: ride('5001:3', 26), metresFromUser: 300, now: clock });
  check('7 · the next ride is the one planned for', plan.option.id, '5001:3');
  check('8 · its departure', L.clockTime(plan.departureAt), '17:46');
  check('9 · 300 m → four walking minutes', plan.walkMinutes, 4);
  check('10 · leave at departure − walk − margin', L.clockTime(plan.leaveAt), '17:37');
  check('10b · and the countdown', L.timeLeftPhrase(plan.minutesUntilLeave), 'יש לך כ־17 דקות');

  /* ---- 11/12 · arming it hands the notification to the OS ----------------- */
  const armed = await S.scheduleLeaveReminder({
    destinationId: 'e2e',
    content: leaveContent(plan),
    at: plan.leaveAt,
    rideKey: S.leaveRideKey(plan.option.id, plan.leaveAt),
    now: clock,
  });
  check('11 · armed', armed.status, 'scheduled');
  check('12 · the OS is holding it', ids(), ['dontforget:leave:e2e']);
  check('12b · as a one-off at the leave moment', triggerOf('dontforget:leave:e2e'), {
    type: 'date',
    date: new Date(plan.leaveAt),
    channelId: 'departures',
  });
  check('12c · with the real ride in the message', os.scheduled.get('dontforget:leave:e2e').content.body, 'קו 54 יוצא מ"אריה תגר/אריאל שרון" ב-17:46');

  /* ---- 13 · the bus time changes ----------------------------------------- */
  os.cancelCalls.length = 0;
  const moved = L.planLeaveTime({ option: ride('5001:3', 40), metresFromUser: 300, now: clock });
  check('13 · the leave time moved with it', L.clockTime(moved.leaveAt), '17:51');
  const rescheduled = await S.scheduleLeaveReminder({
    destinationId: 'e2e',
    content: leaveContent(moved),
    at: moved.leaveAt,
    rideKey: S.leaveRideKey(moved.option.id, moved.leaveAt),
    now: clock,
  });
  check('13b · rescheduled', rescheduled.status, 'scheduled');
  check('13c · the old notification was withdrawn first', os.cancelCalls, ['dontforget:leave:e2e']);
  check('13d · exactly one pending, not two', ids(), ['dontforget:leave:e2e']);
  check('13e · at the new moment', triggerOf('dontforget:leave:e2e').date, new Date(moved.leaveAt));
  check('13f · and the message carries the new departure', os.scheduled.get('dontforget:leave:e2e').content.body.includes('18:00'), true);

  /* ---- 14 · the user cancels --------------------------------------------- */
  check('14 · cancelled', await S.cancelLeaveReminder('e2e'), true);
  check('14b · withdrawn from the OS', ids(), []);
  check('14c · and nothing is remembered as pending', await S.pendingLeaveReminder('e2e'), null);

  /* ---- 15 · the user changes stop ---------------------------------------- */
  // Re-arm for the automatic stop first.
  await S.scheduleLeaveReminder({
    destinationId: 'e2e',
    content: leaveContent(moved),
    at: moved.leaveAt,
    rideKey: S.leaveRideKey(moved.option.id, moved.leaveAt),
    now: clock,
  });
  check('15 · armed again', ids(), ['dontforget:leave:e2e']);

  // A hand-picked stop has no measured distance, so there is no leave time…
  const manual = L.planLeaveTime({ option: ride('5001:3', 40), metresFromUser: undefined, now: clock });
  check('15b · a hand-picked stop yields no calculation', manual, null);
  // …and the app must not leave a reminder pointing at the old stop.
  check('15c · so the pending one is withdrawn', await S.cancelLeaveReminder('e2e'), true);
  check('15d · nothing left holding the old stop', ids(), []);

  // Picking a different stop that *does* have a measured distance re-arms cleanly.
  const otherStop = {
    ...ride('7001:2', 45, '31'),
    boardStopName: 'רחוקה יותר עם קו',
    boardStopCode: 1003,
  };
  const otherPlan = L.planLeaveTime({ option: otherStop, metresFromUser: 500, now: clock });
  check('15e · the new stop has its own walk', otherPlan.walkMinutes, 6);
  check('15f · and its own leave time', L.clockTime(otherPlan.leaveAt), '17:54');
  await S.scheduleLeaveReminder({
    destinationId: 'e2e',
    content: leaveContent(otherPlan),
    at: otherPlan.leaveAt,
    rideKey: S.leaveRideKey(otherPlan.option.id, otherPlan.leaveAt),
    now: clock,
  });
  check('15g · one pending, for the new stop', os.scheduled.get('dontforget:leave:e2e').content.body.includes('רחוקה יותר עם קו'), true);
  check('15h · still exactly one', ids().length, 1);

  /* ---- 16 · the departure is finished ------------------------------------ */
  check('16 · finishing the departure withdraws it', await S.cancelLeaveReminder('e2e'), true);
  check('16b · nothing pending', ids(), []);

  // And a reconcile after the fact does not resurrect it.
  const destination = {
    id: 'e2e',
    name: 'בית ספר אשקלון',
    icon: '🏫',
    favorite: false,
    items: [],
    createdAt: 1,
    reminder: { enabled: true, time: '07:30', days: [0, 1] },
  };
  await S.reconcileReminders({ destinations: [destination], enabled: true, now: new Date(clock) });
  check('16c · a reconcile leaves only the daily reminders', ids(), [
    'dontforget:reminder:e2e:0',
    'dontforget:reminder:e2e:1',
  ]);

  /* ---- 16d · a stranded reminder is cleaned up on next launch ------------- */
  await S.scheduleLeaveReminder({
    destinationId: 'e2e',
    content: leaveContent(otherPlan),
    at: clock + 10 * 60_000,
    rideKey: 'x@1',
    now: clock,
  });
  check('16d · pending again', ids().length, 3);
  // The app is closed; the moment passes; it reopens.
  clock += 20 * 60_000;
  const relaunch = boot(os);
  await relaunch.schedule.reconcileReminders({
    destinations: [destination],
    enabled: true,
    now: new Date(clock),
  });
  check('16e · a leave reminder whose moment passed does not linger', ids(), [
    'dontforget:reminder:e2e:0',
    'dontforget:reminder:e2e:1',
  ]);

  /* ---- edge · the bus is already too close to catch ---------------------- */
  const tooClose = L.planLeaveTime({ option: ride('9001:3', 6), metresFromUser: 300, now: clock });
  check('edge · a bus 6 minutes out cannot be caught', tooClose.status, 'too-late');
  check('edge b · no negative countdown', tooClose.minutesUntilLeave, 0);
  const refused = await S.scheduleLeaveReminder({
    destinationId: 'e2e',
    content: leaveContent(tooClose),
    at: tooClose.leaveAt,
    rideKey: 'late@1',
    now: clock,
  });
  check('edge c · and no reminder is scheduled for a moment already gone', refused, {
    status: 'skipped',
    reason: 'in-the-past',
  });

  /* ---- edge · no rides at all ------------------------------------------- */
  check('edge d · no ride → nothing to plan', L.nextCatchableRide({ options: [], metresFromUser: 300, now: clock }), null);

  /* ---- edge · no real-time data ----------------------------------------- */
  const noLive = L.planLeaveTime({ option: ride('5001:3', 26), metresFromUser: 300, now: clock });
  check('edge e · without live data the time is marked as planned', noLive.timing, 'scheduled');
  const withLive = L.planLeaveTime({ option: ride('5001:3', 26), metresFromUser: 300, live: true, now: clock });
  check('edge f · with live data only the label changes', [withLive.timing, withLive.leaveAt === noLive.leaveAt], ['live', true]);

  /* ---- edge · notifications refused ------------------------------------- */
  os.permission = { status: 'denied', granted: false, canAskAgain: false };
  const denied = boot(os);
  const blocked = await denied.schedule.scheduleLeaveReminder({
    destinationId: 'e2e',
    content: leaveContent(noLive),
    at: clock + 15 * 60_000,
    rideKey: 'd@1',
    now: clock,
  });
  check('edge g · refused permission → no reminder, and it says why', blocked, {
    status: 'skipped',
    reason: 'not-granted',
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
