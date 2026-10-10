// Run the actual search hook with an in-memory React state adapter and I/O.
// No duplicate search implementation, network connection or browser required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const state = [];
let cursor = 0;
let loadRatings = async () => { throw new Error('catalog offline'); };
const preview = { id: 'candidate' };
const modules = {
  react: {
    useState(initial) {
      const slot = cursor++;
      if (!(slot in state)) state[slot] = initial;
      return [state[slot], next => { state[slot] = typeof next === 'function' ? next(state[slot]) : next; }];
    },
    useRef(initial) {
      const slot = cursor++;
      if (!(slot in state)) state[slot] = { current: initial };
      return state[slot];
    },
    useCallback: fn => fn,
  },
  './SessionContext': { useCompanySession: () => ({ companyId: 'company' }) },
  '../repositories/v2/technicianRepositoryV2': { technicianRepositoryV2: { search: async () => [preview] } },
  '../repositories/v2/offerRequestRepository': { offerRequestRepository: { getForCompany: async () => [] } },
  '../repositories/v2/offerApplicationRepository': { offerApplicationRepository: { getForCompany: async () => [] } },
  '../repositories/v2/documentRepositoryV2': { documentRepositoryV2: {} },
  '../repositories/v2/catalogRepository': { catalogRepository: { getAircraftTypeRatings: () => loadRatings() } },
  '../constants/aircraftTypeRatings': { buildAircraftRatingIndex: () => new Map() },
  '../utils/privacyV2': { canRevealIdentity: () => false },
  '../types/privacy': { isUnlocked: view => 'firstName' in view },
  '../utils/v2CompatAdapters': { v2SafePreviewToSafeView: value => value },
};
const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'src/state/useTechnicianSearch.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const exportsObject = {};
vm.runInNewContext(compiled, { exports: exportsObject, require: name => {
  if (!(name in modules)) throw new Error(`Unmocked dependency: ${name}`);
  return modules[name];
} });
const render = () => { cursor = 0; return exportsObject.useTechnicianSearch(); };
async function main() {
  await render().search();
  assert.equal(render().loading, false);
  assert.match(render().error, /catalogs/);
  assert.equal(render().results.length, 0);
  loadRatings = async () => [];
  await render().search();
  assert.equal(render().error, null);
  assert.equal(render().results[0], preview);
  let rejectOld;
  loadRatings = () => new Promise((_, reject) => { rejectOld = reject; });
  const oldSearch = render().search();
  assert.equal(render().results.length, 0, 'old rows clear while the new search loads');
  loadRatings = async () => [];
  await render().search();
  rejectOld(new Error('old catalog failure'));
  await oldSearch;
  assert.equal(render().error, null, 'late failure cannot overwrite newer success');
  assert.equal(render().results[0], preview);
  let resolveOld;
  loadRatings = () => new Promise(resolve => { resolveOld = resolve; });
  const clearedSearch = render().search();
  render().clearResults();
  resolveOld([]);
  await clearedSearch;
  assert.equal(render().results.length, 0, 'clearing the results (filters reset) cancels the in-flight search');
  assert.equal(render().loading, false);
  console.log('PASS H13 search hook: visible error, empty results, retry, stale failure and cancellation');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
