/**
 * A stand-in for the phone's date and time pickers
 * (@react-native-community/datetimepicker), used automatically by every
 * Jest test (Jest picks up files in a `__mocks__` folder next to
 * node_modules that match an installed package's name).
 *
 * Why: the real pickers are native phone screens that don't exist on a PC.
 * This fake lets tests "pick" a moment:
 *   - iPhone wheel: the component renders a plain View that keeps every
 *     prop, so a test can call
 *     `fireEvent(screen.getByTestId('starts-picker'), 'valueChange', {}, moment)`
 *     and our onValueChange runs just as if the wheel moved;
 *   - Android dialogs: `DateTimePickerAndroid.open` is a Jest spy, so a test
 *     can read the options it was given and call their onValueChange.
 */
const React = require('react');
const { View } = require('react-native');

/**
 * Fake picker component: a View carrying all the picker's props.
 *
 * @param props - the picker's props (value, onValueChange, timeZoneName, ...).
 * @returns a View that tests can find by testID.
 */
function DateTimePicker(props) {
  return React.createElement(View, props);
}

module.exports = {
  __esModule: true,
  default: DateTimePicker,
  DateTimePickerAndroid: {
    /** Fake "open a dialog": records the options, shows nothing. */
    open: jest.fn(),
    /** Fake "close the dialog". */
    dismiss: jest.fn(),
  },
};
