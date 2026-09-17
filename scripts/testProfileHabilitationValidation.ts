import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { buildAircraftRatingIndex } from '../src/constants/aircraftTypeRatings';
import { AircraftTypeRatingCatalog, EngineCatalog } from '../src/types/catalog';
import { explainHabilitationScopeRejection, isHabilitationScopeRejection, profileHabilitationProblems } from '../src/utils/profileHabilitationValidation';

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

  // Execute the actual button handler, extracted by AST, with screen state
  // injected. Checks ordering before writes and the rendered error state;
  // the save algorithm is never copied into this test.
  const screenPath = path.join(process.cwd(), 'app/technician/profile.tsx');
  const source = ts.createSourceFile(screenPath, fs.readFileSync(screenPath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let saveFunction: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'handleSave') saveFunction = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(saveFunction, 'real Save Changes handler exists');
  const handlerCode = ts.transpileModule(saveFunction.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  let visibleError: string | null = null;
  let profileWrites = 0;
  const query = { update: () => query, eq: () => query, select: async () => ({ data: [{ id: 'tech' }], error: null }) };
  const context = {
    form: { fullName: 'Test Technician', email: 'test@example.invalid', availability: { contractTypes: [], status: 'open_to_offers' }, licenseCategories: ['B1.1'] },
    isDirty: true, techId: 'tech', typesLoaded: true, technicianTypes: ['mechanic'], yearsInput: '5',
    validateProfileYearsExperience: () => null,
    habilitationProblems: [removal],
    setProfileError: (message: string | null) => { visibleError = message; },
    supabase: { from: () => { profileWrites++; return query; } },
    heldLicenses: [b11], habilitations: [original], ratingsById: ratings,
    authorityLicenseCanExpire: () => true, isValidDateOrder: () => true,
    SOCIAL_FIELDS: [], unknownSocialKeys: {}, persistedLocationFromValue: () => ({}), location: {},
    setSaving: () => {}, setLicenseRemovalWarning: () => {},
    isHabilitationScopeRejection,
    technicianRepositoryV2: {
      replaceProfileTypes: async () => {},
      upsertLicenses: async () => { throw new Error('Existing type rating is outside the new licence scope.'); },
      describeHabilitationScopeRejection: repository.describeHabilitationScopeRejection,
    },
  };
  vm.createContext(context);
  vm.runInContext(handlerCode, context);
  await vm.runInContext('handleSave()', context);
  assert.equal(visibleError, removal);
  assert.equal(profileWrites, 0, 'incompatible removal stops before any profile write');
  context.habilitationProblems = [mismatch];
  await vm.runInContext('handleSave()', context);
  assert.equal(visibleError, mismatch);
  assert.equal(profileWrites, 0, 'bypassing the picker still stops before any write');
  context.habilitationProblems = []; // simulate stale client facts; DB still rejects
  await vm.runInContext('handleSave()', context);
  assert.match(visibleError!, /Airbus A320/);
  assert.doesNotMatch(visibleError!, /outside the new licence scope/);
  assert.equal(profileWrites, 1, 'only the pre-existing main-profile write ran before the parent rejection');

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
