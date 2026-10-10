import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { buildAircraftRatingIndex } from '../src/constants/aircraftTypeRatings';
import { AircraftTypeRatingCatalog, EngineCatalog } from '../src/types/catalog';
import { blockingHabilitationIssues, explainHabilitationScopeRejection, isHabilitationScopeRejection, profileHabilitationIssues, profileHabilitationProblems } from '../src/utils/profileHabilitationValidation';

const a320 = { id: 'a320', displayName: 'Airbus A320 — CFM56', productType: 'Aeroplane', engineId: 'cfm56' } as AircraftTypeRatingCatalog;
const r44 = { id: 'r44', displayName: 'Robinson R44 — Lycoming', productType: 'Helicopter', engineId: 'lycoming' } as AircraftTypeRatingCatalog;
const ratings = buildAircraftRatingIndex([a320, r44]);
const engines = new Map([
  ['cfm56', { id: 'cfm56', engineType: 'turbofan' } as EngineCatalog],
  ['lycoming', { id: 'lycoming', engineType: 'piston' } as EngineCatalog],
]);
const b11 = { authority: 'EASA' as const, code: 'B1.1' as const };
const b12 = { authority: 'EASA' as const, code: 'B1.2' as const };
const original = { authority: 'EASA' as const, licenseCode: 'B1.1', aircraftTypeRatingId: 'a320' };
const incompatible = { ...original, licenseCode: 'B1.2' };
const validOther = { authority: 'EASA' as const, licenseCode: 'B1.4', aircraftTypeRatingId: 'r44' };
let writeCalls = 0;
let diagnosticFails = false;
let writeError = { code: '23514', message: 'Individual type rating is outside the licence scope.', details: 'propulsion' };
const fake = {
  async rpc(name: string, args: Record<string, unknown>) {
    if (name === 'individual_type_rating_scope_error') {
      if (diagnosticFails) return { data: null, error: { message: 'diagnostic unavailable' } };
      return { data: args.p_rating_id === 'a320' ? 'propulsion' : null, error: null };
    }
    writeCalls++;
    return { data: null, error: writeError };
  },
};
for (const [name, moduleExports] of [
  ['../src/lib/supabase', { supabase: fake }],
  ['../src/lib/documentStorage', {}],
  ['../src/repositories/v2/catalogRepository', { catalogRepository: { getAircraftTypeRatingsByIds: async () => [a320, r44] } }],
] as const) {
  const path = require.resolve(name);
  require.cache[path] = { id: path, filename: path, loaded: true, exports: moduleExports } as NodeModule;
}
const { technicianRepositoryV2: repository } = require('../src/repositories/v2/technicianRepositoryV2') as typeof import('../src/repositories/v2/technicianRepositoryV2');
// Después de los mocks: el caso de uso importa el repositorio, que importa supabase.
const { saveTechnicianProfile } = require('../src/usecases/technicianProfile') as typeof import('../src/usecases/technicianProfile');
type TechnicianProfileStore = import('../src/usecases/technicianProfile').TechnicianProfileStore;
type WorkChanges = import('../src/usecases/technicianProfile').WorkChanges;
async function main() {
  assert.deepEqual(profileHabilitationProblems([original], [b11], ratings, engines), []);
  const removal = profileHabilitationProblems([original], [b12], ratings, engines).join(' ');
  assert.match(removal, /Airbus A320/);
  assert.match(removal, /still linked to EASA B1\.1/);
  assert.match(removal, /does not transfer/);
  assert.deepEqual(profileHabilitationProblems([original], [b11, b12], ratings, engines), [], 'adding B1.2 is allowed');
  assert.deepEqual(profileHabilitationProblems([], [b12], ratings, engines), [], 'explicitly removing the old rating allows removal of its licence');
  const mismatch = profileHabilitationProblems([incompatible], [b12], ratings, engines).join(' ');
  assert.match(mismatch, /Airbus A320/);
  assert.match(mismatch, /EASA B1\.2.*piston/);
  assert.match(profileHabilitationProblems([{ ...original, licenseCode: 'A1' }], [{ ...b11, code: 'A1' }], ratings, engines).join(' '), /Airbus A320.*does not carry individual/);
  assert.match(profileHabilitationProblems([{ ...incompatible, aircraftTypeRatingId: 'r44' }], [b12], ratings, engines).join(' '), /Robinson R44.*covers aeroplanes/);
  const otherAuthority = profileHabilitationProblems([original], [{ authority: 'UK_CAA', code: 'B1.1' }], ratings, engines).join(' ');
  assert.match(otherAuthority, /still linked to EASA B1\.1/);
  const unknown = profileHabilitationProblems([original], [b11], ratings, new Map()).join(' ');
  assert.match(unknown, /cannot confirm.*Airbus A320/);

  // Sin catálogo de motores: "no se puede comprobar", no "está mal". Sólo
  // bloquea el guardado que de verdad reescribe las habilitaciones.
  const noEngines = profileHabilitationIssues([original], [b11], ratings, new Map());
  assert.deepEqual(noEngines.map((i) => [i.reason, i.unverifiable]), [['unknown_propulsion', true]]);
  assert.deepEqual(blockingHabilitationIssues(noEngines, false), [], 'a stale catalog never blocks an untouched rating list');
  assert.equal(blockingHabilitationIssues(noEngines, true).length, 1, 'it does block when the ratings are being rewritten');
  // Un problema determinable bloquea en los dos casos: no depende del catálogo.
  const deselected = profileHabilitationIssues([original], [b12], ratings, new Map());
  assert.equal(deselected[0].unverifiable, false);
  assert.equal(blockingHabilitationIssues(deselected, false).length, 1, 'a deselected credential blocks even with no catalog');
  // Y una aeronave que el catálogo de ratings no resuelve tampoco es un veredicto.
  const noRating = profileHabilitationIssues([original], [b11], new Map(), engines);
  assert.deepEqual(noRating.map((i) => [i.reason, i.unverifiable]), [['rating', true]]);
  assert.deepEqual(original, { authority: 'EASA', licenseCode: 'B1.1', aircraftTypeRatingId: 'a320' }, 'no implicit reassignment');

  assert.equal(isHabilitationScopeRejection(writeError), true);
  assert.equal(isHabilitationScopeRejection({ code: '23514', message: 'Other CHECK failed' }), false);
  assert.equal(isHabilitationScopeRejection({ message: 'Existing type rating is outside the new licence scope.' }), true);
  await assert.rejects(repository.replaceHabilitations('tech', [incompatible, validOther]), (error: Error) => {
    assert.match(error.message, /Airbus A320.*EASA B1\.2.*piston/);
    assert.doesNotMatch(error.message, /Robinson|23514|outside the licence scope/);
    return true;
  });
  assert.equal(writeCalls, 1, 'failed write is never automatically retried');

  // El guardado de My work es el caso de uso (src/usecases/technicianProfile.ts;
  // respuesta 29 de docs/UI_REDESIGN.md): se ejecuta la función REAL con un
  // almacén falso que cuenta las escrituras. Era handleSave, extraído por AST
  // de la pantalla del perfil; la pantalla ya no tiene otra copia del
  // algoritmo, así que el test apunta aquí.
  let writes = 0;
  let credentialRejects = true;
  const store = {
    getOwnJsonColumns: async () => ({ availability: { immediately: true, contractTypes: [] }, socialLinks: null }),
    updateOwnProfile: async () => { writes++; return true; },
    replaceProfileTypes: async () => { writes++; },
    upsertLicenses: async () => {
      writes++;
      if (credentialRejects) throw new Error('Existing type rating is outside the new licence scope.');
    },
    replaceHabilitations: async () => { writes++; },
    replaceAircraftExperience: async () => { writes++; },
    replaceEngineExperience: async () => { writes++; },
    removeUnreferencedLicenses: async () => ({ blocked: [] }),
    describeHabilitationScopeRejection: repository.describeHabilitationScopeRejection,
  } as unknown as TechnicianProfileStore;
  const work = (over: Partial<WorkChanges>): WorkChanges => ({
    types: ['mechanic'], licenses: [b12], habilitations: [original], habDirty: false,
    aircraftExperience: [], experienceDirty: false, engines: [], enginesDirty: false,
    ratingsById: ratings, engineIndex: engines, ...over,
  });
  const save = async (w: WorkChanges) => {
    const result = await saveTechnicianProfile('tech', { work: w }, store);
    return result.ok ? null : result.error;
  };

  let visibleError = await save(work({}));
  assert.equal(visibleError, removal);
  assert.equal(writes, 0, 'incompatible removal stops before any profile write');
  visibleError = await save(work({ habilitations: [incompatible] }));
  assert.equal(visibleError, mismatch);
  assert.equal(writes, 0, 'bypassing the picker still stops before any write');

  // Catálogo de motores caído y habilitaciones SIN tocar: lo demás se guarda.
  // Era el bloqueo del perfil entero que encontró la revisión.
  credentialRejects = false;
  visibleError = await save(work({ licenses: [b11], engineIndex: new Map() }));
  assert.equal(visibleError, null, 'a failed engine catalog does not block an untouched rating list');
  assert.ok(writes > 0, 'the rest of My work is saved');

  // Mismo catálogo caído, pero el técnico SÍ tocó las habilitaciones: se para
  // antes de escribir y se dice por qué y qué hacer.
  writes = 0;
  visibleError = await save(work({ licenses: [b11], engineIndex: new Map(), habDirty: true }));
  assert.match(visibleError!, /cannot confirm.*Airbus A320/);
  assert.match(visibleError!, /could not be checked, so they were not saved/);
  assert.match(visibleError!, /undo your type-rating changes to save the rest/);
  assert.equal(writes, 0, 'an unverifiable rating change stops before any write');

  // Datos del cliente desfasados: el cliente no ve nada, pero la base rechaza
  // la credencial (083). Se explica por habilitación, sin el texto de la base.
  writes = 0;
  credentialRejects = true;
  visibleError = await save(work({ licenses: [b11] }));
  assert.match(visibleError!, /Airbus A320/);
  assert.doesNotMatch(visibleError!, /outside the new licence scope/);
  assert.equal(writes, 2, 'only the profile types and the rejected credential write ran before the parent rejection');

  diagnosticFails = true;
  await assert.rejects(repository.replaceHabilitations('tech', [incompatible]), /could not confirm which rating.*Airbus A320/);
  writeError = { code: '42501', message: 'Permission denied', details: '' };
  await assert.rejects(repository.replaceHabilitations('tech', [incompatible]), /Permission denied/);
  const fallback = await explainHabilitationScopeRejection([incompatible], async () => { throw Error('offline'); }, async () => { throw Error('offline'); });
  assert.match(fallback, /Habilitation 1/);
  assert.doesNotMatch(fallback, /a320|offline|23514/);
  console.log('PASS 083 profile feedback: removal, incompatible rating, authority isolation, missing catalog, real repository rejection, diagnostics fallback and no automatic retry');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
