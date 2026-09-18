// Las reglas del formulario de oferta, puras (Fase 10, paso 5b).
//
// Crear y editar una oferta comparten TODAS las transiciones —qué se limpia al
// cambiar de clase, de autoridad, de licencia— y difieren sólo en si preguntan
// antes (editar confirma lo que ya está guardado; crear repinta sin aviso).
// Aquí vive lo compartido, y cada pantalla pone su diálogo delante. Antes de
// este paso cada pantalla tenía su copia de cada transición; con tres campos
// nuevos acoplados entre sí, dos copias habrían divergido en la primera
// semana.
//
// El repositorio NO confía en esto: comprueba el estado resultante por su cuenta
// (offerRepository.assertOfferWritable) y la base, por la suya. Esto decide lo
// que la pantalla enseña y deja elegir.
import { OfferKind, OfferProductType } from '../types/offer';
import { AuthorityCode, AuthorityLicenseCode, TechnicianTypeCode } from '../types/catalog';
import { ENGINE_TECHNICIAN_TYPE_CODE, isLicensedTechnicianType } from '../constants/technicianTypes';
import {
  PART66_AUTHORITIES,
  licensesSelectableForOffer,
} from '../constants/licenses';
import { isLicenseCompatibleWithProductType } from './licenseCategoryProductType';
import { offerAircraftAreExperience } from './offerShape';

export interface OfferRequirementsForm {
  offerKind: OfferKind;
  requiredEngineId?: string;
  productType: OfferProductType;
  technicianType: TechnicianTypeCode;
  requiresCertification: boolean;
  licenseAuthority?: AuthorityCode;
  licenseCode?: AuthorityLicenseCode;
  acceptsEquivalent: boolean;
  onlyUnlicensed: boolean;
  requiresAllAircraft: boolean;
  requiredHabilitations: { aircraftTypeRatingId: string; notes?: string }[];
}

// El oficio al que vuelve una oferta que deja de ser de motor: el primero del
// catálogo. `engine_technician` describe una oferta de motor; en una de
// aeronave sería elegirlo por la empresa sin que lo haya elegido.
const DEFAULT_AIRCRAFT_TECHNICIAN_TYPE: TechnicianTypeCode = 'mechanic';

const CLEARED_AIRCRAFT = { requiredHabilitations: [], requiresAllAircraft: false };

// ── Qué se enseña ─────────────────────────────────────────────────────────

/**
 * La pregunta de la licencia: en ofertas de aeronave de un oficio con
 * licencias y, desde la sesión 2, en toda oferta de motor, donde es opcional
 * (el oficio de una oferta de motor no dice nada de lo que pide).
 */
export function showsCertificationQuestion(form: OfferRequirementsForm): boolean {
  return form.offerKind === 'engine' || isLicensedTechnicianType(form.technicianType);
}

/**
 * El texto de esa pregunta, para las dos pantallas. En motor la licencia es
 * opcional y sólo puntúa (sesión 2), y decir "licence required" allí sería
 * prometer un filtro que no existe.
 */
export function certificationQuestionCopy(form: OfferRequirementsForm): { title: string; helper: string; yes: string; no: string } {
  if (form.offerKind === 'engine') {
    return {
      title: 'Should candidates hold a licence?',
      helper: form.requiresCertification
        ? 'Optional on engine work: a Part-66 B1 licence or an FAA P or A&P. Holding it adds to the score, the engine still counts most, and nobody is excluded for lacking it.'
        : 'No licence asked for. Candidates are matched on the engine.',
      yes: 'Yes, ask for a licence',
      no: 'No licence needed',
    };
  }
  return {
    title: 'Does this job need certified work?',
    helper: form.requiresCertification
      ? 'Yes — the technician must hold a valid licence to sign off the work. You can require a licence and type ratings below.'
      : 'No — you are hiring for hands-on work, not for signing it off. No licence or type rating can be required.',
    yes: 'Yes, licence required',
    no: 'No licence needed',
  };
}

/** "Sólo técnicos sin licencia": aparece cuando la oferta NO exige licencia, en aeronave y en motor. */
export function showsOnlyUnlicensed(form: OfferRequirementsForm): boolean {
  return !form.requiresCertification;
}

/** Autoridad y licencia: sólo si la oferta pide licencia (y, en aeronave, si su oficio las tiene). */
export function showsLicenseSection(form: OfferRequirementsForm): boolean {
  return form.requiresCertification && showsCertificationQuestion(form);
}

/** "Acepto equivalentes": sólo con una autoridad Part-66 elegida (la FAA no cruza con nadie). */
export function showsAcceptsEquivalent(form: OfferRequirementsForm): boolean {
  return showsLicenseSection(form) && Boolean(form.licenseAuthority) && PART66_AUTHORITIES.includes(form.licenseAuthority as AuthorityCode);
}

/**
 * Las aeronaves: nunca en motor. Certificando bajo la FAA sí desde la sesión 2,
 * como experiencia y no como type ratings (offerAircraftAreExperience).
 */
export function showsAircraftEditor(form: OfferRequirementsForm): boolean {
  return form.offerKind !== 'engine';
}

/** Las licencias que ofrecen los chips: clase, oficio, autoridad y producto. Sin autoridad, ninguna. */
export function selectableLicenses(form: OfferRequirementsForm): AuthorityLicenseCode[] {
  if (!form.licenseAuthority) return [];
  return licensesSelectableForOffer(form, form.licenseAuthority).filter((code) =>
    isLicenseCompatibleWithProductType(code, form.productType),
  );
}

/** Las autoridades que tienen algo que ofrecer a este oficio y producto. */
export function selectableAuthorities(form: OfferRequirementsForm, all: readonly AuthorityCode[]): AuthorityCode[] {
  return all.filter((authority) => selectableLicenses({ ...form, licenseAuthority: authority }).length > 0);
}

// ── Transiciones ──────────────────────────────────────────────────────────

export function selectOfferKind<T extends OfferRequirementsForm>(form: T, kind: OfferKind): T {
  if (kind === form.offerKind) return form;
  // Una oferta de motor pide UN motor y ninguna aeronave (076). El oficio no
  // puntúa en ella, pero la columna es NOT NULL: se nombra el oficio de motor.
  // Una oferta de aeronave no nombra motor (077), y el oficio de motor no se
  // queda en ella.
  const moved: T = kind === 'engine'
    ? { ...form, offerKind: 'engine', technicianType: ENGINE_TECHNICIAN_TYPE_CODE, ...CLEARED_AIRCRAFT }
    : {
        ...form,
        offerKind: 'aircraft',
        requiredEngineId: undefined,
        technicianType: form.technicianType === ENGINE_TECHNICIAN_TYPE_CODE ? DEFAULT_AIRCRAFT_TECHNICIAN_TYPE : form.technicianType,
      };
  // Sesión 2: la licencia sobrevive al cambio de clase si la clase nueva puede
  // pedirla (una B1.1 vale para las dos; una B2 no vale para motor). Si no, se
  // va con su autoridad y sus equivalencias, y la oferta queda sin licencia.
  const licenseStays = Boolean(form.licenseCode) && selectableLicenses(moved).includes(form.licenseCode as AuthorityLicenseCode);
  if (licenseStays) return moved;
  return { ...moved, requiresCertification: false, licenseAuthority: undefined, licenseCode: undefined, acceptsEquivalent: false };
}

export function setRequiresCertification<T extends OfferRequirementsForm>(form: T, next: boolean): T {
  if (next === form.requiresCertification) return form;
  if (next) {
    // Volver a "Yes, licence required" desmarca "sólo sin licencia": las dos
    // cosas juntas son una oferta que nadie puede cumplir (077).
    return { ...form, requiresCertification: true, onlyUnlicensed: false };
  }
  // Fase 6 tanda E: apagar se lleva la LICENCIA (y ahora su autoridad y las
  // equivalencias) y nada más. Las aeronaves se quedan.
  return { ...form, requiresCertification: false, licenseAuthority: undefined, licenseCode: undefined, acceptsEquivalent: false };
}

export function selectTechnicianType<T extends OfferRequirementsForm>(form: T, next: TechnicianTypeCode): T {
  if (next === form.technicianType) return form;
  if (!isLicensedTechnicianType(next)) {
    return { ...form, technicianType: next, requiresCertification: false, licenseAuthority: undefined, licenseCode: undefined, acceptsEquivalent: false };
  }
  const moved = { ...form, technicianType: next };
  // La autoridad sobrevive si tiene algo que ofrecer al oficio nuevo (la FAA no
  // tiene nada para aviónica); la licencia, si ese oficio puede pedirla.
  const authorityStays = !form.licenseAuthority || licensesSelectableForOffer(moved, form.licenseAuthority).length > 0;
  const licenseStays = !form.licenseCode || (authorityStays && selectableLicenses(moved).includes(form.licenseCode));
  return {
    ...moved,
    ...(authorityStays ? {} : { licenseAuthority: undefined, acceptsEquivalent: false }),
    ...(licenseStays ? {} : { licenseCode: undefined, ...CLEARED_AIRCRAFT }),
  };
}

export function selectAuthority<T extends OfferRequirementsForm>(form: T, authority: AuthorityCode): T {
  if (authority === form.licenseAuthority) return form;
  const moved = { ...form, licenseAuthority: authority };
  // Una B1.1 EASA que pasa a UK CAA sigue siendo B1.1, y sus aeronaves siguen
  // valiendo: las cuatro Part-66 comparten catálogo. Si el código no existe en
  // la autoridad nueva se va, con las aeronaves que colgaban de él.
  const licenseStays = !form.licenseCode || selectableLicenses(moved).includes(form.licenseCode);
  // Sesión 2: pasar a la FAA ya no se lleva las aeronaves por sí solo. Si había
  // licencia Part-66 se va (la FAA no emite ningún código Part-66), y con ella
  // las aeronaves que colgaban de ella; sin licencia elegida se quedan y pasan
  // a contar como experiencia.
  return {
    ...moved,
    acceptsEquivalent: PART66_AUTHORITIES.includes(authority) ? form.acceptsEquivalent : false,
    ...(licenseStays ? {} : { licenseCode: undefined, ...CLEARED_AIRCRAFT }),
  };
}

export function selectLicense<T extends OfferRequirementsForm>(form: T, code: AuthorityLicenseCode): T {
  if (code === form.licenseCode) return form;
  // Las aeronaves estaban puestas para cruzarse con la licencia anterior. Salvo
  // bajo la FAA (sesión 2): allí son experiencia, no cuelgan de la licencia, y
  // pasar de A a A&P no cambia en qué aviones hace falta haber trabajado.
  if (offerAircraftAreExperience(form)) return { ...form, licenseCode: code };
  return { ...form, licenseCode: code, ...CLEARED_AIRCRAFT };
}

export function selectProductType<T extends OfferRequirementsForm>(form: T, productType: OfferProductType): T {
  if (productType === form.productType) return form;
  return {
    ...form,
    productType,
    // Los ratings son del producto anterior: las FK compuestas de la 047 los
    // rechazarían al guardar.
    ...CLEARED_AIRCRAFT,
    licenseCode: form.licenseCode && isLicenseCompatibleWithProductType(form.licenseCode, productType) ? form.licenseCode : undefined,
  };
}

// ── Lo que una transición descarta (para que editar pueda preguntar) ─────

export interface DroppedByTransition {
  license?: string;
  aircraft: number;
}

export function droppedByTransition(prev: OfferRequirementsForm, next: OfferRequirementsForm): DroppedByTransition {
  return {
    license: prev.licenseCode && !next.licenseCode ? prev.licenseCode : undefined,
    aircraft: prev.requiredHabilitations.length > 0 && next.requiredHabilitations.length === 0 ? prev.requiredHabilitations.length : 0,
  };
}

export function describeDropped(dropped: DroppedByTransition): string | null {
  const parts: string[] = [];
  if (dropped.license) parts.push(`the ${dropped.license} licence requirement`);
  if (dropped.aircraft > 0) parts.push(`${dropped.aircraft} aircraft requirement${dropped.aircraft !== 1 ? 's' : ''}`);
  return parts.length > 0 ? parts.join(' and ') : null;
}

// ── Errores ───────────────────────────────────────────────────────────────

export interface OfferRequirementsErrors {
  authority?: string;
  license?: string;
  engine?: string;
}

export function requirementsErrors(form: OfferRequirementsForm): OfferRequirementsErrors {
  return {
    authority: showsLicenseSection(form) && !form.licenseAuthority ? 'Select the authority that issues the licence.' : undefined,
    license: showsLicenseSection(form) && !form.licenseCode ? 'Select the licence this role certifies under.' : undefined,
    engine: form.offerKind === 'engine' && !form.requiredEngineId ? 'Select the engine this role works on.' : undefined,
  };
}
