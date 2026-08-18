import React from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Button, FadeIn, Screen, Txt } from '../src/components/ui';
import { colors, radius, shadow, space } from '../src/theme';

/** The three little checklist lines inside the logo tile. */
function LogoMark() {
  return (
    <View style={[styles.logo, shadow.lifted]}>
      {[46, 34, 40].map((width, i) => (
        <View key={i} style={styles.logoRow}>
          <View style={styles.logoDot} />
          <View style={[styles.logoBar, { width }]} />
        </View>
      ))}
    </View>
  );
}

export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <Screen>
      <View style={styles.body}>
        <FadeIn offset={22}>
          <LogoMark />
        </FadeIn>

        <FadeIn delay={140}>
          <Txt variant="display" center style={styles.brand}>
            Don&apos;t Forget
          </Txt>
        </FadeIn>

        <FadeIn delay={260}>
          <Txt variant="body" center color={colors.textSoft} style={styles.tagline}>
            אל תצא בלי מה שאתה צריך.
          </Txt>
        </FadeIn>
      </View>

      <FadeIn delay={400} style={styles.footer}>
        {/* replace, not push: the tab bar becomes the navigation from here on. */}
        <Button label="התחל" onPress={() => router.replace('/home')} />
      </FadeIn>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space(7),
    gap: space(5),
  },
  logo: {
    width: 104,
    height: 104,
    borderRadius: radius.xl,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    paddingRight: space(5),
    gap: space(2.5),
    marginBottom: space(3),
  },
  logoRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: space(2),
  },
  logoDot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: '#FFFFFF',
  },
  logoBar: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.65)',
  },
  brand: {
    writingDirection: 'ltr',
  },
  tagline: {
    maxWidth: 280,
  },
  footer: {
    paddingHorizontal: space(6),
    paddingBottom: space(6),
  },
});
