/**
 * Tests for the friendly error messages (src/lib/auth-errors.ts) and the
 * sign-in input helpers (src/lib/sign-in-input.ts), task VC-B03.
 */
import {
  describeProfileError,
  describeSignInError,
  isUnder18Error,
  ProfileErrorCode,
} from '@/lib/auth-errors';
import { cleanCode, cleanEmail, looksLikeEmail } from '@/lib/sign-in-input';

describe('describeSignInError', () => {
  it('explains rate limits, bad codes and the team-only email rule', () => {
    expect(describeSignInError({ code: 'over_email_send_rate_limit' })).toMatch(/wait/);
    expect(describeSignInError({ status: 429 })).toMatch(/wait/);
    expect(describeSignInError({ code: 'otp_expired' })).toMatch(/code didn't work/);
    expect(describeSignInError({ code: 'email_address_not_authorized' })).toMatch(/team/);
  });

  it('spots network failures', () => {
    expect(describeSignInError({ name: 'AuthRetryableFetchError' })).toMatch(/connection/);
    expect(describeSignInError({ message: 'Network request failed' })).toMatch(/connection/);
  });

  it('falls back to a general message', () => {
    expect(describeSignInError({ code: 'something_new' })).toBe(
      'Something went wrong. Please try again.',
    );
  });
});

describe('describeProfileError and isUnder18Error', () => {
  it('maps every complete_profile error code', () => {
    expect(describeProfileError({ code: ProfileErrorCode.under18 })).toMatch(/18 and older/);
    expect(describeProfileError({ code: ProfileErrorCode.badName })).toMatch(/name/);
    expect(describeProfileError({ code: ProfileErrorCode.badBirthdate })).toMatch(/date of birth/);
    expect(describeProfileError({ code: ProfileErrorCode.alreadyDone })).toMatch(/already/);
    expect(describeProfileError({ code: '42501' })).toMatch(/sign in again/);
  });

  it('recognises only the under-18 refusal', () => {
    expect(isUnder18Error({ code: 'VCA18' })).toBe(true);
    expect(isUnder18Error({ code: 'VCDOB' })).toBe(false);
    expect(isUnder18Error(null)).toBe(false);
  });
});

describe('sign-in input helpers', () => {
  it('cleans and checks email addresses', () => {
    expect(cleanEmail('  Ava@Example.COM ')).toBe('ava@example.com');
    expect(looksLikeEmail('ava@example.com')).toBe(true);
    expect(looksLikeEmail('ava@example')).toBe(false);
    expect(looksLikeEmail('ava example.com')).toBe(false);
  });

  it('keeps only digits in the code, at most 10', () => {
    expect(cleanCode('123 456')).toBe('123456');
    expect(cleanCode('12-34-56-78-90-12')).toBe('1234567890');
  });
});
