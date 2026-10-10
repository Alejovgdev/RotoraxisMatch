// El asistente de oferta (rediseño, fase 4; docs/UI_REDESIGN.md, D3 y
// respuesta 14). Puro: qué pasos aplican, qué valida cada uno, cómo se carga
// una oferta existente y qué dice la revisión. Lo pinta
// src/components/company/OfferWizard.tsx, para crear y para editar.
//
// No hay reglas nuevas. Las transiciones —qué se limpia al cambiar de tipo, de
// autoridad, de licencia o de producto— son las de offerFormRules, llamadas
// tal cual; los errores son los que calculaban new.tsx y edit.tsx (dos copias
// idénticas que viven ahora aquí); el guardado sigue en las dos pantallas.
import { ContractTypeCode, AuthorityCode, AuthorityLicenseCode, TechnicianTypeCode } from '../types/catalog';
import { OfferStatus } from '../types/enums';
import { OfferProductType, OfferWithRequirements } from '../types/offer';
import { EMPTY_LOCATION, LocationValue } from '../types/location';
import { CONTRACT_TYPES } from '../constants/contractTypes';
import { getOfferProductTypeLabel } from '../constants/offerProductTypes';
import { technicianTypeLabel } from '../constants/technicianTypes';
import {
  OfferRequirementsForm,
  aircraftRequirementsCopy,
  requirementsErrors,
  selectAuthority,
  selectEngine,
  selectLicense,
  selectProductType,
  selectTechnicianType,
  setRequiresCertification,
  showsCertificationQuestion,
  showsOnlyUnlicensed,
} from './offerFormRules';
import { formatLocation } from './formatLocation';
import { locationValueFromPersisted } from './locationBridge';
import { SalaryFormValue, formatOfferSalary, salaryFormError, salaryFormFromValue, salaryFromForm } from './offerSalary';
import { ONLY_UNLICENSED_TEXT, offerCertificationText, offerLicenseDetailText, requirementWithNote } from './offerRequirementsText';

// ── El formulario ─────────────────────────────────────────────────────────

/** Los campos de la oferta: los requisitos (OfferRequirementsForm) y los detalles. */
export interface OfferWizardForm extends OfferRequirementsForm {
  title: string;
  description: string;
  contractType: ContractTypeCode;
  salary: SalaryFormValue;
  // Fase 7 F2c: un solo campo con país + ciudad, en vez de cuatro sueltos
  // que había que mantener coherentes a mano.
  location: LocationValue;
  minYearsExperience: number;
}

/** El valor inicial de una oferta nueva: el de new.tsx antes del asistente. */
export function newOfferWizardForm(): OfferWizardForm {
  return {
    title: '',
    description: '',
    contractType: 'permanent',
    salary: salaryFormFromValue(),
    // Arranca en aviones porque el selector siempre está visible y el campo es
    // NOT NULL: un "sin elegir" sería un tercer estado que la base no admite.
    productType: 'Aeroplane',
    location: EMPTY_LOCATION,
    minYearsExperience: 0,
    // Ambos campos son NOT NULL en la base, así que arrancan con un valor
    // real y no con un "sin elegir" que sería un tercer estado inexpresable.
    // `mechanic` es el primero del catálogo por sortOrder; `true` en el
    // interruptor conserva el comportamiento previo a que existiera.
    technicianType: 'mechanic',
    requiresCertification: true,
    // Sin licencia elegida al arrancar: el guardado la exige (CHECK de la
    // 053) y un valor por defecto haría pasar por elegida una que nadie
    // eligió. `requiresAllAircraft` arranca en false — "basta con una".
    // Paso 5b: lo mismo con la AUTORIDAD — nada de EASA por defecto.
    licenseAuthority: undefined,
    licenseCode: undefined,
    acceptedAuthorities: [],
    requiresAllAircraft: false,
    requiredHabilitations: [],
    // Sesión 4 (091): sale del tipo — `mechanic` es una oferta de aeronave.
    offerKind: 'aircraft',
    requiredEngineId: undefined,
    // Desmarcada por defecto: decisión tomada en la 070.
    onlyUnlicensed: false,
  };
}

/** Una oferta guardada, en el formulario de edición: lo que hacía edit.tsx al cargar. */
export function offerWizardFormFromOffer(o: OfferWithRequirements): OfferWizardForm {
  return {
    title: o.title,
    description: o.description,
    contractType: o.contractType,
    salary: salaryFormFromValue(o.salary),
    productType: o.productType,
    // `locationCountry` es el NOMBRE guardado en la fila; sirve como etiqueta
    // hasta que el usuario reabra el selector, que lo resolverá contra el
    // catálogo vivo.
    location: locationValueFromPersisted(o, o.locationCountry),
    minYearsExperience: o.minYearsExperience,
    technicianType: o.technicianType,
    requiresCertification: o.requiresCertification,
    licenseAuthority: o.licenseAuthority,
    licenseCode: o.licenseCode,
    acceptedAuthorities: o.acceptedAuthorities,
    acceptedLicenseCode: o.acceptedLicenseCode,
    requiresAllAircraft: o.requiresAllAircraft,
    requiredHabilitations: o.requiredHabilitations.map((h) => ({
      aircraftTypeRatingId: h.aircraftTypeRatingId,
      notes: h.notes,
    })),
    offerKind: o.offerKind,
    requiredEngineId: o.requiredEngineId,
    requiredEngineNotes: o.requiredEngineNotes ?? undefined,
    onlyUnlicensed: o.onlyUnlicensed,
  };
}

// ── Errores ───────────────────────────────────────────────────────────────

/** Los errores de toda la oferta: los mismos que comprobaba el formulario de una página. */
export function offerWizardErrors(form: OfferWizardForm) {
  return {
    salary: salaryFormError(form.salary),
    title: !form.title.trim() ? 'Title is required.'
      : form.title.trim().length < 3 ? 'Title must be at least 3 characters.'
      : undefined,
    description: !form.description.trim() ? 'Description is required.' : undefined,
    // Sólo el país es obligatorio; la ciudad es opcional.
    location: !form.location.country ? 'Please select a country.' : undefined,
    // Fase 6 tanda D / paso 5b: exigir certificar sin autoridad o sin licencia,
    // o una oferta de motor sin motor, son estados que Postgres rechaza. Se
    // avisa aquí, junto al campo, en vez de devolver un error de constraint.
    ...requirementsErrors(form),
  };
}

export type OfferWizardErrors = Partial<ReturnType<typeof offerWizardErrors>>;
export type OfferWizardErrorKey = keyof OfferWizardErrors;

/** Los errores que se borran al tocar cualquier requisito (como hacía new.tsx). */
export const REQUIREMENT_ERROR_KEYS: readonly OfferWizardErrorKey[] = ['authority', 'license', 'engine', 'acceptedLicense'];

export function hasOfferWizardErrors(errors: OfferWizardErrors): boolean {
  return Object.values(errors).some(Boolean);
}

// ── Pasos ─────────────────────────────────────────────────────────────────

/**
 * Los pasos de datos, en orden (D3 y respuesta 14):
 *   who           tipo de técnico y aviones o helicópteros (y "sólo sin
 *                 licencia" en los oficios sin licencia, que no tienen paso 2)
 *   licence       la pregunta de la licencia y lo que cuelga de ella
 *   requirements  las aeronaves o, en una oferta de motor, el motor
 *   details       título, descripción, contrato, años, salario y ubicación
 * La revisión va detrás y no cuenta en "Step N of M".
 */
export type OfferWizardStep = 'who' | 'licence' | 'requirements' | 'details';
export type OfferWizardPosition = OfferWizardStep | 'review';

/**
 * Los pasos que aplican a esta oferta. Sólo el de la licencia puede faltar:
 * sale cuando el formulario de siempre hacía la pregunta (oficios con licencia
 * y toda oferta de motor, `showsCertificationQuestion`).
 */
export function offerWizardSteps(form: OfferRequirementsForm): OfferWizardStep[] {
  return showsCertificationQuestion(form)
    ? ['who', 'licence', 'requirements', 'details']
    : ['who', 'requirements', 'details'];
}

/** En qué paso se arregla cada error. */
const ERROR_STEP: Record<OfferWizardErrorKey, OfferWizardStep> = {
  authority: 'licence',
  license: 'licence',
  acceptedLicense: 'licence',
  engine: 'requirements',
  title: 'details',
  description: 'details',
  location: 'details',
  salary: 'details',
};

/** Los errores de UN paso, con las validaciones de siempre. "Continue" sólo mira éstos. */
export function offerWizardStepErrors(form: OfferWizardForm, step: OfferWizardStep): OfferWizardErrors {
  const all = offerWizardErrors(form);
  const out: OfferWizardErrors = {};
  (Object.keys(all) as OfferWizardErrorKey[]).forEach((key) => {
    if (all[key] && ERROR_STEP[key] === step) out[key] = all[key];
  });
  return out;
}

/** El primer paso con algún error, o null si la oferta se puede guardar. */
export function firstOfferWizardStepWithErrors(form: OfferWizardForm): OfferWizardStep | null {
  return offerWizardSteps(form).find((step) => hasOfferWizardErrors(offerWizardStepErrors(form, step))) ?? null;
}

/** "Step 2 of 4" o, en la revisión, "Review", con los segmentos que van llenos. */
export function offerWizardProgress(
  form: OfferRequirementsForm,
  position: OfferWizardPosition,
): { step: number; total: number; label: string } {
  const steps = offerWizardSteps(form);
  const total = steps.length;
  if (position === 'review') return { step: total + 1, total, label: 'Review' };
  const step = stepIndex(steps, position) + 1;
  return { step, total, label: `Step ${step} of ${total}` };
}

/** A dónde lleva "Continue": el paso siguiente que aplique, o la revisión tras el último. */
export function nextOfferWizardPosition(form: OfferRequirementsForm, position: OfferWizardPosition): OfferWizardPosition {
  if (position === 'review') return 'review';
  const steps = offerWizardSteps(form);
  return steps[stepIndex(steps, position) + 1] ?? 'review';
}

/** A dónde lleva "atrás": el paso anterior que aplique, o null en el primero (salir). */
export function previousOfferWizardPosition(form: OfferRequirementsForm, position: OfferWizardPosition): OfferWizardStep | null {
  const steps = offerWizardSteps(form);
  if (position === 'review') return steps[steps.length - 1];
  const index = stepIndex(steps, position);
  return index > 0 ? steps[index - 1] : null;
}

/**
 * Escritorio: la columna de pasos sólo lleva hacia ATRÁS, a uno ya hecho.
 * Hacia delante sólo se avanza con "Continue", que valida el paso.
 */
export function canJumpToOfferWizardStep(
  form: OfferRequirementsForm,
  current: OfferWizardPosition,
  target: OfferWizardPosition,
): boolean {
  const order: OfferWizardPosition[] = [...offerWizardSteps(form), 'review'];
  const from = order.indexOf(current);
  const to = order.indexOf(target);
  return to >= 0 && from >= 0 && to < from;
}

// Un paso que deja de aplicar no puede ser el actual (sólo cambia el tipo, en
// el paso 1, y eso quita o pone el paso 2). Por si acaso, cae en el anterior
// que exista en vez de devolver -1.
function stepIndex(steps: OfferWizardStep[], step: OfferWizardStep): number {
  const index = steps.indexOf(step);
  if (index >= 0) return index;
  const order: OfferWizardStep[] = ['who', 'licence', 'requirements', 'details'];
  for (let i = order.indexOf(step) - 1; i >= 0; i--) {
    const found = steps.indexOf(order[i]);
    if (found >= 0) return found;
  }
  return 0;
}

/** El nombre corto de cada paso (columna de escritorio y revisión). */
export function offerWizardStepLabel(form: OfferRequirementsForm, step: OfferWizardStep): string {
  switch (step) {
    case 'who':
      return 'Who';
    case 'licence':
      return 'Licence';
    case 'requirements': {
      if (form.offerKind === 'engine') return 'Engine';
      const title = aircraftRequirementsCopy(form).title;
      return title === 'Required type ratings' ? 'Type ratings' : title;
    }
    case 'details':
      return 'Details';
  }
}

// ── Cambios que limpian ───────────────────────────────────────────────────

/**
 * Los cambios de requisitos que pueden descartar algo. Cada uno es una
 * transición de offerFormRules, sin tocar: crear la aplica sin aviso y editar
 * pregunta antes si descarta algo guardado (como hasta ahora).
 */
export type OfferRequirementChange =
  | { kind: 'engine'; value: string }
  | { kind: 'technicianType'; value: TechnicianTypeCode }
  | { kind: 'certification'; value: boolean }
  | { kind: 'productType'; value: OfferProductType }
  | { kind: 'authority'; value: AuthorityCode }
  | { kind: 'license'; value: AuthorityLicenseCode };

export function applyOfferRequirementChange<T extends OfferRequirementsForm>(form: T, change: OfferRequirementChange): T {
  switch (change.kind) {
    case 'engine':
      return selectEngine(form, change.value);
    case 'technicianType':
      return selectTechnicianType(form, change.value);
    case 'certification':
      return setRequiresCertification(form, change.value);
    case 'productType':
      return selectProductType(form, change.value);
    case 'authority':
      return selectAuthority(form, change.value);
    case 'license':
      return selectLicense(form, change.value);
  }
}

// ── Revisión ──────────────────────────────────────────────────────────────

export interface OfferReviewBlock {
  step: OfferWizardStep;
  title: string;
  lines: string[];
}

/**
 * Los bloques de la revisión, uno por paso, cada uno con su "Edit". Las
 * etiquetas de aeronaves y motores las resuelve la pantalla con sus catálogos.
 */
export function offerReviewBlocks(
  form: OfferWizardForm,
  labels: { aircraft: (ratingId: string) => string; engine: (engineId: string) => string },
): OfferReviewBlock[] {
  return offerWizardSteps(form).map((step) => {
    switch (step) {
      case 'who':
        return {
          step,
          title: 'Who',
          lines: [
            `${technicianTypeLabel(form.technicianType)} · ${getOfferProductTypeLabel(form.productType)}`,
            // Los oficios sin licencia no tienen paso 2: la casilla va aquí.
            ...(!showsCertificationQuestion(form) && form.onlyUnlicensed ? [ONLY_UNLICENSED_TEXT] : []),
          ],
        };
      case 'licence':
        return {
          step,
          title: 'Licence',
          lines: form.requiresCertification
            ? [offerCertificationText(form), offerLicenseDetailText(form) ?? 'No licence selected']
            : [offerCertificationText(form), ...(showsOnlyUnlicensed(form) && form.onlyUnlicensed ? [ONLY_UNLICENSED_TEXT] : [])],
        };
      case 'requirements': {
        if (form.offerKind === 'engine') {
          return {
            step,
            title: 'Engine',
            lines: [form.requiredEngineId ? requirementWithNote(labels.engine(form.requiredEngineId), form.requiredEngineNotes) : 'No engine selected'],
          };
        }
        const aircraft = form.requiredHabilitations;
        // Fase 6 tanda D: "todas" o "una cualquiera" sólo se pregunta con dos o más.
        const scope = aircraft.length > 1 ? (form.requiresAllAircraft ? ' · all of them' : ' · any one') : '';
        return {
          step,
          title: `${offerWizardStepLabel(form, step)}${scope}`,
          lines: aircraft.length > 0
            ? aircraft.map((h) => requirementWithNote(labels.aircraft(h.aircraftTypeRatingId), h.notes))
            : ['No aircraft added'],
        };
      }
      case 'details':
        return { step, title: 'Details', lines: offerDetailsLines(form) };
    }
  });
}

function offerDetailsLines(form: OfferWizardForm): string[] {
  const contract = CONTRACT_TYPES.find((c) => c.code === form.contractType)?.label ?? form.contractType;
  const years = form.minYearsExperience > 0 ? `${form.minYearsExperience}+ years of experience` : 'No minimum experience';
  const salary = !form.salary.enabled
    ? 'No remuneration added'
    : salaryFormError(form.salary)
      ? 'Remuneration incomplete'
      : formatOfferSalary(salaryFromForm(form.salary)) ?? 'No remuneration added';
  const place = formatLocation(form.location.city?.name, form.location.country?.name);
  return [
    form.title.trim() || 'No title',
    `${contract} · ${years}`,
    salary,
    place || 'No country selected',
    form.description.trim() || 'No description',
  ];
}

// ── Pantalla final ────────────────────────────────────────────────────────

/** El texto de la pantalla final de una oferta nueva, según cómo se guardó. */
export function offerWizardDoneCopy(status: OfferStatus): { title: string; text: string } {
  return status === 'published'
    ? { title: 'Your offer is live', text: 'Technicians can find it and apply.' }
    : { title: 'Saved as draft', text: 'You can publish it later from Your offers.' };
}
