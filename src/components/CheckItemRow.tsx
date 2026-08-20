import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { runSafely } from '../animate';
import { colors, radius, row, shadow, space } from '../theme';
import { Item } from '../types';
import { FadeIn, Squish, Txt } from './ui';

/** One line of the exit check: tap it to mark the thing as taken. */
export function CheckItemRow({
  item,
  skipped,
  index,
  onToggle,
  onSkipPress,
  onRestore,
}: {
  item: Item;
  skipped: boolean;
  index: number;
  onToggle: () => void;
  onSkipPress: () => void;
  onRestore: () => void;
}) {
  const on = item.checked && !skipped;
  const p = useRef(new Animated.Value(on ? 1 : 0)).current;

  useEffect(
    () =>
      runSafely(
        Animated.timing(p, {
          toValue: on ? 1 : 0,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
        p,
        on ? 1 : 0,
        700,
      ),
    [on, p],
  );

  const boxBg = p.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.surfaceSoft, colors.success],
  });
  const boxBorder = p.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.border, colors.success],
  });

  // The row body and the "לא צריך הפעם" control are siblings, not nested.
  return (
    <FadeIn delay={index * 45}>
      <View
        style={[
          row,
          styles.card,
          shadow.soft,
          on && styles.cardOn,
          skipped && styles.cardSkipped,
        ]}
      >
        <Squish
          onPress={skipped ? onRestore : onToggle}
          scaleTo={0.985}
          style={{ flex: 1 }}
          accessibilityLabel={item.name}
        >
          <View style={row}>
            {skipped ? (
              <View style={styles.skippedBox}>
                <View style={styles.dash} />
              </View>
            ) : (
              <Animated.View
                style={[styles.box, { backgroundColor: boxBg, borderColor: boxBorder }]}
              >
                <Animated.Text
                  style={[styles.tick, { opacity: p, transform: [{ scale: p }] }]}
                >
                  ✓
                </Animated.Text>
              </Animated.View>
            )}

            <View style={{ flex: 1, marginHorizontal: space(3) }}>
              <Txt
                variant="h2"
                color={skipped ? colors.textFaint : colors.text}
                numberOfLines={2}
                style={skipped ? styles.struck : undefined}
              >
                {item.name}
              </Txt>
              {skipped ? (
                <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 2 }}>
                  לא צריך הפעם
                </Txt>
              ) : null}
            </View>
          </View>
        </Squish>

        <Squish
          onPress={skipped ? onRestore : onSkipPress}
          scaleTo={0.9}
          accessibilityLabel={skipped ? 'החזר לרשימה' : 'לא צריך הפעם'}
        >
          <View style={[styles.pill, skipped && styles.pillRestore]}>
            <Txt
              variant="caption"
              center
              color={skipped ? colors.accentDeep : colors.textFaint}
              style={styles.pillText}
            >
              {skipped ? 'החזר' : 'לא צריך\nהפעם'}
            </Txt>
          </View>
        </Squish>
      </View>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: space(3.5),
    paddingHorizontal: space(4),
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  cardOn: {
    backgroundColor: colors.successSoft,
    borderColor: 'rgba(15, 169, 104, 0.35)',
  },
  cardSkipped: {
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.border,
  },
  box: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tick: {
    color: '#FFFFFF',
    fontSize: 19,
    lineHeight: 23,
    fontWeight: '800',
  },
  skippedBox: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dash: {
    width: 12,
    height: 2,
    borderRadius: 2,
    backgroundColor: colors.textFaint,
  },
  struck: {
    textDecorationLine: 'line-through',
  },
  pill: {
    paddingHorizontal: space(2.5),
    paddingVertical: space(1.5),
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSoft,
    minWidth: 62,
  },
  pillRestore: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accentSoft,
  },
  pillText: {
    fontSize: 11,
    lineHeight: 14,
  },
});
