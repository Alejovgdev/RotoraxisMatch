import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Text } from './ui/Text';
import { Avatar } from './ui/Avatar';
import { Building2, CheckCircle, Clock, Mail, MapPin, Users, XCircle } from 'lucide-react-native';
import type { LucideProps } from 'lucide-react-native';
import type { Company, VerificationStatus } from '../types';
import { COMPANY_TYPES } from '../constants/companyTypes';
import {
  AdminBadge,
  AdminCard,
  AdminIconBox,
  AdminInitialAvatar,
  adminUi,
} from './admin/AdminUI';
import type { AdminTone } from './admin/AdminUI';
import { spacing } from '../theme';
import { notify, confirmAction } from '../utils/platformAlert';
import { formatLocation } from '../utils/formatLocation';

interface Props {
  company: Company;
  memberCount?: number;
  contactPhone?: string;
  onUpdateStatus: (id: string, status: VerificationStatus) => Promise<void>;
}

type ActionConfig = {
  status: VerificationStatus;
  label: string;
  color: string;
  icon: React.ComponentType<LucideProps>;
};

const ACTIONS: ActionConfig[] = [
  { status: 'verified', label: 'Verify', color: adminUi.green, icon: CheckCircle },
  { status: 'pending', label: 'Set pending', color: adminUi.amber, icon: Clock },
  { status: 'rejected', label: 'Reject', color: adminUi.red, icon: XCircle },
];

function verificationTone(status: VerificationStatus): AdminTone {
  if (status === 'verified') return 'success';
  if (status === 'pending') return 'warning';
  if (status === 'rejected') return 'error';
  return 'muted';
}

function statusLabel(status: VerificationStatus): string {
  if (status === 'verified') return 'Verified';
  if (status === 'pending') return 'Pending review';
  if (status === 'rejected') return 'Rejected';
  return 'Unverified';
}

function companyTypeLabel(type: string): string {
  return COMPANY_TYPES.find((item) => item.code === type)?.label ?? type.replace(/_/g, ' ');
}

function companyTypeTone(type: string): AdminTone {
  if (type === 'MRO') return 'cyan';
  if (type === 'airline') return 'navy';
  if (type === 'recruitment_agency') return 'info';
  if (type === 'helicopter_operator') return 'warning';
  return 'muted';
}

export function AdminCompanyCard({
  company,
  memberCount,
  contactPhone,
  onUpdateStatus,
}: Props) {
  const [loadingStatus, setLoadingStatus] = useState<VerificationStatus | null>(null);
  const currentStatus = company.verificationStatus;

  async function handleAction(status: VerificationStatus) {
    setLoadingStatus(status);
    try {
      await onUpdateStatus(company.id, status);
    } catch (error) {
      notify(
        'Company verification failed',
        error instanceof Error ? error.message : 'Could not update company verification.',
      );
    } finally {
      setLoadingStatus(null);
    }
  }

  // Mismo criterio que AdminTechnicianCard: `pending` es un estado de
  // nacimiento al que no se vuelve. Para retirar el acceso a una empresa ya
  // comprobada el destino es `rejected`, no "pendiente".
  const availableActions = ACTIONS.filter(
    (action) => action.status !== currentStatus && action.status !== 'pending',
  );

  return (
    <AdminCard
      style={[
        styles.card,
        currentStatus === 'pending' && styles.cardPending,
        currentStatus === 'rejected' && styles.cardRejected,
      ]}
    >
      <View style={styles.header}>
        <View style={styles.identity}>
          <Avatar kind="company" name={company.companyName} logoPath={company.logoPath} />
          <View style={styles.titleBlock}>
            <Text style={styles.name}>{company.companyName}</Text>
            <View style={styles.badgeRow}>
              <AdminBadge label={companyTypeLabel(company.companyType)} tone={companyTypeTone(company.companyType)} small />
              <AdminBadge label={statusLabel(company.verificationStatus)} tone={verificationTone(company.verificationStatus)} small />
            </View>
          </View>
        </View>
      </View>

      <View style={styles.metaGrid}>
        <InfoPill icon={Building2} label={companyTypeLabel(company.companyType)} />
        <InfoPill icon={MapPin} label={formatLocation(company.city, company.country)} />
        {memberCount !== undefined ? (
          <InfoPill icon={Users} label={`${memberCount} member${memberCount === 1 ? '' : 's'}`} />
        ) : null}
        <InfoPill icon={Mail} label={contactPhone ? `${company.contactEmail} - ${contactPhone}` : company.contactEmail} />
      </View>

      <View style={styles.actions}>
        {availableActions.map((action) => (
          <StatusActionButton
            key={action.status}
            action={action}
            loading={loadingStatus === action.status}
            disabled={loadingStatus !== null}
            onPress={() => handleAction(action.status)}
          />
        ))}
      </View>
    </AdminCard>
  );
}

function InfoPill({
  icon,
  label,
}: {
  icon: React.ComponentType<LucideProps>;
  label: string;
}) {
  return (
    <View style={styles.infoPill}>
      <AdminIconBox icon={icon} size={16} color={adminUi.accent} backgroundColor={adminUi.accentSoft} />
      <Text style={styles.infoText} numberOfLines={2}>{label}</Text>
    </View>
  );
}

function StatusActionButton({
  action,
  loading,
  disabled,
  onPress,
}: {
  action: ActionConfig;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const Icon = action.icon;
  return (
    <TouchableOpacity
      style={[
        styles.actionBtn,
        { borderColor: action.color + '55', backgroundColor: action.color + '0F' },
        disabled && styles.actionBtnDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.78}
    >
      {loading ? (
        <ActivityIndicator size="small" color={action.color} />
      ) : (
        <>
          <Icon size={15} color={action.color} strokeWidth={2.2} />
          <Text style={[styles.actionBtnText, { color: action.color }]}>{action.label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  cardPending: {
    borderColor: '#F3DDA4',
    borderLeftWidth: 3,
  },
  cardRejected: {
    borderColor: '#F3C2C2',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  identity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '700',
    color: adminUi.text,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  metaGrid: {
    gap: spacing.sm,
  },
  infoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: 14,
    backgroundColor: adminUi.surfaceSoft,
    borderWidth: 1,
    borderColor: adminUi.borderSoft,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: adminUi.textSoft,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: adminUi.borderSoft,
  },
  actionBtn: {
    flexGrow: 1,
    flexBasis: 112,
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  actionBtnDisabled: {
    opacity: 0.55,
  },
  actionBtnText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
});
