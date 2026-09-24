import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Text,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { BriefcaseBusiness, Cake, CheckCircle, Clock, Mail, MapPin, UserRound, XCircle } from 'lucide-react-native';
import type { LucideProps } from 'lucide-react-native';
import type { Technician, TechnicianWithRelations, UserStatus, VerificationStatus } from '../types';
import { technicianTypeLabels } from '../constants/technicianTypes';
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
  technician: Technician;
  details?: TechnicianWithRelations;
  /** displayName completo (célula + motor) de cada type rating, resuelto por useAdminDashboard. */
  typeRatingLabels?: string[];
  /** Estado de CUENTA (`profiles.status`), distinto del de verificación del perfil. */
  accountStatus?: UserStatus;
  onUpdateStatus: (id: string, status: VerificationStatus) => Promise<void>;
}

type ActionConfig = {
  status: VerificationStatus;
  label: string;
  tone: AdminTone;
  color: string;
  icon: React.ComponentType<LucideProps>;
};

const ACTIONS: ActionConfig[] = [
  { status: 'verified', label: 'Verify', tone: 'success', color: adminUi.green, icon: CheckCircle },
  { status: 'pending', label: 'Set pending', tone: 'warning', color: adminUi.amber, icon: Clock },
  { status: 'rejected', label: 'Reject', tone: 'error', color: adminUi.red, icon: XCircle },
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

// Fase 6 tanda A: varios tipos por perfil. El mapa de labels local que había
// aquí se sustituye por el helper compartido — era una de las cuatro copias
// del mismo `find()` sobre TECHNICIAN_TYPES, y cuatro copias son cuatro
// sitios donde la lista se puede quedar desordenada de forma distinta.
function technicianTypesLabel(details?: TechnicianWithRelations): string {
  if (!details) return 'Technician profile';
  return technicianTypeLabels(details.technicianTypes, 'Technician profile');
}

// Fecha de nacimiento tal cual, no la edad derivada: para cotejar una
// identidad contra un documento, la fecha es el dato; la edad es un resumen.
function birthDateLabel(details?: TechnicianWithRelations): string {
  if (!details?.birthDate) return 'Date of birth not provided';
  const d = new Date(details.birthDate);
  if (Number.isNaN(d.getTime())) return 'Date of birth not provided';
  return `Born ${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`;
}

// Cuánto lleva esperando: es la métrica real de la cola de moderación.
function waitingLabel(details?: TechnicianWithRelations): string {
  if (!details?.createdAt) return 'Registered recently';
  const created = new Date(details.createdAt);
  if (Number.isNaN(created.getTime())) return 'Registered recently';
  const days = Math.floor((Date.now() - created.getTime()) / 86_400_000);
  if (days <= 0) return 'Registered today';
  if (days === 1) return 'Waiting 1 day';
  return `Waiting ${days} days`;
}

function compactValues(values: string[], max = 5): string[] {
  const unique = [...new Set(values.filter(Boolean))];
  if (unique.length <= max) return unique;
  return [...unique.slice(0, max), `+${unique.length - max}`];
}

export function AdminTechnicianCard({ technician, details, typeRatingLabels, accountStatus, onUpdateStatus }: Props) {
  const [loadingStatus, setLoadingStatus] = useState<VerificationStatus | null>(null);
  const currentStatus = technician.verificationStatus;
  // Una cuenta borrada es una LÁPIDA: se conserva para no evaporar el historial
  // de la empresa, pero NO admite moderación. Cambiar su verificación llamaría a
  // admin_update_technician_verification(), que escribe profiles.status sin
  // mirar el estado actual: "Verify" la dejaría en 'active' y "Set pending" en
  // 'pending_verification' — y technician_public_view (migración 024) admite
  // AMBOS, así que el técnico borrado reaparecería en búsqueda, mapa y ranking.
  const isDeleted = accountStatus === 'deleted';
  const isPending = !isDeleted && currentStatus === 'pending';

  async function handleAction(status: VerificationStatus) {
    setLoadingStatus(status);
    try {
      await onUpdateStatus(technician.id, status);
    } catch (error) {
      notify(
        'Technician verification failed',
        error instanceof Error ? error.message : 'Could not update technician verification.',
      );
    } finally {
      setLoadingStatus(null);
    }
  }

  // `pending` es un estado de NACIMIENTO al que no se vuelve.
  //
  // Significa "aún no te hemos comprobado", y eso es falso para alguien ya
  // verificado o ya rechazado. Con la tarjeta de pendiente (arriba) el absurdo
  // se vuelve visible: devolver a `pending` a un técnico con perfil completo y
  // documentos le mostraría al admin "nothing to review here yet".
  //
  // Para RETIRAR el acceso a alguien ya comprobado el destino correcto es
  // `rejected` (-> profiles.status = 'suspended'), no "pendiente".
  //
  // Esto es sólo la mitad de UI. La matriz completa, su enforcement en
  // admin_update_technician_verification() y el validador que compruebe que
  // ambos lados coinciden están en el backlog del mission doc — hasta
  // entonces la regla vive únicamente aquí y un RPC directo puede saltársela.
  const availableActions = isDeleted
    ? []
    : ACTIONS.filter((action) => action.status !== currentStatus && action.status !== 'pending');
  const licenseChips = compactValues(
    details?.licenses.map((license) => license.licenseCode) ?? technician.licenseCategories,
  );
  // Etiquetas resueltas en useAdminDashboard, que es donde ya vive el catálogo
  // cargado — aquí NO se carga una segunda copia (esa era y sigue siendo la
  // razón de no recomputar desde `details.habilitations`). Lo que cambia es la
  // fuente: `typeRatingLabels` trae el displayName COMPLETO (célula + motor),
  // no la `aircraftFamily` suelta de `technician.aircraftTypes`, que perdía la
  // motorización — la distinción que un type rating Part-66 codifica.
  const habilitationChips = compactValues(typeRatingLabels ?? technician.aircraftTypes);

  // El realce de estado es una señal de COLA ("mírame"), no una etiqueta de
  // color: sobre una lápida el borde ámbar de "pendiente" prometía una revisión
  // que la propia tarjeta ya declara imposible unas líneas más abajo.
  return (
    <AdminCard
      style={[
        styles.card,
        isPending && styles.cardPending,
        !isDeleted && currentStatus === 'rejected' && styles.cardRejected,
        isDeleted && styles.cardDeleted,
      ]}
    >
      <View style={styles.header}>
        <View style={styles.identity}>
          <AdminInitialAvatar label={technician.fullName} color={adminUi.navy} />
          <View style={styles.titleBlock}>
            <Text style={styles.name}>{technician.fullName}</Text>
            <Text style={styles.code}>{technician.anonymousCode}</Text>
          </View>
        </View>
        {/* La lápida manda sobre el estado de verificación: mostrar "Verified"
            a secas en una cuenta borrada fue lo que hacía que pareciera
            moderable. El estado de verificación real se sigue viendo debajo. */}
        {isDeleted ? (
          <AdminBadge label="Deleted account" tone="error" />
        ) : (
          <AdminBadge label={statusLabel(technician.verificationStatus)} tone={verificationTone(technician.verificationStatus)} />
        )}
      </View>

      {isDeleted ? (
        <Text style={styles.deletedNote}>
          This account was deleted by its owner. The record is kept so company history stays
          intact, but it can no longer be moderated and the technician cannot sign in again.
          Verification status was {statusLabel(technician.verificationStatus).toLowerCase()} when it was deleted.
        </Text>
      ) : null}

      {/* Un técnico PENDIENTE no puede tocar su perfil ni subir un documento
          hasta que se le apruebe, así que "0 years exp · 0% profile · sin
          licencias" no es señal: es ruido estructural que hace parecer
          abandonada una cuenta recién creada. Lo que se verifica aquí es la
          IDENTIDAD, así que se muestra lo que sirve para eso. La fecha de
          nacimiento SÍ va: la retirada de la edad (migración 040) fue del
          contrato con las EMPRESAS, no del panel de moderación. */}
      {isPending ? (
        <>
          <View style={styles.metaGrid}>
            <InfoPill icon={Mail} label={details?.email ?? '—'} />
            <InfoPill icon={Cake} label={birthDateLabel(details)} />
            <InfoPill icon={BriefcaseBusiness} label={technicianTypesLabel(details)} />
            <InfoPill icon={MapPin} label={formatLocation(technician.city, technician.country)} />
            <InfoPill icon={Clock} label={waitingLabel(details)} />
          </View>
          <Text style={styles.pendingNote}>
            Profile and documents come after verification — there is nothing to review here yet.
          </Text>
        </>
      ) : (
        <>
          <View style={styles.metaGrid}>
            <InfoPill icon={BriefcaseBusiness} label={technicianTypesLabel(details)} />
            <InfoPill icon={MapPin} label={formatLocation(technician.city, technician.country)} />
            <InfoPill icon={UserRound} label={`${technician.yearsExperience} years exp.`} />
          </View>

          {licenseChips.length > 0 ? (
            <ChipGroup label="Licenses" values={licenseChips} tone="navy" />
          ) : null}

          {habilitationChips.length > 0 ? (
            <ChipGroup label="Habilitations" values={habilitationChips} tone="cyan" />
          ) : null}
        </>
      )}

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

function ChipGroup({
  label,
  values,
  tone,
}: {
  label: string;
  values: string[];
  tone: AdminTone;
}) {
  return (
    <View style={styles.chipGroup}>
      <Text style={styles.chipLabel}>{label}</Text>
      <View style={styles.chipRow}>
        {values.map((value) => (
          <AdminBadge key={value} label={value} tone={tone} small />
        ))}
      </View>
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
    borderColor: '#FDE68A',
    borderLeftWidth: 3,
  },
  cardRejected: {
    borderColor: '#FECACA',
  },
  // Atenuada, no alarmante: una cuenta borrada es archivo, no incidencia.
  cardDeleted: {
    opacity: 0.72,
  },
  pendingNote: {
    fontSize: 12,
    lineHeight: 18,
    color: adminUi.textMuted,
    fontStyle: 'italic',
  },
  deletedNote: {
    fontSize: 12,
    lineHeight: 18,
    color: adminUi.textMuted,
    fontStyle: 'italic',
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
  code: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: adminUi.textMuted,
    fontFamily: 'monospace',
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
  chipGroup: {
    gap: spacing.xs,
  },
  chipLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    color: adminUi.textMuted,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
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
    borderRadius: 12,
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
    fontWeight: '700',
  },
});
