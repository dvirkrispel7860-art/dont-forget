import React from 'react';
import { Tabs } from 'expo-router/js-tabs';
import { TabBar } from '../../src/components/TabBar';
import { colors } from '../../src/theme';

export const unstable_settings = {
  initialRouteName: 'home',
};

/**
 * The four tabs stay mounted, so switching between them keeps whatever the user
 * had on screen (a half-typed destination, a scroll position) exactly as it was.
 */
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      {/* The bar is laid out right-to-left, so this order puts "הוסף יעד" on the
          far right, "בית" in the middle and "היסטוריה" on the far left. */}
      <Tabs.Screen name="new" />
      <Tabs.Screen name="home" />
      <Tabs.Screen name="history" />
    </Tabs>
  );
}
