// Avatar del rediseño (documento, D2; respuesta 4 de la revisión).
//
//   - Personas en círculo; logos de empresa en cuadrado redondeado (radio
//     ~28 % del tamaño).
//   - Con foto, la foto. Sin foto, iniciales sobre un color suave.
//   - `anonymous`: un técnico cuya identidad está oculta. Icono genérico de
//     persona y NADA MÁS: ni iniciales, ni foto, ni color derivado del nombre.
//     Con `anonymous` el componente ignora `name` y `uri` aunque lleguen, para
//     que un descuido de quien lo monta no pueda filtrar identidad.
//
// Quién es anónimo NO lo decide este componente. Lo decide la pantalla con los
// datos que ya vienen filtrados de la base (technician_public_view anula la
// identidad hasta que hay un contacto aceptado).
//
// Regla de los marcos (fase 8, H): un recuadro, fondo de color, halo o sombra
// alrededor de un avatar sólo se pinta mientras enseña iniciales o el icono
// genérico; con foto o logo, la imagen se ve sola. Lo hace AvatarFrame, que
// mira la misma fuente que el Avatar (useAvatarImage), así que al subir o
// quitar una foto el marco desaparece o vuelve solo. La foto tampoco lleva ya
// fondo gris detrás (se veía en los logos con transparencia).
import React, { useEffect, useState } from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { User } from 'lucide-react-native';
import { Text } from './Text';
import { colors } from '../../theme';
import { useProfileImage } from '../../state/useProfileImage';

const SOFT_PAIRS: readonly [bg: string, fg: string][] = [
  ['#D6ECF8', '#0B5E8C'],
  ['#D5F2E4', '#0B6B45'],
  ['#E3E8EE', '#33465A'],
  ['#F1E9DC', '#5B4528'],
  ['#E8E9F5', '#3D4A57'],
  ['#FBE9DF', '#8A4A0C'],
];

const ANONYMOUS_BG = colors.surfaceMuted;
const ANONYMOUS_FG = colors.textMuted;

/** Iniciales de hasta dos palabras ("Airbus Helicopters" → "AH"). */
export function avatarInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0].charAt(0);
  const second = words.length > 1 ? words[words.length - 1].charAt(0) : '';
  return (first + second).toUpperCase();
}

/** Lo que decide si un avatar pinta una imagen: los mismos datos que recibe el Avatar. */
export interface AvatarImageSource {
  uri?: string | null;
  photoPath?: string | null;
  logoPath?: string | null;
  anonymous?: boolean;
}

// Las imágenes que no se pudieron pintar, compartidas por todos los avatares y
// sus marcos: si una foto falla, el avatar vuelve a las iniciales y su marco
// reaparece a la vez. Una imagen que falló no se reintenta hasta recargar.
const failedImages = new Set<string>();
const failureListeners = new Set<() => void>();

function markImageFailed(uri: string) {
  if (failedImages.has(uri)) return;
  failedImages.add(uri);
  failureListeners.forEach((listener) => listener());
}

/** La imagen que pinta el avatar, o null si pinta iniciales o el icono genérico. */
export function useAvatarImage({ uri, photoPath, logoPath, anonymous = false }: AvatarImageSource): string | null {
  const resolved = useProfileImage(anonymous ? null : photoPath, anonymous ? null : logoPath);
  const [, setFailures] = useState(0);
  useEffect(() => {
    const listener = () => setFailures((n) => n + 1);
    failureListeners.add(listener);
    return () => { failureListeners.delete(listener); };
  }, []);
  if (anonymous) return null;
  const imageUri = uri || resolved;
  return imageUri && !failedImages.has(imageUri) ? imageUri : null;
}

/**
 * El recuadro, fondo, halo o sombra alrededor de un avatar (regla H): `style`
 * se pinta entero mientras el avatar enseña iniciales o el icono genérico. Con
 * foto o logo, el contenedor sigue ahí (mismo tamaño y sitio, para que nada se
 * mueva) pero sin fondo, borde ni sombra. `image` es la misma fuente que la
 * del Avatar que lleva dentro.
 */
export function AvatarFrame({
  image,
  style,
  children,
}: {
  image: AvatarImageSource;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const imageUri = useAvatarImage(image);
  return <View style={[style, imageUri ? styles.bareFrame : null]}>{children}</View>;
}

/** El mismo nombre da siempre el mismo color. */
function softPairFor(name: string): readonly [string, string] {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return SOFT_PAIRS[Math.abs(hash) % SOFT_PAIRS.length];
}

export function Avatar({
  kind = 'person',
  size = 46,
  uri,
  photoPath,
  logoPath,
  name,
  anonymous = false,
}: {
  kind?: 'person' | 'company';
  size?: number;
  uri?: string | null;
  photoPath?: string | null;
  logoPath?: string | null;
  name?: string | null;
  anonymous?: boolean;
}) {
  const imageUri = useAvatarImage({ uri, photoPath, logoPath, anonymous });
  const shape = {
    width: size,
    height: size,
    borderRadius: kind === 'company' ? Math.round(size * 0.28) : size / 2,
  };

  if (anonymous) {
    return (
      <View
        style={[styles.base, shape, { backgroundColor: ANONYMOUS_BG }]}
        accessibilityRole="image"
        accessibilityLabel="Anonymous technician"
      >
        <User color={ANONYMOUS_FG} size={Math.round(size * 0.52)} strokeWidth={2} />
      </View>
    );
  }

  if (imageUri) {
    return (
      <Image
        source={{ uri: imageUri }}
        style={[styles.base, shape]}
        onError={() => markImageFailed(imageUri)}
        accessibilityLabel={name ?? undefined}
      />
    );
  }

  const label = name?.trim() ? name : '';
  const [bg, fg] = label ? softPairFor(label) : [colors.surfaceMuted, colors.textMuted] as const;
  return (
    <View style={[styles.base, shape, { backgroundColor: bg }]} accessibilityRole="image" accessibilityLabel={label || undefined}>
      {label ? (
        <Text style={[styles.initials, { color: fg, fontSize: Math.max(11, Math.round(size * 0.36)) }]} numberOfLines={1}>
          {avatarInitials(label)}
        </Text>
      ) : kind === 'person' ? (
        <User color={fg} size={Math.round(size * 0.52)} strokeWidth={2} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  initials: {
    fontWeight: '800',
  },
  bareFrame: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    shadowOpacity: 0,
    elevation: 0,
    ...(Platform.OS === 'web' ? ({ boxShadow: 'none' } as object) : {}),
  },
});
