import { CardCredit, CreditCard, RewardRate } from '../types';

// Row shape returned by Supabase's `cards` table (see
// credit-card-crawler/supabase/schema.sql). Crawled data has no concept of
// gradients/last4 — those are purely cosmetic and derived below.
export interface CardRow {
  id: string;
  url: string;
  provider: string;
  card_name: string | null;
  issuer: string | null;
  annual_fee: number | null;
  apr_range: string | null;
  apr_intro: string | null;
  apr_regular: string | null;
  rewards_summary: string | null;
  rewards_bullets: string[] | null;
  reward_rates?: RewardRate[] | null;
  signup_bonus: string | null;
  recommended_credit_score: string | null;
  foreign_transaction_fee: string | null;
  tags: string[] | null;
  best_for: string | null;
  top_perk: string | null;
  image_url: string | null;
  retired?: boolean | null;
  balance_transfer_fee?: string | null;
  credits?: CardCredit[] | null;
}

// Physical card gradients cards are assigned from, keyed by a hash of the
// issuer name so the same issuer always renders the same way across
// cards/loads. Real fetched card art keeps issuer identity; placeholders now
// stay neutral with the rest of the interface.
const PALETTE: string[] = [
  'bg-gradient-to-br from-neutral-800 via-neutral-900 to-black',
  'bg-gradient-to-br from-neutral-400 via-neutral-600 to-neutral-800',
  'bg-gradient-to-br from-zinc-300 via-zinc-500 to-zinc-700',
  'bg-gradient-to-br from-stone-300 via-stone-500 to-stone-700',
  'bg-gradient-to-br from-slate-300 via-slate-400 to-slate-600',
  'bg-gradient-to-br from-neutral-300 via-neutral-500 to-neutral-700',
  'bg-gradient-to-br from-zinc-200 via-zinc-400 to-zinc-700',
  'bg-gradient-to-br from-slate-300 via-slate-500 to-slate-800',
  'bg-gradient-to-br from-neutral-200 via-neutral-500 to-neutral-700',
  'bg-gradient-to-br from-stone-200 via-stone-500 to-stone-700',
  'bg-gradient-to-br from-zinc-200 via-zinc-400 to-zinc-600',
  'bg-gradient-to-br from-gray-300 via-gray-500 to-gray-700',
  'bg-gradient-to-br from-neutral-300 via-neutral-500 to-neutral-800',
  'bg-gradient-to-br from-slate-300 via-slate-600 to-slate-900',
  'bg-gradient-to-br from-stone-200 via-stone-400 to-stone-600',
];

function hashString(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function gradientFor(issuer: string): string {
  return PALETTE[hashString(issuer) % PALETTE.length];
}

function last4For(seed: string): string {
  return String(hashString(seed) % 10000).padStart(4, '0');
}

function formatAnnualFee(fee: number | null): string {
  if (fee === null || fee === undefined) return 'See issuer site';
  return fee === 0 ? '$0' : `$${fee.toLocaleString()}`;
}

export function mapRowToCard(row: CardRow): CreditCard {
  const issuer = row.issuer || row.provider;
  const name = row.card_name || `${issuer} Card`;

  return {
    id: row.id,
    name,
    issuer: issuer.toUpperCase(),
    provider: row.provider,
    last4: last4For(row.url || row.id),
    tags: row.tags && row.tags.length > 0 ? row.tags : ['personal'],
    gradient: gradientFor(issuer),
    imageUrl: row.image_url || undefined,
    applyUrl: row.url || undefined,
    retired: row.retired || undefined,
    credits: row.credits?.length ? row.credits : undefined,
    facts: {
      annualFee: formatAnnualFee(row.annual_fee),
      rewards: row.rewards_summary || 'See issuer site for rewards details',
      rewardsBullets: row.rewards_bullets && row.rewards_bullets.length > 0 ? row.rewards_bullets : undefined,
      // null means the page didn't say — not "no bonus". The crawler stores
      // the literal "None" only when the issuer states there isn't one.
      bonus: row.signup_bonus || 'Not specified',
      rewardRates: row.reward_rates?.length ? row.reward_rates : undefined,
      apr: row.apr_regular || row.apr_range || 'See issuer site',
      aprIntro: row.apr_intro || undefined,
      // Un-recrawled rows have no split field yet — fall back to apr_range so
      // the Regular subsection always has something to show.
      aprRegular: row.apr_regular || row.apr_range || undefined,
      bestFor: row.best_for || 'Everyday Spend',
      creditNeeded: row.recommended_credit_score || 'Not specified',
      foreignFee: row.foreign_transaction_fee || 'Not specified',
      balanceTransferFee: row.balance_transfer_fee || undefined,
      topPerk: row.top_perk || 'See issuer site for full benefits',
    },
  };
}
