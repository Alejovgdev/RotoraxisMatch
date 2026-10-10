// Lógica pura de la lista de ofertas del técnico (rediseño, fase 5A; maqueta
// T-Search). Sin React, para poder probarla: scripts/testTechnicianNavigation.ts.
//
// Los filtros son los de antes del rediseño, con el mismo funcionamiento:
//   - tipo de contrato: uno o todos;
//   - aviones o helicópteros (`offer.productType`): uno o todos;
//   - texto: título, ciudad, país o aeropuerto base.
// Se aplican al momento, como antes. El orden también es el de antes: primero
// las ofertas con novedades sin leer en la candidatura, después por %.
// No hay filtro "My licences" (respuesta 12 de la revisión).
import type { ContractTypeCode } from '../types/catalog';
import type { Offer, OfferProductType } from '../types/offer';
import type { OfferRequestStatus } from '../types/enums';
import type { UiTone } from '../theme/ui';
import { CONTRACT_TYPES } from '../constants/contractTypes';
import { OFFER_PRODUCT_TYPES } from '../constants/offerProductTypes';
import { formatLocation } from './formatLocation';
import { formatOfferSalary } from './offerSalary';

export type ContractFilter = ContractTypeCode | 'all';
export type ProductFilter = OfferProductType | 'all';

export interface OfferListFilters {
  contract: ContractFilter;
  product: ProductFilter;
  text: string;
}

export const EMPTY_OFFER_LIST_FILTERS: OfferListFilters = { contract: 'all', product: 'all', text: '' };

/**
 * Las píldoras rápidas de la maqueta ("Airplanes", "Permanent"): una por
 * opción. Dentro de cada grupo se elige UNA, como antes; tocar la elegida
 * vuelve a "todas".
 */
export type OfferQuickChip =
  | { group: 'product'; value: OfferProductType; label: string }
  | { group: 'contract'; value: ContractTypeCode; label: string };

export const OFFER_QUICK_CHIPS: readonly OfferQuickChip[] = [
  ...OFFER_PRODUCT_TYPES.map((p) => ({ group: 'product' as const, value: p.code, label: p.label })),
  ...CONTRACT_TYPES.map((c) => ({ group: 'contract' as const, value: c.code, label: c.label })),
];

export function isQuickChipSelected(filters: OfferListFilters, chip: OfferQuickChip): boolean {
  return chip.group === 'product' ? filters.product === chip.value : filters.contract === chip.value;
}

export function toggleQuickChip(filters: OfferListFilters, chip: OfferQuickChip): OfferListFilters {
  if (chip.group === 'product') {
    return { ...filters, product: filters.product === chip.value ? 'all' : chip.value };
  }
  return { ...filters, contract: filters.contract === chip.value ? 'all' : chip.value };
}

type FilterableOffer = Pick<Offer, 'title' | 'locationCity' | 'locationCountry' | 'locationBaseAirport' | 'contractType' | 'productType'>;

/** El mismo filtro que antes: todos los grupos en uso a la vez. */
export function offerMatchesListFilters(offer: FilterableOffer, filters: OfferListFilters): boolean {
  if (filters.contract !== 'all' && offer.contractType !== filters.contract) return false;
  if (filters.product !== 'all' && offer.productType !== filters.product) return false;
  const q = filters.text.trim().toLowerCase();
  if (q) {
    const haystack = [offer.title, offer.locationCity, offer.locationCountry, offer.locationBaseAirport ?? '']
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

/** Filtra y ordena como antes: novedades sin leer primero; después, más % primero. */
export function filterAndSortOffers<T extends { offer: FilterableOffer & { id: string }; score: { total: number } }>(
  matches: readonly T[],
  filters: OfferListFilters,
  isUnread: (offerId: string) => boolean,
): T[] {
  return matches
    .filter(({ offer }) => offerMatchesListFilters(offer, filters))
    .sort((a, b) => {
      const aUnread = isUnread(a.offer.id) ? 0 : 1;
      const bUnread = isUnread(b.offer.id) ? 0 : 1;
      if (aUnread !== bUnread) return aUnread - bUnread;
      return b.score.total - a.score.total;
    });
}

export function contractLabel(code: string): string {
  return CONTRACT_TYPES.find((c) => c.code === code)?.label ?? code.replace(/_/g, ' ');
}

/** "Permanent · Airplanes · 3+ yrs": contrato, aviones o helicópteros y años mínimos. */
export function offerCardFacts(offer: Pick<Offer, 'contractType' | 'productType' | 'minYearsExperience'>): string {
  const product = OFFER_PRODUCT_TYPES.find((p) => p.code === offer.productType)?.label ?? offer.productType;
  return [
    contractLabel(offer.contractType),
    product,
    offer.minYearsExperience > 0 ? `${offer.minYearsExperience}+ yrs` : null,
  ].filter(Boolean).join(' · ');
}

/** "Manchester, United Kingdom · EGCC": el sitio de la oferta, con su aeropuerto base si lo hay. */
export function offerPlaceLine(offer: Pick<Offer, 'locationCity' | 'locationCountry' | 'locationBaseAirport'>): string {
  const place = formatLocation(offer.locationCity, offer.locationCountry);
  return offer.locationBaseAirport ? `${place} · ${offer.locationBaseAirport}` : place;
}

/** "Airbus · Manchester, United Kingdom": empresa y sitio, para las filas de la Home. */
export function offerCompanyPlaceLine(
  companyName: string | null | undefined,
  offer: Pick<Offer, 'locationCity' | 'locationCountry'>,
): string {
  const place = formatLocation(offer.locationCity, offer.locationCountry);
  return companyName ? `${companyName} · ${place}` : place;
}

/** El salario como hoy, o null si la oferta no lo da. */
export function offerSalaryLine(offer: Pick<Offer, 'salary'>): string | null {
  return offer.salary ? formatOfferSalary(offer.salary) : null;
}

export interface TechnicianStatusLook {
  label: string;
  tone: UiTone;
}

/**
 * El estado de la candidatura del técnico a una oferta, con los textos de
 * antes del rediseño: en la tarjeta de la lista ("Applied - pending") y en la
 * página de la oferta ("Application sent - pending review").
 */
export function technicianApplicationLook(status: OfferRequestStatus, place: 'card' | 'detail'): TechnicianStatusLook {
  switch (status) {
    case 'pending': return { label: place === 'card' ? 'Applied - pending' : 'Application sent - pending review', tone: 'warning' };
    case 'accepted': return { label: 'Accepted', tone: 'success' };
    case 'rejected': return { label: 'Not selected', tone: 'closed' };
    case 'expired': return { label: 'Offer expired', tone: 'closed' };
    case 'withdrawn': return { label: 'Withdrawn', tone: 'closed' };
    default: return { label: String(status), tone: 'muted' };
  }
}

/** La oferta directa que la empresa le mandó para esta misma oferta (textos de antes). */
export function technicianDirectOfferLook(status: OfferRequestStatus): TechnicianStatusLook {
  switch (status) {
    case 'pending': return { label: 'Direct offer received - pending response', tone: 'warning' };
    case 'accepted': return { label: 'Direct offer accepted', tone: 'success' };
    case 'rejected': return { label: 'Direct offer rejected', tone: 'closed' };
    case 'expired': return { label: 'Direct offer expired', tone: 'closed' };
    case 'withdrawn': return { label: 'Direct offer withdrawn', tone: 'closed' };
    default: return { label: String(status), tone: 'muted' };
  }
}
