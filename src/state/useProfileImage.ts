import { useEffect, useState } from 'react';
import { profileImageRepository as images } from '../repositories/v2/profileImageRepository';

export function useProfileImage(photoPath?: string | null, logoPath?: string | null): string | null {
  const [revision, setRevision] = useState(images.revision());
  const [loaded, setLoaded] = useState<{ path: string; revision: number; uri: string } | null>(null);
  useEffect(() => images.subscribe(() => setRevision(images.revision())), []);
  useEffect(() => {
    if (!photoPath) return;
    let active = true;
    images.photo(photoPath).then(uri => {
      if (active) setLoaded({ path: photoPath, revision, uri });
    }).catch(() => { if (active) setLoaded(null); });
    return () => { active = false; };
  }, [photoPath, revision]);
  if (logoPath) return images.logo(logoPath);
  return loaded && loaded.path === photoPath && loaded.revision === images.revision() ? loaded.uri : null;
}
