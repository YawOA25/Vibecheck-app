/**
 * Tests for src/lib/secure-session-storage.ts (batch Q1): the login kept in
 * the phone's secure store, in pieces, and moved once from AsyncStorage.
 *
 * What it checks, in plain words:
 *   - splitIntoChunks cuts text into pieces no bigger than asked, never
 *     between the two halves of an emoji, and joining gives the text back;
 *   - a login bigger than one piece is saved in pieces (none over the size
 *     limit), read back exactly, and nothing is written to AsyncStorage;
 *   - saving again replaces the old pieces (no leftovers) and sign-out
 *     deletes every piece;
 *   - a crash halfway through a save keeps the previous login readable;
 *   - a missing piece reads as "nothing saved", not half a login;
 *   - a phone that can't decrypt (restored backup) reads as "nothing saved";
 *   - existing users: the old AsyncStorage login is moved once, the guest
 *     stays signed in (same value back), and the old key is deleted; other
 *     app keys (the age-gate flag) are left alone;
 *   - if the move fails, the old value is kept and still used (no forced
 *     sign-out), and the next save clears the plain-text copy;
 *   - if the secure store already has a newer copy, the old one is just
 *     deleted;
 *   - calls run one at a time, so two quick saves can't mix their pieces.
 *
 * The secure store and AsyncStorage are in-memory fakes passed in, so these
 * tests run on a PC with no phone.
 */
import {
  CHUNK_SIZE,
  createSecureSessionStorage,
  LEGACY_AUTH_KEY,
  splitIntoChunks,
} from '@/lib/secure-session-storage';
import type { LegacyBackend, SecureBackend } from '@/lib/secure-session-storage';

// Jest would otherwise load the real native modules when the file is
// imported (they only work on a phone). The tests below pass fakes anyway.
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 5,
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const KEY = 'sb-abcdefghij-auth-token';

/**
 * How many bytes a text takes in UTF-8 (what the secure store's 2 KB limit
 * counts). Input: the text. Returns: the byte count.
 */
function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * An in-memory secure store. Returns the fake plus its Map, so tests can
 * look inside and break things on purpose.
 */
function fakeSecure() {
  const data = new Map<string, string>();
  const store: SecureBackend & { failSetAfter?: number } = {
    getItemAsync: jest.fn(async (key: string) => data.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      // Like the real store, refuse values over 2048 bytes.
      if (utf8Bytes(value) > 2048) throw new Error('too big');
      if (store.failSetAfter !== undefined) {
        if (store.failSetAfter <= 0) throw new Error('keychain unavailable');
        store.failSetAfter -= 1;
      }
      data.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      data.delete(key);
    }),
  };
  return { store, data };
}

/** An in-memory AsyncStorage. Returns the fake plus its Map. */
function fakeLegacy(initial: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(initial));
  const store: LegacyBackend = {
    getAllKeys: jest.fn(async () => [...data.keys()]),
    getItem: jest.fn(async (key: string) => data.get(key) ?? null),
    removeItem: jest.fn(async (key: string) => {
      data.delete(key);
    }),
  };
  return { store, data };
}

/** A pretend Supabase session, about 3 KB (bigger than one secure value). */
function bigSession(tag = 'one'): string {
  return JSON.stringify({
    access_token: `${tag}.${'a'.repeat(1400)}`,
    refresh_token: `r-${tag}`,
    user: { id: 'u1', email: 'guest@example.com', note: 'x'.repeat(1500) },
  });
}

describe('splitIntoChunks', () => {
  it('cuts into pieces no bigger than asked, and joins back exactly', () => {
    const text = 'abcdefghij'.repeat(7); // 70 characters
    const pieces = splitIntoChunks(text, 20);
    expect(pieces).toHaveLength(4);
    expect(pieces.every((p) => p.length <= 20)).toBe(true);
    expect(pieces.join('')).toBe(text);
  });

  it('never cuts an emoji in half', () => {
    // 19 letters then an emoji (2 JavaScript characters): a plain cut at 20
    // would split the emoji.
    const text = `${'a'.repeat(19)}😀bc`;
    const pieces = splitIntoChunks(text, 20);
    expect(pieces[0]).toBe('a'.repeat(19));
    expect(pieces[1]).toBe('😀bc');
  });

  it('gives no pieces for empty text', () => {
    expect(splitIntoChunks('')).toEqual([]);
  });

  it('uses pieces that fit the secure store even in the worst case', () => {
    // 3 bytes per character is the most UTF-8 needs for one JS character.
    expect(CHUNK_SIZE * 3).toBeLessThanOrEqual(2048);
  });
});

describe('createSecureSessionStorage: saving and reading', () => {
  it('saves a big login in pieces and reads it back exactly', async () => {
    const secure = fakeSecure();
    const legacy = fakeLegacy();
    const storage = createSecureSessionStorage({ secure: secure.store, legacy: legacy.store });
    const value = bigSession();

    await storage.setItem(KEY, value);

    expect(await storage.getItem(KEY)).toBe(value);
    const pieceKeys = [...secure.data.keys()].filter((k) => k !== `${KEY}.meta`);
    expect(pieceKeys.length).toBeGreaterThan(1);
    for (const k of pieceKeys) {
      expect(utf8Bytes(secure.data.get(k)!)).toBeLessThanOrEqual(2048);
    }
    // Nothing of the login is written to the plain store.
    expect(legacy.data.size).toBe(0);
  });

  it('a second save replaces the old pieces, and sign-out deletes all', async () => {
    const secure = fakeSecure();
    const storage = createSecureSessionStorage({
      secure: secure.store,
      legacy: fakeLegacy().store,
    });
    await storage.setItem(KEY, bigSession('one'));
    await storage.setItem(KEY, 'short');

    expect(await storage.getItem(KEY)).toBe('short');
    // Only the meta note and the one new piece are left.
    expect(secure.data.size).toBe(2);

    await storage.removeItem(KEY);
    expect(secure.data.size).toBe(0);
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it('sign-out after a crash mid-save leaves no login pieces behind (cto, Q1)', async () => {
    const secure = fakeSecure();
    const storage = createSecureSessionStorage({
      secure: secure.store,
      legacy: fakeLegacy().store,
    });
    await storage.setItem(KEY, bigSession('one'));
    // Killed after all new pieces were written but before the meta switch:
    // a full set of newer tokens now sits in the other generation ("b").
    secure.store.failSetAfter = splitIntoChunks(bigSession('two')).length;
    await expect(storage.setItem(KEY, bigSession('two'))).rejects.toThrow('keychain unavailable');
    secure.store.failSetAfter = undefined;
    expect([...secure.data.keys()].some((k) => k.startsWith(`${KEY}.b.`))).toBe(true);

    await storage.removeItem(KEY);

    // Not one sb-* key is left in the secure store.
    expect([...secure.data.keys()].filter((k) => k.startsWith('sb-'))).toEqual([]);
  });

  it('a crash halfway through a save keeps the previous login', async () => {
    const secure = fakeSecure();
    const storage = createSecureSessionStorage({
      secure: secure.store,
      legacy: fakeLegacy().store,
    });
    const first = bigSession('one');
    await storage.setItem(KEY, first);

    // The keychain fails after 2 more writes: some new pieces are saved,
    // the switch (meta note) never happens.
    secure.store.failSetAfter = 2;
    await expect(storage.setItem(KEY, bigSession('two'))).rejects.toThrow('keychain unavailable');

    secure.store.failSetAfter = undefined;
    expect(await storage.getItem(KEY)).toBe(first);
  });

  it('a missing piece reads as nothing saved, not half a login', async () => {
    const secure = fakeSecure();
    const storage = createSecureSessionStorage({
      secure: secure.store,
      legacy: fakeLegacy().store,
    });
    await storage.setItem(KEY, bigSession());
    secure.data.delete(`${KEY}.a.1`);
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it('a phone that can’t decrypt the value reads as nothing saved', async () => {
    const secure = fakeSecure();
    secure.store.getItemAsync = jest.fn(async () => {
      throw new Error('could not decrypt');
    });
    const storage = createSecureSessionStorage({
      secure: secure.store,
      legacy: fakeLegacy().store,
    });
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it('runs calls one at a time, so quick saves never mix their pieces', async () => {
    const secure = fakeSecure();
    const storage = createSecureSessionStorage({
      secure: secure.store,
      legacy: fakeLegacy().store,
    });
    // Not awaited one by one: started together, like a refresh racing a
    // sign-in.
    const a = bigSession('one');
    const b = bigSession('two');
    await Promise.all([storage.setItem(KEY, a), storage.setItem(KEY, b)]);
    expect(await storage.getItem(KEY)).toBe(b);
  });
});

describe('createSecureSessionStorage: moving existing users once', () => {
  it('moves the old login, keeps the guest signed in, and deletes the old key', async () => {
    const old = bigSession('old');
    const secure = fakeSecure();
    const legacy = fakeLegacy({
      [KEY]: old,
      [`${KEY}-code-verifier`]: 'verifier',
      // Not a login key: the age-gate flag stays where it is.
      'vibecheck.ageLock.u1': '1',
    });
    const storage = createSecureSessionStorage({ secure: secure.store, legacy: legacy.store });

    // Supabase's first read on app start gets the same login: no sign-out.
    expect(await storage.getItem(KEY)).toBe(old);

    expect(legacy.data.has(KEY)).toBe(false);
    expect(legacy.data.has(`${KEY}-code-verifier`)).toBe(false);
    expect(legacy.data.get('vibecheck.ageLock.u1')).toBe('1');
    expect(await storage.getItem(`${KEY}-code-verifier`)).toBe('verifier');
    // Now it's read from the secure store only.
    expect(legacy.store.getAllKeys).toHaveBeenCalledTimes(1);
  });

  it('only Supabase login keys match the move pattern', () => {
    expect(LEGACY_AUTH_KEY.test('sb-abzcocmcqmmpfdfgogjr-auth-token')).toBe(true);
    expect(LEGACY_AUTH_KEY.test('sb-abzcocmcqmmpfdfgogjr-auth-token-code-verifier')).toBe(true);
    expect(LEGACY_AUTH_KEY.test('vibecheck.ageLock.u1')).toBe(false);
  });

  it('if the move fails, the old login is still used, then cleared by the next save', async () => {
    const old = bigSession('old');
    const secure = fakeSecure();
    secure.store.failSetAfter = 0; // the keychain refuses every write
    const legacy = fakeLegacy({ [KEY]: old });
    const storage = createSecureSessionStorage({ secure: secure.store, legacy: legacy.store });

    // No forced sign-out: the old value is kept and handed back.
    expect(await storage.getItem(KEY)).toBe(old);
    expect(legacy.data.get(KEY)).toBe(old);

    // The keychain works again; Supabase saves a refreshed login.
    secure.store.failSetAfter = undefined;
    const fresh = bigSession('fresh');
    await storage.setItem(KEY, fresh);
    expect(await storage.getItem(KEY)).toBe(fresh);
    expect(legacy.data.has(KEY)).toBe(false);
  });

  it('a newer secure copy wins over an old plain one, which is deleted', async () => {
    const secure = fakeSecure();
    const first = createSecureSessionStorage({
      secure: secure.store,
      legacy: fakeLegacy().store,
    });
    await first.setItem(KEY, 'newer');

    const legacy = fakeLegacy({ [KEY]: 'older' });
    const storage = createSecureSessionStorage({ secure: secure.store, legacy: legacy.store });
    expect(await storage.getItem(KEY)).toBe('newer');
    expect(legacy.data.has(KEY)).toBe(false);
  });

  it('sign-out clears both stores', async () => {
    const secure = fakeSecure();
    secure.store.failSetAfter = 0;
    const legacy = fakeLegacy({ [KEY]: 'old' });
    const storage = createSecureSessionStorage({ secure: secure.store, legacy: legacy.store });
    await storage.removeItem(KEY);
    expect(legacy.data.has(KEY)).toBe(false);
    expect(await storage.getItem(KEY)).toBeNull();
  });
});
