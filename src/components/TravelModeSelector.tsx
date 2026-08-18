import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, row, space } from '../theme';
import { TRAVEL_MODES, TravelMode } from '../transit/types';
import { Squish, Txt } from './ui';

/** "איך מגיעים?" — four modes, one selected. */
export function TravelModeSelector({
  value,
  onChange,
}: {
  value: TravelMode | undefined;
  onChange: (mode: TravelMode) => void;
}) {
  return (
    <View style={styles.grid}>
      {TRAVEL_MODES.map((mode) => {
        const on = mode.id === value;
        return (
          <Squish
            key={mode.id}
            onPress={() => onChange(mode.id)}
            scaleTo={0.94}
            style={{ flex: 1 }}
            accessibilityLabel={`אמצעי תחבורה ${mode.label}`}
          >
            <View style={[styles.cell, on && styles.cellOn]}>
              <Txt style={styles.emoji}>{mode.emoji}</Txt>
              <Txt
                variant="caption"
                center
                color={on ? colors.accentDeep : colors.textSoft}
                style={{ marginTop: 2 }}
              >
                {mode.label}
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
    ...row,
    gap: space(2),
  },
  cell: {
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingVertical: space(2.5),
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 62,
  },
  cellOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  emoji: {
    fontSize: 20,
    lineHeight: 26,
  },
});
