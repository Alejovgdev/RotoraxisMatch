import React, { useEffect, useState } from 'react';
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
import { Stack, useLocalSearchParams } from 'expo-router';
import { useGoBack } from '../../../src/state/useGoBack';
import { CheckCircle, FileText, MapPin, Minus, Plane, Plus, Save } from 'lucide-react-native';
import { colors, spacing } from '../../../src/theme';
import {
  CompanyCard,
  CompanyChip,
  CompanyPageHeader,
  CompanyScreen,
  EmptyPanel,
  IconBox,
  companyStyles,
  companyUi,
} from '../../../src/components/company/CompanyUI';
import { TypeRatingRequirementsEditor } from '../../../src/components/company/TypeRatingRequirementsEditor';
import { RequiredLicensesSection } from '../../../src/components/company/RequiredLicensesSection';
import { OfferEngineSection, OnlyUnlicensedSection } from '../../../src/components/company/OfferEngineSections';
import { offerRepository } from '../../../src/repositories/v2/offerRepository';
import { TECHNICIAN_TYPES, technicianTypeLabel } from '../../../src/constants/technicianTypes';
import { CONTRACT_TYPES } from '../../../src/constants/contractTypes';
import { OFFER_PRODUCT_TYPES, getOfferProductTypeLabel } from '../../../src/constants/offerProductTypes';
import { authorityLabel } from '../../../src/constants/licenses';
import { TechnicianTypeCode, ContractTypeCode, AuthorityCode, AuthorityLicenseCode } from '../../../src/types/catalog';
import {
  OfferRequirementsForm,
  aircraftRequirementsCopy,
  certificationQuestionCopy,
  describeDropped,
  droppedByTransition,
  requirementsErrors,
  selectAuthority,
  selectLicense,
  selectProductType,
  selectTechnicianType,
  setRequiresCertification,
  showsAircraftEditor,
  showsCertificationQuestion,
  showsLicenseSection,
  showsOnlyUnlicensed,
  technicianTypeHelper,
  toggleAcceptedAuthority,
  selectAcceptedLicenseCode,
} from '../../../src/utils/offerFormRules';
import { offerAircraftAreExperience, offerKindForTechnicianType } from '../../../src/utils/offerShape';
import { OfferStatus } from '../../../src/types/enums';
import { OfferProductType, OfferWithRequirements } from '../../../src/types/offer';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import { CountryCityPicker } from '../../../src/components/CountryCityPicker';
import { LocationValue } from '../../../src/types/location';
import { locationValueFromPersisted } from '../../../src/utils/locationBridge';
import { notify, confirmAction } from '../../../src/utils/platformAlert';
import { OfferSalarySection } from '../../../src/components/company/OfferSalarySection';
import { SalaryFormValue, salaryFormFromValue, salaryFormError, salaryFromForm } from '../../../src/utils/offerSalary';

// Paso 5b: los campos de requisitos son OfferRequirementsForm y sus
// transiciones viven en offerFormRules, las mismas que usa la pantalla de
// creación. Esta pantalla sólo añade la pregunta previa.
interface FormState extends OfferRequirementsForm {
  title: string;
  description: string;
  contractType: ContractTypeCode;
  salary: SalaryFormValue;
  // Fase 7 F2c: un solo campo con pais + ciudad.
  location: LocationValue;
  minYearsExperience: number;
  status: OfferStatus;
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
    // Fase 6 tanda D / paso 5b: certificar sin autoridad o sin licencia, o una
    // oferta de motor sin motor, son estados que Postgres rechaza.
    ...requirementsErrors(form),
  };
}
type FormErrors = Partial<ReturnType<typeof computeErrors>>;

export default function EditOfferScreen() {
  const goBack = useGoBack();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;

  const [offer, setOffer] = useState<OfferWithRequirements | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    if (!id) return;
    offerRepository.getWithRequirements(id).then((o) => {
      setOffer(o);
      if (o) {
        setForm({
          title: o.title,
          description: o.description,
          contractType: o.contractType,
          salary: salaryFormFromValue(o.salary),
          productType: o.productType,
          // `locationCountry` es el NOMBRE guardado en la fila; sirve como
          // etiqueta hasta que el usuario reabra el selector, que lo
          // resolvera contra el catalogo vivo.
          location: locationValueFromPersisted(o, o.locationCountry),
          minYearsExperience: o.minYearsExperience,
          technicianType: o.technicianType,
          requiresCertification: o.requiresCertification,
          licenseAuthority: o.licenseAuthority,
          licenseCode: o.licenseCode,
          acceptedAuthorities: o.acceptedAuthorities,
          acceptedLicenseCode: o.acceptedLicenseCode,
          requiresAllAircraft: o.requiresAllAircraft,
          requiredHabilitations: o.requiredHabilitations.map((h) => ({
            aircraftTypeRatingId: h.aircraftTypeRatingId,
            notes: h.notes,
          })),
          offerKind: o.offerKind,
          requiredEngineId: o.requiredEngineId,
          onlyUnlicensed: o.onlyUnlicensed,
          status: o.status,
        });
      }
      setLoading(false);
    });
  }, [id]);

  // Fase 6 tanda C: el eje Part-66 lo abre o lo cierra el INTERRUPTOR de
  // certificación, no el tipo de perfil. offerRepository impone la misma
  // regla al escribir — esconder una sección no es una garantía.
  //
  // `?? true` mientras el formulario carga: es el valor por defecto de la
  // columna y el lado seguro: enseña las secciones un instante de más antes
  // que esconder requisitos que la oferta sí tiene.
  const requiresCertification = form?.requiresCertification ?? true;

  /**
   * Editando una oferta que YA existe, toda transición que descarte algo
   * guardado —licencia, aeronaves, motor— pregunta antes. Lo que se descarta
   * lo calcula `droppedByTransition` comparando antes y después, así que no
   * hay que acordarse de qué limpia cada cambio: lo dice offerFormRules.
   *
   * Si la empresa cancela, el formulario NO se mueve — no se toca `form`
   * hasta después del await. Y sólo se pregunta cuando hay algo que perder.
   *
   * `why` es la frase que explica por qué ese cambio no puede conservarlo, y
   * `keeps` lo que se queda cuando conviene decirlo (apagar la certificación
   * conserva las aeronaves).
   */
  async function applyTransition(
    next: FormState,
    dialog: { title: string; why: string; keeps?: string },
  ) {
    if (!form || next === form) return;
    const dropped = describeDropped(droppedByTransition(form, next));
    const dropsEngine = Boolean(form.requiredEngineId && !next.requiredEngineId);
    const lost = [dropped, dropsEngine ? 'the engine requirement' : null].filter(Boolean).join(' and ');
    if (lost) {
      const confirmed = await confirmAction({
        title: dialog.title,
        message: `${dialog.why} This clears ${lost}.${dialog.keeps ? `\n\n${dialog.keeps}` : ''}`,
        confirmLabel: 'Continue and clear',
        destructive: true,
      });
      if (!confirmed) return;
    }
    setForm(next);
    setErrors((e) => ({ ...e, authority: undefined, license: undefined, engine: undefined, acceptedLicense: undefined }));
  }

  function onToggleCertification(next: boolean) {
    if (!form) return;
    // Encenderla nunca pregunta: no destruye nada (desmarca "sólo sin
    // licencia", que no es un requisito que se pierda sino una contradicción
    // que se evita).
    void applyTransition(setRequiresCertification(form, next), {
      title: `Drop the ${form.licenseCode ?? ''} licence requirement?`,
      why: 'An offer that does not need certified work cannot require a licence.',
      // Fase 6 tanda E: las aeronaves se quedan.
      keeps: 'The aircraft stay: the role is still for that work, and it opens up to technicians who have done it without holding the licence.',
    });
  }

  // Sesión 4 (091): cambiar el tipo puede cambiar la clase, y lo que se pierde
  // entonces no es por la licencia sino por la clase. El diálogo lo dice.
  function onSelectTechnicianType(next: TechnicianTypeCode) {
    if (!form) return;
    const nextKind = offerKindForTechnicianType(next);
    const why =
      nextKind === form.offerKind
        ? 'The current licence is not one that trade can require.'
        : nextKind === 'engine'
          ? 'An Engine Technician offer is an engine offer: it names one engine and no aircraft. A licence is optional there, and only a Part-66 B1 or an FAA P or A&P.'
          : `An offer for ${technicianTypeLabel(next).toLowerCase()} work is an aircraft offer and does not name an engine.`;
    void applyTransition(selectTechnicianType(form, next), {
      title: `Switch this offer to ${technicianTypeLabel(next).toLowerCase()}?`,
      why,
    });
  }

  function onSelectAuthority(next: AuthorityCode) {
    if (!form) return;
    void applyTransition(selectAuthority(form, next), {
      title: `Switch the authority to ${authorityLabel(next)}?`,
      why: next === 'FAA'
        ? 'The licence has to be one the FAA issues, and the aircraft were added under the previous licence. On an FAA offer, an aircraft counts through a type rating or declared experience, signed off or not.'
        : `The licence has to be one ${authorityLabel(next)} issues.`,
    });
  }

  function onSelectLicense(next: AuthorityLicenseCode) {
    if (!form) return;
    void applyTransition(selectLicense(form, next), {
      title: `Switch the licence to ${next}?`,
      why: `The aircraft on this offer were added under ${form.licenseCode ?? 'the previous licence'}; you will need to add them again under the new one.`,
    });
  }

  function onSelectProductType(productType: OfferProductType) {
    if (!form) return;
    void applyTransition(selectProductType(form, productType), {
      title: `Switch this offer to ${getOfferProductTypeLabel(productType).toLowerCase()}?`,
      why: `Type ratings and some licences cannot apply to ${getOfferProductTypeLabel(productType).toLowerCase()}.`,
    });
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => prev ? { ...prev, [key]: value } : prev);
    if (key === 'salary') setErrors((e) => ({ ...e, salary: undefined }));
    if (key === 'title') setErrors((e) => ({ ...e, title: undefined }));
    if (key === 'description') setErrors((e) => ({ ...e, description: undefined }));
    if (key === 'location') {
      setErrors((e) => ({ ...e, location: undefined }));
    }
    if (key === 'requiredEngineId') setErrors((e) => ({ ...e, engine: undefined }));
  }

  async function handleSave(overrideStatus?: OfferStatus) {
    if (!form || !id) return;
    const errs = computeErrors(form);
    if (Object.values(errs).some(Boolean)) { setErrors(errs); return; }

    const status = overrideStatus ?? form.status;

    setSaving(true);
    try {
      await offerRepository.update(id, {
        title: form.title.trim(),
        description: form.description.trim(),
        contractType: form.contractType,
        salary: salaryFromForm(form.salary),
        // Va en el update(), no en replaceRequirements(): el repositorio tiene
        // que retirar las filas de requisitos ANTES de mover esta columna
        // (orh_matches_offer lo impone), y hace justo eso cuando ve que
        // cambia.
        productType: form.productType,
        technicianType: form.technicianType,
        licenseAuthority: form.licenseAuthority,
        licenseCode: form.licenseCode,
        acceptedAuthorities: form.acceptedAuthorities,
        acceptedLicenseCode: form.acceptedLicenseCode,
        requiresAllAircraft: form.requiresAllAircraft,
        // Paso 5b: el motor. La RPC retira las aeronaves en la misma
        // transacción al pasar a motor (los triggers de la 076 lo exigen),
        // igual que con el producto. Sesión 4 (091): la clase no se manda; el
        // repositorio la deriva de technicianType, arriba.
        requiredEngineId: form.requiredEngineId,
        onlyUnlicensed: form.onlyUnlicensed,
        // Igual que productType: va en el update() y no en
        // replaceRequirements(), y el repositorio limpia los requisitos
        // Part-66 si ve que se apaga — la invariante lo exige aunque aquí no
        // haya ninguna FK que fuerce el orden.
        requiresCertification: form.requiresCertification,
        locationCountryCode: form.location.country?.code,
        locationCountry: form.location.country?.name,
        locationCityName: form.location.city?.name,
        locationCityLat: form.location.city?.kind === 'directory' ? form.location.city.latitude : undefined,
        locationCityLng: form.location.city?.kind === 'directory' ? form.location.city.longitude : undefined,
        locationCityGeonameId: form.location.city?.kind === 'directory' ? form.location.city.geonameId : undefined,
        minYearsExperience: form.minYearsExperience,
        status,
        visible: status === 'published',
      }, form.requiredHabilitations);
      goBack();
    } catch (e: any) {
      notify('Error', e?.message ?? 'Could not save offer.');
    } finally {
      setSaving(false);
    }
  }

  if (loading || !form) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingScreen color={colors.blue} role="company" />
      </>
    );
  }

  if (!offer) {
    return (
      <CompanyScreen>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.notFound}>
          <EmptyPanel title="Offer not found" subtitle="This offer is no longer available." />
        </View>
      </CompanyScreen>
    );
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
          eyebrow="Offer editor"
          title="Edit Offer"
          subtitle={offer.title}
          onBack={goBack}
        />

        {/* Mismo orden que la pantalla de creación: 1) tipo de perfil, que
            desde la sesión 4 decide también si es de motor, 2) ¿certificar?,
            3) avión o helicóptero, 4) licencia o motor, 5) aeronaves. */}
        <ChoiceSection title="Profile type" helper={technicianTypeHelper(form)}>
          {TECHNICIAN_TYPES.filter((t) => t.isActive).map((t) => (
            <CompanyChip
              key={t.code}
              label={t.label}
              selected={form.technicianType === t.code}
              onPress={() => onSelectTechnicianType(t.code as TechnicianTypeCode)}
            />
          ))}
        </ChoiceSection>

        {/* La pregunta sólo existe para los oficios que tienen licencia — ver
            la pantalla de creación. */}
        {showsCertificationQuestion(form) && (
          <ChoiceSection
            title={certificationQuestionCopy(form).title}
            helper={certificationQuestionCopy(form).helper}
          >
            <CompanyChip label={certificationQuestionCopy(form).yes} selected={requiresCertification} onPress={() => onToggleCertification(true)} />
            <CompanyChip label={certificationQuestionCopy(form).no} selected={!requiresCertification} onPress={() => onToggleCertification(false)} />
          </ChoiceSection>
        )}

        {/* Paso 5b: sólo cuando la oferta NO exige licencia, en aeronave y en
            motor. Volver a "Yes, licence required" la desmarca. */}
        {showsOnlyUnlicensed(form) && (
          <OnlyUnlicensedSection checked={form.onlyUnlicensed} onChange={(next) => setField('onlyUnlicensed', next)} />
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
                onPress={() => onSelectProductType(p.code)}
              />
            ))}
          </View>
        </FormSection>

        <FormSection title="Offer details" subtitle="Update the role information technicians will see." icon={FileText}>
          <FormField label="Title" error={errors.title}>
            <TextInput
              style={[styles.input, errors.title && styles.inputError]}
              placeholderTextColor={companyUi.textMuted}
              value={form.title}
              onChangeText={(v) => setField('title', v)}
            />
          </FormField>

          <FormField label="Description" error={errors.description}>
            <TextInput
              style={[styles.input, styles.textarea, errors.description && styles.inputError]}
              placeholderTextColor={companyUi.textMuted}
              value={form.description}
              onChangeText={(v) => setField('description', v)}
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
                  onPress={() => setField('contractType', ct.code as ContractTypeCode)}
                />
              ))}
            </View>
          </FormField>

          <FormField label="Minimum years of experience">
            <View style={styles.stepper}>
              <TouchableOpacity
                style={styles.stepButton}
                onPress={() => setField('minYearsExperience', Math.max(0, form.minYearsExperience - 1))}
                activeOpacity={0.75}
              >
                <Minus color={companyUi.textSoft} size={17} strokeWidth={2} />
              </TouchableOpacity>
              <Text style={styles.stepValue}>{form.minYearsExperience} yrs</Text>
              <TouchableOpacity
                style={styles.stepButton}
                onPress={() => setField('minYearsExperience', Math.min(30, form.minYearsExperience + 1))}
                activeOpacity={0.75}
              >
                <Plus color={companyUi.textSoft} size={17} strokeWidth={2} />
              </TouchableOpacity>
            </View>
          </FormField>
        </FormSection>

        <OfferSalarySection value={form.salary} onChange={(value) => setField('salary', value)} error={errors.salary} />

        {/* Fase 7 F2c: el país es lo que puntúa; la ciudad sólo sitúa. */}
        <FormSection title="Location" subtitle="The country is what candidates are matched on. The city only helps them place the role." icon={MapPin}>
          <CountryCityPicker value={form.location} onChange={(value) => setField('location', value)} />
          {errors.location ? <Text style={styles.fieldError}>{errors.location}</Text> : null}
        </FormSection>

        {showsLicenseSection(form) && (
          <RequiredLicensesSection
            form={form}
            onChangeAuthority={onSelectAuthority}
            onChangeLicense={onSelectLicense}
            onToggleAcceptedAuthority={(authority) => {
              setForm((prev) => (prev ? toggleAcceptedAuthority(prev, authority) : prev));
              setErrors((e) => ({ ...e, acceptedLicense: undefined }));
            }}
            onSelectAcceptedLicenseCode={(code) => {
              setForm((prev) => (prev ? selectAcceptedLicenseCode(prev, code) : prev));
              setErrors((e) => ({ ...e, acceptedLicense: undefined }));
            }}
            authorityError={errors.authority}
            licenseError={errors.license}
            acceptedError={errors.acceptedLicense}
          />
        )}

        {form.offerKind === 'engine' && (
          <OfferEngineSection
            value={form.requiredEngineId}
            onChange={(engineId) => setField('requiredEngineId', engineId)}
            error={errors.engine}
          />
        )}

        {/* Fase 6 tanda E: las AERONAVES se piden certifique o no. Paso 5b:
            salvo en una oferta de motor. Sesión 2: bajo la FAA, como
            experiencia. */}
        {showsAircraftEditor(form) && (
          <TypeRatingRequirementsEditor
            value={form.requiredHabilitations}
            onChange={(next) => setField('requiredHabilitations', next)}
            productType={form.productType}
            licenseCode={form.licenseCode}
            asExperience={offerAircraftAreExperience(form)}
            copy={aircraftRequirementsCopy(form)}
            requiresAll={form.requiresAllAircraft}
            onChangeRequiresAll={(next) => setField('requiresAllAircraft', next)}
          />
        )}

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.primaryButton, saving && styles.disabled]}
            onPress={() => handleSave()}
            disabled={saving}
            activeOpacity={0.75}
          >
            {saving ? <ActivityIndicator color={colors.white} size="small" /> : <Save color={colors.white} size={16} strokeWidth={2} />}
            <Text style={styles.primaryButtonText}>Save changes</Text>
          </TouchableOpacity>
          {form.status === 'draft' ? (
            <TouchableOpacity
              style={[styles.publishButton, saving && styles.disabled]}
              onPress={() => handleSave('published')}
              disabled={saving}
              activeOpacity={0.75}
            >
              <CheckCircle color={colors.white} size={16} strokeWidth={2} />
              <Text style={styles.primaryButtonText}>Save and publish</Text>
            </TouchableOpacity>
          ) : null}
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
  notFound: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
  },
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
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  primaryButton: {
    flex: 1,
    minWidth: 150,
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: companyUi.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  publishButton: {
    flex: 1,
    minWidth: 150,
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: companyUi.green,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  disabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.white,
  },
});
