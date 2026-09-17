import { AircraftRatingIndex } from '../constants/aircraftTypeRatings';
import { credentialLabel } from '../constants/licenses';
import { EngineCatalog } from '../types/catalog';
import { HeldLicense } from './profileLicenses';
import { individualTypeRatingScopeError, IndividualRatingScopeError } from './individualTypeRatingScope';

export interface HabilitationCredential {
  authority: string;
  licenseCode: string;
  aircraftTypeRatingId: string;
}
export type HabilitationProblem = IndividualRatingScopeError | 'missing_license' | 'rating';

export function habilitationScopeMessage(entry: HabilitationCredential, label: string, reason: HabilitationProblem): string {
  const credential = credentialLabel(entry.authority, entry.licenseCode);
  const rating = `“${label}”`;
  if (reason === 'missing_license') {
    return `${rating} is still linked to ${credential}. Keep that licence selected or remove this habilitation before saving. Selecting another licence does not transfer the rating.`;
  }
  if (reason === 'rating') return `${rating} could not be found in the aircraft catalog. Reload the profile before saving.`;
  if (reason === 'unknown_propulsion') {
    return `We cannot confirm the propulsion of ${rating} for ${credential}. Retry the engine catalog or request a catalog review before saving.`;
  }
  const limitation = reason === 'category' ? 'this licence does not carry individual type ratings'
    : reason === 'product' ? `this licence covers ${['B1.1', 'B1.2'].includes(entry.licenseCode) ? 'aeroplanes' : 'helicopters'}`
    : `this licence covers ${['B1.2', 'B1.4'].includes(entry.licenseCode) ? 'piston' : 'turbine'}-powered aircraft`;
  return `${rating} cannot be saved under ${credential}: ${limitation}. Keep it under the licence that endorses it, or remove this habilitation before saving.`;
}

export interface HabilitationIssue {
  reason: HabilitationProblem;
  message: string;
  /** True when the verdict depends on a catalog that has not loaded, so it says
   * "we cannot tell", not "this is wrong". Only blocks a save that actually
   * rewrites the habilitations — see `blockingHabilitationIssues`. */
  unverifiable: boolean;
}

export function profileHabilitationIssues(
  entries: readonly HabilitationCredential[], held: readonly HeldLicense[],
  ratings: AircraftRatingIndex, engines: ReadonlyMap<string, EngineCatalog>,
): HabilitationIssue[] {
  return entries.flatMap((entry, i) => {
    const rating = ratings.get(entry.aircraftTypeRatingId);
    const reason = !held.some((l) => l.authority === entry.authority && l.code === entry.licenseCode)
      ? 'missing_license' : !rating ? 'rating'
        : individualTypeRatingScopeError(entry.authority, entry.licenseCode, rating, engines);
    if (!reason) return [];
    return [{
      reason,
      message: habilitationScopeMessage(entry, rating?.displayName ?? `Habilitation ${i + 1}`, reason),
      // 'rating' and 'unknown_propulsion' both mean "a catalog did not answer":
      // the aircraft catalog and the engine catalog respectively. Neither is
      // evidence that the stored row is wrong.
      unverifiable: reason === 'unknown_propulsion' || reason === 'rating',
    }];
  });
}

/**
 * Las que de verdad impiden guardar.
 *
 * Un fallo del catálogo de motores no puede bloquear el perfil ENTERO: el
 * teléfono, la disponibilidad y los años no dependen de él. Mientras las
 * habilitaciones no se reescriban (`willWriteHabilitations`), una habilitación
 * que no se puede verificar no se manda a la base y por tanto no puede ser
 * rechazada — no hay nada que impedir. Lo que sí bloquea siempre es un
 * problema determinable: una credencial deseleccionada que aún sostiene una
 * habilitación, o una combinación incompatible.
 */
export function blockingHabilitationIssues(
  issues: readonly HabilitationIssue[], willWriteHabilitations: boolean,
): HabilitationIssue[] {
  return issues.filter((issue) => willWriteHabilitations || !issue.unverifiable);
}

export function profileHabilitationProblems(
  entries: readonly HabilitationCredential[], held: readonly HeldLicense[],
  ratings: AircraftRatingIndex, engines: ReadonlyMap<string, EngineCatalog>,
): string[] {
  return profileHabilitationIssues(entries, held, ratings, engines).map((issue) => issue.message);
}

export function isHabilitationScopeRejection(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && (!error.code || error.code === '23514') && [
    'Individual type rating is outside the licence scope.',
    'Existing type rating is outside the new licence scope.',
  ].includes(error.message ?? ''));
}

/** Diagnose against 083 after a rejection, even if the client's catalog was stale.
 * Diagnostics are read-only. Never retry a failed write automatically. */
export async function explainHabilitationScopeRejection(
  entries: readonly HabilitationCredential[],
  loadLabels: () => Promise<AircraftRatingIndex>,
  diagnose: (entry: HabilitationCredential) => Promise<string | null>,
): Promise<string> {
  const [labels, diagnostics] = await Promise.all([
    loadLabels().catch((): AircraftRatingIndex => new Map()),
    Promise.allSettled(entries.map(diagnose)),
  ]);
  const knownReasons = new Set(['category', 'product', 'propulsion', 'unknown_propulsion', 'rating']);
  const messages = entries.flatMap((entry, i) => {
    const diagnostic = diagnostics[i];
    const reason = diagnostic.status === 'fulfilled' ? diagnostic.value : null;
    return typeof reason === 'string' && knownReasons.has(reason)
      ? [habilitationScopeMessage(entry, labels.get(entry.aircraftTypeRatingId)?.displayName ?? `Habilitation ${i + 1}`, reason as HabilitationProblem)] : [];
  });
  if (messages.length) return messages.join('\n');
  const candidates = entries.map((entry, i) => `“${labels.get(entry.aircraftTypeRatingId)?.displayName ?? `Habilitation ${i + 1}`}” (${credentialLabel(entry.authority, entry.licenseCode)})`);
  return `The licence and habilitation combination was rejected. We could not confirm which rating caused it. Review ${candidates.join(', ') || 'your habilitations'} and reload the profile before trying again.`;
}
