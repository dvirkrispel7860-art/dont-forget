import React from 'react';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  FadeIn,
  HeaderIconAction,
  Screen,
  ScreenHeader,
  Squish,
  Txt,
} from '../../src/components/ui';
import { formatTripDateTime, tripCountLabel } from '../../src/hebrew';
import { useStore } from '../../src/store';
import { colors, radius, row, shadow, space } from '../../src/theme';
import { Trip, tripTakenCount, tripTotalCount } from '../../src/types';

function TripCard({ trip, onPress }: { trip: Trip; onPress: () => void }) {
  const taken = tripTakenCount(trip);
  const total = tripTotalCount(trip);
  const complete = total !== null && total > 0 && taken === total;

  return (
    <Squish
      onPress={onPress}
      scaleTo={0.985}
      accessibilityLabel={`יציאה ל"${trip.destinationName}", ${formatTripDateTime(trip.at)}`}
    >
      <View style={[row, styles.card, shadow.soft]}>
        <View style={styles.iconWrap}>
          <Txt style={styles.icon}>{trip.icon}</Txt>
        </View>

        <View style={{ flex: 1, marginHorizontal: space(3.5) }}>
          <Txt variant="h2" numberOfLines={1}>
            {trip.destinationName}
          </Txt>
          <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 3 }}>
            {formatTripDateTime(trip.at)}
          </Txt>
          <Txt
            variant="caption"
            color={complete ? colors.success : colors.textSoft}
            style={{ marginTop: 4 }}
          >
            {tripCountLabel(taken, total)}
          </Txt>
        </View>

        <View style={styles.chevron} />
      </View>
    </Squish>
  );
}

function EmptyState() {
  return (
    <FadeIn delay={100}>
      <View style={styles.empty}>
        <View style={styles.emptyBadge}>
          <Txt style={styles.emptyIcon}>🕘</Txt>
        </View>
        <Txt variant="h2" center style={{ marginTop: space(5) }}>
          עדיין אין היסטוריה
        </Txt>
        <Txt
          variant="body"
          center
          color={colors.textSoft}
          style={{ marginTop: space(2), maxWidth: 290 }}
        >
          כל פעם שתסיים בדיקת יציאה ותלחץ "אני יוצא", היציאה תופיע כאן.
        </Txt>
      </View>
    </FadeIn>
  );
}

export default function HistoryScreen() {
  const router = useRouter();
  const { trips, hydrated } = useStore();

  return (
    <Screen insetBottom={false}>
      <ScreenHeader
        right={
          <HeaderIconAction
            icon="⚙️"
            label="הגדרות"
            onPress={() => router.push('/settings')}
          />
        }
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <FadeIn>
          <Txt variant="title">היסטוריה</Txt>
          <Txt variant="body" color={colors.textSoft} style={{ marginTop: space(1.5) }}>
            היציאות האחרונות שלך.
          </Txt>
        </FadeIn>

        {!hydrated ? null : trips.length === 0 ? (
          <EmptyState />
        ) : (
          <View style={{ marginTop: space(8), gap: space(3) }}>
            {trips.map((trip, index) => (
              <FadeIn key={trip.id} delay={Math.min(index, 8) * 55}>
                <TripCard
                  trip={trip}
                  onPress={() =>
                    router.push({ pathname: '/trip/[id]', params: { id: trip.id } })
                  }
                />
              </FadeIn>
            ))}
          </View>
        )}
      </ScrollView>
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
    paddingVertical: space(3.5),
    paddingHorizontal: space(4),
  },
  /** Points left — the "forward" direction in an RTL interface. */
  chevron: {
    width: 10,
    height: 10,
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderColor: colors.textFaint,
    transform: [{ rotate: '-45deg' }],
    marginStart: space(1),
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 24,
    lineHeight: 30,
  },
  empty: {
    alignItems: 'center',
    marginTop: space(12),
    paddingHorizontal: space(2),
  },
  emptyBadge: {
    width: 96,
    height: 96,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: {
    fontSize: 42,
    lineHeight: 52,
  },
});
