/*
 * Tests for the route planner — the real compiled src/transit/routePlanner.ts.
 *
 * What it must get right is a judgement, not a lookup: given several stops the
 * user could walk to, each with its own rides, which journey actually gets them
 * there first? The old rule ("nearest stop that has a ride") is exactly what
 * these check it no longer follows.
 *
 * Transfers are scored here but never produced: the data source cannot plan them
 * within a sane amount of data on a phone (measured in the audit), so the search
 * emits single-leg journeys only. The scoring tests below use hand-built
 * multi-leg routes to prove the ranking is ready for them.
 */
const path = require('path');
const P = require(path.join(__dirname, 'transit/routePlanner.js'));
const { walkingMinutes } = require(path.join(__dirname, 'transit/nearbyRoute.js'));

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

const stop = (code, name) => ({ code, name, city: 'אשקלון' });

/** A timetable option, the shape the provider returns. */
const ride = ({ id, line, departsIn, rideMinutes, alight = 2001 }) => ({
  id,
  lineNumber: line,
  agency: 'דן',
  headsign: 'לכיוון היעד',
  boardStopName: 'תחנה',
  boardStopCode: 0,
  departure: at(departsIn),
  alightStopName: 'שדרות הציונות',
  alightStopCode: alight,
  arrival: at(departsIn + rideMinutes),
  scheduleDate: '2026-08-20',
});

const target = (code = 2001, metres = 80) => ({
  stop: stop(code, 'שדרות הציונות'),
  metresToDestination: metres,
});

function plan(candidates, targets = [target()], now = NOW) {
  return P.planRoutes({ candidates, targets, now });
}

/* =========== 1 · a near stop with a direct ride is chosen, as it should be */
{
  const routes = plan([
    { stop: stop(1001, 'קרובה'), metresFromUser: 80, options: [ride({ id: 'a', line: '54', departsIn: 6, rideMinutes: 20 })] },
    { stop: stop(1002, 'רחוקה'), metresFromUser: 900, options: [ride({ id: 'b', line: '31', departsIn: 6, rideMinutes: 20 })] },
  ]);
  check('1 · with equal rides, the near stop wins', routes[0].originStop.code, 1001);
  check('1b · both are offered', routes.length, 2);
  check('1c · the walk is counted, not assumed', routes[0].totalWalkingMinutes, walkingMinutes(80) + walkingMinutes(80));
  check('1d · the ride time comes from the timetable', routes[0].totalRideMinutes, 20);
  check('1e · no transfers on a single-leg journey', routes[0].transfers, 0);
  check('1f · one leg', routes[0].legs.length, 1);
}

/* ===== 2 · the nearest stop has no ride, so a further one with a ride wins */
{
  const routes = plan([
    { stop: stop(1001, 'קרובה בלי קו'), metresFromUser: 50, options: [] },
    { stop: stop(1002, 'רחוקה עם קו'), metresFromUser: 300, options: [ride({ id: 'b', line: '54', departsIn: 8, rideMinutes: 18 })] },
  ]);
  check('2 · a stop with no ride produces no journey', routes.length, 1);
  check('2b · so the further stop is the answer', routes[0].originStop.code, 1002);
}

/* ======= 3 · a long wait at the near stop loses to a further, sooner bus */
{
  // The case the old rule got wrong: 50 m away but the bus is 40 minutes off,
  // against 300 m away with a bus in 5.
  const routes = plan([
    { stop: stop(1001, 'קרובה'), metresFromUser: 50, options: [ride({ id: 'slow', line: '54', departsIn: 40, rideMinutes: 20 })] },
    { stop: stop(1002, 'רחוקה'), metresFromUser: 300, options: [ride({ id: 'soon', line: '31', departsIn: 5, rideMinutes: 25 })] },
  ]);
  check('3 · the sooner bus from further away wins', routes[0].originStop.code, 1002);
  check('3b · because it arrives first', routes[0].arrivalTime < routes[1].arrivalTime, true);
  check('3c · the near stop is still offered as the alternative', routes[1].originStop.code, 1001);
  check('3d · waiting is measured from now, minus the walk', routes[1].totalWaitingMinutes, 40 - walkingMinutes(50));
}

/* ===== 3e · but a small difference does not send the user on a long walk */
{
  const routes = plan([
    { stop: stop(1001, 'קרובה'), metresFromUser: 60, options: [ride({ id: 'near', line: '54', departsIn: 10, rideMinutes: 20 })] },
    { stop: stop(1002, 'רחוקה מאוד'), metresFromUser: 1400, options: [ride({ id: 'far', line: '31', departsIn: 10, rideMinutes: 17 })] },
  ]);
  check('3e · three minutes saved is not worth a 17-minute walk', routes[0].originStop.code, 1001);
}

/* ===== 4 · a direct ride can lose to a faster journey with a change ======= */
{
  // The example from the brief, built by hand: the search cannot produce a
  // two-leg journey yet, but the scoring must already rank it correctly.
  const directScore = P.scoreRoute({ totalMinutes: 50, totalWalkingMinutes: 5, transfers: 0 });
  const changeScore = P.scoreRoute({ totalMinutes: 31, totalWalkingMinutes: 2, transfers: 1 });
  check('4 · 5 min walk + 45 min direct scores', directScore, 55);
  check('4b · 2 min walk + 15 + change + 12 scores', changeScore, 38);
  check('4c · so the journey with a change is preferred', changeScore < directScore, true);
}

/* ===== 4d · a change is penalised, but never forbidden ================== */
{
  const noChange = P.scoreRoute({ totalMinutes: 40, totalWalkingMinutes: 5, transfers: 0 });
  const oneChange = P.scoreRoute({ totalMinutes: 40, totalWalkingMinutes: 5, transfers: 1 });
  check('4d · all else equal, fewer changes wins', noChange < oneChange, true);
  check('4e · by exactly the stated penalty', oneChange - noChange, P.TRANSFER_PENALTY_MINUTES);

  // And a change that saves more than the penalty still wins.
  const fasterWithChange = P.scoreRoute({ totalMinutes: 30, totalWalkingMinutes: 5, transfers: 1 });
  check('4f · a change that saves 10 minutes is worth it', fasterWithChange < noChange, true);
}

/* ===== 5 · walking counts for more than sitting on the bus ============== */
{
  const walking = P.scoreRoute({ totalMinutes: 40, totalWalkingMinutes: 20, transfers: 0 });
  const riding = P.scoreRoute({ totalMinutes: 40, totalWalkingMinutes: 5, transfers: 0 });
  check('5 · the same total time, more of it walking, scores worse', walking > riding, true);
  check('5b · by the stated weight', walking - riding, 15 * P.WALKING_PENALTY_PER_MINUTE);
}

/* ===== 6 · a bus that has already gone is not an option ================= */
{
  const routes = plan([
    { stop: stop(1001, 'א'), metresFromUser: 100, options: [
      ride({ id: 'gone', line: '54', departsIn: -10, rideMinutes: 20 }),
      ride({ id: 'next', line: '54', departsIn: 15, rideMinutes: 20 }),
    ] },
  ]);
  check('6 · the departed ride is dropped', routes.length, 1);
  check('6b · and the upcoming one is offered', routes[0].legs[0].option.id, 'next');
  check('6c · a stop whose every ride has gone yields nothing', plan([
    { stop: stop(1001, 'א'), metresFromUser: 100, options: [ride({ id: 'gone', line: '54', departsIn: -30, rideMinutes: 20 })] },
  ]).length, 0);
}

/* ===== 7 · walking to the stop is part of the journey =================== */
{
  // The target has no measured distance, so this isolates the walk *to* the stop.
  const routes = plan([
    { stop: stop(1001, 'א'), metresFromUser: 400, options: [ride({ id: 'a', line: '54', departsIn: 20, rideMinutes: 15 })] },
  ], [{ stop: stop(2001, 'יעד') }]);
  check('7 · walk before boarding, from the measured distance', routes[0].legs[0].walkBeforeMinutes, walkingMinutes(400));
  check('7b · counted in the total walking', routes[0].totalWalkingMinutes, walkingMinutes(400));
  // walkingMinutes never returns zero — a stop you are standing at is still a
  // minute away — so a measured 0 metres is one minute, not none.
  check('7c · a stop measured at zero metres is still a minute', walkingMinutes(0), 1);
}

/* ===== 8 · walking from the last stop to the destination ================ */
{
  const routes = plan([
    { stop: stop(1001, 'א'), metresFromUser: 100, options: [ride({ id: 'a', line: '54', departsIn: 10, rideMinutes: 20 })] },
  ], [target(2001, 640)]);
  const route = routes[0];
  check('8 · the final walk is counted', route.legs[0].walkAfterMinutes, walkingMinutes(640));
  check('8b · and pushes the arrival later than the bus arrives', route.arrivalTime > route.legs[0].arrivalAt, true);
  check('8c · by exactly that walk', (route.arrivalTime - route.legs[0].arrivalAt) / 60000, walkingMinutes(640));
  check('8d · total = walk + wait + ride + final walk, from now', route.totalMinutes, 10 + 20 + walkingMinutes(640));
}

/* ===== 8e · a stop with no measured distance counts no walk ============= */
{
  // A hand-picked stop, or one saved on the destination: nothing measured the
  // way there, so nothing here estimates it.
  const routes = plan([
    { stop: stop(1001, 'ידנית'), options: [ride({ id: 'a', line: '54', departsIn: 10, rideMinutes: 20 })] },
  ], [{ stop: stop(2001, 'יעד') }]);
  check('8e · no measured distance → no invented walk', routes[0].totalWalkingMinutes, 0);
  check('8f · and no metresToOrigin is claimed', 'metresToOrigin' in routes[0], false);
}

/* ===== 9 · at most three journeys, and three *different* ones =========== */
{
  const many = [];
  for (let i = 0; i < 8; i++) {
    many.push({
      stop: stop(1000 + i, 'תחנה ' + i),
      metresFromUser: 100 + i * 30,
      options: [
        ride({ id: 'r' + i + 'a', line: '5' + i, departsIn: 6 + i, rideMinutes: 20 }),
        ride({ id: 'r' + i + 'b', line: '5' + i, departsIn: 30 + i, rideMinutes: 20 }),
      ],
    });
  }
  const routes = plan(many);
  check('9 · never more than three', routes.length, P.MAX_ROUTE_OPTIONS);
  check('9b · sorted best first', routes.every((r, i) => i === 0 || routes[i - 1].score <= r.score), true);
  const shapes = routes.map((r) => r.originStop.code + '|' + r.legs.map((l) => l.lineNumber).join('>'));
  check('9c · three genuinely different journeys, not the same bus thrice', new Set(shapes).size, 3);
}

/* ===== 10 · every field the brief asked for is present and consistent === */
{
  const routes = plan([
    { stop: stop(1002, 'אריה תגר'), metresFromUser: 300, options: [ride({ id: 'a', line: '54', departsIn: 12, rideMinutes: 18 })] },
  ], [target(2001, 160)]);
  const r = routes[0];
  check('10 · originStop', r.originStop.code, 1002);
  check('10b · destinationStop', r.destinationStop.code, 2001);
  check('10c · legs carry the line, direction and both stops', [
    r.legs[0].lineNumber, r.legs[0].direction, r.legs[0].departureStop.code, r.legs[0].arrivalStop.code,
  ], ['54', 'לכיוון היעד', 1002, 2001]);
  check('10d · departureTime is the bus leaving', clock(r.departureTime), clock(NOW + 12 * 60000));
  check('10e · arrivalTime is at the destination, after the walk', clock(r.arrivalTime), clock(NOW + (12 + 18 + walkingMinutes(160)) * 60000));
  check('10f · totals add up', r.totalWalkingMinutes + r.totalWaitingMinutes + r.totalRideMinutes, r.totalMinutes);
  check('10g · score matches the function', r.score, P.scoreRoute(r));
  check('10h · the leg keeps its timetable option, for realtime', r.legs[0].option.id, 'a');
}

/* ===== 11 · nothing to plan =========================================== */
{
  check('11 · no candidates → no journeys', plan([]).length, 0);
  check('11b · no targets → no journeys', P.planRoutes({ candidates: [
    { stop: stop(1, 'a'), metresFromUser: 100, options: [ride({ id: 'a', line: '54', departsIn: 5, rideMinutes: 10 })] },
  ], targets: [], now: NOW }).length, 0);
  check('11c · candidates with no rides → no journeys', plan([{ stop: stop(1, 'a'), metresFromUser: 100, options: [] }]).length, 0);
}

/* ===== 12 · the ranking moves when the timetable does ================== */
{
  const before = plan([
    { stop: stop(1001, 'קרובה'), metresFromUser: 50, options: [ride({ id: 'near', line: '54', departsIn: 40, rideMinutes: 20 })] },
    { stop: stop(1002, 'רחוקה'), metresFromUser: 300, options: [ride({ id: 'far', line: '31', departsIn: 5, rideMinutes: 25 })] },
  ]);
  check('12 · the far stop wins while its bus is sooner', before[0].originStop.code, 1002);

  // The far bus slips by half an hour; the near one is now the better journey.
  const after = plan([
    { stop: stop(1001, 'קרובה'), metresFromUser: 50, options: [ride({ id: 'near', line: '54', departsIn: 40, rideMinutes: 20 })] },
    { stop: stop(1002, 'רחוקה'), metresFromUser: 300, options: [ride({ id: 'far', line: '31', departsIn: 35, rideMinutes: 25 })] },
  ]);
  check('12b · when it slips, the ranking flips', after[0].originStop.code, 1001);
  check('12c · which is a different journey id, so a reminder can tell', before[0].id !== after[0].id, true);
}

/* ===== 13 · wording =================================================== */
{
  check('13 · medals', [P.rankMedal(0), P.rankMedal(1), P.rankMedal(2)], ['🥇', '🥈', '🥉']);
  check('13b · labels', [P.rankLabel(0), P.rankLabel(1)], ['הכי מומלץ', 'חלופה']);
  check('13c · transfers, in words', [P.transfersPhrase(0), P.transfersPhrase(1), P.transfersPhrase(2)], ['ללא החלפות', 'החלפה אחת', '2 החלפות']);
  const routes = plan([{ stop: stop(1, 'a'), metresFromUser: 80, options: [ride({ id: 'a', line: '54', departsIn: 10, rideMinutes: 20 })] }], [target(2001, 80)]);
  check('13d · total time reads as an estimate', /^כ־\d+ דק׳$/.test(P.totalTimePhrase(routes[0])), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
