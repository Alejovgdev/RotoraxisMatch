// Lógica pura de la Home de empresa (rediseño, fase 2). Sin React ni
// repositorios, para poder probarla: scripts/testCompanyNavigation.ts.
import type { Offer } from '../types/offer';
import type { OfferApplication } from '../types/offerRequest';
import type { TechnicianView } from '../types/privacy';
import { technicianTypeLabel } from '../constants/technicianTypes';
import { CONTRACT_TYPES } from '../constants/contractTypes';
import { formatLocation } from './formatLocation';

export interface CompanyHomeOffer {
  offer: Offer;
  /** Candidaturas pendientes de esta oferta ("New" = pendiente, respuesta 16). */
  pending: number;
  /** Candidaturas de esta oferta, sin contar las retiradas. */
  applicants: number;
}

export interface CompanyHomePending {
  count: number;
  /** La pendiente más reciente: a ella lleva "Review" cuando es la única. */
  latest: { application: OfferApplication; offerTitle: string | null; technician?: TechnicianView | null } | null;
}

/**
 * Las ofertas publicadas (más nuevas primero) con sus contadores, y las
 * candidaturas pendientes. Es lo que "Your next hiring action" mandaba revisar
 * antes del rediseño, ahora repartido entre la tarjeta y la lista.
 */
export function summarizeCompanyHome(
  offers: Offer[],
  applications: OfferApplication[],
): { offers: CompanyHomeOffer[]; pending: CompanyHomePending } {
  const published = offers
    .filter((o) => o.status === 'published')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const pendingApps = applications
    .filter((a) => a.status === 'pending')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const titleById = new Map(offers.map((o) => [o.id, o.title]));
  const latest = pendingApps[0] ?? null;

  return {
    offers: published.map((offer) => {
      const forOffer = applications.filter((a) => a.offerId === offer.id);
      return {
        offer,
        pending: forOffer.filter((a) => a.status === 'pending').length,
        applicants: forOffer.filter((a) => a.status !== 'withdrawn').length,
      };
    }),
    pending: {
      count: pendingApps.length,
      latest: latest ? { application: latest, offerTitle: titleById.get(latest.offerId) ?? null } : null,
    },
  };
}

export interface OfferTile {
  /** El texto grande del cuadrado: la licencia, "ENG" o el oficio abreviado. */
  code: string;
  typeLabel: string;
  bg: string;
  fg: string;
}

// Colores de las maquetas W-Home / W-D-Home, por oficio.
const TONE_BY_TYPE: Record<string, { bg: string; fg: string }> = {
  mechanic: { bg: '#D6ECF8', fg: '#0B5E8C' },
  avionic: { bg: '#D5F2E4', fg: '#0B6B45' },
  engine_technician: { bg: '#E3E8EE', fg: '#33465A' },
};
const OTHER_TONE = { bg: '#F1E9DC', fg: '#5B4528' };

const CODE_BY_TYPE: Record<string, string> = {
  mechanic: 'MEC',
  avionic: 'AV',
  engine_technician: 'ENG',
  sheet_metal_worker: 'SM',
  painter: 'PT',
  composite: 'CP',
  pilot: 'PL',
};

/**
 * El cuadrado de color de una oferta. Una oferta de motor dice "ENG"; si no, la
 * licencia que pide ("B1.1", "A&P"); y sin licencia, el oficio abreviado. Nunca
 * se pinta una licencia que la oferta no pide: un mecánico sin licencia es
 * "MEC", no "B1".
 */
export function offerTile(offer: Pick<Offer, 'offerKind' | 'licenseCode' | 'technicianType'>): OfferTile {
  const tone = TONE_BY_TYPE[offer.technicianType] ?? OTHER_TONE;
  const code = offer.offerKind === 'engine'
    ? 'ENG'
    : offer.licenseCode
      ? offer.licenseCode
      : CODE_BY_TYPE[offer.technicianType] ?? offer.technicianType.slice(0, 2).toUpperCase();
  return { code, typeLabel: technicianTypeLabel(offer.technicianType), ...tone };
}

/** "Permanent · Madrid, Spain": contrato y ubicación de la oferta. */
export function offerMetaLine(offer: Pick<Offer, 'contractType' | 'locationCity' | 'locationCountry'>): string {
  const contract = CONTRACT_TYPES.find((c) => c.code === offer.contractType)?.label ?? offer.contractType;
  const place = formatLocation(offer.locationCity, offer.locationCountry);
  return place ? `${contract} · ${place}` : contract;
}

/** "1 applicant", "3 applicants", "No applicants yet". */
export function applicantsLabel(count: number, emptyLabel = 'No applicants yet'): string {
  if (count <= 0) return emptyLabel;
  return `${count} applicant${count === 1 ? '' : 's'}`;
}

/** "just now", "5 min ago", "2h ago", "3 days ago", "12 Sep". */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  if (!Number.isFinite(diffMs)) return '';
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}
