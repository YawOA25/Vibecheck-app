/**
 * Shared keyboard settings for the screens with text boxes (VC-76, design/
 * vc76-motion-spec.md 3e "Keyboard on forms"): sign-in, the age gate, New
 * and Edit event, and the party code.
 *
 * Why one file: every form should behave the same way when the phone's
 * keyboard slides up, and the settings differ a little between iPhone and
 * Android. Keeping them here means a fix lands on every form at once.
 */
import { Platform } from 'react-native';
import type { KeyboardAvoidingViewProps, ScrollViewProps } from 'react-native';

/**
 * How a form's KeyboardAvoidingView makes room for the keyboard: by adding
 * padding at the bottom, on BOTH platforms. Before VC-76 Android used
 * nothing, but since Expo SDK 58 Android apps draw behind the system bars
 * ("edge to edge"), so the keyboard could cover the lower fields.
 */
export const KEYBOARD_BEHAVIOR: KeyboardAvoidingViewProps['behavior'] = 'padding';

/**
 * Settings for every form's ScrollView:
 *   - keyboardShouldPersistTaps 'handled': a tap on a button while the
 *     keyboard is up presses the button straight away (instead of only
 *     closing the keyboard first);
 *   - keyboardDismissMode 'interactive' (iPhone): dragging the form down
 *     pulls the keyboard down with the finger, like the phone's own apps;
 *   - automaticallyAdjustKeyboardInsets (iPhone): the scroll area makes room
 *     for the keyboard, so the last fields can still be scrolled into view.
 */
export const FORM_SCROLL_PROPS: Pick<
  ScrollViewProps,
  'keyboardShouldPersistTaps' | 'keyboardDismissMode' | 'automaticallyAdjustKeyboardInsets'
> = {
  keyboardShouldPersistTaps: 'handled',
  keyboardDismissMode: Platform.OS === 'ios' ? 'interactive' : 'none',
  automaticallyAdjustKeyboardInsets: Platform.OS === 'ios',
};
