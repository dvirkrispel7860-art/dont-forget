import React, { useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { EditItemRow } from '../../../src/components/EditItemRow';
import { ReminderEditor } from '../../../src/components/ReminderEditor';
import { TransitSetup } from '../../../src/components/TransitSetup';
import { TravelModeSelector } from '../../../src/components/TravelModeSelector';
import { Sheet } from '../../../src/components/Sheet';
import {
  Button,
  FadeIn,
  Screen,
  ScreenHeader,
  Squish,
  Txt,
} from '../../../src/components/ui';
import { activeItems, useStore } from '../../../src/store';
import { colors, radius, row, rtlText, shadow, space } from '../../../src/theme';

export default function ItemsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; fresh?: string }>();
  const isFresh = params.fresh === '1';

  const {
    getDestination,
    addItem,
    removeItem,
    deleteDestination,
    updateDestination,
    hydrated,
  } = useStore();
  const destination = getDestination(params.id);

  const [draft, setDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<TextInput>(null);

  if (!destination) {
    return (
      <Screen>
        <ScreenHeader onBack={() => router.dismissTo('/home')} />
        <View style={styles.missing}>
          <Txt variant="h2" center color={colors.textSoft}>
            {hydrated ? 'היעד לא נמצא' : ''}
          </Txt>
        </View>
      </Screen>
    );
  }

  const items = activeItems(destination);

  const onAdd = () => {
    const value = draft.trim();
    if (!value) return;
    addItem(destination.id, value);
    setDraft('');
    inputRef.current?.focus();
  };

  const onDone = () => {
    // Everything is already persisted as it is typed; this just closes the screen.
    if (isFresh) router.dismissTo('/home');
    else router.back();
  };

  return (
    <Screen>
      <ScreenHeader
        title={isFresh ? 'יעד חדש' : 'עריכת יעד'}
        onBack={() => (isFresh ? router.dismissTo('/home') : router.back())}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <FadeIn>
            <View style={[row, { gap: space(2.5) }]}>
              <Txt style={styles.icon}>{destination.icon}</Txt>
              <Txt variant="label" color={colors.textSoft} numberOfLines={1}>
                {destination.name}
              </Txt>
            </View>
          </FadeIn>

          {/* Editable here too, so destinations created before addresses existed
              can get one without being rebuilt. */}
          {!isFresh ? (
            <FadeIn delay={60} style={{ marginTop: space(5) }}>
              <Txt variant="label" color={colors.textSoft}>
                כתובת לניווט
              </Txt>
              <TextInput
                value={destination.address ?? ''}
                onChangeText={(text) =>
                  updateDestination(destination.id, { address: text })
                }
                placeholder="לדוגמה: שדרות הרצל 12, תל אביב"
                placeholderTextColor={colors.textFaint}
                style={styles.addressInput}
                maxLength={120}
                returnKeyType="done"
              />
            </FadeIn>
          ) : null}

          {!isFresh ? (
            <FadeIn delay={70} style={{ marginTop: space(5) }}>
              <Txt variant="label" color={colors.textSoft} style={{ marginBottom: space(3) }}>
                איך מגיעים ליעד?
              </Txt>
              <TravelModeSelector
                value={destination.travelMode}
                onChange={(travelMode) => updateDestination(destination.id, { travelMode })}
              />
            </FadeIn>
          ) : null}

          {!isFresh && destination.travelMode === 'bus' ? (
            <FadeIn delay={80} style={{ marginTop: space(4) }}>
              <TransitSetup
                plan={destination.transit}
                onChange={(transitPlan) =>
                  updateDestination(destination.id, { transit: transitPlan })
                }
              />
            </FadeIn>
          ) : null}

          {!isFresh ? (
            <FadeIn delay={90} style={{ marginTop: space(5) }}>
              <ReminderEditor
                reminder={destination.reminder}
                onChange={(reminder) => updateDestination(destination.id, { reminder })}
              />
            </FadeIn>
          ) : null}

          <FadeIn delay={90}>
            <Txt variant="title" style={{ marginTop: space(6) }}>
              מה אתה צריך לקחת?
            </Txt>
          </FadeIn>

          <FadeIn delay={120} style={[row, styles.addRow]}>
            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={setDraft}
              placeholder="כתוב פריט..."
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              maxLength={60}
              returnKeyType="done"
              submitBehavior="submit"
              onSubmitEditing={onAdd}
              autoFocus={isFresh}
            />
            <Squish onPress={onAdd} scaleTo={0.94} accessibilityLabel="הוסף פריט">
              <View
                style={[
                  styles.addButton,
                  draft.trim().length === 0 && { backgroundColor: colors.border },
                ]}
              >
                <Txt
                  variant="label"
                  center
                  color={draft.trim().length === 0 ? colors.textFaint : '#FFFFFF'}
                >
                  + הוסף
                </Txt>
              </View>
            </Squish>
          </FadeIn>

          <View style={{ height: space(5) }} />

          {items.length === 0 ? (
            <FadeIn delay={140}>
              <View style={styles.empty}>
                <Txt variant="body" center color={colors.textFaint}>
                  הרשימה ריקה.{'\n'}הוסף את הדברים שאתה לוקח ליעד הזה.
                </Txt>
              </View>
            </FadeIn>
          ) : (
            <View style={{ gap: space(2.5) }}>
              {items.map((item, index) => (
                <EditItemRow
                  key={item.id}
                  item={item}
                  index={index}
                  onDelete={() => removeItem(destination.id, item.id)}
                />
              ))}
            </View>
          )}

          {!isFresh ? (
            <View style={{ marginTop: space(10), alignItems: 'center' }}>
              <Button
                label="מחק את היעד"
                variant="danger"
                size="md"
                onPress={() => setConfirmDelete(true)}
              />
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Button label={isFresh ? 'שמור יעד' : 'שמור שינויים'} onPress={onDone} />
        </View>
      </KeyboardAvoidingView>

      <Sheet
        visible={confirmDelete}
        title="למחוק את היעד?"
        subtitle={`"${destination.name}" והפריטים שלו יימחקו.`}
        onClose={() => setConfirmDelete(false)}
        options={[
          {
            label: 'מחק יעד',
            tone: 'danger',
            onPress: () => {
              setConfirmDelete(false);
              deleteDestination(destination.id);
              router.dismissTo('/home');
            },
          },
          { label: 'ביטול', tone: 'cancel', onPress: () => setConfirmDelete(false) },
        ]}
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
  icon: {
    fontSize: 20,
    lineHeight: 26,
  },
  addRow: {
    marginTop: space(6),
    gap: space(2.5),
  },
  addressInput: {
    ...rtlText,
    marginTop: space(2),
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: space(4),
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  input: {
    ...rtlText,
    flex: 1,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: space(4),
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  addButton: {
    height: 56,
    paddingHorizontal: space(4.5),
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.soft,
  },
  empty: {
    paddingVertical: space(8),
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
  footer: {
    paddingHorizontal: space(5),
    paddingTop: space(3),
    paddingBottom: space(4),
    backgroundColor: colors.bg,
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
