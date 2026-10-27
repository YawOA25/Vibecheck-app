/**
 * Tests for crash reports (src/lib/sentry.ts), task VC-26.
 *
 * We check the privacy rules that legal VC-30 asks for: every sensitive field
 * (birthdate, date of birth, email, password, codes, tokens, lat/lng) is
 * removed from reports and breadcrumbs, sensitive text inside messages and
 * web addresses is blanked, the user is cut down to an anonymous id, and
 * Sentry stays off when there is no DSN. Sentry itself is never contacted:
 * tests pass a fake `init` function and look at the options it receives, and
 * Jest swaps the whole library for the fake in __mocks__/@sentry/react-native.js.
 */
import * as Sentry from '@sentry/react-native';
import type { ReactNativeOptions } from '@sentry/react-native';

import { initSentry, isSensitiveKey, scrubEvent, scrubText, sendTestError } from '@/lib/sentry';

describe('isSensitiveKey', () => {
  it.each([
    'birthdate',
    'p_birthdate',
    'birth_date',
    'birthDate',
    'dateOfBirth',
    'date_of_birth',
    'dob',
    'birthday',
    'email',
    'userEmail',
    'password',
    'code',
    'p_code',
    'checkInCode',
    'otp',
    'access_token',
    'Authorization',
    'lat',
    'lng',
    'p_lat',
    'p_lng',
    'latitude',
    'longitude',
  ])('drops %s', (key) => expect(isSensitiveKey(key)).toBe(true));

  it.each([
    'title',
    'area_label',
    'starts_at',
    'status_code',
    'message',
    'url',
    'platform',
    // Sentry's own fields, needed for source maps and app versions.
    'code_file',
    'code_id',
    'version_code',
  ])('keeps %s', (key) => expect(isSensitiveKey(key)).toBe(false));
});

describe('scrubText', () => {
  it('blanks emails, plain dates, codes and coordinates', () => {
    expect(scrubText('No account for ava@example.com')).toBe('No account for [email]');
    expect(scrubText('birthdate 2001-05-03 refused')).toBe('birthdate [date] refused');
    expect(scrubText('typed 05 / 03 / 2001')).toBe('typed [date]');
    // Other common ways a birthdate could be written (legal VC-30 condition 5).
    for (const date of [
      '05/03/2001',
      '5/3/2001',
      '05-03-2001',
      '5/3/01',
      '2001/05/03',
      '2001-5-3',
      'May 3, 2001',
      'May 03 2001', // as in Date.toString(): "Thu May 03 2001 ..."
      '3 May 2001',
    ]) {
      expect(scrubText(`dob ${date} refused`)).toBe('dob [date] refused');
    }
    expect(scrubText('code 12345678 wrong')).toBe('code [number] wrong');
    expect(scrubText('at 38.91234,-77.03211')).toBe('at [coord],[coord]');
  });

  it('keeps full timestamps (public event times) and ordinary numbers', () => {
    expect(scrubText('starts 2026-11-01T02:00:00.000Z')).toBe('starts 2026-11-01T02:00:00.000Z');
    expect(scrubText('took 1.5 s, status 404')).toBe('took 1.5 s, status 404');
    // Version numbers are not dates.
    expect(scrubText('react-native 0.79.12')).toBe('react-native 0.79.12');
  });

  it('empties sensitive settings in web addresses', () => {
    expect(scrubText('https://x.supabase.co/auth/v1/verify?type=email&code=abc&next=/')).toBe(
      'https://x.supabase.co/auth/v1/verify?type=email&code=[Filtered]&next=/',
    );
    expect(scrubText('/rpc?p_birthdate=x&p_lat=1')).toBe(
      '/rpc?p_birthdate=[Filtered]&p_lat=[Filtered]',
    );
  });
});

describe('scrubEvent', () => {
  it('removes every sensitive field from a report, however deep', () => {
    const event = {
      message: 'save failed for ava@example.com',
      extra: {
        birthdate: '2001-05-03',
        date_of_birth: '2001-05-03',
        form: { email: 'ava@example.com', password: 'hunter2', code: '12345678' },
        pin: { lat: 38.9, lng: -77.0 },
        p_lat: 38.9,
        p_lng: -77.0,
        title: 'Saturday rooftop',
      },
      request: { data: { p_birthdate: '2001-05-03' } },
    };
    const cleaned = scrubEvent(event);
    expect(cleaned).toEqual({
      message: 'save failed for [email]',
      extra: { form: {}, title: 'Saturday rooftop' },
      request: { data: {} },
    });
    // The original report is left untouched.
    expect(event.extra.birthdate).toBe('2001-05-03');
  });

  it('cuts the user down to an anonymous id (no IP, email or name)', () => {
    const cleaned = scrubEvent({
      user: { id: 'u-1', email: 'a@b.co', username: 'Ava', ip_address: '1.2.3.4', geo: {} },
    });
    expect(cleaned).toEqual({ user: { id: 'u-1' } });
    // A user with no id is removed entirely.
    expect(scrubEvent({ user: { ip_address: '{{auto}}' } })).toEqual({});
  });

  it('cleans breadcrumbs too (console lines and network calls)', () => {
    const crumb = {
      category: 'console',
      message: 'birthdate 2001-05-03 for ava@example.com',
      data: { arguments: [{ birthDate: '2001-05-03' }], status_code: 200 },
    };
    expect(scrubEvent(crumb)).toEqual({
      category: 'console',
      message: 'birthdate [date] for [email]',
      data: { arguments: [{}], status_code: 200 },
    });
  });

  it('survives a report that refers to itself', () => {
    const loop: Record<string, unknown> = { name: 'loop' };
    loop.self = loop;
    expect(scrubEvent(loop)).toEqual({ name: 'loop', self: '[Filtered]' });
  });
});

describe('initSentry', () => {
  it('stays off with no DSN (or a blank one)', () => {
    const init = jest.fn();
    expect(initSentry({ dsn: undefined, dev: true, init })).toBe(false);
    expect(initSentry({ dsn: '   ', dev: true, init })).toBe(false);
    expect(init).not.toHaveBeenCalled();
    // And the dev-only test button reports that Sentry is off.
    expect(sendTestError()).toBe(false);
  });

  it('starts with privacy settings and the right environment', () => {
    const init = jest.fn();
    expect(initSentry({ dsn: 'https://key@o1.ingest.sentry.io/1', dev: true, init })).toBe(true);
    const options: ReactNativeOptions = init.mock.calls[0][0];
    expect(options).toMatchObject({
      dsn: 'https://key@o1.ingest.sentry.io/1',
      environment: 'development',
      sendDefaultPii: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
    });

    initSentry({ dsn: 'https://key@o1.ingest.sentry.io/1', dev: false, init });
    expect(init.mock.calls[1][0].environment).toBe('production');
  });

  it('runs every report and breadcrumb through the scrubber', () => {
    const init = jest.fn();
    initSentry({ dsn: 'https://key@o1.ingest.sentry.io/1', dev: true, init });
    const options: ReactNativeOptions = init.mock.calls[0][0];
    const event = options.beforeSend!(
      { message: 'x', extra: { birthdate: '2001-05-03' } } as any,
      {},
    );
    expect(event).toEqual({ message: 'x', extra: {} });
    const crumb = options.beforeBreadcrumb!({ message: 'ava@example.com' });
    expect(crumb).toEqual({ message: '[email]' });
  });

  it('lets the dev-only button send a test error once Sentry is on', () => {
    initSentry({ dsn: 'https://key@o1.ingest.sentry.io/1', dev: true, init: jest.fn() });
    expect(sendTestError()).toBe(true);
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error));
  });

  it('uses the real Sentry.init by default when a DSN is given', () => {
    initSentry({ dsn: 'https://key@o1.ingest.sentry.io/1', dev: true });
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ sendDefaultPii: false, environment: 'development' }),
    );
  });
});
