/**
 * A stand-in for react-native-maps in Jest tests (VC-79).
 *
 * Why: the real package draws an Apple or Google map with native code that
 * doesn't exist on a PC. Jest uses this file automatically instead (it sits
 * in `__mocks__` next to node_modules).
 *
 * What it does:
 *   - MapView draws a plain View that keeps every prop (so tests can read
 *     e.g. `showsUserLocation`), reports "map ready" right after it appears,
 *     and records the framing commands in `mapCommands` (fitToCoordinates,
 *     animateToRegion) so tests can check them;
 *   - Circle draws a View with testID "map-circle" holding its props;
 *   - Marker draws its children inside a pressable View (tests press it).
 */
const React = require('react');
const { Pressable, View } = require('react-native');

/** The framing commands the screen sent to the map (jest.fn, cleared by tests). */
const mapCommands = {
  fitToCoordinates: jest.fn(),
  animateToRegion: jest.fn(),
};

/**
 * The fake map.
 *
 * @param props - the MapView props; children are the circles and pins.
 * @param ref - gets the two framing commands.
 * @returns a View with the same props.
 */
const MapView = React.forwardRef(function MapView(props, ref) {
  React.useImperativeHandle(ref, () => ({
    fitToCoordinates: mapCommands.fitToCoordinates,
    animateToRegion: mapCommands.animateToRegion,
  }));
  const { onMapReady } = props;
  // A real map says "ready" once it has drawn; do the same once mounted.
  React.useEffect(() => {
    if (onMapReady) onMapReady();
    // Only once, like the real map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return React.createElement(View, props, props.children);
});

/**
 * The fake circle.
 *
 * @param props - center, radius, colours.
 * @returns a View with testID "map-circle".
 */
function Circle(props) {
  return React.createElement(View, { ...props, testID: 'map-circle' });
}

/**
 * The fake pin.
 *
 * @param props - coordinate, onPress, children (the pill).
 * @returns a pressable View drawing the children.
 */
function Marker(props) {
  return React.createElement(Pressable, { ...props, onPress: props.onPress }, props.children);
}

module.exports = {
  __esModule: true,
  default: MapView,
  Circle,
  Marker,
  mapCommands,
  PROVIDER_DEFAULT: undefined,
  PROVIDER_GOOGLE: 'google',
};
