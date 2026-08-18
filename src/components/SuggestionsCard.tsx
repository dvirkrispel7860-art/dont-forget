import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, row, shadow, space } from '../theme';
import { Suggestion } from '../suggestions';
import { Button, Txt } from './ui';

/**
 * "לפי היציאות הקודמות שלך" — items the user usually takes to this destination
 * that are not on its list right now. Purely a recommendation: nothing changes
 * until the user taps "הוסף הכול".
 *
 * There is no per-item emoji because the app never stores one; guessing icons
 * from names would be invented data. The frequency shown next to each item is
 * real — it comes straight from the saved trips.
 */
export function SuggestionsCard({
  suggestions,
  onAddAll,
}: {
  suggestions: Suggestion[];
  onAddAll: () => void;
}) {
  if (suggestions.length === 0) return null;

  return (
    <View style={[styles.card, shadow.soft]}>
      <View style={[row, styles.header]}>
        <Txt style={styles.brain}>🧠</Txt>
        <Txt variant="label" color={colors.accentDeep} style={{ marginHorizontal: space(2) }}>
          לפי היציאות הקודמות שלך
        </Txt>
      </View>

      <View style={styles.list}>
        {suggestions.map((suggestion) => (
          <View key={suggestion.name} style={[row, styles.itemRow]}>
            <View style={styles.dot} />
            <Txt
              variant="body"
              numberOfLines={1}
              style={{ flex: 1, marginHorizontal: space(2.5) }}
            >
              {suggestion.name}
            </Txt>
            <Txt variant="caption" color={colors.textFaint}>
              {suggestion.takenIn}/{suggestion.outOf} יציאות
            </Txt>
          </View>
        ))}
      </View>

      <Button
        label="הוסף הכול"
        variant="soft"
        size="md"
        onPress={onAddAll}
        style={{ marginTop: space(4) }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.accentSoft,
    paddingHorizontal: space(4),
    paddingVertical: space(4),
  },
  header: {
    marginBottom: space(3),
  },
  brain: {
    fontSize: 18,
    lineHeight: 24,
  },
  list: {
    gap: space(2.5),
  },
  itemRow: {
    minHeight: 26,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
});
