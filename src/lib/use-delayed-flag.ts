/**
 * useDelayedFlag: "true, but only once it has stayed true for a while"
 * (VC-76, spec 2b "Delayed spinners").
 *
 * Why it exists: most loads finish in well under half a second. Showing a
 * spinner for those makes the screen flash (blank, spinner, content). With
 * this hook a screen shows its spinner only when loading takes longer than
 * 300 ms, so a fast load goes straight from blank to content.
 *
 * Reduce Motion: unchanged. Waiting before showing a spinner moves nothing.
 */
import { useEffect, useState } from 'react';

import { motion } from '@/theme';

/**
 * Follows `flag` with a delay on the way up (and none on the way down).
 *
 * @param flag - e.g. "is loading".
 * @param delayMs - how long `flag` must stay true first (default 300 ms,
 *   the spinnerDelay token).
 * @returns true once `flag` has been true for `delayMs`; false straight
 *   away when `flag` turns false.
 */
export function useDelayedFlag(flag: boolean, delayMs: number = motion.spinnerDelay): boolean {
  // Whether the wait has passed for the current stretch of `flag` being true.
  const [waited, setWaited] = useState(false);

  // `flag` went false: forget the old wait at once, so the next load waits
  // again. This is React's "adjust state when a value changes" pattern (set
  // during drawing), which avoids a frame showing an old spinner.
  if (!flag && waited) setWaited(false);

  useEffect(() => {
    if (!flag) return undefined;
    // State is only set inside the timer, never straight in the effect.
    const timer = setTimeout(() => setWaited(true), delayMs);
    return () => clearTimeout(timer);
  }, [flag, delayMs]);

  return flag && waited;
}
