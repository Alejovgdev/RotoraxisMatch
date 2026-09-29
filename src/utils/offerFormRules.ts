// Las reglas del formulario de oferta, puras (Fase 10, paso 5b).
//
// Crear y editar una oferta comparten TODAS las transiciones —qué se limpia al
// cambiar de tipo, de autoridad, de licencia— y difieren sólo en si preguntan
// antes (editar confirma lo que ya está guardado; crear repinta sin aviso).
//
// Sesión 4 (091): la clase (aeronave/motor) ya no se elige. Sale del tipo de
// técnico —Engine Technician es la oferta de motor— y `selectTechnicianType`
// hace las dos cosas a la vez. `form.offerKind` sigue en el estado porque todo
// lo demás pregunta por él; nadie lo escribe salvo esa transición.
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
import { isLicensedTechnicianType } from '../constants/technicianTypes';
import {
  authorityLabel,
  equivalentAuthoritiesForLicense,
  faaEquivalentLicenseCodes,
  licensesSelectableForOffer,
  retainApplicableAuthorities,
} from '../constants/licenses';
import { isLicenseCompatibleWithProductType } from './licenseCategoryProductType';
import { offerAircraftAreExperience, offerKindForTechnicianType } from './offerShape';

export interface OfferRequirementsForm {
  offerKind: OfferKind;
  requiredEngineId?: string;
  productType: OfferProductType;
  technicianType: TechnicianTypeCode;
  requiresCertification: boolean;
  licenseAuthority?: AuthorityCode;
  licenseCode?: AuthorityLicenseCode;
  /** Sesión 2 (088): otras autoridades Part-66 aceptadas. Vacía = sólo la exacta. */
  acceptedAuthorities: AuthorityCode[];
  onlyUnlicensed: boolean;
  requiresAllAircraft: boolean;
  requiredHabilitations: { aircraftTypeRatingId: string; notes?: string }[];
}

const CLEARED_AIRCRAFT = { requiredHabilitations: [], requiresAllAircraft: false };

// Sesión 2: "se limpian las que ya no apliquen". Toda transición que puede
// mover la autoridad o el código termina aquí, así que ninguna puede olvidarse
// de la lista: si la licencia se va, la lista se va con ella; si cambia, se
// quedan las que siguen emitiendo ese código y no son la exigida.
function withApplicableAuthorities<T extends OfferRequirementsForm>(form: T): T {
  const acceptedAuthorities = form.requiresCertification
    ? retainApplicableAuthorities(form.acceptedAuthorities, form.licenseAuthority, form.licenseCode)
    : [];
  return acceptedAuthorities.length === form.acceptedAuthorities.length &&
    acceptedAuthorities.every((a, i) => a === form.acceptedAuthorities[i])
    ? form
    : { ...form, acceptedAuthorities };
}

// ── Qué se enseña ─────────────────────────────────────────────────────────

/**
 * El texto de ayuda de "Profile type", para las dos pantallas. Desde la sesión
 * 4 el tipo decide la clase, y la empresa tiene que ver qué cambia al elegir
 * Engine Technician antes de elegirlo.
 */
export function technicianTypeHelper(form: OfferRequirementsForm): string {
  return form.offerKind === 'engine'
    ? 'An Engine Technician offer asks for one engine and no aircraft. A licence is optional.'
    : 'One per offer. Two types in one advert are two jobs — publish them separately. Engine Technician makes this an engine offer.';
}

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

/**
 * Los chips de "Also accept licences from:" (sesión 2): las otras autoridades
 * Part-66 que emiten la categoría elegida y, desde la parte 3, la FAA si esa
 * categoría tiene equivalente FAA (no la C). Sin autoridad o sin código,
 * ninguno; con una licencia FAA, ninguno.
 */
export function acceptableAuthorities(form: OfferRequirementsForm): AuthorityCode[] {
  return equivalentAuthoritiesForLicense(form.licenseAuthority, form.licenseCode);
}

/**
 * La nota bajo los chips. Con la FAA marcada dice qué certificado FAA cuenta
 * (parte 3): "the same B1.1 category" sería falso, la FAA no emite una B1.1.
 */
export function acceptedAuthoritiesNote(form: OfferRequirementsForm): string {
  const authority = form.licenseAuthority;
  const code = form.licenseCode;
  if (!authority || !code) return '';
  const exact = authorityLabel(authority);
  if (form.acceptedAuthorities.length === 0) return `None selected: only ${exact} ${code} counts.`;
  if (!form.acceptedAuthorities.includes('FAA')) {
    return `The same ${code} category from these authorities scores slightly below an exact ${exact} match.`;
  }
  return (
    `Accepted licences score slightly below an exact ${exact} match. ` +
    `From the FAA, ${faaEquivalentLicenseCodes(code).join(' or ')} counts for ${code}.`
  );
}

/** La fila de chips sólo aparece si hay alguno que ofrecer. */
export function showsAcceptedAuthorities(form: OfferRequirementsForm): boolean {
  return showsLicenseSection(form) && acceptableAuthorities(form).length > 0;
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

export function setRequiresCertification<T extends OfferRequirementsForm>(form: T, next: boolean): T {
  if (next === form.requiresCertification) return form;
  if (next) {
    // Volver a "Yes, licence required" desmarca "sólo sin licencia": las dos
    // cosas juntas son una oferta que nadie puede cumplir (077).
    return { ...form, requiresCertification: true, onlyUnlicensed: false };
  }
  // Fase 6 tanda E: apagar se lleva la LICENCIA (y ahora su autoridad y las
  // equivalencias) y nada más. Las aeronaves se quedan.
  return withApplicableAuthorities({ ...form, requiresCertification: false, licenseAuthority: undefined, licenseCode: undefined });
}

/**
 * Elegir el tipo de técnico elige también la clase (sesión 4, 091): Engine
 * Technician ⇒ oferta de motor, cualquier otro ⇒ oferta de aeronave.
 */
export function selectTechnicianType<T extends OfferRequirementsForm>(form: T, next: TechnicianTypeCode): T {
  if (next === form.technicianType) return form;
  const offerKind: OfferKind = offerKindForTechnicianType(next);
  if (offerKind === 'engine') {
    // Una oferta de motor pide UN motor y ninguna aeronave (076). Sesión 2: la
    // licencia sobrevive si una oferta de motor puede pedirla (una B1.1 sí, una
    // B2 no). Si no, se va con su autoridad y sus equivalencias, y la oferta
    // queda sin licencia —en motor es opcional—.
    const moved: T = { ...form, offerKind, technicianType: next, ...CLEARED_AIRCRAFT };
    const licenseStays = Boolean(form.licenseCode) && selectableLicenses(moved).includes(form.licenseCode as AuthorityLicenseCode);
    if (licenseStays) return moved;
    return withApplicableAuthorities({ ...moved, requiresCertification: false, licenseAuthority: undefined, licenseCode: undefined });
  }
  // Una oferta de aeronave no nombra motor (077). Desde ahí, las reglas de
  // siempre del cambio de oficio.
  const aircraft: T = { ...form, offerKind, technicianType: next, requiredEngineId: undefined };
  if (!isLicensedTechnicianType(next)) {
    return withApplicableAuthorities({ ...aircraft, requiresCertification: false, licenseAuthority: undefined, licenseCode: undefined });
  }
  const moved = aircraft;
  // La autoridad sobrevive si tiene algo que ofrecer al oficio nuevo (la FAA no
  // tiene nada para aviónica); la licencia, si ese oficio puede pedirla.
  const authorityStays = !form.licenseAuthority || licensesSelectableForOffer(moved, form.licenseAuthority).length > 0;
  const licenseStays = !form.licenseCode || (authorityStays && selectableLicenses(moved).includes(form.licenseCode));
  return withApplicableAuthorities({
    ...moved,
    ...(authorityStays ? {} : { licenseAuthority: undefined }),
    ...(licenseStays ? {} : { licenseCode: undefined, ...CLEARED_AIRCRAFT }),
  });
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
  // a contar como experiencia. Las aceptadas se limpian: la nueva exigida sale
  // de la lista, y con la FAA la lista entera.
  return withApplicableAuthorities({
    ...moved,
    ...(licenseStays ? {} : { licenseCode: undefined, ...CLEARED_AIRCRAFT }),
  });
}

export function selectLicense<T extends OfferRequirementsForm>(form: T, code: AuthorityLicenseCode): T {
  if (code === form.licenseCode) return form;
  // Las aeronaves estaban puestas para cruzarse con la licencia anterior. Salvo
  // bajo la FAA (sesión 2): allí son experiencia, no cuelgan de la licencia, y
  // pasar de A a A&P no cambia en qué aviones hace falta haber trabajado.
  // Las aceptadas que no emiten el código nuevo se van (CASA no emite B3).
  if (offerAircraftAreExperience(form)) return withApplicableAuthorities({ ...form, licenseCode: code });
  return withApplicableAuthorities({ ...form, licenseCode: code, ...CLEARED_AIRCRAFT });
}

/** Marca o desmarca una autoridad aceptada. Sólo las que ofrece el formulario, en su orden. */
export function toggleAcceptedAuthority<T extends OfferRequirementsForm>(form: T, authority: AuthorityCode): T {
  const next = form.acceptedAuthorities.includes(authority)
    ? form.acceptedAuthorities.filter((a) => a !== authority)
    : [...form.acceptedAuthorities, authority];
  return { ...form, acceptedAuthorities: acceptableAuthorities(form).filter((a) => next.includes(a)) };
}

export function selectProductType<T extends OfferRequirementsForm>(form: T, productType: OfferProductType): T {
  if (productType === form.productType) return form;
  return withApplicableAuthorities({
    ...form,
    productType,
    // Los ratings son del producto anterior: las FK compuestas de la 047 los
    // rechazarían al guardar.
    ...CLEARED_AIRCRAFT,
    licenseCode: form.licenseCode && isLicenseCompatibleWithProductType(form.licenseCode, productType) ? form.licenseCode : undefined,
  });
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
