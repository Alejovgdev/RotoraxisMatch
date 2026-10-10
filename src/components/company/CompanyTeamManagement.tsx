// Equipo de la empresa (rediseño, fase 3; maquetas W-Team y W-D-Team;
// respuesta 8 de la revisión).
//
// La LÓGICA es la de siempre y está intacta: cargar miembros, invitar (nombre
// opcional), cambiar rol, editar el nombre y quitar a alguien, re-comprobando
// en cada escritura que quien actúa sigue siendo admin y que la empresa no se
// queda sin admin ("A company must have at least one admin."). Lo que cambia
// es el aspecto: las acciones de un miembro y la invitación van en hojas
// inferiores en móvil y en ventanas centradas en escritorio (BottomSheet), y
// quitar a alguien pide confirmación con el diálogo común.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { ChevronDown, UserPlus } from 'lucide-react-native';
import { Avatar, BottomSheet, Text, TextInput, useConfirmDialog } from '../ui';
import { companyRepositoryV2 } from '../../repositories/v2/companyRepositoryV2';
import { canManageCompanyMembers } from '../../utils/companyPermissionsV2';
import { useCompanySession } from '../../state/SessionContext';
import type { CompanyMember } from '../../types/company';
import type { CompanyMemberRole } from '../../types/enums';
import { colors } from '../../theme';
import { TOUCH_TARGET } from '../../theme/ui';
import { notify } from '../../utils/platformAlert';
import {
  CARD_BORDER,
  DesktopTitle,
  LoadingBlock,
  NoticeBox,
  PageBar,
  PageBody,
  PageSubtitle,
  PillButton,
  SectionTitle,
  StatGrid,
  StatTile,
  StatusPill,
} from './CompanyPage';
import { RolePill, ROLE_LABELS } from './CompanyAccount';

const ROLE_HINTS: Record<CompanyMemberRole, string> = {
  admin: 'Can manage members and operational workflows.',
  recruiter: 'Can work offers, applications, direct offers and chats.',
  viewer: 'Read-only access to company workspace data.',
};

const LAST_ADMIN_MESSAGE = 'A company must have at least one admin.';
const ADMIN_ONLY_MESSAGE = 'Only company admins can manage members.';
const SELF_REMOVE_MESSAGE = 'You cannot remove your own company membership from this screen.';
const INVITE_ROLES: CompanyMemberRole[] = ['recruiter', 'viewer', 'admin'];
const ALL_ROLES: CompanyMemberRole[] = ['admin', 'recruiter', 'viewer'];

// iOS no presenta un Modal mientras otro se está cerrando: el siguiente
// (confirmación, editar nombre) espera a que la hoja termine de irse.
const AFTER_SHEET_MS = Platform.OS === 'ios' ? 350 : 0;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function memberDisplayName(member: CompanyMember): string {
  return member.displayName?.trim() || member.email || 'Unnamed member';
}

export function CompanyTeamManagement({
  companyName,
  wide,
  onBack,
}: {
  companyName: string;
  wide: boolean;
  /** Flecha de atrás de la cabecera en móvil. */
  onBack?: () => void;
}) {
  const companySession = useCompanySession();
  const companyId = companySession?.companyId;
  const profileId = companySession?.profileId;
  const companyMemberRole = companySession?.companyMemberRole;
  const [members, setMembers] = useState<CompanyMember[]>([]);
  const [currentMember, setCurrentMember] = useState<CompanyMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<string | null>(null);
  const { confirm, dialog } = useConfirmDialog();

  // Invite modal state
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<CompanyMemberRole>('recruiter');
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccessMessage, setInviteSuccessMessage] = useState<string | null>(null);

  // Member sheet (role + actions)
  const [sheetMemberId, setSheetMemberId] = useState<string | null>(null);

  // Edit name modal state
  const [editNameTarget, setEditNameTarget] = useState<CompanyMember | null>(null);
  const [editNameValue, setEditNameValue] = useState('');

  const load = useCallback(async (): Promise<CompanyMember[]> => {
    if (!companyId) {
      setMembers([]);
      setCurrentMember(null);
      return [];
    }
    const all = await companyRepositoryV2.getMembers(companyId);
    setMembers(all);
    setCurrentMember(all.find((m) => m.userId === profileId) ?? null);
    return all;
  }, [companyId, profileId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    load()
      .catch((error) => {
        if (active) {
          notify('Team members unavailable', errorMessage(error, 'Could not load company members.'));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [load]);

  function openInviteModal() {
    setInviteName('');
    setInviteEmail('');
    setInviteRole('recruiter');
    setInviteError(null);
    setInviteSuccessMessage(null);
    setInviteModalVisible(true);
  }

  function closeInviteModal() {
    if (inviteSubmitting) return;
    setInviteModalVisible(false);
    setInviteError(null);
  }

  async function doInviteMember() {
    if (!companyId) {
      setInviteError('Your company membership could not be resolved.');
      return;
    }

    const email = inviteEmail.trim().toLowerCase();
    if (!isValidEmail(email)) {
      setInviteError('Enter a valid email address.');
      return;
    }

    setInviteSubmitting(true);
    setInviteError(null);
    try {
      const freshMembers = await load();
      const actingMember = freshMembers.find((m) => m.userId === profileId);
      if (!actingMember || !canManageCompanyMembers(actingMember.role)) {
        throw new Error(ADMIN_ONLY_MESSAGE);
      }

      await companyRepositoryV2.addMember(companyId, email, inviteRole, inviteName.trim() || undefined);
      await load();
      setInviteModalVisible(false);
      setInviteName('');
      setInviteEmail('');
      setInviteRole('recruiter');
      setInviteSuccessMessage('Invitation sent. The user must open the email and set a password before signing in.');
    } catch (error) {
      setInviteError(errorMessage(error, 'Could not invite member.'));
    } finally {
      setInviteSubmitting(false);
    }
  }

  async function doChangeRole(member: CompanyMember, newRole: CompanyMemberRole) {
    if (!companyId) {
      notify('Error', 'Your company membership could not be resolved.');
      return;
    }

    setActioning(member.id);
    try {
      const freshMembers = await load();
      const actingMember = freshMembers.find((m) => m.userId === profileId);
      if (!actingMember || !canManageCompanyMembers(actingMember.role)) {
        throw new Error(ADMIN_ONLY_MESSAGE);
      }

      const target = freshMembers.find((m) => m.id === member.id);
      if (!target) throw new Error('Member could not be found in your company.');

      if (target.role === 'admin' && newRole !== 'admin') {
        const adminCount = freshMembers.filter((m) => m.role === 'admin').length;
        if (adminCount <= 1) throw new Error(LAST_ADMIN_MESSAGE);
      }

      await companyRepositoryV2.updateMemberRole(companyId, target.id, newRole);
      await load();
    } catch (error) {
      notify('Error', errorMessage(error, 'Could not change role.'));
    } finally {
      setActioning(null);
    }
  }

  async function doRemoveMember(member: CompanyMember) {
    if (!companyId) {
      notify('Error', 'Your company membership could not be resolved.');
      return;
    }

    setActioning(member.id);
    try {
      const freshMembers = await load();
      const actingMember = freshMembers.find((m) => m.userId === profileId);
      if (!actingMember || !canManageCompanyMembers(actingMember.role)) {
        throw new Error(ADMIN_ONLY_MESSAGE);
      }

      const target = freshMembers.find((m) => m.id === member.id);
      if (!target) throw new Error('Member could not be found in your company.');

      if (target.role === 'admin') {
        const adminCount = freshMembers.filter((m) => m.role === 'admin').length;
        if (adminCount <= 1) throw new Error(LAST_ADMIN_MESSAGE);
      }

      await companyRepositoryV2.removeMember(companyId, target.id);
      await load();
    } catch (error) {
      notify('Error', errorMessage(error, 'Could not remove member.'));
    } finally {
      setActioning(null);
    }
  }

  async function doEditName(member: CompanyMember, newName: string) {
    if (!companyId) {
      notify('Error', 'Your company membership could not be resolved.');
      return;
    }

    setActioning(member.id);
    try {
      await companyRepositoryV2.updateMemberName(companyId, member.id, newName);
      await load();
    } catch (error) {
      notify('Error', errorMessage(error, 'Could not update member name.'));
    } finally {
      setActioning(null);
    }
  }

  // ── Acciones de la hoja de un miembro ──────────────────────────────────

  function openEditName(member: CompanyMember) {
    setSheetMemberId(null);
    setTimeout(() => {
      setEditNameValue(member.displayName ?? '');
      setEditNameTarget(member);
    }, AFTER_SHEET_MS);
  }

  function askRemove(member: CompanyMember, isLastAdmin: boolean, isCurrentUser: boolean) {
    if (isLastAdmin) {
      notify('Cannot remove member', LAST_ADMIN_MESSAGE);
      return;
    }
    if (isCurrentUser) {
      notify('Cannot remove member', SELF_REMOVE_MESSAGE);
      return;
    }
    setSheetMemberId(null);
    setTimeout(async () => {
      const confirmed = await confirm({
        title: 'Remove member?',
        message: `Remove ${memberDisplayName(member)} from the company team.`,
        confirmLabel: 'Remove member',
        destructive: true,
      });
      if (confirmed) doRemoveMember(member);
    }, AFTER_SHEET_MS);
  }

  if (loading) {
    return wide ? <LoadingBlock /> : (
      <>
        {onBack ? <PageBar title="Team access" large onBack={onBack} /> : null}
        <LoadingBlock />
      </>
    );
  }

  const currentRole = currentMember?.role ?? companyMemberRole;
  const isAdmin = canManageCompanyMembers(currentRole);

  if (!isAdmin) return null;

  const adminCount = members.filter((m) => m.role === 'admin').length;
  const recruiterCount = members.filter((m) => m.role === 'recruiter').length;
  const viewerCount = members.filter((m) => m.role === 'viewer').length;
  const subtitle = `${companyName} · ${members.length} member${members.length !== 1 ? 's' : ''}`;
  const sheetMember = sheetMemberId ? members.find((m) => m.id === sheetMemberId) ?? null : null;

  const header = wide ? (
    <DesktopTitle
      title="Team access"
      subtitle={subtitle}
      right={<PillButton label="Invite teammate" icon={UserPlus} size="md" onPress={openInviteModal} />}
    />
  ) : (
    <View style={styles.mobileHeader}>
      {onBack ? (
        <PageBar
          title="Team access"
          large
          onBack={onBack}
          right={<PillButton label="Invite" icon={UserPlus} size="sm" onPress={openInviteModal} />}
        />
      ) : null}
      <PageSubtitle>{subtitle}</PageSubtitle>
    </View>
  );

  const body = (
    <View style={styles.body}>
      {inviteSuccessMessage ? (
        <NoticeBox tone="success" title="Invitation sent">{inviteSuccessMessage}</NoticeBox>
      ) : null}

      <StatGrid columns={3}>
        <StatTile big label="Admins" value={adminCount} />
        <StatTile big label="Recruiters" value={recruiterCount} />
        <StatTile big label="Viewers" value={viewerCount} />
      </StatGrid>

      <View style={styles.section}>
        {!wide ? <SectionTitle>Members</SectionTitle> : null}
        <View style={styles.memberList}>
          {members.map((member, i) => {
            const isCurrentUser = member.userId === profileId;
            const isLastAdmin = member.role === 'admin' && adminCount <= 1;
            return (
              <MemberRow
                key={member.id}
                member={member}
                wide={wide}
                last={i === members.length - 1}
                isCurrentUser={isCurrentUser}
                isLastAdmin={isLastAdmin}
                busy={actioning === member.id}
                onOpen={() => setSheetMemberId(member.id)}
                onEditName={() => openEditName(member)}
                onRemove={() => askRemove(member, isLastAdmin, isCurrentUser)}
              />
            );
          })}
        </View>
      </View>

      <View style={[styles.roles, wide && styles.rolesWide]}>
        {!wide ? <Text style={styles.rolesTitle}>What each role can do</Text> : null}
        {ALL_ROLES.map((role) => (
          <View key={role} style={wide ? styles.roleCard : styles.roleItem}>
            <Text style={styles.roleName}>{ROLE_LABELS[role]}</Text>
            <Text style={styles.roleHint}>{ROLE_HINTS[role]}</Text>
          </View>
        ))}
      </View>
    </View>
  );

  return (
    <>
      {header}
      {/* En móvil la cabecera queda fija y sólo se desplaza el contenido. */}
      {wide ? body : <PageBody wide={false} gap={20}>{body}</PageBody>}

      {/* Un miembro: rol, nombre y quitar. */}
      <MemberSheet
        member={sheetMember}
        isCurrentUser={sheetMember?.userId === profileId}
        isLastAdmin={sheetMember ? sheetMember.role === 'admin' && adminCount <= 1 : false}
        busy={sheetMember ? actioning === sheetMember.id : false}
        onClose={() => setSheetMemberId(null)}
        onPickRole={(role) => { if (sheetMember && role !== sheetMember.role) doChangeRole(sheetMember, role); }}
        onEditName={() => { if (sheetMember) openEditName(sheetMember); }}
        onRemove={() => {
          if (!sheetMember) return;
          askRemove(sheetMember, sheetMember.role === 'admin' && adminCount <= 1, sheetMember.userId === profileId);
        }}
      />

      {/* Invitar */}
      <BottomSheet
        visible={inviteModalVisible}
        onClose={closeInviteModal}
        dismissible={!inviteSubmitting}
        title="Invite member"
        subtitle="Send access to a company user."
        footer={(
          <>
            <PillButton label="Send invite" onPress={doInviteMember} loading={inviteSubmitting} />
            <PillButton label="Cancel" variant="outline" size="md" onPress={closeInviteModal} disabled={inviteSubmitting} />
          </>
        )}
      >
        <SheetField label="Name" optional>
          <TextInput
            style={styles.input}
            value={inviteName}
            onChangeText={setInviteName}
            placeholder="e.g. Maria García"
            placeholderTextColor={colors.placeholder}
            maxLength={100}
            autoCapitalize="words"
            autoCorrect={false}
            editable={!inviteSubmitting}
            accessibilityLabel="Name (optional)"
          />
        </SheetField>
        <SheetField label="Email">
          <TextInput
            style={styles.input}
            value={inviteEmail}
            onChangeText={setInviteEmail}
            placeholder="name@company.com"
            placeholderTextColor={colors.placeholder}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!inviteSubmitting}
            accessibilityLabel="Email"
          />
        </SheetField>
        <SheetField label="Role">
          <RoleSegment
            roles={INVITE_ROLES}
            value={inviteRole}
            onChange={setInviteRole}
            disabled={inviteSubmitting}
          />
        </SheetField>
        {inviteError ? <Text style={styles.error}>{inviteError}</Text> : null}
      </BottomSheet>

      {/* Editar nombre */}
      <BottomSheet
        visible={editNameTarget !== null}
        onClose={() => setEditNameTarget(null)}
        title="Edit name"
        subtitle={`Display name for ${editNameTarget?.email ?? editNameTarget?.userId ?? 'this member'}.`}
        footer={(
          <>
            <PillButton
              label="Save name"
              onPress={() => {
                const target = editNameTarget;
                setEditNameTarget(null);
                if (target) doEditName(target, editNameValue);
              }}
            />
            <PillButton label="Cancel" variant="outline" size="md" onPress={() => setEditNameTarget(null)} />
          </>
        )}
      >
        <SheetField label="Name">
          <TextInput
            style={styles.input}
            value={editNameValue}
            onChangeText={setEditNameValue}
            placeholder="e.g. Maria García"
            placeholderTextColor={colors.placeholder}
            maxLength={100}
            autoCapitalize="words"
            autoCorrect={false}
            accessibilityLabel="Name"
          />
        </SheetField>
      </BottomSheet>

      {dialog}
    </>
  );
}

function MemberRow({
  member,
  wide,
  last,
  isCurrentUser,
  isLastAdmin,
  busy,
  onOpen,
  onEditName,
  onRemove,
}: {
  member: CompanyMember;
  wide: boolean;
  last: boolean;
  isCurrentUser: boolean;
  isLastAdmin: boolean;
  busy: boolean;
  onOpen: () => void;
  onEditName: () => void;
  onRemove: () => void;
}) {
  const name = memberDisplayName(member);
  const sub = wide
    ? [member.email, `added ${formatDate(member.createdAt)}`].filter(Boolean).join(' · ')
    : [isCurrentUser ? 'You' : null, member.email, `Added ${formatDate(member.createdAt)}`].filter(Boolean).join(' · ');

  if (!wide) {
    return (
      <Pressable
        onPress={onOpen}
        style={({ pressed, hovered }: any) => [styles.member, !last && styles.memberLine, (pressed || hovered) && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${ROLE_LABELS[member.role]}. Manage`}
      >
        <Avatar kind="person" size={46} name={name} />
        <View style={styles.memberCopy}>
          <Text style={styles.memberName} numberOfLines={1}>{name}</Text>
          <Text style={styles.memberSub} numberOfLines={1}>{sub}</Text>
        </View>
        {busy ? <ActivityIndicator size="small" color={colors.primary} /> : <RolePill role={member.role} />}
      </Pressable>
    );
  }

  return (
    <View style={[styles.memberWide, !last && styles.memberLine]}>
      <Avatar kind="person" size={48} name={name} />
      <View style={styles.memberCopyWide}>
        <View style={styles.memberNameRow}>
          <Text style={styles.memberNameWide} numberOfLines={1}>{name}</Text>
          {isCurrentUser ? <StatusPill label="You" tone="info" /> : null}
        </View>
        <Text style={styles.memberSub} numberOfLines={1}>{sub}</Text>
      </View>
      <Pressable
        onPress={onOpen}
        disabled={busy}
        style={({ hovered }: any) => [styles.roleButton, hovered && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`Role: ${ROLE_LABELS[member.role]}. Change role`}
      >
        {busy ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.roleButtonText}>{ROLE_LABELS[member.role]}</Text>}
        <ChevronDown color={colors.text} size={16} strokeWidth={2.2} />
      </Pressable>
      <Pressable onPress={onEditName} disabled={busy} style={styles.linkButton} accessibilityRole="button">
        <Text style={styles.linkButtonText}>Edit name</Text>
      </Pressable>
      {isLastAdmin ? (
        <Text style={styles.lastAdmin}>Last admin</Text>
      ) : (
        <Pressable onPress={onRemove} disabled={busy} style={styles.linkButton} accessibilityRole="button" accessibilityLabel={`Remove ${name}`}>
          <Text style={[styles.linkButtonText, isCurrentUser ? styles.linkMuted : styles.linkDanger]}>Remove</Text>
        </Pressable>
      )}
    </View>
  );
}

function MemberSheet({
  member,
  isCurrentUser,
  isLastAdmin,
  busy,
  onClose,
  onPickRole,
  onEditName,
  onRemove,
}: {
  member: CompanyMember | null;
  isCurrentUser: boolean;
  isLastAdmin: boolean;
  busy: boolean;
  onClose: () => void;
  onPickRole: (role: CompanyMemberRole) => void;
  onEditName: () => void;
  onRemove: () => void;
}) {
  const name = member ? memberDisplayName(member) : '';
  return (
    <BottomSheet
      visible={member !== null}
      onClose={onClose}
      footer={(
        <>
          <PillButton label="Edit name" variant="outline" size="md" onPress={onEditName} disabled={busy} />
          {isLastAdmin ? (
            <PillButton label="Last admin can't be removed" variant="outline" size="md" disabled />
          ) : isCurrentUser ? (
            <PillButton label="Remove from team" variant="outline" size="md" disabled />
          ) : (
            <PillButton label="Remove from team" variant="danger" size="md" onPress={onRemove} disabled={busy} />
          )}
          {isCurrentUser && !isLastAdmin ? <Text style={styles.sheetNote}>{SELF_REMOVE_MESSAGE}</Text> : null}
          <PillButton label="Done" size="md" onPress={onClose} />
        </>
      )}
    >
      {member ? (
        <>
          <View style={styles.sheetWho}>
            <Avatar kind="person" size={48} name={name} />
            <View style={styles.memberCopy}>
              <Text style={styles.sheetName} numberOfLines={1}>{name}</Text>
              {member.email ? <Text style={styles.memberSub} numberOfLines={1}>{member.email}</Text> : null}
            </View>
          </View>
          <SheetField label="Role">
            <RoleSegment
              roles={ALL_ROLES}
              value={member.role}
              onChange={onPickRole}
              disabled={busy}
              // El último admin no puede dejar de serlo (la misma regla que
              // re-comprueba doChangeRole antes de escribir).
              lockedRoles={isLastAdmin ? ['recruiter', 'viewer'] : []}
            />
            {isLastAdmin ? <Text style={styles.sheetNote}>{LAST_ADMIN_MESSAGE}</Text> : null}
            {busy ? <ActivityIndicator color={colors.primary} /> : null}
          </SheetField>
          <Text style={styles.sheetNote}>{ROLE_HINTS[member.role]}</Text>
        </>
      ) : null}
    </BottomSheet>
  );
}

function SheetField({ label, optional = false, children }: { label: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label}
        {optional ? <Text style={styles.optional}> (optional)</Text> : null}
      </Text>
      {children}
    </View>
  );
}

function RoleSegment({
  roles,
  value,
  onChange,
  disabled = false,
  lockedRoles = [],
}: {
  roles: CompanyMemberRole[];
  value: CompanyMemberRole;
  onChange: (role: CompanyMemberRole) => void;
  disabled?: boolean;
  lockedRoles?: CompanyMemberRole[];
}) {
  return (
    <View style={styles.segment} accessibilityRole="radiogroup">
      {roles.map((role) => {
        const on = role === value;
        const locked = lockedRoles.includes(role);
        return (
          <Pressable
            key={role}
            onPress={() => onChange(role)}
            disabled={disabled || locked}
            style={[styles.segmentOption, on && styles.segmentOptionOn]}
            accessibilityRole="radio"
            accessibilityState={{ checked: on, disabled: disabled || locked }}
          >
            <Text style={[styles.segmentText, on && styles.segmentTextOn, locked && styles.segmentTextLocked]}>
              {ROLE_LABELS[role]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  mobileHeader: {
    gap: 0,
  },
  body: {
    gap: 20,
  },
  section: {
    gap: 8,
  },
  memberList: {
    borderWidth: 1,
    borderColor: '#DDE5EC',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  memberWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 16,
    rowGap: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  memberLine: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  pressed: {
    backgroundColor: colors.surfaceSoft,
  },
  memberCopy: {
    flex: 1,
    minWidth: 0,
  },
  memberCopyWide: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 220,
    minWidth: 0,
  },
  memberNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  memberName: {
    fontSize: 15.5,
    fontWeight: '800',
    color: colors.text,
  },
  memberNameWide: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  memberSub: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  roleButton: {
    minHeight: 42,
    paddingLeft: 14,
    paddingRight: 12,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  roleButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  linkButton: {
    minHeight: 42,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  linkButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  linkDanger: {
    color: colors.error,
  },
  linkMuted: {
    color: colors.disabledText,
  },
  lastAdmin: {
    paddingHorizontal: 10,
    fontSize: 14,
    fontWeight: '700',
    color: colors.disabledText,
  },
  roles: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#F5F7F9',
    gap: 10,
  },
  rolesWide: {
    padding: 0,
    backgroundColor: 'transparent',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  rolesTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  roleItem: {
    gap: 2,
  },
  roleCard: {
    flexGrow: 1,
    flexBasis: 200,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#F5F7F9',
    gap: 4,
  },
  roleName: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  roleHint: {
    fontSize: 13.5,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  sheetWho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sheetName: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
  },
  sheetNote: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  field: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  optional: {
    fontWeight: '600',
    color: colors.textMuted,
  },
  input: {
    minHeight: 50,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    fontSize: 15.5,
    color: colors.text,
  },
  segment: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: 16,
    backgroundColor: colors.surfaceMuted,
  },
  segmentOption: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentOptionOn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  segmentText: {
    fontSize: 14.5,
    fontWeight: '800',
    color: colors.textSecondary,
  },
  segmentTextOn: {
    color: colors.text,
  },
  segmentTextLocked: {
    color: '#A9B6C3',
  },
  error: {
    fontSize: 13.5,
    lineHeight: 19,
    fontWeight: '700',
    color: colors.error,
  },
});
