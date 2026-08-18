import React, { useState } from 'react';
import { useRouter } from 'expo-router';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { IconPicker } from '../../src/components/IconPicker';
import { TravelModeSelector } from '../../src/components/TravelModeSelector';
import {
  Button,
  FadeIn,
  HeaderIconAction,
  Screen,
  ScreenHeader,
  Txt,
} from '../../src/components/ui';
import { useStore } from '../../src/store';
import { TravelMode } from '../../src/transit/types';
import { colors, radius, row, rtlText, shadow, space } from '../../src/theme';

export default function NewDestinationScreen() {
  const router = useRouter();
  const { createDestination, updateDestination } = useStore();

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [icon, setIcon] = useState('⚽');
  const [travelMode, setTravelMode] = useState<TravelMode>('car');

  const ready = name.trim().length > 0 && address.trim().length > 0;

  const onContinue = () => {
    if (!ready) return;
    const id = createDestination(name, icon, address);
    updateDestination(id, { travelMode });
    // Leave the tab clean for the next destination, but only after a real
    // submit — switching tabs mid-typing must not lose the draft.
    setName('');
    setAddress('');
    router.push({
      pathname: '/destination/[id]/items',
      params: { id, fresh: '1' },
    });
  };

  return (
    <Screen insetBottom={false}>
      <ScreenHeader
        title="יעד חדש"
        right={
          <HeaderIconAction
            icon="⚙️"
            label="הגדרות"
            onPress={() => router.push('/settings')}
          />
        }
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <FadeIn>
            <Txt variant="title">יעד חדש</Txt>
            <Txt variant="body" color={colors.textSoft} style={{ marginTop: space(1.5) }}>
              לאן אתה הולך באופן קבוע?
            </Txt>
          </FadeIn>

          <FadeIn delay={80} style={{ marginTop: space(7) }}>
            <View style={[row, styles.preview, shadow.soft]}>
              <View style={styles.previewIcon}>
                <Txt style={styles.previewEmoji}>{icon}</Txt>
              </View>
              <View style={{ flex: 1, marginHorizontal: space(3.5) }}>
                <Txt
                  variant="h2"
                  color={name.trim() ? colors.text : colors.textFaint}
                  numberOfLines={1}
                >
                  {name.trim() || 'שם היעד'}
                </Txt>
                <Txt
                  variant="caption"
                  color={colors.textFaint}
                  numberOfLines={1}
                  style={{ marginTop: 3 }}
                >
                  {address.trim() ? `📍 ${address.trim()}` : 'כתובת לניווט'}
                </Txt>
              </View>
            </View>
          </FadeIn>

          <FadeIn delay={140} style={{ marginTop: space(6) }}>
            <Txt variant="label" color={colors.textSoft}>
              שם היעד
            </Txt>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="לדוגמה: אימון כדורגל"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              maxLength={40}
              returnKeyType="next"
            />
          </FadeIn>

          <FadeIn delay={170} style={{ marginTop: space(5) }}>
            <Txt variant="label" color={colors.textSoft}>
              כתובת לניווט
            </Txt>
            <TextInput
              value={address}
              onChangeText={setAddress}
              placeholder="לדוגמה: שדרות הרצל 12, תל אביב"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              maxLength={120}
              returnKeyType="done"
              onSubmitEditing={onContinue}
            />
            <Txt variant="caption" color={colors.textFaint} style={{ marginTop: space(2) }}>
              זו הכתובת ש‑Waze יפתח כשתלחץ על "נווט ליעד".
            </Txt>
          </FadeIn>

          <FadeIn delay={220} style={{ marginTop: space(6) }}>
            <Txt variant="label" color={colors.textSoft} style={{ marginBottom: space(3) }}>
              איך מגיעים?
            </Txt>
            <TravelModeSelector value={travelMode} onChange={setTravelMode} />
            {travelMode === 'bus' ? (
              <Txt variant="caption" color={colors.textFaint} style={{ marginTop: space(2.5) }}>
                את תחנות האוטובוס והשעה נגדיר מיד אחרי שמירת היעד.
              </Txt>
            ) : null}
          </FadeIn>

          <FadeIn delay={260} style={{ marginTop: space(6) }}>
            <Txt variant="label" color={colors.textSoft} style={{ marginBottom: space(3) }}>
              אייקון
            </Txt>
            <IconPicker value={icon} onChange={setIcon} />
          </FadeIn>
        </ScrollView>

        <View style={styles.footer}>
          <Button label="המשך" onPress={onContinue} disabled={!ready} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space(5),
    paddingTop: space(2),
    paddingBottom: space(8),
  },
  preview: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space(4),
  },
  previewIcon: {
    width: 60,
    height: 60,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewEmoji: {
    fontSize: 30,
    lineHeight: 38,
  },
  input: {
    ...rtlText,
    marginTop: space(2),
    height: 58,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: space(4),
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  footer: {
    paddingHorizontal: space(5),
    paddingTop: space(3),
    paddingBottom: space(4),
    backgroundColor: colors.bg,
  },
});
