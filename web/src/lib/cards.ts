import { getSupabase, isSupabaseConfigured } from './supabaseClient';
import { mapRowToCard, CardRow } from './cardMapper';
import { CreditCard } from '../types';

export async function fetchCards(): Promise<CreditCard[]> {
  const supabase = await getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('cards')
    .select('*')
    .eq('is_active', true)
    .order('card_name', { ascending: true });

  if (error) {
    throw new Error(`Supabase fetch failed: ${error.message}`);
  }

  return ((data as CardRow[]) || []).map(mapRowToCard);
}

export { isSupabaseConfigured };
