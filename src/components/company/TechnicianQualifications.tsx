// Licencias, type ratings, experiencia en aeronaves y motores de un técnico,
// como los ve una empresa (rediseño, fase 3; maquetas W-Candidate y C-Tech).
//
// Todo lo que pinta es parte del contrato PÚBLICO (SafeTechnicianPreview): lo
// trae technician_public_view también antes de aceptar, así que se puede
// enseñar en una candidatura todavía anónima. Nada de identidad pasa por aquí.
//
//   - 'combined' (candidatura): licencias y una sola lista "Experience".
//   - 'sections' (perfil completo): una sección por cada lista, con los vacíos
//     de siempre ("No engines listed.").
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../ui';
import { colors } from '../../theme';
import { credentialLabel } from '../../constants/licenses';
import { getAircraftTypeRatingLabel, type AircraftRatingIndex } from '../../constants/aircraftTypeRatings';
import { getEngineLabel, type EngineIndex } from '../../constants/engines';
import { technicianTypeLabels } from '../../constants/technicianTypes';
import { formatLocation } from '../../utils/formatLocation';
import type { SafeTechnicianPreview } from '../../types/privacy';
import { OutlineTag, Section, TagRow } from './CompanyPage';

type Qualified = Pick<SafeTechnicianPreview, 'licenses' | 'habilitations' | 'aircraftExperience' | 'engines'>;

/** "Mechanic · Madrid, Spain": la línea gris bajo el nombre (o el código) de un técnico. */
export function technicianProfileLine(tech: Pick<SafeTechnicianPreview, 'technicianTypes' | 'city' | 'country'>): string {
  const place = formatLocation(tech.city, tech.country);
  return [technicianTypeLabels(tech.technicianTypes), place].filter(Boolean).join(' · ');
}

interface QualificationLine {
  key: string;
  title: string;
  meta: string;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function yearsText(years: number | undefined, unset: string): string {
  if (years === undefined) return unset;
  return `${years} year${years === 1 ? '' : 's'}`;
}

function ratingLines(tech: Qualified, ratingIndex: AircraftRatingIndex, combined: boolean): QualificationLine[] {
  return tech.habilitations.map((h) => ({
    key: `h-${h.id}`,
    title: h.aircraftTypeRatingId ? getAircraftTypeRatingLabel(h.aircraftTypeRatingId, ratingIndex) : 'Rating not specified',
    meta: (combined
      ? ['Type rating', h.licenseCode]
      : [
          h.licenseCode,
          h.isCurrent === false ? 'Not current' : 'Current',
          h.experienceYears === undefined ? null : `${h.experienceYears} yrs`,
          h.expiresAt ? `Expires ${formatDate(h.expiresAt)}` : null,
        ]).filter(Boolean).join(' · '),
  }));
}

function aircraftLines(tech: Qualified, ratingIndex: AircraftRatingIndex, combined: boolean): QualificationLine[] {
  return tech.aircraftExperience.map((x) => ({
    key: `a-${x.id}`,
    title: getAircraftTypeRatingLabel(x.aircraftTypeRatingId, ratingIndex),
    meta: combined
      ? `Aircraft · ${yearsText(x.years, 'years not specified')}`
      : yearsText(x.years, 'Duration not specified'),
  }));
}

function engineLines(tech: Qualified, engineIndex: EngineIndex, combined: boolean): QualificationLine[] {
  return tech.engines.map((e) => ({
    key: `e-${e.id}`,
    title: getEngineLabel(e.engineId, engineIndex),
    meta: combined
      ? `Engine · ${yearsText(e.years, 'years not specified')}`
      : yearsText(e.years, 'Duration not specified'),
  }));
}

function Lines({ lines, empty }: { lines: QualificationLine[]; empty: string }) {
  if (lines.length === 0) return <Text style={styles.empty}>{empty}</Text>;
  return (
    <View>
      {lines.map((line, i) => (
        <View key={line.key} style={[styles.line, i < lines.length - 1 && styles.lineDivider]}>
          <Text style={styles.lineTitle}>{line.title}</Text>
          <Text style={styles.lineMeta}>{line.meta}</Text>
        </View>
      ))}
    </View>
  );
}

function Licences({ tech, wide }: { tech: Qualified; wide: boolean }) {
  return (
    <Section title="Licences" wide={wide}>
      {tech.licenses.length > 0 ? (
        <TagRow>
          {tech.licenses.map((l) => (
            <OutlineTag key={`${l.authority}-${l.licenseCode}`} label={credentialLabel(l.authority, l.licenseCode)} />
          ))}
        </TagRow>
      ) : (
        <Text style={styles.empty}>No licenses listed.</Text>
      )}
    </Section>
  );
}

export function TechnicianQualifications({
  tech,
  ratingIndex,
  engineIndex,
  variant,
  wide = false,
}: {
  tech: Qualified;
  ratingIndex: AircraftRatingIndex;
  engineIndex: EngineIndex;
  variant: 'combined' | 'sections';
  wide?: boolean;
}) {
  if (variant === 'combined') {
    const lines = [
      ...ratingLines(tech, ratingIndex, true),
      ...aircraftLines(tech, ratingIndex, true),
      ...engineLines(tech, engineIndex, true),
    ];
    return (
      <View style={wide ? styles.pairs : styles.stack}>
        <View style={wide ? styles.pairItem : undefined}><Licences tech={tech} wide={wide} /></View>
        <View style={wide ? styles.pairItemWide : undefined}>
          <Section title="Experience" wide={wide} gap={2}>
            <Lines lines={lines} empty="No type ratings, aircraft or engine experience listed." />
          </Section>
        </View>
      </View>
    );
  }

  const blocks = [
    <Licences key="lic" tech={tech} wide={wide} />,
    <Section key="rat" title="Type ratings" wide={wide} gap={2}>
      <Lines lines={ratingLines(tech, ratingIndex, false)} empty="No type ratings listed." />
    </Section>,
    <Section key="air" title="Aircraft experience" wide={wide} gap={2}>
      <Lines lines={aircraftLines(tech, ratingIndex, false)} empty="No aircraft experience listed." />
    </Section>,
    <Section key="eng" title="Engine experience" wide={wide} gap={2}>
      <Lines lines={engineLines(tech, engineIndex, false)} empty="No engines listed." />
    </Section>,
  ];
  return (
    <View style={wide ? styles.pairs : styles.stack}>
      {blocks.map((block) => (
        <View key={block.key} style={wide ? styles.pairItem : undefined}>{block}</View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: 20,
  },
  pairs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 28,
    rowGap: 22,
  },
  pairItem: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 260,
    minWidth: 0,
  },
  pairItemWide: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 280,
    minWidth: 0,
  },
  line: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    columnGap: 12,
    rowGap: 2,
    paddingVertical: 10,
  },
  lineDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  lineTitle: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  lineMeta: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  empty: {
    fontSize: 14,
    color: colors.textMuted,
  },
});
