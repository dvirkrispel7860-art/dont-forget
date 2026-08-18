import React, { useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ScrollView,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { CheckItemRow } from '../../../src/components/CheckItemRow';
import { MyRouteCard } from '../../../src/components/MyRouteCard';
import { ProgressBar } from '../../../src/components/ProgressBar';
import { Sheet } from '../../../src/components/Sheet';
import {
  Button,
  FadeIn,
  Screen,
  ScreenHeader,
  Txt,
} from '../../../src/components/ui';
import { formatTripClock, formatTripDate } from '../../../src/hebrew';
import { reminderDaysLabel } from '../../../src/notifications';
import { activeItems, useStore } from '../../../src/store';
import { suggestItems } from '../../../src/suggestions';
import { colors, radius, row, shadow, space } from '../../../src/theme';
import { TRAVEL_MODES } from '../../../src/transit/types';
import { navigationQuery, openWaze } from '../../../src/waze';

/**
 * 🚀 מצב יציאה — everything the user needs in the last moment before leaving,
 * on one screen.
 *
 * This screen owns no exit state of its own: it is a view over the exit the
 * existing flow already started. "🚀 אני יוצא" on the check screen calls
 * startExit and pushes here; "✅ סיימתי את היציאה" below calls the very same
 * completeExit the check screen calls. Because the active exit lives in
 * `dont-forget:active-exits:v1`, a refresh — or reopening the app — lands back
 * on a live exit with the ticks intact instead of a dead screen.
 *
 * Nothing here is invented: bus rides come from the timetable provider, the
 * suggestions from saved trips, the reminder from the destination. There is no
 * weather area at all — we have no weather source, and a made-up forecast is
 * worse than none. When a real one exists it becomes one more <Card /> below.
 */

/** One area of the screen. Each section is its own card so nothing reads as a wall. */
function Card({
  title,
  children,
  style,
}: {
  title?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.card, shadow.soft, style]}>
      {title ? (
        <Txt variant="body" style={{ marginBottom: space(3) }}>
          {title}
        </Txt>
      ) : null}
      {children}
    </View>
  );
}

export default function ExitModeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const {
    getDestination,
    toggleItem,
    removeItem,
    isExiting,
    exitStartedAt,
    completeExit,
    skippedIds,
    skipOnce,
    unskip,
    hydrated,
    settings,
    trips,
    addSuggestedItems,
  } = useStore();

  const destination = getDestination(params.id);
  const [askingFor, setAskingFor] = useState<string | null>(null);
  const [wazeFailed, setWazeFailed] = useState(false);
  // Keeps the screen on its feet between completeExit and navigating away, so
  // the "no active exit" state never flashes on the way out.
  const [finishing, setFinishing] = useState(false);

  const items = activeItems(destination);
  const skipped = destination ? skippedIds(destination.id) : [];

  // Same arithmetic as the check screen: skipped items leave the count.
  const { counted, done, ratio, allReady } = useMemo(() => {
    const c = items.filter((i) => !skipped.includes(i.id));
    const d = c.filter((i) => i.checked).length;
    return {
      counted: c.length,
      done: d,
      ratio: c.length === 0 ? 1 : d / c.length,
      allReady: c.length === 0 || d === c.length,
    };
  }, [items, skipped]);

  const { suggestions } = useMemo(
    () => suggestItems(destination, trips),
    [destination, trips],
  );

  /** Back to the destination screen we came from, or home on a cold open. */
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.dismissTo('/home');
  };

  if (!hydrated || !destination) {
    return (
      <Screen>
        <ScreenHeader title="מצב יציאה" onBack={goBack} />
        <View style={styles.center}>
          <Txt variant="h2" center color={colors.textSoft}>
            {hydrated ? 'היעד לא נמצא' : ''}
          </Txt>
        </View>
      </Screen>
    );
  }

  const startedAt = exitStartedAt(destination.id);
  const exiting = isExiting(destination.id);

  // Reached without a live exit — someone opened the URL directly, or the exit
  // was already finished elsewhere. Nothing is started from here: beginning an
  // exit stays the job of "🚀 אני יוצא" on the destination screen.
  if (!exiting && !finishing) {
    return (
      <Screen>
        <ScreenHeader title={destination.name} onBack={goBack} />
        <View style={styles.center}>
          <Txt variant="h2" center>
            אין יציאה פעילה
          </Txt>
          <Txt
            variant="body"
            center
            color={colors.textSoft}
            style={{ marginTop: space(2), marginBottom: space(6), maxWidth: 280 }}
          >
            כדי להתחיל יציאה חדשה לחץ &quot;🚀 אני יוצא&quot; במסך היעד.
          </Txt>
          <Button label="חזור ליעד" variant="soft" size="md" onPress={goBack} />
        </View>
      </Screen>
    );
  }

  const address = destination.address?.trim();
  const mode = destination.travelMode;
  const modeMeta = mode ? TRAVEL_MODES.find((m) => m.id === mode) : undefined;
  const reminder = destination.reminder;
  const askingItem = items.find((i) => i.id === askingFor);

  const navigate = async () => {
    const result = await openWaze(navigationQuery(destination));
    if (result === 'failed') setWazeFailed(true);
  };

  const finish = async () => {
    if (finishing) return;
    setFinishing(true);

    // Writes the trip to history: which items were taken, and when it ended.
    completeExit(destination.id);

    if (settings.autoOpenWaze) {
      const result = await openWaze(navigationQuery(destination));
      if (result === 'failed') {
        setWazeFailed(true);
        setFinishing(false);
        return;
      }
    }
    goBack();
  };

  return (
    <Screen>
      <ScreenHeader title={destination.name} onBack={goBack} />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <FadeIn>
          <Txt variant="title">🚀 מצב יציאה</Txt>
        </FadeIn>

        {/* -------------------------------------------------- the exit itself */}
        <FadeIn delay={70} style={{ marginTop: space(4) }}>
          <Card style={allReady ? styles.cardDone : undefined}>
            <View style={[row, { gap: space(2.5) }]}>
              <Txt style={styles.bigIcon}>{destination.icon}</Txt>
              <View style={{ flex: 1 }}>
                <Txt variant="h2" numberOfLines={1}>
                  {destination.name}
                </Txt>
                {address ? (
                  <Txt
                    variant="caption"
                    color={colors.textFaint}
                    numberOfLines={1}
                    style={{ marginTop: 2 }}
                  >
                    📍 {address}
                  </Txt>
                ) : null}
              </View>
            </View>

            <View style={[row, { marginTop: space(3.5) }]}>
              <View style={[styles.pill, allReady && styles.pillDone]}>
                <Txt
                  variant="caption"
                  color={allReady ? colors.success : colors.accentDeep}
                >
                  {allReady ? '✓ הכול מוכן' : '● יציאה פעילה'}
                </Txt>
              </View>
              {startedAt != null ? (
                <Txt
                  variant="caption"
                  color={colors.textSoft}
                  numberOfLines={1}
                  style={{ flex: 1, marginHorizontal: space(2.5) }}
                >
                  {formatTripDate(startedAt)} · {formatTripClock(startedAt)}
                </Txt>
              ) : null}
            </View>
          </Card>
        </FadeIn>

        {/* --------------------------------------------------------- the list */}
        <FadeIn delay={100} style={{ marginTop: space(3.5) }}>
          <Card title="📋 הדברים שלוקחים">
            {items.length === 0 ? (
              <Txt variant="caption" color={colors.textFaint}>
                אין פריטים ביעד הזה.
              </Txt>
            ) : (
              <>
                <Txt
                  variant="h2"
                  color={allReady ? colors.success : colors.text}
                  style={{ marginBottom: space(3) }}
                >
                  {allReady ? 'הכול מוכן! 🎉' : `${done} מתוך ${counted} פריטים`}
                </Txt>
                <ProgressBar ratio={ratio} done={allReady} />
              </>
            )}
          </Card>
        </FadeIn>

        {items.length > 0 ? (
          <View style={{ marginTop: space(3.5), gap: space(3) }}>
            {items.map((item, index) => (
              <CheckItemRow
                key={item.id}
                item={item}
                index={index}
                skipped={skipped.includes(item.id)}
                onToggle={() => toggleItem(destination.id, item.id)}
                onSkipPress={() => setAskingFor(item.id)}
                onRestore={() => unskip(destination.id, item.id)}
              />
            ))}
          </View>
        ) : null}

        {/* -------------------------------------------------------- the route */}
        {/* Bus journeys come from the timetable provider, in the same card the
            check screen uses — no times are produced in this screen. */}
        {mode === 'bus' ? (
          <FadeIn delay={135} style={{ marginTop: space(3.5) }}>
            <MyRouteCard plan={destination.transit ?? {}} />
          </FadeIn>
        ) : modeMeta ? (
          <FadeIn delay={135} style={{ marginTop: space(3.5) }}>
            <Card title={`${modeMeta.emoji} הדרך שלי`}>
              <Txt variant="caption" color={colors.textSoft}>
                {`מגיעים ליעד ב${modeMeta.label}.`}
              </Txt>
              {address ? (
                <Txt
                  variant="caption"
                  color={colors.textSoft}
                  numberOfLines={1}
                  style={{ marginTop: space(1.5) }}
                >
                  📍 {address}
                </Txt>
              ) : null}
              <Button
                label="🗺️ פתח ניווט"
                variant="soft"
                size="md"
                onPress={navigate}
                style={{ marginTop: space(3.5) }}
              />
            </Card>
          </FadeIn>
        ) : null}

        {/* The bus card belongs to the provider, and a destination with no
            travel mode gets no route area — but Waze is there either way. */}
        {mode === 'bus' || modeMeta == null ? (
          <FadeIn delay={150} style={{ marginTop: space(3.5) }}>
            <Card title="🗺️ ניווט">
              <Button
                label="🗺️ פתח ניווט"
                variant="soft"
                size="md"
                onPress={navigate}
              />
            </Card>
          </FadeIn>
        ) : null}

        {/* ----------------------------------------------------- the reminder */}
        {reminder ? (
          <FadeIn delay={165} style={{ marginTop: space(3.5) }}>
            <Card title="🔔 תזכורת יציאה">
              <View style={row}>
                <Txt variant="h2">{reminder.time}</Txt>
                <Txt
                  variant="caption"
                  color={colors.textSoft}
                  numberOfLines={1}
                  style={{ flex: 1, marginHorizontal: space(2.5) }}
                >
                  {reminderDaysLabel(reminder.days)}
                </Txt>
              </View>
              {!reminder.enabled ? (
                <Txt
                  variant="caption"
                  color={colors.textFaint}
                  style={{ marginTop: space(2) }}
                >
                  התזכורת כבויה כרגע.
                </Txt>
              ) : null}
            </Card>
          </FadeIn>
        ) : null}

        {/* --------------------------------------------------- the AI section */}
        {/* Only real evidence: every line below was taken in a saved exit. When
            there is nothing to say, no empty card is drawn. */}
        {suggestions.length > 0 ? (
          <FadeIn delay={180} style={{ marginTop: space(3.5) }}>
            <Card title="🧠 כדאי לבדוק">
              <Txt
                variant="caption"
                color={colors.textFaint}
                style={{ marginTop: -space(1), marginBottom: space(3) }}
              >
                לפי היציאות הקודמות שלך
              </Txt>

              <View style={{ gap: space(2.5) }}>
                {suggestions.map((suggestion) => (
                  <View key={suggestion.name} style={[row, styles.suggestionRow]}>
                    <View style={styles.dot} />
                    <Txt
                      variant="body"
                      numberOfLines={1}
                      style={{ flex: 1, marginHorizontal: space(2.5) }}
                    >
                      {suggestion.name}
                    </Txt>
                    <Txt variant="caption" color={colors.textFaint}>
                      {suggestion.takenIn}/{suggestion.outOf} יציאות
                    </Txt>
                  </View>
                ))}
              </View>

              <Button
                label="הוסף לרשימה"
                variant="soft"
                size="md"
                onPress={() =>
                  addSuggestedItems(
                    destination.id,
                    suggestions.map((s) => s.name),
                  )
                }
                style={{ marginTop: space(4) }}
              />
            </Card>
          </FadeIn>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Button label="✅ סיימתי את היציאה" variant="success" onPress={finish} />
      </View>

      <Sheet
        visible={askingItem != null}
        title={askingItem ? `"${askingItem.name}"` : ''}
        subtitle="להוציא את הפריט רק הפעם או להסיר אותו מהיעד?"
        onClose={() => setAskingFor(null)}
        options={[
          {
            label: 'רק הפעם',
            hint: 'יחזור לרשימה בבדיקה הבאה',
            onPress: () => {
              if (askingItem) skipOnce(destination.id, askingItem.id);
              setAskingFor(null);
            },
          },
          {
            label: 'הסר מהיעד',
            hint: 'לא יופיע יותר ביעד הזה',
            tone: 'danger',
            onPress: () => {
              if (askingItem) removeItem(destination.id, askingItem.id);
              setAskingFor(null);
            },
          },
          { label: 'ביטול', tone: 'cancel', onPress: () => setAskingFor(null) },
        ]}
      />

      <Sheet
        visible={wazeFailed}
        title="לא הצלחנו לפתוח את Waze"
        subtitle="בדוק שהאפליקציה מותקנת או שיש חיבור לאינטרנט, ונסה שוב."
        onClose={() => setWazeFailed(false)}
        options={[{ label: 'סגור', tone: 'cancel', onPress: () => setWazeFailed(false) }]}
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
    paddingHorizontal: space(4),
    paddingVertical: space(3.5),
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  cardDone: {
    backgroundColor: colors.successSoft,
    borderColor: 'rgba(15, 169, 104, 0.3)',
  },
  bigIcon: {
    fontSize: 30,
    lineHeight: 40,
  },
  pill: {
    paddingHorizontal: space(3),
    paddingVertical: space(1.5),
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
  },
  pillDone: {
    backgroundColor: colors.surface,
  },
  suggestionRow: {
    minHeight: 26,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  footer: {
    paddingHorizontal: space(5),
    paddingTop: space(3),
    paddingBottom: space(4),
    backgroundColor: colors.bg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space(6),
  },
});
