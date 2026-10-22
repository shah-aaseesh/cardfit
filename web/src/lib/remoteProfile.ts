// "Remember me" backed by Supabase, layered on top of the localStorage
// profile (lib/profile.ts). Same StoredProfile shape.
//
// There's no auth, and an email alone is not a credential — anyone can type
// anyone's address. So each profile is claimed by a random secret token this
// browser generates on first save and keeps in localStorage (syncToken). Both
// RPCs (get_user_profile / upsert_user_profile, see
// crawler/supabase/schema.sql) require email + token; the server stores only
// the token's hash. A stranger who knows your email gets nothing back and
// can't overwrite your profile.
//
// Every call degrades to a no-op when Supabase isn't configured, so the app
// works identically on the committed snapshot with no backend.

import { supabase } from './supabaseClient';
import { loadProfile, saveProfile, StoredProfile } from './profile';

const emailKey = (email?: string) => (email || '').trim().toLowerCase();

function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** This browser's profile token, created (and persisted) on first use. */
function syncToken(create: boolean): string | undefined {
  const existing = loadProfile().syncToken;
  if (existing || !create) return existing;
  const token = newToken();
  saveProfile({ syncToken: token });
  return token;
}

/** Fetch a saved profile by email + this browser's token. Returns null if
 *  none / no token / not configured. */
export async function loadRemoteProfile(email: string): Promise<StoredProfile | null> {
  const key = emailKey(email);
  const token = syncToken(false);
  if (!supabase || !key || !token) return null;
  try {
    const { data, error } = await supabase.rpc('get_user_profile', { p_email: key, p_token: token });
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return {
      name: row.name ?? undefined,
      email: key,
      ownedCards: (row.owned_cards as string[]) ?? [],
      filters: (row.filters as string[]) ?? [],
      answers: (row.answers as Record<string, unknown>) ?? {},
    };
  } catch {
    return null; // network/CORS/misconfig — stay silent, localStorage still works
  }
}

/** Upsert the user's profile, keyed by email and claimed by this browser's
 *  token. No-op without an email. */
export async function saveRemoteProfile(p: StoredProfile): Promise<void> {
  const key = emailKey(p.email);
  if (!supabase || !key) return;
  try {
    await supabase.rpc('upsert_user_profile', {
      p_email: key,
      p_token: syncToken(true),
      p_name: p.name ?? null,
      p_owned_cards: p.ownedCards ?? [],
      p_filters: p.filters ?? [],
      p_answers: p.answers ?? {},
    });
  } catch {
    /* best-effort — localStorage remains the source of truth on failure */
  }
}
