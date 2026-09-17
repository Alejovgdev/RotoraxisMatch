import assert from 'node:assert/strict';
import { AUTHORITY_LICENSES } from '../src/constants/licenses';
import { AircraftTypeRatingCatalog, EngineCatalog, EngineType } from '../src/types/catalog';
import { individualTypeRatingScopeError, licenseAllowsIndividualTypeRatings } from '../src/utils/individualTypeRatingScope';
import { licensesForHabilitations } from '../src/utils/profileLicenses';

const types: EngineType[] = ['piston', 'turbofan', 'turbojet', 'turboprop', 'turboshaft', 'apu'];
let cases = 0;
for (const { authority, code } of AUTHORITY_LICENSES) {
  const individual = ['B1.1', 'B1.2', 'B1.3', 'B1.4', 'B2', 'C'].includes(code);
  assert.equal(licenseAllowsIndividualTypeRatings(authority, code), individual);
  assert.equal(licensesForHabilitations([{ authority, code }]).length, individual ? 1 : 0);
  for (const productType of ['Aeroplane', 'Helicopter', 'Gas Airship', undefined] as const) {
    for (const type of [...types, undefined]) {
      const engine = { id: 'engine', engineType: type, isActive: false } as EngineCatalog;
      const index = new Map(type ? [[engine.id, engine]] : []);
      const rating = { id: 'rating', productType, engineId: 'engine' } as AircraftTypeRatingCatalog;
      const error = individualTypeRatingScopeError(authority, code, rating, index);
      const isB1 = code.startsWith('B1.');
      const product = ['B1.1', 'B1.2'].includes(code) ? 'Aeroplane' : 'Helicopter';
      const piston = ['B1.2', 'B1.4'].includes(code);
      const expected = !individual ? 'category' : !isB1 ? null : productType !== product ? 'product'
        : !type || type === 'apu' ? 'unknown_propulsion' : (type === 'piston') !== piston ? 'propulsion' : null;
      assert.equal(error, expected, `${authority}/${code}/${productType}/${type}`);
      // Dirty text must never invent engine evidence.
      assert.equal(individualTypeRatingScopeError(authority, code, { ...rating, engineManufacturer: 'Piston', engineFamily: 'Turbine' }, index), expected);
      cases++;
    }
  }
}
assert.equal(licenseAllowsIndividualTypeRatings('FAA', 'B1.1'), false);
assert.equal(licenseAllowsIndividualTypeRatings('UNKNOWN', 'B1.1'), false);
assert.equal(licenseAllowsIndividualTypeRatings('EASA', 'UNKNOWN'), false);
console.log(`PASS H3: ${cases} authority/category/product/propulsion cases; selection and unknown catalogs`);
