export type AppRole = 'technician' | 'company_user' | 'admin';

// Espejo del enum SQL `user_status`. Los CINCO valores, en el mismo orden que
// la base: `SELECT enumlabel FROM pg_enum ...` devuelve
// pending_verification, active, blocked, suspended, deleted.
//
// `deleted` faltaba aquí y SÍ existe en la base y en los datos (es el estado
// de una LÁPIDA: cuenta borrada por la Edge Function `delete-account`, PII
// anonimizada, sin usuario de auth, historial conservado). Omitirlo hacía que
// `tsc` no pudiera ayudar a distinguir una cuenta viva de una borrada.
export type UserStatus =
  | 'pending_verification'
  | 'active'
  | 'blocked'
  | 'suspended'
  | 'deleted';

// V2 canonical — matches SQL `verification_status` enum (pending | verified | rejected)
export type VerificationStatus = 'pending' | 'verified' | 'rejected';

export type DocumentStatus = 'pending' | 'verified' | 'rejected' | 'expired';

export type OfferRequestStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'withdrawn';

export type OfferStatus = 'draft' | 'published' | 'closed' | 'expired' | 'archived';

export type CompanyMemberRole = 'admin' | 'recruiter' | 'viewer';

export type SenderRole = 'technician' | 'company';
