/**
 * The two lines of copy for the State lookup on the admin event form
 * (VC-37 follow-up, founder decision 2026-10-27 "State becomes a lookup").
 *
 * Why one file: the founder is still choosing the final wording (options in
 * team/projects/vibecheck/research/state-helper-copy.md). Keeping both
 * strings here means the final pick is a one-line change, and no screen
 * holds its own copy.
 *
 * Rule: don't put the app's name in these lines; the name isn't final.
 */

/** Always shown under the State box: we only run in the DMV for now. */
export const STATE_HELP_LINE = 'DC, Maryland and Virginia only for now. More cities later.';

/**
 * Shown (as plain, non-tappable text) when what the admin typed matches no
 * state we support, for example "Texas" or "West Virginia".
 */
export const STATE_NOT_YET = "Not here yet. We're DC, Maryland and Virginia for now.";
