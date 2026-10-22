import { useState } from 'react';
import { CreditCard as CreditCardType } from '../types';
import { Wifi } from 'lucide-react';

interface CardVisualProps {
  card: CreditCardType;
  // 'fluid' scales the card with the viewport (used in the results carousel so
  // it fits every desktop size). 'default' is a fixed landscape face used where
  // the card is scaled by a transform. 'thumb' is a small list thumbnail
  // (search results, card pickers): fills its box, lazy-loads, and falls
  // back to a plain mini card face without text.
  variant?: 'default' | 'fluid' | 'fill' | 'thumb';
}

// Landscape card proportions (~1.586:1). Fluid variant is height-driven so the
// whole composition scales with viewport height; width follows the aspect.
const SIZE = {
  default: 'w-[360px] h-[228px] md:w-[420px] md:h-[266px]',
  // min() with 40vw keeps the whole card inside the stage on phones.
  fluid: 'h-[min(clamp(180px,23vh,300px),40vw)] aspect-[420/266]',
  fill: 'w-full h-full',
  thumb: 'w-full h-full',
} as const;

// Assets that aren't a flat card face. We rotate art 90° to stand it up in
// the portrait slot, which turns banners, logos, and angled 3D photos into
// sideways garbage — so if the URL smells like one of those, skip it and
// render the gradient face instead. Mirrors the crawler's blocklist
// (credit-card-crawler/src/fetch.py) as a client-side safety net.
const BAD_ART = /(banner|array|logo|hero|device|sphere|apple|google-?pay|paypal|wallet|icon|angled?|photo-|-photo|lifestyle|background|masthead|offer|choose|family|mobile)/i;

function isLikelyCardArt(url?: string): boolean {
  return Boolean(url) && !BAD_ART.test(url!);
}

/** Real cards don't print "Credit Card" or trademark marks on the face. */
function faceName(name: string): string {
  return name.replace(/[®™℠]/g, '').replace(/\s+(credit\s+)?card$/i, '').trim();
}

export default function CardVisual({ card, variant = 'default' }: CardVisualProps) {
  const [artFailed, setArtFailed] = useState(false);
  const [artLoaded, setArtLoaded] = useState(false);
  // Issuers publish much card art at only 250–480px. Showing it no larger
  // than 1.25x its real width keeps it crisp instead of stretched and soft.
  const [maxArtWidth, setMaxArtWidth] = useState<number | undefined>();
  const showArt = isLikelyCardArt(card.imageUrl) && !artFailed;
  const size = SIZE[variant];

  // List thumbnail: the real art when we have it, otherwise a mini violet
  // card face with just a chip (text would be unreadable at this size).
  if (variant === 'thumb') {
    return (
      <div className="relative h-full w-full overflow-hidden rounded-[0.4rem] border border-[var(--cl-ink)]">
        {showArt ? (
          <img
            src={card.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setArtFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="warm-card-face h-full w-full !border-0 p-[12%]">
            <div className="h-[34%] aspect-[5/6] rounded-[2px] bg-gradient-to-br from-amber-100 via-amber-200 to-amber-400" />
          </div>
        )}
      </div>
    );
  }

  // Real card art shown in its natural landscape orientation (flat card face,
  // ~1.586:1). Issuer art is already landscape, so no rotation is needed.
  if (showArt) {
    return (
      <div className={`relative ${size} flex items-center justify-center`}>
        {/* Card-shaped placeholder until the art decodes, so the slot never
            sits empty. */}
        {!artLoaded && (
          <div className="absolute inset-0 rounded-[1.25rem] md:rounded-[1.5rem] bg-neutral-200/70 animate-pulse" />
        )}
        <img
          src={card.imageUrl}
          alt={`${card.name} card art`}
          // Art is self-hosted and small (~12KB WebP, see
          // crawler/scripts/cache_card_art.py), so load eagerly: lazy loading
          // held back cards parked off-screen in the 3D carousel until the
          // user had already swiped to them.
          loading="eager"
          decoding="async"
          onError={() => setArtFailed(true)}
          onLoad={(e) => {
            // Flat card art is landscape at ~card proportions (1.586:1, so
            // roughly 1.3–1.75). Portrait/square images and wider ones —
            // 1200x630 og:image social banners (1.90), mastheads, offers,
            // store logos, multi-card arrays — aren't flat card faces, so
            // drop those to the gradient face instead.
            const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
            // Reject portrait/square, non-card ratios, AND anything too low-res
            // to render sharp at the ~420px slot — those fall back to the clean
            // gradient face rather than showing a blurry/undersized image.
            if (w && h && (w <= h || w / h < 1.3 || w / h > 1.8 || w < 200)) setArtFailed(true);
            else { setMaxArtWidth(Math.round(w * 1.25)); setArtLoaded(true); }
          }}
          style={variant === 'fluid' && maxArtWidth ? { maxWidth: maxArtWidth } : undefined}
          className={`relative w-full h-full ${variant === 'fill' ? 'object-cover' : 'object-contain'} [filter:saturate(1.04)_contrast(1.03)] transition-opacity duration-300 ${artLoaded ? 'opacity-100' : 'opacity-0'}`}
        />
      </div>
    );
  }

  // Fallback: the stylized gradient face, for cards the crawler hasn't
  // found art for (and all mock data).
  return (
    // Container units (cqh) scale the contents with the card itself (padding
    // is % of width: cq units on the container itself resolve to the viewport).
    <div className={`warm-card-face relative ${size} [container-type:size] rounded-[1.25rem] md:rounded-[1.5rem] overflow-hidden px-[6.5%] py-[5%] flex flex-col justify-between`}>
      {/* Texture / Noise overlay */}
      <div
        className="absolute inset-0 opacity-20 mix-blend-overlay"
        style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.85%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E")' }}
      />

      {/* Subtle radial glow */}
      <div className="absolute -top-24 -right-24 w-48 h-48 bg-white/10 blur-3xl rounded-full" />
      <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-sky-300/15 blur-3xl rounded-full" />

      {/* Top row: Issuer and Contactless icon */}
      <div className="relative flex justify-between items-start z-10">
        <span className="font-display font-bold tracking-widest text-white/80 text-[clamp(0.6rem,7.5cqh,1rem)] uppercase">{card.issuer}</span>
        <Wifi className="h-[11cqh] w-[11cqh] text-white/60 rotate-90" />
      </div>

      {/* Middle row: Chip */}
      <div className="relative z-10">
        <div className="h-[19cqh] aspect-[5/6] bg-gradient-to-br from-amber-100 via-amber-200 to-amber-400 rounded-md border border-amber-200/60 backdrop-blur-sm shadow-inner flex flex-col justify-around p-1">
          <div className="w-full h-[1px] bg-neutral-500/30"></div>
          <div className="w-full h-[1px] bg-neutral-500/30"></div>
          <div className="w-full h-[1px] bg-neutral-500/30"></div>
        </div>
      </div>

      {/* Bottom row: Name and numbers */}
      <div className="relative z-10 mt-auto">
        <div className="text-white/55 font-mono tracking-[0.3em] mb-[3.5cqh] text-[clamp(0.55rem,6cqh,0.875rem)]">
          •••• •••• •••• {card.last4}
        </div>
        <div className="text-white font-display font-semibold text-[clamp(0.8rem,10.5cqh,1.6rem)] leading-[1.08] line-clamp-2">
          {faceName(card.name)}
        </div>
      </div>
    </div>
  );
}
