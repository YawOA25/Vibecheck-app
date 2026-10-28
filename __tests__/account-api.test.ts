/**
 * Tests for src/lib/account-api.ts (VC-B13): the app's call to the
 * delete-account Edge Function and how its answers become words.
 */
import {
  DELETE_FAILED,
  DELETE_LOCKED,
  DELETE_SIGNED_OUT,
  requestAccountDeletion,
} from '@/lib/account-api';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: jest.fn() } } }));

const invoke = supabase.functions.invoke as unknown as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('requestAccountDeletion', () => {
  it('POSTs to delete-account with no id of its own and reports success', async () => {
    invoke.mockResolvedValue({ data: { deleted: true }, error: null });
    expect(await requestAccountDeletion()).toEqual({ ok: true });
    // Only the function name and method: no body, so no id can be sent.
    expect(invoke).toHaveBeenCalledWith('delete-account', { method: 'POST' });
  });

  it.each([
    [409, DELETE_LOCKED],
    [401, DELETE_SIGNED_OUT],
    [500, DELETE_FAILED],
  ])('turns a %i answer into a sentence', async (status, message) => {
    invoke.mockResolvedValue({ data: null, error: { context: { status } } });
    expect(await requestAccountDeletion()).toEqual({ ok: false, message });
  });

  it('never throws: a network failure or an odd answer is a plain failure', async () => {
    invoke.mockRejectedValue(new Error('Network request failed'));
    expect(await requestAccountDeletion()).toEqual({ ok: false, message: DELETE_FAILED });
    invoke.mockResolvedValue({ data: { deleted: false }, error: null });
    expect(await requestAccountDeletion()).toEqual({ ok: false, message: DELETE_FAILED });
  });
});
