import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, row, shadow, space } from '../theme';
import { transit } from '../transit';
import { TransitOption, TransitPlan } from '../transit/types';
import { Button, Txt } from './ui';

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

function scheduleNote(option: TransitOption): string {
  const todayIso = new Date().toISOString().slice(0, 10);
  if (option.scheduleDate === todayIso) return '';
  const [y, m, d] = option.scheduleDate.split('-');
  return ` · לפי לוח הזמנים מ-${Number(d)}.${Number(m)}.${y}`;
}

function OptionRow({ option, highlight }: { option: TransitOption; highlight: boolean }) {
  return (
    <View style={[styles.option, highlight && styles.optionOn]}>
      <View style={row}>
        <View style={[styles.lineBadge, highlight && styles.lineBadgeOn]}>
          <Txt variant="label" center color={highlight ? '#FFFFFF' : colors.accentDeep}>
            {option.lineNumber}
          </Txt>
        </View>
        <Txt
          variant="caption"
          color={colors.textFaint}
          numberOfLines={1}
          style={{ flex: 1, marginHorizontal: space(2.5) }}
        >
          🚌 קו {option.lineNumber}
          {option.agency ? ` · ${option.agency}` : ''}
        </Txt>
      </View>

      <View style={{ marginTop: space(2.5), gap: space(1.5) }}>
        <View style={row}>
          <Txt variant="caption" color={colors.textSoft} style={{ minWidth: 52 }}>
            🕐 {clock(option.departure)}
          </Txt>
          <Txt variant="caption" numberOfLines={1} style={{ flex: 1, marginHorizontal: space(2) }}>
            📍 {option.boardStopName}
          </Txt>
        </View>
        <View style={row}>
          <Txt variant="caption" color={colors.textSoft} style={{ minWidth: 52 }}>
            🕐 {clock(option.arrival)}
          </Txt>
          <Txt variant="caption" numberOfLines={1} style={{ flex: 1, marginHorizontal: space(2) }}>
            📍 {option.alightStopName}
          </Txt>
        </View>
      </View>
    </View>
  );
}

/**
 * "🚌 הדרך שלי" — the saved journey, plus the matching rides from the official
 * timetable. Nothing is shown unless it came from the data source.
 */
export function MyRouteCard({ plan }: { plan: TransitPlan }) {
  const [options, setOptions] = useState<TransitOption[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = plan.originStop && plan.destinationStop;

  const load = useCallback(async () => {
    if (!plan.originStop || !plan.destinationStop) return;
    setBusy(true);
    setError(null);
    try {
      const [h, m] = (plan.arriveBy ?? '08:00').split(':');
      const arriveBy = new Date();
      arriveBy.setHours(Number(h) || 0, Number(m) || 0, 0, 0);

      const found = await transit.getTransitOptions({
        originCode: plan.originStop.code,
        destinationCode: plan.destinationStop.code,
        arriveBy,
        limit: 4,
      });
      setOptions(found);
      if (found.length === 0) {
        setError('לא נמצאה נסיעה ישירה בין התחנות האלה בטווח השעות הזה.');
      }
    } catch {
      setError('לא הצלחנו לטעון נסיעות. בדוק חיבור לאינטרנט.');
    } finally {
      setBusy(false);
    }
  }, [plan.originStop, plan.destinationStop, plan.arriveBy]);

  // Look up the journey as soon as the card appears with a complete plan.
  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  return (
    <View style={[styles.card, shadow.soft]}>
      <Txt variant="body" style={{ marginBottom: space(3) }}>
        🚌 הדרך שלי
      </Txt>

      <View style={{ gap: space(1.5) }}>
        <Txt variant="caption" color={colors.textSoft} numberOfLines={1}>
          📍 מ: {plan.originStop ? plan.originStop.name : 'לא נבחרה תחנת מוצא'}
        </Txt>
        <Txt variant="caption" color={colors.textSoft} numberOfLines={1}>
          📍 אל: {plan.destinationStop ? plan.destinationStop.name : 'לא נבחרה תחנת יעד'}
        </Txt>
        <Txt variant="caption" color={colors.textSoft}>
          ⏰ להגיע עד: {plan.arriveBy ?? '—'}
        </Txt>
      </View>

      {!ready ? (
        <Txt variant="caption" color={colors.textFaint} style={{ marginTop: space(3) }}>
          כדי למצוא נסיעות צריך לבחור תחנת מוצא ותחנת יעד במסך עריכת היעד.
        </Txt>
      ) : busy ? (
        <Txt variant="caption" color={colors.textSoft} style={{ marginTop: space(3) }}>
          מחפש נסיעות בלוח הזמנים...
        </Txt>
      ) : error ? (
        <>
          <Txt variant="caption" color={colors.textSoft} style={{ marginTop: space(3) }}>
            {error}
          </Txt>
          <Button
            label="נסה שוב"
            variant="soft"
            size="md"
            onPress={load}
            style={{ marginTop: space(3) }}
          />
        </>
      ) : options && options.length > 0 ? (
        <>
          <Txt
            variant="label"
            color={colors.textSoft}
            style={{ marginTop: space(4), marginBottom: space(2.5) }}
          >
            הנסיעה המתאימה הבאה
          </Txt>
          <View style={{ gap: space(2.5) }}>
            {options.map((option, index) => (
              <OptionRow key={option.id} option={option} highlight={index === 0} />
            ))}
          </View>
          <Txt variant="caption" color={colors.textFaint} style={{ marginTop: space(3) }}>
            {transit.sourceLabel}
            {scheduleNote(options[0])}
          </Txt>
        </>
      ) : null}
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
  option: {
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSoft,
    paddingHorizontal: space(3.5),
    paddingVertical: space(3),
  },
  optionOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  lineBadge: {
    minWidth: 40,
    height: 30,
    borderRadius: radius.sm,
    backgroundColor: colors.accentSoft,
    borderWidth: 1.5,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space(1.5),
  },
  lineBadgeOn: {
    backgroundColor: colors.accent,
  },
});
