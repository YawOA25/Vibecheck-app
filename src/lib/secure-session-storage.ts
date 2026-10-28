/**
 * Where the phone keeps the login (batch Q1, privacy and security).
 *
 * What it does: gives Supabase a small "storage" object (getItem, setItem,
 * removeItem) that keeps the login session in the phone's SECURE store
 * (iPhone Keychain, Android Keystore, through expo-secure-store) instead of
 * plain AsyncStorage, which is an unencrypted file another app or a backup
 * tool could read on a rooted / jailbroken phone.
 *
 * Why it's more than one line:
 *   1. Size. SecureStore is meant for small values: about 2 KB each. A
 *      Supabase session (two tokens plus the user record) is often bigger,
 *      so a value is cut into pieces ("chunks") of at most CHUNK_SIZE
 *      characters, each saved under its own key, plus one small "meta" key
 *      that says how many pieces there are. This is the usual chunking
 *      pattern for SecureStore.
 *   2. Crash safety. Saving 5 pieces isn't one step. If the app were killed
 *      halfway, the pieces could be a mix of old and new, and the login would
 *      be lost. So pieces are written under one of two "generations" (a or b,
 *      taking turns): the new pieces go under the unused letter, THEN the meta
 *      key is switched to it in one write, THEN the old pieces are deleted.
 *      Killed at any point, the meta key still names a complete set.
 *   3. Moving existing users (one time). People signed in before this change
 *      have their login in AsyncStorage. The first time Supabase asks for
 *      anything, every old Supabase login key ("sb-...-auth-token...") is
 *      copied into the secure store and then deleted from AsyncStorage. They
 *      stay signed in. If the copy fails (rare: the keychain is unavailable),
 *      the old value is left where it is and still used, so nobody is signed
 *      out; the move is tried again on the next launch.
 *   4. One thing at a time. Supabase may save and read at nearly the same
 *      moment (for example a token refresh as the app opens). Each call
 *      waits for the one before, so two saves can't mix their pieces.
 *
 * The web build has no secure store, so src/lib/supabase.ts keeps using
 * AsyncStorage (the browser's localStorage) there.
 *
 * Tested in __tests__/secure-session-storage.test.ts with in-memory fakes.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/**
 * Most characters in one piece. SecureStore's limit is about 2048 BYTES.
 * A JavaScript character takes at most 3 bytes in UTF-8 (emoji are two
 * "characters" of 2 bytes each in that count), so 600 characters is at most
 * 1800 bytes: safely under the limit even for unusual text. A normal session
 * is plain ASCII, so it's about 4 to 8 pieces.
 */
export const CHUNK_SIZE = 600;

/**
 * How many pieces per generation sign-out always deletes, even when the
 * meta note says fewer (see removeSecure). 16 x 600 characters is about
 * 9.6 KB, well above a Supabase session (about 4 to 8 pieces), so it also
 * catches a bigger set orphaned by a crash.
 */
export const SWEEP_PIECES = 16;

/**
 * Which old AsyncStorage keys are Supabase login data, to move once. Supabase
 * names its key "sb-<project id>-auth-token" (plus "-code-verifier" or
 * "-user" endings for other sign-in styles), so the pattern catches all of
 * them and nothing else the app keeps (such as the age-gate flag).
 */
export const LEGACY_AUTH_KEY = /^sb-.+-auth-token/;

/** The three calls Supabase needs from a storage object. */
export type SessionStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

/** The parts of expo-secure-store we use (so tests can pass a fake). */
export type SecureBackend = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
};

/** The parts of AsyncStorage we use (the old, plain store). */
export type LegacyBackend = {
  getAllKeys: () => Promise<readonly string[]>;
  getItem: (key: string) => Promise<string | null>;
  removeItem: (key: string) => Promise<void>;
};

/**
 * Cuts a text into pieces of at most `size` characters.
 *
 * Input: the text, and the most characters per piece.
 * Returns: the pieces in order (an empty list for an empty text).
 * Edge case: an emoji is stored as two JavaScript characters (a "surrogate
 * pair"). Cutting between them would save half an emoji, which the secure
 * store can garble, so a cut that would land there moves back by one.
 */
export function splitIntoChunks(value: string, size: number = CHUNK_SIZE): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(start + size, value.length);
    if (end < value.length) {
      const last = value.charCodeAt(end - 1);
      // 0xD800-0xDBFF is the FIRST half of a surrogate pair.
      if (last >= 0xd800 && last <= 0xdbff) end -= 1;
    }
    chunks.push(value.slice(start, end));
    start = end;
  }
  return chunks;
}

/** Which set of pieces is current ("a" or "b") and how many it has. */
type Meta = { gen: 'a' | 'b'; count: number };

/** The key holding the meta note for a value's key. */
const metaKey = (key: string) => `${key}.meta`;
/** The key of piece number `index` in generation `gen`. */
const chunkKey = (key: string, gen: string, index: number) => `${key}.${gen}.${index}`;

/**
 * Reads a meta note such as "a:5".
 * Input: the stored text (or null). Returns: { gen, count }, or null when
 * there's no note or it isn't in that shape (treated as "nothing saved").
 */
function parseMeta(raw: string | null): Meta | null {
  const match = raw ? /^([ab]):(\d+)$/.exec(raw) : null;
  return match ? { gen: match[1] as 'a' | 'b', count: Number(match[2]) } : null;
}

/**
 * Builds the storage object Supabase uses.
 *
 * Inputs (all have phone defaults; tests pass fakes):
 *   secure     the secure store (expo-secure-store)
 *   legacy     the old plain store (AsyncStorage), only read to move old
 *              logins and cleared of them
 *   chunkSize  most characters per piece
 * Returns: { getItem, setItem, removeItem }, all asynchronous, as Supabase
 * expects.
 */
export function createSecureSessionStorage({
  secure = defaultSecureBackend,
  legacy = AsyncStorage as unknown as LegacyBackend,
  chunkSize = CHUNK_SIZE,
}: {
  secure?: SecureBackend;
  legacy?: LegacyBackend;
  chunkSize?: number;
} = {}): SessionStorage {
  // The line every call waits in (point 4 above).
  let queue: Promise<unknown> = Promise.resolve();
  // The one-time move from AsyncStorage (point 3), started on first use.
  let migration: Promise<void> | null = null;

  /**
   * Runs `task` after every earlier call has finished, success or not.
   * Input: the work to do. Returns: the work's own answer (or error).
   */
  function inLine<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    // The next call waits for this one, but mustn't fail because it failed.
    queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Reads a value from the secure store, joining its pieces.
   * Input: the key. Returns: the text, or null when nothing complete is
   * saved, including when the phone can't decrypt it (for example data
   * restored onto a new phone).
   */
  async function readSecure(key: string): Promise<string | null> {
    try {
      const meta = parseMeta(await secure.getItemAsync(metaKey(key)));
      if (!meta) return null;
      const pieces: string[] = [];
      for (let i = 0; i < meta.count; i += 1) {
        const piece = await secure.getItemAsync(chunkKey(key, meta.gen, i));
        // A missing piece means the set isn't whole: don't hand back half a
        // login (Supabase would fail to read it anyway).
        if (piece === null) return null;
        pieces.push(piece);
      }
      return pieces.join('');
    } catch {
      return null;
    }
  }

  /**
   * Saves a value in the secure store, crash-safely (point 2 above).
   * Inputs: the key and the text. Returns: nothing. Throws if the secure
   * store refuses, so a login is never quietly kept in plain text instead.
   */
  async function writeSecure(key: string, value: string): Promise<void> {
    let old: Meta | null = null;
    try {
      old = parseMeta(await secure.getItemAsync(metaKey(key)));
    } catch {
      // Unreadable old note (e.g. restored backup): write a fresh set.
    }
    const gen = old?.gen === 'a' ? 'b' : 'a';
    const pieces = splitIntoChunks(value, chunkSize);
    for (let i = 0; i < pieces.length; i += 1) {
      await secure.setItemAsync(chunkKey(key, gen, i), pieces[i]);
    }
    // The switch: one small write makes the new set the current one.
    await secure.setItemAsync(metaKey(key), `${gen}:${pieces.length}`);
    if (old) await deletePieces(key, old);
  }

  /**
   * Deletes one generation's pieces. Inputs: the key and that generation.
   * Returns: nothing. Errors are ignored: a leftover piece holds nothing
   * usable once the meta note no longer points at it, and the next save
   * overwrites it.
   */
  async function deletePieces(key: string, meta: Meta): Promise<void> {
    for (let i = 0; i < meta.count; i += 1) {
      await secure.deleteItemAsync(chunkKey(key, meta.gen, i)).catch(() => undefined);
    }
  }

  /**
   * Deletes a value from the secure store (sign-out). Input: the key.
   * Returns: nothing. The meta note goes first, so a half-finished delete
   * reads as "nothing saved" rather than a broken login.
   *
   * Why it sweeps BOTH generations (cto review, Q1): if the app was killed
   * during a save, after the new pieces were written but before the meta
   * switch, a full set of newer tokens sits in the OTHER generation, which
   * the meta note doesn't point at. Deleting only the current set would
   * leave those tokens behind, and on iPhone the keychain even survives
   * uninstalling the app. So sign-out deletes pieces 0 up to
   * max(current count, SWEEP_PIECES) in both "a" and "b". Deleting a key
   * that isn't there is harmless; errors are ignored.
   */
  async function removeSecure(key: string): Promise<void> {
    let meta: Meta | null = null;
    try {
      meta = parseMeta(await secure.getItemAsync(metaKey(key)));
    } catch {
      // Unreadable: still sweep everything below.
    }
    await secure.deleteItemAsync(metaKey(key)).catch(() => undefined);
    const upTo = Math.max(meta?.count ?? 0, SWEEP_PIECES);
    await deletePieces(key, { gen: 'a', count: upTo });
    await deletePieces(key, { gen: 'b', count: upTo });
  }

  /**
   * The one-time move of old logins out of AsyncStorage (point 3 above).
   * Inputs: none. Returns: nothing; never throws (a failure leaves the old
   * value in place to be used and moved next time).
   */
  async function moveLegacyLogins(): Promise<void> {
    let keys: readonly string[] = [];
    try {
      keys = await legacy.getAllKeys();
    } catch {
      return;
    }
    for (const key of keys.filter((k) => LEGACY_AUTH_KEY.test(k))) {
      try {
        const value = await legacy.getItem(key);
        // If the secure store already has this key (a newer save, or a move
        // that got this far before), the secure copy wins; only delete.
        if (value !== null && (await readSecure(key)) === null) {
          await writeSecure(key, value);
        }
        // Only reached when the secure copy is in place (or there was
        // nothing to copy), so deleting can't lose the login.
        await legacy.removeItem(key);
      } catch {
        // Leave this key in AsyncStorage; getItem still falls back to it.
      }
    }
  }

  /** Starts the move on first use and returns the same promise after. */
  function migrated(): Promise<void> {
    migration ??= moveLegacyLogins();
    return migration;
  }

  return {
    /**
     * Supabase asks for a saved value. Input: the key. Returns: the text or
     * null. Falls back to the old AsyncStorage value only when the move
     * failed, so a guest is never signed out by this change.
     */
    getItem: (key) =>
      inLine(async () => {
        await migrated();
        const value = await readSecure(key);
        if (value !== null) return value;
        try {
          return await legacy.getItem(key);
        } catch {
          return null;
        }
      }),
    /**
     * Supabase saves a value (sign-in, token refresh). Inputs: key, text.
     * Returns: nothing. Also clears any plain-text copy of the same key
     * left by a failed move.
     */
    setItem: (key, value) =>
      inLine(async () => {
        await migrated();
        await writeSecure(key, value);
        await legacy.removeItem(key).catch(() => undefined);
      }),
    /**
     * Supabase deletes a value (sign-out). Input: the key. Returns: nothing.
     * Clears both stores, so no old plain-text copy survives a sign-out.
     */
    removeItem: (key) =>
      inLine(async () => {
        await migrated();
        await removeSecure(key);
        await legacy.removeItem(key).catch(() => undefined);
      }),
  };
}

/**
 * Options for every secure-store call: readable after the phone's first
 * unlock since it was turned on (so a token refresh right as the app opens
 * works), and kept on THIS phone only (not copied to a new phone through an
 * iCloud backup; there the guest signs in again).
 */
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/** expo-secure-store with the options above filled in. */
const defaultSecureBackend: SecureBackend = {
  getItemAsync: (key) => SecureStore.getItemAsync(key, SECURE_OPTIONS),
  setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, SECURE_OPTIONS),
  deleteItemAsync: (key) => SecureStore.deleteItemAsync(key, SECURE_OPTIONS),
};

/** The storage object the app's Supabase client uses on phones. */
export const secureSessionStorage = createSecureSessionStorage();
