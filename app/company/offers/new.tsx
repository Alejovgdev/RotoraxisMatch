import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { FileText, MapPin, Minus, Plane, Plus, Send } from 'lucide-react-native';
import { colors, spacing } from '../../../src/theme';
import {
  CompanyCard,
  CompanyChip,
  CompanyPageHeader,
  CompanyScreen,
  IconBox,
  companyStyles,
  companyUi,
} from '../../../src/components/company/CompanyUI';
import { TypeRatingRequirementsEditor } from '../../../src/components/company/TypeRatingRequirementsEditor';
import { RequiredLicensesSection } from '../../../src/components/company/RequiredLicensesSection';
import { OfferEngineSection, OfferKindSection, OnlyUnlicensedSection } from '../../../src/components/company/OfferEngineSections';
import { offerRepository } from '../../../src/repositories/v2/offerRepository';
import { useCompanySession } from '../../../src/state/SessionContext';
import { TECHNICIAN_TYPES } from '../../../src/constants/technicianTypes';
import { CONTRACT_TYPES } from '../../../src/constants/contractTypes';
import { OFFER_PRODUCT_TYPES } from '../../../src/constants/offerProductTypes';
import { TechnicianTypeCode, ContractTypeCode } from '../../../src/types/catalog';
import { OfferProductType } from '../../../src/types/offer';
import {
  OfferRequirementsForm,
  certificationQuestionCopy,
  requirementsErrors,
  selectAuthority,
  selectLicense,
  selectOfferKind,
  selectProductType,
  selectTechnicianType,
  setRequiresCertification,
  showsAircraftEditor,
  showsCertificationQuestion,
  showsLicenseSection,
  showsOnlyUnlicensed,
} from '../../../src/utils/offerFormRules';
import { offerAircraftAreExperience } from '../../../src/utils/offerShape';
import { OfferStatus } from '../../../src/types/enums';
import { CountryCityPicker } from '../../../src/components/CountryCityPicker';
import { EMPTY_LOCATION, LocationValue } from '../../../src/types/location';
import { notify, confirmAction } from '../../../src/utils/platformAlert';
import { OfferSalarySection } from '../../../src/components/company/OfferSalarySection';
import { SalaryFormValue, salaryFormFromValue, salaryFormError, salaryFromForm } from '../../../src/utils/offerSalary';

// Paso 5b: los campos de requisitos (clase, motor, oficio, certificación,
// autoridad, licencia, equivalencias, "sólo sin licencia", aeronaves) son
// OfferRequirementsForm, y sus transiciones viven en offerFormRules — las
// mismas que usa la pantalla de edición.
interface FormState extends OfferRequirementsForm {
  title: string;
  description: string;
  contractType: ContractTypeCode;
  salary: SalaryFormValue;
  // Fase 7 F2c: un solo campo con pais + ciudad, en vez de cuatro sueltos
  // que habia que mantener coherentes a mano.
  location: LocationValue;
  minYearsExperience: number;
}

function computeErrors(form: FormState) {
  return {
    salary: salaryFormError(form.salary),
    title: !form.title.trim() ? 'Title is required.'
      : form.title.trim().length < 3 ? 'Title must be at least 3 characters.'
      : undefined,
    description: !form.description.trim() ? 'Description is required.' : undefined,
    // Solo el pais es obligatorio; la ciudad es opcional.
    location: !form.location.country ? 'Please select a country.' : undefined,
    // Fase 6 tanda D / paso 5b: exigir certificar sin autoridad o sin licencia,
    // o una oferta de motor sin motor, son estados que Postgres rechaza. Se
    // avisa aquí, junto al campo, en vez de devolver un error de constraint.
    ...requirementsErrors(form),
  };
}
type FormErrors = Partial<ReturnType<typeof computeErrors>>;

export default function NewOfferScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const companySession = useCompanySession();
  const companyId = companySession?.companyId;

  const [form, setForm] = useState<FormState>({
    title: '',
    description: '',
    contractType: 'permanent',
    salary: salaryFormFromValue(),
    // Arranca en aviones porque el selector siempre está visible y el campo es
    // NOT NULL: un "sin elegir" sería un tercer estado que la base no admite.
    productType: 'Aeroplane',
    location: EMPTY_LOCATION,
    minYearsExperience: 0,
    // Ambos campos son NOT NULL en la base, así que arrancan con un valor
    // real y no con un "sin elegir" que sería un tercer estado inexpresable.
    // `mechanic` es el primero del catálogo por sortOrder; `true` en el
    // interruptor conserva el comportamiento previo a que existiera.
    technicianType: 'mechanic',
    requiresCertification: true,
    // Sin licencia elegida al arrancar: el guardado la exige (CHECK de la
    // 053) y un valor por defecto haria pasar por elegida una que nadie
    // eligio. `requiresAllAircraft` arranca en false — "basta con una".
    // Paso 5b: lo mismo con la AUTORIDAD — nada de EASA por defecto.
    licenseAuthority: undefined,
    licenseCode: undefined,
    acceptsEquivalent: false,
    requiresAllAircraft: false,
    requiredHabilitations: [],
    // Las ofertas de siempre son de aeronave; la de motor se elige.
    offerKind: 'aircraft',
    requiredEngineId: undefined,
    // Desmarcada por defecto: decisión tomada en la 070.
    onlyUnlicensed: false,
  });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});

  // Fase 6 tanda C: el eje Part-66 lo abre o lo cierra el INTERRUPTOR que la
  // empresa marca, no el tipo de perfil buscado. offerRepository impone la
  // misma regla al escribir — esconder una sección no es una garantía.
  const requiresCertification = form.requiresCertification;
  // Sesión 2: en motor la pregunta existe y la licencia es opcional.
  const certificationCopy = certificationQuestionCopy(form);

  // Paso 5b: cada transición es una función de offerFormRules, la misma que
  // usa la pantalla de edición. Creando se aplica SOBRE LA MARCHA y sin aviso
  // —nada de lo que se descarta está guardado todavía—; editando se pregunta
  // antes. Las razones de cada limpieza están escritas allí.
  function apply(transition: (prev: FormState) => FormState) {
    setForm((prev) => transition(prev));
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key === 'salary') setErrors((e) => ({ ...e, salary: undefined }));
    if (key === 'title') setErrors((e) => ({ ...e, title: undefined }));
    if (key === 'description') setErrors((e) => ({ ...e, description: undefined }));
    if (key === 'location') {
      setErrors((e) => ({ ...e, location: undefined }));
    }
  }

  // Tocar un requisito borra sus avisos: el de "falta la licencia" no debe
  // quedarse pintado tras elegirla. Se vuelven a calcular al guardar.
  function applyRequirement(transition: (prev: FormState) => FormState) {
    apply(transition);
    setErrors((e) => ({ ...e, authority: undefined, license: undefined, engine: undefined }));
  }

  async function handleSave(status: OfferStatus) {
    const errs = computeErrors(form);
    if (Object.values(errs).some(Boolean)) { setErrors(errs); return; }
    if (!companyId) {
      notify('Not ready yet', 'Your session is still loading. Try again in a moment.');
      return;
    }

    setSaving(true);
    try {
      await offerRepository.create({
        companyId,
        title: form.title.trim(),
        description: form.description.trim(),
        contractType: form.contractType,
        salary: salaryFromForm(form.salary),
        productType: form.productType,
        location: form.location,
        minYearsExperience: form.minYearsExperience,
        status,
        technicianType: form.technicianType,
        requiresCertification: form.requiresCertification,
        licenseAuthority: form.licenseAuthority,
        licenseCode: form.licenseCode,
        acceptsEquivalent: form.acceptsEquivalent,
        requiresAllAircraft: form.requiresAllAircraft,
        requiredHabilitations: form.requiredHabilitations,
        offerKind: form.offerKind,
        requiredEngineId: form.requiredEngineId,
        onlyUnlicensed: form.onlyUnlicensed,
      });
      router.back();
    } catch (e: any) {
      notify('Error', e?.message ?? 'Could not save offer.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <CompanyScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[companyStyles.content, isWide && companyStyles.contentWide]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <CompanyPageHeader
          eyebrow="Offer builder"
          title="New Offer"
          subtitle="Create a role technicians can match against."
          onBack={() => router.back()}
        />

        {/* Paso 5b: 0) aeronave o motor, antes que nada — decide qué pasos
            existen. Después el orden de la Fase 6 tanda C: 1) tipo de perfil,
            2) ¿certificar?, 3) avión o helicóptero, 4) licencia, 5) aeronaves.
            En una oferta de motor no hay 1 ni 5: hay motor, y 2 y 4 son opcionales (sesión 2). */}
        <OfferKindSection value={form.offerKind} onChange={(kind) => applyRequirement((prev) => selectOfferKind(prev, kind))} />

        {form.offerKind === 'aircraft' && (
          <ChoiceSection
            title="Profile type"
            helper="One per offer. Two types in one advert are two jobs — publish them separately."
          >
            {TECHNICIAN_TYPES.filter((t) => t.isActive).map((t) => (
              <CompanyChip
                key={t.code}
                label={t.label}
                selected={form.technicianType === t.code}
                onPress={() => applyRequirement((prev) => selectTechnicianType(prev, t.code as TechnicianTypeCode))}
              />
            ))}
          </ChoiceSection>
        )}

        {/* La pregunta sólo existe para los oficios que tienen licencia. Para
            chapa, pintura y composite no hay eje Part-66 que abrir, así que
            no se pregunta ni se pinta nada de lo que cuelga de ella. Sesión 2:
            y en toda oferta de motor, donde la licencia es opcional. */}
        {showsCertificationQuestion(form) && (
          <ChoiceSection
            title={certificationCopy.title}
            helper={certificationCopy.helper}
          >
            <CompanyChip label={certificationCopy.yes} selected={requiresCertification} onPress={() => applyRequirement((prev) => setRequiresCertification(prev, true))} />
            <CompanyChip label={certificationCopy.no} selected={!requiresCertification} onPress={() => applyRequirement((prev) => setRequiresCertification(prev, false))} />
          </ChoiceSection>
        )}

        {/* Paso 5b: sólo cuando la oferta NO exige licencia — en aeronave y en
            motor. Volver a "Yes, licence required" la desmarca. */}
        {showsOnlyUnlicensed(form) && (
          <OnlyUnlicensedSection checked={form.onlyUnlicensed} onChange={(next) => set('onlyUnlicensed', next)} />
        )}

        <FormSection
          title="Airplanes or helicopters?"
          subtitle={
            form.offerKind === 'engine'
              ? 'The kind of aircraft this engine work is for.'
              : 'An offer covers one or the other, never both. This sets which licence categories and type ratings you can require below.'
          }
          icon={Plane}
        >
          <View style={styles.chipRow}>
            {OFFER_PRODUCT_TYPES.map((p) => (
              <CompanyChip
                key={p.code}
                label={p.label}
                selected={form.productType === p.code}
                onPress={() => applyRequirement((prev) => selectProductType(prev, p.code as OfferProductType))}
              />
            ))}
          </View>
        </FormSection>

        <FormSection title="Offer details" subtitle="Describe the work clearly enough for match scoring." icon={FileText}>
          <FormField label="Title" error={errors.title}>
            <TextInput
              style={[styles.input, errors.title && styles.inputError]}
              placeholder="e.g. B1.1 Line Maintenance Technician"
              placeholderTextColor={companyUi.textMuted}
              value={form.title}
              onChangeText={(v) => set('title', v)}
            />
          </FormField>

          <FormField label="Description" error={errors.description}>
            <TextInput
              style={[styles.input, styles.textarea, errors.description && styles.inputError]}
              placeholder="Describe the role, responsibilities and context..."
              placeholderTextColor={companyUi.textMuted}
              value={form.description}
              onChangeText={(v) => set('description', v)}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </FormField>

          <FormField label="Contract type">
            <View style={styles.chipRow}>
              {CONTRACT_TYPES.map((ct) => (
                <CompanyChip
                  key={ct.code}
                  label={ct.label}
                  selected={form.contractType === ct.code}
                  onPress={() => set('contractType', ct.code as ContractTypeCode)}
                />
              ))}
            </View>
          </FormField>

          <FormField label="Minimum years of experience">
            <View style={styles.stepper}>
              <TouchableOpacity
                style={styles.stepButton}
                onPress={() => set('minYearsExperience', Math.max(0, form.minYearsExperience - 1))}
                activeOpacity={0.75}
              >
                <Minus color={companyUi.textSoft} size={17} strokeWidth={2} />
              </TouchableOpacity>
              <Text style={styles.stepValue}>{form.minYearsExperience} yrs</Text>
              <TouchableOpacity
                style={styles.stepButton}
                onPress={() => set('minYearsExperience', Math.min(30, form.minYearsExperience + 1))}
                activeOpacity={0.75}
              >
                <Plus color={companyUi.textSoft} size={17} strokeWidth={2} />
              </TouchableOpacity>
            </View>
          </FormField>
        </FormSection>

        <OfferSalarySection value={form.salary} onChange={(value) => set('salary', value)} error={errors.salary} />

        {/* Fase 7 F2c. El aeropuerto base desaparece del formulario: la
            localización de una oferta es el país (lo único que puntúa) y,
            opcionalmente, la ciudad. El campo de aeropuerto era de sólo
            lectura y se rellenaba solo, así que no se pierde ninguna
            decisión del usuario. */}
        <FormSection title="Location" subtitle="The country is what candidates are matched on. The city only helps them place the role." icon={MapPin}>
          <CountryCityPicker value={form.location} onChange={(value) => set('location', value)} />
          {errors.location ? <Text style={styles.fieldError}>{errors.location}</Text> : null}
        </FormSection>

        {/* 4) licencia y 5) aeronaves. Solo existen si la oferta exige
            certificar: sin licencia de por medio no hay nada que pedir en
            este eje. */}
        {showsLicenseSection(form) && (
          <RequiredLicensesSection
            form={form}
            onChangeAuthority={(next) => applyRequirement((prev) => selectAuthority(prev, next))}
            onChangeLicense={(next) => applyRequirement((prev) => selectLicense(prev, next))}
            onChangeAcceptsEquivalent={(next) => set('acceptsEquivalent', next)}
            authorityError={errors.authority}
            licenseError={errors.license}
          />
        )}

        {form.offerKind === 'engine' && (
          <OfferEngineSection
            value={form.requiredEngineId}
            onChange={(engineId) => applyRequirement((prev) => ({ ...prev, requiredEngineId: engineId }))}
            error={errors.engine}
          />
        )}

        {/* Fase 6 tanda E: las AERONAVES se piden certifique o no —
            "ayudante para el A320" tiene que poder decir A320. Paso 5b: salvo
            en una oferta de motor. Sesión 2: bajo la FAA, que no emite type
            ratings, se piden como experiencia. */}
        {showsAircraftEditor(form) && (
          <TypeRatingRequirementsEditor
            value={form.requiredHabilitations}
            onChange={(next) => set('requiredHabilitations', next)}
            productType={form.productType}
            licenseCode={form.licenseCode}
            asExperience={offerAircraftAreExperience(form)}
            requiresAll={form.requiresAllAircraft}
            onChangeRequiresAll={(next) => set('requiresAllAircraft', next)}
          />
        )}

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.secondaryButton, saving && styles.disabled]}
            onPress={() => handleSave('draft')}
            disabled={saving}
            activeOpacity={0.75}
          >
            {saving ? <ActivityIndicator color={companyUi.textSoft} size="small" /> : <FileText color={companyUi.textSoft} size={16} strokeWidth={2} />}
            <Text style={styles.secondaryButtonText}>Save draft</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.primaryButton, saving && styles.disabled]}
            onPress={() => handleSave('published')}
            disabled={saving}
            activeOpacity={0.75}
          >
            {saving ? <ActivityIndicator color={colors.white} size="small" /> : <Send color={colors.white} size={16} strokeWidth={2} />}
            <Text style={styles.primaryButtonText}>Publish</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </CompanyScreen>
  );
}

function FormSection({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle: string;
  icon: React.ComponentType<any>;
  children: React.ReactNode;
}) {
  return (
    <CompanyCard style={styles.section}>
      <View style={styles.sectionHeader}>
        <IconBox icon={icon} color={companyUi.accent} backgroundColor={companyUi.accentSoft} />
        <View style={styles.sectionCopy}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionSubtitle}>{subtitle}</Text>
        </View>
      </View>
      {children}
    </CompanyCard>
  );
}

function ChoiceSection({ title, helper, children }: { title: string; helper: string; children: React.ReactNode }) {
  return (
    <CompanyCard style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionSubtitle}>{helper}</Text>
      <View style={styles.choiceWrap}>{children}</View>
    </CompanyCard>
  );
}

function FormField({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  section: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  sectionCopy: {
    flex: 1,
    minWidth: 0,
  },
  sectionTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: companyUi.text,
  },
  sectionSubtitle: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
    color: companyUi.textSoft,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: companyUi.textSoft,
  },
  fieldError: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
    color: companyUi.red,
  },
  inputError: {
    borderColor: '#FECACA',
    backgroundColor: companyUi.redSoft,
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: companyUi.border,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    color: companyUi.text,
    backgroundColor: companyUi.surfaceSoft,
  },
  readonlyInput: {
    color: companyUi.textSoft,
  },
  textarea: {
    minHeight: 104,
    paddingTop: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  choiceWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  stepButton: {
    width: 38,
    height: 38,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: companyUi.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: companyUi.surfaceSoft,
  },
  stepValue: {
    minWidth: 70,
    textAlign: 'center',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: companyUi.text,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: companyUi.border,
    backgroundColor: companyUi.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  primaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: companyUi.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  disabled: {
    opacity: 0.6,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: companyUi.textSoft,
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.white,
  },
});
