import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { runSafely, useNative } from '../animate';
import { colors, contentMaxWidth, radius, space } from '../theme';
import { Squish, Txt } from './ui';

export type SheetOption = {
  label: string;
  hint?: string;
  tone?: 'default' | 'danger' | 'cancel';
  onPress: () => void;
};

/**
 * Bottom sheet used for the "לא צריך הפעם" question.
 * Slides up, dims the screen, and closes on backdrop tap.
 */
export function Sheet({
  visible,
  title,
  subtitle,
  options,
  onClose,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  options: SheetOption[];
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const t = useRef(new Animated.Value(0)).current;

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

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: colors.overlay, opacity: t },
          ]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>

        <View style={styles.sheetWrap} pointerEvents="box-none">
          <Animated.View
            style={[
              styles.sheet,
              {
                paddingBottom: insets.bottom + space(4),
                maxHeight: height * 0.8,
                transform: [
                  {
                    translateY: t.interpolate({
                      inputRange: [0, 1],
                      outputRange: [340, 0],
                    }),
                  },
                ],
              },
            ]}
          >
          <View style={styles.grabber} />

          <Txt variant="h2" style={{ marginBottom: space(1) }}>
            {title}
          </Txt>
          {subtitle ? (
            <Txt variant="body" color={colors.textSoft} style={{ marginBottom: space(2) }}>
              {subtitle}
            </Txt>
          ) : null}

          <View style={{ marginTop: space(3), gap: space(2.5) }}>
            {options.map((option) => (
              <Squish key={option.label} onPress={option.onPress} scaleTo={0.975}>
                <View
                  style={[
                    styles.option,
                    option.tone === 'danger' && { backgroundColor: colors.dangerSoft },
                    option.tone === 'cancel' && {
                      backgroundColor: 'transparent',
                      borderWidth: 1.5,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Txt
                    variant="h2"
                    center
                    color={
                      option.tone === 'danger'
                        ? colors.danger
                        : option.tone === 'cancel'
                          ? colors.textSoft
                          : colors.accentDeep
                    }
                  >
                    {option.label}
                  </Txt>
                  {option.hint ? (
                    <Txt
                      variant="caption"
                      center
                      color={option.tone === 'danger' ? colors.danger : colors.textFaint}
                      style={{ marginTop: 2 }}
                    >
                      {option.hint}
                    </Txt>
                  ) : null}
                </View>
              </Squish>
            ))}
            </View>
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
  },
  grabber: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    marginBottom: space(4),
  },
  option: {
    minHeight: 62,
    borderRadius: radius.lg,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space(4),
    paddingVertical: space(2),
  },
});
