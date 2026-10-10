'use client';

// Foto de capa/produto. Sem foto (ou se falhar) mostra a arte oficial do jogo — nunca uma caixa vazia.
import { useState } from 'react';
import type { ArtId } from '@/lib/gameArt';
import { ART } from '@/lib/gameArt';
import { allowedWidths } from '@/lib/deviceQuality';
import { artRefId, isArtRef, mediaSrcSet } from '@/lib/media';
import { GameArt, Shade } from './GameArt';
import { useQuality } from './QualityProvider';

export function Photo({ src, fallback, alt, sizes = '100vw', shade = 'none', priority = false }: {
  src?: string | null; fallback: ArtId; alt: string; sizes?: string; shade?: Shade; priority?: boolean;
}) {
  const { tier } = useQuality();
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <GameArt id={fallback} shade={shade} sizes={sizes} priority={priority} />;
  if (isArtRef(src)) {
    const id = artRefId(src) as ArtId;
    return <GameArt id={ART[id] ? id : fallback} shade={shade} sizes={sizes} priority={priority} />;
  }
  return (
    <span className="absolute inset-0 block overflow-hidden bg-[#0B1B4D]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} srcSet={mediaSrcSet(src, allowedWidths(tier))} sizes={sizes} alt={alt} loading={priority ? 'eager' : 'lazy'} decoding="async"
        onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
      {shade !== 'none' && <span className="pointer-events-none absolute inset-0" style={{ background: shade === 'bottom' ? 'linear-gradient(180deg, rgba(6,10,26,0) 35%, rgba(6,10,26,.92) 100%)' : shade === 'left' ? 'linear-gradient(90deg, rgba(6,10,26,.94) 0%, rgba(6,10,26,.15) 75%)' : 'linear-gradient(180deg, rgba(6,10,26,.35), rgba(6,10,26,.85))' }} aria-hidden />}
    </span>
  );
}
