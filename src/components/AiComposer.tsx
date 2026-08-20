import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, TextInput, View } from 'react-native';
import { useNative } from '../animate';
import { colors, radius, row, rtlText, shadow, space } from '../theme';
import { Squish, Txt } from './ui';

/**
 * The AI area on the home screen: a compact composer that sits directly above
 * the bottom tab bar. Deliberately small — the destinations are still the point
 * of this screen.
 */
export function AiComposer({
  value,
  onChangeText,
  onSubmit,
  listening,
  onToggleMic,
  analyzing = false,
  notice = null,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  listening: boolean;
  onToggleMic: () => void;
  /** Shown in the existing title slot; matters once a real model is wired in. */
  analyzing?: boolean;
  /**
   * Something the user needs to know about dictation — no permission, no engine
   * on this device, nothing heard. Takes the caption slot under the box.
   */
  notice?: string | null;
}) {
  const canSend = value.trim().length > 0 && !analyzing;

  // Soft pulse behind the mic while listening. A loop has no end state, so if
  // the animation driver is throttled the button simply stays still — the
  // colour change alone already communicates the state.
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!listening) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.out(Easing.ease),
          useNativeDriver: useNative,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.in(Easing.ease),
          useNativeDriver: useNative,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [listening, pulse]);

  return (
    <View style={[styles.card, shadow.card]}>
      <View style={[row, styles.titleRow]}>
        <Txt style={styles.brain}>🧠</Txt>
        <Txt
          variant="label"
          color={listening ? colors.danger : colors.text}
          numberOfLines={1}
          style={{ marginHorizontal: space(2), flex: 1 }}
        >
          {analyzing ? 'חושב...' : listening ? 'מקשיב...' : 'מה אתה מתכנן לעשות?'}
        </Txt>
      </View>

      <View style={[row, styles.inputRow]}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder="ספר לי לאן אתה הולך ומה אתה עושה..."
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          maxLength={200}
          returnKeyType="send"
          onSubmitEditing={onSubmit}
        />

        <Squish
          onPress={onToggleMic}
          scaleTo={0.88}
          accessibilityLabel={listening ? 'עצור הקלטה' : 'הקלטה קולית'}
        >
          <View style={styles.micWrap}>
            {listening ? (
              <Animated.View
                style={[
                  styles.pulse,
                  {
                    opacity: pulse.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.45, 0],
                    }),
                    transform: [
                      {
                        scale: pulse.interpolate({
                          inputRange: [0, 1],
                          outputRange: [1, 1.55],
                        }),
                      },
                    ],
                  },
                ]}
              />
            ) : null}
            <View style={[styles.mic, listening && styles.micOn]}>
              <Txt style={styles.micIcon}>🎙️</Txt>
            </View>
          </View>
        </Squish>

        <Squish onPress={onSubmit} disabled={!canSend} scaleTo={0.92} accessibilityLabel="שלח">
          <View style={[styles.send, !canSend && styles.sendDisabled]}>
            <Txt variant="label" center color={canSend ? '#FFFFFF' : colors.textFaint}>
              שלח
            </Txt>
          </View>
        </Squish>
      </View>

      {/* A notice outlives the listening state (a refused permission has to stay
          readable), so it wins the slot. */}
      {notice ? (
        <Txt variant="caption" color={colors.textSoft} style={{ marginTop: space(2) }}>
          {notice}
        </Txt>
      ) : listening ? (
        <Txt variant="caption" color={colors.textFaint} style={{ marginTop: space(2) }}>
          דבר עכשיו... הטקסט ייכנס לתיבה
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1.5,
    borderColor: colors.accentSoft,
    paddingHorizontal: space(4),
    paddingVertical: space(3.5),
  },
  titleRow: {
    marginBottom: space(2.5),
  },
  brain: {
    fontSize: 17,
    lineHeight: 22,
  },
  inputRow: {
    gap: space(2),
  },
  input: {
    ...rtlText,
    flex: 1,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: space(3),
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  micWrap: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulse: {
    position: 'absolute',
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
  },
  mic: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micOn: {
    backgroundColor: colors.dangerSoft,
    borderColor: colors.danger,
  },
  micIcon: {
    fontSize: 18,
    lineHeight: 24,
  },
  send: {
    height: 46,
    minWidth: 62,
    paddingHorizontal: space(3.5),
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: {
    backgroundColor: colors.border,
  },
});
