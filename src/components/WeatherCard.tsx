import React from 'react';
import { StyleSheet, View } from 'react-native';
import { formatTripClock, formatTripDate } from '../hebrew';
import { colors, radius, row, shadow, space } from '../theme';
import { weather } from '../weather';
import { describeWeatherCode } from '../weather/codes';
import { WeatherForecast, WeatherResult } from '../weather/types';
import { Button, Squish, Txt } from './ui';

/**
 * 🌦️ מזג האוויר — the forecast for the hour the user will actually be outside.
 *
 * Presentational only: the screen owns the request (useDepartureWeather) and
 * hands the result down. Every number shown came from the source; a value the
 * source did not send simply has no line. When there is no forecast at all the
 * card says so in words — there is no placeholder weather in this app.
 *
 * What to take *because* of this weather is not here: it belongs to the one
 * 🧠 כדאי לבדוק card, next to the suggestions that come from the history.
 */

const degrees = (value: number) => `${Math.round(value)}°`;

function millimetres(value: number): string {
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} מ"מ`;
}

/** "לשעה 08:00", with the day added when the reading is not for today. */
function readingTimeLabel(forecast: WeatherForecast): string {
  const at = forecast.reading.at;
  const sameDay = new Date(at).toDateString() === new Date().toDateString();
  const clock = `לשעה ${formatTripClock(at)}`;
  return sameDay ? clock : `${formatTripDate(at)} · ${clock}`;
}

function Detail({ label }: { label: string }) {
  return (
    <View style={styles.detail}>
      <Txt variant="caption" color={colors.textSoft}>
        {label}
      </Txt>
    </View>
  );
}

/** The one-line version used on the destination screen. */
function CompactBody({
  loading,
  result,
  onPickLocation,
}: {
  loading: boolean;
  result: WeatherResult | null;
  onPickLocation?: () => void;
}) {
  if (loading || !result) {
    return (
      <Txt variant="caption" color={colors.textFaint}>
        בודקים את מזג האוויר...
      </Txt>
    );
  }

  /*
   * A missing location is the one failure the user can actually fix, so even the
   * quiet line offers the way to fix it.
   */
  if (result.status === 'no-location') {
    return (
      <>
        <Txt variant="caption" color={colors.textSoft} numberOfLines={2}>
          ⚠️ לא הצלחנו למצוא את מיקום היעד
        </Txt>
        {onPickLocation ? (
          <Squish
            onPress={onPickLocation}
            scaleTo={0.96}
            accessibilityLabel="בחר מיקום ליעד"
            style={{ alignSelf: 'flex-start', marginTop: space(1.5) }}
          >
            <Txt variant="caption" color={colors.accentDeep}>
              📍 בחר מיקום
            </Txt>
          </Squish>
        ) : null}
      </>
    );
  }

  if (result.status !== 'ok') {
    return (
      <Txt variant="caption" color={colors.textFaint} numberOfLines={2}>
        {result.status === 'offline'
          ? 'לא ניתן לקבל כרגע את נתוני מזג האוויר'
          : result.reason}
      </Txt>
    );
  }

  const { reading, location } = result.forecast;
  const condition = describeWeatherCode(reading.code);

  return (
    <View style={row}>
      <Txt style={styles.compactEmoji}>{condition.emoji}</Txt>
      <Txt variant="body" style={{ marginHorizontal: space(2.5) }}>
        {degrees(reading.temperature)} · {condition.label}
      </Txt>
      <Txt
        variant="caption"
        color={colors.textFaint}
        numberOfLines={1}
        style={{ flex: 1 }}
      >
        {location.label}
      </Txt>
    </View>
  );
}

export function WeatherCard({
  loading,
  result,
  onRetry,
  onPickLocation,
  compact = false,
}: {
  loading: boolean;
  result: WeatherResult | null;
  onRetry?: () => void;
  /** Opens the "בחר מיקום" flow, when the screen offers one. */
  onPickLocation?: () => void;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <View style={[styles.card, styles.compactCard, shadow.soft]}>
        <CompactBody
          loading={loading}
          result={result}
          onPickLocation={onPickLocation}
        />
      </View>
    );
  }

  return (
    <View style={[styles.card, shadow.soft]}>
      <Txt variant="body" style={{ marginBottom: space(3) }}>
        🌦️ מזג האוויר
      </Txt>

      {loading || !result ? (
        <Txt variant="caption" color={colors.textSoft}>
          בודקים את מזג האוויר...
        </Txt>
      ) : result.status === 'no-location' ? (
        /* Nothing to retry — a lookup cannot succeed without a location. What
           helps is setting one, so that is what is offered. */
        <>
          <Txt variant="body" color={colors.text}>
            ⚠️ לא הצלחנו למצוא את מיקום היעד
          </Txt>
          <Txt variant="caption" color={colors.textSoft} style={{ marginTop: space(2) }}>
            {result.reason}
          </Txt>
          {onPickLocation ? (
            <Button
              label="📍 בחר מיקום"
              variant="soft"
              size="md"
              onPress={onPickLocation}
              style={{ marginTop: space(3) }}
            />
          ) : null}
        </>
      ) : result.status === 'offline' || result.status === 'error' ? (
        <>
          <Txt variant="caption" color={colors.textSoft}>
            לא ניתן לקבל כרגע את נתוני מזג האוויר.
          </Txt>
          <Txt variant="caption" color={colors.textFaint} style={{ marginTop: space(1.5) }}>
            {result.status === 'offline' ? 'אין חיבור לאינטרנט.' : result.reason}
          </Txt>
          {onRetry ? (
            <Button
              label="נסה שוב"
              variant="soft"
              size="md"
              onPress={onRetry}
              style={{ marginTop: space(3) }}
            />
          ) : null}
        </>
      ) : (
        <WeatherBody forecast={result.forecast} />
      )}
    </View>
  );
}

function WeatherBody({ forecast }: { forecast: WeatherForecast }) {
  const { reading, location } = forecast;
  const condition = describeWeatherCode(reading.code);

  return (
    <>
      <View style={[row, { gap: space(3) }]}>
        <Txt style={styles.emoji}>{condition.emoji}</Txt>
        <View style={{ flex: 1 }}>
          <View style={row}>
            <Txt variant="h2">{degrees(reading.temperature)}</Txt>
            <Txt variant="body" color={colors.textSoft} style={{ marginHorizontal: space(2.5) }}>
              {condition.label}
            </Txt>
          </View>
          {reading.apparentTemperature != null ? (
            <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 2 }}>
              מרגיש כמו {degrees(reading.apparentTemperature)}
            </Txt>
          ) : null}
        </View>
      </View>

      <View style={[row, styles.details]}>
        {reading.precipitationProbability != null ? (
          <Detail label={`💧 סיכוי לגשם ${Math.round(reading.precipitationProbability)}%`} />
        ) : null}
        {reading.precipitation != null && reading.precipitation > 0 ? (
          <Detail label={`🌧️ ${millimetres(reading.precipitation)}`} />
        ) : null}
        <Detail
          label={
            reading.windGusts != null
              ? `💨 רוח ${Math.round(reading.windSpeed)} קמ"ש · משבים ${Math.round(reading.windGusts)}`
              : `💨 רוח ${Math.round(reading.windSpeed)} קמ"ש`
          }
        />
      </View>

      <Txt variant="caption" color={colors.textFaint} style={{ marginTop: space(3) }}>
        {location.label} · {readingTimeLabel(forecast)} · נתוני מזג אוויר:{' '}
        {weather.sourceLabel}
      </Txt>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: space(4),
    paddingVertical: space(3.5),
  },
  compactCard: {
    paddingVertical: space(3),
  },
  emoji: {
    fontSize: 34,
    lineHeight: 44,
  },
  compactEmoji: {
    fontSize: 20,
    lineHeight: 28,
  },
  details: {
    marginTop: space(3),
    flexWrap: 'wrap',
    gap: space(2),
  },
  detail: {
    paddingHorizontal: space(2.5),
    paddingVertical: space(1.5),
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
