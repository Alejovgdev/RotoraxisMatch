// Exercise the actual card function with a lightweight React element adapter.
// No login, browser, network or duplicate presentation implementation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const filename = path.join(__dirname, '../app/company/(tabs)/search.tsx');
const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['TechnicianResultCard', 'isOpenToOffers', 'relationBadgeLabel', 'relationTone'];
const functions = source.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
assert.equal(functions.length, names.length);
const compiled = ts.transpileModule(functions.map((node) => node.getText(source)).join('\n'), {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 },
}).outputText;
const tone = { bg: 'background', text: 'text' };
const context = {
  React: { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }) },
  View: 'View', Text: 'Text', Avatar: 'Avatar', AvatarFrame: 'AvatarFrame', PillButton: 'PillButton', Check: 'Check', Lock: 'Lock',
  styles: {}, colors: {}, UI_TONES: { success: tone, warning: tone, waiting: tone, closed: tone },
  technicianTypeLabels: () => 'Mechanic', formatLocation: () => 'Madrid, Spain', matchScoreColor: () => 'green',
};
vm.createContext(context);
vm.runInContext(compiled, context);
function flatten(element) {
  return element && typeof element === 'object' ? [element, ...element.children.flatMap(flatten)] : [];
}
const technician = { id: 'tech', fullName: 'Ana García', anonymousCode: 'T-1', availability: { immediately: true }, licenseCategories: [] };
let profiles = 0;
let chats = 0;
const base = { technician, selectedOffer: { id: 'offer' }, score: { total: 87, blockers: [] },
  canSendRole: true, ratingIndex: new Map(), onViewProfile: () => profiles++, onOpenChat: () => chats++, offerMismatch: null };
function render(extra = {}) { return flatten(context.TechnicianResultCard({ ...base, ...extra })); }
const labels = (nodes) => nodes.filter((node) => node.type === 'PillButton').map((node) => node.props.label);
const text = (nodes) => nodes.flatMap((node) => node.type === 'Text' ? node.children : []).filter((item) => typeof item === 'string').join(' ');
const normal = render();
assert.deepEqual(labels(normal), ['Send offer', 'View profile', 'Open chat']);
normal.find((node) => node.props.label === 'View profile').props.onPress();
normal.find((node) => node.props.label === 'Open chat').props.onPress();
assert.equal(profiles, 1);
assert.equal(chats, 1);
assert.equal(normal.find((node) => node.type === 'Avatar').props.name, 'Ana García');
assert.equal(normal.find((node) => node.type === 'Avatar').props.anonymous, false);
assert.match(text(normal), /87%/);
for (const score of [undefined, { total: 19, blockers: ['experience'] }]) {
  const mismatch = render({ score, offerMismatch: "Doesn't meet this offer" });
  assert.deepEqual(labels(mismatch), ['View profile', 'Open chat']);
  assert.match(text(mismatch), /Doesn't meet this offer/);
}
for (const kind of ['application', 'direct_offer']) {
  const related = render({ existingRelation: { kind, status: 'accepted' }, offerMismatch: "Doesn't meet this offer" });
  assert.deepEqual(labels(related), ['View profile', 'Open chat']);
  assert.match(text(related), kind === 'application' ? /Application accepted/ : /Offer accepted/);
}
assert.deepEqual(labels(render({ selectedOffer: null })), ['View profile', 'Open chat']);
assert.deepEqual(labels(render({ canSendRole: false })), ['View profile', 'Open chat'], 'Viewer can read but cannot send');
assert.deepEqual(labels(render({ technician: { ...technician, fullName: undefined }, onOpenChat: undefined })), ['Send offer'], 'anonymous All card keeps its existing actions');
console.log('PASS contact cards: name/avatar, profile/chat actions, unchanged %, mismatch without Send offer, existing relation and Viewer');
