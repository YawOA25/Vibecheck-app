/**
 * Test helper: "picks" a date and time on the event form's Starts or Ends
 * field, the way an admin does on an iPhone (tap the field, spin the wheel,
 * tap Done).
 *
 * Why it lives outside __tests__: Jest treats every file in __tests__ as a
 * test file, and this is a helper shared by several of them. The fake picker
 * itself is in __mocks__/@react-native-community/datetimepicker.js.
 */
import { fireEvent, screen } from '@testing-library/react-native';

/**
 * Opens a date-and-time field, moves the wheel to a moment, and taps Done.
 *
 * @param label - the field's label: 'Starts' or 'Ends'.
 * @param moment - the moment to pick (a real point in time; the field shows
 *   it in New York time).
 * @returns nothing; resolves when the form has updated.
 */
export async function pickDateTime(label: 'Starts' | 'Ends', moment: Date): Promise<void> {
  await fireEvent.press(screen.getByRole('button', { name: label }));
  const wheel = screen.getByTestId(label === 'Starts' ? 'starts-picker' : 'ends-picker');
  await fireEvent(wheel, 'valueChange', { nativeEvent: { timestamp: moment.getTime() } }, moment);
  // Only one wheel is open at a time (Done closes it), so "Done" is unique.
  await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
}
