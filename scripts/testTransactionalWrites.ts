import assert from 'node:assert/strict';
// Real repositories, injected transport. The database atomicity is tested
// separately by testTransactionalWrites.sql on the real database with rollback.
let ratings = [{ aircraft_type_rating_id: 'rating-old' }];
let engines = [{ engine_id: 'engine-old', years: 5 }];
let offerRatings = [{ offer_id: 'offer', aircraft_type_rating_id: 'rating-old', product_type: 'Aeroplane' }];
const offer = { id: 'offer', company_id: 'company', product_type: 'Aeroplane', technician_type: 'mechanic',
  offer_kind: 'aircraft', requires_certification: true, license_code: 'B1.1', license_authority: 'EASA',
  status: 'draft', visible: false, contract_type: 'permanent', location_country: 'Spain', location_country_code: 'ES' };
const fail = { message: 'Injected write failure' };
const fake = {
  rpc: async () => ({ data: null, error: fail }),
  from(table: string) {
    let op = 'select'; let one = false;
    const q = {
      select() { return q; }, eq() { return q; }, in() { return q; },
      delete() { op = 'delete'; return q; }, insert() { op = 'insert'; return q; }, update() { op = 'update'; return q; },
      maybeSingle() { one = true; return q; }, single() { one = true; return q; },
      then(resolve: (r: unknown) => unknown) {
        if (op === 'delete') {
          if (table === 'technician_habilitations') ratings = [];
          if (table === 'technician_engine_experience') engines = [];
          if (table === 'offer_required_habilitations') offerRatings = [];
        }
        const data = table === 'offers' ? (one ? offer : [offer]) : table === 'offer_required_habilitations' ? offerRatings : [];
        return Promise.resolve({ data, error: ['insert', 'update'].includes(op) ? fail : null }).then(resolve);
      },
    }; return q;
  },
};
for (const [name, moduleExports] of [['../src/lib/supabase', { supabase: fake }], ['../src/lib/documentStorage', {}]] as const) {
  const path = require.resolve(name);
  require.cache[path] = { id: path, filename: path, loaded: true, exports: moduleExports } as NodeModule;
}
const { technicianRepositoryV2: tech } = require('../src/repositories/v2/technicianRepositoryV2') as typeof import('../src/repositories/v2/technicianRepositoryV2');
const { offerRepository: offers } = require('../src/repositories/v2/offerRepository') as typeof import('../src/repositories/v2/offerRepository');
let failures = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`); } catch (e) { failures++; console.error(`FAIL ${name}`, (e as Error).message); }
}
async function main() {
  await test('H1 missing credential preserves existing habilitations', async () => {
    await assert.rejects(tech.replaceHabilitations('tech', [{ authority: 'UK_CAA', licenseCode: 'B1.1', aircraftTypeRatingId: 'rating-new' }]));
    assert.equal(ratings.length, 1);
  });
  await test('H1 failed engine replacement preserves existing engines', async () => {
    await assert.rejects(tech.replaceEngineExperience('tech', [{ engineId: 'engine-new', years: 71 }]));
    assert.equal(engines.length, 1);
  });
  await test('H1 failed offer product update preserves aircraft requirements', async () => {
    await assert.rejects(offers.update('offer', { productType: 'Helicopter' }));
    assert.equal(offerRatings.length, 1);
  });
  if (failures) process.exitCode = 1;
}
void main();
