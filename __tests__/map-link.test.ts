/**
 * Tests for reading a map pin from a pasted link or typed coordinates
 * (src/lib/map-link.ts), used by "Enter location" on the admin New event
 * screen (VC-B04, VC-29 staff picks).
 *
 * We check the link shapes the team will paste (Google "@lat,lng",
 * "?q=lat,lng" and place links; Apple "ll="), plain typed coordinates, and
 * that bad input and out-of-range numbers are refused with a message.
 */
import { checkLatLngRange, formatLatLng, parseLocationInput } from '@/lib/map-link';

const PIN = { lat: 38.9172, lng: -77.032 };

describe('parseLocationInput', () => {
  it.each([
    ['Google map view (@lat,lng)', 'https://www.google.com/maps/@38.9172,-77.0320,17z'],
    ['Google search (?q=lat,lng)', 'https://www.google.com/maps?q=38.9172,-77.0320'],
    [
      'Google search with %2C',
      'https://www.google.com/maps/search/?api=1&query=38.9172%2C-77.0320',
    ],
    ['Apple Maps (ll=)', 'https://maps.apple.com/?ll=38.9172,-77.0320&q=Venue'],
    ['typed with a comma', '38.9172, -77.0320'],
    ['typed with a space', '  38.9172 -77.0320 '],
  ])('reads %s', (_name, text) => {
    expect(parseLocationInput(text)).toEqual({ ok: true, pin: PIN });
  });

  it('prefers the place pin (!3d!4d) over the map view (@) in Google place links', () => {
    const link =
      'https://www.google.com/maps/place/Venue/@38.9000,-77.0000,15z/data=!4m6!3m5!8m2!3d38.9172!4d-77.0320';
    expect(parseLocationInput(link)).toEqual({ ok: true, pin: PIN });
  });

  it('does not mistake Apple "sll=" (search area) for the pin', () => {
    const result = parseLocationInput('https://maps.apple.com/?sll=38.9,-77.0&q=Venue');
    expect(result.ok).toBe(false);
  });

  it.each([
    ['empty text', ''],
    ['a place name', 'Black Cat, DC'],
    ['a link with no coordinates', 'https://www.google.com/maps/place/Black+Cat'],
    ['one number', '38.9172'],
  ])('refuses %s', (_name, text) => {
    const result = parseLocationInput(text);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message.length).toBeGreaterThan(0);
  });

  it('explains that short links need the full link', () => {
    const result = parseLocationInput('https://maps.app.goo.gl/AbC123');
    expect(!result.ok && result.message).toMatch(/Short links/);
  });

  it('refuses numbers out of range', () => {
    expect(parseLocationInput('91, -77').ok).toBe(false);
    expect(parseLocationInput('38.9, -181').ok).toBe(false);
    expect(parseLocationInput('https://www.google.com/maps?q=0,0').ok).toBe(false);
  });

  // cto review: a number with too many digits must be refused, not cut short
  // ("1234.5" quietly read as "123" would put the pin on the wrong continent).
  it('refuses a number with too many digits instead of cutting it short', () => {
    expect(parseLocationInput('https://www.google.com/maps/@38.9172,1234.5,17z').ok).toBe(false);
    expect(parseLocationInput('https://www.google.com/maps?q=38.9172,-7703.2').ok).toBe(false);
  });
});

describe('checkLatLngRange', () => {
  it('accepts the edges and refuses beyond them', () => {
    expect(checkLatLngRange({ lat: 90, lng: 180 })).toBeNull();
    expect(checkLatLngRange({ lat: -90, lng: -180 })).toBeNull();
    expect(checkLatLngRange({ lat: 90.1, lng: 0 })).toMatch(/Latitude/);
    expect(checkLatLngRange({ lat: 0, lng: -180.1 })).toMatch(/Longitude/);
    expect(checkLatLngRange({ lat: 0, lng: 0 })).toMatch(/ocean/);
  });
});

describe('formatLatLng', () => {
  it('shows 5 decimals', () => {
    expect(formatLatLng(PIN)).toBe('38.91720, -77.03200');
  });
});
