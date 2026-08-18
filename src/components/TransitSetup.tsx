import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, row, shadow, space } from '../theme';
import { TransitPlan, TransitStopRef } from '../transit/types';
import { StopPicker } from './StopPicker';
import { Squish, Txt } from './ui';

const MINUTE_STEP = 5;

function parse(time: string | undefined): { hour: number; minute: number } {
  const [h, m] = (time ?? '08:00').split(':');
  return { hour: Number(h) || 0, minute: Number(m) || 0 };
}

function format(hour: number, minute: number): string {
  return `${String((hour + 24) % 24).padStart(2, '0')}:${String((minute + 60) % 60).padStart(2, '0')}`;
}

function StopRow({
  label,
  stop,
  onPress,
}: {
  label: string;
  stop: TransitStopRef | undefined;
  onPress: () => void;
}) {
  return (
    <Squish onPress={onPress} scaleTo={0.985} accessibilityLabel={label}>
      <View style={[row, styles.pickRow]}>
        <View style={{ flex: 1 }}>
          <Txt variant="caption" color={colors.textFaint}>
            {label}
          </Txt>
          <Txt
            variant="body"
            color={stop ? colors.text : colors.textFaint}
            numberOfLines={1}
            style={{ marginTop: 2 }}
          >
            {stop ? stop.name : 'בחר תחנה'}
          </Txt>
          {stop ? (
            <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 2 }}>
              {stop.city ? stop.city + ' · ' : ''}רציף {stop.code}
            </Txt>
          ) : null}
        </View>
        <Txt variant="caption" color={colors.accentDeep}>
          שנה
        </Txt>
      </View>
    </Squish>
  );
}

/** "🚌 האוטובוס שלי" — origin stop, destination stop and desired arrival time. */
export function TransitSetup({
  plan,
  onChange,
}: {
  plan: TransitPlan | undefined;
  onChange: (next: TransitPlan) => void;
}) {
  const current: TransitPlan = plan ?? {};
  const [picking, setPicking] = useState<'origin' | 'destination' | null>(null);
  const { hour, minute } = parse(current.arriveBy);

  const setArriveBy = (h: number, m: number) =>
    onChange({ ...current, arriveBy: format(h, m) });

  return (
    <View style={[styles.card, shadow.soft]}>
      <Txt variant="body" style={{ marginBottom: space(3) }}>
        🚌 פרטי הנסיעה
      </Txt>

      <View style={{ gap: space(2.5) }}>
        <StopRow
          label="📍 תחנת מוצא"
          stop={current.originStop}
          onPress={() => setPicking('origin')}
        />
        <StopRow
          label="📍 תחנת יעד"
          stop={current.destinationStop}
          onPress={() => setPicking('destination')}
        />
      </View>

      <View style={[row, styles.timeRow]}>
        <Txt variant="body" style={{ flex: 1 }}>
          ⏰ להגיע עד
        </Txt>
        <Squish onPress={() => setArriveBy(hour, minute - MINUTE_STEP)} scaleTo={0.85} accessibilityLabel="הפחת דקות">
          <View style={styles.stepButton}>
            <Txt style={styles.stepGlyph}>−</Txt>
          </View>
        </Squish>
        <View style={{ minWidth: 62 }}>
          <Txt variant="h2" center>
            {format(hour, minute)}
          </Txt>
        </View>
        <Squish onPress={() => setArriveBy(hour, minute + MINUTE_STEP)} scaleTo={0.85} accessibilityLabel="הוסף דקות">
          <View style={styles.stepButton}>
            <Txt style={styles.stepGlyph}>+</Txt>
          </View>
        </Squish>
      </View>

      <View style={[row, styles.hourRow]}>
        <Txt variant="caption" color={colors.textSoft} style={{ flex: 1 }}>
          שעה
        </Txt>
        <Squish onPress={() => setArriveBy(hour - 1, minute)} scaleTo={0.85} accessibilityLabel="שעה אחורה">
          <View style={styles.stepButtonSmall}>
            <Txt style={styles.stepGlyph}>−</Txt>
          </View>
        </Squish>
        <Squish onPress={() => setArriveBy(hour + 1, minute)} scaleTo={0.85} accessibilityLabel="שעה קדימה">
          <View style={styles.stepButtonSmall}>
            <Txt style={styles.stepGlyph}>+</Txt>
          </View>
        </Squish>
      </View>

      <StopPicker
        visible={picking !== null}
        title={picking === 'destination' ? 'תחנת היעד' : 'תחנת המוצא'}
        onClose={() => setPicking(null)}
        onPick={(stop) => {
          onChange(
            picking === 'destination'
              ? { ...current, destinationStop: stop }
              : { ...current, originStop: stop },
          );
          setPicking(null);
        }}
      />
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
  pickRow: {
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSoft,
    paddingHorizontal: space(3.5),
    paddingVertical: space(3),
  },
  timeRow: {
    marginTop: space(4),
    gap: space(2),
  },
  hourRow: {
    marginTop: space(2),
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
  stepButtonSmall: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepGlyph: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '700',
    color: colors.textSoft,
  },
});
