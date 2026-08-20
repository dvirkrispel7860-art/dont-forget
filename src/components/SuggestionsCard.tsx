import React from 'react';
import { StyleSheet, View } from 'react-native';
import { CheckSuggestion } from '../departureContext';
import { colors, radius, row, shadow, space } from '../theme';
import { Squish, Txt } from './ui';

/**
 * 🧠 כדאי לבדוק — the things worth a second thought before leaving.
 *
 * Every row carries its own reason, and every reason is a real number from a real
 * source: how many recorded exits took that item, or what the forecast says about
 * the hour. There is no per-item emoji invented from a name — history rows share
 * a neutral one, and weather rows use the emoji of the condition itself.
 *
 * Purely a recommendation: nothing reaches a list until the user taps "➕ הוסף".
 * An empty list draws nothing at all.
 */
export function SuggestionsCard({
  suggestions,
  onAdd,
}: {
  suggestions: CheckSuggestion[];
  /** Adds this one thing to the destination's list. */
  onAdd: (name: string) => void;
}) {
  if (suggestions.length === 0) return null;

  return (
    <View style={[styles.card, shadow.soft]}>
      <View style={[row, styles.header]}>
        <Txt style={styles.brain}>🧠</Txt>
        <Txt
          variant="label"
          color={colors.accentDeep}
          style={{ marginHorizontal: space(2) }}
        >
          כדאי לבדוק
        </Txt>
      </View>

      <View style={styles.list}>
        {suggestions.map((suggestion) => (
          <View key={suggestion.id} style={[row, styles.itemRow]}>
            <Txt style={styles.itemEmoji}>{suggestion.emoji}</Txt>

            <View style={{ flex: 1, marginHorizontal: space(2.5) }}>
              <Txt variant="body" numberOfLines={1}>
                {suggestion.name}
              </Txt>
              <Txt
                variant="caption"
                color={colors.textFaint}
                numberOfLines={2}
                style={{ marginTop: 2 }}
              >
                {suggestion.reason}
              </Txt>
            </View>

            <Squish
              onPress={() => onAdd(suggestion.name)}
              scaleTo={0.92}
              accessibilityLabel={`הוסף ${suggestion.name} לרשימה`}
            >
              <View style={styles.addButton}>
                <Txt variant="caption" center color={colors.accentDeep}>
                  ➕ הוסף
                </Txt>
              </View>
            </Squish>
          </View>
        ))}
      </View>

      <Txt variant="caption" color={colors.textFaint} style={{ marginTop: space(3) }}>
        הצעות בלבד — כלום לא נוסף לרשימה בלי שתבחר.
      </Txt>
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
    gap: space(3),
  },
  itemRow: {
    minHeight: 40,
  },
  itemEmoji: {
    fontSize: 20,
    lineHeight: 28,
  },
  addButton: {
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    minWidth: 66,
  },
});
