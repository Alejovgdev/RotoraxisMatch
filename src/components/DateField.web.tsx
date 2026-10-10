import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from './ui/Text';
import { DateFieldProps, DEFAULT_DATE_FIELD_PALETTE } from './DateField.types';
import { localDateToIso } from '../utils/dateField';

// Web implementation: a real DOM <input type="date">. The browser itself
// only ever emits a valid ISO date or an empty string — there is no way to
// type free text into it — which is what makes this picker satisfy "no
// invalid date" without any parsing/validation code of our own.
//
// This file is only ever bundled for the web target (see DateField.tsx,
// the plain .tsx resolution target Metro/tsc fall back to) — it never pulls
// in @react-native-community/datetimepicker, which has no web
// implementation.
export function DateField({ value, onChange, placeholder, minimumDate, maximumDate, palette, disabled }: DateFieldProps) {
  const p = { ...DEFAULT_DATE_FIELD_PALETTE, ...palette };

  // React DOM (which react-native-web renders through on web) accepts a raw
  // lowercase tag name here; RN's own JSX.IntrinsicElements doesn't know
  // "input", so this goes through createElement directly rather than JSX.
  const input = React.createElement('input' as any, {
    type: 'date',
    value: value ?? '',
    min: minimumDate ? localDateToIso(minimumDate) : undefined,
    max: maximumDate ? localDateToIso(maximumDate) : undefined,
    disabled,
    placeholder,
    onChange: (e: any) => onChange(e.target.value || undefined),
    style: {
      flex: 1,
      minWidth: 0,
      minHeight: 38,
      borderRadius: 12,
      border: `1px solid ${p.border}`,
      backgroundColor: disabled ? p.border : p.surface,
      color: p.text,
      padding: '8px 10px',
      fontSize: 12,
      fontFamily: 'inherit',
    },
  } as any);

  return (
    <View style={styles.row}>
      {input}
      {value && !disabled ? (
        <TouchableOpacity onPress={() => onChange(undefined)} accessibilityRole="button">
          <Text style={[styles.clear, { color: p.accent }]}>Clear</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  clear: { fontSize: 12, fontWeight: '700' },
});
