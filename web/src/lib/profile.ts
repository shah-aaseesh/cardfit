// Lightweight, account-free "remember me": the Find Me a Card flow collects
// a name + email (optional) and stores the user's owned cards and stated
// preferences in localStorage, so a returning visitor on the same browser
// keeps their setup. lib/remoteProfile.ts mirrors it to Supabase, claimed by
// a per-browser secret token (an email alone is not proof of identity).
// True cross-device memory needs real auth (Supabase magic link).

export interface StoredProfile {
  name?: string;
  email?: string;
  ownedCards?: string[];
  filters?: string[];
  answers?: Record<string, unknown>;
  hasSeenCardsIntro?: boolean;
  /** Secret that claims this browser's Supabase profile (lib/remoteProfile.ts). */
  syncToken?: string;
}

const KEY = 'cardscope.profile.v1';

export function loadProfile(): StoredProfile {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveProfile(patch: StoredProfile): void {
  try {
    const next = { ...loadProfile(), ...patch };
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage disabled (private mode) — degrade to no persistence */
  }
}
