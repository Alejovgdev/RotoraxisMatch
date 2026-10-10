export type ProfileImageKind = 'technician' | 'company';
export type PreparedProfileImage = { bytes: ArrayBuffer; contentType: 'image/jpeg' | 'image/png' };
export interface ProfileImageStore {
  upload(kind: ProfileImageKind, id: string, image: PreparedProfileImage): Promise<string>;
  savePath(kind: ProfileImageKind, id: string, previous: string | null, next: string | null): Promise<void>;
  readPath(kind: ProfileImageKind, id: string): Promise<string | null>;
  remove(kind: ProfileImageKind, path: string): Promise<void>;
  invalidate(): void;
}

/** Upload first, compare-and-set the pointer, then delete only obsolete objects.
 * A lost response may hide a successful write: read it back before compensating.
 */
export async function changeProfileImage(store: ProfileImageStore, kind: ProfileImageKind, id: string,
  previous: string | null, image: PreparedProfileImage | null): Promise<{ path: string | null; cleanupPending: boolean }> {
  const next = image ? await store.upload(kind, id, image) : null;
  try {
    await store.savePath(kind, id, previous, next);
  } catch (error) {
    let actual: string | null;
    try { actual = await store.readPath(kind, id); }
    catch { throw new Error('Could not confirm the image change. Reload your profile before trying again.'); }
    if (actual !== next) {
      if (next) await store.remove(kind, next).catch(() => {});
      throw error;
    }
  }
  store.invalidate();
  let cleanupPending = false;
  if (previous && previous !== next) {
    try { await store.remove(kind, previous); }
    catch { cleanupPending = true; }
  }
  return { path: next, cleanupPending };
}

/** Integer pixel crop, bounded on all sides. x/y are positions from 0 to 1. */
export function squareImageCrop(width: number, height: number, zoom = 1, x = 0.5, y = 0.5) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw new Error('Invalid image dimensions.');
  const side = Math.max(1, Math.floor(Math.min(width, height) / Math.max(1, Math.min(3, zoom))));
  return { originX: Math.round((width - side) * Math.max(0, Math.min(1, x))),
    originY: Math.round((height - side) * Math.max(0, Math.min(1, y))), width: side, height: side };
}
