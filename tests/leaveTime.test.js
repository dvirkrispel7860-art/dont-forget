/* Tests for the real src/transit/leaveTime.ts (compiled, not reimplemented). */
const L = require('./transit/leaveTime.js');
const { walkingMinutes } = require('./transit/walking.js');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
}

const NOW = new Date('2026-08-19T22:00:00').getTime();
const at = (mins) => new Date(NOW + mins * 60_000).toISOString();

const ride = (id, minsFromNow, line = '54') => ({
  id,
  lineNumber: line,
  agency: 'דן',
  headsign: '',
  boardStopName: 'אריה תגר/אריאל שרון',
  boardStopCode: 18132,
  departure: at(minsFromNow),
  alightStopName: 'שדרות הציונות',
  alightStopCode: 12974,
  arrival: at(minsFromNow + 20),
  scheduleDate: '2026-08-19',
});

/* ---------------------------------------------------- the documented example */
{
  // 320 m → 4 walking minutes, margin 5 → a 22:18 bus means leaving at 22:09.
  const plan = L.planLeaveTime({ option: ride('a', 18), metresFromUser: 320, now: NOW });
  check('1 · walking minutes come from the measured distance', plan.walkMinutes, 4);
  check('1b · margin is the 5-minute default', plan.marginMinutes, 5);
  check('1c · departure 22:18 → leave 22:09', L.clockTime(plan.leaveAt), '22:09');
  check('1d · "יש לך כ־9 דקות"', L.timeLeftPhrase(plan.minutesUntilLeave), 'יש לך כ־9 דקות');
  check('1e · status ahead', plan.status, 'ahead');
  check('1f · departure clock', L.clockTime(plan.departureAt), '22:18');
  check('1g · walk phrase', L.walkPhrase(plan.walkMinutes), 'כ־4 דקות הליכה');
}

/* ------------------------------------------- the subtraction, several ways */
{
  for (const [metres, minsFromNow, wantLeave, wantWalk] of [
    [80, 30, '22:24', 1],
    [800, 40, '22:25', 10],
    [1600, 60, '22:35', 20],
    [40, 10, '22:04', 1],
  ]) {
    const p = L.planLeaveTime({ option: ride('x', minsFromNow), metresFromUser: metres, now: NOW });
    check(`2 · ${metres}m, bus in ${minsFromNow}min → leave ${wantLeave}`, L.clockTime(p.leaveAt), wantLeave);
    check(`2b · ${metres}m → ${wantWalk} walking min`, p.walkMinutes, wantWalk);
    check(`2c · leaveAt = departure − walk − margin`, p.leaveAt, p.departureAt - (p.walkMinutes + p.marginMinutes) * 60_000);
  }
}

/* --------------------------------------------- no data → no calculation */
{
  check('3 · no measured distance → no plan', L.planLeaveTime({ option: ride('a', 20), metresFromUser: undefined, now: NOW }), null);
  check('3b · NaN distance → no plan', L.planLeaveTime({ option: ride('a', 20), metresFromUser: NaN, now: NOW }), null);
  const broken = { ...ride('a', 20), departure: 'not a time' };
  check('3c · unparsable departure → no plan', L.planLeaveTime({ option: broken, metresFromUser: 300, now: NOW }), null);
}

/* --------------------------- never a negative countdown or a past leave time */
{
  // Bus in 6 minutes, 4 min walk + 5 min margin → leaving should have been 3 min ago.
  const p = L.planLeaveTime({ option: ride('a', 6), metresFromUser: 320, now: NOW });
  check('4 · too late to catch it → status too-late', p.status, 'too-late');
  check('4b · countdown clamped at zero, never negative', p.minutesUntilLeave, 0);
  check('4c · the bus itself has not gone yet', p.minutesUntilDeparture, 6);
  check('4d · phrase for zero minutes', L.timeLeftPhrase(p.minutesUntilLeave), 'צריך לצאת עכשיו');

  const gone = L.planLeaveTime({ option: ride('a', -5), metresFromUser: 320, now: NOW });
  check('4e · departure already passed → departed', gone.status, 'departed');
  check('4f · both countdowns clamped', [gone.minutesUntilLeave, gone.minutesUntilDeparture], [0, 0]);

  // Exactly on the boundary counts as too late, not as "you have 0 minutes".
  const boundary = L.planLeaveTime({ option: ride('a', 9), metresFromUser: 320, now: NOW });
  check('4g · exactly at the leave moment → too-late', boundary.status, 'too-late');
}

/* ------------------------------------------------- offering the next ride */
{
  const options = [ride('r1', 4), ride('r2', 12, '54'), ride('r3', 40, '7')];
  const next = L.nextCatchableRide({ options, metresFromUser: 320, now: NOW });
  check('5 · skips the uncatchable one', next.option.id, 'r2');
  check('5b · and its leave time is in the future', next.status, 'ahead');
  check('5c · leave time for it', L.clockTime(next.leaveAt), '22:03');

  const allGone = L.nextCatchableRide({ options: [ride('r1', 2), ride('r2', -10)], metresFromUser: 320, now: NOW });
  check('5d · nothing catchable → null, no invented ride', allGone, null);

  check('5e · no distance → no next ride either', L.nextCatchableRide({ options, metresFromUser: undefined, now: NOW }), null);

  // The list order is the timetable's; this only picks from it.
  const picked = L.nextCatchableRide({ options: [ride('late', 90), ride('soon', 20)], metresFromUser: 320, now: NOW });
  check('5f · picks the first catchable in the given order, no reordering', picked.option.id, 'late');
}

/* ------------------------------------------------ live vs planned labelling */
{
  const planned = L.planLeaveTime({ option: ride('a', 30), metresFromUser: 320, now: NOW });
  check('6 · no live data → timing scheduled', planned.timing, 'scheduled');
  const live = L.planLeaveTime({ option: ride('a', 30), metresFromUser: 320, live: true, now: NOW });
  check('6b · live feed reporting → timing live', live.timing, 'live');
  check('6c · live never changes the time itself', live.leaveAt, planned.leaveAt);
}

/* -------------------------------------------------- the leave time follows */
{
  // The same ride, a later clock: the leave time is fixed, the countdown shrinks.
  const early = L.planLeaveTime({ option: ride('a', 18), metresFromUser: 320, now: NOW });
  const later = L.planLeaveTime({ option: ride('a', 18), metresFromUser: 320, now: NOW + 5 * 60_000 });
  check('7 · leave time does not drift with the clock', later.leaveAt, early.leaveAt);
  check('7b · but the countdown does', [early.minutesUntilLeave, later.minutesUntilLeave], [9, 4]);

  // A different departure moves the leave time with it.
  const moved = L.planLeaveTime({ option: ride('a', 25), metresFromUser: 320, now: NOW });
  check('7c · a later bus → a later leave time', L.clockTime(moved.leaveAt), '22:16');

  // A different walk moves it too.
  const farther = L.planLeaveTime({ option: ride('a', 18), metresFromUser: 1200, now: NOW });
  check('7d · a farther stop → leave earlier', L.clockTime(farther.leaveAt), '21:58');
}

/* --------------------------------------------------------- custom margin */
{
  const p = L.planLeaveTime({ option: ride('a', 18), metresFromUser: 320, marginMinutes: 10, now: NOW });
  check('8 · margin is honoured', L.clockTime(p.leaveAt), '22:04');
  const zero = L.planLeaveTime({ option: ride('a', 18), metresFromUser: 320, marginMinutes: 0, now: NOW });
  check('8b · zero margin still subtracts the walk', L.clockTime(zero.leaveAt), '22:14');
  check('8c · the default is exported', L.SAFETY_MARGIN_MINUTES, 5);
}

/* -------------------------------------------- the walk comes from the layer */
{
  // Not recomputed here: the same function the card already uses for the label.
  for (const metres of [10, 79, 80, 81, 240, 1000]) {
    const p = L.planLeaveTime({ option: ride('a', 120), metresFromUser: metres, now: NOW });
    check(`9 · ${metres}m matches walkingMinutes()`, p.walkMinutes, walkingMinutes(metres));
  }
}

/* ------------------------------------------------------------ phrasing */
{
  check('10 · one minute', L.timeLeftPhrase(1), 'יש לך כדקה');
  check('10b · two minutes', L.timeLeftPhrase(2), 'יש לך כ־2 דקות');
  check('10c · many minutes', L.timeLeftPhrase(23), 'יש לך כ־23 דקות');
  check('10d · negative never leaks into wording', L.timeLeftPhrase(-4), 'צריך לצאת עכשיו');
  check('10e · one walking minute', L.walkPhrase(1), 'כדקה הליכה');
  // Floored, so "about N" is never a promise of more time than there is.
  const p = L.planLeaveTime({ option: ride('a', 18.9), metresFromUser: 320, now: NOW });
  check('10f · countdown floors rather than rounds up', p.minutesUntilLeave, 9);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
