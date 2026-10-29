/**
 * Tests for the in-app Terms and Privacy screens (proposal VC-32b), the
 * "Contact us" link (VC-32c), and their links from the sign-in screen.
 *
 * They check that:
 *   - each screen draws its title and every section from the one content
 *     file (src/copy/legal.ts), with the "Draft" note while it's a draft;
 *   - placeholder text can't ship as final: if a document says
 *     isDraft: false, none of its text may still contain PLACEHOLDER;
 *   - SupportEmailLink shows nothing for an empty address and opens the
 *     email app for a real one;
 *   - the sign-in screen links to both legal screens.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import SignInScreen from '../app/(auth)/sign-in';
import PrivacyScreen from '../app/privacy';
import TermsScreen from '../app/terms';
import { SupportEmailLink } from '@/components/SupportEmailLink';
import { PRIVACY, TERMS } from '@/copy/legal';
import { mailtoLink } from '@/lib/contact';

jest.mock('@/lib/supabase', () => ({ supabase: { auth: {} } }));
// The sign-in screen reads the sign-in state and the phone's age note
// (VC-74); neither matters for the legal links, so both are simple fakes.
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ startSignUp: jest.fn(), refuseBeforeSignIn: jest.fn() }),
}));
jest.mock('@/lib/device-age-refusal', () => ({ hasRecentDeviceRefusal: jest.fn() }));
// The "mock" prefix lets jest.mock (which runs first) use this fake.
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
}));

beforeEach(() => jest.clearAllMocks());

describe('legal screens', () => {
  it.each([
    ['Terms', TermsScreen, TERMS],
    ['Privacy', PrivacyScreen, PRIVACY],
  ])('%s draws its title and every section from src/copy/legal.ts', async (_name, Screen, doc) => {
    await render(<Screen />);
    expect(screen.getByRole('header', { name: doc.title })).toBeOnTheScreen();
    for (const section of doc.sections) {
      expect(screen.getByText(section.heading)).toBeOnTheScreen();
    }
    if (doc.isDraft) expect(screen.getByText('DRAFT')).toBeOnTheScreen();
    else expect(screen.queryByText('DRAFT')).toBeNull();
  });

  it.each([
    ['TERMS', TERMS],
    ['PRIVACY', PRIVACY],
  ])('%s: placeholder text never ships without the Draft note', (_name, doc) => {
    const text = doc.sections.flatMap((s) => [s.heading, ...s.paragraphs]).join('\n');
    if (!doc.isDraft) {
      expect(text).not.toMatch(/PLACEHOLDER/);
      expect(doc.updated).not.toBe('');
    }
    expect(doc.sections.length).toBeGreaterThan(0);
  });
});

describe('SupportEmailLink (VC-32c)', () => {
  it('shows nothing while the address is empty (as SUPPORT_EMAIL is until the founder sets it)', async () => {
    expect(mailtoLink('  ')).toBeNull();
    await render(<SupportEmailLink email="" />);
    expect(screen.queryByText(/Contact us/)).toBeNull();
  });

  it('opens the email app once an address is set', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await render(<SupportEmailLink email=" help@example.com " />);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Contact us, email help@example.com' }),
    );
    expect(open).toHaveBeenCalledWith('mailto:help@example.com');
    open.mockRestore();
  });
});

describe('sign-in links (VC-32b)', () => {
  it('links to the Terms and the Privacy Policy', async () => {
    await render(<SignInScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Terms of Service' }));
    expect(mockPush).toHaveBeenLastCalledWith('/terms');
    await fireEvent.press(screen.getByRole('button', { name: 'Privacy Policy' }));
    expect(mockPush).toHaveBeenLastCalledWith('/privacy');
  });
});
