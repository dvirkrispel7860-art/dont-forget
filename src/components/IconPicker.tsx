import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, space } from '../theme';
import { Squish, Txt } from './ui';

export const ICONS = [
  '⚽',
  '🏫',
  '🏠',
  '🏖️',
  '🏋️',
  '💼',
  '🛒',
  '🎒',
  '🏀',
  '🎾',
  '🏥',
  '🕍',
  '🎵',
  '🐶',
  '✈️',
  '🚗',
  '📚',
  '🍽️',
  '🎁',
  '📍',
];

export function IconPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (icon: string) => void;
}) {
  return (
    <View style={styles.grid}>
      {ICONS.map((icon) => {
        const selected = icon === value;
        return (
          <Squish key={icon} onPress={() => onChange(icon)} scaleTo={0.88}>
            <View style={[styles.cell, selected && styles.cellSelected]}>
              <Txt variant="h2" center style={styles.emoji}>
                {icon}
              </Txt>
            </View>
          </Squish>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: space(2.5),
  },
  cell: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  emoji: {
    fontSize: 26,
    lineHeight: 34,
  },
});
