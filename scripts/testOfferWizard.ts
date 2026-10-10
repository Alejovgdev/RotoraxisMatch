// Rediseño, fase 4 — el asistente de oferta (src/utils/offerWizard.ts).
//
// Sin Supabase y sin navegador. Cubre lo que pide la fase:
//   1. qué pasos salen según el tipo de técnico;
//   2. el número de pasos ("Step N of M" cuenta sólo los que aplican) y el
//      recorrido adelante / atrás;
//   3. la limpieza al volver a un paso anterior y cambiar algo: las mismas
//      transiciones de offerFormRules, sin reescribir;
//   4. que "Continue" valida sólo su paso, y que entre todos los pasos se
//      comprueban todos los errores de antes (ninguno se pierde);
//   5. que editar carga bien una oferta existente;
//   6. la columna de escritorio (sólo hacia atrás) y la revisión.
//
// Run: npm run test:offer-wizard
import assert from 'node:assert/strict';
import {
  OfferWizardErrorKey,
  OfferWizardForm,
  OfferWizardPosition,
  OfferWizardStep,
  applyOfferRequirementChange,
  canJumpToOfferWizardStep,
  firstOfferWizardStepWithErrors,
  hasOfferWizardErrors,
  newOfferWizardForm,
  nextOfferWizardPosition,
  offerReviewBlocks,
  offerWizardDoneCopy,
  offerWizardErrors,
  offerWizardFormFromOffer,
  offerWizardProgress,
  offerWizardStepErrors,
  offerWizardStepLabel,
  offerWizardSteps,
  previousOfferWizardPosition,
} from '../src/utils/offerWizard';
import {
  selectAuthority,
  selectLicense,
  selectProductType,
  selectTechnicianType,
  setRequiresCertification,
  toggleAcceptedAuthority,
} from '../src/utils/offerFormRules';
import { TECHNICIAN_TYPES } from '../src/constants/technicianTypes';
import { salaryFromForm } from '../src/utils/offerSalary';
import { ONLY_UNLICENSED_TEXT, requirementWithNote } from '../src/utils/offerRequirementsText';
import type { OfferWithRequirements } from '../src/types/offer';
import type { TechnicianTypeCode } from '../src/types/catalog';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`PASS — ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL — ${name}`);
    console.error(err instanceof Error ? err.stack ?? err.message : err);
  }
}

const A320 = { aircraftTypeRatingId: 'rating-a320' };
const B737 = { aircraftTypeRatingId: 'rating-737', notes: 'NG preferred' };

/** Una oferta completa y válida: mecánico, aviones, EASA B1.1 (+UK CAA), dos aeronaves. */
function validForm(overrides: Partial<OfferWizardForm> = {}): OfferWizardForm {
  return {
    ...newOfferWizardForm(),
    title: 'B1 Mechanic · A320 family',
    description: 'Line maintenance on the A320 family.',
    location: { country: { code: 'ES', name: 'Spain' }, city: { kind: 'manual', name: 'Barcelona' } },
    minYearsExperience: 3,
    licenseAuthority: 'EASA',
    licenseCode: 'B1.1',
    acceptedAuthorities: ['UK_CAA'],
    requiredHabilitations: [A320, B737],
    ...overrides,
  };
}

function withType(form: OfferWizardForm, type: TechnicianTypeCode): OfferWizardForm {
  return applyOfferRequirementChange(form, { kind: 'technicianType', value: type });
}

/** Los errores no vacíos, para comparar. */
function present(errors: Partial<Record<OfferWizardErrorKey, string | undefined>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(errors)) if (value) out[key] = value;
  return out;
}

// ── 1. Qué pasos salen según el tipo de técnico ─────────────────────────────

const EXPECTED_STEPS: Record<string, OfferWizardStep[]> = {
  mechanic: ['who', 'licence', 'requirements', 'details'],
  avionic: ['who', 'licence', 'requirements', 'details'],
  // Sesión 2: en toda oferta de motor la pregunta existe (licencia opcional).
  engine_technician: ['who', 'licence', 'requirements', 'details'],
  // Respuesta 14: los oficios sin licencia se saltan el paso 2.
  sheet_metal_worker: ['who', 'requirements', 'details'],
  painter: ['who', 'requirements', 'details'],
  composite: ['who', 'requirements', 'details'],
};

test('Pasos — cada tipo activo del catálogo tiene su recorrido esperado (un tipo nuevo obliga a decidirlo aquí)', () => {
  const active = TECHNICIAN_TYPES.filter((t) => t.isActive).map((t) => t.code).sort();
  assert.deepEqual(active, Object.keys(EXPECTED_STEPS).sort());
});

test('Pasos — mecánico y aviónica: quién, licencia, aeronaves y detalles', () => {
  for (const type of ['mechanic', 'avionic'] as const) {
    const form = withType(newOfferWizardForm(), type);
    assert.deepEqual(offerWizardSteps(form), EXPECTED_STEPS[type], type);
    assert.equal(offerWizardStepLabel(form, 'requirements'), 'Type ratings', `${type}: con licencia se piden type ratings`);
  }
});

test('Pasos — Engine Technician: la pregunta de licencia (opcional) y el motor en lugar de las aeronaves', () => {
  const form = withType(newOfferWizardForm(), 'engine_technician');
  assert.equal(form.offerKind, 'engine');
  assert.deepEqual(offerWizardSteps(form), EXPECTED_STEPS.engine_technician);
  assert.equal(offerWizardStepLabel(form, 'requirements'), 'Engine');
  // Sin licencia, sigue habiendo pregunta: en motor la licencia es opcional.
  const sinLicencia = applyOfferRequirementChange(form, { kind: 'certification', value: false });
  assert.deepEqual(offerWizardSteps(sinLicencia), EXPECTED_STEPS.engine_technician);
});

test('Pasos — chapa, pintura y composite: sin paso de licencia; las aeronaves como experiencia', () => {
  for (const type of ['sheet_metal_worker', 'painter', 'composite'] as const) {
    const form = withType(newOfferWizardForm(), type);
    assert.equal(form.requiresCertification, false, `${type}: no certifica`);
    assert.deepEqual(offerWizardSteps(form), EXPECTED_STEPS[type], type);
    assert.equal(offerWizardStepLabel(form, 'requirements'), 'Aircraft experience', type);
  }
});

test('Pasos — la licencia FAA pide las aeronaves como experiencia, y lo dice el nombre del paso', () => {
  const faa = applyOfferRequirementChange(newOfferWizardForm(), { kind: 'authority', value: 'FAA' });
  assert.equal(offerWizardStepLabel(faa, 'requirements'), 'Aircraft experience');
  assert.equal(offerWizardStepLabel(validForm(), 'requirements'), 'Type ratings');
});

// ── 2. Número de pasos y recorrido ──────────────────────────────────────────

test('Número de pasos — "Step N of M" cuenta sólo los pasos que aplican; la revisión no cuenta', () => {
  const licensed = validForm();
  assert.deepEqual(offerWizardProgress(licensed, 'who'), { step: 1, total: 4, label: 'Step 1 of 4' });
  assert.deepEqual(offerWizardProgress(licensed, 'licence'), { step: 2, total: 4, label: 'Step 2 of 4' });
  assert.deepEqual(offerWizardProgress(licensed, 'requirements'), { step: 3, total: 4, label: 'Step 3 of 4' });
  assert.deepEqual(offerWizardProgress(licensed, 'details'), { step: 4, total: 4, label: 'Step 4 of 4' });
  assert.deepEqual(offerWizardProgress(licensed, 'review'), { step: 5, total: 4, label: 'Review' }, 'revisión: todos los segmentos llenos');

  const painter = withType(licensed, 'painter');
  assert.deepEqual(offerWizardProgress(painter, 'who'), { step: 1, total: 3, label: 'Step 1 of 3' });
  assert.deepEqual(offerWizardProgress(painter, 'requirements'), { step: 2, total: 3, label: 'Step 2 of 3' });
  assert.deepEqual(offerWizardProgress(painter, 'details'), { step: 3, total: 3, label: 'Step 3 of 3' });
  assert.deepEqual(offerWizardProgress(painter, 'review'), { step: 4, total: 3, label: 'Review' });
});

test('Recorrido — "Continue" lleva al siguiente paso que aplica y, tras el último, a la revisión', () => {
  const walk = (form: OfferWizardForm) => {
    const seen: OfferWizardPosition[] = ['who'];
    let at: OfferWizardPosition = 'who';
    while (at !== 'review') {
      at = nextOfferWizardPosition(form, at);
      seen.push(at);
    }
    return seen;
  };
  assert.deepEqual(walk(validForm()), ['who', 'licence', 'requirements', 'details', 'review']);
  assert.deepEqual(walk(withType(validForm(), 'composite')), ['who', 'requirements', 'details', 'review'], 'el paso 2 se salta');
  assert.equal(nextOfferWizardPosition(validForm(), 'review'), 'review');
});

test('Recorrido — "atrás" vuelve al paso anterior que aplica; en el primero sale (null)', () => {
  const form = validForm();
  assert.equal(previousOfferWizardPosition(form, 'review'), 'details');
  assert.equal(previousOfferWizardPosition(form, 'details'), 'requirements');
  assert.equal(previousOfferWizardPosition(form, 'requirements'), 'licence');
  assert.equal(previousOfferWizardPosition(form, 'licence'), 'who');
  assert.equal(previousOfferWizardPosition(form, 'who'), null, 'salir, sin aviso, como antes');
  const sheet = withType(form, 'sheet_metal_worker');
  assert.equal(previousOfferWizardPosition(sheet, 'requirements'), 'who', 'sin licencia, de las aeronaves al paso 1');
});

// ── 3. La limpieza al volver atrás ──────────────────────────────────────────

test('Volver atrás — pasar de mecánico a un oficio sin licencia quita licencia y equivalencias, conserva las aeronaves y el paso 2 desaparece', () => {
  const atDetails = validForm();
  const changed = applyOfferRequirementChange(atDetails, { kind: 'technicianType', value: 'sheet_metal_worker' });
  assert.deepEqual(changed, selectTechnicianType(atDetails, 'sheet_metal_worker'), 'la transición es la de offerFormRules, tal cual');
  assert.equal(changed.requiresCertification, false);
  assert.equal(changed.licenseAuthority, undefined);
  assert.equal(changed.licenseCode, undefined);
  assert.deepEqual(changed.acceptedAuthorities, []);
  assert.deepEqual(changed.requiredHabilitations, [A320, B737], 'Fase 6 tanda E: las aeronaves se quedan');
  assert.deepEqual(offerWizardSteps(changed), ['who', 'requirements', 'details']);
  assert.equal(offerWizardProgress(changed, 'who').label, 'Step 1 of 3');
  // Los detalles no se tocan.
  assert.equal(changed.title, atDetails.title);
  assert.deepEqual(changed.location, atDetails.location);
});

test('Volver atrás — pasar a helicópteros quita las aeronaves y una licencia sólo de aviones', () => {
  const form = validForm();
  const changed = applyOfferRequirementChange(form, { kind: 'productType', value: 'Helicopter' });
  assert.deepEqual(changed, selectProductType(form, 'Helicopter'));
  assert.deepEqual(changed.requiredHabilitations, []);
  assert.equal(changed.requiresAllAircraft, false);
  assert.equal(changed.licenseCode, undefined, 'la B1.1 es de aviones');
  // Con la licencia vaciada, el paso 2 vuelve a fallar al continuar.
  assert.equal(offerWizardStepErrors(changed, 'licence').license, 'Select the licence this role certifies under.');
});

test('Volver atrás — pasar a Engine Technician quita las aeronaves y el paso 3 pasa a ser el motor', () => {
  const form = validForm();
  const changed = applyOfferRequirementChange(form, { kind: 'technicianType', value: 'engine_technician' });
  assert.deepEqual(changed, selectTechnicianType(form, 'engine_technician'));
  assert.equal(changed.offerKind, 'engine');
  assert.deepEqual(changed.requiredHabilitations, []);
  assert.equal(changed.licenseCode, 'B1.1', 'una B1.1 certifica motor y se queda');
  assert.equal(offerWizardStepLabel(changed, 'requirements'), 'Engine');
  assert.equal(offerWizardStepErrors(changed, 'requirements').engine, 'Select the engine this role works on.');
});

test('Volver atrás — en el paso 2, cambiar la autoridad a FAA quita la licencia Part-66, sus aeronaves y las equivalencias', () => {
  const form = validForm();
  const changed = applyOfferRequirementChange(form, { kind: 'authority', value: 'FAA' });
  assert.deepEqual(changed, selectAuthority(form, 'FAA'));
  assert.equal(changed.licenseAuthority, 'FAA');
  assert.equal(changed.licenseCode, undefined);
  assert.deepEqual(changed.requiredHabilitations, []);
  assert.deepEqual(changed.acceptedAuthorities, []);
});

test('Volver atrás — cambiar la licencia quita las aeronaves puestas para la anterior', () => {
  const form = validForm();
  const changed = applyOfferRequirementChange(form, { kind: 'license', value: 'B1.2' });
  assert.deepEqual(changed, selectLicense(form, 'B1.2'));
  assert.equal(changed.licenseCode, 'B1.2');
  assert.deepEqual(changed.requiredHabilitations, []);
});

test('Volver atrás — "No licence needed" quita la licencia y conserva aeronaves; volver a "Yes" desmarca "sólo sin licencia"', () => {
  const form = validForm();
  const off = applyOfferRequirementChange(form, { kind: 'certification', value: false });
  assert.deepEqual(off, setRequiresCertification(form, false));
  assert.equal(off.licenseCode, undefined);
  assert.deepEqual(off.requiredHabilitations, [A320, B737]);
  const back = applyOfferRequirementChange({ ...off, onlyUnlicensed: true }, { kind: 'certification', value: true });
  assert.equal(back.onlyUnlicensed, false);
});

test('Volver atrás — elegir lo que ya estaba no cambia nada (mismo objeto: editar no pregunta)', () => {
  const form = validForm();
  assert.equal(applyOfferRequirementChange(form, { kind: 'technicianType', value: 'mechanic' }), form);
  assert.equal(applyOfferRequirementChange(form, { kind: 'productType', value: 'Aeroplane' }), form);
  assert.equal(applyOfferRequirementChange(form, { kind: 'authority', value: 'EASA' }), form);
  assert.equal(applyOfferRequirementChange(form, { kind: 'license', value: 'B1.1' }), form);
  assert.equal(applyOfferRequirementChange(form, { kind: 'certification', value: true }), form);
});

// ── 4. "Continue" valida sólo su paso ───────────────────────────────────────

test('Continue — en una oferta nueva vacía, el paso 1 pasa y cada paso sólo ve sus errores', () => {
  const form = newOfferWizardForm();
  assert.deepEqual(present(offerWizardStepErrors(form, 'who')), {}, 'tipo y producto siempre tienen valor');
  assert.deepEqual(present(offerWizardStepErrors(form, 'licence')), {
    authority: 'Select the authority that issues the licence.',
    license: 'Select the licence this role certifies under.',
  }, 'la licencia, no el título');
  assert.deepEqual(present(offerWizardStepErrors(form, 'requirements')), {}, 'cero aeronaves es válido, como antes');
  assert.deepEqual(present(offerWizardStepErrors(form, 'details')), {
    title: 'Title is required.',
    description: 'Description is required.',
    location: 'Please select a country.',
  }, 'los detalles, no la licencia');
});

test('Continue — el motor se comprueba en el paso 3; la categoría Part-66 de una oferta FAA, en el 2; el salario, en el 4', () => {
  const engine = withType(validForm(), 'engine_technician');
  assert.deepEqual(present(offerWizardStepErrors(engine, 'requirements')), { engine: 'Select the engine this role works on.' });
  assert.deepEqual(present(offerWizardStepErrors(engine, 'licence')), {});
  assert.deepEqual(present(offerWizardStepErrors({ ...engine, requiredEngineId: 'eng-cfm56-7b' }, 'requirements')), {});

  const faa = selectLicense(selectAuthority(validForm(), 'FAA'), 'A&P');
  const faaWithAuthority = toggleAcceptedAuthority(faa, 'EASA');
  assert.deepEqual(faaWithAuthority.acceptedAuthorities, ['EASA']);
  assert.deepEqual(present(offerWizardStepErrors(faaWithAuthority, 'licence')), {
    acceptedLicense: 'Pick the licence category the accepted authorities must have issued.',
  });
  assert.deepEqual(present(offerWizardStepErrors(faaWithAuthority, 'details')), {});

  const badSalary = validForm({ salary: { enabled: true, amount: '3.500,00', currency: 'EUR', customCurrency: '', period: 'month' } });
  assert.ok(offerWizardStepErrors(badSalary, 'details').salary, 'salario mal escrito: error en detalles');
  assert.deepEqual(present(offerWizardStepErrors(badSalary, 'licence')), {});
});

test('Continue — el título corto da el error de siempre', () => {
  assert.equal(offerWizardStepErrors(validForm({ title: 'B1' }), 'details').title, 'Title must be at least 3 characters.');
  assert.equal(offerWizardStepErrors(validForm({ title: '   ' }), 'details').title, 'Title is required.');
});

test('Continue — ningún error se pierde: entre los pasos que aplican están todos los del formulario de antes', () => {
  const forms: OfferWizardForm[] = [
    newOfferWizardForm(),
    withType(newOfferWizardForm(), 'engine_technician'),
    withType(newOfferWizardForm(), 'painter'),
    selectAuthority(newOfferWizardForm(), 'FAA'),
    toggleAcceptedAuthority(selectLicense(selectAuthority(newOfferWizardForm(), 'FAA'), 'A&P'), 'UK_CAA'),
    validForm({ salary: { enabled: true, amount: '', currency: 'other', customCurrency: 'x', period: '' } }),
    validForm(),
  ];
  for (const form of forms) {
    const fromSteps: Record<string, string> = {};
    for (const step of offerWizardSteps(form)) Object.assign(fromSteps, present(offerWizardStepErrors(form, step)));
    assert.deepEqual(fromSteps, present(offerWizardErrors(form)), `${form.technicianType}/${form.licenseAuthority ?? '-'}`);
  }
});

test('Revisión — antes de guardar se comprueba todo y se va al primer paso con errores', () => {
  assert.equal(firstOfferWizardStepWithErrors(newOfferWizardForm()), 'licence');
  const licensed = selectLicense(selectAuthority(newOfferWizardForm(), 'EASA'), 'B1.1');
  assert.equal(firstOfferWizardStepWithErrors(licensed), 'details');
  assert.equal(firstOfferWizardStepWithErrors(withType(newOfferWizardForm(), 'painter')), 'details', 'sin paso 2');
  assert.equal(firstOfferWizardStepWithErrors(withType(validForm(), 'engine_technician')), 'requirements');
  assert.equal(firstOfferWizardStepWithErrors(validForm()), null);
  assert.equal(hasOfferWizardErrors(offerWizardErrors(validForm())), false);
});

test('Salario — apagado no se guarda ni se valida, aunque quede algo escrito', () => {
  const off = validForm({ salary: { enabled: false, amount: 'abc', currency: 'EUR', customCurrency: '', period: '' } });
  assert.equal(offerWizardStepErrors(off, 'details').salary, undefined);
  assert.equal(salaryFromForm(off.salary), null, 'null = sin salario, como cuando no se añadía');
  const on = validForm({ salary: { enabled: true, amount: '3200', currency: 'EUR', customCurrency: '', period: 'month' } });
  assert.deepEqual(salaryFromForm(on.salary), { amount: 3200, currency: 'EUR', period: 'month' });
});

// ── 5. Editar carga bien una oferta existente ───────────────────────────────

function savedOffer(overrides: Partial<OfferWithRequirements> = {}): OfferWithRequirements {
  return {
    id: 'offer-1',
    companyId: 'company-1',
    title: 'A&P Mechanic · 737NG',
    description: 'Heavy checks on the 737 Next Generation.',
    contractType: 'long_term',
    salary: { amount: 45, currency: 'USD', period: 'hour' },
    productType: 'Aeroplane',
    technicianType: 'mechanic',
    requiresCertification: true,
    licenseAuthority: 'FAA',
    licenseCode: 'A&P',
    acceptedAuthorities: ['EASA', 'UK_CAA'],
    acceptedLicenseCode: 'B1.1',
    requiresAllAircraft: true,
    offerKind: 'aircraft',
    requiredEngineId: undefined,
    onlyUnlicensed: false,
    locationCountryCode: 'US',
    locationCountry: 'United States',
    locationCity: 'Miami',
    locationCityName: 'Miami',
    locationCityLat: 25.77,
    locationCityLng: -80.19,
    locationCityGeonameId: 4164138,
    minYearsExperience: 5,
    status: 'published',
    visible: true,
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-02T10:00:00Z',
    requiredHabilitations: [
      { offerId: 'offer-1', aircraftTypeRatingId: 'rating-737', notes: 'NG preferred', createdAt: '2026-10-01T10:00:00Z' },
      { offerId: 'offer-1', aircraftTypeRatingId: 'rating-757', createdAt: '2026-10-01T10:00:00Z' },
    ],
    ...overrides,
  };
}

test('Editar — una oferta guardada se carga campo a campo en el asistente', () => {
  const form = offerWizardFormFromOffer(savedOffer());
  assert.equal(form.title, 'A&P Mechanic · 737NG');
  assert.equal(form.description, 'Heavy checks on the 737 Next Generation.');
  assert.equal(form.contractType, 'long_term');
  assert.deepEqual(form.salary, { enabled: true, amount: '45', currency: 'USD', customCurrency: '', period: 'hour' });
  assert.equal(form.productType, 'Aeroplane');
  assert.equal(form.minYearsExperience, 5);
  assert.equal(form.technicianType, 'mechanic');
  assert.equal(form.offerKind, 'aircraft');
  assert.equal(form.requiresCertification, true);
  assert.equal(form.licenseAuthority, 'FAA');
  assert.equal(form.licenseCode, 'A&P');
  assert.deepEqual(form.acceptedAuthorities, ['EASA', 'UK_CAA']);
  assert.equal(form.acceptedLicenseCode, 'B1.1');
  assert.equal(form.requiresAllAircraft, true);
  assert.deepEqual(form.requiredHabilitations, [
    { aircraftTypeRatingId: 'rating-737', notes: 'NG preferred' },
    { aircraftTypeRatingId: 'rating-757', notes: undefined },
  ], 'sólo id y nota: lo que el repositorio vuelve a escribir');
  assert.equal(form.requiredEngineId, undefined);
  assert.equal(form.onlyUnlicensed, false);
  assert.deepEqual(form.location.country, { code: 'US', name: 'United States' });
  assert.equal(form.location.city?.kind, 'directory', 'con coordenadas, ciudad del directorio');
  assert.equal(form.location.city?.name, 'Miami');
});

test('Editar — una oferta guardada pasa todos los "Continue" y abre con sus pasos', () => {
  const form = offerWizardFormFromOffer(savedOffer());
  assert.deepEqual(offerWizardSteps(form), ['who', 'licence', 'requirements', 'details']);
  for (const step of offerWizardSteps(form)) {
    assert.deepEqual(present(offerWizardStepErrors(form, step)), {}, step);
  }
  assert.equal(firstOfferWizardStepWithErrors(form), null);
});

test('Editar — oferta de motor sin salario y oferta de chapa "sólo sin licencia"', () => {
  const engine = offerWizardFormFromOffer(savedOffer({
    technicianType: 'engine_technician',
    offerKind: 'engine',
    requiredEngineId: 'eng-cfm56-7b',
    requiresCertification: false,
    licenseAuthority: undefined,
    licenseCode: undefined,
    acceptedAuthorities: [],
    acceptedLicenseCode: undefined,
    requiresAllAircraft: false,
    requiredHabilitations: [],
    salary: null,
    locationCityName: undefined,
    locationCityLat: undefined,
    locationCityLng: undefined,
    locationCityGeonameId: undefined,
  }));
  assert.equal(engine.requiredEngineId, 'eng-cfm56-7b');
  assert.equal(engine.salary.enabled, false, 'sin salario: el interruptor arranca apagado');
  assert.equal(engine.location.city, null);
  assert.equal(offerWizardStepLabel(engine, 'requirements'), 'Engine');
  assert.equal(firstOfferWizardStepWithErrors(engine), null);

  const sheet = offerWizardFormFromOffer(savedOffer({
    technicianType: 'sheet_metal_worker',
    requiresCertification: false,
    licenseAuthority: undefined,
    licenseCode: undefined,
    acceptedAuthorities: [],
    acceptedLicenseCode: undefined,
    onlyUnlicensed: true,
  }));
  assert.equal(sheet.onlyUnlicensed, true);
  assert.deepEqual(offerWizardSteps(sheet), ['who', 'requirements', 'details']);
  const who = offerReviewBlocks(sheet, { aircraft: (id) => id, engine: (id) => id })[0];
  assert.deepEqual(who.lines, ['Sheet Metal Worker · Airplanes', ONLY_UNLICENSED_TEXT], 'sin paso 2, la casilla se ve en el paso 1');
});

// ── 6. Escritorio y revisión ───────────────────────────────────────────────

test('Escritorio — la columna de pasos sólo lleva hacia atrás, a uno ya hecho', () => {
  const form = validForm();
  assert.equal(canJumpToOfferWizardStep(form, 'who', 'licence'), false, 'hacia delante sólo con Continue');
  assert.equal(canJumpToOfferWizardStep(form, 'details', 'who'), true);
  assert.equal(canJumpToOfferWizardStep(form, 'details', 'licence'), true);
  assert.equal(canJumpToOfferWizardStep(form, 'details', 'requirements'), true);
  assert.equal(canJumpToOfferWizardStep(form, 'details', 'details'), false, 'el actual no');
  assert.equal(canJumpToOfferWizardStep(form, 'details', 'review'), false);
  for (const step of offerWizardSteps(form)) assert.equal(canJumpToOfferWizardStep(form, 'review', step), true, step);
  const painter = withType(form, 'painter');
  assert.equal(canJumpToOfferWizardStep(painter, 'details', 'licence'), false, 'un paso que no aplica no existe');
});

test('Revisión — un bloque por paso que aplica, cada uno con su paso para "Edit"', () => {
  const blocks = offerReviewBlocks(
    validForm({ salary: { enabled: true, amount: '3200', currency: 'EUR', customCurrency: '', period: 'month' } }),
    { aircraft: (id) => (id === 'rating-a320' ? 'Airbus A320 family — CFM56' : 'Boeing 737 NG — CFM56-7B'), engine: (id) => id },
  );
  assert.deepEqual(blocks.map((b) => b.step), ['who', 'licence', 'requirements', 'details']);
  assert.deepEqual(blocks[0].lines, ['Mechanic · Airplanes']);
  assert.deepEqual(blocks[1].lines, ['Licence required', 'EASA B1.1 — also accepts UK CAA']);
  assert.equal(blocks[2].title, 'Type ratings · any one');
  assert.deepEqual(blocks[2].lines, ['Airbus A320 family — CFM56', 'Boeing 737 NG — CFM56-7B — NG preferred']);
  assert.deepEqual(blocks[3].lines, [
    'B1 Mechanic · A320 family',
    'Permanent · 3+ years of experience',
    '3,200 EUR / month · gross',
    'Barcelona, Spain',
    'Line maintenance on the A320 family.',
  ]);
  const all = offerReviewBlocks(validForm({ requiresAllAircraft: true }), { aircraft: (id) => id, engine: (id) => id });
  assert.equal(all[2].title, 'Type ratings · all of them');
  const noSalary = offerReviewBlocks(validForm({ minYearsExperience: 0 }), { aircraft: (id) => id, engine: (id) => id });
  assert.deepEqual(noSalary[3].lines.slice(1, 3), ['Permanent · No minimum experience', 'No remuneration added']);
});

test('Pantalla final — "live" al publicar, "saved as draft" al guardar el borrador', () => {
  assert.equal(offerWizardDoneCopy('published').title, 'Your offer is live');
  assert.equal(offerWizardDoneCopy('draft').title, 'Saved as draft');
});

test('097 · Motor — carga, revisión y limpieza de la nota en el asistente', () => {
  const form = { ...withType(validForm(), 'engine_technician'), requiredEngineId: 'engine-1', requiredEngineNotes: 'Recent overhaul experience' };
  const labels = { aircraft: (id: string) => id, engine: (_id: string) => 'CFM56-7B' };
  const review = offerReviewBlocks(form, labels).find(b => b.step === 'requirements');
  assert.deepEqual(review?.lines, ['CFM56-7B — Recent overhaul experience']);
  assert.equal(applyOfferRequirementChange(form, { kind: 'engine', value: 'engine-1' }), form);
  const changed = applyOfferRequirementChange(form, { kind: 'engine', value: 'engine-2' });
  assert.equal(changed.requiredEngineNotes, undefined);
  assert.equal(withType(form, 'mechanic').requiredEngineNotes, undefined);
  assert.equal(applyOfferRequirementChange(form, { kind: 'certification', value: false }).requiredEngineNotes, form.requiredEngineNotes);
  const saved = { ...form, id: 'offer', locationCountryCode: 'ES', locationCountry: 'Spain', salary: null } as unknown as OfferWithRequirements;
  assert.equal(offerWizardFormFromOffer(saved).requiredEngineNotes, form.requiredEngineNotes);
  assert.equal(offerWizardFormFromOffer({ ...saved, requiredEngineNotes: null }).requiredEngineNotes, undefined);
  assert.equal(requirementWithNote('CFM56-7B', '   '), 'CFM56-7B');
  assert.equal(requirementWithNote('CFM56-7B', null), 'CFM56-7B');
  assert.equal(requirementWithNote('A320', '  Recent experience  '), 'A320 — Recent experience');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
