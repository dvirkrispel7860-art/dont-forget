import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { runSafely, useNative } from '../animate';
import { colors, contentMaxWidth, radius, row, rtlText, shadow, space } from '../theme';

/* ------------------------------------------------------------------ text --- */

type TxtVariant = 'display' | 'title' | 'h2' | 'body' | 'label' | 'caption';

const txtStyles: Record<TxtVariant, TextStyle> = {
  display: { fontSize: 40, lineHeight: 50, fontWeight: '800', letterSpacing: -0.5 },
  title: { fontSize: 29, lineHeight: 38, fontWeight: '800', letterSpacing: -0.3 },
  h2: { fontSize: 21, lineHeight: 29, fontWeight: '700' },
  body: { fontSize: 17, lineHeight: 25, fontWeight: '500' },
  label: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
};

export function Txt({
  variant = 'body',
  color = colors.text,
  center,
  style,
  children,
  numberOfLines,
}: {
  variant?: TxtVariant;
  color?: string;
  center?: boolean;
  style?: StyleProp<TextStyle>;
  children: React.ReactNode;
  numberOfLines?: number;
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        rtlText,
        txtStyles[variant],
        { color },
        center && { textAlign: 'center' },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/* --------------------------------------------------------------- entrance --- */

/** Small, calm entrance animation used across the app. */
export function FadeIn({
  delay = 0,
  offset = 14,
  style,
  children,
}: {
  delay?: number;
  offset?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(
    () =>
      runSafely(
        Animated.timing(t, {
          toValue: 1,
          duration: 380,
          delay,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: useNative,
        }),
        t,
        1,
        delay + 800,
      ),
    [t, delay],
  );

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: t,
          transform: [
            { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [offset, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/* ---------------------------------------------------------------- presses --- */

/** Pressable that gently scales down while held. */
export function Squish({
  onPress,
  onLongPress,
  disabled,
  scaleTo = 0.97,
  style,
  children,
  accessibilityLabel,
}: {
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  scaleTo?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  accessibilityLabel?: string;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const to = (value: number) =>
    Animated.spring(scale, {
      toValue: value,
      useNativeDriver: useNative,
      speed: 40,
      bounciness: 4,
    }).start();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => to(scaleTo)}
      onPressOut={() => to(1)}
      style={style}
    >
      <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>
    </Pressable>
  );
}

/* ---------------------------------------------------------------- buttons --- */

type ButtonVariant = 'primary' | 'success' | 'soft' | 'ghost' | 'danger';

const buttonBg: Record<ButtonVariant, string> = {
  primary: colors.accent,
  success: colors.success,
  soft: colors.accentSoft,
  ghost: 'transparent',
  danger: colors.dangerSoft,
};

const buttonFg: Record<ButtonVariant, string> = {
  primary: '#FFFFFF',
  success: '#FFFFFF',
  soft: colors.accentDeep,
  ghost: colors.textSoft,
  danger: colors.danger,
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'lg',
  disabled = false,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: 'lg' | 'md';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const height = size === 'lg' ? 60 : 48;
  const lifted = variant === 'primary' || variant === 'success';

  return (
    <Squish onPress={onPress} disabled={disabled} scaleTo={0.965} style={style}>
      <View
        style={[
          {
            height,
            borderRadius: radius.pill,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: space(7),
            backgroundColor: disabled ? colors.border : buttonBg[variant],
          },
          lifted && !disabled && shadow.lifted,
          variant === 'ghost' && { paddingHorizontal: space(4) },
        ]}
      >
        <Txt
          variant={size === 'lg' ? 'h2' : 'label'}
          color={disabled ? colors.textFaint : buttonFg[variant]}
          center
        >
          {label}
        </Txt>
      </View>
    </Squish>
  );
}

/* ----------------------------------------------------------------- screen --- */

export function Screen({
  children,
  style,
  insetBottom = true,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Pass false on tab screens — the tab bar already covers the bottom inset. */
  insetBottom?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        {
          flex: 1,
          backgroundColor: colors.bg,
          paddingTop: insets.top,
          paddingBottom: insetBottom ? insets.bottom : 0,
        },
        style,
      ]}
    >
      {/* Centred content column — no effect on phones, keeps desktop readable. */}
      <View style={{ flex: 1, width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center' }}>
        {children}
      </View>
    </View>
  );
}

/** Chevron pointing right — the "back" direction in an RTL interface. */
function BackChevron() {
  return (
    <View
      style={{
        width: 11,
        height: 11,
        borderTopWidth: 2.4,
        borderRightWidth: 2.4,
        borderColor: colors.text,
        transform: [{ rotate: '45deg' }],
        marginRight: 2,
      }}
    />
  );
}

export function ScreenHeader({
  title,
  onBack,
  right,
}: {
  title?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <View style={[row, styles.header]}>
      {onBack ? (
        <Squish onPress={onBack} scaleTo={0.9} accessibilityLabel="חזור">
          <View style={styles.iconButton}>
            <BackChevron />
          </View>
        </Squish>
      ) : (
        <View style={{ width: 44 }} />
      )}

      <View style={{ flex: 1, paddingHorizontal: space(2) }}>
        {title ? (
          <Txt variant="label" color={colors.textSoft} numberOfLines={1}>
            {title}
          </Txt>
        ) : null}
      </View>

      {right ?? <View style={{ width: 44 }} />}
    </View>
  );
}

/**
 * Round icon button for the header. In this RTL layout ScreenHeader's `right`
 * slot renders at the visual left of the screen.
 */
export function HeaderIconAction({
  icon,
  label,
  onPress,
}: {
  icon: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Squish onPress={onPress} scaleTo={0.88} accessibilityLabel={label}>
      <View style={styles.iconButton}>
        <Text style={styles.headerIcon}>{icon}</Text>
      </View>
    </Squish>
  );
}

export function HeaderAction({
  label,
  onPress,
  color = colors.accentDeep,
}: {
  label: string;
  onPress: () => void;
  color?: string;
}) {
  return (
    <Squish onPress={onPress} scaleTo={0.92}>
      <View style={styles.headerAction}>
        <Txt variant="label" color={color}>
          {label}
        </Txt>
      </View>
    </Squish>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 56,
    paddingHorizontal: space(4),
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.soft,
  },
  headerIcon: {
    fontSize: 19,
    lineHeight: 24,
  },
  headerAction: {
    height: 40,
    paddingHorizontal: space(4),
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.soft,
  },
});
