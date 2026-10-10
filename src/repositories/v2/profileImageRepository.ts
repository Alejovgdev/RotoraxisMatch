import { randomUUID } from 'expo-crypto';
import { supabase } from '../../lib/supabase';
import type { PreparedProfileImage, ProfileImageKind, ProfileImageStore } from '../../usecases/profileImages';

const buckets = { technician: 'technician-photos', company: 'company-logos' } as const;
const cache = new Map<string, { promise: Promise<string>; expires: number }>();
const listeners = new Set<() => void>();
let revision = 0;
let userId: string | null = null;
let observing = false;

function invalidate() { cache.clear(); revision++; listeners.forEach(fn => fn()); }
function observeAuth() {
  if (observing) return;
  observing = true;
  supabase.auth.onAuthStateChange((event, session) => {
    const next = session?.user.id ?? null;
    if (next !== userId || event === 'SIGNED_OUT') { userId = next; invalidate(); }
  });
}
function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read image.'));
    reader.readAsDataURL(blob);
  });
}

export const profileImageRepository: ProfileImageStore & {
  revision(): number;
  subscribe(listener: () => void): () => void;
  photo(path: string): Promise<string>;
  logo(path: string): string;
} = {
  invalidate,
  revision: () => revision,
  subscribe(listener) { observeAuth(); listeners.add(listener); return () => { listeners.delete(listener); }; },
  logo(path) { return supabase.storage.from(buckets.company).getPublicUrl(path).data.publicUrl; },
  async photo(path) {
    observeAuth();
    const generation = revision;
    const { data: { session }, error } = await supabase.auth.getSession();
    if (revision !== generation) throw new Error('Image session changed.');
    if (error || !session) throw new Error('Sign in to view this photo.');
    const key = `${session.user.id}:${path}`;
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.promise;
    const promise = (async () => {
      // Use the explicit authenticated route. SDK download() uses /object/{bucket}
      // (the legacy mixed public/private route). Never put a token in the URL.
      const root = process.env.EXPO_PUBLIC_SUPABASE_URL!.replace(/\/$/,'');
      const encodedPath = path.split('/').map(encodeURIComponent).join('/');
      const response = await fetch(`${root}/storage/v1/object/authenticated/${buckets.technician}/${encodedPath}`, {
        headers: { Authorization: `Bearer ${session.access_token}`, apikey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY! },
        cache: 'no-store',
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(`Photo unavailable (${response.status}): ${detail?.message ?? detail?.error ?? 'download denied'}`);
      }
      const uri = await blobDataUrl(await response.blob());
      if (revision !== generation) throw new Error('Image session changed.');
      return uri;
    })();
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(key, { promise, expires: Date.now() + 30_000 });
    try { return await promise; }
    catch (error) { if (cache.get(key)?.promise === promise) cache.delete(key); throw error; }
  },
  async upload(kind, id, image: PreparedProfileImage) {
    if (image.bytes.byteLength > 2 * 1024 * 1024) throw new Error('The image is too large. Choose a smaller image.');
    const uuid = randomUUID();
    const path = `${id}/${uuid}.${kind === 'technician' ? 'jpg' : 'png'}`;
    const { error } = await supabase.storage.from(buckets[kind]).upload(path, image.bytes, {
      contentType: image.contentType, upsert: false, cacheControl: kind === 'technician' ? '0' : '3600',
    });
    if (error) throw new Error('Could not upload the image. Check your connection and permissions.');
    return path;
  },
  async savePath(kind, id, previous, next) {
    const table = kind === 'technician' ? 'technician_profiles' : 'companies';
    const column = kind === 'technician' ? 'photo_path' : 'logo_path';
    let query = supabase.from(table).update({ [column]: next }).eq('id',id);
    query = previous === null ? query.is(column,null) : query.eq(column,previous);
    const { data, error } = await query.select('id').maybeSingle();
    if (error) throw new Error('Could not save the image. Check your connection and permissions.');
    if (!data) throw new Error('The image changed elsewhere or you no longer have permission. Reload and try again.');
  },
  async readPath(kind,id) {
    const column = kind === 'technician' ? 'photo_path' : 'logo_path';
    const { data,error } = await supabase.from(kind === 'technician' ? 'technician_profiles' : 'companies')
      .select(column).eq('id',id).single();
    if (error || !data) throw new Error('Could not reload the image.');
    return (data as unknown as Record<string,string|null>)[column];
  },
  async remove(kind,path) {
    const { data,error } = await supabase.storage.from(buckets[kind]).remove([path]);
    if (error || !data?.some(row => row.name === path)) throw new Error('Could not remove the previous image.');
  },
};
