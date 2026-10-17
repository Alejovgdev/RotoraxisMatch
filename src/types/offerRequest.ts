import { OfferRequestStatus } from './enums';

// Company sends a direct offer to a specific technician.
// IMPORTANT: identityRevealed and documentsUnlocked are READ-ONLY for the frontend.
// They are set server-side by the on_offer_accepted trigger. Never write these fields from the app.
export interface OfferRequest {
  kind: 'direct_offer'; // discriminant — always present, identifies type in mixed lists
  id: string;
  companyId: string;
  technicianId: string;
  offerId?: string; // optional link to a published offer
  status: OfferRequestStatus;
  identityRevealed: boolean; // READ-ONLY — set by handle_offer_relation_status_transition() trigger. Never write from frontend.
  documentsUnlocked: boolean; // READ-ONLY — set by handle_offer_relation_status_transition() trigger. Never write from frontend.
  message?: string;
  createdAt: string;
  updatedAt: string;
}

// Technician applies to a published offer.
// IMPORTANT: identityRevealed and documentsUnlocked are READ-ONLY for the frontend.
// They are set server-side by the on_offer_accepted trigger. Never write these fields from the app.
export interface OfferApplication {
  kind: 'application'; // discriminant — always present, identifies type in mixed lists
  id: string;
  technicianId: string;
  offerId: string;
  companyId: string; // denormalized
  status: OfferRequestStatus;
  identityRevealed: boolean; // READ-ONLY — set by handle_offer_relation_status_transition() trigger. Never write from frontend.
  documentsUnlocked: boolean; // READ-ONLY — set by handle_offer_relation_status_transition() trigger. Never write from frontend.
  coverNote?: string;
  createdAt: string;
  updatedAt: string;
}

// Unified type for mixed inbox lists (technician or company).
// Always use the `kind` field to discriminate — never rely on field presence checks.
export type OfferInboxRecord = OfferRequest | OfferApplication;

