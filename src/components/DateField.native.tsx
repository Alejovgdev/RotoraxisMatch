import React, { useState } from 'react';
import { View, TouchableOpacity, StyleSheet, Modal, Platform } from 'react-native';
import { Text } from './ui/Text';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { DateFieldProps, DEFAULT_DATE_FIELD_PALETTE } from './DateField.types';
import { formatDisplayDate, isoToLocalDate, localDateToIso } from '../utils/dateField';

// Native (iOS/Android) implementation: the OS's own date dialog. Same
// "no invalid date" guarantee as the web <input type="date"> — the native
// picker only ever hands back a real calendar date or nothing.
//
// Android's dialog is already a self-contained modal that opens/closes
// itself, so it's rendered directly. iOS's inline spinner never closes on
// its own, so it's wrapped in our own bottom-sheet Modal with
// Cancel/Done — onChange there fires continuously as the wheel scrolls, so
// only "Done" commits it (tempDate holds the in-progress value).
export function DateField({ value, onChange, placeholder, minimumDate, maximumDate, palette, disabled }: DateFieldProps) {
  const p = { ...DEFAULT_DATE_FIELD_PALETTE, ...palette };
  const [open, setOpen] = useState(false);
  const [tempDate, setTempDate] = useState<Date>(() => (value ? isoToLocalDate(value) : new Date()));

  function openPicker() {
    if (disabled) return;
    setTempDate(value ? isoToLocalDate(value) : new Date());
    setOpen(true);
  }

  function handleAndroidChange(event: DateTimePickerEvent, selected?: Date) {
    setOpen(false);
    if (event.type === 'set' && selected) onChange(localDateToIso(selected));
  }

  function handleIosChange(_event: DateTimePickerEvent, selected?: Date) {
    if (selected) setTempDate(selected);
  }

  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={[styles.button, { borderColor: p.border, backgroundColor: disabled ? p.border : p.surface }]}
        onPress={openPicker}
        disabled={disabled}
        accessibilityRole="button"
      >
        <Text style={[styles.buttonText, { color: value ? p.text : p.muted }]}>
          {value ? formatDisplayDate(value) : (placeholder ?? 'Select date')}
        </Text>
      </TouchableOpacity>

      {value && !disabled ? (
        <TouchableOpacity onPress={() => onChange(undefined)} accessibilityRole="button">
          <Text style={[styles.clear, { color: p.accent }]}>Clear</Text>
        </TouchableOpacity>
      ) : null}

      {open && Platform.OS === 'android' ? (
        <DateTimePicker
          value={tempDate}
          mode="date"
          display="default"
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          onChange={handleAndroidChange}
        />
      ) : null}

      {open && Platform.OS === 'ios' ? (
        <Modal transparent animationType="slide" onRequestClose={() => setOpen(false)}>
          <View style={styles.sheetBackdrop}>
            <View style={[styles.sheet, { backgroundColor: p.surface }]}>
              <View style={styles.sheetHeader}>
                <TouchableOpacity onPress={() => setOpen(false)} accessibilityRole="button">
                  <Text style={[styles.sheetAction, { color: p.muted }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    onChange(localDateToIso(tempDate));
                    setOpen(false);
                  }}
                  accessibilityRole="button"
                >
                  <Text style={[styles.sheetAction, { color: p.accent }]}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={tempDate}
                mode="date"
                display="spinner"
                minimumDate={minimumDate}
                maximumDate={maximumDate}
                onChange={handleIosChange}
              />
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  button: {
    flex: 1,
    minWidth: 0,
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  buttonText: { fontSize: 12, fontWeight: '500' },
  clear: { fontSize: 12, fontWeight: '700' },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 24,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sheetAction: { fontSize: 15, fontWeight: '700' },
});
