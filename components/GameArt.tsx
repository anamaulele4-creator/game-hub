'use client';

// Imagem real de um jogo (capa, flyer, cartão). Proporção fixa pelo contentor (sem saltos de layout),
// pré-visualização desfocada de 32 px enquanto carrega, srcset limitado pelo nível de qualidade,
// gradiente escuro por cima para o texto ler bem, e gradiente da marca se a imagem falhar.
import { useEffect, useRef, useState } from 'react';
import { ART, ArtId, artSrcSet, artUrl } from '@/lib/gameArt';
import { allowedWidths } from '@/lib/deviceQuality';
import { useQuality } from './QualityProvider';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export type Shade = 'none' | 'bottom' | 'left' | 'full';
const SHADES: Record<Shade, string> = {
  none: '',
  bottom: 'linear-gradient(180deg, rgba(6,10,26,0) 35%, rgba(6,10,26,.55) 65%, rgba(6,10,26,.92) 100%)',
  left: 'linear-gradient(90deg, rgba(6,10,26,.94) 0%, rgba(6,10,26,.78) 38%, rgba(6,10,26,.15) 75%, rgba(6,10,26,0) 100%), linear-gradient(0deg, rgba(6,10,26,.55), rgba(6,10,26,0) 45%)',
  full: 'linear-gradient(180deg, rgba(6,10,26,.35), rgba(6,10,26,.85))',
};

/**
 * Preenche o contentor (que deve ter posição e proporção/altura). `sizes` diz ao browser a largura no ecrã.
 * `priority` = imagem acima da dobra (carrega já, sem lazy).
 */
export function GameArt({ id, sizes = '100vw', shade = 'bottom', priority = false, className = '', pos }: {
  id: ArtId; sizes?: string; shade?: Shade; priority?: boolean; className?: string; pos?: string;
}) {
  const { tier } = useQuality();
  const a = ART[id];
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const img = useRef<HTMLImageElement>(null);
  // Imagem já em cache: o onLoad pode ter disparado antes da hidratação
  useEffect(() => { const el = img.current; if (el?.complete && el.naturalWidth) setState('ok'); }, []);
  return (
    <span className={`ga-fb absolute inset-0 block overflow-hidden ${className}`}>
      {state !== 'error' && (
        <>
          {state === 'loading' && (
            <span className="absolute inset-0 scale-110 bg-cover bg-center blur-md" style={{ backgroundImage: `url(${artUrl(BASE, id, 'lqip')})`, backgroundPosition: pos ?? a.pos }} aria-hidden />
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={img} src={artUrl(BASE, id, 480)} srcSet={artSrcSet(BASE, id, allowedWidths(tier))} sizes={sizes} alt={a.alt}
            loading={priority ? 'eager' : 'lazy'} decoding="async" {...(priority ? { fetchpriority: 'high' } : {})}
            onLoad={() => setState('ok')} onError={() => setState('error')}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${state === 'ok' ? 'opacity-100' : 'opacity-0'}`}
            style={{ objectPosition: pos ?? a.pos }} />
        </>
      )}
      {state === 'error' && (
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold uppercase tracking-[.2em] text-white/35">{a.game === 'outros' ? 'Jogos' : a.alt.split(' — ')[0]}</span>
      )}
      {shade !== 'none' && <span className="pointer-events-none absolute inset-0" style={{ background: SHADES[shade] }} aria-hidden />}
    </span>
  );
}
