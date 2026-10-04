// Fase 10, paso 5b — el formulario de oferta y lo que el repositorio escribe.
//
// Dos mitades:
//   1. offerFormRules, puro: qué enseña el formulario y qué limpia cada cambio.
//   2. offerRepository de verdad contra un PostgREST falso (mismo truco que
//      scripts/testOfferSalary.ts: sólo se sustituye el transporte). Es la
//      prueba de que el selector de autoridad escribe una oferta FAA bien, que
//      es la condición para haber abierto la guarda Part-66 del repositorio.
//      Que Postgres acepte ese INSERT se comprobó aparte contra la base.
//
// Run: npm run test:offer-form
import assert from 'node:assert/strict';
import {
  OfferRequirementsForm,
  describeDropped,
  droppedByTransition,
  requirementsErrors,
  selectAuthority,
  selectLicense,
  technicianTypeHelper,
  selectProductType,
  selectTechnicianType,
  selectableAuthorities,
  selectableLicenses,
  setRequiresCertification,
  showsAcceptedAuthorities,
  acceptableAuthorities,
  acceptedAuthoritiesNote,
  acceptableLicenseCodes,
  aircraftRequirementsCopy,
  selectAcceptedLicenseCode,
  toggleAcceptedAuthority,
  showsAircraftEditor,
  showsCertificationQuestion,
  showsLicenseSection,
  showsOnlyUnlicensed,
} from '../src/utils/offerFormRules';
import { AUTHORITIES, licensesSelectableForOffer } from '../src/constants/licenses';
import { TECHNICIAN_TYPES } from '../src/constants/technicianTypes';
import { offerLicenseDetailText } from '../src/utils/offerRequirementsText';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS — ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL — ${name}`);
    console.error(err instanceof Error ? err.stack ?? err.message : err);
  }
}

const A320 = { aircraftTypeRatingId: 'rating-a320' };

function baseForm(overrides: Partial<OfferRequirementsForm> = {}): OfferRequirementsForm {
  return {
    offerKind: 'aircraft',
    requiredEngineId: undefined,
    productType: 'Aeroplane',
    technicianType: 'mechanic',
    requiresCertification: true,
    licenseAuthority: 'EASA',
    licenseCode: 'B1.1',
    acceptedAuthorities: [],
    onlyUnlicensed: false,
    requiresAllAircraft: false,
    requiredHabilitations: [A320],
    ...overrides,
  };
}

async function main() {
  // ── 1. Reglas del formulario ────────────────────────────────────────────

  await test('Formulario — "Sólo sin licencia" sólo aparece con "No licence needed", en aeronave y en motor', () => {
    assert.equal(showsOnlyUnlicensed(baseForm()), false, 'licencia requerida: no aparece');
    const sinLicencia = setRequiresCertification(baseForm(), false);
    assert.equal(showsOnlyUnlicensed(sinLicencia), true, 'aeronave sin licencia: aparece');
    const motor = selectTechnicianType(sinLicencia, 'engine_technician');
    assert.equal(showsOnlyUnlicensed(motor), true, 'motor sin licencia: aparece');
    // Sesión 2: un motor que pide licencia no puede ser "sólo sin licencia" (077).
    assert.equal(showsOnlyUnlicensed(selectTechnicianType(baseForm(), 'engine_technician')), false, 'motor con B1.1: no aparece');
  });

  await test('Formulario — volver a "Yes, licence required" desmarca "sólo sin licencia"', () => {
    const marcada = { ...setRequiresCertification(baseForm(), false), onlyUnlicensed: true };
    const deVuelta = setRequiresCertification(marcada, true);
    assert.equal(deVuelta.requiresCertification, true);
    assert.equal(deVuelta.onlyUnlicensed, false);
    // Y apagarla no la marca sola.
    assert.equal(setRequiresCertification(baseForm(), false).onlyUnlicensed, false);
  });

  // Sesión 4 (091): antes "pasar a motor … y nombra el oficio de motor", con un
  // selector de clase propio. Ahora se elige el oficio y la clase sale de él.
  await test('Formulario — elegir Engine Technician hace la oferta de motor: limpia aeronaves y una licencia que no certifica motor', () => {
    // Una B2 no vale para motor: se va con su autoridad y sus equivalencias.
    const avionico = baseForm({ technicianType: 'avionic', licenseCode: 'B2', acceptedAuthorities: ['UK_CAA'] });
    const motor = selectTechnicianType(avionico, 'engine_technician');
    assert.equal(motor.offerKind, 'engine');
    assert.equal(motor.requiresCertification, false);
    assert.equal(motor.licenseAuthority, undefined);
    assert.equal(motor.licenseCode, undefined);
    assert.deepEqual(motor.acceptedAuthorities, []);
    assert.deepEqual(motor.requiredHabilitations, []);
    assert.equal(motor.technicianType, 'engine_technician');
    assert.equal(showsAircraftEditor(motor), false);
    assert.equal(showsLicenseSection(motor), false, 'sin licencia elegida no hay sección');
    assert.equal(showsCertificationQuestion(motor), true, 'sesión 2: en motor la pregunta existe (licencia opcional)');
    assert.equal(describeDropped(droppedByTransition(avionico, motor)), 'the B2 licence requirement and 1 aircraft requirement', 'editar tiene qué preguntar');

    // Sesión 2: una B1.1 sí certifica motor y se queda; sólo se van las aeronaves.
    const conB11 = selectTechnicianType(baseForm(), 'engine_technician');
    assert.equal(conB11.licenseCode, 'B1.1');
    assert.equal(conB11.requiresCertification, true);
    assert.deepEqual(conB11.requiredHabilitations, []);
    assert.equal(describeDropped(droppedByTransition(baseForm(), conB11)), '1 aircraft requirement');

    // De vuelta, a cualquier otro oficio: oferta de aeronave, sin motor, con el
    // oficio elegido (antes volvía siempre a mecánico).
    const vuelta = selectTechnicianType({ ...motor, requiredEngineId: 'eng-1' }, 'avionic');
    assert.equal(vuelta.offerKind, 'aircraft');
    assert.equal(vuelta.requiredEngineId, undefined, 'una oferta de aeronave no nombra motor');
    assert.equal(vuelta.technicianType, 'avionic');
    const pintor = selectTechnicianType({ ...conB11, requiredEngineId: 'eng-1' }, 'painter');
    assert.equal(pintor.offerKind, 'aircraft');
    assert.equal(pintor.requiresCertification, false, 'un oficio sin licencias no certifica');
    assert.equal(pintor.licenseCode, undefined);
  });

  await test('Sesión 4 · Formulario — el tipo decide la clase: Engine Technician ⇒ motor sin aeronaves; cualquier otro ⇒ aeronave', () => {
    for (const tipo of TECHNICIAN_TYPES.filter((t) => t.isActive).map((t) => t.code)) {
      const desdeAeronave = selectTechnicianType(baseForm({ technicianType: tipo === 'mechanic' ? 'avionic' : 'mechanic', licenseCode: undefined }), tipo);
      const desdeMotor = selectTechnicianType(selectTechnicianType(baseForm(), 'engine_technician'), tipo);
      const esperada = tipo === 'engine_technician' ? 'engine' : 'aircraft';
      for (const form of [desdeAeronave, desdeMotor]) {
        assert.equal(form.technicianType, tipo);
        assert.equal(form.offerKind, esperada, tipo);
        if (esperada === 'engine') assert.deepEqual(form.requiredHabilitations, [], `${tipo}: sin aeronaves`);
        else assert.equal(form.requiredEngineId, undefined, `${tipo}: sin motor`);
        assert.equal(showsAircraftEditor(form), esperada === 'aircraft', tipo);
      }
    }
    assert.ok(technicianTypeHelper(selectTechnicianType(baseForm(), 'engine_technician')).includes('one engine and no aircraft'));
    assert.ok(technicianTypeHelper(baseForm()).includes('Engine Technician makes this an engine offer'));
  });

  await test('Formulario — motor: la licencia es opcional y los chips sólo ofrecen B1.x, P y A&P', () => {
    const motor = selectTechnicianType(baseForm({ requiresCertification: false, licenseAuthority: undefined, licenseCode: undefined }), 'engine_technician');
    assert.equal(showsLicenseSection(motor), false);
    const pide = setRequiresCertification(motor, true);
    assert.equal(showsLicenseSection(pide), true);
    assert.equal(requirementsErrors({ ...pide, requiredEngineId: 'eng-1' }).license, 'Select the licence this role certifies under.');
    assert.deepEqual(selectableLicenses({ ...pide, licenseAuthority: 'FAA' }), ['P', 'A&P']);
    assert.deepEqual(selectableLicenses({ ...pide, licenseAuthority: 'EASA' }), ['B1.1', 'B1.2'], 'aviones');
    assert.deepEqual(selectableLicenses({ ...pide, licenseAuthority: 'UK_CAA', productType: 'Helicopter' }), ['B1.3', 'B1.4'], 'helicópteros');
    assert.deepEqual(selectableAuthorities(pide, AUTHORITIES.map((a) => a.code)), ['EASA', 'UK_CAA', 'CASA', 'GCAA', 'FAA']);
    // Un motor FAA P que vuelve a aeronave conserva la P: la pide un mecánico.
    const faaP = selectLicense(selectAuthority(pide, 'FAA'), 'P');
    assert.equal(selectTechnicianType(faaP, 'mechanic').licenseCode, 'P');
  });

  await test('Formulario — sin autoridad no hay licencias que elegir, y el error pide la autoridad', () => {
    const sinAutoridad = baseForm({ licenseAuthority: undefined, licenseCode: undefined });
    assert.deepEqual(selectableLicenses(sinAutoridad), []);
    const errores = requirementsErrors(sinAutoridad);
    assert.ok(errores.authority);
    assert.ok(errores.license);
    assert.deepEqual(requirementsErrors(baseForm()), { authority: undefined, license: undefined, engine: undefined, acceptedLicense: undefined });
    assert.ok(requirementsErrors(selectTechnicianType(baseForm(), 'engine_technician')).engine, 'motor sin motor elegido');
  });

  await test('Formulario — FAA: mecánico ve A, P y A&P; aviónico ve A y A&P; las equivalencias Part-66 se van', () => {
    const faa = selectAuthority(baseForm({ acceptedAuthorities: ['UK_CAA', 'CASA'] }), 'FAA');
    assert.equal(faa.licenseCode, undefined, 'B1.1 no existe en la FAA');
    assert.deepEqual(faa.requiredHabilitations, [], 'las aeronaves colgaban de la B1.1 que se fue');
    assert.deepEqual(faa.acceptedAuthorities, [], 'las aceptadas de la oferta EASA no significan nada en una FAA');
    assert.equal(faa.acceptedLicenseCode, undefined);
    // 096: una oferta FAA de mecánico sí tiene categorías Part-66 que aceptar.
    assert.equal(showsAcceptedAuthorities(faa), true);
    assert.deepEqual(selectableLicenses(faa), ['A', 'P', 'A&P']);

    const conAyP = selectLicense(faa, 'A&P');
    assert.equal(conAyP.licenseCode, 'A&P');

    // Sesión 2: aviónica puede pedir A o A&P a la FAA; P no.
    const avionico = baseForm({ technicianType: 'avionic', licenseCode: 'B2' });
    assert.ok(selectableAuthorities(avionico, AUTHORITIES.map((a) => a.code)).includes('FAA'));
    assert.deepEqual(selectableLicenses({ ...avionico, licenseAuthority: 'FAA', licenseCode: undefined }), ['A', 'A&P']);
    // Un mecánico FAA A&P que pasa a aviónico conserva autoridad y licencia;
    // con P, la licencia se va.
    const aAvionico = selectTechnicianType(conAyP, 'avionic');
    assert.equal(aAvionico.licenseAuthority, 'FAA');
    assert.equal(aAvionico.licenseCode, 'A&P');
    assert.equal(selectTechnicianType(selectLicense(faa, 'P'), 'avionic').licenseCode, undefined);
  });

  await test('Formulario — FAA con aeronaves: el editor aparece y cambiar A por A&P no se lleva la experiencia', () => {
    const faa = baseForm({ licenseAuthority: 'FAA', licenseCode: 'A', requiredHabilitations: [A320] });
    assert.equal(showsAircraftEditor(faa), true, 'sesión 2: las aeronaves se piden como experiencia');
    assert.deepEqual(selectLicense(faa, 'A&P').requiredHabilitations, [A320], 'no cuelgan de la licencia');
    // Part-66 no cambia: cambiar de licencia sigue limpiando las aeronaves.
    assert.deepEqual(selectLicense(baseForm(), 'B1.2').requiredHabilitations, []);
    // Sin licencia elegida, pasar de EASA a la FAA conserva las aeronaves.
    const sinLicencia = baseForm({ licenseCode: undefined });
    assert.deepEqual(selectAuthority(sinLicencia, 'FAA').requiredHabilitations, [A320]);
  });

  await test('Formulario — cambiar entre Part-66 conserva la licencia y sus aeronaves si existe; CASA se lleva la B3', () => {
    const uk = selectAuthority(baseForm({ acceptedAuthorities: ['UK_CAA', 'CASA'] }), 'UK_CAA');
    assert.equal(uk.licenseCode, 'B1.1');
    assert.deepEqual(uk.requiredHabilitations, [A320]);
    assert.deepEqual(uk.acceptedAuthorities, ['CASA'], 'la nueva exigida sale de la lista; CASA se queda');
    assert.equal(showsAcceptedAuthorities(uk), true);

    const b3 = baseForm({ licenseCode: 'B3' });
    const casa = selectAuthority(b3, 'CASA');
    assert.equal(casa.licenseCode, undefined, 'CASA no emite B3');
    assert.deepEqual(casa.requiredHabilitations, []);
    assert.ok(!selectableLicenses(casa).includes('B3'));
  });

  await test('Formulario — "Also accept licences from:": chips de las otras Part-66 que emiten la categoría, y la FAA al final', () => {
    const easa = baseForm();
    assert.deepEqual(acceptableAuthorities(easa), ['UK_CAA', 'CASA', 'GCAA', 'FAA']);
    assert.equal(showsAcceptedAuthorities(easa), true);
    assert.deepEqual(easa.acceptedAuthorities, [], 'ninguna marcada de entrada: sólo la exacta');

    // Marcar y desmarcar, en el orden del catálogo.
    const conCasa = toggleAcceptedAuthority(easa, 'CASA');
    const conDos = toggleAcceptedAuthority(conCasa, 'UK_CAA');
    assert.deepEqual(conDos.acceptedAuthorities, ['UK_CAA', 'CASA']);
    assert.deepEqual(toggleAcceptedAuthority(conDos, 'CASA').acceptedAuthorities, ['UK_CAA']);

    // Una categoría que CASA y GCAA no emiten no los ofrece.
    assert.deepEqual(acceptableAuthorities(baseForm({ technicianType: 'avionic', licenseCode: 'B2L' })), ['UK_CAA', 'FAA']);
    // Sin licencia elegida no hay fila. 096: con la FAA, sí (categorías Part-66).
    assert.equal(showsAcceptedAuthorities(baseForm({ licenseCode: undefined })), false);
    assert.equal(showsAcceptedAuthorities(baseForm({ licenseAuthority: 'FAA', licenseCode: 'A&P' })), true);
    // Parte 3: la FAA junto a las demás en cualquier oferta Part-66 con B1.1.
    for (const authority of ['EASA', 'UK_CAA', 'CASA', 'GCAA'] as const) {
      assert.ok(acceptableAuthorities(baseForm({ licenseAuthority: authority })).includes('FAA'), authority);
    }
  });

  await test('Formulario — parte 3: la FAA se marca con una B1.1, no aparece con una C, y pasar a C la quita; la nota dice qué certificado cuenta', () => {
    const conFaa = toggleAcceptedAuthority(toggleAcceptedAuthority(baseForm(), 'FAA'), 'UK_CAA');
    assert.deepEqual(conFaa.acceptedAuthorities, ['UK_CAA', 'FAA'], 'en el orden del catálogo');

    // Licencia C: la FAA no se ofrece ni se puede marcar.
    const c = baseForm({ licenseCode: 'C', requiredHabilitations: [] });
    assert.ok(!acceptableAuthorities(c).includes('FAA'));
    assert.deepEqual(toggleAcceptedAuthority(c, 'FAA').acceptedAuthorities, []);
    // Cambiar a C con la FAA marcada la quita, como cualquier otra que deje de valer.
    assert.deepEqual(selectLicense(conFaa, 'C').acceptedAuthorities, ['UK_CAA']);
    // Y pasar la oferta a la FAA se lleva la lista entera.
    assert.deepEqual(selectAuthority(conFaa, 'FAA').acceptedAuthorities, []);

    // La nota: con la FAA marcada, "la misma categoría" sería falso.
    assert.equal(acceptedAuthoritiesNote(baseForm()), 'None selected: only EASA B1.1 counts.');
    assert.equal(
      acceptedAuthoritiesNote(baseForm({ acceptedAuthorities: ['UK_CAA'] })),
      'The same B1.1 category from these authorities scores slightly below an exact EASA match.',
    );
    assert.equal(
      acceptedAuthoritiesNote(conFaa),
      'Accepted licences score slightly below an exact EASA match. From the FAA, A&P counts for B1.1.',
    );
    assert.equal(
      acceptedAuthoritiesNote(baseForm({ licenseCode: 'A1', requiredHabilitations: [], acceptedAuthorities: ['FAA'] })),
      'Accepted licences score slightly below an exact EASA match. From the FAA, A or A&P counts for A1.',
    );
  });

  await test('Formulario — la sección de aeronaves dice con qué se compara cada una: type rating Part-66, experiencia FAA o las dos sin licencia', () => {
    const part66 = aircraftRequirementsCopy(baseForm());
    assert.equal(part66.title, 'Required type ratings');
    assert.equal(part66.rowTag, 'Type rating');
    assert.equal(part66.pickerLabel, 'Aircraft + engine rating');
    assert.equal(
      part66.subtitle,
      "Search and add the aircraft this role works on. They are matched against type ratings held under the offer's B1.1 licence; declared aircraft experience does not count. Limited to airplanes, as set above.",
    );

    const faa = aircraftRequirementsCopy(baseForm({ licenseAuthority: 'FAA', licenseCode: 'A&P' }));
    assert.equal(faa.title, 'Aircraft experience');
    assert.equal(faa.rowTag, 'Experience');
    assert.equal(faa.pickerLabel, 'Aircraft + engine', 'sin "rating": no se pide ninguno');
    assert.equal(
      faa.subtitle,
      'Search and add the aircraft this role works on. Either a type rating, from any authority, or declared experience on the aircraft counts, signed off or not. Limited to airplanes, as set above.',
    );
    // A, P y A&P dicen lo mismo: la firma no distingue ofertas FAA.
    for (const code of ['A', 'P'] as const) {
      assert.deepEqual(aircraftRequirementsCopy(baseForm({ licenseAuthority: 'FAA', licenseCode: code })), faa, code);
    }

    const sinLicencia = aircraftRequirementsCopy(setRequiresCertification(baseForm(), false));
    assert.equal(sinLicencia.title, 'Aircraft experience');
    assert.equal(sinLicencia.rowTag, 'Experience');
    assert.equal(sinLicencia.pickerLabel, 'Aircraft + engine');
    assert.equal(
      sinLicencia.subtitle,
      'Search and add the aircraft this role works on. Either a type rating or declared experience on the aircraft counts. Limited to airplanes, as set above.',
    );
    assert.ok(
      aircraftRequirementsCopy(setRequiresCertification(baseForm({ productType: 'Helicopter' }), false)).subtitle.endsWith('Limited to helicopters, as set above.'),
    );
  });

  await test('Formulario — aeronaves: con la FAA aceptada, la frase de la aeronave firmada; licencia pedida sin elegir, ya los textos Part-66', () => {
    const conFaa = aircraftRequirementsCopy(baseForm({ acceptedAuthorities: ['FAA'] }));
    assert.equal(conFaa.title, 'Required type ratings');
    assert.equal(
      conFaa.subtitle,
      "Search and add the aircraft this role works on. They are matched against type ratings held under the offer's B1.1 licence; declared aircraft experience does not count. Limited to airplanes, as set above. For an FAA certificate holder, an aircraft they have signed off on counts as a type rating.",
    );
    // Otra Part-66 aceptada no la añade: allí no hay firma que cuente.
    assert.equal(aircraftRequirementsCopy(baseForm({ acceptedAuthorities: ['UK_CAA'] })).subtitle, aircraftRequirementsCopy(baseForm()).subtitle);

    const sinCodigo = "Search and add the aircraft this role works on. They are matched against type ratings held under the offer's licence; declared aircraft experience does not count. Limited to airplanes, as set above.";
    const sinAutoridad = aircraftRequirementsCopy(baseForm({ licenseAuthority: undefined, licenseCode: undefined }));
    assert.equal(sinAutoridad.title, 'Required type ratings');
    assert.equal(sinAutoridad.subtitle, sinCodigo);
    assert.equal(aircraftRequirementsCopy(baseForm({ licenseAuthority: 'UK_CAA', licenseCode: undefined })).subtitle, sinCodigo);
    // Con la FAA elegida, aunque falte el código, ya son experiencia.
    assert.equal(aircraftRequirementsCopy(baseForm({ licenseAuthority: 'FAA', licenseCode: undefined })).title, 'Aircraft experience');
  });

  // ── 096: una oferta FAA acepta una licencia Part-66 ─────────────────────

  const faaForm = (overrides: Partial<OfferRequirementsForm> = {}) =>
    baseForm({ licenseAuthority: 'FAA', licenseCode: 'A&P', requiredHabilitations: [], ...overrides });

  await test('096 · Formulario — las categorías de una oferta FAA son las de una Part-66 del mismo tipo y producto, sin la C', () => {
    assert.deepEqual(acceptableLicenseCodes(faaForm({ technicianType: 'avionic' })), ['B2', 'B2L']);
    assert.deepEqual(acceptableLicenseCodes(faaForm()), ['A1', 'A2', 'B1.1', 'B1.2', 'B3', 'L']);
    assert.deepEqual(acceptableLicenseCodes(faaForm({ productType: 'Helicopter' })), ['A3', 'A4', 'B1.3', 'B1.4']);
    // Contraste: en una oferta Part-66 el mismo oficio sí ve la C; aquí no.
    assert.ok(selectableLicenses(baseForm({ technicianType: 'avionic', licenseCode: 'B2' })).includes('C'));
    // Fuera de la FAA no hay chips de categoría.
    assert.deepEqual(acceptableLicenseCodes(baseForm()), []);
    // Por defecto nada marcado: sólo cuenta la licencia FAA.
    assert.deepEqual(faaForm().acceptedAuthorities, []);
    assert.equal(faaForm().acceptedLicenseCode, undefined);
    assert.equal(acceptedAuthoritiesNote(faaForm()), 'None selected: only FAA A&P counts.');
  });

  await test('096 · Formulario — una sola categoría: elegir otra sustituye a la anterior; las autoridades son las que la emiten', () => {
    const conB2 = selectAcceptedLicenseCode(faaForm({ technicianType: 'avionic' }), 'B2');
    assert.equal(conB2.acceptedLicenseCode, 'B2');
    const conB2L = selectAcceptedLicenseCode(conB2, 'B2L');
    assert.equal(conB2L.acceptedLicenseCode, 'B2L', 'no se pueden marcar dos: la nueva sustituye');
    assert.equal(selectAcceptedLicenseCode(conB2L, 'B2L').acceptedLicenseCode, undefined, 'tocar la elegida la quita');
    assert.equal(selectAcceptedLicenseCode(conB2, 'C').acceptedLicenseCode, 'B2', 'la C no se puede elegir');

    // Sin categoría, las cuatro Part-66; con B2L, sólo las que la emiten.
    assert.deepEqual(acceptableAuthorities(faaForm()), ['EASA', 'UK_CAA', 'CASA', 'GCAA']);
    assert.deepEqual(acceptableAuthorities(conB2L), ['EASA', 'UK_CAA']);
    // Marcar CASA y después elegir B2L la desmarca.
    const casaYEasa = toggleAcceptedAuthority(toggleAcceptedAuthority(faaForm({ technicianType: 'avionic' }), 'CASA'), 'EASA');
    assert.deepEqual(casaYEasa.acceptedAuthorities, ['EASA', 'CASA']);
    assert.deepEqual(selectAcceptedLicenseCode(casaYEasa, 'B2L').acceptedAuthorities, ['EASA']);

    const completa = toggleAcceptedAuthority(toggleAcceptedAuthority(conB2, 'EASA'), 'UK_CAA');
    assert.equal(acceptedAuthoritiesNote(completa), 'EASA or UK CAA B2 also counts.');
  });

  await test('096 · Formulario — no se guarda con autoridades sin categoría, ni con categoría sin autoridades', () => {
    const soloAutoridades = toggleAcceptedAuthority(faaForm(), 'EASA');
    assert.equal(requirementsErrors(soloAutoridades).acceptedLicense, 'Pick the licence category the accepted authorities must have issued.');
    const soloCategoria = selectAcceptedLicenseCode(faaForm(), 'B1.1');
    assert.equal(requirementsErrors(soloCategoria).acceptedLicense, 'Pick at least one authority whose B1.1 counts.');
    assert.equal(requirementsErrors(selectAcceptedLicenseCode(soloAutoridades, 'B1.1')).acceptedLicense, undefined, 'las dos juntas, sí');
    assert.equal(requirementsErrors(faaForm()).acceptedLicense, undefined, 'ninguna de las dos, también');
    // A medio elegir la nota no dice nada: lo dice el error.
    assert.equal(acceptedAuthoritiesNote(soloAutoridades), '');
  });

  await test('096 · Formulario — salir de la FAA, quitar la licencia o cambiar tipo o producto limpian; cambiar A por A&P no', () => {
    const completa = selectAcceptedLicenseCode(toggleAcceptedAuthority(faaForm({ licenseCode: 'A' }), 'EASA'), 'B1.1');
    const limpia = (f: OfferRequirementsForm) => ({ authorities: f.acceptedAuthorities, code: f.acceptedLicenseCode });
    assert.deepEqual(limpia(selectAuthority(completa, 'EASA')), { authorities: [], code: undefined }, 'pasar a Part-66');
    assert.deepEqual(limpia(setRequiresCertification(completa, false)), { authorities: [], code: undefined }, 'sin licencia');
    assert.deepEqual(limpia(selectTechnicianType(completa, 'avionic')), { authorities: [], code: undefined }, 'B1.1 no es de aviónico');
    assert.deepEqual(limpia(selectProductType(completa, 'Helicopter')), { authorities: [], code: undefined }, 'B1.1 no es de helicópteros');
    assert.deepEqual(limpia(selectLicense(completa, 'A&P')), { authorities: ['EASA'], code: 'B1.1' }, 'A por A&P no toca nada');
    // A motor: la A&P se queda y la B1.1 cabe en una oferta de motor de aviones.
    const motor = selectTechnicianType(selectLicense(completa, 'A&P'), 'engine_technician');
    assert.deepEqual(limpia(motor), { authorities: ['EASA'], code: 'B1.1' });
    // Una A1 aceptada no cabe en una oferta de motor.
    const conA1 = selectAcceptedLicenseCode(toggleAcceptedAuthority(faaForm(), 'EASA'), 'A1');
    assert.deepEqual(limpia(selectTechnicianType(conA1, 'engine_technician')), { authorities: [], code: undefined });
  });

  // 2026-10-04: el type rating cuenta para todos en una oferta FAA, así que la
  // frase aparte para el titular de la Part-66 aceptada se retiró.
  await test('096 · Formulario — el subtítulo de aeronaves FAA no cambia al aceptar una Part-66', () => {
    const conA320 = faaForm({ requiredHabilitations: [A320] });
    const sinEquivalente = aircraftRequirementsCopy(conA320).subtitle;
    const completa = selectAcceptedLicenseCode(toggleAcceptedAuthority(conA320, 'EASA'), 'B1.1');
    assert.equal(aircraftRequirementsCopy(completa).subtitle, sinEquivalente);
    assert.equal(aircraftRequirementsCopy(toggleAcceptedAuthority(conA320, 'EASA')).subtitle, sinEquivalente);
    assert.ok(!sinEquivalente.includes('Part-66'), sinEquivalente);
  });

  await test('096 · Detalle de oferta — la licencia FAA dice qué Part-66 acepta, con su categoría; las Part-66 no cambian', () => {
    assert.equal(
      offerLicenseDetailText({ licenseCode: 'A&P', licenseAuthority: 'FAA', acceptedAuthorities: ['EASA', 'UK_CAA'], acceptedLicenseCode: 'B2' }),
      'FAA A&P — also accepts EASA or UK CAA B2',
    );
    assert.equal(
      offerLicenseDetailText({ licenseCode: 'A', licenseAuthority: 'FAA', acceptedAuthorities: ['GCAA'], acceptedLicenseCode: 'A1' }),
      'FAA A — also accepts UAE GCAA A1',
    );
    assert.equal(offerLicenseDetailText({ licenseCode: 'A&P', licenseAuthority: 'FAA', acceptedAuthorities: [] }), 'FAA A&P');
    assert.equal(
      offerLicenseDetailText({ licenseCode: 'B1.1', licenseAuthority: 'EASA', acceptedAuthorities: ['UK_CAA', 'CASA'] }),
      'EASA B1.1 — also accepts UK CAA, CASA (Australia)',
    );
  });

  // 2026-10-04: la FAA aceptada dice qué certificado cuenta, por la tabla de la 095.
  await test('Detalle de oferta — una Part-66 que acepta la FAA dice qué certificado FAA cuenta', () => {
    assert.equal(
      offerLicenseDetailText({ licenseCode: 'B1.1', licenseAuthority: 'EASA', acceptedAuthorities: ['UK_CAA', 'FAA'] }),
      'EASA B1.1 — also accepts UK CAA, FAA A&P',
    );
    assert.equal(offerLicenseDetailText({ licenseCode: 'B2', licenseAuthority: 'UK_CAA', acceptedAuthorities: ['FAA'] }), 'UK CAA B2 — also accepts FAA A&P');
    assert.equal(offerLicenseDetailText({ licenseCode: 'A1', licenseAuthority: 'EASA', acceptedAuthorities: ['FAA'] }), 'EASA A1 — also accepts FAA A or A&P');
  });

  await test('Formulario — cambiar la licencia limpia las aceptadas que ya no aplican', () => {
    const marcadas = baseForm({ licenseCode: 'B3', acceptedAuthorities: ['UK_CAA', 'GCAA'] });
    // GCAA emite B3: pasar a GCAA como exigida la saca de la lista y deja UK.
    assert.deepEqual(selectAuthority(marcadas, 'GCAA').acceptedAuthorities, ['UK_CAA'], 'la nueva exigida sale');
    const todas = baseForm({ acceptedAuthorities: ['UK_CAA', 'CASA', 'GCAA'] });
    assert.deepEqual(selectLicense(todas, 'B3').acceptedAuthorities, ['UK_CAA', 'GCAA'], 'CASA no emite B3');
    assert.deepEqual(setRequiresCertification(todas, false).acceptedAuthorities, [], 'sin licencia, sin lista');
    assert.deepEqual(selectAuthority(todas, 'FAA').acceptedAuthorities, [], 'la FAA no acepta a nadie');
    assert.deepEqual(selectTechnicianType(todas, 'painter').acceptedAuthorities, []);
    assert.deepEqual(selectProductType(todas, 'Helicopter').acceptedAuthorities, [], 'la B1.1 se va con el producto');
  });

  await test('Formulario — lo que ofrecen los chips es lo que acepta la guarda del repositorio', () => {
    for (const technicianType of ['mechanic', 'avionic', 'painter'] as const) {
      for (const { code: authority } of AUTHORITIES) {
        for (const productType of ['Aeroplane', 'Helicopter'] as const) {
          const form = baseForm({ technicianType, licenseAuthority: authority, productType, licenseCode: undefined });
          const guard = licensesSelectableForOffer({ offerKind: 'aircraft', technicianType }, authority);
          for (const code of selectableLicenses(form)) {
            assert.ok(guard.includes(code), `${technicianType} ${authority} ${productType}: el chip ${code} lo rechazaría el repositorio`);
          }
        }
      }
    }
  });

  await test('Formulario — cambiar de producto no se lleva una licencia FAA (no distingue aviones de helicópteros)', () => {
    const faa = selectLicense(selectAuthority(baseForm(), 'FAA'), 'A&P');
    assert.equal(selectProductType(faa, 'Helicopter').licenseCode, 'A&P');
    assert.equal(selectProductType(baseForm(), 'Helicopter').licenseCode, undefined, 'la B1.1 sí se va');
  });

  // ── 2. El repositorio contra un PostgREST falso ────────────────────────

  type Call = {
    table: string;
    op: 'insert' | 'update' | 'delete' | 'select' | 'upsert' | 'rpc';
    data?: Record<string, unknown>;
    inArgs?: [string, unknown[]];
    onConflict?: string;
  };
  const calls: Call[] = [];
  let offerRow: Record<string, unknown> = {};
  let habilitationRows: Record<string, unknown>[] = [];
  // Tablas del técnico, para technicianRepositoryV2.
  let licenseRows: Record<string, unknown>[] = [];
  let licenseDependents: Record<string, unknown>[] = [];
  let profileTypeRows: string[] = [];
  // offer_applications, para offerApplicationRepository (paso 5c). La base de
  // verdad rechaza con el trigger de la 080; aquí se simula su respuesta.
  let applicationRows: Record<string, unknown>[] = [];
  let applicationRejection: { code: string; message: string; details: string } | null = null;

  const fakeSupabase = {
    async rpc(name: string, args: Record<string, any>) {
      calls.push({ table: name, op: 'rpc', data: args });
      if (name === 'update_offer_with_habilitations') {
        const oldProduct = offerRow.product_type;
        offerRow = { ...offerRow, ...args.p_patch };
        if (args.p_habilitations !== null) habilitationRows = args.p_habilitations.map((h: any) => ({ ...h, offer_id: args.p_offer_id, product_type: offerRow.product_type }));
        else if (oldProduct !== offerRow.product_type || offerRow.offer_kind === 'engine') habilitationRows = [];
        return { data: [{ ...offerRow }], error: null };
      }
      return { data: null, error: null };
    },
    from(table: string) {
      let op: Call['op'] = 'select';
      let write: Record<string, unknown> | Record<string, unknown>[] | undefined;
      let one = false;
      let inArgs: [string, unknown[]] | undefined;
      let onConflict: string | undefined;
      const query = {
        select() { return query; },
        eq() { return query; }, order() { return query; },
        in(column: string, values: unknown[]) { inArgs = [column, values]; return query; },
        delete() { op = 'delete'; return query; },
        insert(data: Record<string, unknown> | Record<string, unknown>[]) { op = 'insert'; write = data; return query; },
        upsert(data: Record<string, unknown>[], options: { onConflict: string }) { op = 'upsert'; write = data; onConflict = options.onConflict; return query; },
        update(data: Record<string, unknown>) { op = 'update'; write = data; return query; },
        single() { one = true; return query; },
        maybeSingle() { one = true; return query; },
        then(resolve: (result: unknown) => unknown) {
          calls.push({ table, op, data: Array.isArray(write) ? { rows: write } : write, inArgs, onConflict });
          if (table === 'technician_licenses') {
            if (op === 'delete' && inArgs) {
              const ids = inArgs[1];
              const deleted = licenseRows.filter((r) => ids.includes(r.id));
              licenseRows = licenseRows.filter((r) => !ids.includes(r.id));
              return Promise.resolve({ data: deleted.map((r) => ({ id: r.id })), error: null }).then(resolve);
            }
            if (op === 'upsert') return Promise.resolve({ data: write, error: null }).then(resolve);
            return Promise.resolve({ data: licenseRows, error: null }).then(resolve);
          }
          if (table === 'technician_habilitations') {
            return Promise.resolve({ data: licenseDependents, error: null }).then(resolve);
          }
          if (table === 'technician_profile_types') {
            if (op === 'insert' && Array.isArray(write)) {
              const added = write.map((r) => r.type_code as string);
              profileTypeRows = [...profileTypeRows, ...added];
              return Promise.resolve({ data: added.map((type_code) => ({ type_code })), error: null }).then(resolve);
            }
            if (op === 'delete' && inArgs) {
              const removed = profileTypeRows.filter((c) => inArgs![1].includes(c));
              profileTypeRows = profileTypeRows.filter((c) => !inArgs![1].includes(c));
              return Promise.resolve({ data: removed.map((type_code) => ({ type_code })), error: null }).then(resolve);
            }
            return Promise.resolve({ data: profileTypeRows.map((type_code) => ({ type_code })), error: null }).then(resolve);
          }
          if (table === 'technician_engine_experience') {
            return Promise.resolve({ data: op === 'insert' ? write : [], error: null }).then(resolve);
          }
          if (table === 'offer_applications') {
            if ((op === 'insert' || op === 'update') && applicationRejection) {
              return Promise.resolve({ data: null, error: applicationRejection }).then(resolve);
            }
            if (op === 'insert' && write && !Array.isArray(write)) {
              const row = { id: 'app-1', status: 'pending', identity_revealed: false, documents_unlocked: false, created_at: '2026-09-16', updated_at: '2026-09-16', ...write };
              applicationRows = [row];
              return Promise.resolve({ data: row, error: null }).then(resolve);
            }
            if (op === 'update' && write && !Array.isArray(write)) {
              applicationRows = applicationRows.map((r) => ({ ...r, ...write }));
              return Promise.resolve({ data: applicationRows[0], error: null }).then(resolve);
            }
            return Promise.resolve({ data: applicationRows, error: null }).then(resolve);
          }
          if (table === 'offers') {
            if (write && !Array.isArray(write)) offerRow = { id: 'offer-1', created_at: '2026-09-16', updated_at: '2026-09-16', ...offerRow, ...write };
            if (op === 'delete') return Promise.resolve({ data: [{ id: 'offer-1' }], error: null }).then(resolve);
            return Promise.resolve({ data: one ? { ...offerRow } : [{ ...offerRow }], error: null }).then(resolve);
          }
          if (table === 'offer_required_habilitations') {
            if (op === 'delete') habilitationRows = [];
            if (op === 'insert' && Array.isArray(write)) habilitationRows = write;
            if (op === 'select') return Promise.resolve({ data: habilitationRows, error: null }).then(resolve);
            return Promise.resolve({ data: op === 'insert' ? habilitationRows : [], error: null }).then(resolve);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  const modulePath = require.resolve('../src/lib/supabase');
  require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: { supabase: fakeSupabase } } as NodeModule;
  const { offerRepository } = require('../src/repositories/v2/offerRepository') as typeof import('../src/repositories/v2/offerRepository');

  const base = {
    companyId: 'company-1',
    title: 'Offer',
    description: 'Offer',
    contractType: 'permanent' as const,
    productType: 'Aeroplane' as const,
    location: { country: { code: 'ES', name: 'Spain' }, city: null },
    minYearsExperience: 0,
  };
  const lastWrite = (table: string, op: Call['op']) => table === 'offers' && op === 'update'
    ? ([...calls].reverse().find((c) => c.table === 'update_offer_with_habilitations')?.data?.p_patch as Record<string, unknown> ?? {})
    : [...calls].reverse().find((c) => c.table === table && c.op === op)?.data ?? {};
  const reset = () => { calls.length = 0; offerRow = {}; habilitationRows = []; };

  await test('Repositorio — una oferta FAA A&P se escribe con su autoridad, y sale igual al leerla', async () => {
    reset();
    const creada = await offerRepository.create({
      ...base,
      technicianType: 'mechanic',
      requiresCertification: true,
      licenseAuthority: 'FAA',
      licenseCode: 'A&P',
    });
    const fila = lastWrite('offers', 'insert');
    assert.equal(fila.license_code, 'A&P');
    assert.equal(fila.license_authority, 'FAA');
    assert.equal(fila.offer_kind, 'aircraft');
    assert.deepEqual(fila.accepted_authorities, []);
    assert.equal(fila.only_unlicensed, false);
    assert.equal(fila.required_engine_id, null);
    assert.equal(creada.licenseAuthority, 'FAA');
    assert.equal(creada.licenseCode, 'A&P');
  });

  await test('Repositorio — rechaza lo que el formulario no ofrece: P FAA en aviónica, licencia sin autoridad, B1.1 FAA', async () => {
    reset();
    const certifica = { ...base, requiresCertification: true };
    await assert.rejects(offerRepository.create({ ...certifica, technicianType: 'avionic', licenseAuthority: 'FAA', licenseCode: 'P' }), /not a licence/);
    await assert.rejects(offerRepository.create({ ...certifica, technicianType: 'mechanic', licenseCode: 'B1.1' }), /authority/);
    await assert.rejects(offerRepository.create({ ...certifica, technicianType: 'mechanic', licenseAuthority: 'FAA', licenseCode: 'B1.1' }), /does not issue/);
    assert.equal(calls.filter((c) => c.op !== 'select').length, 0, 'nada se escribió');
  });

  await test('Repositorio — sesión 2: aviónica FAA A&P y una oferta FAA con aeronaves se escriben', async () => {
    reset();
    await offerRepository.create({ ...base, technicianType: 'avionic', requiresCertification: true, licenseAuthority: 'FAA', licenseCode: 'A&P' });
    assert.equal(lastWrite('offers', 'insert').technician_type, 'avionic');

    reset();
    await offerRepository.create({
      ...base, technicianType: 'mechanic', requiresCertification: true, licenseAuthority: 'FAA', licenseCode: 'A&P', requiredHabilitations: [A320],
    });
    assert.deepEqual(habilitationRows.map((h) => h.aircraft_type_rating_id), ['rating-a320'], 'las aeronaves llegan a la RPC');
    // Un patch posterior sin lista nueva no las vacía (la 086 quita la cláusula FAA).
    await offerRepository.update('offer-1', { title: 'Renamed' });
    assert.equal(habilitationRows.length, 1);
  });

  await test('Repositorio — oferta de motor con "sólo sin licencia": offer_kind, motor y filtro en la fila; sin licencia', async () => {
    reset();
    // Sesión 4 (091): la clase no se manda; sale de technicianType.
    const creada = await offerRepository.create({
      ...base,
      technicianType: 'engine_technician',
      requiresCertification: false,
      requiredEngineId: 'eng-cfm56-7b',
      onlyUnlicensed: true,
    });
    const fila = lastWrite('offers', 'insert');
    assert.equal(fila.offer_kind, 'engine');
    assert.equal(fila.technician_type, 'engine_technician');
    assert.equal(fila.required_engine_id, 'eng-cfm56-7b');
    assert.equal(fila.only_unlicensed, true);
    assert.equal(fila.license_code, null);
    assert.equal(fila.license_authority, null);
    assert.equal(creada.offerKind, 'engine');

    await assert.rejects(offerRepository.create({ ...base, technicianType: 'engine_technician', requiresCertification: false }), /must name the engine/);
    // Sesión 2: licencia opcional en motor, sólo B1.x, P o A&P.
    await offerRepository.create({
      ...base, technicianType: 'engine_technician', requiredEngineId: 'eng-cfm56-7b',
      requiresCertification: true, licenseAuthority: 'FAA', licenseCode: 'A&P',
    });
    const conLicencia = lastWrite('offers', 'insert');
    assert.equal(conLicencia.license_code, 'A&P');
    assert.equal(conLicencia.requires_certification, true);
    await offerRepository.create({
      ...base, technicianType: 'engine_technician', requiredEngineId: 'eng-cfm56-7b',
      requiresCertification: true, licenseAuthority: 'EASA', licenseCode: 'B1.1',
    });
    for (const [licenseAuthority, licenseCode] of [['EASA', 'B2'], ['EASA', 'C'], ['FAA', 'A']] as const) {
      await assert.rejects(
        offerRepository.create({
          ...base, technicianType: 'engine_technician', requiredEngineId: 'eng-cfm56-7b',
          requiresCertification: true, licenseAuthority, licenseCode,
        }),
        /Part-66 B1 licence or an FAA P or A&P/,
        `${licenseAuthority} ${licenseCode}`,
      );
    }
    await assert.rejects(
      offerRepository.create({ ...base, technicianType: 'engine_technician', requiresCertification: false, requiredEngineId: 'e', requiredHabilitations: [A320] }),
      /cannot require aircraft/,
    );
    await assert.rejects(
      offerRepository.create({ ...base, technicianType: 'mechanic', requiresCertification: true, licenseAuthority: 'EASA', licenseCode: 'B1.1', onlyUnlicensed: true }),
      /without a licence/,
    );
    // Aeronave sin licencia con el filtro: válida.
    await offerRepository.create({ ...base, technicianType: 'painter', requiresCertification: false, onlyUnlicensed: true });
    assert.equal(lastWrite('offers', 'insert').only_unlicensed, true);
    // Sesión 4: un motor en una oferta de otro oficio no se escribe.
    calls.length = 0;
    await assert.rejects(
      offerRepository.create({ ...base, technicianType: 'mechanic', requiresCertification: false, requiredEngineId: 'eng-cfm56-7b' }),
      /Only an engine offer can name an engine/,
    );
    assert.equal(calls.filter((c) => c.op !== 'select').length, 0, 'nada se escribió');
  });

  // Sesión 4 (091): antes el patch mandaba offerKind; ahora basta el oficio.
  await test('Repositorio — pasar a Engine Technician guarda oficio, clase, certificación y aeronaves en una RPC', async () => {
    reset();
    await offerRepository.create({
      ...base,
      technicianType: 'mechanic',
      requiresCertification: true,
      licenseAuthority: 'EASA',
      licenseCode: 'B1.1',
      requiredHabilitations: [A320],
    });
    assert.equal(habilitationRows.length, 1);
    calls.length = 0;

    await offerRepository.update('offer-1', {
      requiredEngineId: 'eng-cfm56-7b',
      technicianType: 'engine_technician',
      requiresCertification: false,
    });
    assert.deepEqual(calls.filter((c) => c.op !== 'select').map((c) => c.table), ['update_offer_with_habilitations']);
    assert.equal(habilitationRows.length, 0);
    const escrito = lastWrite('offers', 'update');
    assert.equal(escrito.technician_type, 'engine_technician');
    assert.equal(escrito.offer_kind, 'engine');
    assert.equal(escrito.required_engine_id, 'eng-cfm56-7b');
    assert.equal(escrito.requires_certification, false);
    assert.equal(escrito.license_code, null);
    assert.equal(escrito.license_authority, null);

    // Mandar la clase contra el oficio es una contradicción: lanza sin escribir.
    calls.length = 0;
    await assert.rejects(offerRepository.update('offer-1', { offerKind: 'aircraft' }), /An Engine Technician offer is an engine offer/);
    assert.equal(calls.filter((c) => c.op === 'rpc').length, 0, 'nada llegó a la RPC');

    // De vuelta a otro oficio: aeronave, y el motor se va en la misma escritura.
    await offerRepository.update('offer-1', { technicianType: 'mechanic' });
    const vuelta = lastWrite('offers', 'update');
    assert.equal(vuelta.technician_type, 'mechanic');
    assert.equal(vuelta.offer_kind, 'aircraft');
    assert.equal(vuelta.required_engine_id, null);
  });

  await test('Repositorio — volver a certificar desmarca "sólo sin licencia" en la misma escritura; pedirlo explícitamente lanza', async () => {
    reset();
    await offerRepository.create({ ...base, technicianType: 'mechanic', requiresCertification: false, onlyUnlicensed: true });
    const actualizada = await offerRepository.update('offer-1', { requiresCertification: true, licenseAuthority: 'UK_CAA', licenseCode: 'B1.1' });
    const escrito = lastWrite('offers', 'update');
    assert.equal(escrito.only_unlicensed, false);
    assert.equal(escrito.license_authority, 'UK_CAA');
    assert.equal(actualizada?.onlyUnlicensed, false);

    await assert.rejects(offerRepository.update('offer-1', { onlyUnlicensed: true }), /without a licence/);
  });

  await test('Repositorio — sesión 2: la lista de aceptadas se escribe, se limpia al cambiar la autoridad y se valida si viene', async () => {
    reset();
    await offerRepository.create({
      ...base, technicianType: 'mechanic', requiresCertification: true, licenseAuthority: 'EASA', licenseCode: 'B1.1',
      acceptedAuthorities: ['UK_CAA', 'CASA'],
    });
    assert.deepEqual(lastWrite('offers', 'insert').accepted_authorities, ['UK_CAA', 'CASA']);

    // Cambiar la exigida sin mandar la lista: la RPC recibe la lista ya limpia.
    const actualizada = await offerRepository.update('offer-1', { licenseAuthority: 'UK_CAA' });
    assert.deepEqual(lastWrite('offers', 'update').accepted_authorities, ['CASA']);
    assert.deepEqual(actualizada?.acceptedAuthorities, ['CASA']);

    // Mandarla mal es una contradicción: lanza sin escribir.
    calls.length = 0;
    await assert.rejects(offerRepository.update('offer-1', { acceptedAuthorities: ['UK_CAA'] }), /cannot be accepted as equivalent/);
    await assert.rejects(offerRepository.update('offer-1', { licenseCode: 'C', acceptedAuthorities: ['FAA'] }), /cannot be accepted as equivalent/);
    assert.equal(calls.filter((c) => c.op === 'rpc').length, 0, 'nada llegó a la RPC');

    // Parte 3: la FAA con una B1.1 se escribe; pasar a C sin mandar la lista la quita.
    await offerRepository.update('offer-1', { acceptedAuthorities: ['CASA', 'FAA'] });
    assert.deepEqual(lastWrite('offers', 'update').accepted_authorities, ['CASA', 'FAA']);
    const aC = await offerRepository.update('offer-1', { licenseCode: 'C' });
    assert.deepEqual(lastWrite('offers', 'update').accepted_authorities, ['CASA']);
    assert.deepEqual(aC?.acceptedAuthorities, ['CASA']);

    // Quitar la licencia se lleva la lista en la misma escritura.
    await offerRepository.update('offer-1', { requiresCertification: false });
    assert.deepEqual(lastWrite('offers', 'update').accepted_authorities, []);
    await assert.rejects(
      offerRepository.create({ ...base, technicianType: 'mechanic', requiresCertification: true, licenseAuthority: 'FAA', licenseCode: 'A&P', acceptedAuthorities: ['EASA'] }),
      /Pick the licence category/,
      '096: una oferta FAA acepta autoridades Part-66 sólo con una categoría',
    );
  });

  await test('096 · Repositorio — oferta FAA con una Part-66 aceptada: se escribe y se lee; a medias no; se limpia al cambiar el tipo o salir de la FAA', async () => {
    reset();
    const creada = await offerRepository.create({
      ...base, technicianType: 'mechanic', requiresCertification: true, licenseAuthority: 'FAA', licenseCode: 'A&P',
      acceptedAuthorities: ['EASA', 'UK_CAA'], acceptedLicenseCode: 'B1.1',
    });
    const fila = lastWrite('offers', 'insert');
    assert.deepEqual(fila.accepted_authorities, ['EASA', 'UK_CAA']);
    assert.equal(fila.accepted_license_code, 'B1.1');
    assert.equal(creada.acceptedLicenseCode, 'B1.1');

    // A medias, o con una categoría que el oficio no puede pedir: lanza sin escribir.
    calls.length = 0;
    await assert.rejects(
      offerRepository.create({ ...base, technicianType: 'mechanic', requiresCertification: true, licenseAuthority: 'FAA', licenseCode: 'A&P', acceptedLicenseCode: 'B1.1' }),
      /Pick at least one authority whose B1.1 counts/,
    );
    await assert.rejects(offerRepository.update('offer-1', { acceptedLicenseCode: 'B2' }), /cannot be accepted on this FAA offer/);
    await assert.rejects(offerRepository.update('offer-1', { acceptedLicenseCode: 'C' }), /cannot be accepted on this FAA offer/);
    assert.equal(calls.filter((c) => c.op === 'rpc' || c.op === 'insert').length, 0, 'nada llegó a la base');

    // Cambiar el oficio sin mandar la lista: la B1.1 no es de aviónico y se va, con sus autoridades.
    await offerRepository.update('offer-1', { technicianType: 'avionic' });
    assert.deepEqual(lastWrite('offers', 'update').accepted_authorities, []);
    assert.equal(lastWrite('offers', 'update').accepted_license_code, null);

    // Desmarcar todas las autoridades se lleva la categoría en la misma escritura.
    await offerRepository.update('offer-1', { technicianType: 'mechanic', acceptedAuthorities: ['UK_CAA'], acceptedLicenseCode: 'B1.1' });
    assert.equal(lastWrite('offers', 'update').accepted_license_code, 'B1.1');
    await offerRepository.update('offer-1', { acceptedAuthorities: [] });
    assert.equal(lastWrite('offers', 'update').accepted_license_code, null);

    // Pasar a Part-66 vacía las dos.
    await offerRepository.update('offer-1', { acceptedAuthorities: ['UK_CAA'], acceptedLicenseCode: 'B1.1' });
    await offerRepository.update('offer-1', { licenseAuthority: 'EASA', licenseCode: 'B1.1' });
    assert.deepEqual(lastWrite('offers', 'update').accepted_authorities, []);
    assert.equal(lastWrite('offers', 'update').accepted_license_code, null);
  });

  await test('Repositorio — un patch que no toca requisitos no reescribe sus columnas', async () => {
    reset();
    await offerRepository.create({ ...base, technicianType: 'mechanic', requiresCertification: true, licenseAuthority: 'EASA', licenseCode: 'B1.1' });
    await offerRepository.update('offer-1', { title: 'Renamed' });
    const escrito = lastWrite('offers', 'update');
    assert.deepEqual(Object.keys(escrito).sort(), ['title']);
  });

  // ── Perfil del técnico: licencias por credencial y motores ──────────────

  // documentRepositoryV2 (importado por el de técnicos) arrastra
  // src/lib/documentStorage, que importa react-native y expo-file-system: Node
  // no los carga. Nada de lo que se prueba aquí toca documentos, así que se
  // sustituye por un módulo vacío, igual que Supabase.
  const storagePath = require.resolve('../src/lib/documentStorage');
  require.cache[storagePath] = {
    id: storagePath,
    filename: storagePath,
    loaded: true,
    exports: { removeDocumentFromStorage: async () => undefined },
  } as unknown as NodeModule;
  const { technicianRepositoryV2 } = require('../src/repositories/v2/technicianRepositoryV2') as typeof import('../src/repositories/v2/technicianRepositoryV2');

  await test('Repositorio de técnico — upsertLicenses manda la autoridad de cada credencial y el onConflict de la 073', async () => {
    calls.length = 0;
    await technicianRepositoryV2.upsertLicenses('tech-1', [
      { authority: 'UK_CAA', code: 'B1.1' },
      { authority: 'FAA', code: 'A&P' },
    ]);
    const upsert = calls.find((c) => c.table === 'technician_licenses' && c.op === 'upsert')!;
    const rows = upsert.data!.rows as Record<string, unknown>[];
    assert.deepEqual(rows.map((r) => `${r.authority} ${r.license_code}`), ['UK_CAA B1.1', 'FAA A&P']);
    assert.equal(upsert.onConflict, 'technician_id,authority,license_code');
  });

  await test('Repositorio de técnico — quitar la B1.1 EASA borra sólo esa fila; la UK CAA con habilitaciones se queda', async () => {
    licenseRows = [
      { id: 'lic-easa', authority: 'EASA', license_code: 'B1.1' },
      { id: 'lic-uk', authority: 'UK_CAA', license_code: 'B1.1' },
      { id: 'lic-b2', authority: 'EASA', license_code: 'B2' },
    ];
    licenseDependents = [];
    calls.length = 0;
    const { blocked } = await technicianRepositoryV2.removeUnreferencedLicenses('tech-1', [
      { authority: 'UK_CAA', code: 'B1.1' },
      { authority: 'EASA', code: 'B2' },
    ]);
    assert.deepEqual(blocked, []);
    assert.deepEqual(licenseRows.map((r) => r.id).sort(), ['lic-b2', 'lic-uk'], 'sólo cae la EASA');

    // Y una credencial con habilitaciones colgando se bloquea, con su nombre.
    licenseRows = [{ id: 'lic-uk', authority: 'UK_CAA', license_code: 'B1.1' }];
    licenseDependents = [{ technician_license_id: 'lic-uk' }];
    const segundo = await technicianRepositoryV2.removeUnreferencedLicenses('tech-1', []);
    assert.deepEqual(segundo.blocked, ['UK CAA B1.1']);
    assert.equal(licenseRows.length, 1);
  });

  await test('Repositorio de técnico — con FAA A&P (o A y P en filas) se guarda sólo Avionics; con la P sola o una B1.1, Mechanic se exige', async () => {
    // FAA A&P: desmarca Mechanic y marca Avionics, y se guarda así.
    profileTypeRows = ['mechanic'];
    await technicianRepositoryV2.replaceProfileTypes('tech-1', ['avionic'], ['A&P']);
    assert.deepEqual(profileTypeRows, ['avionic']);
    // A y P en filas separadas: igual.
    profileTypeRows = ['mechanic'];
    await technicianRepositoryV2.replaceProfileTypes('tech-1', ['avionic'], ['A', 'P']);
    assert.deepEqual(profileTypeRows, ['avionic']);
    // Quien lo conserva, lo conserva.
    profileTypeRows = ['mechanic'];
    await technicianRepositoryV2.replaceProfileTypes('tech-1', ['mechanic', 'avionic'], ['A']);
    assert.deepEqual(profileTypeRows, ['mechanic', 'avionic']);

    // La P sola, o la A con una B1.1: Mechanic bloqueado, y no se escribe nada.
    for (const licencias of [['P'], ['A', 'B1.1']]) {
      profileTypeRows = ['mechanic'];
      calls.length = 0;
      await assert.rejects(
        technicianRepositoryV2.replaceProfileTypes('tech-1', ['avionic'], licencias),
        /come from licences you hold and cannot be removed: Mechanic/,
        licencias.join(' + '),
      );
      assert.deepEqual(profileTypeRows, ['mechanic']);
      assert.equal(calls.filter((c) => c.table === 'technician_profile_types').length, 0);
    }
    // El mínimo de un tipo sigue.
    await assert.rejects(technicianRepositoryV2.replaceProfileTypes('tech-1', [], ['A']), /Select at least one technician type/);
  });

  await test('Repositorio de técnico — replaceEngineExperience usa una RPC y conserva NULL', async () => {
    calls.length = 0;
    await technicianRepositoryV2.replaceEngineExperience('tech-1', [{ engineId: 'eng-1', years: 6 }, { engineId: 'eng-2' }]);
    assert.deepEqual(calls.map((c) => c.table), ['replace_technician_engines']);
    const rows = calls[0].data!.p_entries as Record<string, unknown>[];
    assert.deepEqual(rows, [
      { engine_id: 'eng-1', years: 6 },
      { engine_id: 'eng-2', years: null },
    ]);
    calls.length = 0;
    await technicianRepositoryV2.replaceEngineExperience('tech-1', []);
    assert.deepEqual(calls.map((c) => c.op), ['rpc']);
    assert.deepEqual(calls[0].data!.p_entries, []);
  });

  // 094: la firma FAA viaja a la RPC; sin marcar, false (nunca undefined).
  await test('Repositorio de técnico — replaceAircraftExperience manda la firma a la RPC', async () => {
    calls.length = 0;
    await technicianRepositoryV2.replaceAircraftExperience('tech-1', [
      { aircraftTypeRatingId: 'rating-a320', years: 8, signed: true },
      { aircraftTypeRatingId: 'rating-737' },
    ]);
    assert.deepEqual(calls.map((c) => c.table), ['replace_technician_aircraft_experience']);
    assert.deepEqual(calls[0].data!.p_entries, [
      { aircraft_type_rating_id: 'rating-a320', years: 8, signed: true },
      { aircraft_type_rating_id: 'rating-737', years: null, signed: false },
    ]);
  });

  // ── Candidaturas: el rechazo de la base llega como el texto de siempre ──

  const { NO_LONGER_ELIGIBLE_TO_ACCEPT, offerApplicationRepository } = require('../src/repositories/v2/offerApplicationRepository') as typeof import('../src/repositories/v2/offerApplicationRepository');
  const { ineligibilityReasonText } = require('../src/utils/offerMatchExplain') as typeof import('../src/utils/offerMatchExplain');
  const aplicar = () =>
    offerApplicationRepository.create({ technicianId: 'tech-1', offerId: 'offer-1', companyId: 'company-1', coverNote: 'hola' });
  const ofertaPublicada = () => {
    offerRow = { id: 'offer-1', company_id: 'company-1', status: 'published', visible: true, offer_kind: 'engine', required_engine_id: 'eng-1' };
  };

  await test('Candidatura — un técnico no elegible no la crea aunque salte la UI: el PT403 de la base llega con su motivo', async () => {
    ofertaPublicada();
    applicationRows = [];
    for (const reason of ['no_engine_experience', 'licensed_technician'] as const) {
      applicationRejection = { code: 'PT403', message: 'The technician is not eligible for this offer.', details: reason };
      await assert.rejects(aplicar(), (err: Error) => err.message === ineligibilityReasonText(reason), `motivo ${reason}`);
    }
    assert.deepEqual(applicationRows, [], 'no queda candidatura');
  });

  await test('Candidatura — re-aplicar tras retirarse también pasa por la base: la reactivación rechazada da el mismo texto', async () => {
    ofertaPublicada();
    applicationRows = [{ id: 'app-1', technician_id: 'tech-1', offer_id: 'offer-1', company_id: 'company-1', status: 'withdrawn', created_at: '2026-09-01', updated_at: '2026-09-01' }];
    applicationRejection = { code: 'PT403', message: 'The technician is not eligible for this offer.', details: 'no_engine_experience' };
    await assert.rejects(aplicar(), (err: Error) => err.message === ineligibilityReasonText('no_engine_experience'));
    assert.equal(applicationRows[0].status, 'withdrawn', 'sigue retirada');
  });

  await test('Candidatura — un técnico elegible la crea; un error que no es de elegibilidad no se disfraza de motivo', async () => {
    ofertaPublicada();
    applicationRows = [];
    applicationRejection = null;
    const creada = await aplicar();
    assert.equal(creada.status, 'pending');
    assert.equal(creada.technicianId, 'tech-1');

    applicationRows = [];
    applicationRejection = { code: '42501', message: 'new row violates row-level security policy', details: '' };
    await assert.rejects(aplicar(), /row-level security/);
  });

  // Sesión 5 (092): la base también rechaza ACEPTAR a quien ya no es elegible.
  await test('Candidatura — aceptar a quien ya no es elegible: la empresa lee por qué, y rechazar no se traduce', async () => {
    applicationRows = [{ id: 'app-1', technician_id: 'tech-1', offer_id: 'offer-1', company_id: 'company-1', status: 'pending', created_at: '2026-09-01', updated_at: '2026-09-01' }];
    applicationRejection = { code: 'PT403', message: 'The technician is no longer eligible for this offer.', details: 'licensed_technician' };
    await assert.rejects(
      offerApplicationRepository.updateStatus('app-1', 'accepted'),
      (err: Error) => err.message === `${NO_LONGER_ELIGIBLE_TO_ACCEPT} ${ineligibilityReasonText('licensed_technician')}`,
    );
    assert.equal(applicationRows[0].status, 'pending', 'sigue pendiente');
    // Un 42501 (no es tu parte de la relación) no se disfraza de motivo.
    applicationRejection = { code: '42501', message: 'Not authorized.', details: '' };
    await assert.rejects(offerApplicationRepository.updateStatus('app-1', 'accepted'), /Not authorized/);
    applicationRejection = null;
    const rechazada = await offerApplicationRepository.updateStatus('app-1', 'rejected');
    assert.equal(rechazada?.status, 'rejected');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
