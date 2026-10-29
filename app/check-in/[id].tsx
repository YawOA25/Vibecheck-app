/**
 * Check-in screen (task VC-B06), in the v3 look (design/v3/Checkin.dc.html,
 * wireframe S4).
 *
 * Address: /check-in/<event id>. Opened by "I'm here" on the event page.
 *
 * How it looks (Q7, polish audit fix #7): a bottom sheet that slides up
 * over the event page, which stays visible behind a dimmed layer (the
 * "scrim"). The root layout opens this screen as a see-through modal
 * (app/_layout.tsx). The slide is skipped when the phone's Reduce Motion
 * setting is on. Tapping the dimmed area, or the round Close button,
 * closes the sheet (both do what Back did before).
 *
 * Screen readers: the sheet is marked as a dialog ("Check in"), iPhone's
 * VoiceOver is kept inside it (accessibilityViewIsModal), and when it opens
 * (or shows a result) the reader's focus moves to its title.
 *
 * What happens, step by step:
 *   1. Load the event's public facts (name and neighbourhood) to ask
 *      "You at <event>?". Under the question, a 150 px "pin panel" shows a
 *      gold pin icon, and under it the AREA label only (e.g. "Navy Yard,
 *      DC"). Never a map, coordinates or an address: the app can't read
 *      them (they live in event_private, VC-20). The v3 mockup shows a map
 *      and a street address; both are left out on purpose.
 *   2. On "Yep, I'm here": ask for location permission if needed, take ONE
 *      foreground reading (src/lib/check-in-location.ts) and send it to the
 *      server's check_in function (src/lib/check-in-api.ts).
 *   3. Show the result: passed, too far, weak signal (offers the party code),
 *      too early or too late, a limit reached, GPS switched off for this
 *      event after 5 "too far" answers (VC-36), or a permission problem.
 *      All wording lives in src/lib/check-in-screens.ts.
 *
 * Privacy: the reading is passed straight from step 2's reader to the
 * server call. It is never put in screen state, shown, or logged.
 *
 * The party code (task VC-B07): "GPS not working? Enter the party code"
 * under the main button, and "Enter the party code" on the weak-signal and
 * permission screens, open the code screen (app/join/[id].tsx) in place of
 * this sheet (Q7), so Back from it returns to the event page.
 *
 * After a successful check-in, "Rate the night" opens the rating screen
 * (app/rate/[id].tsx, task VC-B08) in place of this one, so Back from the
 * rating returns to the event page.
 *
 * Closing (VC-76, design/vc76-motion-spec.md 1 and 3c): the sheet now
 * slides back DOWN over 220 ms while the dimmed layer fades, and only then
 * does the screen close (before, it only faded out). The same slide runs
 * before the party code or the rating replaces the sheet, and for
 * Android's back button. The sheet can also be dragged down by its grab
 * handle or header: it follows the finger, the dimmed layer fades with it,
 * and letting go past about a third of the sheet (or with a quick flick)
 * closes it; otherwise it springs back. While a check-in is being sent,
 * closing is blocked, as the Close button already was.
 * Q8a: while sending, a drag let go far down springs back to fully open
 * (before, it could rest part-way down), and Android's back button, or any
 * other attempt to remove the screen, is ignored until the answer lands.
 * Q8b: the server call gives up after 15 seconds (weak venue Wi-Fi), so
 * that block can't last longer: the sheet then shows "Signal's weak, try
 * again" with a warning buzz, and Back and Close work again.
 * Reduce Motion: no slide in or out (the screen just fades, as built). The
 * drag still works, because the finger moves it, but letting go closes or
 * snaps back at once with no spring.
 */
import { useLocalSearchParams, usePreventRemove, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  BackHandler,
  Linking,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import type { HostInstance, LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { CircleIconButton } from '@/components/CircleIconButton';
import { FadeIn } from '@/components/FadeIn';
import { FormMessage } from '@/components/FormMessage';
import { Headline } from '@/components/Headline';
import { Icon } from '@/components/Icon';
import { submitCheckIn } from '@/lib/check-in-api';
import { readLocationForCheckIn } from '@/lib/check-in-location';
import { resultScreen } from '@/lib/check-in-screens';
import type { CheckInAction, CheckInView } from '@/lib/check-in-screens';
import { getEvent } from '@/lib/events-read';
import { tapSuccess, tapWarning } from '@/lib/haptics';
import { motionAllowed, useReduceMotion } from '@/lib/reduce-motion';
import { useDelayedFlag } from '@/lib/use-delayed-flag';
import type { PublicEvent } from '@/lib/tonight';
import { colors, iconSize, motion, radius, spacing, typography } from '@/theme';

/** The words on this screen (exported so tests use the same text). */
export const CHECK_IN_LABEL = 'CHECK IN';
export const CHECKED_IN_LABEL = 'CHECKED IN';
export const PRIVACY_NOTE =
  'Quick location check, just once. We never track you or save where you are.';
export const IM_HERE = "Yep, I'm here";
export const NOT_THIS_ONE = 'Not this one';
export const GPS_NOT_WORKING = 'GPS not working? Enter the party code';
export const CHECKING = 'Checking...';
export const NOT_FOUND_TITLE = 'Event not found';
/** What screen readers call the sheet (the dialog's name). */
export const SHEET_LABEL = 'Check in';
/** The round button that closes the sheet. */
export const CLOSE_LABEL = 'Close';

/** How long the sheet takes to slide up, in milliseconds (skipped under Reduce Motion). */
export const SHEET_SLIDE_MS = motion.sheetIn.duration;
/** How long the sheet takes to slide down when closing (VC-76). */
export const SHEET_CLOSE_MS = motion.sheetOut.duration;
/** Dragging the sheet down further than this share of its height closes it (VC-76). */
export const DRAG_CLOSE_SHARE = 0.3;
/** A flick faster than this (points per millisecond) closes it too, however short. */
export const DRAG_CLOSE_SPEED = 1;

/**
 * Whether letting go of a drag should close the sheet (VC-76, spec 3c).
 *
 * @param dy - how far the finger moved down, in points (up is negative).
 * @param vy - the finger's downward speed when let go (points per ms).
 * @param sheetHeight - the sheet's height in points.
 * @returns true past 30% of the sheet's height or on a fast downward flick.
 */
export function shouldCloseOnRelease(dy: number, vy: number, sheetHeight: number): boolean {
  return dy > sheetHeight * DRAG_CLOSE_SHARE || vy > DRAG_CLOSE_SPEED;
}
/**
 * Puts the sheet back to fully open after a drag that doesn't close it:
 * a short spring, or (under Reduce Motion) a snap with no movement.
 *
 * Why it exists (Q8a): the same "back into place" is needed both for a
 * short drag and for a long drag let go while a check-in is being sent
 * (closing is blocked then, so the sheet must not rest part-way down).
 *
 * @param slide - the sheet's "how far down" value.
 * @param reduceMotion - the phone's Reduce Motion answer (null = not known yet).
 */
function settleSheetOpen(slide: Animated.Value, reduceMotion: boolean | null) {
  if (motionAllowed(reduceMotion)) {
    Animated.spring(slide, {
      toValue: 0,
      speed: motion.releaseSpring.speed,
      bounciness: motion.releaseSpring.bounciness,
      useNativeDriver: true,
    }).start();
  } else {
    slide.setValue(0);
  }
}

/** Height of the pin panel (v3: 150 px). */
export const PIN_PANEL_HEIGHT = 150;
/** Size of the gold pin in the pin panel (v3: 34 px). */
const PIN_ICON_SIZE = 34;
/**
 * A short wait before moving the screen reader to the sheet's title. The
 * phone's own "a new screen opened" focus lands first; moving after it
 * makes sure ours wins.
 */
export const FOCUS_DELAY_MS = 300;

/** What the screen is showing. */
type Phase =
  | { kind: 'loading' }
  | { kind: 'loadError'; message: string }
  | { kind: 'notFound' }
  /** "You at <event>?" with the button (busy while checking). */
  | { kind: 'confirm'; event: PublicEvent; checking: boolean }
  /** A result screen (see check-in-screens.ts). */
  | { kind: 'result'; event: PublicEvent; view: CheckInView }
  /** The server call failed (network, bad reading...). */
  | { kind: 'error'; event: PublicEvent; message: string };

/**
 * Renders the check-in screen.
 *
 * Returns: the screen's view. Its input is the `id` in the address.
 */
export default function CheckInScreen() {
  const router = useRouter();
  // The id from /check-in/<id>; expo-router may hand over a list, so take the first.
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  // Bumped by "Try again" after a load error, to load once more.
  const [loadAttempt, setLoadAttempt] = useState(0);

  // Load the event's public facts. State is only set when the answer
  // arrives, and a late answer is ignored if the screen has closed.
  useEffect(() => {
    let active = true;
    const load = id ? getEvent(id) : Promise.resolve({ ok: true as const, event: null });
    load.then((outcome) => {
      if (!active) return;
      if (!outcome.ok) setPhase({ kind: 'loadError', message: outcome.message });
      else if (!outcome.event) setPhase({ kind: 'notFound' });
      else setPhase({ kind: 'confirm', event: outcome.event, checking: false });
    });
    return () => {
      active = false;
    };
  }, [id, loadAttempt]);

  /** Back to the event page, or home if there's no history (no animation here). */
  const goBackNow = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  // --- The slide up and down (Q7, VC-76) ------------------------------------
  const reduceMotion = useReduceMotion();
  const { height: windowHeight } = useWindowDimensions();
  // How far below its resting place the sheet is (0 = in place). It starts
  // a full screen down, i.e. out of sight. Kept in state so it's made once.
  const [slide] = useState(() => new Animated.Value(windowHeight));
  // The sheet's measured height (until measured: the screen's height).
  const [sheetHeight, setSheetHeight] = useState(windowHeight);
  // True once closing has started, so a second tap can't close twice, and
  // nothing new (a check-in, the party code) can start while the sheet
  // slides away (cto review of VC-76). The ref answers at once inside
  // callbacks; the state makes the sheet ignore touches on screen.
  const closing = useRef(false);
  const [isClosing, setIsClosing] = useState(false);
  // True from the moment "Yep, I'm here" is tapped until the answer is on
  // screen (Q8a). The `checking` state below says the same, but only after
  // the next redraw; this ref answers at once, so a Back press in that tiny
  // gap is still ignored.
  const sending = useRef(false);

  /**
   * Closes the sheet: slides it down while the dimmed layer fades (VC-76),
   * then runs `then` (go back, or open the party code or the rating).
   * Under Reduce Motion (or before the phone answers) `then` runs at once.
   *
   * @param then - what to do once the sheet is out of sight.
   */
  const closeSheet = useCallback(
    (then: () => void) => {
      if (closing.current) return;
      closing.current = true;
      setIsClosing(true);
      // Once `then` has run the screen is normally gone; the flags are
      // cleared anyway in case it stays (e.g. going back was refused).
      const finish = () => {
        then();
        closing.current = false;
        setIsClosing(false);
      };
      if (!motionAllowed(reduceMotion)) {
        finish();
        return;
      }
      Animated.timing(slide, {
        toValue: sheetHeight,
        duration: SHEET_CLOSE_MS,
        easing: motion.sheetOut.easing,
        useNativeDriver: true,
      }).start(() => finish());
    },
    [reduceMotion, slide, sheetHeight],
  );

  /** Close, Not this one, a tap on the dimmed area: slide down, then back. */
  const goBack = useCallback(() => closeSheet(goBackNow), [closeSheet, goBackNow]);

  /**
   * "Yep, I'm here" (and "Try again"): read the location once, send it,
   * show the result.
   *
   * @param event - the event being checked in to.
   */
  const runCheckIn = useCallback(async (event: PublicEvent) => {
    // The sheet is sliding away: never start a check-in whose answer would
    // land on a closed screen (cto review of VC-76).
    if (closing.current) return;
    sending.current = true;
    setPhase({ kind: 'confirm', event, checking: true });
    try {
      const reading = await readLocationForCheckIn();
      if (reading.kind !== 'reading') {
        // A phone-side problem (permission, approximate, no fix): nothing was
        // sent to the server.
        setPhase({ kind: 'result', event, view: { source: 'phone', kind: reading.kind } });
        return;
      }
      // The reading goes straight into the request and is then forgotten.
      const outcome = await submitCheckIn(event.id, reading.reading);
      if (outcome.ok) {
        // The phone's "success" buzz when the check-in passed (VC-32d).
        if (outcome.result.status === 'passed') tapSuccess();
        setPhase({ kind: 'result', event, view: { source: 'server', result: outcome.result } });
      } else if (outcome.kind === 'notFound') {
        setPhase({ kind: 'notFound' });
      } else {
        // Q8b: no answer in 15 seconds ("Signal's weak, try again"). The
        // warning buzz tells the guest to look; "Try again" asks the server
        // again, and if the first try landed late it answers "already
        // checked in", never a second check-in.
        if (outcome.kind === 'timeout') tapWarning();
        setPhase({ kind: 'error', event, message: outcome.message });
      }
    } finally {
      // Whatever happened, the send is over: Back works again.
      sending.current = false;
    }
  }, []);

  /**
   * Carries out a result-screen button.
   *
   * @param action - which button was tapped.
   * @param event - the event on screen.
   */
  const onAction = useCallback(
    (action: CheckInAction, event: PublicEvent) => {
      // Ignore buttons tapped while the sheet slides away (VC-76).
      if (closing.current) return;
      switch (action) {
        case 'retry':
          void runCheckIn(event);
          break;
        case 'settings':
          // Opens VibeCheck's page in the phone's Settings (the location switch).
          Linking.openSettings().catch(() => {});
          break;
        case 'code':
          // replace, not push (cto, Q7): this sheet is a see-through modal,
          // and on iPhone a normal screen pushed from a modal slides in
          // UNDER it, so the guest would see nothing. Replacing the sheet
          // also means Back from the party code returns to the event page.
          // VC-76: the sheet slides away first, then the new screen rises.
          closeSheet(() => router.replace({ pathname: '/join/[id]', params: { id: event.id } }));
          break;
        case 'rate':
          closeSheet(() => router.replace({ pathname: '/rate/[id]', params: { id: event.id } }));
          break;
        case 'back':
          goBack();
          break;
      }
    },
    [goBack, closeSheet, router, runCheckIn],
  );

  const checking = phase.kind === 'confirm' && phase.checking;
  // VC-76: the spinner only after 300 ms of loading (no flash on fast loads).
  const showSpinner = useDelayedFlag(phase.kind === 'loading');

  useEffect(() => {
    // Wait until the phone says whether Reduce Motion is on (null = not yet).
    if (reduceMotion === null) return;
    if (motionAllowed(reduceMotion)) {
      // Glide up, slowing down at the end, like the phone's own sheets.
      Animated.timing(slide, {
        toValue: 0,
        duration: SHEET_SLIDE_MS,
        easing: motion.sheetIn.easing,
        useNativeDriver: true,
      }).start();
    } else {
      // Reduce Motion: just appear in place, no movement.
      slide.setValue(0);
    }
  }, [reduceMotion, slide]);

  // VC-76: Android's back button runs the same slide-down (and is ignored
  // while a check-in is being sent, like Close). Returning true tells
  // Android we handled it, so it doesn't close the screen by itself.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      // Q8a: also check the `sending` ref, which is set the instant the
      // check-in starts (the `checking` state lags by one redraw).
      if (!checking && !sending.current) goBack();
      return true;
    });
    return () => subscription.remove();
  }, [checking, goBack]);

  // Q8a: a second guard for the same rule. While a check-in is being sent,
  // the navigator refuses to remove this screen by ANY route (a back press
  // that reaches it first, a back gesture, a stray router.back()). The
  // blocked attempt is simply dropped: the guest can close once the answer
  // shows.
  usePreventRemove(checking, () => {});

  // --- Drag to close (VC-76, spec 3c option A) ------------------------------
  // A drag let go far enough asks for a close by bumping this counter; the
  // effect below then runs the normal slide-down close. (The drag handler is
  // built while drawing, where the lint rules don't allow it to hold the
  // close function directly.)
  const [dragCloses, setDragCloses] = useState(0);
  const handledDragCloses = useRef(0);
  useEffect(() => {
    if (dragCloses <= handledDragCloses.current) return;
    handledDragCloses.current = dragCloses;
    // Never close while a check-in is being sent (as Close is disabled
    // then); the request is simply dropped, not saved for later, and the
    // sheet goes back to fully open rather than resting part-way (Q8a).
    if (checking || sending.current) {
      settleSheetOpen(slide, reduceMotion);
      return;
    }
    goBack();
  }, [dragCloses, goBack, checking, slide, reduceMotion]);
  // The drag handler is rebuilt only when one of the values it uses changes
  // (they don't change during a drag).
  const drag = useMemo(
    () =>
      PanResponder.create({
        // Take over only for a clearly downward drag (not a tap, not
        // sideways), and never while a check-in is being sent.
        onMoveShouldSetPanResponder: (_e, g) => !checking && g.dy > 5 && g.dy > Math.abs(g.dx),
        // Follow the finger downwards only (dragging up does nothing).
        onPanResponderMove: (_e, g) => slide.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_e, g) => {
          // Far enough AND nothing being sent: ask for a close. Otherwise
          // (not far enough, or a check-in is being sent, Q8a) the sheet
          // springs back to fully open, or snaps back under Reduce Motion.
          if (!checking && shouldCloseOnRelease(g.dy, g.vy, sheetHeight)) {
            setDragCloses((n) => n + 1);
          } else {
            settleSheetOpen(slide, reduceMotion);
          }
        },
        // Another touch took over: put the sheet back.
        onPanResponderTerminate: () => slide.setValue(0),
      }),
    [checking, sheetHeight, reduceMotion, slide],
  );

  // The dimmed layer fades as the sheet goes down (fully dim when in place,
  // clear when out of sight), for the slide-in, the drag and the slide-out.
  const scrimOpacity = slide.interpolate({
    inputRange: [0, Math.max(1, sheetHeight)],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  /**
   * Remembers the sheet's height, for the drag and the slide-down.
   *
   * @param event - the sheet's layout event.
   */
  function measureSheet(event: LayoutChangeEvent) {
    setSheetHeight(event.nativeEvent.layout.height);
  }

  // --- Screen-reader focus (Q7) --------------------------------------------
  // The sheet's current title (the "You at ...?" question, a result's
  // headline, or the small label on the other states).
  const titleRef = useRef<HostInstance>(null);
  useEffect(() => {
    // Nothing to announce while loading; the spinner has its own label.
    if (phase.kind === 'loading') return;
    // Each time the sheet shows something new (the question, a result, an
    // error), move the reader to its title so they hear it first.
    const timer = setTimeout(() => {
      if (titleRef.current) AccessibilityInfo.sendAccessibilityEvent(titleRef.current, 'focus');
    }, FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [phase.kind]);

  // The small label at the top of the sheet: "CHECKED IN" (green) after a
  // passed check-in, "CHECK IN" otherwise.
  const success = phase.kind === 'result' && resultScreen(phase.view, phase.event.title).success;
  // On the states without a big headline (loading, a load error, a failed
  // send), that small label is the sheet's title.
  const labelIsTitle =
    phase.kind === 'loading' || phase.kind === 'loadError' || phase.kind === 'error';

  return (
    <View style={styles.root}>
      {/* The dimmed event page: a tap here closes the sheet, like Close.
          Screen readers skip it (they use the Close button instead), and it
          ignores taps while a check-in is being sent, as Close does. */}
      <Animated.View
        style={[styles.scrimLayer, { opacity: scrimOpacity }]}
        testID="check-in-scrim-fade"
      >
        <Pressable
          testID="check-in-scrim"
          style={styles.scrim}
          onPress={checking ? undefined : goBack}
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      </Animated.View>

      {/* The sheet itself. role "dialog" + aria-modal tell screen readers
          it's a dialog; accessibilityViewIsModal keeps iPhone's VoiceOver
          inside it (so it can't wander onto the dimmed page). */}
      <Animated.View
        testID="check-in-sheet"
        role="dialog"
        aria-modal
        accessibilityViewIsModal
        accessibilityLabel={SHEET_LABEL}
        style={[styles.sheetFrame, { transform: [{ translateY: slide }] }]}
        onLayout={measureSheet}
        // VC-76 (cto): while sliding away, the sheet ignores every touch.
        pointerEvents={isClosing ? 'none' : 'auto'}
      >
        {/* Scrolls if the phone's text is very large. */}
        <ScrollView bounces={false} style={styles.sheetScroll}>
          {/* Adds the phone's home-bar space at the bottom, but at least 32 px. */}
          <SafeAreaView edges={{ bottom: 'maximum' }} style={styles.sheet}>
            {/* VC-76: the grab handle and header are where a drag starts. */}
            <View {...drag.panHandlers} testID="check-in-drag-area" style={styles.dragArea}>
              <View style={styles.handle} testID="check-in-handle" />
              <View style={styles.headerRow}>
                <Text
                  ref={labelIsTitle ? titleRef : undefined}
                  accessibilityRole={labelIsTitle ? 'header' : undefined}
                  style={[styles.label, success && styles.successLabel]}
                >
                  {success ? CHECKED_IN_LABEL : CHECK_IN_LABEL}
                </Text>
                <CircleIconButton
                  icon="close"
                  label={CLOSE_LABEL}
                  onPress={goBack}
                  disabled={checking}
                  iconPx={iconSize.sm}
                />
              </View>
            </View>

            {/* VC-76: each new step (question, result, error) fades in. */}
            <FadeIn fadeKey={phase.kind} style={styles.phase}>
              {phase.kind === 'loading' ? (
                <View style={styles.centre} accessible accessibilityLabel="Loading the event">
                  {showSpinner ? <ActivityIndicator color={colors.accent} size="large" /> : null}
                </View>
              ) : null}

              {phase.kind === 'loadError' ? (
                <View style={styles.centre}>
                  <FormMessage message={phase.message} />
                  <Button
                    label="Try again"
                    variant="outline"
                    onPress={() => {
                      setPhase({ kind: 'loading' });
                      setLoadAttempt((n) => n + 1);
                    }}
                  />
                </View>
              ) : null}

              {phase.kind === 'notFound' ? (
                <View style={styles.centre}>
                  <Text ref={titleRef} style={styles.notFoundTitle} accessibilityRole="header">
                    {NOT_FOUND_TITLE}
                  </Text>
                  <Text style={styles.muted}>It may have been removed, or the link is wrong.</Text>
                </View>
              ) : null}

              {phase.kind === 'confirm' ? (
                <>
                  <Headline ref={titleRef} lead="You at" highlight={`${phase.event.title}?`} />
                  <PinPanel />
                  {/* The AREA label only (VC-20): never an address or a map. */}
                  <Text style={styles.muted} testID="check-in-area">
                    {phase.event.area_label}
                  </Text>
                  <View style={styles.note}>
                    {/* A small gold shield (v3): "your privacy is protected".
                      Decoration only: screen readers read the note. */}
                    <View style={styles.noteIcon}>
                      <Icon name="shield" size={iconSize.sm} color={colors.accent} />
                    </View>
                    <Text style={styles.noteText}>{PRIVACY_NOTE}</Text>
                  </View>
                  <Button
                    label={IM_HERE}
                    busy={phase.checking}
                    busyLabel={CHECKING}
                    onPress={() => void runCheckIn(phase.event)}
                  />
                  {/* The indoor fallback, offered up front as well as after a weak signal. */}
                  <Button
                    label={GPS_NOT_WORKING}
                    variant="text"
                    size="small"
                    onPress={() => onAction('code', phase.event)}
                    disabled={phase.checking}
                  />
                  <Button
                    label={NOT_THIS_ONE}
                    variant="text"
                    onPress={goBack}
                    disabled={phase.checking}
                  />
                </>
              ) : null}

              {phase.kind === 'result' ? (
                <ResultContent
                  view={phase.view}
                  event={phase.event}
                  titleRef={titleRef}
                  onAction={(action) => onAction(action, phase.event)}
                />
              ) : null}

              {phase.kind === 'error' ? (
                <>
                  <FormMessage message={phase.message} />
                  <Button label="Try again" onPress={() => void runCheckIn(phase.event)} />
                  <Button label="Back to the event" variant="text" onPress={goBack} />
                </>
              ) : null}
            </FadeIn>
          </SafeAreaView>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

/**
 * The pin panel (v3, Q7): a 150 px recessed box with a gold map pin in the
 * middle. It is a picture of "a place", NOT a map: no map tile, no
 * coordinates, no address, no text at all. The area label sits under it.
 *
 * @returns the panel, hidden from screen readers (the area text under it
 *   says the same thing in words).
 */
function PinPanel() {
  return (
    <View
      style={styles.pinPanel}
      testID="check-in-pin-panel"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Icon name="pin" size={PIN_ICON_SIZE} color={colors.accent} />
    </View>
  );
}

/**
 * One result: headline, sentence and buttons, inside the sheet.
 *
 * @param props.view - what happened.
 * @param props.event - the event (its name goes in the sentence).
 * @param props.titleRef - gets the headline, so the screen reader can be
 *   moved to it.
 * @param props.onAction - called with the tapped button's action.
 * @returns the result's parts.
 */
function ResultContent({
  view,
  event,
  titleRef,
  onAction,
}: {
  view: CheckInView;
  event: PublicEvent;
  titleRef: RefObject<HostInstance | null>;
  onAction: (action: CheckInAction) => void;
}) {
  const content = resultScreen(view, event.title);
  const last = content.actions.length - 1;
  return (
    <>
      <Headline ref={titleRef} lead={content.lead} highlight={content.highlight} />
      {/* Read aloud when it appears, so screen-reader users hear the result. */}
      <Text style={styles.body} accessibilityLiveRegion="polite">
        {content.body}
      </Text>
      {content.actions.map((button, index) => (
        <Button
          key={button.action}
          label={button.label}
          // The first button is the main (gold) one; the last of several is
          // a quiet text link; any in between are outlined.
          variant={index === 0 ? 'primary' : index === last ? 'text' : 'outline'}
          onPress={() => onAction(button.action)}
        />
      ))}
    </>
  );
}

/** Styles built from theme tokens (plus the v3 sheet's 28 px corners and 20 px sides). */
const styles = StyleSheet.create({
  // See-through, so the event page shows behind; the sheet sits at the bottom.
  root: { flex: 1, justifyContent: 'flex-end' },
  // The dimmed layer over the event page (the theme's 60% black scrim).
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: colors.scrim },
  // The fading wrapper around the dimmed layer (VC-76).
  scrimLayer: { ...StyleSheet.absoluteFill },
  // The handle and header together, keeping the sheet's 16 px gap (VC-76).
  dragArea: { gap: spacing.md },
  // A step's parts keep the sheet's 16 px gap inside the fade wrapper.
  phase: { gap: spacing.md },
  sheetFrame: {
    // Leaves a strip of the dimmed page visible even with very large text.
    maxHeight: '92%',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.borderStrong,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
  },
  // flexGrow 0: the sheet is only as tall as its content (up to maxHeight).
  sheetScroll: { flexGrow: 0 },
  sheet: {
    paddingHorizontal: 20,
    paddingTop: spacing.gap12,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.handle,
    alignSelf: 'center',
  },
  // The label on the left, Close on the right.
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.gap12,
  },
  centre: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  notFoundTitle: { ...typography.h1, color: colors.text, textAlign: 'center' },
  muted: { ...typography.bodySm, color: colors.muted },
  body: { ...typography.body, color: colors.muted },
  label: { ...typography.label, color: colors.muted, flexShrink: 1 },
  successLabel: { color: colors.success },
  // v3 pin panel: 150 px, recessed fill, thin edge, 18 px corners.
  pinPanel: {
    height: PIN_PANEL_HEIGHT,
    borderRadius: 18,
    backgroundColor: colors.surfaceSunken,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: {
    flexDirection: 'row',
    gap: spacing.gap12,
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.field,
    paddingVertical: spacing.gap12,
    paddingHorizontal: 14,
  },
  // Nudged down 1 px to line up with the note's first line.
  noteIcon: { marginTop: 1 },
  noteText: { ...typography.caption, color: colors.muted, flex: 1 },
});
