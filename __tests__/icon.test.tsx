/**
 * Tests for the Q4 line icons (src/components/Icon.tsx) and the places that
 * swapped a text character for one.
 *
 * What it proves:
 *   - there are exactly the 15 icons of the spec, and each one draws;
 *   - every icon is hidden from screen readers (it's decoration), on both
 *     iPhone (accessibilityElementsHidden) and Android
 *     (importantForAccessibility), and is never "accessible" by itself;
 *   - colour, size and line thickness follow the props and theme;
 *   - the buttons and messages that use icons are still read by their
 *     words: "Back", the FormMessage sentence, a picked chip's "selected";
 *   - the old text icons ("‹", "!", "✓", "◈") are gone.
 *
 * Lesson from VC-52: parts under accessibilityElementsHidden are only found
 * with `includeHiddenElements: true`, and colours arrive as processColor
 * numbers.
 */
import { render, screen } from '@testing-library/react-native';
import { processColor } from 'react-native';

import { BackButton } from '@/components/BackButton';
import { ChoiceChip } from '@/components/ChoiceChip';
import { FormMessage } from '@/components/FormMessage';
import { ICON_NAMES, Icon } from '@/components/Icon';
import { colors, iconStroke } from '@/theme';

/** Finds the drawn icon (hidden from screen readers) by its test id. */
function getIcon(testID: string) {
  return screen.getByTestId(testID, { includeHiddenElements: true });
}

describe('Icon', () => {
  it('has exactly the 15 icons of the Q4 spec (VC-82 swapped clipboard and plus-circle for house and plus)', () => {
    expect(ICON_NAMES).toHaveLength(15);
    expect([...ICON_NAMES].sort()).toEqual(
      [
        'alert',
        'check',
        'chevron-left',
        'chevron-right',
        'close',
        'flag',
        'gear',
        'house',
        'info',
        'moon',
        'person',
        'pin',
        'plus',
        'share',
        'shield',
      ].sort(),
    );
  });

  it.each(ICON_NAMES)('draws "%s", hidden from screen readers', async (name) => {
    await render(<Icon name={name} testID="icon" />);
    const icon = getIcon('icon');
    expect(icon.props.accessible).toBe(false);
    expect(icon.props.accessibilityElementsHidden).toBe(true);
    expect(icon.props.importantForAccessibility).toBe('no-hide-descendants');
    // Not findable the normal way, i.e. the way a screen reader looks.
    expect(screen.queryByTestId('icon')).toBeNull();
  });

  it('uses 20 px and the main text colour by default', async () => {
    await render(<Icon name="gear" testID="icon" />);
    const icon = getIcon('icon');
    // react-native-svg passes the size on as bbWidth (older versions: width).
    expect(icon.props.bbWidth ?? icon.props.width).toBe(20);
    // The colour is handed down to the shapes as the stroke.
    const json = JSON.stringify(screen.toJSON());
    expect(json).toContain(String(processColor(colors.text)));
  });

  it('follows the size and colour it is given, with a thicker line at 16 px', async () => {
    await render(<Icon name="alert" size={16} color={colors.error} testID="icon" />);
    const json = JSON.stringify(screen.toJSON());
    expect(json).toContain(String(processColor(colors.error)));
    expect(json).toContain(`"strokeWidth":${iconStroke.small}`);
    await screen.unmount();

    await render(<Icon name="alert" size={20} testID="icon" />);
    expect(JSON.stringify(screen.toJSON())).toContain(`"strokeWidth":${iconStroke.regular}`);
  });
});

describe('components that use icons are read by their words', () => {
  it('reads the back button as "Back", with no "‹" character', async () => {
    await render(<BackButton onPress={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Back' })).toBeOnTheScreen();
    expect(screen.queryByText('‹', { includeHiddenElements: true })).toBeNull();
  });

  it('reads an error as its sentence, with the alert icon instead of "!"', async () => {
    await render(<FormMessage message="That code didn't work." />);
    expect(screen.getByRole('alert', { name: "That code didn't work." })).toBeOnTheScreen();
    expect(screen.queryByText('!', { includeHiddenElements: true })).toBeNull();
  });

  it('reads a confirmation as its sentence, with the check icon instead of "✓"', async () => {
    await render(<FormMessage message="New code sent." tone="success" />);
    expect(screen.getByText('New code sent.')).toBeOnTheScreen();
    expect(screen.queryByText('✓', { includeHiddenElements: true })).toBeNull();
    expect(JSON.stringify(screen.toJSON())).toContain(String(processColor(colors.success)));
  });

  it('marks a picked chip "selected" and keeps its words clean', async () => {
    await render(<ChoiceChip label="Packed" selected onPress={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Packed', selected: true })).toBeOnTheScreen();
    // The words are just the label; the tick is a separate, hidden icon.
    expect(screen.getByText('Packed')).toBeOnTheScreen();
    expect(screen.queryByText(/✓/, { includeHiddenElements: true })).toBeNull();
  });

  it('shows no tick on a chip that is not picked', async () => {
    await render(<ChoiceChip label="Chill" selected={false} onPress={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Chill', selected: false })).toBeOnTheScreen();
    expect(JSON.stringify(screen.toJSON())).not.toContain('RNSVG');
  });
});
