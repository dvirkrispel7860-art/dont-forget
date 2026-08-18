import React, { useState } from 'react';
import { useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { AiComposer } from '../../src/components/AiComposer';
import { AiSuggestionSheet } from '../../src/components/AiSuggestionSheet';
import { DestinationCard } from '../../src/components/DestinationCard';
import {
  Button,
  FadeIn,
  HeaderIconAction,
  Screen,
  ScreenHeader,
  Txt,
} from '../../src/components/ui';
import { Analysis, analyzeUserText } from '../../src/aiAnalysis';
import { byFavoriteFirst, useStore } from '../../src/store';
import { colors, radius, row, space } from '../../src/theme';

/** Shown until the user has created their first destination. */
function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <FadeIn delay={100}>
      <View style={styles.empty}>
        <View style={styles.emptyBadge}>
          <Txt style={styles.emptyIcon}>🧭</Txt>
        </View>

        <Txt variant="h2" center style={{ marginTop: space(5) }}>
          עדיין אין לך יעדים
        </Txt>
        <Txt
          variant="body"
          center
          color={colors.textSoft}
          style={{ marginTop: space(2), maxWidth: 280 }}
        >
          הגדר יעד אחד, הוסף לו את הדברים שאתה לוקח, ומעכשיו לא תשכח כלום.
        </Txt>

        <Button
          label="הוסף יעד ראשון"
          onPress={onAdd}
          style={{ marginTop: space(7), alignSelf: 'stretch' }}
        />
      </View>
    </FadeIn>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { destinations, hydrated, toggleFavorite, addSuggestedItems, createDestination } =
    useStore();
  const ordered = byFavoriteFirst(destinations);

  // AI area state. Analysis runs locally (src/aiAnalysis.ts) — no network, no
  // API key — and nothing reaches the user's data until they confirm.
  const [prompt, setPrompt] = useState('');
  const [listening, setListening] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);

  const onSubmitPrompt = async () => {
    const text = prompt.trim();
    if (!text || analyzing) return;
    setListening(false);
    setAnalyzing(true);
    try {
      // Awaited so that swapping analyzeUserText for a real model call later
      // needs no changes here.
      setAnalysis(await analyzeUserText(text, { destinations }));
    } finally {
      setAnalyzing(false);
    }
  };

  // "הוסף יעד" is its own tab now — jump to it instead of pushing a screen.
  const goToNew = () => router.push('/new');

  // Tapping a card opens that destination's list — the existing exit check.
  const openDestination = (id: string) =>
    router.push({ pathname: '/destination/[id]/check', params: { id } });

  const editDestination = (id: string) =>
    router.push({ pathname: '/destination/[id]/items', params: { id } });

  const isEmpty = hydrated && destinations.length === 0;

  return (
    <Screen insetBottom={false}>
      {/* A tab root has nowhere to go back to — the tab bar is the navigation.
          The ⚙️ sits in the `right` slot, which renders at the top left in RTL. */}
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
          <Txt variant="title">לאן יוצאים היום?</Txt>
          <Txt variant="body" color={colors.textSoft} style={{ marginTop: space(1.5) }}>
            בחר יעד ונבדוק מה כדאי לקחת.
          </Txt>
        </FadeIn>

        {!hydrated ? null : isEmpty ? (
          <EmptyState onAdd={goToNew} />
        ) : (
          <>
            <FadeIn delay={60} style={styles.sectionHeader}>
              <View style={row}>
                <Txt variant="label" color={colors.textSoft}>
                  היעדים שלי
                </Txt>
                <View style={styles.countChip}>
                  <Txt variant="caption" color={colors.accentDeep}>
                    {destinations.length}
                  </Txt>
                </View>
              </View>
            </FadeIn>

            <View style={{ gap: space(3) }}>
              {ordered.map((destination, index) => (
                <FadeIn key={destination.id} delay={120 + Math.min(index, 8) * 60}>
                  <DestinationCard
                    destination={destination}
                    onPress={() => openDestination(destination.id)}
                    onEdit={() => editDestination(destination.id)}
                    onToggleFavorite={() => toggleFavorite(destination.id)}
                  />
                </FadeIn>
              ))}
            </View>

            {/* Moved out of the fixed footer to make room for the AI area, which
                the spec wants sitting directly above the tab bar. */}
            <FadeIn delay={200} style={{ marginTop: space(4) }}>
              <Button label="+  הוסף יעד" onPress={goToNew} />
            </FadeIn>
          </>
        )}
      </ScrollView>

      {/* The AI area: fixed above the bottom tab bar, kept compact so the
          destinations above it stay visible. */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FadeIn delay={240} style={styles.aiFooter}>
          <AiComposer
            value={prompt}
            onChangeText={setPrompt}
            onSubmit={onSubmitPrompt}
            listening={listening}
            onToggleMic={() => setListening((prev) => !prev)}
            analyzing={analyzing}
          />
        </FadeIn>
      </KeyboardAvoidingView>

      <AiSuggestionSheet
        visible={analysis !== null}
        analysis={analysis}
        destinations={ordered}
        onClose={() => setAnalysis(null)}
        onAdd={(target, names) => {
          // A new destination is created only here, on the user's confirmation.
          const destinationId =
            target.kind === 'existing'
              ? target.id
              : createDestination(target.name, target.icon, '');
          addSuggestedItems(destinationId, names);
          setAnalysis(null);
          setPrompt('');
        }}
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
  sectionHeader: {
    marginTop: space(8),
    marginBottom: space(3.5),
  },
  countChip: {
    minWidth: 24,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space(1.5),
    marginHorizontal: space(2),
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
  aiFooter: {
    paddingHorizontal: space(4),
    paddingTop: space(2),
    paddingBottom: space(3),
    backgroundColor: colors.bg,
  },
});
