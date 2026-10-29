/**
 * Tests for the delete-account Edge Function's decisions
 * (supabase/functions/delete-account/handler.ts), task VC-B13.
 *
 * The Supabase calls are faked. The key check is "a user can delete only
 * themselves": whatever the request says, the id passed to the database is
 * the one the verified login token belongs to. (pgTAP test 027 proves the
 * other half: app users can't call the database function at all.)
 */
import {
  bearerToken,
  handleDeleteAccount,
  type DeleteAccountDeps,
} from '../supabase/functions/delete-account/handler';

/** Fake Supabase: tokens 'token-ava' and 'token-ben' belong to Ava and Ben. */
function fakeDeps(overrides: Partial<Record<keyof DeleteAccountDeps, jest.Mock>> = {}) {
  const users: Record<string, string> = { 'token-ava': 'user-ava', 'token-ben': 'user-ben' };
  return {
    verifyUser: jest.fn(async (token: string) => users[token] ?? null) as jest.Mock,
    deleteAccount: jest.fn(async () => ({ error: null })) as jest.Mock,
    logError: jest.fn(),
    ...overrides,
  };
}

describe('delete-account function', () => {
  it("deletes exactly the token owner's account", async () => {
    const deps = fakeDeps();
    const res = await handleDeleteAccount(
      { method: 'POST', authorization: 'Bearer token-ava' },
      deps,
    );
    expect(res).toEqual({ status: 200, body: { deleted: true } });
    expect(deps.verifyUser).toHaveBeenCalledWith('token-ava');
    expect(deps.deleteAccount).toHaveBeenCalledTimes(1);
    expect(deps.deleteAccount).toHaveBeenCalledWith('user-ava');
  });

  it('never deletes anyone but the token owner (Ben can only delete Ben)', async () => {
    const deps = fakeDeps();
    await handleDeleteAccount({ method: 'POST', authorization: 'Bearer token-ben' }, deps);
    expect(deps.deleteAccount.mock.calls).toEqual([['user-ben']]);
    // The request type has no body or id field at all: the handler can't be
    // told whom to delete.
  });

  it('refuses a call with no token, a malformed header, or a token that is not a user (401)', async () => {
    for (const authorization of [null, '', 'token-ava', 'Basic abc', 'Bearer ']) {
      const deps = fakeDeps();
      const res = await handleDeleteAccount({ method: 'POST', authorization }, deps);
      expect(res).toEqual({ status: 401, body: { error: 'not_signed_in' } });
      expect(deps.deleteAccount).not.toHaveBeenCalled();
    }
    const deps = fakeDeps();
    const forged = await handleDeleteAccount(
      { method: 'POST', authorization: 'Bearer forged-token' },
      deps,
    );
    expect(forged.status).toBe(401);
    expect(deps.deleteAccount).not.toHaveBeenCalled();
  });

  it('only POST deletes; OPTIONS (web pre-check) gets an empty 204', async () => {
    const deps = fakeDeps();
    expect(
      (await handleDeleteAccount({ method: 'GET', authorization: 'Bearer token-ava' }, deps))
        .status,
    ).toBe(405);
    expect(await handleDeleteAccount({ method: 'OPTIONS', authorization: null }, deps)).toEqual({
      status: 204,
      body: null,
    });
    expect(deps.deleteAccount).not.toHaveBeenCalled();
  });

  it('treats "already deleted" as done and other errors as 500', async () => {
    const gone = fakeDeps({ deleteAccount: jest.fn(async () => ({ error: { code: 'VCNFD' } })) });
    expect(
      await handleDeleteAccount({ method: 'POST', authorization: 'Bearer token-ava' }, gone),
    ).toEqual({ status: 200, body: { deleted: true } });

    const broken = fakeDeps({
      deleteAccount: jest.fn(async () => ({ error: { code: 'XX000' } })),
    });
    const res = await handleDeleteAccount(
      { method: 'POST', authorization: 'Bearer token-ava' },
      broken,
    );
    expect(res).toEqual({ status: 500, body: { error: 'failed' } });
    // Only the code is logged: never the user id or the token.
    expect(broken.logError).toHaveBeenCalledWith('delete_account failed with code XX000');
    expect(JSON.stringify(broken.logError.mock.calls)).not.toMatch(/user-ava|token-ava/);
  });

  it('answers 500 (and does not throw) when a Supabase call throws', async () => {
    const deps = fakeDeps({
      verifyUser: jest.fn(async () => {
        throw new Error('network down');
      }),
    });
    const res = await handleDeleteAccount(
      { method: 'POST', authorization: 'Bearer token-ava' },
      deps,
    );
    expect(res.status).toBe(500);
    expect(deps.deleteAccount).not.toHaveBeenCalled();
  });
});

describe('bearerToken', () => {
  it('reads the token from "Bearer <token>" only', () => {
    expect(bearerToken('Bearer abc.def')).toBe('abc.def');
    expect(bearerToken('bearer abc')).toBe('abc');
    expect(bearerToken('abc')).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
});
