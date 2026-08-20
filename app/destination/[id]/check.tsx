import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ScrollView,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { BusRouteCard } from '../../../src/components/BusRouteCard';
import { CheckItemRow } from '../../../src/components/CheckItemRow';
import { LocationFixSheet } from '../../../src/components/LocationFixSheet';
import { ProgressBar } from '../../../src/components/ProgressBar';
import { Sheet } from '../../../src/components/Sheet';
import { SuggestionsCard } from '../../../src/components/SuggestionsCard';
import { TravelModeSelector } from '../../../src/components/TravelModeSelector';
import { WeatherCard } from '../../../src/components/WeatherCard';
import {
  Button,
  FadeIn,
  Screen,
  ScreenHeader,
  Squish,
  Txt,
} from '../../../src/components/ui';
import { reminderDaysLabel } from '../../../src/notifications';
import { activeItems, useStore } from '../../../src/store';
import {
  navigationAppFor,
  navigationAppName,
  navigationLabel,
  openNavigation,
} from '../../../src/navigation';
import { colors, radius, row, shadow, space } from '../../../src/theme';
import { TRAVEL_MODES } from '../../../src/transit/types';
import { useBusRoute } from '../../../src/transit/useBusRoute';
import { weatherTargetTime } from '../../../src/weather';
import { useDepartureWeather } from '../../../src/weather/useWeather';

/**
 * בדיקת יציאה — the one screen for leaving, with one button.
 *
 * Opening it opens the departure (`startExit`, which clears whatever was ticked
 * on an earlier visit); ticking marks what you are taking; **✅ מוכן לצאת** writes
 * the trip to history and sends you off. Nothing changes shape while you use it —
 * no second screen, no second button, no phase to notice.
 *
 * A departure stays open while the screen is closed, so a refresh or a walk over
 * to the home screen and back keeps the ticks. Only that button closes it.
 *
 * The list, the forecast, the ride and the reminder all come from the existing
 * layers; each one says so in words when it has nothing real to show.
 */

/** One area of the screen, so nothing reads as a wall of text. */
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
    departureMode,
    setDepartureMode,
    updateDestination,
    hydrated,
    settings,
    trips,
    addSuggestedItems,
  } = useStore();

  const destination = getDestination(params.id);
  const [askingFor, setAskingFor] = useState<string | null>(null);
  const [pickingLocation, setPickingLocation] = useState(false);
  /** What to tell the user when navigation could not open. */
  const [navProblem, setNavProblem] = useState<'failed' | 'no-location' | null>(null);

  // For a bus destination the navigation button leads to the ride details, which
  // are already on this screen — so it scrolls there instead of opening a map.
  const scrollRef = useRef<ScrollView>(null);

  const goHome = () => {
    if (router.canGoBack()) router.back();
    else router.dismissTo('/home');
  };

  const items = activeItems(destination);
  const skipped = destination ? skippedIds(destination.id) : [];

  /*
   * Opening the screen opens the departure, so the list starts from zero on a
   * fresh visit. An already open one is left alone — that is what keeps the ticks
   * through a refresh, or a walk over to the home screen and back.
   */
  const destinationId = destination?.id;
  const hasItems = items.length > 0;
  useEffect(() => {
    if (!destinationId || !hasItems) return;
    if (!isExiting(destinationId)) startExit(destinationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinationId, hasItems]);

  const { counted, done, ratio, allReady } = useMemo(() => {
    const c = items.filter((i) => !skipped.includes(i.id));
    const d = c.filter((i) => i.checked).length;
    return {
      counted: c.length,
      done: d,
      ratio: c.length === 0 ? 1 : d / c.length,
      allReady: c.length > 0 && d === c.length,
    };
  }, [items, skipped]);

  /*
   * The forecast for the hour the user will actually be outside, and everything
   * worth checking before leaving — history and weather in one list. Both come
   * from the existing layers; the request itself lives in the weather layer.
   */
  const forecast = useDepartureWeather(destination, trips);

  /*
   * How the user is getting there for *this* departure: their choice on this
   * screen when they made one, and the destination's own setting otherwise. The
   * destination itself is never rewritten by picking here — that stays an
   * explicit "שמור ליעד" tap below the selector.
   */
  const savedMode = destination?.travelMode;
  const chosenMode = destinationId ? departureMode(destinationId) : undefined;
  const mode = chosenMode ?? savedMode;

  /*
   * The hour this departure is aimed at: the destination's "להגיע עד" when it has
   * one, otherwise now. Fixed per destination so the stop search does not restart
   * on every render.
   */
  const arriveAt = useMemo(
    () => weatherTargetTime(destination),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [destinationId, destination?.transit?.arriveBy],
  );

  /*
   * For a bus departure the app finds the stop itself: location, nearby stops,
   * and the nearest one with a real ride to the destination. Only runs while this
   * departure is actually by bus.
   */
  const busRoute = useBusRoute(destination, mode === 'bus', arriveAt);

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

  const address = destination.address?.trim();
  const modeMeta = mode ? TRAVEL_MODES.find((m) => m.id === mode) : undefined;
  const savedModeMeta = savedMode
    ? TRAVEL_MODES.find((m) => m.id === savedMode)
    : undefined;
  const modeDiffersFromSaved = chosenMode != null && chosenMode !== savedMode;
  const reminder = destination.reminder;
  const askingItem = items.find((i) => i.id === askingFor);

  const openItems = () =>
    router.push({
      pathname: '/destination/[id]/items',
      params: { id: destination.id },
    });

  const navigationApp = navigationAppFor(destination, mode);

  const navigate = async () => {
    if (navigationApp === 'transit') {
      /*
       * The rides are on this screen already, at the end of it — so this jumps
       * there. Not animated on purpose: react-native-web's smooth path silently
       * does nothing here, and a jump that works beats a glide that does not.
       */
      scrollRef.current?.scrollToEnd({ animated: false });
      return;
    }
    const outcome = await openNavigation(destination, mode);
    if (outcome.status === 'failed' || outcome.status === 'no-location') {
      setNavProblem(outcome.status);
    }
  };

  return (
    <Screen>
      <ScreenHeader title={destination.name} onBack={goHome} />

      <ScrollView
        ref={scrollRef}
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
          {address ? (
            <Txt
              variant="caption"
              color={colors.textFaint}
              numberOfLines={1}
              style={{ marginTop: space(2) }}
            >
              📍 {address}
            </Txt>
          ) : null}
        </FadeIn>

        {/* ----------------------------------------------------- items & phase */}
        {items.length === 0 ? (
          <FadeIn delay={70} style={{ marginTop: space(6) }}>
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
              <Button label="הוסף פריטים" size="md" variant="soft" onPress={openItems} />
            </View>
          </FadeIn>
        ) : (
          <>
            <FadeIn delay={70} style={{ marginTop: space(5) }}>
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

            <View style={{ marginTop: space(4), gap: space(3) }}>
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
          </>
        )}

        {/* ----------------------------------------------------- 🧠 כדאי לבדוק */}
        {/* Right under the list, because that is what it is about. Draws nothing
            when there is nothing real to suggest. */}
        {forecast.suggestions.length > 0 ? (
          <FadeIn delay={100} style={{ marginTop: space(4) }}>
            <SuggestionsCard
              suggestions={forecast.suggestions}
              onAdd={(name) => addSuggestedItems(destination.id, [name])}
            />
          </FadeIn>
        ) : null}

        {/* --------------------------------------------------------- the weather */}
        <FadeIn delay={110} style={{ marginTop: space(4) }}>
          <WeatherCard
            loading={forecast.loading}
            result={forecast.result}
            onRetry={forecast.reload}
            onPickLocation={() => setPickingLocation(true)}
          />
        </FadeIn>

        {/* ------------------------------------------------------- the reminder */}
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
                  {reminder.enabled ? '' : ' · כבויה'}
                </Txt>
              </View>
            </Card>
          </FadeIn>
        ) : null}

        {/* ------------------------------------------------------- how we get there */}
        <FadeIn delay={205} style={{ marginTop: space(3.5) }}>
          <Card title="🚦 איך מגיעים?">
            <TravelModeSelector
              value={mode}
              onChange={(next) => setDepartureMode(destination.id, next)}
            />

            {modeDiffersFromSaved ? (
              <View style={{ marginTop: space(3) }}>
                <Txt variant="caption" color={colors.textSoft}>
                  {`ליציאה הזאת בלבד. היעד עצמו נשאר ${
                    savedModeMeta ? `${savedModeMeta.emoji} ${savedModeMeta.label}` : 'ללא אמצעי'
                  }.`}
                </Txt>
                {/* The destination's own setting changes only if asked, here. */}
                <Squish
                  onPress={() => updateDestination(destination.id, { travelMode: mode })}
                  scaleTo={0.96}
                  accessibilityLabel="שמור את אמצעי התחבורה ליעד"
                  style={{ alignSelf: 'flex-start', marginTop: space(2) }}
                >
                  <Txt variant="caption" color={colors.accentDeep}>
                    שמור גם ליעד עצמו
                  </Txt>
                </Squish>
              </View>
            ) : null}
          </Card>
        </FadeIn>

        {/* ------------------------------------------------------------- the route */}
        {/* Last on the screen on purpose: "🚌 פרטי נסיעה" scrolls to the end, so
            the ride details are always exactly where that button lands. */}
        {mode === 'bus' ? (
          <FadeIn delay={215} style={{ marginTop: space(3.5) }}>
            <BusRouteCard
              route={busRoute}
              destination={destination}
              onEditDestination={openItems}
            />
          </FadeIn>
        ) : modeMeta ? (
          <FadeIn delay={215} style={{ marginTop: space(3.5) }}>
            <Card title={`${modeMeta.emoji} הדרך שלי`}>
              <Txt variant="caption" color={colors.textSoft}>
                {`מגיעים ליעד ב${modeMeta.label}.`}
              </Txt>
            </Card>
          </FadeIn>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {/* Hands the destination the user already defined to whichever app fits
            how they are getting there — nothing to re-type, and no navigation
            data faked in-app. */}
        <Button
          label={navigationLabel(navigationApp)}
          variant="soft"
          size="md"
          onPress={navigate}
        />

        {/* The only button of the flow: it writes the trip and sends the user
            off. Hidden with an empty list — there is nothing to finish. */}
        {items.length === 0 ? null : (
          <Button
            label="✅ מוכן לצאת"
            variant="success"
            style={{ marginTop: space(2.5) }}
            onPress={async () => {
              // Saves the trip (items taken included) and closes the departure.
              completeExit(destination.id);

              if (settings.autoOpenWaze) {
                const outcome = await openNavigation(destination, mode);
                if (outcome.status === 'failed' || outcome.status === 'no-location') {
                  setNavProblem(outcome.status);
                  return;
                }
              }
              goHome();
            }}
          />
        )}
      </View>

      <LocationFixSheet
        destination={destination}
        visible={pickingLocation}
        onClose={() => setPickingLocation(false)}
        onEditAddress={openItems}
      />

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
        visible={navProblem !== null}
        title={
          navProblem === 'no-location'
            ? 'לא ניתן לפתוח ניווט כי ליעד אין מיקום'
            : `לא הצלחנו לפתוח את ${navigationAppName(navigationApp)}`
        }
        subtitle={
          navProblem === 'no-location'
            ? 'אפשר להוסיף כתובת ליעד במסך העריכה, או לקבוע מיקום דרך "📍 בחר מיקום".'
            : 'בדוק שהאפליקציה מותקנת או שיש חיבור לאינטרנט, ונסה שוב.'
        }
        onClose={() => setNavProblem(null)}
        options={[{ label: 'סגור', tone: 'cancel', onPress: () => setNavProblem(null) }]}
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
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: space(4),
    paddingVertical: space(3.5),
  },
  progressCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space(4.5),
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  progressDone: {
    backgroundColor: colors.successSoft,
    borderColor: 'rgba(15, 169, 104, 0.3)',
  },
  empty: {
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
