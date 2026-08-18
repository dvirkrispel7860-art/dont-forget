import { TextStyle, ViewStyle } from 'react-native';

export const colors = {
  bg: '#F4F5FA',
  surface: '#FFFFFF',
  surfaceSoft: '#FAFBFD',
  text: '#0E1320',
  textSoft: '#5A6478',
  textFaint: '#9AA3B4',
  border: '#E7EAF2',
  accent: '#4B5BF5',
  accentDeep: '#3341D8',
  accentSoft: '#EDEFFE',
  success: '#0FA968',
  successSoft: '#E4F7EE',
  danger: '#DC4A45',
  dangerSoft: '#FCEDEC',
  star: '#E8A209',
  starSoft: '#FDF3DF',
  overlay: 'rgba(14, 19, 32, 0.42)',
} as const;

export const radius = {
  sm: 12,
  md: 18,
  lg: 24,
  xl: 30,
  pill: 999,
} as const;

/** 4pt spacing scale: space(4) === 16 */
export const space = (n: number) => n * 4;

/**
 * Widest the content column ever gets. Phones are narrower than this so nothing
 * changes there; on a desktop browser it keeps the app a centred phone-shaped
 * column instead of stretching cards across the whole window.
 */
export const contentMaxWidth = 520;

export const shadow: Record<'soft' | 'card' | 'lifted', ViewStyle> = {
  soft: { boxShadow: '0px 3px 10px rgba(14, 19, 32, 0.05)' },
  card: { boxShadow: '0px 8px 20px rgba(14, 19, 32, 0.07)' },
  lifted: { boxShadow: '0px 10px 22px rgba(42, 47, 107, 0.24)' },
};

/**
 * The whole UI is Hebrew, so every text block is right-aligned and every row is
 * laid out right-to-left. We do it explicitly (instead of I18nManager.forceRTL)
 * so the layout is identical on iOS, Android and web with no app restart.
 */
export const rtlText: TextStyle = {
  textAlign: 'right',
  writingDirection: 'rtl',
};

export const row: ViewStyle = {
  flexDirection: 'row-reverse',
  alignItems: 'center',
};
