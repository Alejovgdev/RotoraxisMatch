import { authorityHasTypeRatings, isB1LicenseCode, isValidAuthorityLicense } from '../constants/licenses';
import { AircraftTypeRatingCatalog, EngineCatalog, LicenseCode } from '../types/catalog';
import { getCompatiblePropulsion } from './habilitationScope';
import { getLicenseRatingProductType } from './licenseCategoryProductType';

/** Current catalog only: no group/system endorsements or new licence categories. */
export function licenseAllowsIndividualTypeRatings(authority: string, code: string): boolean {
  return isValidAuthorityLicense(authority, code) && authorityHasTypeRatings(authority)
    && (isB1LicenseCode(code) || code === 'B2' || code === 'C');
}

export type IndividualRatingScopeError = 'category' | 'product' | 'propulsion' | 'unknown_propulsion';

/** Mirrors migration 083. Engine identity comes only from rating.engineId. */
export function individualTypeRatingScopeError(
  authority: string, code: string, rating: AircraftTypeRatingCatalog,
  engineIndex: ReadonlyMap<string, EngineCatalog>,
): IndividualRatingScopeError | null {
  if (!licenseAllowsIndividualTypeRatings(authority, code)) return 'category';
  if (!isB1LicenseCode(code)) return null;
  if (rating.productType !== getLicenseRatingProductType(code as LicenseCode)) return 'product';
  const type = rating.engineId ? engineIndex.get(rating.engineId)?.engineType : undefined;
  const propulsion = type === 'piston' ? 'piston'
    : type && ['turbofan', 'turbojet', 'turboprop', 'turboshaft'].includes(type) ? 'turbine' : undefined;
  if (!propulsion) return 'unknown_propulsion';
  return propulsion === getCompatiblePropulsion(code as LicenseCode) ? null : 'propulsion';
}
