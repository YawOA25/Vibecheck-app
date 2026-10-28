/**
 * The round "Back" button from the v3 design: a 44 px dark circle with a
 * thin edge and a left-pointing chevron line icon (spec section 1, "Shape
 * and space"; the icon replaced a "‹" text character in Q4).
 *
 * Why its own component: it's on many screens, and it keeps the chevron and
 * the "Back" screen-reader label in one place. Since Q5 the circle itself
 * comes from CircleIconButton, so Back, Share and Close always match.
 */
import { CircleIconButton } from '@/components/CircleIconButton';

/** What a BackButton needs. */
export interface BackButtonProps {
  /** What happens on tap. */
  onPress: () => void;
  /** Ignores taps while true (for example while the server is busy). */
  disabled?: boolean;
}

/**
 * Renders the back button.
 *
 * @returns the button view, read by screen readers as "Back, button".
 */
export function BackButton({ onPress, disabled }: BackButtonProps) {
  return (
    <CircleIconButton icon="chevron-left" label="Back" onPress={onPress} disabled={disabled} />
  );
}
