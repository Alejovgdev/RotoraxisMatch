// Los motores del perfil del técnico, atados al tipo Engine Technician (Fase
// 10, sesión 4, migración 091).
//
// Sólo un Engine Technician declara motores: la base rechaza los de los demás
// tipos y los borra cuando el técnico deja de serlo. El perfil dice lo mismo
// antes de escribir: no enseña el editor a quien no tiene el tipo, y avisa
// antes de quitar el tipo a quien tiene motores.
//
// Puro, con tests en scripts/testMatching.ts, igual que profileLicenses: la
// pantalla pone el diálogo, pero la regla no es una decisión de pantalla.
import { ENGINE_TECHNICIAN_TYPE_CODE } from '../constants/technicianTypes';

/** ¿Se enseña el editor de experiencia en motores? Sólo a un Engine Technician. */
export function showsEngineExperience(technicianTypes: readonly string[]): boolean {
  return technicianTypes.includes(ENGINE_TECHNICIAN_TYPE_CODE);
}

/**
 * ¿Este cambio de tipos se lleva motores declarados? Es la pregunta que decide
 * si el perfil avisa. Cuentan también los motores añadidos y aún no guardados:
 * se pierden igual.
 */
export function typeChangeDropsEngines(prev: readonly string[], next: readonly string[], engineCount: number): boolean {
  return engineCount > 0 && showsEngineExperience(prev) && !showsEngineExperience(next);
}

export function engineRemovalWarning(engineCount: number): { title: string; message: string; confirmLabel: string } {
  const engines = engineCount === 1 ? '1 declared engine' : `${engineCount} declared engines`;
  return {
    title: 'Remove Engine Technician?',
    message: `Only Engine Technician profiles can declare engines. Your ${engines} will be deleted when you save.`,
    confirmLabel: 'Remove and delete engines',
  };
}
