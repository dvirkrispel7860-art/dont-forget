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
  canOpenLocationSettings,
  getLocationPermissionStatus,
  locationPermissionLabel,
  openLocationSettings,
  requestLocationPermission,
  type LocationPermission,
} from '../src/location';
import {
  canOpenNotificationSettings,
  notificationPermission,
  openNotificationSettings,
  permissionState,
  requestPermission,
  type PermissionState,
} from '../src/notifications';
import { useStore } from '../src/store';
import { colors, radius, row, rtlText, shadow, space } from '../src/theme';
import { transit } from '../src/transit';
import { weather } from '../src/weather';

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
  const [permission, setPermission] = useState<PermissionState>(() => permissionState());
  const [locationPermission, setLocationPermission] = useState<LocationPermission>('unknown');

  /*
   * The platform's current answer, asked properly. It can change outside the app
   * — in browser site settings or in the OS notification settings — so it is read
   * on mount rather than assumed, and asking never prompts.
   */
  useEffect(() => {
    let alive = true;
    void notificationPermission().then((next) => {
      if (alive) setPermission(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  /*
   * Reading the location permission never prompts — it only reports. The prompt
   * belongs to the button below, and to the features that actually need a
   * location.
   */
  useEffect(() => {
    let alive = true;
    void getLocationPermissionStatus().then((status) => {
      if (alive) setLocationPermission(status);
    });
    return () => {
      alive = false;
    };
  }, []);

  const onAskLocation = async () => {
    setLocationPermission(await requestLocationPermission());
  };

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
    if (!notifications) return;
    if ((await notificationPermission()) === 'default') {
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
                last={permission === 'unsupported'}
              />

              {/* Where the permission lives differs by platform: a phone has OS
                  settings the app can open, a browser has site settings it
                  cannot. The wording follows that, so the instructions are
                  always the ones that actually work here. */}
              {permission === 'denied' ? (
                <View style={styles.rowItem}>
                  <Txt variant="body" color={colors.danger}>
                    {canOpenNotificationSettings()
                      ? '⚠️ ההתראות חסומות בהגדרות המכשיר'
                      : '⚠️ ההתראות חסומות בדפדפן'}
                  </Txt>
                  <Txt variant="caption" color={colors.textSoft} style={{ marginTop: space(2) }}>
                    {canOpenNotificationSettings()
                      ? 'אישרת בעבר "לא" להתראות, ולכן אי אפשר לבקש שוב מתוך האפליקציה. אפשר לאשר אותן בהגדרות המכשיר ואז לחזור לכאן.'
                      : 'הדפדפן חוסם התראות לאתר הזה, ולכן אי אפשר לבקש שוב מתוך האפליקציה. כדי לאפשר: לחץ על סמל המנעול שליד הכתובת → הרשאות → התראות → אפשר, ואז רענן את הדף.'}
                  </Txt>
                  {canOpenNotificationSettings() ? (
                    <Button
                      label="פתח הגדרות מערכת"
                      variant="soft"
                      size="md"
                      onPress={openNotificationSettings}
                      style={{ marginTop: space(3), alignSelf: 'stretch' }}
                    />
                  ) : null}
                </View>
              ) : null}

              {permission === 'default' ? (
                <View style={styles.rowItem}>
                  <Txt variant="caption" color={colors.textSoft}>
                    {canOpenNotificationSettings()
                      ? 'כדי לקבל תזכורות צריך לאשר התראות במכשיר.'
                      : 'כדי לקבל תזכורות צריך לאשר התראות בדפדפן.'}
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

              {/* What the platform can actually promise. On a phone the OS holds
                  the schedule; a browser cannot, and that limit stays visible. */}
              {permission === 'granted' ? (
                <View style={styles.rowItem}>
                  <Txt variant="caption" color={colors.textFaint}>
                    {canOpenNotificationSettings()
                      ? 'התזכורות שמורות אצל מערכת ההפעלה, ולכן הן יגיעו גם כשהאפליקציה סגורה.'
                      : 'בדפדפן ההתראות נשלחות רק כשהאפליקציה פתוחה. אם היא סגורה, התזכורת לא תישלח.'}
                  </Txt>
                </View>
              ) : null}
            </Section>
          </FadeIn>

          {/* The location itself is only ever asked for by the feature that needs
              it. This section reports where things stand and offers a way out of a
              refusal — it does not read the location. */}
          <FadeIn delay={140}>
            <Section title="📍 הרשאת מיקום">
              <View
                style={[
                  styles.rowItem,
                  // Nothing follows once it is granted — no dangling line.
                  locationPermission !== 'granted' && styles.divider,
                ]}
              >
                <View style={row}>
                  <Txt variant="body" style={{ flex: 1 }}>
                    מצב ההרשאה
                  </Txt>
                  <Txt
                    variant="body"
                    color={
                      locationPermission === 'granted'
                        ? colors.accentDeep
                        : locationPermission === 'denied'
                          ? colors.danger
                          : colors.textSoft
                    }
                  >
                    {locationPermissionLabel(locationPermission)}
                  </Txt>
                </View>
                <Txt variant="caption" color={colors.textFaint} style={{ marginTop: space(2) }}>
                  המיקום משמש למצוא תחנת אוטובוס קרובה אליך ולסמן מיקום ליעד. הוא
                  נקרא רק כשפיצ׳ר צריך אותו, לא נשלח לשום שרת, ולא נשמרת היסטוריית
                  מיקומים.
                </Txt>
              </View>

              {locationPermission === 'unknown' ? (
                <View style={styles.rowItem}>
                  <Txt variant="caption" color={colors.textSoft}>
                    עוד לא ביקשנו מיקום. אפשר לאשר כאן מראש, או להשאיר — נבקש כשצריך.
                  </Txt>
                  <Button
                    label="אפשר מיקום"
                    variant="soft"
                    size="md"
                    onPress={onAskLocation}
                    style={{ marginTop: space(3), alignSelf: 'stretch' }}
                  />
                </View>
              ) : null}

              {locationPermission === 'denied' ? (
                <View style={styles.rowItem}>
                  <Txt variant="caption" color={colors.textSoft}>
                    {canOpenLocationSettings()
                      ? 'ההרשאה נדחתה. אפשר לאשר אותה בהגדרות המכשיר ואז לנסות שוב.'
                      : 'הדפדפן חוסם מיקום לאתר הזה. לחץ על סמל המנעול שליד הכתובת → הרשאות → מיקום → אפשר, ואז נסה שוב.'}
                  </Txt>
                  <Button
                    label="נסה שוב"
                    variant="soft"
                    size="md"
                    onPress={onAskLocation}
                    style={{ marginTop: space(3), alignSelf: 'stretch' }}
                  />
                  {canOpenLocationSettings() ? (
                    <Button
                      label="פתח הגדרות מערכת"
                      variant="ghost"
                      size="md"
                      onPress={openLocationSettings}
                      style={{ marginTop: space(2), alignSelf: 'stretch' }}
                    />
                  ) : null}
                </View>
              ) : null}

              {locationPermission === 'unavailable' ? (
                <View style={styles.rowItem}>
                  <Txt variant="caption" color={colors.textFaint}>
                    המכשיר או הדפדפן הזה לא מאפשר איתור מיקום. אפשר לבחור תחנה בעצמך
                    בכל מקום שבו צריך אחת.
                  </Txt>
                </View>
              ) : null}
            </Section>
          </FadeIn>

          <FadeIn delay={180}>
            <Section title="הגדרות ניווט">
              {/* Which app opens is decided by the destination's travel mode. */}
              <View style={[styles.rowItem, styles.divider]}>
                <Txt variant="body">אפליקציית ניווט</Txt>
                <Txt variant="caption" color={colors.textSoft} style={{ marginTop: 3 }}>
                  🚗 רכב: Waze · 🚶 הליכה ו‑🚲 אופניים: Google Maps · 🚌 אוטובוס: פרטי
                  הנסיעה באפליקציה
                </Txt>
              </View>
              <SwitchRow
                label="פתח ניווט אוטומטית"
                hint='כשתלחץ "מוכן לצאת", אפליקציית הניווט של היעד תיפתח עם המיקום.'
                value={settings.autoOpenWaze}
                onChange={(autoOpenWaze) => updateSettings({ autoOpenWaze })}
                last
              />
            </Section>
          </FadeIn>

          {/* Both sources are free, keyless and credited here as their licences
              ask (Open-Meteo is CC-BY 4.0). */}
          <FadeIn delay={200}>
            <Section title="מקורות המידע">
              <View style={[styles.rowItem, styles.divider]}>
                <Txt variant="body">🌦️ מזג אוויר</Txt>
                <Txt variant="caption" color={colors.textSoft} style={{ marginTop: 3 }}>
                  {weather.sourceLabel} · {weather.sourceUrl.replace('https://', '')} ·
                  רישיון CC-BY 4.0
                </Txt>
              </View>
              <View style={styles.rowItem}>
                <Txt variant="body">🚌 תחבורה ציבורית</Txt>
                <Txt variant="caption" color={colors.textSoft} style={{ marginTop: 3 }}>
                  {transit.sourceLabel}
                </Txt>
              </View>
            </Section>
          </FadeIn>

          <FadeIn delay={250}>
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
