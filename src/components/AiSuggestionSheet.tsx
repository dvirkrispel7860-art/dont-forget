import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Analysis, DestinationTarget } from '../aiAnalysis';
import { runSafely, useNative } from '../animate';
import { colors, contentMaxWidth, radius, row, shadow, space } from '../theme';
import { Destination } from '../types';
import { Button, Squish, Txt } from './ui';

/**
 * The AI result window: what was understood, what is suggested, and where it
 * should go. Nothing is written anywhere — and no destination is created — until
 * the user taps "הוסף לרשימה".
 */
export function AiSuggestionSheet({
  visible,
  analysis,
  destinations,
  onClose,
  onAdd,
}: {
  visible: boolean;
  analysis: Analysis | null;
  destinations: Destination[];
  onClose: () => void;
  onAdd: (target: DestinationTarget, names: string[]) => void;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const t = useRef(new Animated.Value(0)).current;

  const [excluded, setExcluded] = useState<string[]>([]);
  const [target, setTarget] = useState<DestinationTarget | null>(null);

  useEffect(
    () =>
      runSafely(
        Animated.timing(t, {
          toValue: visible ? 1 : 0,
          duration: visible ? 300 : 180,
          easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
          useNativeDriver: useNative,
        }),
        t,
        visible ? 1 : 0,
        800,
      ),
    [visible, t],
  );

  // Each new answer starts fresh, pre-aimed at whatever the analysis matched.
  useEffect(() => {
    if (!analysis) return;
    setExcluded([]);
    setTarget(analysis.understood ? analysis.destination : null);
  }, [analysis]);

  const understood = analysis?.understood === true ? analysis : null;
  const things = understood?.suggestions ?? [];
  const selected = things.filter((thing) => !excluded.includes(thing.name));
  const canAdd = selected.length > 0 && target !== null;

  const toggle = (name: string) =>
    setExcluded((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );

  const sameTarget = (a: DestinationTarget | null, b: DestinationTarget) =>
    a !== null &&
    a.kind === b.kind &&
    (a.kind === 'existing' && b.kind === 'existing' ? a.id === b.id : a.name === b.name);

  /*
   * When an existing destination matched, only existing destinations are
   * offered — creating another one would be a duplicate. The "new destination"
   * chip appears only when nothing matched.
   */
  const targetOptions: DestinationTarget[] = understood
    ? [
        ...destinations.map(
          (d): DestinationTarget => ({
            kind: 'existing',
            id: d.id,
            name: d.name,
            icon: d.icon,
          }),
        ),
        ...(understood.destination.kind === 'new' ? [understood.destination] : []),
      ]
    : [];

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay, opacity: t }]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>

        <View style={styles.sheetWrap} pointerEvents="box-none">
          <Animated.View
            style={[
              styles.sheet,
              {
                paddingBottom: insets.bottom + space(4),
                maxHeight: height * 0.85,
                transform: [
                  { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [420, 0] }) },
                ],
              },
            ]}
          >
            <View style={styles.grabber} />

            {understood === null ? (
              /* Nothing was understood — say so instead of guessing. */
              <View>
                <View style={row}>
                  <Txt style={styles.brain}>🤔</Txt>
                  <Txt variant="h2" style={{ marginHorizontal: space(2) }}>
                    לא בטוח שהבנתי
                  </Txt>
                </View>
                <Txt variant="body" color={colors.textSoft} style={{ marginTop: space(3.5) }}>
                  נסה לכתוב לאן אתה הולך — למשל “אני הולך לים” או “יש לי אימון כדורגל”.
                </Txt>
                <Button
                  label="נסה שוב"
                  onPress={onClose}
                  style={{ marginTop: space(6) }}
                />
              </View>
            ) : (
              <>
                <ScrollView showsVerticalScrollIndicator={false}>
                  <View style={row}>
                    <Txt style={styles.brain}>🧠</Txt>
                    <Txt variant="h2" style={{ marginHorizontal: space(2) }}>
                      הצעה חכמה
                    </Txt>
                  </View>

                  <Txt variant="caption" color={colors.textFaint} style={{ marginTop: space(2) }}>
                    ניתוח מקומי במכשיר — בלי שירות חיצוני.
                  </Txt>

                  {/* What the app understood. */}
                  <View style={[row, styles.understood]}>
                    <Txt style={styles.understoodEmoji}>{understood.activity.emoji}</Txt>
                    <View style={{ flex: 1, marginHorizontal: space(2.5) }}>
                      <Txt variant="caption" color={colors.textFaint}>
                        הבנתי
                      </Txt>
                      <Txt variant="body" numberOfLines={1}>
                        {understood.activity.label}
                      </Txt>
                    </View>
                  </View>

                  <Txt
                    variant="label"
                    color={colors.textSoft}
                    style={{ marginTop: space(5), marginBottom: space(3) }}
                  >
                    דברים שכדאי לשקול לקחת:
                  </Txt>

                  <View style={{ gap: space(2.5) }}>
                    {things.map((thing) => {
                      const on = !excluded.includes(thing.name);
                      return (
                        <Squish
                          key={thing.name}
                          onPress={() => toggle(thing.name)}
                          scaleTo={0.985}
                          accessibilityLabel={`${on ? 'בטל' : 'בחר'} ${thing.name}`}
                        >
                          <View style={[row, styles.thing, on && styles.thingOn]}>
                            <View style={[styles.box, on && styles.boxOn]}>
                              {on ? <Txt style={styles.tick}>✓</Txt> : null}
                            </View>
                            <Txt style={styles.thingEmoji}>{thing.emoji}</Txt>
                            <Txt
                              variant="body"
                              color={on ? colors.text : colors.textFaint}
                              numberOfLines={1}
                              style={{ flex: 1, marginHorizontal: space(2) }}
                            >
                              {thing.name}
                            </Txt>
                          </View>
                        </Squish>
                      );
                    })}
                  </View>

                  <Txt
                    variant="label"
                    color={colors.textSoft}
                    style={{ marginTop: space(5), marginBottom: space(3) }}
                  >
                    {understood.destination.kind === 'existing'
                      ? 'לאיזה יעד להוסיף?'
                      : 'אין יעד מתאים — ליצור אחד?'}
                  </Txt>

                  <View style={styles.chips}>
                    {targetOptions.map((option) => {
                      const on = sameTarget(target, option);
                      const isNew = option.kind === 'new';
                      return (
                        <Squish
                          key={option.kind === 'existing' ? option.id : `new:${option.name}`}
                          onPress={() => setTarget(option)}
                          scaleTo={0.94}
                          accessibilityLabel={
                            isNew ? `צור יעד חדש ${option.name}` : `הוסף ליעד ${option.name}`
                          }
                        >
                          <View style={[row, styles.chip, on && styles.chipOn]}>
                            <Txt style={styles.chipEmoji}>{isNew ? '➕' : option.icon}</Txt>
                            <Txt
                              variant="caption"
                              color={on ? colors.accentDeep : colors.textSoft}
                              numberOfLines={1}
                              style={{ marginHorizontal: space(1.5) }}
                            >
                              {isNew ? `יעד חדש: ${option.icon} ${option.name}` : option.name}
                            </Txt>
                          </View>
                        </Squish>
                      );
                    })}
                  </View>

                  {target?.kind === 'new' ? (
                    <Txt variant="caption" color={colors.textFaint} style={{ marginTop: space(3) }}>
                      היעד ייווצר רק כשתאשר. אפשר להוסיף לו כתובת לניווט אחר כך.
                    </Txt>
                  ) : null}
                </ScrollView>

                <Button
                  label={`➕ הוסף לרשימה${selected.length > 0 ? ` (${selected.length})` : ''}`}
                  disabled={!canAdd}
                  style={{ marginTop: space(4) }}
                  onPress={() => {
                    if (!canAdd || target === null) return;
                    onAdd(
                      target,
                      selected.map((thing) => thing.name),
                    );
                  }}
                />
                <Button
                  label="סגור"
                  variant="ghost"
                  size="md"
                  onPress={onClose}
                  style={{ marginTop: space(1) }}
                />
              </>
            )}
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheetWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  sheet: {
    width: '100%',
    maxWidth: contentMaxWidth,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space(5),
    paddingTop: space(3),
    ...shadow.card,
  },
  grabber: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    marginBottom: space(4),
  },
  brain: {
    fontSize: 22,
    lineHeight: 29,
  },
  understood: {
    marginTop: space(4),
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: space(3.5),
    paddingVertical: space(3),
  },
  understoodEmoji: {
    fontSize: 22,
    lineHeight: 29,
  },
  thing: {
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSoft,
    paddingHorizontal: space(3),
    paddingVertical: space(3),
  },
  thingOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  box: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  tick: {
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
  thingEmoji: {
    fontSize: 18,
    lineHeight: 24,
    marginStart: space(2.5),
  },
  chips: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: space(2),
  },
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSoft,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    maxWidth: 240,
  },
  chipOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  chipEmoji: {
    fontSize: 15,
    lineHeight: 20,
  },
});
