import React from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import {
  DAY_LABELS,
  formatTime,
  isEveryDay,
  parseTime,
  reminderDaysLabel,
} from '../notifications';
import { colors, radius, row, shadow, space } from '../theme';
import { defaultReminder, Reminder } from '../types';
import { Squish, Txt } from './ui';

/** Minutes move in 5-minute steps — fine enough for a departure reminder. */
const MINUTE_STEP = 5;

function Stepper({
  label,
  value,
  onDown,
  onUp,
}: {
  label: string;
  value: string;
  onDown: () => void;
  onUp: () => void;
}) {
  return (
    <View style={[row, styles.stepperRow]}>
      <Txt variant="body" style={{ flex: 1 }}>
        {label}
      </Txt>
      <Squish onPress={onDown} scaleTo={0.85} accessibilityLabel={`הפחת ${label}`}>
        <View style={styles.stepButton}>
          <Txt style={styles.stepGlyph}>−</Txt>
        </View>
      </Squish>
      <View style={styles.stepValue}>
        <Txt variant="h2" center>
          {value}
        </Txt>
      </View>
      <Squish onPress={onUp} scaleTo={0.85} accessibilityLabel={`הוסף ${label}`}>
        <View style={styles.stepButton}>
          <Txt style={styles.stepGlyph}>+</Txt>
        </View>
      </Squish>
    </View>
  );
}

/**
 * "🔔 הגדרת תזכורת" for one destination: an on/off switch, the time, and the
 * weekdays it runs on. Saved straight onto the destination, so it survives a
 * refresh like everything else.
 */
export function ReminderEditor({
  reminder,
  onChange,
}: {
  reminder: Reminder | undefined;
  onChange: (next: Reminder) => void;
}) {
  const current = reminder ?? { ...defaultReminder, enabled: false };
  const { hour, minute } = parseTime(current.time);

  const setTime = (nextHour: number, nextMinute: number) =>
    onChange({ ...current, time: formatTime((nextHour + 24) % 24, (nextMinute + 60) % 60) });

  const toggleDay = (day: number) =>
    onChange({
      ...current,
      days: current.days.includes(day)
        ? current.days.filter((d) => d !== day)
        : [...current.days, day].sort((a, b) => a - b),
    });

  return (
    <View style={[styles.card, shadow.soft]}>
      <View style={[row, styles.headerRow, current.enabled && styles.divider]}>
        <View style={{ flex: 1, marginEnd: space(3) }}>
          <Txt variant="body">🔔 הגדרת תזכורת</Txt>
          <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 3 }}>
            {current.enabled
              ? `${current.time} · ${reminderDaysLabel(current.days)}`
              : 'כבוי'}
          </Txt>
        </View>
        <Switch
          value={current.enabled}
          onValueChange={(enabled) => onChange({ ...current, enabled })}
          trackColor={{ false: colors.border, true: colors.accent }}
          thumbColor="#FFFFFF"
          ios_backgroundColor={colors.border}
        />
      </View>

      {current.enabled ? (
        <View style={styles.body}>
          <Stepper
            label="שעה"
            value={String(hour).padStart(2, '0')}
            onDown={() => setTime(hour - 1, minute)}
            onUp={() => setTime(hour + 1, minute)}
          />
          <Stepper
            label="דקות"
            value={String(minute).padStart(2, '0')}
            onDown={() => setTime(hour, minute - MINUTE_STEP)}
            onUp={() => setTime(hour, minute + MINUTE_STEP)}
          />

          <Txt
            variant="label"
            color={colors.textSoft}
            style={{ marginTop: space(4), marginBottom: space(2.5) }}
          >
            ימים
          </Txt>

          <View style={styles.days}>
            {DAY_LABELS.map((label, day) => {
              const on = current.days.includes(day);
              return (
                <Squish
                  key={day}
                  onPress={() => toggleDay(day)}
                  scaleTo={0.88}
                  accessibilityLabel={`יום ${label}`}
                >
                  <View style={[styles.day, on && styles.dayOn]}>
                    <Txt
                      variant="caption"
                      center
                      color={on ? '#FFFFFF' : colors.textSoft}
                    >
                      {label}
                    </Txt>
                  </View>
                </Squish>
              );
            })}
          </View>

          <Squish
            onPress={() =>
              onChange({
                ...current,
                days: isEveryDay(current.days) ? [] : [0, 1, 2, 3, 4, 5, 6],
              })
            }
            scaleTo={0.95}
            accessibilityLabel="כל יום"
          >
            <View style={[styles.everyDay, isEveryDay(current.days) && styles.everyDayOn]}>
              <Txt
                variant="caption"
                center
                color={isEveryDay(current.days) ? colors.accentDeep : colors.textSoft}
              >
                כל יום
              </Txt>
            </View>
          </Squish>

          {current.days.length === 0 ? (
            <Txt variant="caption" color={colors.danger} style={{ marginTop: space(3) }}>
              בחר לפחות יום אחד, אחרת התזכורת לא תישלח.
            </Txt>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  headerRow: {
    paddingHorizontal: space(4),
    paddingVertical: space(3.5),
    minHeight: 60,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  body: {
    paddingHorizontal: space(4),
    paddingVertical: space(3.5),
  },
  stepperRow: {
    marginBottom: space(2),
    gap: space(2),
  },
  stepButton: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepGlyph: {
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '700',
    color: colors.textSoft,
  },
  stepValue: {
    minWidth: 46,
  },
  days: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: space(2),
  },
  day: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  everyDay: {
    marginTop: space(3),
    paddingVertical: space(2.5),
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSoft,
  },
  everyDayOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
});
