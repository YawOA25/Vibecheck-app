/**
 * Render test for the Tonight screen.
 *
 * React Native Testing Library draws the screen in memory (no phone needed) and
 * lets us look for text the way a user would see it. This proves the screen
 * renders without crashing and shows its title and note.
 */
import { render, screen } from '@testing-library/react-native';

import TonightScreen from '../app/index';

describe('TonightScreen', () => {
  it('shows the Tonight heading and the placeholder note', async () => {
    await render(<TonightScreen />);

    // getByRole finds the heading the same way a screen reader would.
    expect(screen.getByRole('header', { name: 'Tonight' })).toBeOnTheScreen();
    expect(screen.getByText('Parties near you will show up here.')).toBeOnTheScreen();
  });
});
