import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Destination } from '../types';
import { itemsCountLabel } from '../hebrew';
import { colors, radius, row, shadow, space } from '../theme';
import { Squish, Txt } from './ui';

export function DestinationCard({
  destination,
  onPress,
  onEdit,
  onToggleFavorite,
}: {
  destination: Destination;
  onPress: () => void;
  onEdit: () => void;
  onToggleFavorite: () => void;
}) {
  const count = destination.items.filter((i) => i.active).length;
  const favorite = destination.favorite === true;

  // The card body and the two icon buttons are siblings, never nested pressables.
  return (
    <View style={[row, styles.card, shadow.card, favorite && styles.cardFavorite]}>
      <Squish
        onPress={onPress}
        scaleTo={0.985}
        style={{ flex: 1 }}
        accessibilityLabel={destination.name}
      >
        <View style={row}>
          <View style={[styles.iconWrap, favorite && styles.iconWrapFavorite]}>
            <Txt style={styles.icon}>{destination.icon}</Txt>
          </View>

          <View style={{ flex: 1, marginHorizontal: space(3.5) }}>
            <Txt variant="h2" numberOfLines={1}>
              {destination.name}
            </Txt>
            <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 3 }}>
              {itemsCountLabel(count)}
              {destination.reminder?.enabled ? ` · 🔔 ${destination.reminder.time}` : ''}
            </Txt>
          </View>
        </View>
      </Squish>

      <Squish
        onPress={onToggleFavorite}
        scaleTo={0.82}
        accessibilityLabel={
          favorite ? `הסר את ${destination.name} מהמועדפים` : `סמן את ${destination.name} כמועדף`
        }
      >
        <View style={[styles.roundButton, favorite && styles.starOn]}>
          <Txt style={[styles.starIcon, favorite && { color: colors.star }]}>
            {favorite ? '★' : '☆'}
          </Txt>
        </View>
      </Squish>

      <Squish onPress={onEdit} scaleTo={0.85} accessibilityLabel="ערוך יעד">
        <View style={[styles.roundButton, { marginStart: space(2) }]}>
          <Txt style={styles.editIcon}>✎</Txt>
        </View>
      </Squish>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: space(4),
    paddingHorizontal: space(4),
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  cardFavorite: {
    borderColor: 'rgba(232, 162, 9, 0.35)',
  },
  iconWrap: {
    width: 60,
    height: 60,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapFavorite: {
    backgroundColor: colors.starSoft,
  },
  icon: {
    fontSize: 30,
    lineHeight: 38,
  },
  roundButton: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  starOn: {
    backgroundColor: colors.starSoft,
    borderColor: 'rgba(232, 162, 9, 0.4)',
  },
  starIcon: {
    fontSize: 18,
    lineHeight: 23,
    color: colors.textFaint,
  },
  editIcon: {
    fontSize: 17,
    lineHeight: 22,
    color: colors.textSoft,
  },
});
