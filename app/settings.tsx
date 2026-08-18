import React, { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { Sheet } from '../src/components/Sheet';
import { Button, FadeIn, Screen, ScreenHeader, Txt } from '../src/components/ui';
import {
  permissionState,
  requestPermission,
  type PermissionState,
} from '../src/notifications';
import { useStore } from '../src/store';
import { colors, radius, row, rtlText, shadow, space } from '../src/theme';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: space(7) }}>
      <Txt variant="label" color={colors.textSoft} style={{ marginBottom: space(2.5) }}>
        {title}
      </Txt>
      <View style={[styles.card, shadow.soft]}>{children}</View>
    </View>
  );
}

function SwitchRow({
  label,
  hint,
  value,
  onChange,
  last,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  last?: boolean;
}) {
  return (
    <View style={[row, styles.rowItem, !last && styles.divider]}>
      <View style={{ flex: 1, marginEnd: space(3) }}>
        <Txt variant="body">{label}</Txt>
        {hint ? (
          <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 3 }}>
            {hint}
          </Txt>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.border, true: colors.accent }}
        thumbColor="#FFFFFF"
        ios_backgroundColor={colors.border}
      />
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { settings, updateSettings, destinations, trips, clearEverything } = useStore();
  const [confirmClear, setConfirmClear] = useState(false);
  const [permission, setPermission] = useState<PermissionState>('unsupported');

  // Read the browser's current answer on mount; it can change outside the app.
  useEffect(() => setPermission(permissionState()), []);

  const onAskPermission = async () => {
    const next = await requestPermission();
    setPermission(next);
    if (next === 'granted') updateSettings({ notifications: true });
  };

  /*
   * Turning the switch on is the "clear user action" that may prompt for
   * permission. The preference is stored either way, so it survives a refusal.
   */
  const onToggleNotifications = async (notifications: boolean) => {
    updateSettings({ notifications });
    if (notifications && permissionState() === 'default') {
      setPermission(await requestPermission());
    }
  };

  return (
    <Screen>
      <ScreenHeader
        title="הגדרות"
        onBack={() => (router.canGoBack() ? router.back() : router.dismissTo('/home'))}
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
            <Txt variant="title">הגדרות</Txt>
            <Txt variant="body" color={colors.textSoft} style={{ marginTop: space(1.5) }}>
              התאם את האפליקציה לעצמך.
            </Txt>
          </FadeIn>

          <FadeIn delay={60}>
            <Section title="שם המשתמש">
              <View style={styles.rowItem}>
                <TextInput
                  value={settings.userName}
                  onChangeText={(userName) => updateSettings({ userName })}
                  placeholder="איך לקרוא לך?"
                  placeholderTextColor={colors.textFaint}
                  style={styles.input}
                  maxLength={40}
                  returnKeyType="done"
                />
              </View>
            </Section>
          </FadeIn>

          <FadeIn delay={110}>
            <Section title="🔔 התראות">
              <SwitchRow
                label="לאפשר התראות"
                hint={
                  permission === 'granted'
                    ? 'תזכורות יציאה יישלחו לפי מה שהגדרת בכל יעד.'
                    : 'כשההתראות כבויות, לא תישלח שום התראה.'
                }
                value={settings.notifications}
                onChange={onToggleNotifications}
                last={permission === 'granted' || permission === 'unsupported'}
              />

              {permission === 'denied' ? (
                <View style={styles.rowItem}>
                  <Txt variant="body" color={colors.danger}>
                    ⚠️ ההתראות חסומות בדפדפן
                  </Txt>
                  <Txt variant="caption" color={colors.textSoft} style={{ marginTop: space(2) }}>
                    הדפדפן חוסם התראות לאתר הזה, ולכן אי אפשר לבקש שוב מתוך האפליקציה.
                    כדי לאפשר: לחץ על סמל המנעול שליד הכתובת → הרשאות → התראות → אפשר,
                    ואז רענן את הדף.
                  </Txt>
                </View>
              ) : null}

              {permission === 'default' ? (
                <View style={styles.rowItem}>
                  <Txt variant="caption" color={colors.textSoft}>
                    כדי לקבל תזכורות צריך לאשר התראות בדפדפן.
                  </Txt>
                  <Button
                    label="אפשר התראות"
                    variant="soft"
                    size="md"
                    onPress={onAskPermission}
                    style={{ marginTop: space(3), alignSelf: 'stretch' }}
                  />
                </View>
              ) : null}

              {permission === 'unsupported' ? (
                <View style={styles.rowItem}>
                  <Txt variant="caption" color={colors.textFaint}>
                    הדפדפן או המכשיר הזה לא תומך בהתראות.
                  </Txt>
                </View>
              ) : null}
            </Section>
          </FadeIn>

          <FadeIn delay={160}>
            <Section title="הגדרות ניווט">
              <View style={[row, styles.rowItem, styles.divider]}>
                <Txt variant="body" style={{ flex: 1 }}>
                  אפליקציית ניווט
                </Txt>
                <Txt variant="body" color={colors.textSoft}>
                  Waze
                </Txt>
              </View>
              <SwitchRow
                label="פתח ניווט אוטומטית"
                hint='כשתלחץ "סיימתי את היציאה", Waze ייפתח עם הכתובת.'
                value={settings.autoOpenWaze}
                onChange={(autoOpenWaze) => updateSettings({ autoOpenWaze })}
                last
              />
            </Section>
          </FadeIn>

          <FadeIn delay={210}>
            <Section title="נתונים">
              <View style={styles.rowItem}>
                <Txt variant="caption" color={colors.textFaint}>
                  יעדים: {destinations.length} · יציאות בהיסטוריה: {trips.length}
                </Txt>
                <Button
                  label="מחק את כל הנתונים"
                  variant="danger"
                  size="md"
                  onPress={() => setConfirmClear(true)}
                  style={{ marginTop: space(3.5), alignSelf: 'stretch' }}
                />
              </View>
            </Section>
          </FadeIn>
        </ScrollView>
      </KeyboardAvoidingView>

      <Sheet
        visible={confirmClear}
        title="למחוק את כל הנתונים?"
        subtitle="כל היעדים, הרשימות, ההיסטוריה וההגדרות יימחקו. אי אפשר לשחזר."
        onClose={() => setConfirmClear(false)}
        options={[
          {
            label: 'מחק הכול',
            hint: 'הפעולה בלתי הפיכה',
            tone: 'danger',
            onPress: () => {
              setConfirmClear(false);
              clearEverything();
            },
          },
          { label: 'ביטול', tone: 'cancel', onPress: () => setConfirmClear(false) },
        ]}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space(5),
    paddingTop: space(2),
    paddingBottom: space(8),
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  rowItem: {
    paddingHorizontal: space(4),
    paddingVertical: space(3.5),
    minHeight: 60,
    justifyContent: 'center',
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  input: {
    ...rtlText,
    height: 40,
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
    padding: 0,
  },
});
