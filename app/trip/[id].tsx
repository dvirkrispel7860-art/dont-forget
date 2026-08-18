import React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { FadeIn, Screen, ScreenHeader, Txt } from '../../src/components/ui';
import { formatTripClock, formatTripDate, tripCountLabel } from '../../src/hebrew';
import { useStore } from '../../src/store';
import { colors, radius, row, shadow, space } from '../../src/theme';
import { TripItem, tripTakenCount, tripTotalCount } from '../../src/types';

function ItemRow({ item, last }: { item: TripItem; last: boolean }) {
  return (
    <View style={[row, styles.itemRow, !last && styles.divider]}>
      <View style={[styles.mark, item.taken ? styles.markTaken : styles.markMissed]}>
        <Txt style={[styles.markGlyph, { color: item.taken ? '#FFFFFF' : colors.textFaint }]}>
          {item.taken ? '✓' : '–'}
        </Txt>
      </View>

      <View style={{ flex: 1, marginHorizontal: space(3) }}>
        <Txt variant="body" color={item.taken ? colors.text : colors.textSoft}>
          {item.name}
        </Txt>
        {item.skipped ? (
          <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 2 }}>
            לא היה צריך הפעם
          </Txt>
        ) : null}
      </View>
    </View>
  );
}

function Group({ title, items }: { title: string; items: TripItem[] }) {
  if (items.length === 0) return null;
  return (
    <View style={{ marginTop: space(6) }}>
      <Txt variant="label" color={colors.textSoft} style={{ marginBottom: space(2.5) }}>
        {title}
      </Txt>
      <View style={[styles.card, shadow.soft]}>
        {items.map((item, index) => (
          <ItemRow key={`${item.itemId}-${index}`} item={item} last={index === items.length - 1} />
        ))}
      </View>
    </View>
  );
}

export default function TripDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const { getTrip, hydrated } = useStore();
  const trip = getTrip(params.id);

  const goBack = () =>
    router.canGoBack() ? router.back() : router.dismissTo('/history');

  if (!trip) {
    return (
      <Screen>
        <ScreenHeader title="יציאה" onBack={goBack} />
        <View style={styles.center}>
          <Txt variant="h2" center color={colors.textSoft}>
            {hydrated ? 'היציאה לא נמצאה' : ''}
          </Txt>
        </View>
      </Screen>
    );
  }

  const taken = tripTakenCount(trip);
  const total = tripTotalCount(trip);
  const complete = total !== null && total > 0 && taken === total;

  const items = trip.items ?? [];
  const takenItems = items.filter((i) => i.taken);
  const missedItems = items.filter((i) => !i.taken);

  return (
    <Screen>
      <ScreenHeader title={trip.destinationName} onBack={goBack} />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <FadeIn>
          <View style={[row, { gap: space(2.5) }]}>
            <Txt style={styles.bigIcon}>{trip.icon}</Txt>
            <Txt variant="title" numberOfLines={1} style={{ flex: 1 }}>
              {trip.destinationName}
            </Txt>
          </View>

          <Txt variant="body" color={colors.textSoft} style={{ marginTop: space(2) }}>
            {formatTripDate(trip.at)} · {formatTripClock(trip.at)}
          </Txt>

          {trip.address?.trim() ? (
            <Txt
              variant="caption"
              color={colors.textFaint}
              numberOfLines={1}
              style={{ marginTop: space(2) }}
            >
              📍 {trip.address.trim()}
            </Txt>
          ) : null}
        </FadeIn>

        <FadeIn delay={70} style={{ marginTop: space(6) }}>
          <View style={[styles.summary, shadow.soft, complete && styles.summaryDone]}>
            <Txt variant="h2" color={complete ? colors.success : colors.text}>
              {complete ? '🎉 ' : ''}
              {tripCountLabel(taken, total)}
            </Txt>
            {total !== null && missedItems.length > 0 ? (
              <Txt variant="caption" color={colors.textSoft} style={{ marginTop: space(2) }}>
                {missedItems.length === 1
                  ? 'פריט אחד לא נלקח'
                  : `${missedItems.length} פריטים לא נלקחו`}
              </Txt>
            ) : null}
          </View>
        </FadeIn>

        {total === null ? (
          <FadeIn delay={120} style={{ marginTop: space(6) }}>
            <View style={styles.noDetail}>
              <Txt variant="body" center color={colors.textFaint}>
                ליציאה הזו נשמרו רק המספרים,{'\n'}בלי פירוט הפריטים.
              </Txt>
            </View>
          </FadeIn>
        ) : (
          <FadeIn delay={120}>
            <Group title="נלקחו" items={takenItems} />
            <Group title="לא נלקחו" items={missedItems} />
          </FadeIn>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space(5),
    paddingTop: space(2),
    paddingBottom: space(10),
  },
  bigIcon: {
    fontSize: 30,
    lineHeight: 40,
  },
  summary: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space(4.5),
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  summaryDone: {
    backgroundColor: colors.successSoft,
    borderColor: 'rgba(15, 169, 104, 0.3)',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  itemRow: {
    paddingHorizontal: space(4),
    paddingVertical: space(3.5),
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  mark: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markTaken: {
    backgroundColor: colors.success,
  },
  markMissed: {
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  markGlyph: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
  },
  noDetail: {
    paddingVertical: space(8),
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
