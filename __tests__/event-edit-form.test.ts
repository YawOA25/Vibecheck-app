/**
 * Tests for the Edit event rules in src/lib/event-form.ts (task VC-34):
 * filling the form from an event (valuesFromEvent) and working out what
 * changed (validateEventEdit).
 *
 * What we check:
 *   - prefill: name, area, switches, link and summary as stored; dates and
 *     times in New York time even though Jest runs in Tokyo (B04 rule); pin
 *     and radius start empty ("keep");
 *   - an untouched form changes nothing;
 *   - only changed fields are sent; an empty pin and radius keep the old
 *     ones; a new pin or radius replaces them;
 *   - the test flag is only sent when flipped (so the server's "people have
 *     checked in" lock, VCTST, only speaks up when it matters);
 *   - clearing the link or summary sends '' (the server's "remove it");
 *   - fixing an event that already ended is allowed (create refuses that);
 *   - the same box rules as New event still apply (end after start).
 */
import {
  END_BEFORE_START,
  STATE_REQUIRED,
  validateEventEdit,
  valuesFromEvent,
} from '@/lib/event-form';
import type { EditableEvent } from '@/lib/event-form';

// A fixed "now": Saturday 31 October 2026, 3:00 PM in New York.
const NOW = new Date('2026-10-31T19:00:00Z');

/**
 * The event being edited: Saturday 24 October 2026, 10 PM to Sunday 2 AM
 * New York time (02:00Z and 06:00Z on 25 October, daylight time, UTC-4).
 * Not 31 October: clocks go back early on 1 November, which would make
 * "2 AM" ambiguous (that edge is tested in event-form.test.ts).
 *
 * @param overrides - fields to change.
 * @returns an EditableEvent.
 */
function event(overrides: Partial<EditableEvent> = {}): EditableEvent {
  return {
    id: 'event-1',
    title: 'Saturday rooftop',
    area_label: 'Shaw, DC',
    starts_at: '2026-10-25T02:00:00+00:00',
    ends_at: '2026-10-25T06:00:00+00:00',
    source: 'host',
    ticket_url: null,
    summary: 'Afrobeats on the roof.',
    is_21_plus: false,
    is_test: false,
    code_check_in_enabled: true,
    state: 'DC',
    ...overrides,
  };
}

describe('valuesFromEvent (prefill)', () => {
  it('fills every box from the event, with New York dates and times', () => {
    expect(valuesFromEvent(event())).toEqual({
      title: 'Saturday rooftop',
      state: 'DC',
      areaLabel: 'Shaw, DC',
      // 02:00Z on 25 Oct is 10 PM on 24 Oct in New York (and 11 AM in Tokyo).
      startDate: '10 / 24 / 2026',
      startTime: '10 PM',
      endDate: '10 / 25 / 2026',
      endTime: '2 AM',
      radius: '',
      codeEnabled: true,
      isTest: false,
      isStaffPick: false,
      is21Plus: false,
      ticketUrl: '',
      entryUrl: '',
      summary: 'Afrobeats on the roof.',
      pin: null,
    });
  });

  it('shows minutes when the time has them, and reads staff picks', () => {
    const values = valuesFromEvent(
      event({
        starts_at: '2026-10-25T01:30:00Z',
        source: 'staff_pick',
        ticket_url: 'https://www.eventbrite.com/e/1',
      }),
    );
    expect(values.startTime).toBe('9:30 PM');
    expect(values.isStaffPick).toBe(true);
    expect(values.ticketUrl).toBe('https://www.eventbrite.com/e/1');
  });
});

describe('validateEventEdit', () => {
  it('an untouched form changes nothing (pin and radius are kept)', () => {
    const result = validateEventEdit(valuesFromEvent(event()), event(), NOW);
    expect(result).toEqual({ ok: true, input: { p_event_id: 'event-1' }, changed: false });
  });

  it('re-typing the same time differently is not a change', () => {
    const values = { ...valuesFromEvent(event()), startTime: '10:00 pm' };
    expect(validateEventEdit(values, event(), NOW)).toMatchObject({ changed: false });
  });

  it('sends only the fields that changed', () => {
    const values = {
      ...valuesFromEvent(event()),
      title: 'Sunday rooftop ',
      endTime: '3:00 AM',
      is21Plus: true,
    };
    const result = validateEventEdit(values, event(), NOW);
    expect(result).toEqual({
      ok: true,
      changed: true,
      input: {
        p_event_id: 'event-1',
        p_title: 'Sunday rooftop',
        // 3 AM New York on 25 October = 07:00Z.
        p_ends_at: '2026-10-25T07:00:00.000Z',
        p_is_21_plus: true,
      },
    });
  });

  it('a new pin and radius replace the old ones', () => {
    const values = {
      ...valuesFromEvent(event()),
      pin: { lat: 38.91, lng: -77.02, accuracyM: 8 },
      radius: '200',
    };
    expect(validateEventEdit(values, event(), NOW)).toEqual({
      ok: true,
      changed: true,
      input: { p_event_id: 'event-1', p_lat: 38.91, p_lng: -77.02, p_radius_m: 200 },
    });
  });

  it('still checks a typed radius', () => {
    const values = { ...valuesFromEvent(event()), radius: '5' };
    const result = validateEventEdit(values, event(), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.radius).toBe('Enter 25 to 1000 metres.');
  });

  it('sends the test flag only when it is flipped', () => {
    const flipped = { ...valuesFromEvent(event()), isTest: true };
    expect(validateEventEdit(flipped, event(), NOW)).toMatchObject({
      input: { p_event_id: 'event-1', p_is_test: true },
    });
    const same = valuesFromEvent(event({ is_test: true }));
    expect(validateEventEdit(same, event({ is_test: true }), NOW)).toMatchObject({
      changed: false,
    });
  });

  it("clearing the summary sends '' (the server's \"remove it\")", () => {
    const values = { ...valuesFromEvent(event()), summary: '  ' };
    expect(validateEventEdit(values, event(), NOW)).toMatchObject({
      input: { p_event_id: 'event-1', p_summary: '' },
    });
  });

  it('switching staff pick and party code sends source and the code flag', () => {
    const values = { ...valuesFromEvent(event()), isStaffPick: true, codeEnabled: false };
    expect(validateEventEdit(values, event(), NOW)).toMatchObject({
      input: { p_source: 'staff_pick', p_code_check_in_enabled: false },
    });
  });

  it('allows fixing an event that has already ended', () => {
    const past = event({ starts_at: '2026-10-20T02:00:00Z', ends_at: '2026-10-20T06:00:00Z' });
    const values = { ...valuesFromEvent(past), title: 'Fixed typo' };
    expect(validateEventEdit(values, past, NOW)).toMatchObject({
      ok: true,
      input: { p_title: 'Fixed typo' },
    });
  });

  it('keeps the New event box rules (end after start)', () => {
    const values = { ...valuesFromEvent(event()), endDate: '10 / 24 / 2026' };
    const result = validateEventEdit(values, event(), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.endTime).toBe(END_BEFORE_START);
  });

  it('sends a changed state (VC-37)', () => {
    const values = { ...valuesFromEvent(event()), state: 'MD' as const, areaLabel: 'Bethesda, MD' };
    expect(validateEventEdit(values, event(), NOW)).toMatchObject({
      input: { p_event_id: 'event-1', p_state: 'MD', p_area_label: 'Bethesda, MD' },
    });
  });

  it('an older event with no state gets it from a listed area, and saving fills it in', () => {
    const older = event({ state: null });
    expect(valuesFromEvent(older).state).toBe('DC');
    expect(validateEventEdit(valuesFromEvent(older), older, NOW)).toMatchObject({
      input: { p_state: 'DC' },
    });
    // A typed area that isn't on the list gives no guess, so saving asks
    // for a state from the list (State lookup spec, section 4).
    const typed = event({ state: null, area_label: 'Ivy City' });
    expect(valuesFromEvent(typed).state).toBeNull();
    expect(validateEventEdit(valuesFromEvent(typed), typed, NOW)).toEqual({
      ok: false,
      errors: { state: STATE_REQUIRED },
    });
  });

  it('keeps stored seconds when the time boxes are not touched', () => {
    const withSeconds = event({ starts_at: '2026-10-25T02:00:30Z' });
    const values = { ...valuesFromEvent(withSeconds), title: 'New name' };
    const result = validateEventEdit(values, withSeconds, NOW);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.input.p_starts_at).toBeUndefined();
  });
});

// ---- VC-40: the "How to get in" link ---------------------------------------

describe('validateEventEdit and the "How to get in" link', () => {
  const withLink = () => event({ entry_url: 'https://partiful.com/e/1' });

  it('prefills the stored link and sends nothing when it is untouched', () => {
    const values = valuesFromEvent(withLink());
    expect(values.entryUrl).toBe('https://partiful.com/e/1');
    expect(validateEventEdit(values, withLink(), NOW)).toMatchObject({ changed: false });
  });

  it('sends a new link, and an empty one to remove it', () => {
    const changed = { ...valuesFromEvent(withLink()), entryUrl: 'https://lu.ma/x' };
    expect(validateEventEdit(changed, withLink(), NOW)).toMatchObject({
      input: { p_event_id: 'event-1', p_entry_url: 'https://lu.ma/x' },
    });
    const removed = { ...valuesFromEvent(withLink()), entryUrl: '  ' };
    expect(validateEventEdit(removed, withLink(), NOW)).toMatchObject({
      input: { p_event_id: 'event-1', p_entry_url: '' },
    });
  });

  it('removes the link when the event becomes a staff pick (the server insists)', () => {
    const values = { ...valuesFromEvent(withLink()), isStaffPick: true };
    expect(validateEventEdit(values, withLink(), NOW)).toEqual({
      ok: true,
      input: { p_event_id: 'event-1', p_source: 'staff_pick', p_entry_url: '' },
      changed: true,
    });
  });
});
