/*
 * The step-15 fix, at scheduler level: changing stop must withdraw the pending
 * "time to leave", and a cancel must never clobber a later arm.
 *
 * Runs the real compiled src/notificationSchedule.ts against a fake OS whose
 * calls are deliberately slow, so any ordering mistake shows up instead of
 * hiding behind fast promises.
 */
const Module = require('module');
const path = require('path');

const stubs = {};
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return realLoad(request, parent, isMain);
};

const clock = new Date('2026-08-20T18:00:00').getTime();
Date.now = () => clock;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeOs({ scheduleDelay = 0, cancelDelay = 0 } = {}) {
  const os = { scheduled: new Map(), order: [] };
  os.permission = { status: 'granted', granted: true, canAskAgain: true };
  os.module = {
    PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
    IosAuthorizationStatus: { PROVISIONAL: 'PROVISIONAL' },
    AndroidImportance: { HIGH: 4 },
    SchedulableTriggerInputTypes: { DATE: 'date', WEEKLY: 'weekly', TIME_INTERVAL: 'timeInterval' },
    setNotificationHandler: () => {},
    setNotificationChannelAsync: async () => ({}),
    getPermissionsAsync: async () => os.permission,
    requestPermissionsAsync: async () => os.permission,
    scheduleNotificationAsync: async ({ identifier, content, trigger }) => {
      await sleep(scheduleDelay);
      const id = identifier || `auto-${os.scheduled.size}`;
      os.order.push(`schedule:${id}`);
      os.scheduled.set(id, { content, trigger });
      return id;
    },
    cancelScheduledNotificationAsync: async (id) => {
      await sleep(cancelDelay);
      os.order.push(`cancel:${id}`);
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
  stubs['./nativeNotifications'] = require(path.join(__dirname, 'nativeNotifications.native.js'));
  return {
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

/** A ride from a named stop. */
const rideFrom = (stopCode, stopName, id, minsFromNow, line = '54') => ({
  id,
  lineNumber: line,
  agency: 'דן בדרום',
  headsign: '',
  boardStopName: stopName,
  boardStopCode: stopCode,
  departure: new Date(clock + minsFromNow * 60_000).toISOString(),
  alightStopName: 'שדרות הציונות',
  alightStopCode: 2001,
  arrival: new Date(clock + (minsFromNow + 18) * 60_000).toISOString(),
  scheduleDate: '2026-08-20',
});

const contentFor = (plan, L) => ({
  title: '🚀 זמן לצאת',
  body: `קו ${plan.option.lineNumber} יוצא מ"${plan.option.boardStopName}" ב-${L.clockTime(plan.departureAt)}`,
  url: '/destination/e2e/check',
  tag: 'leave:e2e',
});

async function main() {
  /* ============ the ordering guarantee: cancel can never clobber a later arm */
  {
    disk = new Map();
    // A slow cancel and a fast schedule — the shape that used to lose the arm.
    const os = makeOs({ cancelDelay: 60, scheduleDelay: 5 });
    const app = boot(os);
    const L = app.leaveTime;
    const S = app.schedule;

    const planA = L.planLeaveTime({ option: rideFrom(1002, 'תחנה A', 'rA', 30), metresFromUser: 300, now: clock });
    await S.scheduleLeaveReminder({
      destinationId: 'e2e', content: contentFor(planA, L), at: planA.leaveAt,
      rideKey: S.leaveRideKey('rA', planA.leaveAt), now: clock,
    });
    os.order.length = 0;

    // The user changes stop (cancel starts) and immediately arms for the new one.
    const planB = L.planLeaveTime({ option: rideFrom(1003, 'תחנה B', 'rB', 40), metresFromUser: 500, now: clock });
    const cancelling = S.cancelLeaveReminder('e2e');
    const arming = S.scheduleLeaveReminder({
      destinationId: 'e2e', content: contentFor(planB, L), at: planB.leaveAt,
      rideKey: S.leaveRideKey('rB', planB.leaveAt), now: clock,
    });
    await Promise.all([cancelling, arming]);

    check('1 · the cancel ran before the arm', os.order[0], 'cancel:dontforget:leave:e2e');
    check('1b · and the arm survived it', [...os.scheduled.keys()], ['dontforget:leave:e2e']);
    check('1c · holding the NEW stop', os.scheduled.get('dontforget:leave:e2e').content.body.includes('תחנה B'), true);
    check('1d · not the old one', os.scheduled.get('dontforget:leave:e2e').content.body.includes('תחנה A'), false);
    const pending = await S.pendingLeaveReminder('e2e');
    check('1e · and the record agrees', pending.rideKey, `rB@${planB.leaveAt}`);
  }

  /* ================= the reverse order still ends with nothing pending */
  {
    disk = new Map();
    const os = makeOs({ cancelDelay: 5, scheduleDelay: 60 });
    const app = boot(os);
    const L = app.leaveTime;
    const S = app.schedule;
    const plan = L.planLeaveTime({ option: rideFrom(1002, 'תחנה A', 'rA', 30), metresFromUser: 300, now: clock });

    const arming = S.scheduleLeaveReminder({
      destinationId: 'e2e', content: contentFor(plan, L), at: plan.leaveAt,
      rideKey: S.leaveRideKey('rA', plan.leaveAt), now: clock,
    });
    const cancelling = S.cancelLeaveReminder('e2e');
    await Promise.all([arming, cancelling]);

    check('2 · arm then cancel → the cancel wins, in order', os.order, [
      'schedule:dontforget:leave:e2e',
      'cancel:dontforget:leave:e2e',
    ]);
    check('2b · nothing pending', [...os.scheduled.keys()], []);
    check('2c · nothing remembered', await S.pendingLeaveReminder('e2e'), null);
  }

  /* ============== several arms at once still leave exactly one notification */
  {
    disk = new Map();
    const os = makeOs({ scheduleDelay: 15, cancelDelay: 15 });
    const app = boot(os);
    const L = app.leaveTime;
    const S = app.schedule;

    const plans = [1001, 1002, 1003, 1004].map((code, i) =>
      L.planLeaveTime({ option: rideFrom(code, `תחנה ${code}`, `r${i}`, 30 + i * 5), metresFromUser: 300, now: clock }),
    );
    await Promise.all(
      plans.map((p, i) =>
        S.scheduleLeaveReminder({
          destinationId: 'e2e', content: contentFor(p, L), at: p.leaveAt,
          rideKey: S.leaveRideKey(`r${i}`, p.leaveAt), now: clock,
        }),
      ),
    );
    check('3 · four overlapping arms → one notification', [...os.scheduled.keys()], ['dontforget:leave:e2e']);
    check('3b · and it is the last one asked for', os.scheduled.get('dontforget:leave:e2e').content.body.includes('תחנה 1004'), true);
  }

  /* ============ two destinations do not block or clobber each other */
  {
    disk = new Map();
    const os = makeOs({ scheduleDelay: 20 });
    const app = boot(os);
    const L = app.leaveTime;
    const S = app.schedule;
    const p1 = L.planLeaveTime({ option: rideFrom(1002, 'A', 'r1', 30), metresFromUser: 300, now: clock });
    const p2 = L.planLeaveTime({ option: rideFrom(2002, 'B', 'r2', 35), metresFromUser: 300, now: clock });
    await Promise.all([
      S.scheduleLeaveReminder({ destinationId: 'one', content: contentFor(p1, L), at: p1.leaveAt, rideKey: 'r1@1', now: clock }),
      S.scheduleLeaveReminder({ destinationId: 'two', content: contentFor(p2, L), at: p2.leaveAt, rideKey: 'r2@1', now: clock }),
    ]);
    check('4 · separate destinations keep separate reminders', [...os.scheduled.keys()].sort(), [
      'dontforget:leave:one',
      'dontforget:leave:two',
    ]);
    // Cancelling one leaves the other alone.
    await S.cancelLeaveReminder('one');
    check('4b · cancelling one does not touch the other', [...os.scheduled.keys()], ['dontforget:leave:two']);
  }

  /* ============ the step-15 sequence, end to end at scheduler level */
  {
    disk = new Map();
    const os = makeOs();
    const app = boot(os);
    const L = app.leaveTime;
    const S = app.schedule;

    // 1–3 · stop A found, armed, pending.
    const planA = L.planLeaveTime({ option: rideFrom(1002, 'אריה תגר/אריאל שרון', 'rA', 26), metresFromUser: 300, now: clock });
    await S.scheduleLeaveReminder({
      destinationId: 'e2e', content: contentFor(planA, L), at: planA.leaveAt,
      rideKey: S.leaveRideKey('rA', planA.leaveAt), now: clock,
    });
    check('5 · A is pending', (await S.pendingLeaveReminder('e2e')).rideKey, `rA@${planA.leaveAt}`);

    // 4–5 · the user switches to stop B. The hook cancels; here that call.
    await S.cancelLeaveReminder('e2e');
    check('5b · A is withdrawn from the OS', [...os.scheduled.keys()], []);
    check('5c · and its record is gone', await S.pendingLeaveReminder('e2e'), null);

    // 6–7 · A's moment arrives with nothing scheduled for it.
    check('5d · nothing is left that could fire for A', os.scheduled.size, 0);

    // 8–9 · the user arms 🔔 for B.
    const planB = L.planLeaveTime({ option: rideFrom(1003, 'רחוקה יותר עם קו', 'rB', 45), metresFromUser: 500, now: clock });
    await S.scheduleLeaveReminder({
      destinationId: 'e2e', content: contentFor(planB, L), at: planB.leaveAt,
      rideKey: S.leaveRideKey('rB', planB.leaveAt), now: clock,
    });
    check('5e · only B is pending', [...os.scheduled.keys()], ['dontforget:leave:e2e']);
    check('5f · naming B', os.scheduled.get('dontforget:leave:e2e').content.body.includes('רחוקה יותר עם קו'), true);
    check('5g · B has its own walk and leave time', [planB.walkMinutes, L.clockTime(planB.leaveAt)], [6, '18:34']);

    // 10–11 · change stop again: no old reminders left behind.
    await S.cancelLeaveReminder('e2e');
    check('5h · nothing pending after the second change', [...os.scheduled.keys()], []);
    check('5i · and nothing remembered', await S.pendingLeaveReminder('e2e'), null);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
