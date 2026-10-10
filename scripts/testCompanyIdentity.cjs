// Run the real company loaders and React functions offline. The adapter replaces
// platform widgets and I/O only; privacy, mapping, names and avatar logic are real.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
let state = [], cursor = 0, effects = [], mount = true, wide = false;
const react = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  Fragment: 'Fragment',
  createContext: () => ({}),
  useState(initial) {
    const slot = cursor++;
    if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial;
    return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }];
  },
  useRef(initial) { return react.useState({ current: initial })[0]; },
  useCallback: fn => fn,
  useMemo: fn => fn(),
  useEffect: fn => { if (mount) effects.push(fn); },
};
const widgets = new Proxy({
  __esModule: true, useIsWide: () => wide,
  useConfirmDialog: () => ({ confirm: async () => false, dialog: null }),
  StyleSheet: { create: value => value, hairlineWidth: 1 }, Platform: { OS: 'web', select: value => value.web },
  useWindowDimensions: () => ({ width: wide ? 1400 : 390, height: 900 }),
  matchScoreColor: () => 'green', technicianProfileLine: () => 'Mechanic',
  resolveTypeRatingLabels: () => [], useOfferBreakdownRows: () => [],
  conversationType: () => 'Application', formatInboxTime: () => 'Today',
}, { get: (target, key) => key in target ? target[key] : key });
const session = { companyId: 'company', companyMemberId: 'member', companyMemberRole: 'owner', profileId: 'user' };
const routing = { useRouter: () => ({ push() {}, navigate() {} }), Stack: { Screen: 'Screen' },
  useLocalSearchParams: () => ({ id: 'current' }), useFocusEffect: react.useEffect };
let views, applications, requests, current, rooms;
const offer = { id: 'new-offer', title: 'New offer', status: 'published', createdAt: '2026-10-08',
  technicianType: 'mechanic', offerKind: 'aircraft', requiredHabilitations: [], acceptedAuthorities: [],
  contractType: 'permanent', locationCountry: 'ES', locationCity: 'Madrid' };
const techRepo = {
  getViewForCompany: async (id, company) => { assert.equal(company, 'company'); return views[id] ?? null; },
  getWithRelations: async id => views[id] ?? null,
  search: async () => Object.values(views).map(view => privacy.getSafeTechnicianPreview(view)),
};
const appRepo = { getForCompany: async () => applications, getById: async () => current };
const requestRepo = { getForCompany: async () => requests, getById: async () => current };
const offerRepo = { getForCompany: async () => [offer], getAllWithRequirements: async () => [offer],
  getWithRequirements: async () => offer, getById: async () => offer };
const activity = { getUnreadEntityIds: async () => new Set(), getUnreadChatRoomIds: async () => new Set(),
  markRead: async () => {}, markChatRoomRead: async () => {} };
const supabase = { from(table) {
  const rows = table === 'offer_requests' ? requests.map(r => ({ id: r.id, technician_id: r.technicianId,
    company_id: r.companyId, offer_id: r.offerId, status: r.status, identity_revealed: r.identityRevealed,
    created_at: r.createdAt, updated_at: r.createdAt })) : table === 'offers' ? [offer] : table === 'chat_rooms' ? [] : null;
  assert.ok(rows, `Unexpected database table: ${table}`);
  const query = new Proxy({}, { get: (_, key) => key === 'then'
    ? resolve => Promise.resolve({ data: rows, error: null }).then(resolve) : () => query });
  return query;
} };
const mocks = {
  'src/state/useProfileImage': { useProfileImage: (photo) => photo ? 'data:identity-photo' : null },
  'src/lib/documentStorage': {},
  'src/lib/supabase': { supabase },
  'src/state/SessionContext': { useCompanySession: () => session },
  'src/state/useGoBack': { useGoBack: () => () => {} },
  'src/state/useCountryCatalog': { useCountryCatalog: () => ({ countries: [] }) },
  'src/state/useConfirmDialog': { useConfirmDialog: () => ({ confirm: async () => false, dialog: null }) },
  'src/repositories/v2/technicianRepositoryV2': { technicianRepositoryV2: techRepo },
  'src/repositories/v2/offerApplicationRepository': { offerApplicationRepository: appRepo },
  'src/repositories/v2/offerRequestRepository': { offerRequestRepository: requestRepo },
  'src/repositories/v2/offerRepository': { offerRepository: offerRepo },
  'src/repositories/v2/activityRepository': { activityRepository: activity },
  'src/repositories/v2/companyRepositoryV2': { companyRepositoryV2: { getMembers: async () => [] } },
  'src/repositories/v2/catalogRepository': { catalogRepository: { getAircraftTypeRatings: async () => [], getEngines: async () => [] } },
  'src/repositories/v2/chatRepository': { chatRepository: { getRoomsForCompany: async () => rooms,
    getRoom: async id => rooms.find(r => r.id === id), getMessages: async () => [] } },
  'src/utils/matchingV2': { matchPairs: async pairs => pairs.map(() => null), matchPair: async () => null },
};
const cache = new Map();
const internals = {
  'app/company/offers/[id]': ['TechnicianRow'], 'app/company/(tabs)/search': ['TechnicianResultCard'],
  'app/company/(tabs)/index': ['PendingCard'],
};
function load(key) {
  if (mocks[key]) return mocks[key];
  if (cache.has(key)) return cache.get(key);
  const filename = ['.ts', '.tsx', '.native.ts', '.web.ts'].map(ext => path.join(root, key + ext)).find(fs.existsSync);
  assert.ok(filename, `Module not found: ${key}`);
  let source = fs.readFileSync(filename, 'utf8');
  for (const name of internals[key] ?? []) source += `\nexport { ${name} };\n`;
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, esModuleInterop: true,
  } }).outputText;
  const exports = {};
  cache.set(key, exports);
  vm.runInNewContext(compiled, { exports, console, setTimeout, clearTimeout, require(name) {
    if (name === 'react') return react;
    if (name === 'react-native' || name === 'lucide-react-native') return widgets;
    if (name === 'expo-router') return routing;
    assert.ok(name.startsWith('.'), `Unexpected external module: ${name}`);
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(key), name));
    if (mocks[target]) return mocks[target];
    if (target.startsWith('src/components/') && !target.endsWith('/Avatar')) return widgets;
    if (target.startsWith('src/theme')) return { colors: {}, spacing: {}, typography: {}, fonts: {}, radius: {}, ui: {}, UI_TONES: new Proxy({}, { get: () => ({}) }) };
    if (target.startsWith('src/repositories/')) return new Proxy({}, { get: (_, prop) => new Proxy({}, { get: (_, method) => () => { throw Error(`Unexpected I/O: ${prop}.${method}`); } }) });
    return load(target);
  } }, { filename });
  return exports;
}
const privacy = load('src/utils/privacyV2');
const mapper = load('src/repositories/v2/supabaseMappers');
const adapters = load('src/utils/v2CompatAdapters');
const relationUtils = load('src/utils/companyTechnicianRelations');
const avatar = load('src/components/ui/Avatar');
function reset() { state = []; cursor = 0; effects = []; mount = true; }
function render(fn, props) { cursor = 0; return fn(props); }
async function mounted(fn, props) {
  reset(); render(fn, props);
  const pending = effects.map(fn => fn()); mount = false;
  await Promise.all(pending);
  // Drain finite asynchronous repository chains (no timers or network).
  for (let i = 0; i < 50; i++) await Promise.resolve();
  return render(fn, props);
}
function nodes(element) {
  if (!element || typeof element !== 'object') return [];
  if (Array.isArray(element)) return element.flatMap(nodes);
  if (!('type' in element)) return [];
  return [element, ...(element.children ?? []).flatMap(nodes), ...Object.values(element.props).flatMap(nodes)];
}
function assertIdentity(label, element, unlocked) {
  const all = nodes(element);
  const expected = unlocked ? 'Ana García' : 'T-LOCKED';
  const visible = all.flatMap(n => [...n.children, ...['name', 'title', 'accessibilityLabel'].map(k => n.props[k])])
    .filter(v => typeof v === 'string').join(' ');
  assert.ok(visible.includes(expected), `${label}: missing ${expected}`);
  assert.ok(!visible.includes(unlocked ? 'T-UNLOCKED' : 'Ana García'), `${label}: wrong identity`);
  let face = all.find(n => n.type === 'Avatar' || n.type === avatar.Avatar);
  const hero = all.find(n => n.type === 'PersonHero');
  if (!face && hero) {
    const personHero = extract('src/components/company/CompanyPage.tsx', 'PersonHero', { React: react, View: 'View', Text: 'Text', Avatar: 'Avatar', styles: {} });
    face = nodes(personHero(hero.props)).find(n => n.type === 'Avatar');
  }
  assert.ok(face, `${label}: missing avatar`);
  assert.equal(face.props.anonymous, !unlocked, `${label}: avatar mode`);
  reset();
  const actualAvatar = nodes(avatar.Avatar(face.props));
  const letters = actualAvatar.flatMap(n => n.children).filter(v => typeof v === 'string');
  assert.equal(face.props.photoPath ?? null, unlocked ? 'private-photo' : null, `${label}: gated photo path`);
  assert.equal(actualAvatar.some(n => n.type === 'Image'), unlocked, `${label}: actual photo`);
  assert.equal(letters.includes('AG'), false, `${label}: photo replaces initials`);
  assert.equal(actualAvatar.some(n => n.type === 'User'), !unlocked, `${label}: generic icon`);
}
function extract(file, name, context) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
  let found;
  function visit(node) { if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name?.getText(source) === name) found = node; ts.forEachChild(node, visit); }
  visit(source); assert.ok(found, name);
  let code = found.getText(source).replace(/^export /, '');
  if (ts.isMethodDeclaration(found)) code = code.replace(/^async /, 'async function ');
  return vm.runInNewContext(ts.transpileModule(code + `\n${name};`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 } }).outputText, context);
}
function fixture(unlocked, acceptedKind = 'application') {
  const row = { photo_path: 'private-photo', id: unlocked ? 'unlocked' : 'locked', anonymous_code: unlocked ? 'T-UNLOCKED' : 'T-LOCKED',
    first_name: unlocked ? 'Ana' : null, last_name: unlocked ? 'García' : null, email: unlocked ? 'ana@example.test' : null,
    availability: { immediately: true, contract_types: [] }, verification_status: 'verified', location_country_code: 'ES' };
  const view = mapper.mapPublicTechnicianView(row);
  views = { [view.id]: view };
  current = { id: 'current', kind: 'application', companyId: 'company', technicianId: view.id,
    offerId: 'new-offer', status: 'pending', identityRevealed: false, createdAt: '2026-10-08T08:00:00Z' };
  const accepted = { ...current, id: 'previous', offerId: 'old-offer', kind: acceptedKind, status: 'accepted' };
  applications = [current, ...(unlocked && acceptedKind === 'application' ? [accepted] : [])];
  requests = [{ ...current, kind: 'direct_offer' }, ...(unlocked && acceptedKind === 'direct_offer' ? [accepted] : [])];
  rooms = [{ id: 'room', technicianId: view.id, offerApplicationId: 'current', createdAt: current.createdAt }];
  return { row, view };
}
async function main() {
  for (const acceptedKind of ['application', 'direct_offer']) for (const unlocked of [true, false]) for (wide of [false, true]) {
    const { row, view } = fixture(unlocked, acceptedKind);
    const suffix = `${acceptedKind}/${unlocked ? 'unlocked' : 'locked'}/${wide ? 'desktop' : 'mobile'}`;
    const check = (label, element) => assertIdentity(`${label} ${suffix}`, element, unlocked);
    // The candidate comes through the real repository mapping, not a hand-built name.
    const candidateLoader = extract('src/repositories/v2/technicianRepositoryV2.ts', 'getPublicMatchCandidates', {
      applyMinYearsFilter: q => q, supabase: { from: () => ({ select: () => ({ eq: () => ({ range: async () => ({ data: [row], count: 1 }) }) }) }) },
      PUBLIC_SELECT: '', TECHNICIAN_FETCH_LIMIT: 1000, throwIfError: () => {}, warnIfTruncated: () => {},
      loadTechnicianRelations: async () => ({}), publicRowToPrivateCompat: mapper.publicRowToPrivateCompat,
      mapPublicTechnicianRow: mapper.mapPublicTechnicianRow, mapPublicTechnicianView: mapper.mapPublicTechnicianView,
    });
    const [candidate] = await candidateLoader();
    reset();
    check('Offer', load('app/company/offers/[id]').TechnicianRow({ result: { technician: candidate.preview, score: { total: 80, blockers: [] } }, wide,
      ratingIndex: new Map(), breakdownRows: [], canSend: true, offerOpen: true }));
    const search = await mounted(load('src/state/useTechnicianSearch').useTechnicianSearch);
    await search.search();
    const searched = render(load('src/state/useTechnicianSearch').useTechnicianSearch).results[0];
    const card = load('app/company/(tabs)/search').TechnicianResultCard;
    reset(); check('All technicians', card({ technician: searched, wide, ratingIndex: new Map() }));
    const contacts = await relationUtils.loadCompanyContacts('company', requests, applications, techRepo.getViewForCompany);
    assert.equal(contacts.length, unlocked ? 1 : 0, 'Your contacts excludes locked technicians');
    if (unlocked) { reset(); check('Your contacts', card({ technician: adapters.v2UnlockedViewToSafeView(contacts[0], new Map()), wide, ratingIndex: new Map() })); }
    const map = await mounted(load('src/state/useMapTechnicians').useMapTechnicians, {});
    check('Map sheet', load('src/components/technician-map/TechnicianMapSheets').TechnicianMapDetailSheet({
      group: { technicians: map.technicians }, tradeLabelsById: {}, typeRatingLabelsById: {} }));
    const appsScreen = await mounted(load('app/company/applications/index').default);
    const appRow = nodes(appsScreen).find(n => typeof n.type === 'function' && n.props.entry?.app.id === 'current');
    assert.ok(appRow, 'Application row loaded');
    check('Applications', appRow.type(appRow.props));
    check('Application detail', await mounted(load('app/company/applications/[id]').default));
    const directScreen = await mounted(load('app/company/direct-offers/index').default);
    const directRow = nodes(directScreen).find(n => typeof n.type === 'function' && n.props.row?.id === 'current');
    assert.ok(directRow, 'Direct offer row loaded');
    check('Direct offers', directRow.type(directRow.props));
    current = { ...current, kind: 'direct_offer' };
    check('Direct offer detail', await mounted(load('app/company/direct-offers/[id]').default));
    const inbox = await load('src/state/companyInbox').loadCompanyInbox('company');
    check('Inbox', load('src/components/company/CompanyInboxList').CompanyInboxRow({ entry: inbox[0], wide }));
    // Exercise the header's defensive locked-view fallback behind the existing
    // accepted-room gate. This does not make a pending room accessible.
    current = { ...current, status: 'accepted' };
    check('Chat', await mounted(load('src/components/company/CompanyChatPanel').CompanyChatPanel, { roomId: 'room', mode: wide ? 'pane' : 'screen' }));
    const home = await mounted(load('src/state/useCompanyHome').useCompanyHome, 'company');
    reset(); check('Home pending', load('app/company/(tabs)/index').PendingCard({ pending: home.data.pending, wide }));
    console.log(`PASS company identity: all surfaces ${suffix}`);
  }
  // An acceptance for another company and flags on a pending relationship grant nothing.
  fixture(false);
  applications.push({ ...current, companyId: 'other-company', status: 'accepted' });
  requests[0].identityRevealed = true;
  assert.equal((await relationUtils.loadCompanyContacts('company', requests, applications, techRepo.getViewForCompany)).length, 0);
  const search = await mounted(load('src/state/useTechnicianSearch').useTechnicianSearch);
  await search.search();
  assert.equal(render(load('src/state/useTechnicianSearch').useTechnicianSearch).results[0].fullName, undefined);
  // Even when the local acceptance snapshot says yes, the protected view wins.
  applications.push({ ...current, status: 'accepted' });
  const staleSearch = await mounted(load('src/state/useTechnicianSearch').useTechnicianSearch);
  await staleSearch.search();
  assert.equal(render(load('src/state/useTechnicianSearch').useTechnicianSearch).results[0].fullName, undefined);
  const staleMap = await mounted(load('src/state/useMapTechnicians').useMapTechnicians, {});
  assert.equal(staleMap.technicians[0].fullName, undefined);
  assert.equal((await relationUtils.loadCompanyContacts('company', requests, applications, techRepo.getViewForCompany)).length, 0);
  console.log('PASS company identity: other company, pending flags and protected-view denial');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
