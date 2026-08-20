import React, { useState } from 'react';
import { getCurrentLocation, locationErrorHint, locationErrorMessage } from '../location';
import { useStore } from '../store';
import { Destination } from '../types';
import { Sheet } from './Sheet';

/**
 * "📍 בחר מיקום" — what to do when a destination cannot be placed on the map.
 *
 * No map picker is built here on purpose: the app has no maps layer, and a real
 * one is a feature of its own. What it does have is the same device location
 * (`src/location.ts`, web and native alike) the stop picker uses, which covers the
 * honest case of standing at the place ("this is where it is"), plus a way back to
 * the address field so the lookup can succeed next time.
 *
 * Location is requested only when the user taps that option — never on open.
 * Picking a point on a map slots in as one more option here.
 */
export function LocationFixSheet({
  destination,
  visible,
  onClose,
  onEditAddress,
}: {
  destination: Destination;
  visible: boolean;
  onClose: () => void;
  /** Opens the screen where the address lives. */
  onEditAddress: () => void;
}) {
  const { updateDestination } = useStore();
  const [status, setStatus] = useState<string | null>(null);

  const useCurrentPosition = async () => {
    setStatus('מבקש את המיקום שלך...');

    /*
     * A fresh fix, on purpose: "this is where the place is" must not be answered
     * with a point from a few minutes ago somewhere else.
     */
    const located = await getCurrentLocation({ maxAgeMs: 0, allowStale: false });

    if (located.status === 'error') {
      setStatus(
        [
          locationErrorMessage(located.reason),
          locationErrorHint(located.reason),
          'אפשר לתקן את הכתובת במקום.',
        ]
          .filter(Boolean)
          .join(' '),
      );
      return;
    }

    updateDestination(destination.id, {
      coords: {
        latitude: located.location.latitude,
        longitude: located.location.longitude,
      },
      // Named for what it is, so the forecast does not claim to be for an
      // address we never resolved.
      coordsLabel: 'המיקום שבחרת',
    });
    setStatus(null);
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      title="📍 בחר מיקום ליעד"
      subtitle={
        status ??
        'בלי מיקום אין תחזית לזה. אפשר לקבוע אותו לפי המקום שאתה נמצא בו עכשיו, או לתקן את הכתובת כדי שנמצא אותו לבד.'
      }
      onClose={onClose}
      options={[
        {
          label: '📍 אני נמצא כאן עכשיו',
          hint: 'ישמור את המיקום הנוכחי שלך כמיקום היעד',
          onPress: useCurrentPosition,
        },
        {
          label: '✏️ תקן את הכתובת',
          hint: 'כתובת מדויקת יותר — למשל עם שם העיר',
          onPress: () => {
            onClose();
            onEditAddress();
          },
        },
        { label: 'לא עכשיו', tone: 'cancel', onPress: onClose },
      ]}
    />
  );
}
