import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { locationErrorHint, locationErrorMessage } from '../location';
import { colors, radius, row, shadow, space } from '../theme';
import { transit } from '../transit';
import {
  clockTime,
  LeavePlan,
  nextCatchableRide,
  planLeaveTime,
  timeLeftPhrase,
  walkPhrase,
} from '../transit/leaveTime';
import { walkingMinutes } from '../transit/nearbyRoute';
import { BusRoute } from '../transit/useBusRoute';
import { TransitOption } from '../transit/types';
import { useLeaveReminder } from '../transit/useLeaveReminder';
import { useRealtime } from '../transit/useRealtime';
import { Destination } from '../types';
import { Button, Squish, Txt } from './ui';
import { StopPicker } from './StopPicker';

/**
 * 🚌 הדרך שלי — the stop found for the user, and the ride that made it the answer.
 *
 * The user never picks an origin stop to get here: the app takes their location,
 * looks at the stops around them, and keeps the nearest one that actually has a
 * ride to the destination (see nearbyRoute.ts). What it shows is why that stop —
 * how far it is, which line, and when it leaves — all from the official timetable,
 * with live status on top when the feed has any.
 *
 * Every failure is its own sentence: no location (and which kind — refused,
 * switched off, timed out), no stops, no ride, no timetable. None of them invents
 * a stop, a line or a time.
 */

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

/** "בעוד 7 דקות", or the clock time when it is further out than an hour. */
function leavesIn(iso: string, now: number = Date.now()): string {
  const minutes = Math.round((new Date(iso).getTime() - now) / 60_000);
  if (minutes < -1) return `יצא ב-${clock(iso)}`;
  if (minutes <= 0) return 'יוצא עכשיו';
  if (minutes === 1) return 'יוצא בעוד דקה';
  if (minutes <= 60) return `יוצא בעוד ${minutes} דק׳`;
  return `יוצא ב-${clock(iso)}`;
}

function distanceLabel(metres: number): string {
  // Rounding to 50m would print "0 מ׳" for a stop you are standing at.
  if (metres < 50) return 'פחות מ-50 מ׳';
  if (metres < 950) return `${Math.round(metres / 50) * 50} מ׳`;
  return `${(metres / 1000).toFixed(1)} ק״מ`;
}

/**
 * A clock that ticks, so the countdown stays true and "כדאי לצאת" turns into
 * "כבר יוצא" by itself. Minute-level display, so a 20-second tick is plenty —
 * and it costs no requests.
 */
const TICK_MS = 20_000;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * 🚌 האוטובוס שלך — the answer to "when do I need to leave?".
 *
 * Everything on it comes from the plan: the line and stop from the timetable
 * option, the walk from the distance the stop search measured, and the leave time
 * from the one subtraction in leaveTime.ts. The margin is named out loud so the
 * number is never a black box, and the departure is labelled as planned unless
 * the live feed is actually reporting the line.
 */
function LeavePanel({
  plan,
  reminder,
}: {
  plan: LeavePlan;
  reminder: ReturnType<typeof useLeaveReminder>;
}) {
  return (
    <View style={[styles.leave, shadow.soft]}>
      <Txt variant="body">🚌 האוטובוס שלך</Txt>

      <View style={{ marginTop: space(2.5), gap: space(1.5) }}>
        <Txt variant="caption" color={colors.textSoft}>
          קו: {plan.option.lineNumber}
        </Txt>
        <Txt variant="caption" color={colors.textSoft} numberOfLines={2}>
          תחנה: {plan.option.boardStopName}
        </Txt>
        <Txt variant="caption" color={colors.textSoft}>
          🕐 יוצא: {clockTime(plan.departureAt)}
          {plan.timing === 'live' ? ' · הקו מדווח בזמן אמת' : ' · לפי לוח הזמנים'}
        </Txt>
        <Txt variant="caption" color={colors.textSoft}>
          🚶 {walkPhrase(plan.walkMinutes)}
        </Txt>
      </View>

      <Txt variant="h2" style={{ marginTop: space(3) }}>
        🚀 כדאי לצאת ב־{clockTime(plan.leaveAt)}
      </Txt>
      <Txt variant="body" color={colors.accentDeep} style={{ marginTop: space(1.5) }}>
        {timeLeftPhrase(plan.minutesUntilLeave)}
      </Txt>
      <Txt variant="caption" color={colors.textFaint} style={{ marginTop: space(1.5) }}>
        כולל מרווח ביטחון של {plan.marginMinutes} דק׳
        {plan.timing === 'live' ? '' : ' · הזמן מתוכנן, לא בזמן אמת'}
      </Txt>

      <LeaveReminderRow reminder={reminder} />
    </View>
  );
}

/** The 🔔 button and the plain truth about what it can and cannot do. */
function LeaveReminderRow({
  reminder,
}: {
  reminder: ReturnType<typeof useLeaveReminder>;
}) {
  if (reminder.blocked === 'unsupported') {
    return (
      <Txt variant="caption" color={colors.textFaint} style={{ marginTop: space(3) }}>
        ℹ️ המכשיר או הדפדפן הזה לא תומך בהתראות, אז אין תזכורת יציאה כאן.
      </Txt>
    );
  }

  if (reminder.blocked === 'notifications-off') {
    return (
      <Txt variant="caption" color={colors.textFaint} style={{ marginTop: space(3) }}>
        ℹ️ ההתראות כבויות בהגדרות. אפשר להדליק אותן שם ואז לבקש תזכורת יציאה.
      </Txt>
    );
  }

  if (reminder.blocked === 'denied') {
    return (
      <Txt variant="caption" color={colors.textFaint} style={{ marginTop: space(3) }}>
        ℹ️ הדפדפן חוסם התראות לאתר הזה, ולכן אי אפשר לבקש תזכורת מכאן.
      </Txt>
    );
  }

  if (reminder.sent) {
    return (
      <Txt variant="caption" color={colors.accentDeep} style={{ marginTop: space(3) }}>
        ✅ שלחנו את התזכורת.
      </Txt>
    );
  }

  return (
    <View style={{ marginTop: space(3) }}>
      <Button
        label={reminder.armed ? '🔔 התזכורת מופעלת · בטל' : '🔔 הזכר לי מתי לצאת'}
        variant="soft"
        size="md"
        onPress={reminder.armed ? reminder.cancel : reminder.arm}
        style={{ alignSelf: 'stretch' }}
      />
      {/* What it can actually do, per platform. On a phone the OS holds the
          notification, so it arrives with the app closed; in a browser it does
          not, and saying otherwise would be a promise the app cannot keep. */}
      <Txt variant="caption" color={colors.textFaint} style={{ marginTop: space(2) }}>
        {reminder.osHeld
          ? reminder.armed
            ? 'נזכיר לך בזמן היציאה — גם אם האפליקציה סגורה.'
            : 'תזכורת חד-פעמית בזמן היציאה. עובדת גם כשהאפליקציה סגורה.'
          : reminder.armed
            ? 'נזכיר לך בזמן היציאה — כל עוד האפליקציה פתוחה. אם היא סגורה, ההתראה לא תישלח.'
            : 'תזכורת חד-פעמית בזמן היציאה. עובדת רק כשהאפליקציה פתוחה.'}
      </Txt>
    </View>
  );
}

/** The rides after the one being taken — same shape the timetable returned. */
function LaterRide({ option }: { option: TransitOption }) {
  return (
    <View style={[row, styles.laterRow]}>
      <View style={styles.lineBadgeSmall}>
        <Txt variant="caption" center color={colors.accentDeep}>
          {option.lineNumber}
        </Txt>
      </View>
      <Txt variant="caption" color={colors.textSoft} style={{ marginHorizontal: space(2.5) }}>
        🕐 {clock(option.departure)} → {clock(option.arrival)}
      </Txt>
    </View>
  );
}

export function BusRouteCard({
  route,
  destination,
  /** Opens the screen where the destination's own stops are set up. */
  onEditDestination,
}: {
  route: BusRoute;
  /** Whose departure this is — only for the wording of the leave reminder. */
  destination: Destination;
  onEditDestination: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const { state, manualStop, chooseStop, clearStop, retry } = route;
  const now = useNow();

  const found = state.phase === 'done' && state.result.status === 'ok' ? state.result.route : null;
  // Live status for the ride being taken — the existing realtime layer.
  const realtime = useRealtime(found?.option);

  /*
   * "מתי צריך לצאת?" — derived, never stored. Because it is a plain function of
   * the ride, the walk and the clock, a change in any of them (a new search, the
   * ride rolling over, the minute ticking) moves the leave time with it.
   *
   * `metresFromUser` is absent for a stop the user picked by hand or one saved on
   * the destination: nothing measured the way there, so `planLeaveTime` returns
   * null and the card says why instead of estimating.
   */
  const plan = found
    ? planLeaveTime({
        option: found.option,
        metresFromUser: found.metresFromUser,
        live: realtime.summary.live,
        now,
      })
    : null;

  /* When the nearest ride can no longer be caught, the next one that can. */
  const nextRide =
    found && plan && plan.status !== 'ahead'
      ? nextCatchableRide({ options: found.options, metresFromUser: found.metresFromUser, now })
      : null;

  const activePlan = plan?.status === 'ahead' ? plan : nextRide;
  /*
   * The stop currently being boarded from. A hand-picked one counts even before
   * any search finishes, because it is already the user's answer — and changing
   * stop has to withdraw a pending reminder for the previous one.
   */
  const originStopCode = manualStop?.code ?? found?.origin.code;
  const reminder = useLeaveReminder(destination, activePlan, originStopCode);

  const picker = (
    <StopPicker
      visible={picking}
      title="בחירת תחנת עלייה"
      onClose={() => setPicking(false)}
      onPick={(stop) => {
        chooseStop(stop);
        setPicking(false);
      }}
    />
  );

  const changeStop = (
    <View style={{ marginTop: space(3), gap: space(2) }}>
      <Squish
        onPress={() => setPicking(true)}
        scaleTo={0.96}
        accessibilityLabel="בחירת תחנה אחרת"
        style={{ alignSelf: 'flex-start' }}
      >
        <Txt variant="caption" color={colors.accentDeep}>
          📍 בחירת תחנה אחרת
        </Txt>
      </Squish>

      {/* A hand-picked stop is not a life sentence. */}
      {manualStop ? (
        <Squish
          onPress={clearStop}
          scaleTo={0.96}
          accessibilityLabel="חזרה לתחנה שנמצאת אוטומטית"
          style={{ alignSelf: 'flex-start' }}
        >
          <Txt variant="caption" color={colors.accentDeep}>
            ↩︎ חזרה לתחנה שנמצאת אוטומטית
          </Txt>
        </Squish>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.card, shadow.soft]}>
      <Txt variant="body" style={{ marginBottom: space(3) }}>
        🚌 הדרך שלי
      </Txt>

      {state.phase === 'locating' ? (
        <Txt variant="caption" color={colors.textSoft}>
          מבקש את המיקום שלך כדי למצוא תחנה קרובה...
        </Txt>
      ) : state.phase === 'searching' ? (
        <Txt variant="caption" color={colors.textSoft}>
          מחפש תחנה שממנה יש נסיעה ליעד...
        </Txt>
      ) : state.phase === 'no-location' ? (
        /* One branch, and the sentence comes from the reason — a timeout is never
           shown as a refusal. Either way there is a way on: pick a stop. */
        <>
          <Txt variant="caption" color={colors.textSoft}>
            {[
              locationErrorMessage(state.reason),
              'בלי מיקום אי אפשר למצוא תחנה קרובה אליך.',
              locationErrorHint(state.reason),
            ]
              .filter(Boolean)
              .join(' ')}
          </Txt>
          <View style={[row, { gap: space(2.5), marginTop: space(3) }]}>
            {state.reason !== 'unavailable' ? (
              <View style={{ flex: 1 }}>
                <Button label="נסה שוב" variant="soft" size="md" onPress={retry} />
              </View>
            ) : null}
            <View style={{ flex: 1 }}>
              <Button
                label="📍 בחר תחנה"
                variant="soft"
                size="md"
                onPress={() => setPicking(true)}
              />
            </View>
          </View>
        </>
      ) : state.phase === 'done' && state.result.status === 'no-destination-location' ? (
        <>
          <Txt variant="caption" color={colors.textSoft}>
            ליעד הזה אין מיקום שאפשר לכוון אליו נסיעה. אפשר להוסיף כתובת ליעד, או
            לבחור תחנת יעד במסך העריכה.
          </Txt>
          <Button
            label="פתח את עריכת היעד"
            variant="soft"
            size="md"
            onPress={onEditDestination}
            style={{ marginTop: space(3) }}
          />
        </>
      ) : state.phase === 'done' && state.result.status === 'no-stops-nearby' ? (
        <>
          <Txt variant="caption" color={colors.textSoft}>
            לא מצאנו כרגע תחנת אוטובוס מתאימה בקרבתך.
          </Txt>
          {changeStop}
        </>
      ) : state.phase === 'done' && state.result.status === 'no-ride-nearby' ? (
        <>
          <Txt variant="caption" color={colors.textSoft}>
            {state.result.forced
              ? 'מהתחנה הזאת אין נסיעה ישירה ליעד בטווח השעות הזה.'
              : 'לא מצאנו כרגע תחנת אוטובוס מתאימה בקרבתך — יש תחנות בסביבה, אבל אין מהן נסיעה ישירה ליעד בטווח השעות הזה.'}
          </Txt>
          {changeStop}
        </>
      ) : state.phase === 'done' && state.result.status === 'failed' ? (
        <>
          <Txt variant="caption" color={colors.textSoft}>
            {state.result.reason}.
          </Txt>
          <Button
            label="נסה שוב"
            variant="soft"
            size="md"
            onPress={retry}
            style={{ marginTop: space(3) }}
          />
        </>
      ) : found ? (
        <>
          <Txt variant="caption" color={colors.accentDeep}>
            {found.originSource === 'manual'
              ? 'התחנה שבחרת'
              : found.originSource === 'saved'
                ? 'התחנה ששמורה ליעד'
                : 'התחנה שנמצאה עבורך'}
          </Txt>

          {/* The stop, and why it is this one. */}
          <View style={{ marginTop: space(2), gap: space(1.5) }}>
            <Txt variant="body" numberOfLines={2}>
              📍 {found.origin.name}
              {found.origin.city ? ` · ${found.origin.city}` : ''}
            </Txt>
            {found.metresFromUser != null ? (
              <Txt variant="caption" color={colors.textSoft}>
                🚶 כ־{walkingMinutes(found.metresFromUser)} דק׳ הליכה ממך (
                {distanceLabel(found.metresFromUser)} בקו אווירי)
              </Txt>
            ) : null}
          </View>

          {/* ------------------------------------------- when to leave */}
          {plan == null ? (
            /* No measured distance to this stop, so no walking time and no leave
               time. Saying so beats inventing one. */
            <Txt variant="caption" color={colors.textFaint} style={{ marginTop: space(3) }}>
              ℹ️ לתחנה הזאת אין מרחק מדוד ממך, ולכן אין חישוב של זמן יציאה.
              {found.originSource === 'manual'
                ? ' אפשר לחזור לתחנה שנמצאת אוטומטית כדי לקבל אותו.'
                : ' עם הרשאת מיקום נמצא תחנה קרובה ונחשב אותו.'}
            </Txt>
          ) : plan.status === 'ahead' ? (
            <LeavePanel plan={plan} reminder={reminder} />
          ) : (
            <View style={[styles.leave, shadow.soft]}>
              <Txt variant="body">
                {plan.status === 'departed'
                  ? '⚠️ האוטובוס הזה כבר יצא.'
                  : '⚠️ האוטובוס הקרוב כבר יוצא בקרוב.'}
              </Txt>
              <Txt variant="caption" color={colors.textSoft} style={{ marginTop: space(2) }}>
                {plan.status === 'departed'
                  ? `קו ${plan.option.lineNumber} יצא ב-${clockTime(plan.departureAt)}.`
                  : `קו ${plan.option.lineNumber} יוצא ב-${clockTime(plan.departureAt)}, ` +
                    `ומכאן זה ${walkPhrase(plan.walkMinutes)} — אין מספיק זמן להגיע בבטחה.`}
              </Txt>

              {nextRide ? (
                <View style={{ marginTop: space(3), gap: space(1.5) }}>
                  <Txt variant="caption" color={colors.textSoft}>
                    הנסיעה הבאה מהתחנה הזאת:
                  </Txt>
                  <Txt variant="caption" color={colors.textSoft}>
                    קו {nextRide.option.lineNumber} · 🕐 יוצא:{' '}
                    {clockTime(nextRide.departureAt)}
                  </Txt>
                  <Txt variant="h2" style={{ marginTop: space(1.5) }}>
                    🚀 כדאי לצאת ב־{clockTime(nextRide.leaveAt)}
                  </Txt>
                  <Txt variant="body" color={colors.accentDeep}>
                    {timeLeftPhrase(nextRide.minutesUntilLeave)}
                  </Txt>
                  <Txt variant="caption" color={colors.textFaint}>
                    כולל מרווח ביטחון של {nextRide.marginMinutes} דק׳
                    {nextRide.timing === 'live' ? '' : ' · הזמן מתוכנן, לא בזמן אמת'}
                  </Txt>
                  <LeaveReminderRow reminder={reminder} />
                </View>
              ) : (
                <Txt variant="caption" color={colors.textFaint} style={{ marginTop: space(2.5) }}>
                  אין נסיעה נוספת מהתחנה הזאת שאפשר להגיע אליה בטווח השעות הזה.
                </Txt>
              )}
            </View>
          )}

          {/* The ride that made this stop the answer. */}
          <View style={[styles.ride, shadow.soft]}>
            <View style={row}>
              <View style={styles.lineBadge}>
                <Txt variant="label" center color="#FFFFFF">
                  {found.option.lineNumber}
                </Txt>
              </View>
              <Txt
                variant="caption"
                color={colors.textFaint}
                numberOfLines={1}
                style={{ flex: 1, marginHorizontal: space(2.5) }}
              >
                🚌 קו {found.option.lineNumber}
                {found.option.agency ? ` · ${found.option.agency}` : ''}
              </Txt>
            </View>

            <Txt variant="body" style={{ marginTop: space(2.5) }}>
              🕐 {leavesIn(found.option.departure)}
              {/* The clock is only added when the phrase is relative — otherwise
                  it already says the time. */}
              {leavesIn(found.option.departure).includes(clock(found.option.departure)) ? null : (
                <Txt variant="caption" color={colors.textFaint}>
                  {'  '}
                  {clock(found.option.departure)}
                </Txt>
              )}
            </Txt>

            <View style={{ marginTop: space(2), gap: space(1.5) }}>
              <Txt variant="caption" color={colors.textSoft} numberOfLines={1}>
                📍 יורדים ב: {found.option.alightStopName}
              </Txt>
              <Txt variant="caption" color={colors.textSoft}>
                🕐 הגעה משוערת: {clock(found.option.arrival)} (לפי לוח הזמנים)
              </Txt>
            </View>

            {/* Live status, when the feed has any for this line. */}
            <View style={styles.liveRow}>
              <View style={[row, { marginBottom: space(2) }]}>
                <Txt variant="caption" color={colors.textFaint} style={{ flex: 1 }}>
                  זמן אמת
                </Txt>
                {/* Same shared rate limit as everywhere else: disabled until the
                    transit layer allows another look. */}
                <Squish
                  onPress={realtime.refresh}
                  disabled={realtime.cooldownSeconds > 0}
                  scaleTo={0.94}
                  accessibilityLabel="רענן מידע בזמן אמת"
                >
                  <Txt
                    variant="caption"
                    color={
                      realtime.cooldownSeconds > 0 ? colors.textFaint : colors.accentDeep
                    }
                  >
                    {realtime.cooldownSeconds > 0
                      ? `🔄 רענן (${realtime.cooldownSeconds})`
                      : '🔄 רענן'}
                  </Txt>
                </Squish>
              </View>

              {realtime.summary.live ? (
                <>
                  <Txt variant="caption" color={colors.textSoft}>
                    {realtime.summary.freshness === 'fresh' ? '🟢' : '🟡'} זמן אמת · עודכן{' '}
                    {realtime.summary.minutesSinceUpdate === 0
                      ? 'עכשיו'
                      : `לפני ${realtime.summary.minutesSinceUpdate} דק׳`}
                  </Txt>
                  {realtime.summary.metresToBoardStop != null ? (
                    <Txt
                      variant="caption"
                      color={colors.textSoft}
                      style={{ marginTop: space(1.5) }}
                    >
                      📍 הרכב הקרוב כ־{distanceLabel(realtime.summary.metresToBoardStop)}{' '}
                      מהתחנה (קו אווירי)
                    </Txt>
                  ) : null}
                </>
              ) : (
                <Txt variant="caption" color={colors.textFaint}>
                  ℹ️ {realtime.summary.reason ?? 'אין כרגע מידע בזמן אמת'} — הזמנים לפי
                  לוח הזמנים
                </Txt>
              )}
            </View>
          </View>

          {found.options.length > 1 ? (
            <View style={{ marginTop: space(3), gap: space(2) }}>
              <Txt variant="caption" color={colors.textSoft}>
                נסיעות נוספות מאותה תחנה
              </Txt>
              {found.options.slice(1).map((option) => (
                <LaterRide key={option.id} option={option} />
              ))}
            </View>
          ) : null}

          <Txt variant="caption" color={colors.textFaint} style={{ marginTop: space(3) }}>
            {transit.sourceLabel}
          </Txt>

          {changeStop}
          {manualStop ? (
            <Txt variant="caption" color={colors.textFaint} style={{ marginTop: space(2) }}>
              הבחירה הזאת תקפה ליציאה הנוכחית בלבד — היעד עצמו לא השתנה.
            </Txt>
          ) : null}
        </>
      ) : (
        <Txt variant="caption" color={colors.textSoft}>
          מחפש תחנה...
        </Txt>
      )}

      {picker}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: space(4),
    paddingVertical: space(3.5),
  },
  /* The "when to leave" answer, set apart from the ride's details below it. */
  leave: {
    marginTop: space(3),
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.accentDeep,
    backgroundColor: colors.surface,
    paddingHorizontal: space(3.5),
    paddingVertical: space(3),
  },
  ride: {
    marginTop: space(3),
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: space(3.5),
    paddingVertical: space(3),
  },
  lineBadge: {
    minWidth: 40,
    height: 30,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space(1.5),
  },
  lineBadgeSmall: {
    minWidth: 32,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space(1.5),
  },
  laterRow: {
    minHeight: 26,
  },
  liveRow: {
    marginTop: space(3),
    paddingTop: space(2.5),
    borderTopWidth: 1,
    borderTopColor: 'rgba(75, 91, 245, 0.2)',
  },
});
