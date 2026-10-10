// El asistente de oferta (rediseño, fase 4; maquetas W-Post, W-Post2…4,
// W-PostReview, W-PostDone y W-D-Post; D3 y respuesta 14 de la revisión).
//
// Lo usan /company/offers/new y /company/offers/edit. Los campos, las reglas y
// las validaciones son los del formulario de una página que sustituye:
//   - las transiciones (qué se limpia al cambiar algo) son las de
//     offerFormRules, a través de applyOfferRequirementChange; editar pone
//     delante su diálogo de siempre (`confirmChange`), crear las aplica sin
//     aviso;
//   - "Continue" valida sólo el paso en el que está (offerWizardStepErrors), y
//     la revisión vuelve a validarlo todo antes de guardar;
//   - guardar lo hace la pantalla (`onSubmit`), con la misma llamada al
//     repositorio que antes.
//
// Móvil: cabecera "Step N of M", un paso por pantalla y el botón abajo.
// Escritorio (≥ WIDE_BREAKPOINT): los pasos en una columna a la izquierda; se
// puede volver a uno ya hecho, y hacia delante sólo con "Continue".
import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { useRouter } from 'expo-router';
import { Check, Minus, Plus, Search } from 'lucide-react-native';
import { Chip, StepHeader, Text, TextInput } from '../ui';
import { colors } from '../../theme';
import { TOUCH_TARGET } from '../../theme/ui';
import { CompanyScreen } from './CompanyUI';
import {
  ButtonRow,
  CARD_BORDER,
  OfferLinkCard,
  OfferTileSquare,
  PillButton,
  SegmentedControl,
  StickyBar,
  TextLink,
  useIsWide,
} from './CompanyPage';
import { RequiredLicensesSection } from './RequiredLicensesSection';
import { OfferEngineSection, OnlyUnlicensedSection } from './OfferEngineSections';
import { OfferSalarySection } from './OfferSalarySection';
import { TypeRatingRequirementsEditor, useAircraftRatingLabelIndex } from './TypeRatingRequirementsEditor';
import { WIZARD_OPTION_BORDER, WizardChipRow, WizardError, WizardHeading, WizardLabel, WizardSubheading, wizardInputStyles } from './OfferWizardParts';
import { CountryCityPicker } from '../CountryCityPicker';
import { TECHNICIAN_TYPES } from '../../constants/technicianTypes';
import { CONTRACT_TYPES } from '../../constants/contractTypes';
import { OFFER_PRODUCT_TYPES } from '../../constants/offerProductTypes';
import { getAircraftTypeRatingLabel } from '../../constants/aircraftTypeRatings';
import { getEngineLabel } from '../../constants/engines';
import { useEnginesCatalog } from '../../state/useEnginesCatalog';
import { TechnicianTypeCode } from '../../types/catalog';
import { OfferStatus } from '../../types/enums';
import { Offer } from '../../types/offer';
import { offerAircraftAreExperience, offerKindForTechnicianType } from '../../utils/offerShape';
import {
  aircraftRequirementsCopy,
  certificationQuestionCopy,
  selectAcceptedLicenseCode,
  showsCertificationQuestion,
  showsLicenseSection,
  showsOnlyUnlicensed,
  technicianTypeHelper,
  toggleAcceptedAuthority,
} from '../../utils/offerFormRules';
import {
  OfferRequirementChange,
  OfferWizardErrorKey,
  OfferWizardErrors,
  OfferWizardForm,
  OfferWizardPosition,
  REQUIREMENT_ERROR_KEYS,
  applyOfferRequirementChange,
  canJumpToOfferWizardStep,
  firstOfferWizardStepWithErrors,
  hasOfferWizardErrors,
  nextOfferWizardPosition,
  offerReviewBlocks,
  offerWizardDoneCopy,
  offerWizardErrors,
  offerWizardProgress,
  offerWizardStepErrors,
  offerWizardStepLabel,
  offerWizardSteps,
  previousOfferWizardPosition,
} from '../../utils/offerWizard';
import { offerMetaLine } from '../../utils/companyHome';
import { offerStatusLook } from '../../utils/companyStatus';

/** Fondo de la página de escritorio (maqueta W-D-Post). */
const DESKTOP_PAGE = '#F7F9FB';
const MIN_YEARS = 0;
const MAX_YEARS = 30;

export interface OfferWizardProps {
  mode: 'new' | 'edit';
  initialForm: OfferWizardForm;
  /**
   * Editar: el estado guardado decide los botones de la revisión, como antes
   * ("Save changes", y en un borrador también publicar).
   */
  savedStatus?: OfferStatus;
  /**
   * Editar pregunta antes de un cambio que descarta algo guardado. Devuelve
   * false si la empresa cancela: el formulario no se mueve. Crear no lo pasa.
   */
  confirmChange?: (prev: OfferWizardForm, next: OfferWizardForm, change: OfferRequirementChange) => Promise<boolean>;
  /**
   * Guarda con la lógica de la pantalla. `status` undefined = conservar el
   * guardado. Devuelve la oferta guardada para la pantalla final, o null si
   * no se guardó (la pantalla ya avisó) o si la pantalla sigue por su cuenta.
   */
  onSubmit: (form: OfferWizardForm, status: OfferStatus | undefined) => Promise<Offer | null>;
  /** Salir del asistente desde el primer paso, como el "atrás" de antes: sin aviso. */
  onExit: () => void;
}

export function OfferWizard({ mode, initialForm, savedStatus, confirmChange, onSubmit, onExit }: OfferWizardProps) {
  const router = useRouter();
  const wide = useIsWide();
  const [form, setForm] = useState<OfferWizardForm>(initialForm);
  const [position, setPosition] = useState<OfferWizardPosition>('who');
  const [errors, setErrors] = useState<OfferWizardErrors>({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<Offer | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const steps = offerWizardSteps(form);
  const progress = offerWizardProgress(form, position);
  const isFirst = position === steps[0];
  const ratingLabels = useAircraftRatingLabelIndex(form.requiredHabilitations.map((h) => h.aircraftTypeRatingId));
  const { engineIndex } = useEnginesCatalog();

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [position, done]);

  // ── Cambios ─────────────────────────────────────────────────────────────

  function set<K extends keyof OfferWizardForm>(key: K, value: OfferWizardForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key === 'salary' || key === 'title' || key === 'description' || key === 'location') {
      setErrors((e) => ({ ...e, [key]: undefined }));
    }
  }

  // Tocar un requisito borra sus avisos: el de "falta la licencia" no debe
  // quedarse pintado tras elegirla. Se vuelven a calcular al continuar.
  function clearRequirementErrors() {
    setErrors((e) => {
      const next = { ...e };
      REQUIREMENT_ERROR_KEYS.forEach((key) => { next[key] = undefined; });
      return next;
    });
  }

  function updateRequirement(transition: (prev: OfferWizardForm) => OfferWizardForm) {
    setForm((prev) => transition(prev));
    clearRequirementErrors();
  }

  // Los cambios que pueden descartar algo pasan por aquí: la transición de
  // offerFormRules y, editando, la pregunta de siempre antes de aplicarla.
  async function changeRequirement(change: OfferRequirementChange) {
    const next = applyOfferRequirementChange(form, change);
    if (next === form) return;
    if (confirmChange && !(await confirmChange(form, next, change))) return;
    setForm(next);
    clearRequirementErrors();
  }

  // ── Navegación ──────────────────────────────────────────────────────────

  function goTo(next: OfferWizardPosition) {
    setPosition(next);
  }

  function onContinue() {
    if (position === 'review') return;
    const stepErrors = offerWizardStepErrors(form, position);
    setErrors(stepErrors);
    if (hasOfferWizardErrors(stepErrors)) {
      scrollToFirstError(stepErrors);
      return;
    }
    goTo(nextOfferWizardPosition(form, position));
  }

  // Móvil: el error puede quedar por debajo de la pantalla (el país, al final
  // del paso 4) y el botón parecería no hacer nada. Se baja hasta el primer
  // campo con error. Las posiciones las anotan los bloques del paso con
  // `errorAnchor`; sólo valen en móvil, donde esos bloques son hijos directos
  // del contenido desplazable.
  const errorAnchors = useRef<Partial<Record<OfferWizardErrorKey, number>>>({});
  function errorAnchor(...keys: OfferWizardErrorKey[]) {
    return (event: LayoutChangeEvent) => {
      const y = event.nativeEvent.layout.y;
      keys.forEach((key) => { errorAnchors.current[key] = y; });
    };
  }
  function scrollToFirstError(stepErrors: OfferWizardErrors) {
    if (wide) return;
    const ys = (Object.keys(stepErrors) as OfferWizardErrorKey[])
      .filter((key) => stepErrors[key])
      .map((key) => errorAnchors.current[key])
      .filter((y): y is number => y != null);
    if (ys.length > 0) scrollRef.current?.scrollTo({ y: Math.max(0, Math.min(...ys) - 12), animated: true });
  }

  function onBack() {
    const previous = previousOfferWizardPosition(form, position);
    if (!previous) {
      onExit();
      return;
    }
    setErrors({});
    goTo(previous);
  }

  // Android: el botón "atrás" del sistema hace lo mismo que la flecha de la
  // cabecera mientras haya un paso anterior. En el primero sale, como antes.
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  useEffect(() => {
    if (Platform.OS !== 'android' || done || isFirst) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBackRef.current();
      return true;
    });
    return () => sub.remove();
  }, [done, isFirst]);

  async function submit(status: OfferStatus | undefined) {
    if (saving) return;
    // La revisión vuelve a comprobarlo todo. Si algo falla, al primer paso que
    // lo tiene, con sus errores marcados.
    const failing = firstOfferWizardStepWithErrors(form);
    if (failing) {
      setErrors(offerWizardErrors(form));
      goTo(failing);
      return;
    }
    setSaving(true);
    try {
      const saved = await onSubmit(form, status);
      if (saved && mode === 'new') setDone(saved);
    } finally {
      setSaving(false);
    }
  }

  // ── Pantalla final ──────────────────────────────────────────────────────

  const viewOffer = (offer: Offer) => router.replace(`/company/offers/${offer.id}` as never);
  const findTechnicians = (offer: Offer) => router.dismissTo(`/company/search?offerId=${offer.id}` as never);
  const backHome = () => router.dismissTo('/company' as never);

  // ── Pasos ───────────────────────────────────────────────────────────────

  function renderWho() {
    return (
      <>
        <WizardHeading title="Who are you hiring?" helper={technicianTypeHelper(form)} large />
        <View style={styles.typeGrid} accessibilityRole="radiogroup" accessibilityLabel="Profile type">
          {TECHNICIAN_TYPES.filter((t) => t.isActive).map((t) => (
            <TypeCard
              key={t.code}
              code={t.code as TechnicianTypeCode}
              label={t.label}
              selected={form.technicianType === t.code}
              wide={wide}
              onPress={() => void changeRequirement({ kind: 'technicianType', value: t.code as TechnicianTypeCode })}
            />
          ))}
        </View>
        <View style={styles.block}>
          <WizardSubheading
            title="Airplanes or helicopters?"
            helper={
              form.offerKind === 'engine'
                ? 'The kind of aircraft this engine work is for.'
                : 'An offer covers one or the other, never both. This sets which licence categories and type ratings you can require next.'
            }
          />
          <SegmentedControl
            options={OFFER_PRODUCT_TYPES.map((p) => ({ value: p.code, label: p.label }))}
            value={form.productType}
            onChange={(value) => void changeRequirement({ kind: 'productType', value })}
            accessibilityLabel="Airplanes or helicopters"
            fill={!wide}
          />
        </View>
        {/* Los oficios sin licencia no tienen paso 2: "sólo sin licencia" va
            aquí (D3: "plus 'only unlicensed' if it applies"). */}
        {!showsCertificationQuestion(form) && showsOnlyUnlicensed(form) ? (
          <OnlyUnlicensedSection checked={form.onlyUnlicensed} onChange={(next) => set('onlyUnlicensed', next)} />
        ) : null}
      </>
    );
  }

  function renderLicence() {
    const copy = certificationQuestionCopy(form);
    return (
      <>
        <View style={styles.block}>
          <WizardHeading title={copy.title} large={wide} />
          <WizardChipRow>
            <Chip label={copy.yes} selected={form.requiresCertification} onPress={() => void changeRequirement({ kind: 'certification', value: true })} />
            <Chip label={copy.no} selected={!form.requiresCertification} onPress={() => void changeRequirement({ kind: 'certification', value: false })} />
          </WizardChipRow>
          <Text style={styles.helper}>{copy.helper}</Text>
        </View>
        {showsLicenseSection(form) ? (
          <View onLayout={errorAnchor('authority', 'license', 'acceptedLicense')}>
            <RequiredLicensesSection
              form={form}
              onChangeAuthority={(value) => void changeRequirement({ kind: 'authority', value })}
              onChangeLicense={(value) => void changeRequirement({ kind: 'license', value })}
              onToggleAcceptedAuthority={(authority) => updateRequirement((prev) => toggleAcceptedAuthority(prev, authority))}
              onSelectAcceptedLicenseCode={(code) => updateRequirement((prev) => selectAcceptedLicenseCode(prev, code))}
              authorityError={errors.authority}
              licenseError={errors.license}
              acceptedError={errors.acceptedLicense}
            />
          </View>
        ) : null}
        {/* Paso 5b: sólo cuando la oferta NO exige licencia — en aeronave y en
            motor. Volver a "Yes, licence required" la desmarca. */}
        {showsOnlyUnlicensed(form) ? (
          <OnlyUnlicensedSection checked={form.onlyUnlicensed} onChange={(next) => set('onlyUnlicensed', next)} />
        ) : null}
      </>
    );
  }

  function renderRequirements() {
    if (form.offerKind === 'engine') {
      return (
        <OfferEngineSection
          value={form.requiredEngineId}
          onChange={(engineId) => changeRequirement({ kind: 'engine', value: engineId })}
          notes={form.requiredEngineNotes}
          onChangeNotes={(notes) => set('requiredEngineNotes', notes)}
          error={errors.engine}
          large={wide}
          fillAvailableSpace={!wide}
        />
      );
    }
    // Fase 6 tanda E: las AERONAVES se piden certifique o no. Sesión 2: bajo
    // la FAA, que no emite type ratings, se piden como experiencia.
    return (
      <TypeRatingRequirementsEditor
        value={form.requiredHabilitations}
        onChange={(next) => set('requiredHabilitations', next)}
        productType={form.productType}
        licenseCode={form.licenseCode}
        asExperience={offerAircraftAreExperience(form)}
        copy={aircraftRequirementsCopy(form)}
        requiresAll={form.requiresAllAircraft}
        onChangeRequiresAll={(next) => set('requiresAllAircraft', next)}
        large={wide}
      />
    );
  }

  function renderDetails() {
    const years = form.minYearsExperience;
    return (
      <>
        <WizardHeading
          title="Offer details"
          helper={mode === 'edit' ? 'Update the role information technicians will see.' : 'Describe the work clearly enough for match scoring.'}
          large={wide}
        />
        <View style={wizardInputStyles.field} onLayout={errorAnchor('title')}>
          <WizardLabel>Title</WizardLabel>
          <TextInput
            accessibilityLabel="Title"
            style={[wizardInputStyles.input, errors.title && wizardInputStyles.inputError]}
            placeholder="e.g. B1.1 Line Maintenance Technician"
            placeholderTextColor={colors.placeholder}
            value={form.title}
            onChangeText={(v) => set('title', v)}
          />
          <WizardError>{errors.title}</WizardError>
        </View>
        <View style={wizardInputStyles.field} onLayout={errorAnchor('description')}>
          <WizardLabel>Description</WizardLabel>
          <TextInput
            accessibilityLabel="Description"
            style={[wizardInputStyles.input, wizardInputStyles.textarea, errors.description && wizardInputStyles.inputError]}
            placeholder="Describe the role, responsibilities and context..."
            placeholderTextColor={colors.placeholder}
            value={form.description}
            onChangeText={(v) => set('description', v)}
            multiline
            numberOfLines={4}
          />
          <WizardError>{errors.description}</WizardError>
        </View>
        <PairRow wide={wide}>
          <View style={[wide && styles.pairItem, styles.block]}>
            <WizardLabel>Contract type</WizardLabel>
            <SegmentedControl
              options={CONTRACT_TYPES.map((c) => ({ value: c.code, label: c.label }))}
              value={form.contractType}
              onChange={(value) => set('contractType', value)}
              accessibilityLabel="Contract type"
            />
          </View>
          <View style={[wide && styles.pairItem, wide ? styles.block : styles.yearsRow]}>
            <View style={styles.yearsLabel}>
              <WizardLabel>Minimum years of experience</WizardLabel>
            </View>
            <View style={styles.stepper}>
              <Pressable
                onPress={() => set('minYearsExperience', Math.max(MIN_YEARS, years - 1))}
                style={({ pressed, hovered }: any) => [styles.stepButton, (pressed || hovered) && styles.stepButtonPressed]}
                accessibilityRole="button"
                accessibilityLabel="Fewer years"
              >
                <Minus color={colors.text} size={18} strokeWidth={2.4} />
              </Pressable>
              <Text style={styles.stepValue} accessibilityLabel={`${years} years minimum`}>{years}</Text>
              <Pressable
                onPress={() => set('minYearsExperience', Math.min(MAX_YEARS, years + 1))}
                style={({ pressed, hovered }: any) => [styles.stepButton, (pressed || hovered) && styles.stepButtonPressed]}
                accessibilityRole="button"
                accessibilityLabel="More years"
              >
                <Plus color={colors.text} size={18} strokeWidth={2.4} />
              </Pressable>
            </View>
          </View>
        </PairRow>
        <PairRow wide={wide}>
          <View style={wide ? styles.pairItem : undefined} onLayout={errorAnchor('salary')}>
            <OfferSalarySection value={form.salary} onChange={(value) => set('salary', value)} error={errors.salary} />
          </View>
          {/* Fase 7 F2c: el país es lo que puntúa; la ciudad sólo sitúa. */}
          <View style={[wide && styles.pairItem, styles.block]} onLayout={errorAnchor('location')}>
            <WizardSubheading title="Location" helper="The country is what candidates are matched on. The city only helps them place the role." />
            <CountryCityPicker value={form.location} onChange={(value) => set('location', value)} />
            <WizardError>{errors.location}</WizardError>
          </View>
        </PairRow>
      </>
    );
  }

  function renderReview() {
    const blocks = offerReviewBlocks(form, {
      aircraft: (id) => getAircraftTypeRatingLabel(id, ratingLabels),
      engine: (id) => getEngineLabel(id, engineIndex),
    });
    const keepsDraft = mode === 'new' || savedStatus === 'draft';
    return (
      <>
        <WizardHeading
          title="Review your offer"
          helper={keepsDraft ? 'Publish it now or keep it as a draft.' : 'Check everything, then save your changes.'}
          large={wide}
        />
        <View style={wide ? styles.reviewGrid : styles.reviewList}>
          {blocks.map((block) => (
            <View key={block.step} style={[styles.reviewBlock, wide && styles.reviewBlockWide]}>
              <View style={styles.reviewCopy}>
                <Text style={styles.reviewTitle}>{block.title}</Text>
                {block.lines.map((line, i) => (
                  <Text key={i} style={styles.reviewLine} numberOfLines={3}>{line}</Text>
                ))}
              </View>
              <TextLink label="Edit" onPress={() => goTo(block.step)} accessibilityLabel={`Edit ${block.title}`} />
            </View>
          ))}
        </View>
      </>
    );
  }

  function renderPosition() {
    switch (position) {
      case 'who': return renderWho();
      case 'licence': return renderLicence();
      case 'requirements': return renderRequirements();
      case 'details': return renderDetails();
      case 'review': return renderReview();
    }
  }

  // ── Botones ─────────────────────────────────────────────────────────────

  // Revisión: crear, "Save draft" y "Publish". Editar, lo de antes: "Save
  // changes" (conserva el estado) y, en un borrador, también publicar — que
  // aquí se llaman "Save draft" y "Publish".
  function reviewButtons(size: 'md' | 'lg') {
    const grow = size === 'lg';
    if (mode === 'edit' && savedStatus !== 'draft') {
      return <PillButton label="Save changes" size={size} loading={saving} onPress={() => void submit(undefined)} grow={grow ? 1 : undefined} />;
    }
    const draftStatus: OfferStatus | undefined = mode === 'new' ? 'draft' : undefined;
    return (
      <>
        <PillButton label="Save draft" variant="outline" size={size} disabled={saving} onPress={() => void submit(draftStatus)} grow={grow ? 1 : undefined} />
        <PillButton label="Publish" size={size} loading={saving} onPress={() => void submit('published')} grow={grow ? 1.4 : undefined} />
      </>
    );
  }

  const isLastStep = position === steps[steps.length - 1];
  const continueLabel = isLastStep ? 'Review offer' : 'Continue';

  // ── Pantalla final de una oferta nueva ──────────────────────────────────

  if (done) {
    const copy = offerWizardDoneCopy(done.status);
    const published = done.status === 'published';
    const card = (
      <OfferLinkCard
        offer={done}
        caption={offerStatusLook(done.status).label}
        meta={offerMetaLine(done)}
        onPress={() => viewOffer(done)}
        trailingLabel={wide ? 'View offer' : undefined}
      />
    );
    const intro = (
      <View style={styles.doneIntro}>
        <View style={[styles.doneCircle, wide && styles.doneCircleWide]}>
          <Check color={colors.success} size={wide ? 40 : 44} strokeWidth={2.6} />
        </View>
        <Text style={styles.doneTitle} accessibilityRole="header">{copy.title}</Text>
        <Text style={styles.doneText}>{copy.text}</Text>
      </View>
    );
    if (wide) {
      return (
        <DesktopFrame nav={<DesktopSteps mode={mode} form={form} position="review" done onJump={goTo} jumpDisabled />}>
          <View style={styles.doneWide}>
            {intro}
            <View style={styles.doneCard}>{card}</View>
            <View style={styles.doneWideActions}>
              {published ? (
                <>
                  <PillButton label="Back to home" variant="outline" size="md" onPress={backHome} />
                  <PillButton label="Find technicians" icon={Search} size="md" onPress={() => findTechnicians(done)} />
                </>
              ) : (
                <PillButton label="Back to home" size="md" onPress={backHome} />
              )}
            </View>
          </View>
        </DesktopFrame>
      );
    }
    return (
      <CompanyScreen>
        <ScrollView ref={scrollRef} style={styles.flex} contentContainerStyle={styles.doneBody}>
          {intro}
          {card}
        </ScrollView>
        <View style={styles.doneActions}>
          {published ? <PillButton label="Find technicians for it" icon={Search} onPress={() => findTechnicians(done)} /> : null}
          <PillButton label="Back to home" variant="outline" onPress={backHome} />
        </View>
      </CompanyScreen>
    );
  }

  // ── Escritorio ──────────────────────────────────────────────────────────

  if (wide) {
    return (
      <DesktopFrame
        scrollRef={scrollRef}
        nav={(
          <DesktopSteps
            mode={mode}
            form={form}
            position={position}
            onJump={goTo}
            jumpDisabled={saving}
          />
        )}
      >
        <View style={styles.mainContent}>{renderPosition()}</View>
        <View style={styles.desktopActions}>
          <PillButton label={isFirst ? 'Cancel' : 'Back'} variant="outline" size="md" onPress={onBack} disabled={saving} />
          <View style={styles.desktopActionsRight}>
            {position === 'review'
              ? reviewButtons('md')
              : <PillButton label={continueLabel} size="md" onPress={onContinue} />}
          </View>
        </View>
      </DesktopFrame>
    );
  }

  // ── Móvil ───────────────────────────────────────────────────────────────

  return (
    <CompanyScreen>
      <StepHeader
        step={progress.step}
        total={progress.total}
        label={progress.label}
        onBack={onBack}
        backIcon={isFirst ? 'close' : 'back'}
        title={mode === 'edit' ? 'Edit offer' : undefined}
      />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={[styles.mobileBody, position === 'requirements' && form.offerKind === 'engine' && styles.mobileEngineBody]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {renderPosition()}
        </ScrollView>
        <StickyBar>
          {position === 'review'
            ? <ButtonRow>{reviewButtons('lg')}</ButtonRow>
            : <PillButton label={continueLabel} onPress={onContinue} />}
        </StickyBar>
      </KeyboardAvoidingView>
    </CompanyScreen>
  );
}

// ── Piezas ────────────────────────────────────────────────────────────────

/** Una tarjeta de tipo de técnico (maqueta W-Post): cuadrado de color, nombre y ✓. */
function TypeCard({
  code,
  label,
  selected,
  wide,
  onPress,
}: {
  code: TechnicianTypeCode;
  label: string;
  selected: boolean;
  wide: boolean;
  onPress: () => void;
}) {
  // El mismo cuadrado que las ofertas de ese tipo en la Home ("MEC", "ENG"…).
  const tile = { offerKind: offerKindForTechnicianType(code), licenseCode: undefined, technicianType: code };
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      style={({ pressed, hovered }: any) => [
        styles.typeCard,
        wide ? styles.typeCardWide : styles.typeCardNarrow,
        selected && styles.typeCardOn,
        !selected && (pressed || hovered) && styles.typeCardHover,
      ]}
    >
      <OfferTileSquare offer={tile} size={wide ? 34 : 38} />
      {selected ? (
        <View style={styles.typeCheck}>
          <Check color={colors.white} size={13} strokeWidth={3.2} />
        </View>
      ) : null}
      <Text style={styles.typeLabel} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

/**
 * Dos campos lado a lado en escritorio (maqueta W-D-Post). En móvil no hay
 * envoltorio: los campos quedan como hijos directos del contenido, para que
 * `errorAnchor` mida su posición dentro de lo que se desplaza.
 */
function PairRow({ wide, children }: { wide: boolean; children: React.ReactNode }) {
  return wide ? <View style={styles.pairRow}>{children}</View> : <>{children}</>;
}

/** La página de escritorio: columna de pasos a la izquierda y la tarjeta del paso. */
function DesktopFrame({
  nav,
  children,
  scrollRef,
}: {
  nav: React.ReactNode;
  children: React.ReactNode;
  scrollRef?: React.RefObject<ScrollView | null>;
}) {
  return (
    <CompanyScreen>
      <ScrollView
        ref={scrollRef}
        style={[styles.flex, styles.desktopPage]}
        contentContainerStyle={styles.desktopBody}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.desktopRow}>
          {nav}
          <View style={styles.desktopMain}>{children}</View>
        </View>
      </ScrollView>
    </CompanyScreen>
  );
}

/**
 * La columna de pasos de escritorio. Un paso ya hecho lleva ✓ y se puede
 * pulsar para volver a él; el actual y los siguientes, no (hacia delante sólo
 * con "Continue").
 */
function DesktopSteps({
  mode,
  form,
  position,
  done = false,
  onJump,
  jumpDisabled = false,
}: {
  mode: 'new' | 'edit';
  form: OfferWizardForm;
  position: OfferWizardPosition;
  done?: boolean;
  onJump: (to: OfferWizardPosition) => void;
  jumpDisabled?: boolean;
}) {
  const order: OfferWizardPosition[] = [...offerWizardSteps(form), 'review'];
  const currentIndex = order.indexOf(position);
  return (
    <View style={styles.nav} accessibilityLabel="Steps">
      <Text style={styles.navTitle} accessibilityRole="header">{mode === 'edit' ? 'Edit offer' : 'New offer'}</Text>
      {order.map((step, i) => {
        const label = step === 'review' ? 'Review' : offerWizardStepLabel(form, step);
        const current = !done && i === currentIndex;
        const finished = done || i < currentIndex;
        const canJump = !done && !jumpDisabled && canJumpToOfferWizardStep(form, position, step);
        return (
          <Pressable
            key={step}
            onPress={() => onJump(step)}
            disabled={!canJump}
            accessibilityRole="button"
            accessibilityState={{ selected: current, disabled: !canJump }}
            accessibilityLabel={`Step ${i + 1}: ${label}${finished ? ', done' : ''}`}
            style={({ hovered }: any) => [styles.navItem, current && styles.navItemOn, canJump && hovered && styles.navItemHover]}
          >
            <View style={[styles.navDot, current ? styles.navDotOn : finished ? styles.navDotDone : null]}>
              {finished
                ? <Check color={colors.success} size={14} strokeWidth={3} />
                : <Text style={[styles.navDotText, current && styles.navDotTextOn]}>{i + 1}</Text>}
            </View>
            <Text style={[styles.navLabel, current && styles.navLabelOn]} numberOfLines={1}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  helper: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  block: {
    gap: 10,
  },

  mobileBody: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 32,
    gap: 22,
  },
  mobileEngineBody: { flexGrow: 1 },

  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  typeCard: {
    position: 'relative',
    flexGrow: 1,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: WIZARD_OPTION_BORDER,
    backgroundColor: colors.surface,
    justifyContent: 'space-between',
    gap: 8,
  },
  typeCardNarrow: {
    flexBasis: '40%',
    minHeight: 96,
  },
  typeCardWide: {
    flexBasis: '28%',
    minHeight: 88,
  },
  typeCardOn: {
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: '#F2F8FC',
    // El borde de 2 px no debe mover el contenido respecto al de 1 px.
    padding: 11,
  },
  typeCardHover: {
    backgroundColor: colors.surfaceSoft,
  },
  typeCheck: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  typeLabel: {
    fontSize: 14.5,
    lineHeight: 18,
    fontWeight: '800',
    color: colors.text,
  },

  pairRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: 20,
  },
  pairItem: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 260,
    minWidth: 0,
  },
  yearsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  yearsLabel: {
    flexShrink: 1,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    padding: 3,
    borderRadius: 24,
    backgroundColor: colors.surfaceMuted,
  },
  stepButton: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: TOUCH_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  stepButtonPressed: {
    backgroundColor: colors.surfaceSoft,
  },
  stepValue: {
    minWidth: 36,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
  },

  reviewList: {
    gap: 14,
  },
  reviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  reviewBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: colors.surface,
  },
  reviewBlockWide: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '45%',
    minWidth: 0,
  },
  reviewCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  reviewTitle: {
    fontSize: 12.5,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  reviewLine: {
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: '700',
    color: colors.text,
  },

  doneBody: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 24,
    gap: 20,
  },
  doneIntro: {
    alignItems: 'center',
    gap: 14,
  },
  doneCircle: {
    width: 92,
    height: 92,
    borderRadius: 46,
    marginBottom: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.successSoft,
  },
  doneCircleWide: {
    width: 84,
    height: 84,
    borderRadius: 42,
  },
  doneTitle: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: colors.text,
    textAlign: 'center',
  },
  doneText: {
    fontSize: 15.5,
    lineHeight: 23,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  doneActions: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    gap: 10,
    paddingTop: 12,
    paddingHorizontal: 20,
    paddingBottom: 22,
  },
  doneWide: {
    alignItems: 'center',
    gap: 20,
    paddingVertical: 30,
  },
  doneCard: {
    width: '100%',
    maxWidth: 480,
  },
  doneWideActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
  },

  desktopPage: {
    backgroundColor: DESKTOP_PAGE,
  },
  desktopBody: {
    width: '100%',
    maxWidth: 1120,
    alignSelf: 'center',
    paddingHorizontal: 32,
    paddingTop: 28,
    paddingBottom: 48,
  },
  desktopRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: 28,
  },
  desktopMain: {
    flexGrow: 999,
    flexShrink: 1,
    flexBasis: 560,
    minWidth: 0,
    padding: 28,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: colors.surface,
    gap: 22,
  },
  mainContent: {
    gap: 22,
  },
  desktopActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  desktopActionsRight: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },

  nav: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 240,
    maxWidth: '100%',
    gap: 4,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: colors.surface,
  },
  navTitle: {
    paddingTop: 4,
    paddingHorizontal: 10,
    paddingBottom: 10,
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  navItemOn: {
    backgroundColor: colors.primarySoft,
  },
  navItemHover: {
    backgroundColor: colors.surfaceSoft,
  },
  navDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  navDotOn: {
    backgroundColor: colors.primary,
  },
  navDotDone: {
    backgroundColor: colors.successSoft,
  },
  navDotText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textSecondary,
  },
  navDotTextOn: {
    color: colors.white,
  },
  navLabel: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  navLabelOn: {
    color: colors.info,
  },
});
