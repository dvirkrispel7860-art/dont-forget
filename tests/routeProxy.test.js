/*
 * Tests for the route search server's client side, and for journeys with a change.
 *
 * The proxy is what makes a change possible at all — assembling one from
 * stop_times costs about 14 MB on a phone, so the search runs on a server. These
 * cover both halves: that a multi-leg journey is built, timed and scored
 * correctly, and that a proxy which is absent, slow, broken or lying is never
 * allowed to become an error the user sees.
 */
const path = require('path');

const FILES = ['transit/routeProxy.js', 'transit/routePlanner.js', 'transit/walking.js'];

/** Loads the client fresh, with the endpoint configured or not. */
function load({ endpoint } = {}) {
  if (endpoint) process.env.EXPO_PUBLIC_TRANSIT_ROUTES_ENDPOINT = endpoint;
  else delete process.env.EXPO_PUBLIC_TRANSIT_ROUTES_ENDPOINT;
  for (const f of FILES) delete require.cache[require.resolve(path.join(__dirname, f))];
  return {
    proxy: require(path.join(__dirname, 'transit/routeProxy.js')),
    planner: require(path.join(__dirname, 'transit/routePlanner.js')),
  };
}

const NOW = new Date('2026-08-20T09:00:00').getTime();
const at = (mins) => new Date(NOW + mins * 60_000).toISOString();
const clock = (ms) => new Date(ms).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
}

/** A stop as the server reports it, with a position. */
const stop = (code, name, lat, lon) => ({ code, name, city: 'אשקלון', lat, lon });

/** A leg as the server reports it. */
const leg = ({ id, line, from, to, departsIn, arrivesIn }) => ({
  id,
  lineNumber: line,
  agency: 'דן',
  headsign: 'לכיוון היעד',
  lineRef: 777,
  operatorRef: 25,
  departure: at(departsIn),
  arrival: at(arrivesIn),
  from,
  to,
});

const A = stop(1001, 'תחנה א', 31.7000, 34.5700);
const B = stop(1002, 'תחנה ב', 31.7100, 34.5700); // ~1.1 km from A
const SAME = stop(1003, 'צומת', 31.7050, 34.5750);
const NEARBY = stop(1004, 'צומת ממול', 31.70518, 34.5750); // ~20 m from SAME
const FAR = stop(1005, 'רחוק מהצומת', 31.7150, 34.5750); // ~1.1 km from SAME
const END = stop(2001, 'שדרות הציונות', 31.6957, 34.5845);

async function main() {
  /* ================================ 1 · not configured → never called */
  {
    const { proxy } = load();
    check('1 · reports itself unconfigured', proxy.isRouteProxyConfigured(), false);

    let calls = 0;
    const realFetch = global.fetch;
    global.fetch = async () => {
      calls += 1;
      return { ok: true, json: async () => ({}) };
    };
    const result = await proxy.findRoutesViaProxy({
      from: { latitude: 31.7, longitude: 34.57 },
      to: { latitude: 31.69, longitude: 34.58 },
      now: NOW,
    });
    global.fetch = realFetch;
    check('1b · nothing was sent anywhere', calls, 0);
    check('1c · and it says why', result, { status: 'error', reason: 'not-configured' });
  }

  /* ============================ 2 · a direct journey, end to end */
  {
    const { proxy } = load({ endpoint: 'https://example.invalid/routes' });
    check('2 · configured', proxy.isRouteProxyConfigured(), true);

    const realFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        scheduleDate: '2026-08-20',
        transfersSearched: 1,
        journeys: [
          {
            legs: [leg({ id: 'd1', line: '54', from: A, to: END, departsIn: 10, arrivesIn: 30 })],
            originMetres: 240,
            destinationMetres: 160,
          },
        ],
      }),
    });
    const result = await proxy.findRoutesViaProxy({
      from: { latitude: 31.7, longitude: 34.57 },
      to: { latitude: 31.6957, longitude: 34.5845 },
      now: NOW,
    });
    global.fetch = realFetch;

    check('2b · ok', result.status, 'ok');
    const route = result.routes[0];
    check('2c · one leg, no transfers', [route.legs.length, route.transfers], [1, 0]);
    check('2d · the walk to the stop is counted', route.legs[0].walkBeforeMinutes, 3);
    check('2e · and the walk to the destination', route.legs[0].walkAfterMinutes, 2);
    check('2f · arrival is after the final walk', clock(route.arrivalTime), clock(NOW + 32 * 60_000));
    check('2g · totals add up', route.totalWalkingMinutes + route.totalWaitingMinutes + route.totalRideMinutes, route.totalMinutes);
    check('2h · the leg keeps its line reference, for realtime', route.legs[0].option.lineRef, 777);
  }

  /* ============================ 3 · a journey with one change */
  {
    const { proxy } = load({ endpoint: 'https://example.invalid/routes' });
    const realFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        scheduleDate: '2026-08-20',
        transfersSearched: 1,
        journeys: [
          {
            legs: [
              leg({ id: 'l1', line: '54', from: A, to: SAME, departsIn: 5, arrivesIn: 20 }),
              leg({ id: 'l2', line: '31', from: SAME, to: END, departsIn: 25, arrivesIn: 37 }),
            ],
            originMetres: 160,
            destinationMetres: 80,
          },
        ],
      }),
    });
    const result = await proxy.findRoutesViaProxy({
      from: { latitude: 31.7, longitude: 34.57 },
      to: { latitude: 31.6957, longitude: 34.5845 },
      now: NOW,
    });
    global.fetch = realFetch;

    const route = result.routes[0];
    check('3 · two legs', route.legs.length, 2);
    check('3b · one transfer', route.transfers, 1);
    check('3c · both lines, in order', route.legs.map((l) => l.lineNumber), ['54', '31']);
    check('3d · origin is the first stop, destination the last', [route.originStop.code, route.destinationStop.code], [1001, 2001]);
    check('3e · changing at the same stop is no walk', route.legs[1].walkBeforeMinutes, 0);
    check('3f · ride time is both legs', route.totalRideMinutes, 15 + 12);
    check('3g · the wait at the change is in the waiting total', route.totalWaitingMinutes, route.totalMinutes - route.totalWalkingMinutes - route.totalRideMinutes);
    check('3h · scored with the transfer penalty', route.score, route.totalMinutes + route.totalWalkingMinutes + 5);
    check('3i · only the last leg walks to the destination', [route.legs[0].walkAfterMinutes, route.legs[1].walkAfterMinutes], [0, 1]);
  }

  /* ============ 4 · a change across the road counts as a walk */
  {
    const { proxy } = load({ endpoint: 'https://example.invalid/routes' });
    const realFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        journeys: [
          {
            legs: [
              leg({ id: 'l1', line: '54', from: A, to: FAR, departsIn: 5, arrivesIn: 20 }),
              leg({ id: 'l2', line: '31', from: SAME, to: END, departsIn: 45, arrivesIn: 57 }),
            ],
            originMetres: 80,
            destinationMetres: 80,
          },
        ],
      }),
    });
    const result = await proxy.findRoutesViaProxy({
      from: { latitude: 31.7, longitude: 34.57 },
      to: { latitude: 31.6957, longitude: 34.5845 },
      now: NOW,
    });
    global.fetch = realFetch;
    check('4 · a 1.1 km change is walked, and counted', result.routes[0].legs[1].walkBeforeMinutes > 10, true);
    check('4b · a 20 m change is not', (() => {
      const j = {
        legs: [
          { option: { id: 'a', lineNumber: '54', agency: '', headsign: '', boardStopName: '', boardStopCode: 1, departure: at(5), alightStopName: '', alightStopCode: 2, arrival: at(20), scheduleDate: 'x' }, departureStop: A, arrivalStop: SAME, walkBeforeMinutes: 1 },
          { option: { id: 'b', lineNumber: '31', agency: '', headsign: '', boardStopName: '', boardStopCode: 3, departure: at(25), alightStopName: '', alightStopCode: 4, arrival: at(37), scheduleDate: 'x' }, departureStop: NEARBY, arrivalStop: END, walkBeforeMinutes: 0 },
        ],
        walkAfterMinutes: 1,
      };
      return load().planner.buildJourney({ journey: j, now: NOW }).legs[1].walkBeforeMinutes;
    })(), 0);
  }

  /* ==== 5 · a change there is not enough time for is refused ============ */
  {
    const { planner } = load();
    const impossible = {
      legs: [
        { option: { id: 'a', lineNumber: '54', agency: '', headsign: '', boardStopName: '', boardStopCode: 1, departure: at(5), alightStopName: '', alightStopCode: 2, arrival: at(20), scheduleDate: 'x' }, departureStop: A, arrivalStop: SAME, walkBeforeMinutes: 2 },
        // The second bus leaves one minute after the first arrives, and the
        // change is a five-minute walk. Nobody can make that.
        { option: { id: 'b', lineNumber: '31', agency: '', headsign: '', boardStopName: '', boardStopCode: 3, departure: at(21), alightStopName: '', alightStopCode: 4, arrival: at(35), scheduleDate: 'x' }, departureStop: FAR, arrivalStop: END, walkBeforeMinutes: 5 },
      ],
      walkAfterMinutes: 1,
    };
    check('5 · an uncatchable change is not a journey', planner.buildJourney({ journey: impossible, now: NOW }), null);

    const possible = {
      ...impossible,
      legs: [impossible.legs[0], { ...impossible.legs[1], option: { ...impossible.legs[1].option, departure: at(26), arrival: at(40) } }],
    };
    check('5b · with six minutes it is', planner.buildJourney({ journey: possible, now: NOW }) !== null, true);

    check('5c · and a journey whose first bus has gone is not either', planner.buildJourney({
      journey: { legs: [{ ...impossible.legs[0], option: { ...impossible.legs[0].option, departure: at(-5), arrival: at(10) } }], walkAfterMinutes: 0 },
      now: NOW,
    }), null);
  }

  /* ==== 6 · a fast change beats a slow direct ride ===================== */
  {
    const { planner } = load();
    const mk = (legs, walkAfter) => planner.buildJourney({ journey: { legs, walkAfterMinutes: walkAfter }, now: NOW });
    const opt = (id, line, dep, arr) => ({ id, lineNumber: line, agency: '', headsign: '', boardStopName: '', boardStopCode: 1, departure: at(dep), alightStopName: '', alightStopCode: 2, arrival: at(arr), scheduleDate: 'x' });

    // 5 min walk + a 45-minute direct ride.
    const direct = mk([{ option: opt('d', '54', 5, 50), departureStop: A, arrivalStop: END, walkBeforeMinutes: 5 }], 0);
    // 2 min walk + 15 + change + 12.
    const changed = mk([
      { option: opt('c1', '54', 2, 17), departureStop: A, arrivalStop: SAME, walkBeforeMinutes: 2 },
      { option: opt('c2', '31', 20, 32), departureStop: SAME, arrivalStop: END, walkBeforeMinutes: 0 },
    ], 0);
    check('6 · the direct ride arrives later', direct.arrivalTime > changed.arrivalTime, true);
    check('6b · so the change scores better despite the penalty', changed.score < direct.score, true);
    const ranked = planner.rankJourneys({
      journeys: [
        { legs: [{ option: opt('d', '54', 5, 50), departureStop: A, arrivalStop: END, walkBeforeMinutes: 5 }], walkAfterMinutes: 0 },
        { legs: [
          { option: opt('c1', '54', 2, 17), departureStop: A, arrivalStop: SAME, walkBeforeMinutes: 2 },
          { option: opt('c2', '31', 20, 32), departureStop: SAME, arrivalStop: END, walkBeforeMinutes: 0 },
        ], walkAfterMinutes: 0 },
      ],
      now: NOW,
    });
    check('6c · and the ranking puts it first', ranked[0].transfers, 1);
    check('6d · with the direct ride offered as the alternative', ranked[1].transfers, 0);
  }

  /* ==== 7 · a proxy that fails never becomes an error the user sees ==== */
  {
    const { proxy } = load({ endpoint: 'https://example.invalid/routes' });
    const realFetch = global.fetch;

    const cases = [
      ['a 500', async () => ({ ok: false, status: 500 }), 'bad-response'],
      ['a 400', async () => ({ ok: false, status: 400 }), 'failed'],
      ['no journeys', async () => ({ ok: true, json: async () => ({ journeys: [] }) }), 'bad-response'],
      ['not even an object', async () => ({ ok: true, json: async () => 'nope' }), 'bad-response'],
      ['broken JSON', async () => ({ ok: true, json: async () => { throw new Error('bad json'); } }), 'failed'],
      ['offline', async () => { throw new TypeError('Network request failed'); }, 'offline'],
      ['a timeout', async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }, 'timeout'],
    ];

    for (const [label, impl, reason] of cases) {
      global.fetch = impl;
      const result = await proxy.findRoutesViaProxy({
        from: { latitude: 31.7, longitude: 34.57 },
        to: { latitude: 31.69, longitude: 34.58 },
        now: NOW,
      });
      check(`7 · ${label} → error, not a throw`, result, { status: 'error', reason });
    }
    global.fetch = realFetch;
  }

  /* ==== 8 · the response is never trusted blindly ====================== */
  {
    const { proxy } = load({ endpoint: 'https://example.invalid/routes' });

    check('8 · a leg with no usable times is dropped', proxy.parseJourneys({
      journeys: [{ legs: [{ ...leg({ id: 'x', line: '54', from: A, to: END, departsIn: 5, arrivesIn: 20 }), departure: 'not a time' }] }],
    }), null);

    check('8b · a leg with no stops is dropped', proxy.parseJourneys({
      journeys: [{ legs: [{ id: 'x', lineNumber: '54', departure: at(5), arrival: at(20) }] }],
    }), null);

    check('8c · one bad leg kills the whole journey, not just the leg', proxy.parseJourneys({
      journeys: [{
        legs: [
          leg({ id: 'ok', line: '54', from: A, to: SAME, departsIn: 5, arrivesIn: 20 }),
          { id: 'bad', lineNumber: '31' },
        ],
      }],
    }), null);

    check('8d · an empty list is nothing, not an answer', proxy.parseJourneys({ journeys: [] }), null);
    check('8e · a body with no journeys array', proxy.parseJourneys({ ok: true }), null);
    check('8f · but a good journey survives', proxy.parseJourneys({
      journeys: [{ legs: [leg({ id: 'g', line: '54', from: A, to: END, departsIn: 5, arrivesIn: 20 })], originMetres: 80, destinationMetres: 80 }],
    }).journeys.length, 1);

    // No measured distances → no invented walking.
    const noMetres = proxy.parseJourneys({
      journeys: [{ legs: [leg({ id: 'g', line: '54', from: A, to: END, departsIn: 5, arrivesIn: 20 })] }],
    });
    check('8g · no measured distance → no invented walk', [
      noMetres.journeys[0].legs[0].walkBeforeMinutes,
      noMetres.journeys[0].walkAfterMinutes,
    ], [0, 0]);
    check('8h · and no metresToOrigin claimed', 'metresToOrigin' in noMetres.journeys[0], false);
  }

  /* ==== 9 · what is sent, and what is not ============================= */
  {
    const { proxy } = load({ endpoint: 'https://example.invalid/routes' });
    let sent = null;
    const realFetch = global.fetch;
    global.fetch = async (url, init) => {
      sent = JSON.parse(init.body);
      return { ok: true, json: async () => ({ journeys: [] }) };
    };
    await proxy.findRoutesViaProxy({
      from: { latitude: 31.70405, longitude: 34.5753 },
      to: { latitude: 31.6957, longitude: 34.5845 },
      arriveBy: new Date(NOW + 90 * 60_000),
      now: NOW,
    });
    global.fetch = realFetch;
    check('9 · coordinates go, in the server\'s field names', [sent.from.lat, sent.from.lon], [31.70405, 34.5753]);
    check('9b · the target arrival goes', sent.arriveBy, new Date(NOW + 90 * 60_000).toISOString());
    check('9c · so does "not before now"', sent.departAfter, new Date(NOW).toISOString());
    check('9d · one change is asked for', sent.maxTransfers, 1);
    const body = JSON.stringify(sent);
    check('9e · nothing else is sent — no name, no items, no destination id', /name|items|destinationId|userName|reminder/.test(body), false);
  }

  /* ==== 10 · a stop code target, for a destination the user set up ===== */
  {
    const { proxy } = load({ endpoint: 'https://example.invalid/routes' });
    let sent = null;
    const realFetch = global.fetch;
    global.fetch = async (url, init) => {
      sent = JSON.parse(init.body);
      return { ok: true, json: async () => ({ journeys: [] }) };
    };
    await proxy.findRoutesViaProxy({
      from: { latitude: 31.7, longitude: 34.57 },
      to: { stopCode: 12974 },
      now: NOW,
    });
    global.fetch = realFetch;
    check('10 · a saved stop is sent as a code, not coordinates', sent.to, { stopCode: 12974 });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
