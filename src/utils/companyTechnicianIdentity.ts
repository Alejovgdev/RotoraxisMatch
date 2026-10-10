import { isUnlocked, type TechnicianView } from '../types/privacy';

/** Photo uses exactly the name gate; never infer it from a technician ID. */
export function companyTechnicianPhoto(view: TechnicianView | null): string | null {
  return view && isUnlocked(view) ? view.photoPath ?? null : null;
}

/** Presentation only. The view must come from the existing company privacy gate. */
export function companyTechnicianName(view: TechnicianView | null): string {
  if (!view) return '[Deleted user]';
  return isUnlocked(view) ? `${view.firstName} ${view.lastName}`.trim() : view.anonymousCode;
}
