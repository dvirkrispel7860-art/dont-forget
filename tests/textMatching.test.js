/*
 * Regression tests for the keyword matcher's prefix stripping.
 *
 * Stripping a one-letter Hebrew prefix is what lets "לים" find the keyword "ים".
 * The hazard is a word that merely *starts* with one of those letters: "מים" is
 * water, not "from the sea", and reading it as a prefixed form classified a gym
 * sentence as a trip to the beach.
 *
 * These lock down both halves — the words that must keep their first letter, and
 * the prefixed forms that must still be found.
 */
const path = require('path');
const { localAnalysis } = require(path.join(__dirname, 'aiAnalysis.js'));

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
}

/** The activity a sentence is understood as, or null. */
function activityOf(text, destinations = []) {
  const result = localAnalysis(text, { destinations });
  return result.understood ? result.activity.id : null;
}

/* ============================ 1 · "בקבוק מים" is not a trip to the beach */
{
  check('1 · "בקבוק מים" alone is not the beach', activityOf('בקבוק מים') === 'beach', false);
  check('1b · nor is "לקחת בקבוק מים"', activityOf('צריך לקחת בקבוק מים') === 'beach', false);
  check('1c · nor "מים" on its own', activityOf('מים') === 'beach', false);
}

/* ================ 2 · the reported sentence is understood as the gym */
{
  check(
    '2 · "חדר כושר ... ובקבוק מים" → gym',
    activityOf('אני הולך לחדר כושר וצריך לקחת מגבת ובקבוק מים'),
    'gym',
  );
  check('2b · and the shorter form too', activityOf('חדר כושר ובקבוק מים'), 'gym');
  check(
    '2c · water does not outvote the destination anywhere',
    activityOf('אני נוסע לבית ספר עם בקבוק מים'),
    'school',
  );
}

/* ======================== 3 · "אני הולך לים" is still the beach */
{
  check('3 · "אני הולך לים" → beach', activityOf('אני הולך לים'), 'beach');
  check('3b · "לים" is still stripped to "ים"', activityOf('נוסעים לים מחר'), 'beach');
  check('3c · and so is "הים"', activityOf('אני הולך אל הים'), 'beach');
  check('3d · and "בים"', activityOf('נשחה בים'), 'beach');
}

/* ==================== 4 · "אני הולך לחדר כושר" is still the gym */
{
  check('4 · "אני הולך לחדר כושר" → gym', activityOf('אני הולך לחדר כושר'), 'gym');
  check('4b · "כושר" on its own too', activityOf('יש לי אימון כושר'), 'gym');
}

/* ========= 5 · other items with Hebrew prefixes still match as before */
{
  const stillWorks = [
    ['אני נוסע לסופר', 'shopping'],
    ['הולך בקניון', 'shopping'],
    ['יש לי אימון כדורגל', 'sport'],
    ['נוסע לאימון', 'sport'],
    ['הולך לבריכה', 'beach'],
    ['אני טס מחר', 'flight'],
    ['נוסע לשדה תעופה', 'flight'],
    ['הולך לקולנוע', 'cinema'],
    ['נוסע לסבתא', 'family'],
    ['יש לי מבחן בבית ספר', 'school'],
    ['יוצא לטיול בטבע', 'trip'],
    ['הולך לחברים', 'friends'],
  ];
  for (const [text, expected] of stillWorks) {
    check(`5 · "${text}" → ${expected}`, activityOf(text), expected);
  }
}

/* ============ the other real words that were misreading, same root cause */
{
  // Each of these is an independent Hebrew word whose stripped form is a keyword.
  check('6 · "שים לב" is not the beach', activityOf('שים לב לזה') === 'beach', false);
  check('6b · "מטבע" is not a hike', activityOf('צריך מטבע לעגלה') === 'trip', false);
  check('6c · "מחברת" is not a night with friends', activityOf('לקחת מחברת ומחשבון') === 'friends', false);
  check('6d · "מטס" is not a flight of your own', activityOf('יש מטס ביום העצמאות') === 'flight', false);

  // And the words they collide with still match when actually meant.
  check('6e · "טבע" still means a trip', activityOf('יוצאים לטבע'), 'trip');
  check('6f · "חבר" still means friends', activityOf('הולך לחבר'), 'friends');
  check('6g · "טס" still means a flight', activityOf('אני טס לחול'), 'flight');
}

/* ================= a matched destination still wins over a bare activity */
{
  const destinations = [
    { id: 'gymId', name: 'חדר כושר שלי', icon: '🏋️', favorite: false, items: [], createdAt: 1 },
  ];
  const result = localAnalysis('אני הולך לחדר כושר וצריך בקבוק מים', { destinations });
  check('7 · an existing destination is matched, not a new one', result.destination.kind, 'existing');
  check('7b · and it is the right one', result.destination.id, 'gymId');
}

/* ============================= nothing was made permissive by accident */
{
  check('8 · gibberish is still not understood', activityOf('זזזז קשקוש'), null);
  check('8b · a single weak word is still not enough', activityOf('מורה'), null);
  check('8c · empty text', activityOf(''), null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
