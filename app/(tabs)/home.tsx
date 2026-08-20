import React, { useCallback, useState } from 'react';
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
import { analyzeUserText } from '../../src/ai';
import { Analysis } from '../../src/aiAnalysis';
import { byFavoriteFirst, useStore } from '../../src/store';
import { colors, radius, row, space } from '../../src/theme';
import { parseTimePhrase, type ParsedTime } from '../../src/timePhrase';
import { useSpeechInput } from '../../src/useSpeech';

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
  const { destinations, trips, hydrated, toggleFavorite, addSuggestedItems, createDestination } =
    useStore();
  const ordered = byFavoriteFirst(destinations);

  // AI area state. Analysis runs locally (src/aiAnalysis.ts) — no network, no
  // API key — and nothing reaches the user's data until they confirm.
  const [prompt, setPrompt] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  /**
   * Something went wrong in the AI area. Takes the composer's existing caption
   * slot — the analysis itself never throws, so this is for the unexpected.
   */
  const [aiError, setAiError] = useState<string | null>(null);
  /** The time read out of the last sentence, carried into the plan. */
  const [pendingTime, setPendingTime] = useState<ParsedTime | null>(null);

  /** 🧠 תוכנית היציאה שלך for one destination, at the time that was understood. */
  const openPlan = (destinationId: string, time: ParsedTime | null, text: string) =>
    router.push({
      pathname: '/plan',
      params: {
        id: destinationId,
        // Left out entirely when the sentence carried no time — the plan then
        // says so instead of showing an invented hour.
        ...(time ? { at: String(time.at), phrase: time.phrase } : {}),
        text,
      },
    });

  /** The one path into the matcher, whether the text was typed or spoken. */
  const analyze = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || analyzing) return;
      setAnalyzing(true);
      setAiError(null);
      try {
        /*
         * Through the provider layer (src/ai): the remote provider when one is
         * configured, the on-device one otherwise, and the on-device one again if
         * a remote attempt fails. `trips` goes in so the answer can draw on the
         * user's own history — the provider layer decides what of it is sent.
         */
        const result = await analyzeUserText(trimmed, { destinations, trips });

        // The departure time, read locally out of the same sentence.
        const time = parseTimePhrase(trimmed);
        setPendingTime(time);

        /*
         * A sentence that lands on a destination the user already has needs no
         * confirmation dialog — everything for it is already in the app, so the
         * plan opens directly. A sentence with no matching destination (or one
         * that was not understood) goes to the existing sheet, which is where a
         * new destination gets created, and only on the user's tap.
         */
        if (result.understood && result.destination.kind === 'existing') {
          setAnalysis(null);
          setPrompt('');
          openPlan(result.destination.id, time, trimmed);
          return;
        }

        setAnalysis(result);
      } catch {
        // The provider layer falls back rather than throwing, so reaching here
        // means something unexpected. Say so plainly instead of failing silently.
        setAiError('משהו נתקע בניתוח. אפשר לנסות שוב.');
      } finally {
        setAnalyzing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [analyzing, destinations, trips],
  );

  /*
   * 🎙️ Dictation feeds the same box typing feeds — interim words appear as they
   * are recognised, and a finished sentence goes straight into the existing
   * analysis. Nothing about analyzeUserText changes; it just gets its text from
   * the microphone this time.
   */
  const speech = useSpeechInput({
    onPartial: setPrompt,
    onFinal: (text) => {
      setPrompt(text);
      void analyze(text);
    },
  });

  const onSubmitPrompt = () => {
    speech.stop();
    void analyze(prompt);
  };

  /*
   * Adding a destination is the tab bar's job — the home screen has no button of
   * its own for it any more. The empty state still offers it, because a first
   * destination needs pointing at.
   */
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
            listening={speech.listening}
            onToggleMic={speech.toggle}
            analyzing={analyzing}
            notice={aiError ?? speech.notice}
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
          const text = analysis?.text ?? prompt;
          setAnalysis(null);
          setPrompt('');
          // Straight on to the plan for whatever the user just confirmed.
          openPlan(destinationId, pendingTime, text);
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
    marginTop: space(7),
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
