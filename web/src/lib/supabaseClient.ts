import type { SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

let client: Promise<SupabaseClient | null> | undefined;

/**
 * The Supabase client, loaded on first use. The SDK (auth, storage,
 * realtime...) is ~800KB of source; importing it dynamically keeps it out of
 * the main bundle, and it's never downloaded at all when Supabase isn't
 * configured (production currently runs on the committed snapshot).
 *
 * Only the anon (public, read-only-by-RLS) key ever ships to the browser.
 * Writes are performed exclusively by the crawler using the service_role
 * key on the backend — see crawler/.env.example.
 */
export function getSupabase(): Promise<SupabaseClient | null> {
  if (!isSupabaseConfigured) return Promise.resolve(null);
  client ??= import('@supabase/supabase-js').then(({ createClient }) => createClient(url, anonKey));
  return client;
}
