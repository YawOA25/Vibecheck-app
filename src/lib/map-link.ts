/**
 * Reads a map pin from typed coordinates or a pasted Google Maps / Apple Maps
 * link, for "Enter location" on the admin New event screen (VC-B04, VC-29).
 *
 * Why: staff picks (VC-29) are venue events the team adds from home, so the
 * admin can't stand at each venue to use "Use my current location". Copying
 * the venue's map link (or its coordinates) is the next most accurate way.
 *
 * Everything happens on the phone, on the text alone: no network calls and
 * no geocoding service (no cost, no third-party data sharing). That is also
 * why short links like maps.app.goo.gl can't be read: the coordinates are
 * only revealed by opening them, so we ask for the full link instead.
 */

/** A latitude/longitude pair in degrees. */
export interface LatLng {
  lat: number;
  lng: number;
}

/** What {@link parseLocationInput} returns: a pin, or a message saying why not. */
export type LocationParseResult = { ok: true; pin: LatLng } | { ok: false; message: string };

/**
 * A number like "38.9172" or "-77.032" (an optional minus sign, digits, optional decimals).
 * The "(?![\d.])" at the end means "and no more digits right after", so a
 * broken "1234.5" is refused instead of quietly read as "123".
 */
const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)(?![\\d.])';

/**
 * Patterns to try, in order. The first match wins. Order matters for Google
 * place links, which hold both the place's own pin ("!3d...!4d...") and the
 * map view's centre ("@..."): the place pin is the accurate one.
 */
const PATTERNS: RegExp[] = [
  // Google place links: ...!3d38.9172!4d-77.0320...
  new RegExp(`!3d${NUM}!4d${NUM}`),
  // Google "?q=38.9,-77.0" or "?query=...", Apple "?ll=38.9,-77.0" or "&q=...",
  // and Apple's "coordinate=". The (?:^|[?&]) part means "start of the link
  // parameters", so "sll=" or "xq=" don't count.
  new RegExp(`(?:^|[?&])(?:q|query|ll|coordinate|destination|daddr)=${NUM},\\s*${NUM}`),
  // Google map view: .../@38.9172,-77.0320,17z
  new RegExp(`@${NUM},${NUM}`),
  // Plain typed coordinates: "38.9172, -77.0320" or "38.9172 -77.0320".
  new RegExp(`^${NUM}\\s*[,\\s]\\s*${NUM}$`),
];

/**
 * Checks a latitude and longitude are on Earth and not the "0, 0" default.
 *
 * @param pin - the pair to check.
 * @returns null when fine, or a message saying what's wrong.
 */
export function checkLatLngRange(pin: LatLng): string | null {
  if (!Number.isFinite(pin.lat) || pin.lat < -90 || pin.lat > 90) {
    return 'Latitude must be between -90 and 90. Check the first number.';
  }
  if (!Number.isFinite(pin.lng) || pin.lng < -180 || pin.lng > 180) {
    return 'Longitude must be between -180 and 180. Check the second number.';
  }
  // 0, 0 is in the ocean off Africa: almost always a blank or broken value.
  if (pin.lat === 0 && pin.lng === 0) {
    return '0, 0 is in the ocean. Check the coordinates.';
  }
  return null;
}

/**
 * Turns typed coordinates or a pasted map link into a pin.
 *
 * @param text - for example "38.9172, -77.0320",
 *   "https://www.google.com/maps/place/.../@38.9172,-77.0320,17z",
 *   "https://www.google.com/maps?q=38.9172,-77.0320" or
 *   "https://maps.apple.com/?ll=38.9172,-77.0320&q=Venue".
 * @returns `{ ok: true, pin }`, or `{ ok: false, message }` in plain words.
 */
export function parseLocationInput(text: string): LocationParseResult {
  // Links often write the comma as "%2C"; turn it back into a comma.
  // decodeURIComponent can throw on a broken "%", so fall back to the raw text.
  let value = text.trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    // Keep the raw text.
  }
  if (value === '') {
    return { ok: false, message: 'Paste a Google or Apple Maps link, or type the coordinates.' };
  }
  // Short links hide the coordinates until opened, which needs the internet.
  if (/\b(maps\.app\.goo\.gl|goo\.gl\/maps)\b/i.test(value)) {
    return {
      ok: false,
      message:
        "Short links can't be read. Open the link in Google Maps, then copy the full link from the address bar.",
    };
  }
  for (const pattern of PATTERNS) {
    const match = pattern.exec(value);
    if (!match) continue;
    const pin = { lat: Number(match[1]), lng: Number(match[2]) };
    const problem = checkLatLngRange(pin);
    return problem ? { ok: false, message: problem } : { ok: true, pin };
  }
  return {
    ok: false,
    message:
      "We couldn't find coordinates in that. Paste a full Google or Apple Maps link, or type them like 38.9172, -77.0320.",
  };
}

/**
 * Writes a pin as text for the confirmation line.
 *
 * @param pin - the pin.
 * @returns for example "38.91720, -77.03200" (5 decimals is about 1 metre).
 */
export function formatLatLng(pin: LatLng): string {
  return `${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`;
}
