import { gsap } from 'gsap';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Text } from '../ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../../theme';

// GSAP targets React Native Web DOM nodes via (ref.current as unknown as HTMLElement).
// In RN Web, View refs resolve to the underlying HTMLElement.

// ── Slide data ─────────────────────────────────────────────────────────────

const SLIDES = [
  {
    id: 'hero' as const,
    title: 'Aviation Job Talent',
    subtitle: 'Verified aviation talent, matched by license, aircraft type and availability.',
    description:
      'Aviation companies need reliable mechanics fast. Technicians need visibility without losing control of their identity.',
  },
  {
    id: 'profiles' as const,
    title: 'Built around verified profiles',
    subtitle: null,
    description:
      'Technicians showcase licenses, type ratings, experience, location and availability — all in one verified profile.',
  },
  {
    id: 'privacy' as const,
    title: 'Private by default',
    subtitle: null,
    description:
      'Companies see anonymous technical profiles first. Identity is revealed only after the technician accepts a direct offer.',
  },
  {
    id: 'search' as const,
    title: 'Search by what actually matters',
    subtitle: null,
    description:
      'Filter by license, type rating, country, availability and years of experience.',
  },
  {
    id: 'platform' as const,
    title: 'Web, Android and iOS',
    subtitle: null,
    description:
      'One account across every device, with secure sign-in and private document storage.',
  },
] as const;

type SlideId = typeof SLIDES[number]['id'];

function el(ref: React.RefObject<View | null>): HTMLElement | null {
  return (ref.current as unknown as HTMLElement) ?? null;
}

// ── Slide 1: Hero ──────────────────────────────────────────────────────────

function HeroVisual({ active }: { active: boolean }) {
  const logoRef = useRef<View>(null);
  const ring1Ref = useRef<View>(null);
  const ring2Ref = useRef<View>(null);
  const tlRef = useRef<gsap.core.Timeline | null>(null);

  useLayoutEffect(() => {
    const logo = el(logoRef);
    const r1 = el(ring1Ref);
    const r2 = el(ring2Ref);
    if (!logo) return;

    gsap.set(logo, { opacity: 0, scale: 0.7 });
    if (r1) gsap.set(r1, { opacity: 0.3, scale: 1 });
    if (r2) gsap.set(r2, { opacity: 0.2, scale: 1.1 });
  }, []);

  useEffect(() => {
    const logo = el(logoRef);
    const r1 = el(ring1Ref);
    const r2 = el(ring2Ref);
    if (!logo) return;

    if (!active) {
      gsap.killTweensOf([logo, r1, r2]);
      gsap.set(logo, { opacity: 0, scale: 0.7, y: 0 });
      return;
    }

    const tl = gsap.timeline();
    tlRef.current = tl;

    tl.to(logo, { opacity: 1, scale: 1, duration: 0.6, ease: 'back.out(1.5)' });
    tl.to(logo, { y: -8, duration: 2, repeat: -1, yoyo: true, ease: 'power1.inOut' }, '+=0.2');

    if (r1) {
      gsap.to(r1, {
        scale: 1.7,
        opacity: 0,
        duration: 2,
        repeat: -1,
        ease: 'power1.out',
        repeatDelay: 0.3,
      });
    }
    if (r2) {
      gsap.to(r2, {
        scale: 2.1,
        opacity: 0,
        duration: 2,
        delay: 0.7,
        repeat: -1,
        ease: 'power1.out',
        repeatDelay: 0.3,
      });
    }

    return () => {
      tl.kill();
      gsap.killTweensOf([logo, r1, r2]);
    };
  }, [active]);

  return (
    <View style={hv.wrap}>
      <View ref={ring1Ref} style={[hv.ring]} />
      <View ref={ring2Ref} style={[hv.ring, hv.ring2]} />
      <View ref={logoRef} style={hv.logo}>
        <Text style={hv.logoIcon}>✈</Text>
      </View>
    </View>
  );
}

const hv = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', width: 200, height: 200 },
  ring: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 1.5,
    borderColor: colors.cyan,
  },
  ring2: { width: 185, height: 185, borderRadius: 93, borderColor: `${colors.cyan}77` },
  logo: {
    width: 104,
    height: 104,
    borderRadius: 30,
    backgroundColor: colors.cyan,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.cyan,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
  },
  logoIcon: { fontSize: 46, color: colors.white },
});

// ── Slide 2: Profiles ──────────────────────────────────────────────────────

const BADGES = [
  { label: 'B1.1', color: colors.cyan },
  { label: 'B2', color: colors.blue },
  { label: 'A320', color: colors.info },
  { label: 'Line Maint.', color: colors.navy },
  { label: '✓ Verified', color: colors.success },
];

function ProfilesVisual({ active }: { active: boolean }) {
  const cardRef = useRef<View>(null);
  const badgeRefs = useRef<Array<View | null>>(BADGES.map(() => null));

  useLayoutEffect(() => {
    const card = el(cardRef);
    if (card) gsap.set(card, { opacity: 0, y: 16 });
    badgeRefs.current.forEach(r => {
      if (r) gsap.set(r as unknown as HTMLElement, { opacity: 0, scale: 0.6, y: 10 });
    });
  }, []);

  useEffect(() => {
    const card = el(cardRef);
    if (!card) return;

    if (!active) {
      gsap.killTweensOf(card);
      gsap.set(card, { opacity: 0, y: 16 });
      badgeRefs.current.forEach(r => {
        if (r) gsap.set(r as unknown as HTMLElement, { opacity: 0, scale: 0.6 });
      });
      return;
    }

    const tl = gsap.timeline();
    tl.to(card, { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' });

    const bEls = badgeRefs.current
      .map(r => r as unknown as HTMLElement)
      .filter(Boolean);

    tl.to(
      bEls,
      {
        opacity: 1,
        scale: 1,
        y: 0,
        duration: 0.35,
        stagger: 0.08,
        ease: 'back.out(1.6)',
      },
      '-=0.1'
    );

    // Subtle float on card
    gsap.to(card, { y: -6, duration: 2.2, repeat: -1, yoyo: true, ease: 'power1.inOut', delay: 0.8 });

    return () => {
      tl.kill();
      gsap.killTweensOf(card);
    };
  }, [active]);

  return (
    <View
      ref={cardRef}
      style={pv.card}
    >
      <View style={pv.header}>
        <View style={pv.avatar} />
        <View style={pv.meta}>
          <Text style={pv.code}>RTX-0042</Text>
          <Text style={pv.sub}>Anonymous Profile · 12 yrs exp.</Text>
        </View>
      </View>
      <View style={pv.badges}>
        {BADGES.map((b, i) => (
          <View
            key={b.label}
            ref={r => { badgeRefs.current[i] = r; }}
            style={[pv.badge, { backgroundColor: `${b.color}22`, borderColor: `${b.color}55` }]}
          >
            <Text style={[pv.badgeText, { color: b.color }]}>{b.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const pv = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    width: 290,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(11, 106, 158, 0.25)',
    marginRight: spacing.sm,
  },
  meta: { flex: 1 },
  code: { color: colors.text, fontWeight: '700', fontSize: 15 },
  sub: { color: colors.textMuted, fontSize: 12 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1 },
  badgeText: { fontSize: 12, fontWeight: '600' },
});

// ── Slide 3: Privacy ───────────────────────────────────────────────────────

function PrivacyVisual({ active }: { active: boolean }) {
  const hiddenRef = useRef<View>(null);
  const revealRef = useRef<View>(null);
  const tlRef = useRef<gsap.core.Timeline | null>(null);

  useLayoutEffect(() => {
    const h = el(hiddenRef);
    const r = el(revealRef);
    if (h) gsap.set(h, { opacity: 0, y: 16 });
    if (r) gsap.set(r, { opacity: 0 });
  }, []);

  useEffect(() => {
    const h = el(hiddenRef);
    const r = el(revealRef);
    if (!h || !r) return;

    if (!active) {
      tlRef.current?.kill();
      gsap.killTweensOf([h, r]);
      gsap.set(h, { opacity: 0, y: 16 });
      gsap.set(r, { opacity: 0 });
      return;
    }

    const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.5 });
    tlRef.current = tl;

    tl.to(h, { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' })
      .to(h, { opacity: 0, duration: 0.5, ease: 'power2.inOut' }, '+=1.8')
      .to(r, { opacity: 1, duration: 0.5, ease: 'power2.out' }, '-=0.3')
      .to(r, { opacity: 0, duration: 0.5, ease: 'power2.inOut' }, '+=1.8')
      .to(h, { opacity: 0, y: 16, duration: 0 });

    return () => {
      tl.kill();
      gsap.killTweensOf([h, r]);
    };
  }, [active]);

  return (
    <View style={prv.wrap}>
      <View ref={hiddenRef} style={[prv.card, prv.hiddenCard]}>
        <View style={prv.row}>
          <Text style={prv.lockIcon}>🔒</Text>
          <Text style={prv.hiddenCode}>RTX-1042</Text>
          <View style={prv.hiddenBadge}>
            <Text style={prv.hiddenBadgeText}>Identity hidden</Text>
          </View>
        </View>
        <View style={prv.redactedLines}>
          {[110, 80, 95].map((w, i) => (
            <View key={i} style={[prv.line, { width: w }]} />
          ))}
        </View>
      </View>

      <View
        ref={revealRef}
        style={[prv.card, prv.revealedCard, { position: 'absolute', top: 0, left: 0, right: 0 }]}
      >
        <View style={prv.row}>
          <Text style={prv.lockIcon}>✅</Text>
          <Text style={prv.revealedTitle}>Identity revealed</Text>
        </View>
        <Text style={prv.revealedName}>Verified technician - B1.1 / B2</Text>
        <Text style={prv.revealedContact}>Contact details unlocked after acceptance</Text>
      </View>
    </View>
  );
}

const prv = StyleSheet.create({
  wrap: { width: 290 },
  card: {
    borderRadius: 14,
    padding: spacing.md,
    borderWidth: 1,
    width: '100%',
    minHeight: 100,
  },
  hiddenCard: {
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.border,
  },
  revealedCard: {
    backgroundColor: 'rgba(11, 106, 158, 0.12)',
    borderColor: `${colors.cyan}55`,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  lockIcon: { fontSize: 16 },
  hiddenCode: { color: colors.textMuted, fontWeight: '700', fontSize: 14 },
  hiddenBadge: {
    marginLeft: 'auto',
    backgroundColor: colors.surfaceSoft,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  hiddenBadgeText: { color: colors.textMuted, fontSize: 11 },
  redactedLines: { gap: 8 },
  line: { height: 8, backgroundColor: colors.surfaceSoft, borderRadius: 4 },
  revealedTitle: { color: colors.cyan, fontWeight: '700', fontSize: 14 },
  revealedName: { color: colors.text, fontWeight: '600', fontSize: 14, marginBottom: 4 },
  revealedContact: { color: colors.textSecondary, fontSize: 12 },
});

// ── Slide 4: Search ────────────────────────────────────────────────────────

const FILTERS = ['B1.1', 'A320', 'Spain', 'Available'];

function SearchVisual({ active }: { active: boolean }) {
  const chipRefs = useRef<Array<View | null>>(FILTERS.map(() => null));
  const resultRef = useRef<View>(null);
  const barRef = useRef<View>(null);

  useLayoutEffect(() => {
    chipRefs.current.forEach(r => {
      if (r) gsap.set(r as unknown as HTMLElement, { opacity: 0, y: 12 });
    });
    const res = el(resultRef);
    if (res) gsap.set(res, { opacity: 0 });
    const bar = el(barRef);
    if (bar) gsap.set(bar, { width: '0%' });
  }, []);

  useEffect(() => {
    const chips = chipRefs.current
      .map(r => r as unknown as HTMLElement)
      .filter(Boolean);
    const res = el(resultRef);
    const bar = el(barRef);

    if (!active) {
      gsap.killTweensOf([...chips, res, bar]);
      chips.forEach(c => gsap.set(c, { opacity: 0, y: 12 }));
      if (res) gsap.set(res, { opacity: 0 });
      if (bar) gsap.set(bar, { width: '0%' });
      return;
    }

    const tl = gsap.timeline();
    tl.to(chips, { opacity: 1, y: 0, duration: 0.35, stagger: 0.09, ease: 'back.out(1.4)' });
    if (res) tl.to(res, { opacity: 1, duration: 0.3, ease: 'power2.out' });
    if (bar) tl.to(bar, { width: '98%', duration: 0.8, ease: 'power2.inOut' }, '-=0.1');

    return () => { tl.kill(); gsap.killTweensOf([...chips, res, bar]); };
  }, [active]);

  return (
    <View style={sv.wrap}>
      <View style={sv.filters}>
        {FILTERS.map((f, i) => (
          <View
            key={f}
            ref={r => { chipRefs.current[i] = r; }}
            style={sv.chip}
          >
            <Text style={sv.chipText}>{f} ›</Text>
          </View>
        ))}
      </View>
      <View ref={resultRef} style={sv.resultCard}>
        <View style={sv.resultHeader}>
          <View style={sv.dot} />
          <Text style={sv.resultCode}>RTX-0042</Text>
          <Text style={sv.matchScore}>98% match</Text>
        </View>
        <View style={sv.barTrack}>
          <View ref={barRef} style={sv.barFill} />
        </View>
      </View>
    </View>
  );
}

const sv = StyleSheet.create({
  wrap: { width: 290, gap: 12 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: 'rgba(11, 106, 158, 0.15)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: `${colors.cyan}55`,
  },
  chipText: { color: colors.cyan, fontSize: 13, fontWeight: '600' },
  resultCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  resultCode: { color: colors.text, fontSize: 13, fontWeight: '600', flex: 1 },
  matchScore: { color: colors.cyan, fontSize: 12, fontWeight: '700' },
  barTrack: {
    height: 6,
    backgroundColor: colors.surfaceSoft,
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: { height: '100%', backgroundColor: colors.cyan, borderRadius: 3, width: '0%' },
});

// ── Slide 5: Platform ──────────────────────────────────────────────────────

const PLATFORMS = [
  { icon: '🌐', label: 'Web' },
  { icon: '📱', label: 'Android' },
  { icon: '📲', label: 'iOS' },
];

function PlatformVisual({ active }: { active: boolean }) {
  const cardRefs = useRef<Array<View | null>>(PLATFORMS.map(() => null));

  useLayoutEffect(() => {
    cardRefs.current.forEach(r => {
      if (r) gsap.set(r as unknown as HTMLElement, { opacity: 0, y: 28, scale: 0.8 });
    });
  }, []);

  useEffect(() => {
    const cards = cardRefs.current
      .map(r => r as unknown as HTMLElement)
      .filter(Boolean);

    if (!active) {
      gsap.killTweensOf(cards);
      cards.forEach(c => gsap.set(c, { opacity: 0, y: 28, scale: 0.8 }));
      return;
    }

    const tl = gsap.timeline();
    tl.to(cards, {
      opacity: 1,
      y: 0,
      scale: 1,
      duration: 0.4,
      stagger: 0.12,
      ease: 'back.out(1.5)',
    });
    // Gentle float on each card
    cards.forEach((c, i) => {
      gsap.to(c, {
        y: -6,
        duration: 1.8 + i * 0.3,
        repeat: -1,
        yoyo: true,
        ease: 'power1.inOut',
        delay: 0.5 + i * 0.15,
      });
    });

    return () => { tl.kill(); gsap.killTweensOf(cards); };
  }, [active]);

  return (
    <View style={plv.row}>
      {PLATFORMS.map((p, i) => (
        <View
          key={p.label}
          ref={r => { cardRefs.current[i] = r; }}
          style={plv.card}
        >
          <Text style={plv.icon}>{p.icon}</Text>
          <Text style={plv.label}>{p.label}</Text>
        </View>
      ))}
    </View>
  );
}

const plv = StyleSheet.create({
  row: { flexDirection: 'row', gap: 14 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: spacing.md,
    alignItems: 'center',
    gap: 8,
    minWidth: 86,
    borderWidth: 1,
    borderColor: colors.borderLight,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
  },
  icon: { fontSize: 30 },
  label: { color: colors.text, fontSize: 12, fontWeight: '600' },
});

// ── Visual dispatcher ──────────────────────────────────────────────────────

function SlideVisual({ id, active }: { id: SlideId; active: boolean }) {
  switch (id) {
    case 'hero': return <HeroVisual active={active} />;
    case 'profiles': return <ProfilesVisual active={active} />;
    case 'privacy': return <PrivacyVisual active={active} />;
    case 'search': return <SearchVisual active={active} />;
    case 'platform': return <PlatformVisual active={active} />;
  }
}

// ── Main IntroExperience ───────────────────────────────────────────────────

interface IntroExperienceProps {
  onComplete: () => void;
}

export function IntroExperience({ onComplete }: IntroExperienceProps) {
  const [current, setCurrent] = useState(0);
  const [visualActive, setVisualActive] = useState(false);
  const bodyRef = useRef<View>(null);
  const ctaRef = useRef<View>(null);
  const { width, height } = useWindowDimensions();
  const isWide = width >= 768;
  const isShort = height < 680;

  useLayoutEffect(() => {
    const body = el(bodyRef);
    if (body) gsap.set(body, { opacity: 0, y: 24 });
    const cta = el(ctaRef);
    if (cta) gsap.set(cta, { opacity: 0, y: 16 });
  }, []);

  function animateIn() {
    setVisualActive(true);
    const body = el(bodyRef);
    const cta = el(ctaRef);
    if (body) gsap.fromTo(body, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' });
    if (cta) gsap.fromTo(cta, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.4, delay: 0.3, ease: 'power2.out' });
  }

  function animateOut(cb: () => void) {
    setVisualActive(false);
    const body = el(bodyRef);
    if (body) {
      gsap.to(body, { opacity: 0, y: -14, duration: 0.22, ease: 'power2.in', onComplete: cb });
    } else {
      cb();
    }
  }

  useEffect(() => {
    // Small delay so DOM is ready
    const t = setTimeout(animateIn, 50);
    return () => clearTimeout(t);
  }, []);

  function goNext() {
    if (current < SLIDES.length - 1) {
      animateOut(() => {
        setCurrent(c => c + 1);
        animateIn();
      });
    } else {
      onComplete();
    }
  }

  const slide = SLIDES[current];
  const isLast = current === SLIDES.length - 1;

  return (
    <SafeAreaView style={styles.safe}>
      {/* Ambient glows */}
      <View pointerEvents="none" style={[styles.glow, styles.glowTR]} />
      <View pointerEvents="none" style={[styles.glow, styles.glowBL]} />
      <View pointerEvents="none" style={[styles.glow, styles.glowCenter]} />

      <View style={[styles.inner, isWide && styles.innerWide]}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <View style={styles.dots}>
            {SLIDES.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  i === current && styles.dotActive,
                  i < current && styles.dotPast,
                ]}
              />
            ))}
          </View>
          <TouchableOpacity
            onPress={onComplete}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.skipBtn}
          >
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        </View>

        {/* Slide body */}
        <View ref={bodyRef} style={styles.slideBody}>
          <View style={[styles.visualArea, isShort && styles.visualAreaShort]}>
            <SlideVisual id={slide.id} active={visualActive} />
          </View>
          <View style={styles.textArea}>
            <Text style={[styles.title, isWide && styles.titleWide]}>{slide.title}</Text>
            {slide.subtitle ? (
              <Text style={styles.subtitle}>{slide.subtitle}</Text>
            ) : null}
            <Text style={styles.description}>{slide.description}</Text>
          </View>
        </View>

        {/* CTA */}
        <View ref={ctaRef} style={styles.nav}>
          <TouchableOpacity
            onPress={goNext}
            activeOpacity={0.85}
            style={[styles.btn, isLast && styles.btnFinal]}
          >
            <Text style={styles.btnText}>
              {isLast ? 'Enter Aviation Job Talent' : 'Next  →'}
            </Text>
          </TouchableOpacity>
          {!isLast && (
            <Text style={styles.stepHint}>{current + 1} of {SLIDES.length}</Text>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  inner: { flex: 1 },
  innerWide: {
    maxWidth: 560,
    alignSelf: 'center',
    width: '100%',
  },
  glow: { position: 'absolute', borderRadius: 999 },
  glowTR: {
    width: 420,
    height: 420,
    backgroundColor: 'rgba(11, 106, 158, 0.07)',
    top: -120,
    right: -120,
  },
  glowBL: {
    width: 340,
    height: 340,
    backgroundColor: 'rgba(11, 106, 158, 0.05)',
    bottom: -100,
    left: -100,
  },
  glowCenter: {
    width: 500,
    height: 500,
    backgroundColor: 'rgba(11, 106, 158, 0.025)',
    top: '20%',
    left: '50%',
    marginLeft: -250,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  dots: { flexDirection: 'row', gap: 6 },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  dotActive: { width: 24, backgroundColor: colors.cyan },
  dotPast: { backgroundColor: 'rgba(11, 106, 158, 0.35)' },
  skipBtn: { paddingVertical: 4, paddingHorizontal: 6 },
  skipText: { color: colors.textMuted, fontSize: 14, fontWeight: '500' },
  slideBody: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  visualArea: {
    height: 240,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  visualAreaShort: { height: 170 },
  textArea: { flex: 1 },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.6,
    marginBottom: spacing.sm,
    lineHeight: 34,
  },
  titleWide: { fontSize: 32, lineHeight: 40 },
  subtitle: {
    fontSize: 16,
    color: colors.cyan,
    fontWeight: '600',
    marginBottom: spacing.sm,
    lineHeight: 23,
  },
  description: {
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 23,
  },
  nav: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  btn: {
    backgroundColor: colors.blue,
    borderRadius: 999,
    paddingVertical: 17,
    alignItems: 'center',
    shadowColor: colors.blue,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  btnFinal: {
    backgroundColor: colors.cyan,
    shadowColor: colors.cyan,
  },
  btnText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  stepHint: {
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 12,
  },
});
