/*
 * Tests for the settings defaults, and — more importantly — for the rule that a
 * default never overrides a choice.
 *
 * Changing a default is easy to get wrong in exactly one way: applying it on
 * every load instead of only when the value is missing, which silently switches
 * something back on for somebody who deliberately turned it off. These run the
 * real `loadSettings` against a stubbed AsyncStorage so that cannot happen
 * unnoticed.
 */
const Module = require('module');
const path = require('path');

const stubs = {};
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return realLoad(request, parent, isMain);
};

const FILES = ['storage.js', 'types.js'];

/** Loads the storage layer over a given disk. */
function boot(disk) {
  stubs['@react-native-async-storage/async-storage'] = {
    getItem: async (k) => (disk.has(k) ? disk.get(k) : null),
    setItem: async (k, v) => void disk.set(k, v),
    removeItem: async (k) => void disk.delete(k),
    multiRemove: async (keys) => keys.forEach((k) => disk.delete(k)),
  };
  for (const f of FILES) delete require.cache[require.resolve(path.join(__dirname, f))];
  return {
    storage: require(path.join(__dirname, 'storage.js')),
    types: require(path.join(__dirname, 'types.js')),
  };
}

const KEY = 'dont-forget:settings:v1';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
}

async function main() {
  /* ======================================== 1 · a brand-new user */
  {
    const disk = new Map();
    const { storage } = boot(disk);
    const settings = await storage.loadSettings();
    check('1 · new user: notifications are ON', settings.notifications, true);
    check('2 · new user: open navigation automatically is ON', settings.autoOpenWaze, true);
    check('1b · and the name starts empty', settings.userName, '');
    check('1c · nothing was written just by reading', disk.size, 0);
  }

  /* ================= 3 · an existing user who turned notifications OFF */
  {
    const disk = new Map([[KEY, JSON.stringify({ userName: 'שמעון', notifications: false, autoOpenWaze: false })]]);
    const { storage } = boot(disk);
    const settings = await storage.loadSettings();
    check('3 · notifications stay OFF', settings.notifications, false);
    check('4 · navigation stays OFF', settings.autoOpenWaze, false);
    check('3b · and the name is kept', settings.userName, 'שמעון');
  }

  /* ============ the same, one field at a time, so neither can mask the other */
  {
    const onlyNotificationsOff = new Map([[KEY, JSON.stringify({ notifications: false })]]);
    const a = await boot(onlyNotificationsOff).storage.loadSettings();
    check('3c · notifications OFF is respected on its own', a.notifications, false);
    check('3d · while the missing navigation value takes the new default', a.autoOpenWaze, true);

    const onlyNavigationOff = new Map([[KEY, JSON.stringify({ autoOpenWaze: false })]]);
    const b = await boot(onlyNavigationOff).storage.loadSettings();
    check('4c · navigation OFF is respected on its own', b.autoOpenWaze, false);
    check('4d · while the missing notifications value takes its default', b.notifications, true);
  }

  /* ==== a default fills in only what is missing, never what is present ==== */
  {
    // Both switched on explicitly: indistinguishable from the default, but it
    // must still round-trip rather than being "corrected".
    const on = new Map([[KEY, JSON.stringify({ notifications: true, autoOpenWaze: true })]]);
    const settings = await boot(on).storage.loadSettings();
    check('5 · explicit ON round-trips', [settings.notifications, settings.autoOpenWaze], [true, true]);

    // A value of the wrong type is not a choice, so the default applies.
    const junk = new Map([[KEY, JSON.stringify({ notifications: 'yes', autoOpenWaze: 0 })]]);
    const fixed = await boot(junk).storage.loadSettings();
    check('5b · a non-boolean is not a choice — the default applies', [fixed.notifications, fixed.autoOpenWaze], [true, true]);

    // And a corrupt file falls back whole rather than throwing.
    const corrupt = new Map([[KEY, '{not json']]);
    const recovered = await boot(corrupt).storage.loadSettings();
    check('5c · a corrupt file falls back to the defaults', [recovered.notifications, recovered.autoOpenWaze], [true, true]);
  }

  /* ================== 6 · a manual change survives a reload ============== */
  {
    const disk = new Map();
    const first = boot(disk);
    // Straight from the defaults, the user turns both off.
    const initial = await first.storage.loadSettings();
    check('6 · starts from the defaults', [initial.notifications, initial.autoOpenWaze], [true, true]);
    await first.storage.saveSettings({ ...initial, notifications: false, autoOpenWaze: false });

    // Restart: fresh modules, same disk.
    const second = boot(disk);
    const reloaded = await second.storage.loadSettings();
    check('6b · both choices survive the restart', [reloaded.notifications, reloaded.autoOpenWaze], [false, false]);

    // And again, because a default applied on every load would only show up
    // on the second reload in some implementations.
    const third = boot(disk);
    const again = await third.storage.loadSettings();
    check('6c · and the one after that', [again.notifications, again.autoOpenWaze], [false, false]);
  }

  /* ================ 7 · deleting everything gives a new user again ======= */
  {
    const disk = new Map();
    const app = boot(disk);
    await app.storage.saveSettings({ userName: 'שמעון', notifications: false, autoOpenWaze: false });
    check('7 · the choice was stored', disk.has(KEY), true);

    await app.storage.clearAllData();
    check('7b · and wiped', disk.has(KEY), false);

    const after = await boot(disk).storage.loadSettings();
    check('7c · a wiped install is a new user: notifications ON', after.notifications, true);
    check('7d · navigation ON', after.autoOpenWaze, true);
    check('7e · and no name', after.userName, '');
  }

  /* ============= 8 · the exported defaults say the same thing ============ */
  {
    const { types } = boot(new Map());
    check('8 · defaultSettings agrees', [types.defaultSettings.notifications, types.defaultSettings.autoOpenWaze], [true, true]);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
