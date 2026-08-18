import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { runSafely } from '../animate';
import { colors, radius } from '../theme';

export function ProgressBar({
  ratio,
  done,
}: {
  /** 0 → 1 */
  ratio: number;
  done: boolean;
}) {
  const t = useRef(new Animated.Value(ratio)).current;

  useEffect(
    () =>
      runSafely(
        Animated.timing(t, {
          toValue: ratio,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
        t,
        ratio,
        900,
      ),
    [ratio, t],
  );

  return (
    <View
      style={{
        height: 10,
        borderRadius: radius.pill,
        backgroundColor: colors.border,
        overflow: 'hidden',
        // The track fills from the right, matching the RTL reading direction.
        alignItems: 'flex-end',
      }}
    >
      <Animated.View
        style={{
          height: '100%',
          borderRadius: radius.pill,
          backgroundColor: done ? colors.success : colors.accent,
          width: t.interpolate({
            inputRange: [0, 1],
            outputRange: ['0%', '100%'],
          }),
        }}
      />
    </View>
  );
}
