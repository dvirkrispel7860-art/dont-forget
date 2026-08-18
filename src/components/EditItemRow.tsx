import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, row, shadow, space } from '../theme';
import { Item } from '../types';
import { FadeIn, Squish, Txt } from './ui';

/** One line in the "מה אתה צריך לקחת?" editor. */
export function EditItemRow({
  item,
  index,
  onDelete,
}: {
  item: Item;
  index: number;
  onDelete: () => void;
}) {
  return (
    <FadeIn delay={Math.min(index, 8) * 35} offset={10}>
      <View style={[row, styles.card, shadow.soft]}>
        <View style={styles.tickWrap}>
          <Txt style={styles.tick}>✓</Txt>
        </View>

        <View style={{ flex: 1, marginHorizontal: space(3) }}>
          <Txt variant="body" numberOfLines={2}>
            {item.name}
          </Txt>
        </View>

        <Squish onPress={onDelete} scaleTo={0.85} accessibilityLabel={`מחק ${item.name}`}>
          <View style={styles.delete}>
            <Txt style={styles.deleteIcon}>✕</Txt>
          </View>
        </Squish>
      </View>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: space(3),
    paddingHorizontal: space(3.5),
  },
  tickWrap: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tick: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
    color: colors.success,
  },
  delete: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSoft,
  },
  deleteIcon: {
    fontSize: 14,
    lineHeight: 19,
    color: colors.textFaint,
    fontWeight: '700',
  },
});
