import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Text } from '../../src/components/ui/Text';
import { Stack } from 'expo-router';
import { useGoBack } from '../../src/state/useGoBack';
import {
  Archive,
  BriefcaseBusiness,
  CalendarClock,
  Inbox,
  MailX,
  MapPin,
  MessageSquareQuote,
  Send,
} from 'lucide-react-native';
import type { LucideProps } from 'lucide-react-native';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { useDeletedAccounts } from '../../src/state/useDeletedAccounts';
import type { DeletionFeedbackSummary } from '../../src/state/useDeletedAccounts';
import type { DeletedAccount } from '../../src/repositories/v2/deletedAccountRepository';
import { deletionReasonAdminLabel, isSuccessfulExit } from '../../src/constants/deletionReasons';
import { technicianTypeLabel as sharedTechnicianTypeLabel } from '../../src/constants/technicianTypes';
import {
  AdminBadge,
  AdminCard,
  AdminChip,
  AdminEmptyPanel,
  AdminIconBox,
  AdminInitialAvatar,
  AdminPageHeader,
  AdminScreen,
  adminUi,
} from '../../src/components/admin/AdminUI';
import { spacing } from '../../src/theme';
import { formatLocation } from '../../src/utils/formatLocation';

type RoleFilter = 'all' | 'technician' | 'company_user';

const ROLE_TABS: { key: RoleFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'technician', label: 'Technicians' },
  { key: 'company_user', label: 'Company users' },
];

function formatDate(value: string | null): string {
  if (!value) return 'Not recorded';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Not recorded';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// El intervalo alta→baja es la lectura útil de esta pantalla: distingue el alta
// que nunca arrancó del abandono tras meses de uso. Son dos problemas distintos.
function lifetimeLabel(account: DeletedAccount): string {
  if (account.lifetimeDays === null) return 'Lifetime unknown';
  if (account.lifetimeDays === 0) return 'Deleted the same day';
  if (account.lifetimeDays === 1) return 'Lasted 1 day';
  if (account.lifetimeDays < 60) return `Lasted ${account.lifetimeDays} days`;
  return `Lasted ${Math.round(account.lifetimeDays / 30)} months`;
}

// Lápidas: el tipo es el CONGELADO en el momento del borrado, un único
// código de la columna legacy. No pasa por la tabla puente a propósito — las
// filas del técnico ya no existen (ON DELETE CASCADE), y una lápida describe
// lo que había, no lo que habría hoy.
function technicianTypeLabel(code: string | null): string {
  if (!code) return 'Technician';
  return sharedTechnicianTypeLabel(code);
}

function displayName(account: DeletedAccount): string {
  return account.anonymousCode ?? 'Company user';
}

export default function AdminDeletedAccountsScreen() {
  const goBack = useGoBack();
  const { accounts, summary, feedback, state, error, refresh } = useDeletedAccounts();
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const { width } = useWindowDimensions();
  const isWide = width >= 900;

  const filtered = useMemo(
    () => (roleFilter === 'all' ? accounts : accounts.filter((a) => a.role === roleFilter)),
    [accounts, roleFilter],
  );

  const renderItem = useCallback(
    ({ item }: { item: DeletedAccount }) => <DeletedAccountCard account={item} />,
    [],
  );

  if (state === 'loading') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingScreen color={adminUi.accent} role="admin" />
      </>
    );
  }

  return (
    <AdminScreen>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.topContent, isWide && styles.contentWide]}>
        <AdminPageHeader
          eyebrow="Retention"
          title="Deleted accounts"
          subtitle="Accounts closed by their own owner. Kept as anonymised records so company history stays intact."
          onBack={goBack}
        />

        {/* Por qué esta pantalla no tiene un botón de "contactar".
            Es la pregunta que se hace cualquiera al abrirla, y la respuesta es
            estructural, no una funcionalidad pendiente: el borrado destruye el
            correo (dominio .invalid) y las credenciales. Decirlo aquí evita
            que alguien lo pida como bug. */}
        <AdminCard style={styles.noticeCard}>
          <AdminIconBox icon={MailX} size={18} color={adminUi.textSoft} backgroundColor={adminUi.surfaceSoft} />
          <View style={styles.noticeTextBlock}>
            <Text style={styles.noticeTitle}>No contact data survives a deletion</Text>
            <Text style={styles.noticeText}>
              Email and phone are overwritten and the sign-in credentials are destroyed the moment the
              account is deleted, so nobody here can be contacted — by design, and as promised in the
              privacy policy. That is why the reason is asked during the deletion flow instead: the
              answers below are stored on their own, with no link back to the person who wrote them.
            </Text>
          </View>
        </AdminCard>

        {state === 'error' ? (
          <AdminCard style={styles.errorCard}>
            <Text style={styles.errorTitle}>Could not load deleted accounts</Text>
            <Text style={styles.errorText}>{error?.message ?? 'Unknown error.'}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={refresh} activeOpacity={0.78}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </AdminCard>
        ) : null}

        {state === 'success' ? (
          <>
            <AdminCard style={styles.summaryCard}>
              <View style={styles.summaryGrid}>
                <SummaryTile label="Deleted accounts" value={String(summary.total)} />
                <SummaryTile label="Technicians" value={String(summary.technicians)} />
                <SummaryTile label="Company users" value={String(summary.companyUsers)} />
                <SummaryTile
                  label="Same-day exits"
                  value={String(summary.sameDay)}
                  detail="Signed up and left within 24 h"
                />
                <SummaryTile
                  label="Median lifetime"
                  value={summary.medianLifetimeDays === null ? '—' : `${summary.medianLifetimeDays}d`}
                  detail={
                    summary.undatedCount > 0
                      ? `${summary.undatedCount} without a recorded date`
                      : 'Across all dated deletions'
                  }
                />
              </View>
            </AdminCard>

            <FeedbackPanel feedback={feedback} totalDeletions={summary.total} />

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {ROLE_TABS.map(({ key, label }) => (
                <AdminChip
                  key={key}
                  label={label}
                  selected={roleFilter === key}
                  onPress={() => setRoleFilter(key)}
                />
              ))}
            </ScrollView>
          </>
        ) : null}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.userId}
        contentContainerStyle={[styles.list, isWide && styles.contentWide]}
        showsVerticalScrollIndicator={false}
        renderItem={renderItem}
        ListEmptyComponent={
          state === 'error' ? null : (
            <AdminEmptyPanel
              title="No deleted accounts"
              subtitle="Nobody has closed their account under this filter. That is the good outcome."
            />
          )
        }
      />
    </AdminScreen>
  );
}

function DeletedAccountCard({ account }: { account: DeletedAccount }) {
  const isTechnician = account.role === 'technician';
  const location = formatLocation(account.city, account.country);

  return (
    <AdminCard style={styles.card}>
      <View style={styles.header}>
        <View style={styles.identity}>
          <AdminInitialAvatar label={displayName(account)} color={adminUi.textMuted} />
          <View style={styles.titleBlock}>
            <Text style={styles.name}>{displayName(account)}</Text>
            <Text style={styles.role}>{isTechnician ? 'Technician' : 'Company user'}</Text>
          </View>
        </View>
        <AdminBadge label={lifetimeLabel(account)} tone={account.lifetimeDays === 0 ? 'error' : 'muted'} />
      </View>

      <View style={styles.metaGrid}>
        <InfoPill icon={CalendarClock} label={`Signed up ${formatDate(account.accountCreatedAt)}`} />
        <InfoPill icon={Archive} label={`Deleted ${formatDate(account.deletedAt)}`} />
        {isTechnician ? (
          <InfoPill icon={BriefcaseBusiness} label={technicianTypeLabel(account.technicianType)} />
        ) : null}
        {location ? <InfoPill icon={MapPin} label={location} /> : null}
      </View>

      {isTechnician ? (
        <View style={styles.footer}>
          {/* El rastro que la lápida existe para preservar: si esta persona
              habló con una empresa, esa empresa sigue viendo con quién habló. */}
          <TraceChip icon={Send} label={`${account.applicationsSent} application${account.applicationsSent !== 1 ? 's' : ''} sent`} />
          <TraceChip icon={Inbox} label={`${account.directOffersReceived} direct offer${account.directOffersReceived !== 1 ? 's' : ''}`} />
          {account.verificationStatusAtDeletion ? (
            <AdminBadge label={`${account.verificationStatusAtDeletion} at deletion`} tone="muted" small />
          ) : null}
        </View>
      ) : (
        // La pertenencia a la empresa cae con la cuenta (handle_deleted_user
        // borra la fila de company_members), así que a qué empresa pertenecía
        // ya no consta en ninguna parte. Se dice, en vez de dejar un hueco.
        <Text style={styles.footerNote}>
          Company membership was removed with the account — the organisation it belonged to is no
          longer recorded.
        </Text>
      )}
    </AdminCard>
  );
}

function FeedbackPanel({
  feedback,
  totalDeletions,
}: {
  feedback: DeletionFeedbackSummary;
  totalDeletions: number;
}) {
  // Cuántos NO contestaron es tan informativo como lo que contestaron los que
  // sí: una tasa de respuesta baja dice que las conclusiones de abajo se
  // sostienen sobre poco. Se muestra siempre, no sólo cuando conviene.
  const silent = Math.max(0, totalDeletions - feedback.answered);
  const maxCount = feedback.tally[0]?.count ?? 0;

  return (
    <AdminCard style={styles.feedbackCard}>
      <View style={styles.feedbackHeader}>
        <AdminIconBox icon={MessageSquareQuote} size={18} color={adminUi.accent} backgroundColor={adminUi.accentSoft} />
        <View style={styles.noticeTextBlock}>
          <Text style={styles.noticeTitle}>Why they left</Text>
          <Text style={styles.noticeText}>
            {feedback.answered === 0
              ? 'Nobody has answered the exit question yet. It is asked during the deletion flow and is optional.'
              : `${feedback.answered} of ${totalDeletions} answered — ${silent} left without saying why.`}
          </Text>
        </View>
      </View>

      {feedback.successfulExits > 0 ? (
        <View style={styles.successNote}>
          <Text style={styles.successNoteText}>
            {feedback.successfulExits} of these left because they got what they came for here. That is
            not churn — it is the product working.
          </Text>
        </View>
      ) : null}

      {feedback.tally.map(({ reason, count }) => (
        <View key={reason} style={styles.tallyRow}>
          <View style={styles.tallyTextRow}>
            <Text style={styles.tallyLabel}>{deletionReasonAdminLabel(reason)}</Text>
            <Text style={styles.tallyCount}>{count}</Text>
          </View>
          <View style={styles.tallyTrack}>
            <View
              style={[
                styles.tallyFill,
                { width: `${maxCount === 0 ? 0 : Math.round((count / maxCount) * 100)}%` },
                isSuccessfulExit(reason) && styles.tallyFillSuccess,
              ]}
            />
          </View>
        </View>
      ))}

      {feedback.withComments.length > 0 ? (
        <View style={styles.commentsBlock}>
          <Text style={styles.commentsTitle}>In their words</Text>
          {feedback.withComments.map((row) => (
            <View key={row.id} style={styles.commentCard}>
              <Text style={styles.commentText}>“{row.comment}”</Text>
              <Text style={styles.commentMeta}>
                {deletionReasonAdminLabel(row.reason)} · {row.role === 'company_user' ? 'Company user' : 'Technician'} · {row.createdOn}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </AdminCard>
  );
}

function SummaryTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <View style={styles.summaryTile}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
      {detail ? <Text style={styles.summaryDetail}>{detail}</Text> : null}
    </View>
  );
}

function InfoPill({ icon, label }: { icon: React.ComponentType<LucideProps>; label: string }) {
  return (
    <View style={styles.infoPill}>
      <AdminIconBox icon={icon} size={16} color={adminUi.textSoft} backgroundColor={adminUi.surfaceSoft} />
      <Text style={styles.infoText} numberOfLines={2}>{label}</Text>
    </View>
  );
}

function TraceChip({ icon: Icon, label }: { icon: React.ComponentType<LucideProps>; label: string }) {
  return (
    <View style={styles.traceChip}>
      <Icon size={13} color={adminUi.textMuted} strokeWidth={2.2} />
      <Text style={styles.traceText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  topContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  contentWide: {
    maxWidth: 920,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: spacing.lg,
  },
  noticeCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  noticeTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  noticeTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
    color: adminUi.text,
  },
  noticeText: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
    color: adminUi.textSoft,
  },
  summaryCard: {
    marginBottom: spacing.md,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  summaryTile: {
    flexGrow: 1,
    flexBasis: 132,
    borderWidth: 1,
    borderColor: adminUi.borderSoft,
    borderRadius: 16,
    backgroundColor: adminUi.surfaceSoft,
    padding: spacing.md,
    gap: 2,
  },
  summaryValue: {
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '700',
    color: adminUi.text,
  },
  summaryLabel: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    color: adminUi.textSoft,
  },
  summaryDetail: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '500',
    color: adminUi.textMuted,
  },
  feedbackCard: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  feedbackHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  successNote: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#A7DCC3',
    backgroundColor: adminUi.greenSoft,
    padding: spacing.sm,
  },
  successNoteText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
    color: adminUi.green,
  },
  tallyRow: {
    gap: 4,
  },
  tallyTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  tallyLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: adminUi.textSoft,
  },
  tallyCount: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: adminUi.text,
  },
  tallyTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: adminUi.surfaceSoft,
    overflow: 'hidden',
  },
  tallyFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: adminUi.accent,
  },
  tallyFillSuccess: {
    backgroundColor: adminUi.green,
  },
  commentsBlock: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: adminUi.borderSoft,
  },
  commentsTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: adminUi.textMuted,
  },
  commentCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: adminUi.borderSoft,
    backgroundColor: adminUi.surfaceSoft,
    padding: spacing.md,
    gap: spacing.xs,
  },
  commentText: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
    fontStyle: 'italic',
    color: adminUi.text,
  },
  commentMeta: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    color: adminUi.textMuted,
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingRight: spacing.md,
    paddingBottom: spacing.sm,
  },
  errorCard: {
    gap: spacing.sm,
    marginBottom: spacing.md,
    borderColor: '#F3C2C2',
  },
  errorTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
    color: adminUi.red,
  },
  errorText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
    color: adminUi.textSoft,
  },
  retryBtn: {
    alignSelf: 'flex-start',
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: adminUi.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    fontSize: 12,
    fontWeight: '700',
    color: adminUi.textSoft,
  },
  list: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxxl,
  },
  card: {
    gap: spacing.md,
    marginBottom: spacing.md,
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
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: adminUi.text,
    fontFamily: 'monospace',
  },
  role: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: adminUi.textMuted,
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
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: adminUi.borderSoft,
  },
  footerNote: {
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: adminUi.borderSoft,
    fontSize: 12,
    lineHeight: 18,
    fontStyle: 'italic',
    color: adminUi.textMuted,
  },
  traceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: adminUi.borderSoft,
    backgroundColor: adminUi.surfaceSoft,
  },
  traceText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    color: adminUi.textMuted,
  },
});
