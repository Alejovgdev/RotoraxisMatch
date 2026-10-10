import { TextStyle } from 'react-native';
import { colors } from './colors';

export const typography = {
  h1: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.text,
    lineHeight: 40,
  } as TextStyle,
  h2: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
    lineHeight: 32,
  } as TextStyle,
  h3: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
    lineHeight: 28,
  } as TextStyle,
  h4: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    lineHeight: 24,
  } as TextStyle,
  body: {
    fontSize: 15,
    fontWeight: '400',
    color: colors.text,
    lineHeight: 22,
  } as TextStyle,
  bodySmall: {
    fontSize: 13,
    fontWeight: '400',
    color: colors.textSecondary,
    lineHeight: 20,
  } as TextStyle,
  caption: {
    fontSize: 12,
    fontWeight: '400',
    color: colors.textMuted,
    lineHeight: 18,
  } as TextStyle,
  label: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textSecondary,
    lineHeight: 18,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  } as TextStyle,
} as const;
