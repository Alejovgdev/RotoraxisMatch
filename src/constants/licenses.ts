import { isLicensedTechnicianType } from './technicianTypes';
import { AuthorityCode, AuthorityLicenseCode, FaaLicenseCode } from '../types/catalog';

// V2 — Full EASA Part-66 license list
export const LICENSE_CATEGORIES = [
  { code: 'A1',   label: 'A1 — Line Maintenance: Turbine-powered Aeroplanes', categoryGroup: 'A', sortOrder: 1 },
  { code: 'A2',   label: 'A2 — Line Maintenance: Piston-powered Aeroplanes',  categoryGroup: 'A', sortOrder: 2 },
  { code: 'A3',   label: 'A3 — Line Maintenance: Turbine-powered Helicopters', categoryGroup: 'A', sortOrder: 3 },
  { code: 'A4',   label: 'A4 — Line Maintenance: Piston-powered Helicopters',  categoryGroup: 'A', sortOrder: 4 },
  { code: 'B1.1', label: 'B1.1 — Mechanical: Turbine-powered Aeroplanes',     categoryGroup: 'B1', sortOrder: 5 },
  { code: 'B1.2', label: 'B1.2 — Mechanical: Piston-powered Aeroplanes',      categoryGroup: 'B1', sortOrder: 6 },
  { code: 'B1.3', label: 'B1.3 — Mechanical: Turbine-powered Helicopters',    categoryGroup: 'B1', sortOrder: 7 },
  { code: 'B1.4', label: 'B1.4 — Mechanical: Piston-powered Helicopters',     categoryGroup: 'B1', sortOrder: 8 },
  { code: 'B2',   label: 'B2 — Avionics',                                     categoryGroup: 'B2', sortOrder: 9 },
  { code: 'B2L',  label: 'B2L — Limited Avionics',                            categoryGroup: 'B2', sortOrder: 10 },
  { code: 'B3',   label: 'B3 — Piston-engine non-pressurised aeroplanes',     categoryGroup: 'B3', sortOrder: 11 },
  { code: 'L',    label: 'L — Light Aircraft',                                categoryGroup: 'L',  sortOrder: 12 },
  { code: 'C',    label: 'C — Base Maintenance (Aircraft)',                    categoryGroup: 'C',  sortOrder: 13 },
] as const;

export type LicenseCode = (typeof LICENSE_CATEGORIES)[number]['code'];

export const LICENSE_CODES = LICENSE_CATEGORIES.map((l) => l.code);

/**
 * B1.1–B1.4: la rama MECÁNICA Part-66, la que certifica célula Y MOTOR.
 *
 * Fase 10, paso 5b: es la única rama cuyo type rating dice algo del motor. Una
 * B2 en el 737NG autoriza la aviónica de ese avión; no dice nada del CFM56-7B
 * que lleva colgado. Por eso el motor implícito en un type rating —para
 * puntuar y para entrar en una oferta de motor— sólo sale de habilitaciones
 * colgadas de una de éstas. Derivada del catálogo (`categoryGroup`), no
 * escrita a mano.
 */
export const B1_LICENSE_CODES: LicenseCode[] = LICENSE_CATEGORIES.filter((l) => l.categoryGroup === 'B1').map((l) => l.code);

export function isB1LicenseCode(code: string): boolean {
  return (B1_LICENSE_CODES as string[]).includes(code);
}

// ── La licencia DECIDE el oficio: rama Part-66 de cada categoría ────────
//
// ⚠ ESTE MAPA ES UNA INVARIANTE (2026-08-13). Hasta hoy su cabecera decía en
// mayúsculas justo lo contrario — "heurística de UI, NO una invariante", y
// que un técnico con licencia sin el tipo marcado era un estado válido. Las
// dos afirmaciones dejan de ser ciertas, y conviene entender por qué antes de
// tocar nada aquí.
//
// El oficio de un técnico se decía en DOS sitios que podían contradecirse: la
// casilla que marcó al registrarse y las licencias que declaró. Mientras el
// tipo no puntuaba, la contradicción era inofensiva y este mapa sólo servía
// para preguntar mejor al quitar un tipo. Desde el techo por tipo de perfil
// (commit 5193b27) el tipo SÍ mueve el score, así que la misma contradicción
// pasó a decidir puntuaciones. Se elimina en origen en vez de arbitrarla: la
// dirección es licencia -> casilla, la casilla implicada se marca sola y no
// se puede desmarcar mientras la licencia siga declarada.
//
// Esto NO es criterio nuestro, y de ahí que pueda ser invariante: B1.x es la
// rama mecánica y B2/B2L la aviónica POR DEFINICIÓN de la Part-66, no por un
// reparto que hayamos elegido. Los tres restantes se derivan de la misma
// definición, no de prudencia:
//   - A1–A4 van con su B1 correspondiente: son line maintenance de la misma
//     célula y motor que habilita la B1, no una categoría aparte.
//   - B3 es mecánico de pistón. Rama mecánica, sin ambigüedad.
//   - L (light aircraft) cubre célula y motor: el trabajo es mecánico.
//
// `C` sigue FUERA del mapa, y por el mismo motivo de siempre: es supervisión
// de mantenimiento base y la sostienen tanto perfiles B1 como B2, así que de
// ella NO se puede deducir oficio. Meterla aquí implicaría un oficio que la
// licencia no dice. Para el formulario de oferta —donde la pregunta es otra:
// "¿qué licencias puede pedir un puesto de este tipo?"— la C sí entra, y por
// eso la añade `licensesSelectableForOfferType` y no este mapa: aquí dentro
// significaría otra cosa.
//
// ⚠ AÑADIR UN TIPO LICENCIADO NUEVO SON DOS SITIOS, NO UNO. Este mapa y el
// catálogo `TECHNICIAN_TYPES` (src/constants/technicianTypes.ts, campo
// `requiresLicense`). Un tipo declarado licenciado en el catálogo pero SIN
// rama aquí cae en el caso de escape de `licensesSelectableForOfferType`, que
// devuelve el CATÁLOGO ENTERO — hoy sólo le pasa a `pilot`, que está inactivo
// en los selectores y por eso no se nota. El día que ese tipo se active, o
// que llegue uno nuevo, el formulario de oferta aceptará cualquier licencia
// para él EN SILENCIO: ni error, ni lista vacía, ni aviso. Es la dirección
// segura de fallo elegida a propósito (no restringir antes que dejar un
// puesto licenciado sin ninguna licencia que pedir), pero sigue siendo un
// silencio, así que la rama se escribe aquí a la vez que la fila allí.
export const LICENSES_BY_TECHNICIAN_TYPE: Record<string, LicenseCode[]> = {
  mechanic: ['A1', 'A2', 'A3', 'A4', 'B1.1', 'B1.2', 'B1.3', 'B1.4', 'B3', 'L'],
  avionic: ['B2', 'B2L'],
};

/**
 * Los tipos de perfil que estas licencias IMPLICAN.
 *
 * Es la dirección única de la regla: de la licencia al oficio, nunca al
 * revés. El perfil del técnico marca estos tipos solo y no deja desmarcarlos
 * mientras la licencia siga declarada (app/technician/profile.tsx), y
 * `replaceProfileTypes` los vuelve a exigir al escribir — una pantalla no
 * puede ser el único sitio donde vive una invariante.
 *
 * `C` no implica ninguno (ver el mapa de arriba). Sin licencias -> [], que es
 * lo correcto y no un caso límite: un chapista sin licencias no tiene ningún
 * tipo implicado, y sus tipos manuales siguen siendo enteramente suyos.
 *
 * El orden es el de las claves del mapa (mechanic, avionic), no el de las
 * licencias recibidas: el resultado se compara y se guarda, así que dos
 * llamadas con las mismas licencias en distinto orden tienen que coincidir.
 */
export function typesImpliedByLicenses(codes: readonly string[]): string[] {
  const held = new Set(codes);
  // Paso 5b: también los certificados FAA. El A&P es un certificado de
  // MECÁNICO (14 CFR 65 subparte D), así que implica ese oficio igual que una
  // B1; la FAA no tiene uno de aviónica. Es el mismo mapa que acota qué pide
  // una oferta FAA (FAA_LICENSES_BY_TECHNICIAN_TYPE, más abajo).
  return Object.keys(LICENSES_BY_TECHNICIAN_TYPE).filter(
    (type) =>
      LICENSES_BY_TECHNICIAN_TYPE[type].some((code) => held.has(code)) ||
      (FAA_LICENSES_BY_TECHNICIAN_TYPE[type] ?? []).some((code) => held.has(code)),
  );
}

/**
 * Los tipos de perfil que quedan tras añadir o quitar una licencia.
 *
 * Es la mecánica de las dos mitades de la regla: la licencia nueva marca su
 * tipo, y la última licencia de una rama se lleva el suyo al irse. La ocupa
 * `toggleLicense` en app/technician/profile.tsx; vive aquí, pura, porque es
 * aritmética de conjuntos con casos que hay que poder probar y no una
 * decisión de pantalla.
 *
 * La cuenta es "quita los que implicaban las licencias de ANTES, pon los que
 * implican las de AHORA". De ahí salen las dos propiedades que importan:
 *   - Los tipos MANUALES (chapa, pintura, composite: ninguna licencia los
 *     implica) sobreviven intactos, y pueden convivir con los implicados.
 *   - Ninguna licencia puede dejar colgado el tipo de otra: quitar la B2 de
 *     un B1.1+B2 libera 'avionic' y deja 'mechanic' donde estaba.
 *
 * Consecuencia asumida: un tipo marcado a mano que DESPUÉS pasa a estar
 * implicado se va con la licencia. Distinguir "lo eligió él" de "lo puso la
 * licencia" pediría un tercer estado, y la regla de esta tanda es justamente
 * que sobre ese eje manda la licencia.
 *
 * Puede devolver [] (quitar la única licencia de un perfil sin tipos
 * manuales). Es un estado de FORMULARIO válido y momentáneo, no uno
 * guardable: el mínimo de un tipo lo siguen imponiendo la pantalla y
 * `replaceProfileTypes`, que es donde debe estar.
 */
export function typesAfterLicenseChange(
  currentTypes: readonly string[],
  previousLicenses: readonly string[],
  nextLicenses: readonly string[],
): string[] {
  const impliedBefore = new Set(typesImpliedByLicenses(previousLicenses));
  return [
    ...new Set([
      ...currentTypes.filter((t) => !impliedBefore.has(t)),
      ...typesImpliedByLicenses(nextLicenses),
    ]),
  ];
}

/**
 * Las licencias que una OFERTA para este tipo de técnico puede exigir.
 *
 * Otra pregunta que la de arriba, y por eso otra función: aquélla deduce
 * oficio de una licencia que alguien YA tiene; ésta acota lo que un puesto
 * puede pedir. La `C` entra en las dos ramas licenciadas justamente porque no
 * implica oficio: un puesto de mantenimiento base que certifica lo puede
 * ocupar tanto un B1 como un B2, así que ofrecerla nunca contradice al tipo
 * declarado por la oferta.
 *
 * Los oficios sin licencia (chapista, pintor, composite) devuelven []: no hay
 * eje Part-66 que pedirles. El formulario, además, ni siquiera pinta la
 * pregunta para ellos — ver `isLicensedTechnicianType`, que es quien decide
 * el corte aquí para que las dos decisiones no puedan divergir.
 *
 * Un tipo licenciado SIN rama declarada (hoy sólo `pilot`, inactivo en los
 * selectores, y cualquier código futuro que no esté en el mapa) devuelve el
 * catálogo entero, no []: desconocer su rama es motivo para no restringir,
 * nunca para dejar un puesto licenciado sin ninguna licencia que pedir. Es la
 * misma dirección de error que ya toma `isLicensedTechnicianType`.
 */
export function licensesSelectableForOfferType(code: string): LicenseCode[] {
  if (!isLicensedTechnicianType(code)) return [];
  const branch = LICENSES_BY_TECHNICIAN_TYPE[code];
  if (!branch) return [...LICENSE_CODES];
  return [...branch, 'C'];
}

// ══════════════════════════════════════════════════════════════════════
// FASE 10 — AUTORIDADES
//
// Hasta la 073 toda licencia era EASA sin decirlo. Desde ella, "B1.1" no
// identifica nada por sí solo: hay cinco autoridades y cuatro de ellas emiten
// una B1.1 distinta. Todo lo de aquí abajo es el espejo en TypeScript de tres
// tablas que YA existen en Postgres —`authorities` (064), `license_categories`
// con las tres FAA (065) y `authority_licenses` (066)— y NO una segunda fuente
// de verdad: `npm run validate:authority-licenses` compara esta constante con
// la tabla viva y falla si divergen.
// ══════════════════════════════════════════════════════════════════════

// Las tres de la FAA (migración 065). No entran en LICENSE_CATEGORIES y por
// tanto tampoco en LICENSE_CODES: esa lista es el eje Part-66 y la usan los
// selectores de perfil y de oferta, la implicación licencia -> oficio y las
// tablas de propulsión/producto. Meter aquí 'A&P' habría obligado a todas
// ellas a contestar por un certificado de otro sistema.
export const FAA_LICENSE_CATEGORIES = [
  { code: 'A',   label: 'A — Airframe (FAA)',                  categoryGroup: 'FAA', sortOrder: 14 },
  { code: 'P',   label: 'P — Powerplant (FAA)',                categoryGroup: 'FAA', sortOrder: 15 },
  { code: 'A&P', label: 'A&P — Airframe and Powerplant (FAA)', categoryGroup: 'FAA', sortOrder: 16 },
] as const;

export const FAA_LICENSE_CODES: FaaLicenseCode[] = FAA_LICENSE_CATEGORIES.map((l) => l.code);

/**
 * Las cinco autoridades, con el texto con el que se pintan (Fase 10, paso 5b).
 *
 * Espejo de la tabla `authorities` (migración 064) —etiquetas incluidas: el
 * copy también vive en Postgres— y comprobado contra ella por
 * `npm run validate:authority-licenses`. `hasTypeRatings` es
 * `authorities.has_type_ratings`: la FAA no emite habilitaciones de tipo, así
 * que ni una oferta FAA puede pedir aeronaves ni un técnico colgarlas de un
 * certificado FAA.
 */
export const AUTHORITIES: { code: AuthorityCode; label: string; hasTypeRatings: boolean; sortOrder: number }[] = [
  { code: 'EASA', label: 'EASA', hasTypeRatings: true, sortOrder: 1 },
  { code: 'UK_CAA', label: 'UK CAA', hasTypeRatings: true, sortOrder: 2 },
  { code: 'CASA', label: 'CASA (Australia)', hasTypeRatings: true, sortOrder: 3 },
  { code: 'GCAA', label: 'UAE GCAA', hasTypeRatings: true, sortOrder: 4 },
  { code: 'FAA', label: 'FAA', hasTypeRatings: false, sortOrder: 5 },
];

export function authorityLabel(code: string): string {
  return AUTHORITIES.find((a) => a.code === code)?.label ?? code;
}

export function authorityHasTypeRatings(code: string): boolean {
  return AUTHORITIES.find((a) => a.code === code)?.hasTypeRatings ?? false;
}

/** "EASA B1.1", "FAA A&P". Una credencial se nombra siempre con su autoridad. */
export function credentialLabel(authority: string | undefined, code: string): string {
  return authority ? `${authorityLabel(authority)} ${code}` : code;
}

// Las cuatro que comparten el sistema Part-66. La FAA queda fuera A PROPÓSITO,
// y ésa es la razón de que esta lista exista: es lo que hace que
// `equivalentAuthorities('FAA')` devuelva [] sin ningún caso especial escrito.
export const PART66_AUTHORITIES: AuthorityCode[] = ['EASA', 'UK_CAA', 'CASA', 'GCAA'];

// Qué códigos NO admite cada autoridad Part-66. Escrito como recorte y no como
// lista completa por autoridad para que el día que entre una categoría Part-66
// nueva aparezca sola en las cuatro, que es el comportamiento correcto: un
// recorte es una excepción documentada; una lista repetida cuatro veces son
// cuatro sitios donde olvidarse.
//
// Mismos recortes que la migración 066, y por lo mismo: CASA no emite B2L, B3
// ni L; GCAA no emite B2L.
const PART66_EXCLUSIONS: Partial<Record<AuthorityCode, LicenseCode[]>> = {
  CASA: ['B2L', 'B3', 'L'],
  GCAA: ['B2L'],
};

export interface AuthorityLicenseRow {
  authority: AuthorityCode;
  code: AuthorityLicenseCode;
}

/**
 * Las 51 filas de `authority_licenses` (migración 066): 13 EASA, 13 UK CAA,
 * 10 CASA, 12 GCAA, 3 FAA.
 *
 * Se DERIVA de LICENSE_CODES más los recortes de arriba en vez de listarse a
 * mano, por lo mismo que el seed de la migración se escribe con un CROSS JOIN:
 * 51 filas copiadas son 51 sitios donde equivocarse. El recuento por autoridad
 * lo fija un test, y la paridad con la tabla viva, el validador.
 */
export const AUTHORITY_LICENSES: AuthorityLicenseRow[] = [
  ...PART66_AUTHORITIES.flatMap((authority) =>
    LICENSE_CODES.filter((code) => !(PART66_EXCLUSIONS[authority] ?? []).includes(code)).map(
      (code): AuthorityLicenseRow => ({ authority, code }),
    ),
  ),
  ...FAA_LICENSE_CODES.map((code): AuthorityLicenseRow => ({ authority: 'FAA', code })),
];

const AUTHORITY_LICENSE_PAIRS = new Set(AUTHORITY_LICENSES.map((r) => r.authority + '|' + r.code));

/**
 * ¿Existe esta combinación de autoridad y código?
 *
 * Toma `string` y no los tipos estrechos a propósito: contesta sobre pares que
 * pueden venir de un formulario, de una fila vieja o de una llamada directa a
 * la API, y un tipo estrecho obligaría a castear justo en el sitio donde hay
 * que validar. Una autoridad inexistente ('NOPE') devuelve false, no lanza.
 *
 * Es el mismo predicado que la FK compuesta de `technician_licenses` y
 * `offers` impone en la base; aquí sirve para no ofrecer ni enviar lo que
 * Postgres rechazaría.
 */
export function isValidAuthorityLicense(authority: string, code: string): boolean {
  return AUTHORITY_LICENSE_PAIRS.has(authority + '|' + code);
}

// Qué certificados FAA puede pedir un puesto de cada oficio. El A&P es un
// certificado de MECÁNICO (14 CFR 65 subparte D): la FAA no emite uno de
// aviónica, así que un puesto de aviónico no tiene nada FAA que pedir.
const FAA_LICENSES_BY_TECHNICIAN_TYPE: Record<string, FaaLicenseCode[]> = {
  mechanic: [...FAA_LICENSE_CODES],
  avionic: [],
};

/**
 * Las licencias que una OFERTA de este oficio puede exigir A ESTA AUTORIDAD
 * (Fase 10, paso 5b). La única respuesta: la usan los chips del formulario de
 * oferta y la guarda de offerRepository, así que lo que se ofrece y lo que se
 * acepta no pueden divergir.
 *
 *   Part-66: la rama del oficio (licensesSelectableForOfferType) recortada a
 *            lo que esa autoridad emite (CASA sin B2L/B3/L, GCAA sin B2L).
 *   FAA:     A, P y A&P para mecánico; nada para aviónico.
 *
 * Oficio sin licencias -> []. Oficio licenciado sin rama declarada (`pilot`)
 * -> todo lo que emite la autoridad, misma dirección de fallo que
 * `licensesSelectableForOfferType`.
 */
export function licensesSelectableForOffer(technicianType: string, authority: string): AuthorityLicenseCode[] {
  if (!isLicensedTechnicianType(technicianType)) return [];
  if (authority === 'FAA') {
    return FAA_LICENSES_BY_TECHNICIAN_TYPE[technicianType] ?? [...FAA_LICENSE_CODES];
  }
  return licensesSelectableForOfferType(technicianType).filter((code) => isValidAuthorityLicense(authority, code));
}

/**
 * Las OTRAS autoridades cuyo mismo código vale cuando la oferta marca "acepto
 * equivalentes".
 *
 * Nunca se incluye a sí misma —son las otras, y el caso exacto se decide
 * antes—, y la FAA no aparece en ninguna lista ni tiene la suya: un A&P no es
 * una B1.1 emitida en otro sitio, es otro sistema. Eso no hace falta
 * programarlo dos veces: los códigos FAA y los Part-66 son disjuntos, así que
 * aunque se cruzaran las autoridades no habría ningún par que casara.
 */
export function equivalentAuthorities(authority: string): AuthorityCode[] {
  if (!PART66_AUTHORITIES.includes(authority as AuthorityCode)) return [];
  return PART66_AUTHORITIES.filter((a) => a !== authority);
}

/**
 * ¿Caducan las licencias de esta autoridad?
 *
 * FAA: NO. El certificado de mecánico (14 CFR 65.19) se emite sin fecha de
 * expiración y no se renueva. Lo que sí tiene plazo es la EXPERIENCIA RECIENTE
 * del 65.83 —haber ejercido 6 meses de los últimos 24 para poder ejercer los
 * privilegios—, que es otra cosa: no es una fecha impresa en el papel, esta
 * plataforma no la conoce, y tratarla como caducidad marcaría como vencido a
 * todo titular FAA. CASA también es perpetua: guía oficial de carreras AME,
 * página 7 (https://www.casa.gov.au/sites/default/files/2021-12/aircraft-maintenance-engineer-careers-guide.pdf).
 * EASA, UK CAA y GCAA sí tienen caducidad administrativa.
 *
 * El scorer lo consulta ANTES de comparar `expiresAt` con hoy, así que una
 * fila FAA/CASA con fecha —dato histórico que un PATCH podría
 * escribir— tampoco se lee como caducada.
 */
export function authorityLicenseCanExpire(authority: string): boolean {
  return authority !== 'FAA' && authority !== 'CASA';
}

/**
 * ¿El código que el técnico TIENE satisface el que la oferta PIDE?
 *
 * ── LA ÚNICA IMPLEMENTACIÓN DE ESTA PREGUNTA ──────────────────────────
 * B1.1–B1.4 incluyen respectivamente A1–A4. En FAA, A&P es "airframe and
 * powerplant": quien lo tiene satisface una oferta de A, una de P y una de
 * A&P. Si esa comparación vive en dos sitios, uno de los dos se olvidará del
 * A&P, y el que se olvide dejará fuera al candidato que sí puede hacer el
 * trabajo. Por eso está aquí y se importa; no la repitas en línea.
 *
 * La dirección NO es simétrica: un A no satisface una oferta de A&P. Tener la
 * mitad del certificado no autoriza a firmar la otra mitad.
 */
export function licenseCodeSatisfies(held: string, required: string): boolean {
  if (held === required) return true;
  const includedCategory: Record<string, string> = { 'B1.1': 'A1', 'B1.2': 'A2', 'B1.3': 'A3', 'B1.4': 'A4' };
  if (includedCategory[held] === required) return true;
  return held === 'A&P' && (required === 'A' || required === 'P');
}

/** Cómo de bien responde una credencial por lo que la oferta pide. */
export type LicenseSatisfaction = 'exact' | 'equivalent';

/**
 * ¿Responde ESTA credencial por lo que la oferta pide, y con qué exactitud?
 *
 *   'exact'      misma autoridad, con un código que satisface.
 *   'equivalent' otra autoridad Part-66, y sólo si la oferta marcó la casilla.
 *   null         no responde.
 *
 * `required.authority` ausente = oferta anterior a la 075: se cae al código
 * solo, que es el comportamiento de siempre. NO se asume EASA — asumirla
 * convertiría una oferta sin autoridad en una oferta EASA y dejaría fuera a
 * técnicos que hoy cuentan.
 */
export function licenseSatisfiesRequirement(
  held: { authority: string; licenseCode: string },
  required: { authority?: string; licenseCode: string },
  acceptsEquivalent: boolean,
): LicenseSatisfaction | null {
  if (!licenseCodeSatisfies(held.licenseCode, required.licenseCode)) return null;
  if (required.authority === undefined || held.authority === required.authority) return 'exact';
  if (!acceptsEquivalent) return null;
  // B1 -> A is an inclusion within one authority, not an extra cross-authority
  // equivalence. The checkbox continues to compare the same category abroad.
  if (held.licenseCode !== required.licenseCode) return null;
  return equivalentAuthorities(required.authority).includes(held.authority as AuthorityCode)
    ? 'equivalent'
    : null;
}
