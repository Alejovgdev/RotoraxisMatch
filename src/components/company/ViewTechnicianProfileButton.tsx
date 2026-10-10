import React from 'react';
import {
  StyleProp,
  StyleSheet,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';
import { Text } from '../ui/Text';
import { useRouter } from 'expo-router';
import { UserRound } from 'lucide-react-native';
import { colors, spacing } from '../../theme';
import { companyUi } from './CompanyUI';

export function ViewTechnicianProfileButton({
  technicianId,
  label = 'View profile',
  solid = false,
  fullWidth = false,
  style,
}: {
  technicianId: string;
  label?: string;
  solid?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const router = useRouter();

  return (
    <TouchableOpacity
      style={[
        styles.button,
        solid && styles.buttonSolid,
        fullWidth && styles.buttonFull,
        style,
      ]}
      onPress={(event) => {
        event.stopPropagation();
        router.push(`/company/technician/${technicianId}` as any);
      }}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`${label} for technician`}
    >
      <UserRound color={solid ? colors.white : companyUi.accent} size={16} strokeWidth={2.2} />
      <Text style={[styles.label, solid && styles.labelSolid]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: companyUi.accent,
    backgroundColor: companyUi.surface,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
  },
  buttonSolid: {
    backgroundColor: companyUi.accent,
  },
  buttonFull: {
    alignSelf: 'stretch',
  },
  label: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: companyUi.accent,
  },
  labelSolid: {
    color: colors.white,
  },
});
