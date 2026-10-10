'use client';

// Foto/logótipo da equipa; sem foto, monograma com as iniciais numa cor fixa por equipa (nunca uma caixa vazia).
import { useState } from 'react';
import { initials } from '@/lib/jogos';
import { allowedWidths } from '@/lib/deviceQuality';
import { mediaSrcSet } from '@/lib/media';
import { useQuality } from './QualityProvider';

const PALETTE = ['#1E3A8A', '#B45309', '#047857', '#7C2D12', '#6D28D9', '#0E7490', '#9D174D', '#3F6212', '#334155', '#A16207'];
export function teamColor(name: string): string {
  let h = 0;
  for (const ch of name.trim().toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function TeamBadge({ name, logo, size = 32 }: { name: string; logo?: string | null; size?: number }) {
  const { tier } = useQuality();
  const [bad, setBad] = useState(false);
  const box = { width: size, height: size };
  if (logo && !bad) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logo} srcSet={mediaSrcSet(logo, allowedWidths(tier))} sizes={`${size}px`} alt={`Logótipo ${name}`} loading="lazy" decoding="async" onError={() => setBad(true)}
        className="shrink-0 rounded-full bg-white/10 object-cover ring-1 ring-white/15" style={box} />
    );
  }
  return (
    <span aria-label={name} role="img" className="flex shrink-0 select-none items-center justify-center rounded-full font-bold text-white ring-1 ring-white/20"
      style={{ ...box, background: teamColor(name), fontSize: Math.max(10, Math.round(size * 0.38)) }}>
      {initials(name)}
    </span>
  );
}
