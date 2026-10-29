/**
 * The tonight part of the home screen (VC-80, Concept A "Live hero +
 * carousel", design/vc80-home-redesign-spec.md):
 *
 *   - HeroCard: the big card at the top. Generated art 180 px tall with the
 *     LIVE pill and the event's name over it; under the art the "where ·
 *     when · here" line and the tags, and on the right the mini gauge
 *     ("9.1 Fire") for a live score, the vibe chip for an event on now
 *     without a live score, or "Starts in 40 min" for "Next up";
 *   - ArtCard: a smaller art card. In the carousel it is 220 wide; with only
 *     two tonight events the second one is shown full width instead;
 *   - TonightCarousel: the sideways carousel of ArtCards. It snaps card by
 *     card with the current card in the middle. The middle card is full size
 *     and its neighbours 94%, and each card's art slides 12 px against the
 *     scroll (parallax), so swiping feels alive.
 *
 * Shared rules (same as the list cards, src/components/EventCard.tsx):
 *   - before an event starts: no score, no "here" count, no LIVE (VC-61);
 *   - the score shown is the PUBLISHED snapshot the screen already loaded,
 *     never anything new (VC-80 privacy rule);
 *   - house parties show their area label only, and the art is seeded by
 *     the event id only (VC-69);
 *   - the gold edge only for a live Hot or Fire score (VC-77);
 *   - each card is ONE button with the list card's spoken summary; the art,
 *     LIVE pill and gauge are decoration.
 *
 * Reduce Motion: the screen passes `animate` false. Then no press shrink, no
 * LIVE pulse, no carousel scaling and no parallax. Snapping stays, because
 * the person's own finger drives it.
 */
import { memo, useCallback, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Animated, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { ListRenderItem, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { VibeBadge, eventSpoken, showsGoldEdge } from '@/components/EventCard';
import { GeneratedArt } from '@/components/GeneratedArt';
import { LivePill } from '@/components/LiveDot';
import { PressableScale } from '@/components/PressableScale';
import { Tag } from '@/components/Tag';
import { VibeMeter } from '@/components/VibeMeter';
import { tapSelection } from '@/lib/haptics';
import { startsIn } from '@/lib/home-layout';
import type { HeroKind } from '@/lib/home-layout';
import { hasStarted, isOnNow, isStaffPick, whenLine } from '@/lib/tonight';
import type { PublicEvent } from '@/lib/tonight';
import { hereText } from '@/lib/vibe';
import type { Vibe } from '@/lib/vibe';
import { colors, fonts, headlineMaxScale, motion, radius, spacing, typography } from '@/theme';

/** The hero card's art height (spec: 180 px). */
export const HERO_ART_HEIGHT = 180;
/** A carousel card's size (spec: 220 x 236; it can grow with large text). */
export const CAROUSEL_CARD_WIDTH = 220;
export const CAROUSEL_CARD_MIN_HEIGHT = 236;
/** The art band on a carousel (and full-width) card. */
export const ART_CARD_ART_HEIGHT = 112;
/** The space between carousel cards. */
export const CAROUSEL_GAP = 12;
/** One snap step: a card plus the gap after it. */
export const CAROUSEL_STEP = CAROUSEL_CARD_WIDTH + CAROUSEL_GAP;
/** How small the cards next to the middle one are (spec: 0.94). */
export const NEIGHBOUR_SCALE = 0.94;
/** How far each card's art slides against the scroll (spec: 12 px). */
export const PARALLAX_PX = 12;
/** The word before the countdown on a "Next up" card. */
export const STARTS_WORD = 'Starts';

/**
 * The "where · when · here" line, exactly as on the list cards.
 *
 * @param event - the event.
 * @param now - the current moment.
 * @param vibe - its vibe (undefined before the start).
 * @returns e.g. "Shaw, DC · On now · until 2 AM · 74 here".
 */
function metaLine(event: PublicEvent, now: Date, vibe: Vibe | undefined): string {
  const here = vibe ? hereText(vibe.here, false) : null;
  return `${event.area_label} · ${whenLine(event, now)}${here ? ` · ${here}` : ''}`;
}

/**
 * The TEST, Staff pick and 21+ chips (same as the list cards). TEST makes
 * sure a tester never mistakes a test event for a real party (VC-63b).
 *
 * @param props.event - the event.
 * @returns the chips row, or nothing when there are none.
 */
function Tags({ event }: { event: PublicEvent }) {
  const staffPick = isStaffPick(event);
  if (!staffPick && !event.is_21_plus && !event.is_test) return null;
  return (
    <View style={styles.tags}>
      {event.is_test ? <Tag label="TEST" tone="gold" /> : null}
      {staffPick ? <Tag label="Staff pick" tone="gold" /> : null}
      {event.is_21_plus ? <Tag label="21+" /> : null}
    </View>
  );
}

/**
 * A dark fade over the lower part of the art, so white words on it stay
 * readable whatever the art looks like.
 *
 * @returns the fade, filling its parent, hidden from screen readers.
 */
function ArtFade() {
  // A unique gradient name on the screen; useId's ":" characters break
  // SVG's url(#...) links, so keep letters and numbers only.
  const id = `art-fade-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} x1={0} y1={0} x2={0} y2={1}>
            <Stop offset={0.3} stopColor={colors.bg} stopOpacity={0} />
            <Stop offset={1} stopColor={colors.bg} stopOpacity={0.85} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={100} height={100} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/** What a HeroCard needs. */
export interface HeroCardProps {
  event: PublicEvent;
  /** Why it was picked (src/lib/home-layout.ts pickHero). */
  kind: HeroKind;
  /** Its published vibe, or undefined. Ignored before the start. */
  vibe?: Vibe;
  /** The current moment. */
  now: Date;
  /** Opens the event page (gets the event's id). */
  onPress: (id: string) => void;
  /** false under Reduce Motion: no press shrink, no LIVE pulse. */
  animate: boolean;
}

/**
 * Renders the hero card.
 *
 * @returns one button: the art with LIVE and the name, then the details and
 *   the gauge (live), the vibe chip (on now) or the countdown (Next up).
 */
function HeroCardView({ event, kind, vibe: given, now, onPress, animate }: HeroCardProps) {
  // Same rule as the list cards: nothing about ratings before the start.
  const vibe = hasStarted(event, now) ? given : undefined;
  const live = isOnNow(event, now);
  const goldEdge = showsGoldEdge(live, vibe);
  const countdown = kind === 'next' ? startsIn(event, now) : '';

  /** The right side of the details row, by why the card was picked. */
  let right: ReactNode = null;
  if (kind === 'live' && vibe) {
    right = <VibeMeter vibe={vibe} size="mini" />;
  } else if (countdown) {
    right = (
      <View style={styles.countdown} testID="hero-countdown">
        <Text style={styles.countdownWord}>{STARTS_WORD}</Text>
        <Text style={styles.countdownTime}>{countdown}</Text>
      </View>
    );
  } else if (vibe) {
    right = <VibeBadge vibe={vibe} />;
  }

  return (
    <PressableScale
      outerTestID="hero-card-scale"
      scaleTo={motion.pressScale.card}
      animate={animate}
      onPress={() => onPress(event.id)}
      accessibilityRole="button"
      accessibilityLabel={eventSpoken(event, now, vibe)}
      accessibilityHint="Opens the event"
      testID="hero-card"
      style={({ pressed }) => [styles.hero, goldEdge && styles.goldEdge, pressed && styles.pressed]}
    >
      <View style={styles.heroArt}>
        <GeneratedArt seed={event.id} height={HERO_ART_HEIGHT} />
        <ArtFade />
        {live ? (
          <View style={styles.pillSpot}>
            <LivePill animate={animate} />
          </View>
        ) : null}
        <Text style={styles.heroTitle} numberOfLines={2} maxFontSizeMultiplier={headlineMaxScale}>
          {event.title}
        </Text>
      </View>
      <View style={styles.heroInfo}>
        <View style={styles.infoText}>
          <Text style={styles.meta}>{metaLine(event, now, vibe)}</Text>
          <Tags event={event} />
        </View>
        {right}
      </View>
    </PressableScale>
  );
}

/** The hero card, re-drawn only when its own inputs change (VC-76 speed rule). */
export const HeroCard = memo(HeroCardView);

/** What an ArtCard needs. */
export interface ArtCardProps {
  event: PublicEvent;
  /** Its published vibe, or undefined. Ignored before the start. */
  vibe?: Vibe;
  /** The current moment. */
  now: Date;
  /** Opens the event page (gets the event's id). */
  onPress: (id: string) => void;
  /** false under Reduce Motion: no press shrink, pulse, scaling or parallax. */
  animate: boolean;
  /**
   * 'carousel' (220 wide, scales and parallaxes with the carousel) or
   * 'wide' (full width, the "2 events tonight" case).
   */
  variant: 'carousel' | 'wide';
  /**
   * Carousel only: this card's place (0 = first) and how many cards there
   * are, for "2 of 4" in the spoken summary and for its scaling. Two plain
   * numbers rather than one { index, total } object, because a new object
   * on every draw would count as a change and re-draw the card for nothing.
   */
  index?: number;
  total?: number;
  /** Carousel only: the carousel's sideways scroll position. */
  scrollX?: Animated.Value;
}

/**
 * Renders a smaller art card.
 *
 * @returns one button: the art band (with LIVE), the name, the "where ·
 *   when · here" line, the tags and the vibe chip (or "Starts in 40 min").
 */
function ArtCardView({
  event,
  vibe: given,
  now,
  onPress,
  animate,
  variant,
  index,
  total,
  scrollX,
}: ArtCardProps) {
  const vibe = hasStarted(event, now) ? given : undefined;
  const live = isOnNow(event, now);
  const goldEdge = showsGoldEdge(live, vibe);
  const countdown = startsIn(event, now);
  const carousel = variant === 'carousel';
  // "2 of 4" tells screen-reader users where they are in the carousel.
  const spoken =
    eventSpoken(event, now, vibe) +
    (index !== undefined && total !== undefined ? `, ${index + 1} of ${total}` : '');

  // Carousel motion (spec): this card is full size when it is in the
  // middle and 94% one step either side; its art drifts 12 px the other
  // way. Both follow the scroll on the phone's UI thread (native driver).
  // Off under Reduce Motion, and for the wide card.
  // Built once per card place (useMemo), not on every draw: a fresh
  // interpolation each time would hand the native side new animated
  // values on every minute tick for nothing.
  const { scale, drift } = useMemo(() => {
    if (!carousel || !animate || scrollX === undefined || index === undefined) {
      return { scale: 1, drift: 0 };
    }
    // The scroll positions where this card is one step left, in the
    // middle, and one step right.
    const steps = [(index - 1) * CAROUSEL_STEP, index * CAROUSEL_STEP, (index + 1) * CAROUSEL_STEP];
    return {
      scale: scrollX.interpolate({
        inputRange: steps,
        outputRange: [NEIGHBOUR_SCALE, 1, NEIGHBOUR_SCALE],
        extrapolate: 'clamp',
      }),
      drift: scrollX.interpolate({
        inputRange: steps,
        outputRange: [-PARALLAX_PX, 0, PARALLAX_PX],
        extrapolate: 'clamp',
      }),
    };
  }, [carousel, animate, scrollX, index]);

  return (
    <Animated.View
      style={[carousel && styles.carouselSlot, { transform: [{ scale }] }]}
      testID="art-card-slot"
    >
      <PressableScale
        scaleTo={motion.pressScale.card}
        animate={animate}
        onPress={() => onPress(event.id)}
        accessibilityRole="button"
        accessibilityLabel={spoken}
        accessibilityHint="Opens the event"
        testID="art-card"
        style={({ pressed }) => [
          styles.artCard,
          goldEdge && styles.goldEdge,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.artBand}>
          {/* The art is 24 px wider than the band (12 each side), so it
              can slide 12 px without showing an edge. */}
          <Animated.View
            style={[styles.artBleed, { transform: [{ translateX: drift }] }]}
            testID="art-card-art"
          >
            <GeneratedArt seed={event.id} />
          </Animated.View>
          {live ? (
            <View style={styles.pillSpotSmall}>
              <LivePill animate={animate} />
            </View>
          ) : null}
        </View>
        <View style={styles.artText}>
          <Text style={styles.artTitle} numberOfLines={2} maxFontSizeMultiplier={headlineMaxScale}>
            {event.title}
          </Text>
          <Text style={styles.meta}>{metaLine(event, now, vibe)}</Text>
          <Tags event={event} />
          {vibe ? <VibeBadge vibe={vibe} align="start" /> : null}
          {countdown ? (
            <Text style={styles.countdownInline}>{`${STARTS_WORD} ${countdown}`}</Text>
          ) : null}
        </View>
      </PressableScale>
    </Animated.View>
  );
}

/**
 * What a card shows that depends on the clock: started yet, on now, the
 * "when" words (which the spoken summary also uses) and the countdown.
 *
 * @param event - the event.
 * @param now - the current moment.
 * @returns one string; equal strings mean the card would look the same.
 */
function timeView(event: PublicEvent, now: Date): string {
  return [
    hasStarted(event, now),
    isOnNow(event, now),
    whenLine(event, now),
    startsIn(event, now),
  ].join('|');
}

/**
 * Whether two vibes would draw the same. Every vibe refresh brings brand
 * new objects from the server even when nothing changed, so comparing the
 * objects themselves would always say "changed"; this compares their
 * contents instead (a vibe is small, plain data).
 *
 * @param a - the vibe drawn last time (or undefined).
 * @param b - the vibe now (or undefined).
 * @returns true when they hold the same values.
 */
function sameVibe(a: Vibe | undefined, b: Vibe | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Decides whether an art card can skip a re-draw (React's memo check).
 * The screen hands every card a new `now` each minute and a new vibe each
 * refresh, so a plain check would re-draw every card every time. Here a
 * card re-draws only when something it SHOWS changes: its clock-based
 * words (timeView), its vibe's values, or any other input.
 *
 * @param prev - the inputs last time.
 * @param next - the inputs now.
 * @returns true to keep the last drawing.
 */
function sameArtCard(prev: ArtCardProps, next: ArtCardProps): boolean {
  return (
    prev.event === next.event &&
    prev.onPress === next.onPress &&
    prev.animate === next.animate &&
    prev.variant === next.variant &&
    prev.index === next.index &&
    prev.total === next.total &&
    prev.scrollX === next.scrollX &&
    sameVibe(prev.vibe, next.vibe) &&
    (prev.now === next.now || timeView(prev.event, prev.now) === timeView(next.event, next.now))
  );
}

/** An art card, re-drawn only when what it shows changes. */
export const ArtCard = memo(ArtCardView, sameArtCard);

/** What a TonightCarousel needs. */
export interface TonightCarouselProps {
  /** The tonight events after the hero, in order. */
  events: PublicEvent[];
  /** Each started event's published vibe, by id. */
  vibes: Record<string, Vibe>;
  /** The current moment. */
  now: Date;
  /** Opens the event page. */
  onPress: (id: string) => void;
  /** false under Reduce Motion (no scaling, parallax or pulse). */
  animate: boolean;
}

/**
 * Renders the sideways carousel.
 *
 * The screen gives it a new `key` for each freshly loaded list, so a
 * reload starts a new carousel: back at the first card, with `settled`
 * at 0 again (no stray tick on the first swipe after a reload).
 *
 * @returns a horizontal list that snaps card by card, the current card in
 *   the middle of the screen, with a light "tick" each time it settles on a
 *   new card.
 */
export function TonightCarousel({ events, vibes, now, onPress, animate }: TonightCarouselProps) {
  const { width } = useWindowDimensions();
  // The space before the first card and after the last one, so that every
  // card can stop in the middle of the screen.
  const sideInset = Math.max(spacing.gutter, (width - CAROUSEL_CARD_WIDTH) / 2);
  // The sideways scroll position, followed on the UI thread.
  const [scrollX] = useState(() => new Animated.Value(0));
  // The card the carousel last settled on (for the "tick" on a new one).
  const [settled, setSettled] = useState(0);

  /**
   * The carousel stopped moving: if it stopped on a different card than
   * before, give the light selection tick (spec: never on plain scroll).
   *
   * @param event - the scroll event with the final position.
   */
  const onSettle = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const index = Math.round(event.nativeEvent.contentOffset.x / CAROUSEL_STEP);
      if (index !== settled) {
        setSettled(index);
        tapSelection();
      }
    },
    [settled],
  );

  const total = events.length;
  /**
   * Draws one carousel card. Kept steady with useCallback, and the card
   * gets only plain values (no new objects), so ArtCard's memo check can
   * skip the cards that look the same after a minute tick or vibe refresh.
   */
  const renderItem = useCallback<ListRenderItem<PublicEvent>>(
    ({ item, index }) => (
      <ArtCard
        event={item}
        vibe={vibes[item.id]}
        now={now}
        onPress={onPress}
        animate={animate}
        variant="carousel"
        index={index}
        total={total}
        scrollX={scrollX}
      />
    ),
    [vibes, now, onPress, animate, total, scrollX],
  );

  return (
    <Animated.FlatList
      testID="tonight-carousel"
      horizontal
      data={events}
      keyExtractor={eventKey}
      renderItem={renderItem}
      ItemSeparatorComponent={CarouselGap}
      showsHorizontalScrollIndicator={false}
      // Snap one card at a time; "fast" makes a flick stop at the next card.
      snapToInterval={CAROUSEL_STEP}
      snapToAlignment="start"
      decelerationRate="fast"
      contentContainerStyle={{ paddingHorizontal: sideInset, paddingVertical: spacing.gap10 }}
      onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
        useNativeDriver: true,
      })}
      scrollEventThrottle={16}
      onMomentumScrollEnd={onSettle}
    />
  );
}

/**
 * A carousel card's list key: its event id (one steady function, so it is
 * not rebuilt on every draw).
 *
 * @param event - the event.
 * @returns its id.
 */
function eventKey(event: PublicEvent): string {
  return event.id;
}

/**
 * The 12 px space between carousel cards.
 *
 * @returns an empty spacer view.
 */
function CarouselGap() {
  return <View style={styles.carouselGap} />;
}

/** Styles built only from theme tokens (sizes from the VC-80 spec and mock). */
const styles = StyleSheet.create({
  hero: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  // VC-77: the gold edge for a live Hot or Fire party.
  goldEdge: { borderColor: colors.goldBorder },
  pressed: { backgroundColor: colors.surfaceRaised },
  heroArt: { height: HERO_ART_HEIGHT, justifyContent: 'flex-end', overflow: 'hidden' },
  pillSpot: { position: 'absolute', top: spacing.gap12, left: spacing.gap12 },
  pillSpotSmall: { position: 'absolute', top: spacing.gap10, left: spacing.gap10 },
  // The name over the art: Bricolage 800, 28/32 (mock).
  heroTitle: {
    fontFamily: fonts.display,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.8,
    color: colors.text,
    paddingHorizontal: 18,
    paddingBottom: spacing.gap12,
  },
  heroInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.gap12,
    paddingTop: spacing.gap12,
    paddingBottom: spacing.md,
    paddingHorizontal: 18,
  },
  infoText: { flex: 1, gap: 6 },
  meta: { ...typography.caption, color: colors.muted },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  countdown: { alignItems: 'flex-end' },
  countdownWord: { ...typography.label, color: colors.muted },
  countdownTime: { fontFamily: fonts.bodyBold, fontSize: 16, lineHeight: 20, color: colors.accent },
  countdownInline: { fontFamily: fonts.bodySemi, fontSize: 13, lineHeight: 18, color: colors.text },
  // A carousel card's slot: a fixed width (the wide card fills the row).
  carouselSlot: { width: CAROUSEL_CARD_WIDTH },
  artCard: {
    minHeight: CAROUSEL_CARD_MIN_HEIGHT,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  artBand: { height: ART_CARD_ART_HEIGHT, overflow: 'hidden' },
  artBleed: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: -PARALLAX_PX,
    right: -PARALLAX_PX,
  },
  artText: { paddingTop: spacing.gap12, paddingBottom: 14, paddingHorizontal: 14, gap: 6 },
  // Card names: Bricolage 600, 21/24 (mock).
  artTitle: {
    fontFamily: fonts.displaySemi,
    fontSize: 21,
    lineHeight: 24,
    letterSpacing: -0.6,
    color: colors.text,
  },
  carouselGap: { width: CAROUSEL_GAP },
});
