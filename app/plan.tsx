import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ScrollView,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { BusRouteCard } from '../src/components/BusRouteCard';
import { LocationFixSheet } from '../src/components/LocationFixSheet';
import { Sheet } from '../src/components/Sheet';
import { SuggestionsCard } from '../src/components/SuggestionsCard';
import { WeatherCard } from '../src/components/WeatherCard';
import {
  Button,
  FadeIn,
  Screen,
  ScreenHeader,
  Txt,
} from '../src/components/ui';
import { analyzeUserText } from '../src/ai';
import { Analysis } from '../src/aiAnalysis';
import { buildDepartureContext, checkSuggestions } from '../src/departureContext';
import { formatTripClock, formatTripDate } from '../src/hebrew';
import { reminderDaysLabel } from '../src/notifications';
import { activeItems, useStore } from '../src/store';
import {
  navigationAppFor,
  navigationAppName,
  navigationLabel,
  openNavigation,
} from '../src/navigation';
import { colors, radius, row, shadow, space } from '../src/theme';
import { TRAVEL_MODES } from '../src/transit/types';
import { useBusRoute } from '../src/transit/useBusRoute';
import { useDestinationWeather } from '../src/weather/useWeather';

/**
 * 🧠 תוכנית היציאה שלך — one summary of everything the app already knows about a
 * departure the user just described in their own words.
 *
 * Nothing here is a new system. The destination, the list and the history come
 * from the store; the sentence is read by the same local matcher the AI area uses
 * (`analyzeUserText` — unchanged, still no model and no network); the time comes
 * from the local phrase parser; weather, transit and Waze are the existing
 * layers, asked about the planned hour instead of "now". "🚀 התחל יציאה" calls
 * the existing `startExit` and hands over to מצב יציאה.
 *
 * Recommendations are recommendations: nothing is added to a list without a tap.
 */

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

export default function DeparturePlanScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    id: string;
    /** Epoch millis of the departure time, when the sentence carried one. */
    at?: string;
    /** How that time was understood, e.g. "בעוד שעה". */
    phrase?: string;
    /** The sentence itself, re-read locally for its item suggestions. */
    text?: string;
  }>();

  const {
    getDestination,
    destinations,
    trips,
    hydrated,
    addSuggestedItems,
    startExit,
  } = useStore();

  const destination = getDestination(params.id);
  const [navProblem, setNavProblem] = useState<'failed' | 'no-location' | null>(null);
  const [pickingLocation, setPickingLocation] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);

  const at = params.at ? Number(params.at) : NaN;
  const plannedAt = Number.isFinite(at) ? at : null;
  const timePhrase = params.phrase?.trim() ? params.phrase.trim() : null;

  /*
   * The same local matcher the AI area runs, on the same sentence. It is cheap,
   * deterministic and offline, so re-reading the sentence here is simpler than
   * threading its output through the router.
   */
  useEffect(() => {
    const text = params.text?.trim();
    if (!text) {
      setAnalysis(null);
      return;
    }
    let alive = true;
    void analyzeUserText(text, {
      destinations,
      trips,
      // This screen knows which destination the sentence is about, so the
      // provider gets its items and history instead of having to find them.
      focusedDestinationId: params.id,
    }).then((result) => {
      if (alive) setAnalysis(result);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.text, destinations.length]);

  const items = activeItems(destination);

  /*
   * Weather for the hour the user named — or for the moment the plan opened.
   * Fixed once on purpose: a timestamp recomputed on every render would restart
   * the lookup on every render.
   */
  const [openedAt] = useState(() => Date.now());
  const weatherAt = plannedAt ?? openedAt;
  const weather = useDestinationWeather(destination, weatherAt);

  /*
   * A bus plan finds its own boarding stop, aimed at the hour the sentence named.
   * Same hook the departure screen uses, so both show the same stop.
   */
  const busRoute = useBusRoute(
    destination,
    destination?.travelMode === 'bus',
    weatherAt,
  );

  /*
   * Everything worth checking for this departure, from the same place the
   * departure screen gets it: the history, the forecast, and here also the
   * sentence the user just wrote.
   */
  const suggestions = useMemo(() => {
    if (!destination) return [];
    const forecast = weather.result?.status === 'ok' ? weather.result.forecast : null;
    const fromText = analysis?.understood
      ? analysis.suggestions.map((thing) => ({
          name: thing.name,
          emoji: thing.emoji,
          reason: 'לפי מה שכתבת',
        }))
      : [];

    return checkSuggestions(
      buildDepartureContext(
        destination,
        trips,
        forecast
          ? { reading: forecast.reading, locationLabel: forecast.location.label }
          : null,
      ),
      fromText,
    );
  }, [destination, trips, weather.result, analysis]);

  const goHome = () => {
    if (router.canGoBack()) router.back();
    else router.dismissTo('/home');
  };

  if (!hydrated || !destination) {
    return (
      <Screen>
        <ScreenHeader title="תוכנית יציאה" onBack={goHome} />
        <View style={styles.center}>
          <Txt variant="h2" center color={colors.textSoft}>
            {hydrated ? 'היעד לא נמצא' : ''}
          </Txt>
        </View>
      </Screen>
    );
  }

  const address = destination.address?.trim();
  const mode = destination.travelMode;
  const modeMeta = mode ? TRAVEL_MODES.find((m) => m.id === mode) : undefined;
  const reminder = destination.reminder;

  const openItems = () =>
    router.push({ pathname: '/destination/[id]/items', params: { id: destination.id } });

  const navigationApp = navigationAppFor(destination);

  const navigate = async () => {
    if (navigationApp === 'transit') {
      // The ride details are at the end of this screen. Not animated — see the
      // note on the departure screen.
      scrollRef.current?.scrollToEnd({ animated: false });
      return;
    }
    const outcome = await openNavigation(destination);
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
          <Txt variant="title">🧠 תוכנית היציאה שלך</Txt>
          <Txt variant="caption" color={colors.textFaint} style={{ marginTop: space(2) }}>
            הורכבה מהמידע שכבר יש באפליקציה — ניתוח מקומי, בלי שירות חיצוני.
          </Txt>
        </FadeIn>

        {/* ------------------------------------------------ destination & time */}
        <FadeIn delay={60} style={{ marginTop: space(4) }}>
          <Card>
            <View style={[row, { gap: space(2.5) }]}>
              <Txt style={styles.bigIcon}>{destination.icon}</Txt>
              <View style={{ flex: 1 }}>
                <Txt variant="caption" color={colors.textFaint}>
                  📍 יעד
                </Txt>
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
                    {address}
                  </Txt>
                ) : null}
              </View>
            </View>

            {/* No time in the sentence means no time in the plan — the parser
                never guesses one. */}
            {plannedAt != null ? (
              <View style={[row, styles.timeRow]}>
                <Txt variant="caption" color={colors.textSoft}>
                  ⏰ זמן: {timePhrase ?? formatTripClock(plannedAt)}
                </Txt>
                <Txt
                  variant="caption"
                  color={colors.textFaint}
                  style={{ marginHorizontal: space(2.5) }}
                >
                  {formatTripDate(plannedAt)} · {formatTripClock(plannedAt)}
                </Txt>
              </View>
            ) : (
              <Txt variant="caption" color={colors.textFaint} style={{ marginTop: space(3) }}>
                ⏰ לא זיהינו זמן במשפט — התוכנית מתייחסת לעכשיו.
              </Txt>
            )}
          </Card>
        </FadeIn>

        {/* ---------------------------------------------------------- the list */}
        <FadeIn delay={90} style={{ marginTop: space(3.5) }}>
          <Card title="🎒 לקחת">
            {items.length === 0 ? (
              <Txt variant="caption" color={colors.textFaint}>
                אין פריטים ביעד הזה עדיין.
              </Txt>
            ) : (
              <View style={{ gap: space(2) }}>
                {items.map((item) => (
                  <View key={item.id} style={row}>
                    <Txt variant="body">{item.checked ? '☑️' : '⬜'}</Txt>
                    <Txt
                      variant="body"
                      numberOfLines={1}
                      style={{ flex: 1, marginHorizontal: space(2.5) }}
                    >
                      {item.name}
                    </Txt>
                  </View>
                ))}
              </View>
            )}

          </Card>
        </FadeIn>

        {/* ------------------------------------------------------ 🧠 כדאי לבדוק */}
        {suggestions.length > 0 ? (
          <FadeIn delay={105} style={{ marginTop: space(3.5) }}>
            <SuggestionsCard
              suggestions={suggestions}
              onAdd={(name) => addSuggestedItems(destination.id, [name])}
            />
          </FadeIn>
        ) : null}

        {/* ------------------------------------------------------- the weather */}
        <FadeIn delay={120} style={{ marginTop: space(3.5) }}>
          <WeatherCard
            loading={weather.loading}
            result={weather.result}
            onRetry={weather.reload}
            onPickLocation={() => setPickingLocation(true)}
          />
        </FadeIn>

        {/* ------------------------------------------------------ navigation */}
        <FadeIn delay={175} style={{ marginTop: space(3.5) }}>
          <Card title="🗺️ ניווט">
            <Button
              label={navigationLabel(navigationApp)}
              variant="soft"
              size="md"
              onPress={navigate}
            />
          </Card>
        </FadeIn>

        {/* -------------------------------------------------------- reminder */}
        <FadeIn delay={200} style={{ marginTop: space(3.5) }}>
          <Card title="🔔 תזכורת">
            {reminder ? (
              <>
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
                <Button
                  label="ערוך תזכורת"
                  variant="soft"
                  size="md"
                  onPress={openItems}
                  style={{ marginTop: space(3) }}
                />
              </>
            ) : (
              <>
                <Txt variant="caption" color={colors.textSoft}>
                  ליעד הזה אין תזכורת.
                </Txt>
                <Button
                  label="הגדר תזכורת"
                  variant="soft"
                  size="md"
                  onPress={openItems}
                  style={{ marginTop: space(3) }}
                />
              </>
            )}
          </Card>
        </FadeIn>
        {/* --------------------------------------------------------- the route */}
        {/* Last, so "🚌 פרטי נסיעה" can scroll straight to it. */}
        {mode === 'bus' ? (
          <FadeIn delay={225} style={{ marginTop: space(3.5) }}>
            <BusRouteCard
              route={busRoute}
              destination={destination}
              onEditDestination={openItems}
            />
          </FadeIn>
        ) : modeMeta ? (
          <FadeIn delay={225} style={{ marginTop: space(3.5) }}>
            <Card title={`${modeMeta.emoji} הדרך`}>
              <Txt variant="caption" color={colors.textSoft}>
                {`מגיעים ליעד ב${modeMeta.label}.`}
              </Txt>
            </Card>
          </FadeIn>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {/* The existing flow, started from here: startExit, then the departure
            screen itself — the one place an exit is carried out. */}
        <Button
          label="🚀 התחל יציאה"
          onPress={() => {
            startExit(destination.id);
            router.replace({
              pathname: '/destination/[id]/check',
              params: { id: destination.id },
            });
          }}
        />
        <View style={[row, { gap: space(2.5), marginTop: space(2.5) }]}>
          <View style={{ flex: 1 }}>
            <Button label="✏️ ערוך" variant="soft" size="md" onPress={openItems} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="❌ ביטול" variant="ghost" size="md" onPress={goHome} />
          </View>
        </View>
      </View>

      <LocationFixSheet
        destination={destination}
        visible={pickingLocation}
        onClose={() => setPickingLocation(false)}
        onEditAddress={openItems}
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
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: space(4),
    paddingVertical: space(3.5),
  },
  bigIcon: {
    fontSize: 30,
    lineHeight: 40,
  },
  timeRow: {
    marginTop: space(3),
    paddingTop: space(3),
    borderTopWidth: 1,
    borderTopColor: colors.border,
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
