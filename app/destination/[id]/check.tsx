import React, { useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { CheckItemRow } from '../../../src/components/CheckItemRow';
import { ProgressBar } from '../../../src/components/ProgressBar';
import { MyRouteCard } from '../../../src/components/MyRouteCard';
import { Sheet } from '../../../src/components/Sheet';
import { SuggestionsCard } from '../../../src/components/SuggestionsCard';
import {
  Button,
  FadeIn,
  Screen,
  ScreenHeader,
  Squish,
  Txt,
} from '../../../src/components/ui';
import { itemsCountLabel } from '../../../src/hebrew';
import { activeItems, useStore } from '../../../src/store';
import { suggestItems } from '../../../src/suggestions';
import { colors, radius, row, shadow, space } from '../../../src/theme';
import { navigationQuery, openWaze } from '../../../src/waze';

export default function CheckScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const {
    getDestination,
    toggleItem,
    removeItem,
    isExiting,
    startExit,
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

  const goHome = () => {
    if (router.canGoBack()) router.back();
    else router.dismissTo('/home');
  };

  /** The "🚀 מצב יציאה" screen for this destination — a view over the live exit. */
  const goToExitMode = (id: string) =>
    router.push({ pathname: '/destination/[id]/exit', params: { id } });

  const items = activeItems(destination);
  const skipped = destination ? skippedIds(destination.id) : [];
  // The one flag that decides which phase of the leaving flow is on screen.
  const exiting = destination ? isExiting(destination.id) : false;

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

  // Recommendations only — the list is never changed without the user asking.
  const { suggestions } = useMemo(
    () => suggestItems(destination, trips),
    [destination, trips],
  );

  if (!destination) {
    return (
      <Screen>
        <ScreenHeader onBack={goHome} />
        <View style={styles.center}>
          <Txt variant="h2" center color={colors.textSoft}>
            {hydrated ? 'היעד לא נמצא' : ''}
          </Txt>
        </View>
      </Screen>
    );
  }

  const askingItem = items.find((i) => i.id === askingFor);

  return (
    <Screen>
      <ScreenHeader title={destination.name} onBack={goHome} />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <FadeIn>
          <View style={[row, { gap: space(2.5) }]}>
            <Txt style={styles.bigIcon}>{destination.icon}</Txt>
            <Txt variant="title">בדיקת יציאה</Txt>
          </View>
          <Txt variant="body" color={colors.textSoft} style={{ marginTop: space(2) }}>
            ודא שכל מה שאתה צריך איתך.
          </Txt>
          {destination.address?.trim() ? (
            <Txt
              variant="caption"
              color={colors.textFaint}
              numberOfLines={1}
              style={{ marginTop: space(2) }}
            >
              📍 {destination.address.trim()}
            </Txt>
          ) : null}
        </FadeIn>

        {/* An exit already in progress — after a refresh or a fresh app launch
            this is the way back into 🚀 מצב יציאה. It does not start anything:
            the exit is already live, this only reopens its screen. */}
        {exiting ? (
          <FadeIn delay={50} style={{ marginTop: space(5) }}>
            <Squish
              onPress={() => goToExitMode(destination.id)}
              scaleTo={0.985}
              accessibilityLabel="המשך למצב יציאה"
            >
              <View style={[row, styles.resumeCard, shadow.soft]}>
                <Txt style={styles.resumeIcon}>🚀</Txt>
                <View style={{ flex: 1, marginHorizontal: space(3) }}>
                  <Txt variant="label" color={colors.accentDeep}>
                    יציאה פעילה
                  </Txt>
                  <Txt variant="caption" color={colors.textSoft} style={{ marginTop: 2 }}>
                    המשך למצב יציאה
                  </Txt>
                </View>
                <Txt variant="h2" color={colors.textFaint}>
                  ‹
                </Txt>
              </View>
            </Squish>
          </FadeIn>
        ) : null}

        {items.length === 0 ? (
          <FadeIn delay={100}>
            <View style={styles.empty}>
              <Txt variant="h2" center>
                אין פריטים ביעד הזה
              </Txt>
              <Txt
                variant="body"
                center
                color={colors.textSoft}
                style={{ marginTop: space(2), marginBottom: space(5) }}
              >
                הוסף את הדברים שאתה לוקח כדי שהבדיקה תעבוד.
              </Txt>
              <Button
                label="הוסף פריטים"
                size="md"
                variant="soft"
                onPress={() =>
                  router.push({
                    pathname: '/destination/[id]/items',
                    params: { id: destination.id },
                  })
                }
              />
            </View>
          </FadeIn>
        ) : (
          <>
            {/* Progress belongs to an exit in progress; before that there is
                nothing to progress through. */}
            {exiting ? (
              // Tighter than the normal-state spacing: the "יציאה פעילה" row
              // above it already opened this section.
              <FadeIn delay={70} style={{ marginTop: space(4) }}>
                <View
                  style={[styles.progressCard, shadow.soft, allReady && styles.progressDone]}
                >
                  <Txt
                    variant="h2"
                    color={allReady ? colors.success : colors.text}
                    style={{ marginBottom: space(3) }}
                  >
                    {allReady ? '🎉 הכול מוכן!' : `${done} מתוך ${counted} מוכנים`}
                  </Txt>
                  <ProgressBar ratio={ratio} done={allReady} />
                </View>
              </FadeIn>
            ) : (
              <FadeIn delay={70} style={{ marginTop: space(6) }}>
                <Txt variant="label" color={colors.textSoft}>
                  {`הרשימה ליעד הזה · ${itemsCountLabel(items.length)}`}
                </Txt>
              </FadeIn>
            )}

            {destination.travelMode === 'bus' ? (
              <FadeIn delay={95} style={{ marginTop: space(4) }}>
                <MyRouteCard plan={destination.transit ?? {}} />
              </FadeIn>
            ) : null}

            {suggestions.length > 0 ? (
              <FadeIn delay={110} style={{ marginTop: space(4) }}>
                <SuggestionsCard
                  suggestions={suggestions}
                  onAddAll={() =>
                    addSuggestedItems(
                      destination.id,
                      suggestions.map((s) => s.name),
                    )
                  }
                />
              </FadeIn>
            ) : null}

            <View style={{ height: space(5) }} />

            <View style={{ gap: space(3) }}>
              {items.map((item, index) => (
                <CheckItemRow
                  key={item.id}
                  item={item}
                  index={index}
                  skipped={skipped.includes(item.id)}
                  readOnly={!exiting}
                  onToggle={() => toggleItem(destination.id, item.id)}
                  onSkipPress={() => setAskingFor(item.id)}
                  onRestore={() => unskip(destination.id, item.id)}
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {/* Hands the destination the user already defined straight to Waze —
            nothing to re-type, and no navigation data faked in-app. */}
        <Button
          label="נווט ליעד 🗺️"
          variant="soft"
          size="md"
          onPress={async () => {
            const result = await openWaze(navigationQuery(destination));
            if (result === 'failed') setWazeFailed(true);
          }}
        />

        {/*
          One flow, two phases — never both buttons at once.
          normal:  🚀 אני יוצא          → startExit
          in-exit: ✅ סיימתי את היציאה  → completeExit
        */}
        {items.length === 0 ? null : exiting ? (
          <Button
            label="✅ סיימתי את היציאה"
            variant="success"
            style={{ marginTop: space(2.5) }}
            onPress={async () => {
              // Saves the trip (items taken included) and ends the exit.
              completeExit(destination.id);

              if (settings.autoOpenWaze) {
                const result = await openWaze(navigationQuery(destination));
                if (result === 'failed') {
                  setWazeFailed(true);
                  return;
                }
              }
              goHome();
            }}
          />
        ) : (
          <Button
            label="🚀 אני יוצא"
            variant="primary"
            style={{ marginTop: space(2.5) }}
            onPress={() => {
              // Unchanged behaviour: the exit still starts here, in the store.
              // The new screen is only where it is now carried out.
              startExit(destination.id);
              goToExitMode(destination.id);
            }}
          />
        )}
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
  bigIcon: {
    fontSize: 30,
    lineHeight: 40,
  },
  progressCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space(4.5),
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  resumeCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.accentSoft,
    paddingHorizontal: space(4),
    paddingVertical: space(3),
  },
  resumeIcon: {
    fontSize: 22,
    lineHeight: 30,
  },
  progressDone: {
    backgroundColor: colors.successSoft,
    borderColor: 'rgba(15, 169, 104, 0.3)',
  },
  empty: {
    marginTop: space(8),
    paddingVertical: space(8),
    paddingHorizontal: space(5),
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border,
    alignItems: 'center',
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
  },
});
