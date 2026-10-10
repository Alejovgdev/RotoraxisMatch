import type { ContractTypeCode } from './catalog';
import type { OfferProductType } from './offer';
import type { OfferRequestStatus } from './enums';
import type { MapPinPrecision } from '../utils/locationBridge';
import type { OfferSalary } from './offerSalary';

export type OfferMapMatchBand = 'excellent' | 'strong' | 'partial' | 'weak';

export interface OfferMapFilters {
  contractTypes?: ContractTypeCode[];
  productTypes?: OfferProductType[];
  matchBands?: OfferMapMatchBand[];
  eligibleOnly?: boolean;
}

export interface OfferMapItem {
  id: string;
  title: string;
  companyName: string;
  logoPath?: string | null;
  contractType: ContractTypeCode;
  salary?: OfferSalary | null;
  productType: OfferProductType;
  location: string;
  latitude: number;
  longitude: number;
  locationPrecision: MapPinPrecision;
  score: number;
  matchLabel: string;
  blockers: string[];
  applicationStatus?: OfferRequestStatus;
}

export function getOfferMapMatchBand(score: number): OfferMapMatchBand {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'strong';
  if (score >= 40) return 'partial';
  return 'weak';
}

export function activeOfferMapFilterCount(filters: OfferMapFilters): number {
  return (
    (filters.contractTypes?.length ?? 0) +
    (filters.productTypes?.length ?? 0) +
    (filters.matchBands?.length ?? 0) +
    (filters.eligibleOnly ? 1 : 0)
  );
}

/**
 * Cuánto marcador cabe en pantalla para una oferta, decidido por
 * `resolveOfferMapMarkerTiers` a partir del zoom y de las colisiones reales.
 *
 *   label -> burbuja con el importe completo (lo que ve el técnico de cerca)
 *   shape -> la forma del tipo de contrato, 56px, sin texto
 *   dot   -> la misma forma a 32px, para zoom continental
 *
 * El importe NUNCA se abrevia ni se redondea para caber: si no cabe la
 * burbuja entera, se baja de nivel y el número se lee en el detalle.
 */
export type OfferMapMarkerTier = 'label' | 'shape' | 'dot';
