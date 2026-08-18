import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DestinationsProvider } from '../src/store';
import { colors } from '../src/theme';
import { useReminders } from '../src/useReminders';

/** Inside the provider so it can read destinations and settings. */
function ReminderClock() {
  useReminders();
  return null;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <DestinationsProvider>
        <ReminderClock />
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
            // Pushing "forward" comes from the left in an RTL interface.
            animation: 'slide_from_left',
          }}
        />
      </DestinationsProvider>
    </SafeAreaProvider>
  );
}
