/**
 * Tests for the Share message (src/lib/share.ts), proposal VC-41.
 *
 * We check that the message has the event's name, area (with the state
 * when the area doesn't already say it) and its New York day and time, that
 * the link is only added once one exists, and above all that the party code
 * and the map pin are never in it, even if an event object carried them.
 *
 * Jest runs with the machine set to Tokyo (jest.global-setup.js), so the
 * times below also prove the message uses New York time, not the phone's.
 */
import { buildShareMessage, SHARE_LINK } from '@/lib/share';
import type { ShareableEvent } from '@/lib/share';

/**
 * A test event: Saturday 7 November 2026, 10 PM to 2 AM New York time
 * (03:00Z and 07:00Z on 8 November, standard time, UTC-5).
 *
 * @param overrides - fields to change.
 * @returns the event's shareable facts.
 */
function event(overrides: Partial<ShareableEvent> = {}): ShareableEvent {
  return {
    title: 'Saturday rooftop',
    area_label: 'Shaw, DC',
    starts_at: '2026-11-08T03:00:00Z',
    ends_at: '2026-11-08T07:00:00Z',
    state: 'DC',
    ...overrides,
  };
}

describe('buildShareMessage', () => {
  it('has the name, area and New York day and time, and no link while there is none', () => {
    expect(SHARE_LINK).toBe('');
    expect(buildShareMessage(event())).toBe(
      'Saturday rooftop\nShaw, DC\nSat, Nov 7 · 10 PM – 2 AM\nSee the vibe on VibeCheck.',
    );
  });

  it('adds the state when the area does not already say it', () => {
    expect(buildShareMessage(event({ area_label: 'The Wharf', state: 'DC' }))).toContain(
      '\nThe Wharf, DC\n',
    );
    expect(buildShareMessage(event({ area_label: 'Old Town', state: null }))).toContain(
      '\nOld Town\n',
    );
  });

  it('adds the link at the end only once one is set', () => {
    const message = buildShareMessage(event(), 'https://example.test/app');
    expect(message.split('\n').pop()).toBe('https://example.test/app');
    expect(buildShareMessage(event(), '   ')).not.toMatch(/\n\s*$/);
  });

  it('never includes the party code or the coordinates', () => {
    // Pretend secrets slipped onto the object: the builder must ignore them.
    const leaky = {
      ...event(),
      check_in_code: 'K7MX2Q',
      lat: 38.9123,
      lng: -77.0321,
      radius_m: 150,
    } as ShareableEvent;
    const message = buildShareMessage(leaky);
    expect(message).not.toContain('K7MX2Q');
    expect(message).not.toMatch(/38\.91|77\.03|150/);
  });
});
