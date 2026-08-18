import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { runSafely, useNative } from '../animate';
import { colors, contentMaxWidth, radius, row, rtlText, shadow, space } from '../theme';
import { transit } from '../transit';
import { TransitStop, TransitStopRef } from '../transit/types';
import { Button, Squish, Txt } from './ui';

/**
 * Picks a real stop from the official timetable, either by name or by distance
 * from the user.
 *
 * Location is only ever requested when the user taps "מצא תחנות קרובות אליי" —
 * never on open, and never in the background.
 */
export function StopPicker({
  visible,
  title,
  onClose,
  onPick,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  onPick: (stop: TransitStopRef) => void;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const t = useRef(new Animated.Value(0)).current;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TransitStop[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(
    () =>
      runSafely(
        Animated.timing(t, {
          toValue: visible ? 1 : 0,
          duration: visible ? 300 : 180,
          easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
          useNativeDriver: useNative,
        }),
        t,
        visible ? 1 : 0,
        800,
      ),
    [visible, t],
  );

  useEffect(() => {
    if (!visible) {
      setQuery('');
      setResults([]);
      setStatus(null);
      setBusy(false);
    }
  }, [visible]);

  /* The stop list is a one-time download, so searching is debounced. */
  useEffect(() => {
    if (!visible) return;
    const text = query.trim();
    if (text.length < 2) {
      setResults([]);
      return;
    }

    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      setBusy(true);
      setStatus('מחפש תחנות...');
      try {
        const found = await transit.searchStops(text, { limit: 25 });
        if (requestId.current !== id) return;
        setResults(found);
        setStatus(found.length === 0 ? 'לא נמצאו תחנות בשם הזה' : null);
      } catch {
        if (requestId.current !== id) return;
        setStatus('לא הצלחנו לטעון את רשימת התחנות. בדוק חיבור לאינטרנט.');
      } finally {
        if (requestId.current === id) setBusy(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [query, visible]);

  const findNearby = () => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('המכשיר הזה לא מאפשר איתור מיקום.');
      return;
    }

    setBusy(true);
    setStatus('מבקש הרשאת מיקום...');
    const id = ++requestId.current;

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        if (requestId.current !== id) return;
        setStatus('מחפש תחנות קרובות...');
        try {
          const found = await transit.getNearbyStops(
            position.coords.latitude,
            position.coords.longitude,
            { limit: 15 },
          );
          if (requestId.current !== id) return;
          setResults(found);
          setStatus(found.length === 0 ? 'לא נמצאו תחנות קרובות' : null);
        } catch {
          if (requestId.current === id) {
            setStatus('לא הצלחנו לטעון את רשימת התחנות. בדוק חיבור לאינטרנט.');
          }
        } finally {
          if (requestId.current === id) setBusy(false);
        }
      },
      () => {
        if (requestId.current !== id) return;
        setBusy(false);
        setStatus('לא קיבלנו הרשאת מיקום. אפשר לחפש תחנה לפי שם.');
      },
      { timeout: 15000, maximumAge: 60000 },
    );
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay, opacity: t }]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>

        <View style={styles.sheetWrap} pointerEvents="box-none">
          <Animated.View
            style={[
              styles.sheet,
              {
                paddingBottom: insets.bottom + space(4),
                maxHeight: height * 0.85,
                transform: [
                  { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [430, 0] }) },
                ],
              },
            ]}
          >
            <View style={styles.grabber} />

            <Txt variant="h2">{title}</Txt>

            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="חפש תחנה לפי שם..."
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              maxLength={60}
              returnKeyType="search"
            />

            <Button
              label="📍 מצא תחנות קרובות אליי"
              variant="soft"
              size="md"
              onPress={findNearby}
              style={{ marginTop: space(2.5) }}
            />

            {status ? (
              <Txt variant="caption" color={colors.textSoft} style={{ marginTop: space(3) }}>
                {status}
              </Txt>
            ) : null}

            <ScrollView
              style={{ marginTop: space(3) }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={{ gap: space(2) }}>
                {results.map((stop) => (
                  <Squish
                    key={stop.code}
                    onPress={() =>
                      onPick({ code: stop.code, name: stop.name, city: stop.city })
                    }
                    scaleTo={0.985}
                    accessibilityLabel={`בחר תחנה ${stop.name}`}
                  >
                    <View style={[row, styles.stopRow]}>
                      <View style={{ flex: 1 }}>
                        <Txt variant="body" numberOfLines={1}>
                          {stop.name}
                        </Txt>
                        <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 2 }}>
                          {stop.city ? stop.city + ' · ' : ''}רציף {stop.code}
                          {stop.distanceMeters !== undefined
                            ? ` · ${stop.distanceMeters} מ׳`
                            : ''}
                        </Txt>
                      </View>
                    </View>
                  </Squish>
                ))}
              </View>

              {!busy && results.length === 0 && !status ? (
                <Txt variant="caption" color={colors.textFaint} style={{ paddingVertical: space(4) }}>
                  {transit.sourceLabel}
                </Txt>
              ) : null}
            </ScrollView>

            <Button label="ביטול" variant="ghost" size="md" onPress={onClose} />
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheetWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  sheet: {
    width: '100%',
    maxWidth: contentMaxWidth,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space(5),
    paddingTop: space(3),
    ...shadow.card,
  },
  grabber: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    marginBottom: space(4),
  },
  input: {
    ...rtlText,
    marginTop: space(3),
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: space(4),
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  stopRow: {
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSoft,
    paddingHorizontal: space(3.5),
    paddingVertical: space(3),
  },
});
