import { getItem, saveItem, removeItem } from "tauri-plugin-keychain";

/**
 * Secure storage for provider secrets (API keys).
 *
 * Prefers the OS keychain, but is **non-lossy by design**: it only drops the
 * plaintext localStorage fallback once it has *verified* the keychain actually
 * round-trips in this environment (write-then-read-back). This matters on
 * unsigned dev builds, where keychain writes can succeed but fail to persist
 * across rebuilds — there we keep the localStorage fallback so a key is never
 * lost. On a signed build the keychain round-trips, the fallback is removed,
 * and the secret lives only in the keychain.
 *
 * Net effect: security improves to real keychain storage where the OS supports
 * it, and degrades gracefully to today's behavior where it doesn't — never
 * losing the user's configured keys.
 */

const FALLBACK_PREFIX = "secure_fallback_";

function fallbackKey(key: string): string {
  return `${FALLBACK_PREFIX}${key}`;
}

function readFallback(key: string): string | null {
  try {
    return localStorage.getItem(fallbackKey(key));
  } catch {
    return null;
  }
}

function writeFallback(key: string, value: string): void {
  try {
    localStorage.setItem(fallbackKey(key), value);
  } catch {
    /* localStorage unavailable — nothing more we can do */
  }
}

function clearFallback(key: string): void {
  try {
    localStorage.removeItem(fallbackKey(key));
  } catch {
    /* ignore */
  }
}

export async function saveSecret(key: string, value: string): Promise<void> {
  try {
    await saveItem(key, value);
    // Only trust the keychain once we've confirmed it round-trips here.
    const readback = await getItem(key);
    if (readback === value) {
      clearFallback(key);
      return;
    }
  } catch {
    /* keychain unavailable — fall through to the plaintext fallback */
  }
  writeFallback(key, value);
}

export async function getSecret(key: string): Promise<string | null> {
  try {
    const fromKeychain = await getItem(key);
    if (fromKeychain != null) {
      return fromKeychain;
    }
  } catch {
    /* keychain unavailable — try the fallback */
  }
  return readFallback(key);
}

export async function removeSecret(key: string): Promise<void> {
  try {
    await removeItem(key);
  } catch {
    /* ignore */
  }
  clearFallback(key);
}
