# CardFit — SEO & Ranking Research

> Researched 2026-10-22. Market: US credit cards (159 cards in the snapshot).
> Search volumes are **not** included — no paid keyword tool was available.
> Verify every keyword in Google Keyword Planner / Ahrefs / Semrush before building pages for it.

## TL;DR

1. **Fix the four blockers before spending effort on SEO** (name, domain, SPA, trust claims) — see §1.
2. **Don't fight for "best credit card".** Three publishers (The Points Guy, NerdWallet, Bankrate)
   supply ~62% of AI citations for credit-card prompts, and the same brands own the classic SERP.
3. **Win where our data is the moat:** per-card pages, curated "A vs B" comparisons, category/issuer
   hubs, welcome-offer **history** (our crawler runs daily — nobody small has this), and calculators.
4. Finance is **YMYL**: named authors, a public methodology, sources, and "verified on" dates are
   requirements, not extras. The March 2026 core update hit anonymous finance affiliates hardest.
5. Expect **6–12 months** before meaningful organic traffic on a new domain in this niche.

---

## 1. Blockers — fix first

| # | Blocker | Why it matters | Action |
|---|---|---|---|
| 1 | **Name collision: "CardFit" already exists** | Nickels (a credit-union service org) launched a CardFit credit-card comparison site (cardfit.us) in late 2024, with press coverage and credit-union partners. A USPTO application **CARDFIT, serial 98481528** (filed 2024-04-03, Classes 35/36) covers *"a website with credit card recommendations"* — exactly this product. Applicant name not visible in the source; likely Nickels. | **Rename before building links or brand.** Every backlink and mention earned under "CardFit" is wasted if you rebrand later, and a cease-and-desist is plausible. Check the USPTO record for 98481528 yourself, and talk to a lawyer if you want to keep the name. |
| 2 | **Domain ownership** | `www.cardfit.me` still serves the original builder's bundle (`index-Dr-rM9Gv.js`, title "Cards that fit you best"). Our fixes live only on local branch `fixes/data-quality-security`. | Confirm whose domain it is. If it isn't yours, pick a new name + domain (ties into #1). The repo's `robots.txt`, `sitemap.xml` and `index.html` hard-code `cardfit.me` and need updating. |
| 3 | **Only 2 indexable URLs** | Vite SPA; sitemap lists `/` and `/compare`. Card detail is a panel, not a page. Google can render JS, but an SPA with no per-card URLs has nothing to rank for long-tail queries. | Add real routes and **pre-render them to static HTML** at build (§3). This is the single biggest SEO lever. |
| 4 | **Trust strip vs monetization** | The trust strip says "not paid to rank" / "no credit check". | Keep ranking independent of payouts (it's a real differentiator), but once affiliate links go in, reword it and add disclosures (§7). |

---

## 2. Competitive landscape

**Big publishers (don't attack head-on):** NerdWallet, The Points Guy, Bankrate, CNBC Select,
CreditCards.com, WalletHub, Forbes Advisor (hit by Google's site-reputation-abuse action in Sept 2024
and only partly recovered, which left room in the SERPs).

**Direct recommender/quiz competitors:**

| Site | Angle | Takeaway for us |
|---|---|---|
| CNBC Select quiz | 4 questions, big brand, old | Shallow; we beat it on depth |
| CardRates quiz | 3 questions, goal → card type | Shallow |
| Optimize Cards | Custom point valuations, "zero ads" | Closest on philosophy |
| RewardRank | 8-question match → ranked list | Direct competitor |
| Kudos (joinkudos.com) | "AI" recommender, 3,000+ cards, browser extension | Breadth leader; blogs heavily |
| CardCheck (India) | 7 questions, fee break-even math | Same idea, different market |

**Our differentiators (lean on these in copy and pages):**
- **Wallet-aware:** ranks the *next* card given what you already carry. Most quizzes ignore this.
- **One dollar number per card** (rewards − fee + bonus/2) with the formula published.
- **Daily-crawled data with quoted issuer evidence**, so we can be fresher than editorial sites.
- No signup and no credit check needed for recommendations.

---

## 3. Technical SEO plan (the app)

### 3.1 Routes to add (all pre-rendered)

| Route | Count | Source data |
|---|---|---|
| `/cards/{issuer}-{card-slug}` — card page | ~159 | snapshot: rates, fee, bonus, top perk, evidence quotes, insights.ts pros/cons, "similar cards" |
| `/issuers/{issuer}` — issuer hub | ~15 | group by canonical issuer |
| `/best/{category}` — e.g. groceries, gas, dining, travel, no-annual-fee, cash-back, balance-transfer, students, fair-credit, business | 15–25 | the unified dollar ranker at a stated spend profile |
| `/compare/{a}-vs-{b}` — head-to-head | **50–150, curated** | pick pairs people actually search (same issuer tiers, same category). **Do not generate all ~12,500 pairs.** That is "scaled content abuse" territory. |
| `/cards/{slug}/bonus-history` — welcome-offer history | grows over time | **needs the crawler to store offer snapshots over time** (the PRD already lists "offer vs historical average" as deferred) |
| `/tools/annual-fee-calculator`, `/tools/points-value-calculator`, `/tools/rewards-calculator` | 3–5 | existing `insights.ts` break-even + `pointValues.ts` |
| `/methodology`, `/about`, `/authors/{name}`, `/advertiser-disclosure`, `/privacy` | 5 | trust pages (§4) |

### 3.2 Rendering
- Pre-render at build: e.g. `vite-react-ssg`, or a small post-build script that renders each route
  with `react-dom/server` and writes `dist/<route>/index.html`. The daily crawler commit then
  triggers a Vercel rebuild, so pages stay fresh.
- Use real `<a href>` links for all navigation (not just onClick) so crawlers can follow them.
- Generate `sitemap.xml` from the route list at build time, with `<lastmod>` = data verification date.

### 3.3 Per-page essentials
- Unique `<title>` / meta description. Title pattern: `{Card} Review (Oct 2026): Worth the $95 Fee?`
- Canonical URL; Open Graph image (card art).
- Visible **"Details verified {date} from {issuer} — source"** line. Our crawler's quote evidence makes this real.
- Schema: `BreadcrumbList`, `Organization`, `FAQPage` (it helps with structure, but Google limits FAQ
  rich results to government/health sites since 2023, so expect no SERP feature),
  and `FinancialProduct` / `CreditCard` (schema.org has a `CreditCard` type; no rich result is
  promised). Don't add `Review` / `AggregateRating` markup unless there are genuine user reviews.
- Performance: the app already self-hosts card art. Keep LCP < 2.5s on mobile, and make sure no ad
  slots shift the layout.

### 3.4 The scraper is the SEO engine — current gaps

The crawler (`crawler/`, daily GitHub Action at 09:00 UTC) reads **issuer sites directly**:
Chase, Amex, Capital One, Citi, Discover, BofA, Wells Fargo, US Bank and others (`config/providers.yaml`).
Primary sources are a real E-E-A-T asset: we can cite the issuer's own page on every card page.
But for SEO it has these gaps:

| Gap | Effect on SEO | Fix |
|---|---|---|
| **Daily crawl never reaches the live site.** The workflow writes to Supabase, but production reads the baked `web/src/cards.snapshot.json`, which is only updated by hand. | The "fresh daily data" advantage doesn't exist yet. Pages would show stale bonuses. | Workflow step: export accepted records → snapshot JSON → **commit only if it changed** → Vercel rebuilds the pre-rendered pages. (The workflow deliberately stopped committing to avoid daily redeploys; a diff-only commit keeps that benefit.) |
| **History isn't durable.** `data/{provider}/history/{date}.json` lives in the Actions cache, which GitHub evicts (7 days unused / 10 GB cap). The `card_history` table only fills when Supabase is on. | Bonus-history pages (our best long-tail moat) have no reliable data. | Store a compact per-day offer log somewhere durable: a small `offers-history.json` committed with the snapshot, Supabase `card_history`, or a storage bucket. **Start now** — history can't be backfilled. |
| **Extraction uses Llama 3.1 8B (Groq free tier).** | Wrong fees, APRs or bonuses on a YMYL page hurt both users and rankings. | Keep `validate.py` strict. Flag big changes (fee changed, bonus ±50%) for human review before publishing. Show the evidence quote next to each figure. |
| **Coverage: 159 cards** (Kudos claims 3,000+). Gaps include Barclays, Synchrony store cards, Bilt and credit unions. | Fewer pages and fewer long-tail queries. | Add issuers after card pages exist. Quality beats count. |
| **Public offers only.** The crawler can't see targeted or elevated offers. | Bonus history will miss some highs. | Say so on the page ("public offer on issuer site"). Affiliate feeds can fill this later. |
| **Issuer terms & assets.** Most issuer ToS restrict automated access, and card art is issuer IP. | Low but real risk; affiliate networks require approved assets. | Keep the polite delay (`fetch.py` already sleeps between requests) and a clear User-Agent. Switch to network-supplied art and terms once approved. |

---

## 4. Trust & E-E-A-T (non-negotiable for finance)

Google's rater guidelines (current edition dated 2025-09-11) define YMYL by risk of harm, and
financial decisions qualify. Vendor tracking of the March 2026 core update reports finance affiliates
with unnamed or generic bylines falling 40–55%. Treat the exact number as directional, but the
direction is consistent across sources.

- **Named human author/editor** with a bio page and real credentials or experience (cards held, years in the hobby).
- **`/methodology`**: publish the ranking formula, point valuations (`pointValues.ts`), data sources,
  crawl frequency, and what we *don't* consider (credit score, issuer approval rules).
- **Source links + "verified on" dates** on every card page.
- **Corrections policy** and a contact email.
- **Advertiser disclosure** above the fold once there are affiliate links.
- Display issuer terms (APR range, fees) accurately. Getting these wrong is a real harm for YMYL.

---

## 5. Keyword & content strategy

Volumes are unverified. Use these **patterns** to seed a keyword tool, then prioritise by
(volume × winnability). Winnable = the top 10 includes small blogs, forums or Reddit.

| Tier | Pattern | Examples | Page type |
|---|---|---|---|
| A — most winnable | `{card} vs {card}` | "savor one vs quicksilver", "amex gold vs sapphire preferred" | compare |
| A | `{card} bonus history`, `{card} best offer ever` | "sapphire preferred bonus history" | bonus-history |
| A | `is {card} worth it`, `{card} annual fee worth it` | "is amex gold worth the fee" | card page + calculator |
| A | `{card} calculator`, `annual fee break even calculator` | | tools |
| B | `best card for {category} with no annual fee` | "best grocery card no annual fee" | best/ |
| B | `best card to pair with {card}` / `second card after {card}` | "best card to pair with freedom unlimited" | **wallet-aware page — our unique angle** |
| B | `{issuer} credit cards compared` | | issuer hub |
| C — hard, later | `best credit cards`, `best travel credit card` | | homepage / best/ |

**"Best card to pair with X"** directly matches the wallet-aware quiz, and big publishers serve it
poorly. Make one page per popular card, generated from the quiz ranker with that card pre-filled
in the wallet.

**Content rules:**
- Every programmatic page needs data that is unique to that page (numbers, the quiz result,
  evidence quotes), not a template with the name swapped.
- Add a short human-written verdict on the top ~30 cards and pairs. That's what separates us from scaled content.
- Refresh pages when the crawler sees an offer change, and update `lastmod`.

---

## 6. Links & distribution

| Tactic | Notes |
|---|---|
| **Original data studies** | e.g. "Welcome offers across 159 cards, Q4 2026", "Which cards changed fees this year", "Real value of a $95 fee at median US spend". Pitch to personal-finance journalists and newsletters. This is the best link source for a data site. |
| Free tools as link bait | Calculators get linked from forums, blogs and Reddit wikis naturally. An embed widget is fine, but use a **branded or nofollow** link; keyword-anchored widget links are a link scheme under Google's spam policy. |
| Reddit | r/CreditCards **bans self-promotion and self-made tools** (Rule 4), and r/churning is similar. Participate genuinely; links only where rules allow (e.g. weekly threads, if permitted). Reddit is cited in ~38% of advanced travel-card AI answers, so being genuinely helpful there matters. |
| Launch sites | Product Hunt, Hacker News (Show HN), Indie Hackers. Links are mostly nofollow, but they bring real users and press. |
| Points/miles bloggers | Doctor of Credit, Frequent Miler, and smaller blogs. Offer bonus-history data or calculators for them to cite. |
| Avoid | PBNs, paid links, link exchanges. Finance gets extra scrutiny from Google. |

---

## 7. AI search (ChatGPT, Perplexity, Gemini, AI Overviews)

- NerdWallet has said publicly that AI answers are taking organic clicks. One field study measured
  ~40% fewer outbound clicks when AI summaries show, mostly on informational queries.
- 5W's 2026 index (4,200 prompts, PR-firm methodology) found TPG, NerdWallet and Bankrate supply ~62%
  of citations, issuer sites under 6%, and Reddit is prominent for advanced travel prompts.
  Premium ($400+) cards are cited far more often.
- **What gets cited:** current, dated, specific facts. Make the key numbers machine-readable:
  a clear spec table per card, plain-text formula on `/methodology`, and dated updates.
- Allow AI crawlers in `robots.txt` (GPTBot, PerplexityBot, Google-Extended) if you want citations.
- Clicks from LLMs reportedly convert better (per NerdWallet's CEO), even though the volume is still small.

---

## 8. Monetization (and its SEO interaction)

| Option | Fit | Notes |
|---|---|---|
| **Card affiliate via a network** (CardRatings, Bankrate's network, CJ/Impact for some fintechs) | Best revenue per visitor | Issuers rarely approve small sites directly. Networks like CardRatings are the usual path, but expect quality and traffic checks (About page, privacy policy, real content, US audience). Payouts aren't public. Apply once there are ~100+ quality pages and some traffic. |
| Display ads | Weak fit | Clutters a trust product, and finance RPM only helps at volume. |
| Pro tier | Possible later | Wallet sync, offer alerts ("tell me when the CSP bonus hits 100k"). Offer alerts also bring people back and build an email list. |
| Data/API | Niche | Offer-history data could be sold to bloggers or fintechs. |

**Compliance once affiliate links go in:** FTC disclosure on every page with links (clear and near the
links, not only in the footer). Keep the ranking formula independent of payout and say so. Change
"not paid to rank" to something like "Rankings use our published formula; we may earn a commission
from some links, and that doesn't change the order." Use `rel="sponsored"` on affiliate links.

---

## 9. Measurement

- Google Search Console + Bing Webmaster Tools from day one; submit the sitemap.
- Track impressions by page type (card / compare / best / tools). Double down on whichever type gets impressions first.
- Plausible or GA4 events: quiz completions, outbound clicks per card (future affiliate CTR).

---

## 10. 90-day roadmap

| Weeks | Work |
|---|---|
| 0–1 | Resolve name + domain. Push the branch and deploy. Set up GSC and Bing. **Start durable offer-history logging and wire crawl → snapshot → rebuild.** |
| 1–3 | Per-card routes + pre-rendering + generated sitemap. Methodology, About, Author, Disclosure pages. |
| 3–5 | `/best/*` hubs, issuer hubs, 3 calculators. |
| 5–8 | 50 curated vs-pages + "best card to pair with X" pages. Human verdicts on the top 30. |
| 6–12 | Start storing offer snapshots → bonus-history pages. First data study + outreach. |
| 12+ | Apply to an affiliate network; offer-alert email list. |

---

## Sources

- Competitors: [CNBC Select quiz](https://www.cnbc.com/select/find-the-right-credit-card-quiz/), [CardRates quiz](https://www.cardrates.com/advice/best-credit-card-for-me-quiz/), [Optimize Cards](https://www.optimize-cards.com/), [RewardRank](https://www.rewardrank.com/tools/card-match-quiz), [Kudos](https://www.joinkudos.com/blog/find-your-next-credit-card), [CardCheck](https://cardcheck.in/tools/quiz)
- Name collision: [Lake Trust × CardFit (CUInsight)](https://www.cuinsight.com/press-release/lake-trust-credit-union-introduces-cardfit-to-attract-new-members-and-support-their-local-communities/), [Filene CardFit report](https://www.filene.org/reports/2025-filab-results-cardfit), [BadCredit.org on CardFit](https://www.badcredit.org/news/new-tool-helps-credit-unions-win-on-rate/), [CARDFIT trademark 98481528 (Justia)](https://trademarks.justia.com/984/81/cardfit-98481528.html)
- Forbes Advisor / site reputation abuse: [PPC Land](https://ppc.land/forbes-advisor-faces-significant-drop-in-google-search-rankings/), [BuzzStream study](https://www.buzzstream.com/blog/forbes-advisor-analysis/), [SERoundtable](https://www.seroundtable.com/google-hit-forbes-advisor-38147.html)
- AI search: [5W Credit Cards AI Visibility Index 2026](https://www.5wpr.com/ai-visibility-index/credit-cards-ai-visibility-index-2026/), [Everything-PR summary](https://everything-pr.com/credit-cards-ai-visibility-index-2026-three-publishers-control-62-percent), [Search Engine Land on NerdWallet](https://searchengineland.com/nerdwallet-organic-search-visibility-challenges-447884), [deBanked on NerdWallet](https://debanked.com/2025/08/nerdwallet-ai-answers-are-taking-organic-search-clicks-away/)
- YMYL / core updates: [Semrush on YMYL](https://www.semrush.com/blog/ymyl/), [PPC Land on rater guidelines](https://ppc.land/search-quality-rater-guidelines/), [Affiverse on March 2026 update](https://www.affiversemedia.com/googles-march-2026-core-update-hit-affiliate-sites-harder-than-any-other-category/), [serps.io HCU recovery](https://serps.io/blog/helpful-content-update-recovery)
- Affiliate programs (secondhand roundups): [Refgrow](https://refgrow.com/blog/credit-card-affiliate-program), [Lasso](https://getlasso.co/niche/banking/), [brandID](https://brandid.app/blog/best-credit-card-affiliate-programs/)
- Reddit rules (mirror, Oct 2024): [r/CreditCards](https://redlib.iamkroot.duckdns.org/r/CreditCards)
- Long-tail comparison keywords: [Siteoscope](https://www.siteoscope.com/blog/long-tail-seo-uncontested-niches)
