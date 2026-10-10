import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  StyleSheet,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Text } from '../ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../../theme';

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

// ── Slide 1: Hero visual ───────────────────────────────────────────────────

function HeroVisual({ active }: { active: boolean }) {
  const logoScale = useRef(new Animated.Value(0.7)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const floatY = useRef(new Animated.Value(0)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);
  const floatRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (!active) {
      logoScale.setValue(0.7);
      logoOpacity.setValue(0);
      ring1.setValue(0);
      ring2.setValue(0);
      floatY.setValue(0);
      loopRef.current?.stop();
      floatRef.current?.stop();
      return;
    }

    Animated.parallel([
      Animated.spring(logoScale, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
      Animated.timing(logoOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]).start();

    const ringLoop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(ring1, { toValue: 1, duration: 1800, useNativeDriver: true }),
        ]),
        Animated.timing(ring1, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    const ringLoop2 = Animated.loop(
      Animated.sequence([
        Animated.delay(700),
        Animated.timing(ring2, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(ring2, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    ringLoop.start();
    ringLoop2.start();

    const float = Animated.loop(
      Animated.sequence([
        Animated.timing(floatY, { toValue: -8, duration: 1800, useNativeDriver: true }),
        Animated.timing(floatY, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ])
    );
    float.start();
    floatRef.current = float;

    return () => {
      ringLoop.stop();
      ringLoop2.stop();
      float.stop();
    };
  }, [active]);

  const ring1Scale = ring1.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] });
  const ring1Opacity = ring1.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.35, 0.15, 0] });
  const ring2Scale = ring2.interpolate({ inputRange: [0, 1], outputRange: [1.1, 1.8] });
  const ring2Opacity = ring2.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.2, 0.08, 0] });

  return (
    <Animated.View style={[hv.wrap, { transform: [{ translateY: floatY }] }]}>
      <Animated.View
        style={[hv.ring, { transform: [{ scale: ring1Scale }], opacity: ring1Opacity }]}
      />
      <Animated.View
        style={[hv.ring, hv.ring2, { transform: [{ scale: ring2Scale }], opacity: ring2Opacity }]}
      />
      <Animated.View style={[hv.logo, { opacity: logoOpacity, transform: [{ scale: logoScale }] }]}>
        <Text style={hv.logoIcon}>✈</Text>
      </Animated.View>
    </Animated.View>
  );
}

const hv = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', width: 180, height: 180 },
  ring: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 1.5,
    borderColor: colors.cyan,
  },
  ring2: { width: 180, height: 180, borderRadius: 90, borderColor: `${colors.cyan}88` },
  logo: {
    width: 100,
    height: 100,
    borderRadius: 30,
    backgroundColor: colors.cyan,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.cyan,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 12,
  },
  logoIcon: { fontSize: 44, color: colors.white },
});

// ── Slide 2: Profiles visual ───────────────────────────────────────────────

const BADGES = [
  { label: 'B1.1', color: colors.cyan },
  { label: 'B2', color: colors.blue },
  { label: 'A320', color: colors.info },
  { label: 'Line Maint.', color: colors.navy },
  { label: '✓ Verified', color: colors.success },
];

function ProfilesVisual({ active }: { active: boolean }) {
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardY = useRef(new Animated.Value(12)).current;
  const badgeAnims = useRef(BADGES.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (!active) {
      cardOpacity.setValue(0);
      cardY.setValue(12);
      badgeAnims.forEach(a => a.setValue(0));
      return;
    }
    Animated.parallel([
      Animated.timing(cardOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.spring(cardY, { toValue: 0, friction: 8, tension: 100, useNativeDriver: true }),
    ]).start(() => {
      Animated.stagger(
        90,
        badgeAnims.map(a =>
          Animated.spring(a, { toValue: 1, friction: 7, tension: 120, useNativeDriver: true })
        )
      ).start();
    });
  }, [active]);

  return (
    <Animated.View
      style={[pv.card, { opacity: cardOpacity, transform: [{ translateY: cardY }] }]}
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
          <Animated.View
            key={b.label}
            style={[
              pv.badge,
              { backgroundColor: `${b.color}22`, borderColor: `${b.color}55` },
              {
                opacity: badgeAnims[i],
                transform: [
                  {
                    scale: badgeAnims[i].interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.6, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            <Text style={[pv.badgeText, { color: b.color }]}>{b.label}</Text>
          </Animated.View>
        ))}
      </View>
    </Animated.View>
  );
}

const pv = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    width: 280,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
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

// ── Slide 3: Privacy visual ────────────────────────────────────────────────

function PrivacyVisual({ active }: { active: boolean }) {
  const hiddenOpacity = useRef(new Animated.Value(0)).current;
  const revealOpacity = useRef(new Animated.Value(0)).current;
  const cardY = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    if (!active) {
      hiddenOpacity.setValue(0);
      revealOpacity.setValue(0);
      cardY.setValue(16);
      return;
    }

    Animated.parallel([
      Animated.timing(hiddenOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(cardY, { toValue: 0, friction: 8, tension: 100, useNativeDriver: true }),
    ]).start();

    const cycle = () => {
      const t1 = setTimeout(() => {
        Animated.parallel([
          Animated.timing(hiddenOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
          Animated.timing(revealOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        ]).start();
      }, 1800);
      const t2 = setTimeout(() => {
        Animated.parallel([
          Animated.timing(hiddenOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
          Animated.timing(revealOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
        ]).start();
      }, 3500);
      return { t1, t2 };
    };

    const { t1, t2 } = cycle();
    const interval = setInterval(() => {
      cycle();
    }, 5200);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearInterval(interval);
    };
  }, [active]);

  return (
    <Animated.View style={[prv.wrap, { transform: [{ translateY: cardY }] }]}>
      {/* Hidden card */}
      <Animated.View style={[prv.card, prv.hiddenCard, { opacity: hiddenOpacity }]}>
        <View style={prv.row}>
          <Text style={prv.lockIcon}>🔒</Text>
          <Text style={prv.hiddenCode}>RTX-1042</Text>
          <View style={prv.hiddenBadge}>
            <Text style={prv.hiddenBadgeText}>Identity hidden</Text>
          </View>
        </View>
        <View style={prv.redactedLines}>
          {[100, 75, 90].map((w, i) => (
            <View key={i} style={[prv.line, { width: w }]} />
          ))}
        </View>
      </Animated.View>

      {/* Revealed card */}
      <Animated.View
        style={[prv.card, prv.revealedCard, { opacity: revealOpacity, position: 'absolute', top: 0, left: 0, right: 0 }]}
      >
        <View style={prv.row}>
          <Text style={prv.lockIcon}>✅</Text>
          <Text style={prv.revealedTitle}>Identity revealed</Text>
        </View>
        <Text style={prv.revealedName}>Verified technician - B1.1 / B2</Text>
        <Text style={prv.revealedContact}>Contact details unlocked after acceptance</Text>
      </Animated.View>
    </Animated.View>
  );
}

const prv = StyleSheet.create({
  wrap: { width: 280 },
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
  line: {
    height: 8,
    backgroundColor: colors.surfaceSoft,
    borderRadius: 4,
  },
  revealedTitle: { color: colors.cyan, fontWeight: '700', fontSize: 14 },
  revealedName: { color: colors.text, fontWeight: '600', fontSize: 14, marginBottom: 4 },
  revealedContact: { color: colors.textSecondary, fontSize: 12 },
});

// ── Slide 4: Search visual ─────────────────────────────────────────────────

const FILTERS = ['B1.1', 'A320', 'Spain', 'Available'];

function SearchVisual({ active }: { active: boolean }) {
  const filterAnims = useRef(FILTERS.map(() => new Animated.Value(0))).current;
  const resultOpacity = useRef(new Animated.Value(0)).current;
  const barWidth = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      filterAnims.forEach(a => a.setValue(0));
      resultOpacity.setValue(0);
      barWidth.setValue(0);
      return;
    }
    Animated.stagger(
      100,
      filterAnims.map(a =>
        Animated.spring(a, { toValue: 1, friction: 7, tension: 100, useNativeDriver: true })
      )
    ).start(() => {
      Animated.timing(resultOpacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();
      Animated.timing(barWidth, { toValue: 1, duration: 900, useNativeDriver: false }).start();
    });
  }, [active]);

  return (
    <View style={sv.wrap}>
      <View style={sv.filters}>
        {FILTERS.map((f, i) => (
          <Animated.View
            key={f}
            style={[
              sv.chip,
              {
                opacity: filterAnims[i],
                transform: [
                  {
                    translateY: filterAnims[i].interpolate({
                      inputRange: [0, 1],
                      outputRange: [10, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <Text style={sv.chipText}>{f} ›</Text>
          </Animated.View>
        ))}
      </View>

      <Animated.View style={[sv.resultCard, { opacity: resultOpacity }]}>
        <View style={sv.resultHeader}>
          <View style={sv.dot} />
          <Text style={sv.resultCode}>RTX-0042</Text>
          <Text style={sv.matchScore}>98% match</Text>
        </View>
        <View style={sv.barTrack}>
          <Animated.View
            style={[
              sv.barFill,
              {
                width: barWidth.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '98%'],
                }),
              },
            ]}
          />
        </View>
      </Animated.View>
    </View>
  );
}

const sv = StyleSheet.create({
  wrap: { width: 280, gap: 12 },
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
  barFill: { height: '100%', backgroundColor: colors.cyan, borderRadius: 3 },
});

// ── Slide 5: Platform visual ───────────────────────────────────────────────

const PLATFORMS = [
  { icon: '🌐', label: 'Web' },
  { icon: '📱', label: 'Android' },
  { icon: '📲', label: 'iOS' },
];

function PlatformVisual({ active }: { active: boolean }) {
  const anims = useRef(PLATFORMS.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (!active) {
      anims.forEach(a => a.setValue(0));
      return;
    }
    Animated.stagger(
      130,
      anims.map(a =>
        Animated.spring(a, { toValue: 1, friction: 6, tension: 100, useNativeDriver: true })
      )
    ).start();
  }, [active]);

  return (
    <View style={plv.row}>
      {PLATFORMS.map((p, i) => (
        <Animated.View
          key={p.label}
          style={[
            plv.card,
            {
              opacity: anims[i],
              transform: [
                {
                  translateY: anims[i].interpolate({
                    inputRange: [0, 1],
                    outputRange: [30, 0],
                  }),
                },
                {
                  scale: anims[i].interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.8, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <Text style={plv.icon}>{p.icon}</Text>
          <Text style={plv.label}>{p.label}</Text>
        </Animated.View>
      ))}
    </View>
  );
}

const plv = StyleSheet.create({
  row: { flexDirection: 'row', gap: 14 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.md,
    alignItems: 'center',
    gap: 8,
    minWidth: 82,
    borderWidth: 1,
    borderColor: colors.borderLight,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  icon: { fontSize: 28 },
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
  const [visualActive, setVisualActive] = useState(true);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;
  const { height } = useWindowDimensions();
  const isShort = height < 680;

  function animateIn() {
    opacity.setValue(0);
    translateY.setValue(20);
    setVisualActive(true);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 350, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, friction: 8, tension: 100, useNativeDriver: true }),
    ]).start();
  }

  function animateOut(cb: () => void) {
    setVisualActive(false);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: -14, duration: 200, useNativeDriver: true }),
    ]).start(() => cb());
  }

  useEffect(() => { animateIn(); }, []);

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

      {/* Top bar: dots + skip */}
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

      {/* Animated slide body */}
      <Animated.View
        style={[styles.slideBody, { opacity, transform: [{ translateY }] }]}
      >
        <View style={[styles.visualArea, isShort && styles.visualAreaShort]}>
          <SlideVisual id={slide.id} active={visualActive} />
        </View>

        <View style={styles.textArea}>
          <Text style={styles.title}>{slide.title}</Text>
          {slide.subtitle ? (
            <Text style={styles.subtitle}>{slide.subtitle}</Text>
          ) : null}
          <Text style={styles.description}>{slide.description}</Text>
        </View>
      </Animated.View>

      {/* Bottom nav */}
      <View style={styles.nav}>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  glow: { position: 'absolute', borderRadius: 999 },
  glowTR: {
    width: 340,
    height: 340,
    backgroundColor: 'rgba(11, 106, 158, 0.07)',
    top: -100,
    right: -100,
  },
  glowBL: {
    width: 280,
    height: 280,
    backgroundColor: 'rgba(11, 106, 158, 0.06)',
    bottom: -80,
    left: -80,
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
  dotActive: { width: 22, backgroundColor: colors.cyan },
  dotPast: { backgroundColor: 'rgba(11, 106, 158, 0.35)' },
  skipBtn: { paddingVertical: 4, paddingHorizontal: 6 },
  skipText: { color: colors.textMuted, fontSize: 14, fontWeight: '500' },
  slideBody: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  visualArea: {
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  visualAreaShort: { height: 160 },
  textArea: { flex: 1 },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.5,
    marginBottom: spacing.sm,
    lineHeight: 32,
  },
  subtitle: {
    fontSize: 15,
    color: colors.cyan,
    fontWeight: '600',
    marginBottom: spacing.sm,
    lineHeight: 22,
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
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
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
