import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { runSafely, useNative } from '../animate';
import { colors, contentMaxWidth, radius, shadow, space } from '../theme';
import { Txt } from './ui';

/**
 * Icon + label per route. Keys are the file names inside app/(tabs).
 * Settings is deliberately absent — it lives behind the ⚙️ button in the header.
 */
const TAB_META: Record<string, { label: string; icon: string }> = {
  home: { label: 'בית', icon: '🏠' },
  new: { label: 'הוסף יעד', icon: '➕' },
  history: { label: 'היסטוריה', icon: '🕘' },
};

function TabButton({
  label,
  icon,
  focused,
  onPress,
}: {
  label: string;
  icon: string;
  focused: boolean;
  onPress: () => void;
}) {
  // One value drives the active pill and the lift of the icon.
  const active = useRef(new Animated.Value(focused ? 1 : 0)).current;
  const press = useRef(new Animated.Value(1)).current;

  useEffect(
    () =>
      runSafely(
        Animated.timing(active, {
          toValue: focused ? 1 : 0,
          duration: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
        active,
        focused ? 1 : 0,
        650,
      ),
    [focused, active],
  );

  const to = (value: number) =>
    Animated.spring(press, {
      toValue: value,
      useNativeDriver: useNative,
      speed: 44,
      bounciness: 6,
    }).start();

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      onPress={onPress}
      onPressIn={() => to(0.92)}
      onPressOut={() => to(1)}
      style={styles.tab}
    >
      <Animated.View style={[styles.tabInner, { transform: [{ scale: press }] }]}>
        <Animated.View
          style={[
            styles.pill,
            {
              backgroundColor: active.interpolate({
                inputRange: [0, 1],
                outputRange: ['rgba(237, 239, 254, 0)', colors.accentSoft],
              }),
            },
          ]}
        >
          <Animated.Text
            style={[
              styles.icon,
              {
                transform: [
                  {
                    scale: active.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 1.12],
                    }),
                  },
                ],
              },
            ]}
          >
            {icon}
          </Animated.Text>
        </Animated.View>

        <Txt
          variant="caption"
          center
          color={focused ? colors.accentDeep : colors.textFaint}
          numberOfLines={1}
          style={[styles.label, focused && { fontWeight: '700' }]}
        >
          {label}
        </Txt>
      </Animated.View>
    </Pressable>
  );
}

export function TabBar({ state, navigation, insets }: BottomTabBarProps) {
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space(2)) }]}>
      {/* row-reverse so the first tab sits on the right, matching the RTL reading order */}
      <View style={styles.row}>
        {state.routes.map((route, index) => {
          const meta = TAB_META[route.name];
          if (!meta) return null;

          const focused = state.index === index;

          return (
            <TabButton
              key={route.key}
              label={meta.label}
              icon={meta.icon}
              focused={focused}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) {
                  navigation.navigate(route.name);
                }
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: space(2),
    ...shadow.card,
  },
  row: {
    flexDirection: 'row-reverse',
    alignSelf: 'center',
    width: '100%',
    maxWidth: contentMaxWidth,
    paddingHorizontal: space(2),
  },
  tab: {
    flex: 1,
  },
  tabInner: {
    alignItems: 'center',
    // Keeps the whole tab comfortably tappable on small screens.
    minHeight: 52,
    justifyContent: 'center',
  },
  pill: {
    width: 52,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 19,
    lineHeight: 24,
  },
  label: {
    marginTop: 3,
    fontSize: 11,
    lineHeight: 15,
  },
});
