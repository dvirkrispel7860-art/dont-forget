/*
 * Harness for src/location.ts's NATIVE path.
 *
 * The real compiled module is loaded with `react-native` and `expo-location`
 * replaced by stubs, so the iOS/Android branch can be exercised without a device.
 */
const Module = require('module');
const path = require('path');

const stubs = {};
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs[request]) return stubs[request];
  return realLoad(request, parent, isMain);
};

const MODULE = path.join(__dirname, 'location.js');

let now = 1_700_000_000_000;
const realNow = Date.now;
Date.now = () => now;

/** Fresh module (so the remembered fix slot is empty) with these stubs. */
function load({ os = 'ios', expo = {}, navigator: nav, openSettings } = {}) {
  stubs['react-native'] = {
    Platform: { OS: os },
    Linking: { openSettings: openSettings || (async () => {}) },
  };
  stubs['expo-location'] = {
    PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
    Accuracy: { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 },
    getForegroundPermissionsAsync: async () => ({ status: 'granted', granted: true, canAskAgain: true }),
    requestForegroundPermissionsAsync: async () => ({ status: 'granted', granted: true, canAskAgain: true }),
    hasServicesEnabledAsync: async () => true,
    getCurrentPositionAsync: async () => ({
      coords: { latitude: 32.1, longitude: 34.8, accuracy: 12 },
      timestamp: now,
    }),
    ...expo,
  };
  global.navigator = nav;
  delete require.cache[require.resolve(MODULE)];
  return require(MODULE);
}

const perm = (status) => ({ status, granted: status === 'granted', canAskAgain: true });
function coded(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

let pass = 0;
let fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
}

async function main() {
  /* ------------------------------------------------------ native: happy path */
  {
    const L = load();
    const r = await L.getCurrentLocation();
    check('native 1 · granted + fix → ok', r, {
      status: 'ok',
      location: { latitude: 32.1, longitude: 34.8, accuracy: 12, at: now },
      stale: false,
    });
  }

  /* ------------------------------------------------------- native: refusal  */
  {
    let asked = 0;
    const L = load({
      expo: {
        getForegroundPermissionsAsync: async () => ({ ...perm('denied'), canAskAgain: false }),
        requestForegroundPermissionsAsync: async () => { asked++; return perm('denied'); },
        getCurrentPositionAsync: async () => { throw new Error('must not be called'); },
      },
    });
    const r = await L.getCurrentLocation();
    check('native 2 · finally denied → denied', r, { status: 'error', reason: 'denied' });
    check('native 2b · a final refusal is not asked again', asked, 0);
  }

  /* ------------------- native: refused once, platform still willing to ask  */
  {
    let asked = 0;
    const L = load({
      expo: {
        getForegroundPermissionsAsync: async () => ({ ...perm('denied'), canAskAgain: true }),
        requestForegroundPermissionsAsync: async () => { asked++; return perm('granted'); },
      },
    });
    const r = await L.getCurrentLocation();
    check('native 2c · denied but askable → asks again', asked, 1);
    check('native 2d · and succeeds when allowed', r.status, 'ok');
  }

  /* -------------------------------- native: undetermined → prompt → granted */
  {
    let asked = 0;
    const L = load({
      expo: {
        getForegroundPermissionsAsync: async () => perm('undetermined'),
        requestForegroundPermissionsAsync: async () => { asked++; return perm('granted'); },
      },
    });
    const r = await L.getCurrentLocation();
    check('native 3 · undetermined → prompts once', asked, 1);
    check('native 3b · then returns the fix', r.status, 'ok');
  }

  /* ------------------------------ native: undetermined → prompt → refused   */
  {
    const L = load({
      expo: {
        getForegroundPermissionsAsync: async () => perm('undetermined'),
        requestForegroundPermissionsAsync: async () => perm('denied'),
        getCurrentPositionAsync: async () => { throw new Error('must not be called'); },
      },
    });
    check('native 4 · prompt refused → denied', await L.getCurrentLocation(), {
      status: 'error',
      reason: 'denied',
    });
  }

  /* --------------------------------------------------- native: GPS switched off */
  {
    let asked = 0;
    const L = load({
      expo: {
        hasServicesEnabledAsync: async () => false,
        getForegroundPermissionsAsync: async () => { asked++; return perm('undetermined'); },
        getCurrentPositionAsync: async () => { throw new Error('must not be called'); },
      },
    });
    check('native 5 · services off → services-off (not denied)', await L.getCurrentLocation(), {
      status: 'error',
      reason: 'services-off',
    });
    check('native 5b · services off does not prompt for permission', asked, 0);
  }

  /* ----------------------------------- native: error-code classification    */
  {
    const cases = [
      ['ERR_LOCATION_UNAUTHORIZED', 'denied'],
      ['ERR_DENIED_FOREGROUND_LOCATION_PERMISSION', 'denied'],
      ['ERR_LOCATION_SERVICES_DISABLED', 'services-off'],
      ['ERR_LOCATION_SETTINGS_UNSATISFIED', 'services-off'],
      ['ERR_LOCATION_UNAVAILABLE', 'failed'],
      ['ERR_LOCATION_UNKNOWN', 'failed'],
      ['ERR_LOCATION_REQUEST_CANCELLED', 'failed'],
      ['ERR_CURRENT_LOCATION_IS_UNAVAILABLE', 'failed'],
    ];
    for (const [code, want] of cases) {
      const L = load({
        expo: { getCurrentPositionAsync: async () => { throw coded(code); } },
      });
      const r = await L.getCurrentLocation();
      check(`native 6 · ${code} → ${want}`, r, { status: 'error', reason: want });
    }
    // A plain, code-less failure.
    const L = load({
      expo: { getCurrentPositionAsync: async () => { throw new Error('boom'); } },
    });
    check('native 6 · unknown error → failed', await L.getCurrentLocation(), {
      status: 'error',
      reason: 'failed',
    });
  }

  /* ------------------------------------------------------- native: timeout  */
  {
    const L = load({
      expo: { getCurrentPositionAsync: () => new Promise(() => {}) },
    });
    const started = realNow();
    const r = await L.getCurrentLocation({ timeoutMs: 60 });
    check('native 7 · no fix in time → timeout', r, { status: 'error', reason: 'timeout' });
    check('native 7b · gave up quickly', realNow() - started < 2000, true);
  }

  /* --------------------------------------------- last fix: fresh reuse      */
  {
    let reads = 0;
    const L = load({
      expo: {
        getCurrentPositionAsync: async () => {
          reads++;
          return { coords: { latitude: 1 + reads, longitude: 2, accuracy: 5 }, timestamp: now };
        },
      },
    });
    const first = await L.getCurrentLocation();
    now += 30_000; // half a minute later
    const second = await L.getCurrentLocation();
    check('lastfix 8 · a 30s-old fix is reused', reads, 1);
    check('lastfix 8b · and is the same point', second.location, first.location);
    check('lastfix 8c · not flagged stale', second.stale, false);

    now += 40_000; // now 70s old — past the fresh window
    const third = await L.getCurrentLocation();
    check('lastfix 8d · past 60s the device is read again', reads, 2);
    check('lastfix 8e · new point returned', third.location.latitude, 3);
  }

  /* ------------------------------- last fix: stands in when GPS fails       */
  {
    let ok = true;
    const L = load({
      expo: {
        getCurrentPositionAsync: async () => {
          if (!ok) throw coded('ERR_LOCATION_UNAVAILABLE');
          return { coords: { latitude: 9, longitude: 8, accuracy: 5 }, timestamp: now };
        },
      },
    });
    await L.getCurrentLocation();
    ok = false;

    now += 120_000; // two minutes later: past fresh, inside the stale limit
    const stale = await L.getCurrentLocation();
    check('lastfix 9 · GPS fails at 2 min → remembered fix stands in', stale, {
      status: 'ok',
      location: { latitude: 9, longitude: 8, accuracy: 5, at: now - 120_000 },
      stale: true,
    });

    now += 4 * 60_000; // six minutes old in total — past the limit
    check('lastfix 10 · past 5 min the old fix is refused', await L.getCurrentLocation(), {
      status: 'error',
      reason: 'failed',
    });
    check('lastfix 10b · and it is gone from lastKnownLocation', L.lastKnownLocation(), null);
  }

  /* --------------------------- last fix: never used to paper over a refusal */
  {
    let granted = true;
    const L = load({
      expo: {
        getForegroundPermissionsAsync: async () =>
          granted ? perm('granted') : { ...perm('denied'), canAskAgain: false },
      },
    });
    await L.getCurrentLocation();
    granted = false;
    now += 90_000; // inside the stale window
    check('lastfix 11 · a refusal is never answered with the old fix', await L.getCurrentLocation(), {
      status: 'error',
      reason: 'denied',
    });
  }

  /* ------------------------------------- last fix: forgetLastLocation clears */
  {
    const L = load();
    await L.getCurrentLocation();
    check('lastfix 12 · remembered', L.lastKnownLocation() !== null, true);
    L.forgetLastLocation();
    check('lastfix 12b · forgotten on request', L.lastKnownLocation(), null);
  }

  /* --------------------------------------- native: permission status states */
  {
    for (const [status, want] of [
      ['granted', 'granted'],
      ['denied', 'denied'],
      ['undetermined', 'unknown'],
    ]) {
      const L = load({ expo: { getForegroundPermissionsAsync: async () => perm(status) } });
      check(`perm 13 · native ${status} → ${want}`, await L.getLocationPermissionStatus(), want);
    }
    const L = load({
      expo: { getForegroundPermissionsAsync: async () => { throw new Error('no module'); } },
    });
    check('perm 13 · native throw → unknown', await L.getLocationPermissionStatus(), 'unknown');
  }

  /* ------------------------------------------- native: requestLocationPermission */
  {
    let asked = 0;
    const L = load({
      expo: {
        requestForegroundPermissionsAsync: async () => { asked++; return perm('granted'); },
      },
    });
    check('perm 14 · request → granted', await L.requestLocationPermission(), 'granted');
    check('perm 14b · asked the platform once', asked, 1);
  }

  /* ------------------------------------------------- native: system settings */
  {
    let opened = 0;
    const L = load({ openSettings: async () => { opened++; } });
    check('settings 15 · native can open system settings', L.canOpenLocationSettings(), true);
    check('settings 15b · opening works', await L.openLocationSettings(), true);
    check('settings 15c · it called Linking.openSettings', opened, 1);

    const F = load({ openSettings: async () => { throw new Error('nope'); } });
    check('settings 15d · a failure is reported, not thrown', await F.openLocationSettings(), false);
  }

  /* ------------------------------------------------------------------- web  */
  {
    const geo = (mode) => ({
      getCurrentPosition: (ok, bad) => {
        if (mode === 'ok') {
          return ok({ coords: { latitude: 31.5, longitude: 34.6, accuracy: 44 }, timestamp: now });
        }
        const codes = { denied: 1, unavailable: 2, timeout: 3 };
        bad({ code: codes[mode], PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
      },
    });

    let L = load({ os: 'web', navigator: { geolocation: geo('ok') } });
    check('web 16 · fix → ok', await L.getCurrentLocation(), {
      status: 'ok',
      location: { latitude: 31.5, longitude: 34.6, accuracy: 44, at: now },
      stale: false,
    });
    check('web 16b · web cannot open system settings', L.canOpenLocationSettings(), false);

    for (const [mode, want] of [
      ['denied', 'denied'],
      ['unavailable', 'services-off'],
      ['timeout', 'timeout'],
    ]) {
      L = load({ os: 'web', navigator: { geolocation: geo(mode) } });
      check(`web 17 · ${mode} → ${want}`, await L.getCurrentLocation(), {
        status: 'error',
        reason: want,
      });
    }

    L = load({ os: 'web', navigator: {} });
    check('web 18 · no geolocation API → unavailable', await L.getCurrentLocation(), {
      status: 'error',
      reason: 'unavailable',
    });
    check('web 18b · and the permission reads unavailable', await L.getLocationPermissionStatus(), 'unavailable');

    L = load({ os: 'web', navigator: { geolocation: geo('ok') } });
    check('web 19 · no Permissions API → unknown, without asking', await L.getLocationPermissionStatus(), 'unknown');

    for (const [state, want] of [['granted', 'granted'], ['denied', 'denied'], ['prompt', 'unknown']]) {
      L = load({
        os: 'web',
        navigator: { geolocation: geo('ok'), permissions: { query: async () => ({ state }) } },
      });
      check(`web 19 · Permissions API "${state}" → ${want}`, await L.getLocationPermissionStatus(), want);
    }

    // Web has no request API: requesting means asking for a position.
    L = load({ os: 'web', navigator: { geolocation: geo('denied') } });
    check('web 20 · request refused → denied', await L.requestLocationPermission(), 'denied');

    L = load({
      os: 'web',
      navigator: { geolocation: geo('timeout'), permissions: { query: async () => ({ state: 'prompt' }) } },
    });
    check('web 20b · request timed out → unknown, NOT denied', await L.requestLocationPermission(), 'unknown');
  }

  /* ------------------------------------------- wording differs per failure  */
  {
    const L = load();
    const seen = new Set();
    for (const reason of ['denied', 'services-off', 'timeout', 'unavailable', 'failed']) {
      const message = L.locationErrorMessage(reason);
      check(`wording 21 · "${reason}" has its own message`, seen.has(message), false);
      seen.add(message);
    }
    check('wording 21b · a timeout never mentions permission', /הרשא/.test(L.locationErrorMessage('timeout')), false);
    check('wording 21c · GPS off never mentions permission', /הרשא/.test(L.locationErrorMessage('services-off')), false);
    const labels = ['granted', 'denied', 'unavailable', 'unknown'].map(L.locationPermissionLabel);
    check('wording 21d · four distinct permission labels', new Set(labels).size, 4);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
