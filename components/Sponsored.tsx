'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Placement, Win } from '@/lib/ads';
import { useStore } from '@/lib/store';
import { useQuality, videoPolicy } from '@/lib/quality';

function useServed(placement: Placement, slot: string) {
  const { serveAd, ready } = useStore();
  const [win, setWin] = useState<Win | null>(null);
  const picked = useRef(false);
  useEffect(() => {
    if (!ready || picked.current) return;
    picked.current = true;
    setWin(serveAd(placement));
  }, [ready, serveAd, placement, slot]);
  return win;
}

function useImpression(win: Win | null) {
  const ref = useRef<HTMLDivElement>(null);
  const { adEvent } = useStore();
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !win) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && e.intersectionRatio >= 0.5 && !done.current) {
        // Impressão válida: 50% visível durante 1 s
        const t = setTimeout(() => { if (!done.current) { done.current = true; adEvent(win, 'imp'); } }, 1000);
        (el as HTMLElement & { _t?: ReturnType<typeof setTimeout> })._t = t;
      } else {
        clearTimeout((el as HTMLElement & { _t?: ReturnType<typeof setTimeout> })._t);
      }
    }, { threshold: [0, 0.5] });
    io.observe(el);
    return () => io.disconnect();
  }, [win, adEvent]);
  return ref;
}

function Media({ win, big }: { win: Win; big?: boolean }) {
  const ad = win.ad;
  const { level } = useQuality();
  if (ad.media && ad.format === 'imagem') return <img src={ad.media} alt={ad.headline} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />;
  if (ad.media && ad.format === 'clipe') return <video src={ad.media} className="absolute inset-0 h-full w-full object-cover" muted loop playsInline autoPlay={videoPolicy(level).autoplay} preload="none" />;
  return <span className={`absolute inset-0 flex items-center justify-center ${big ? 'text-[110px]' : 'text-6xl'}`}>{ad.emoji}</span>;
}

export function SponsoredCard({ slot }: { slot: string }) {
  const win = useServed('feed', slot);
  const ref = useImpression(win);
  const { adEvent } = useStore();
  if (!win) return null;
  const ad = win.ad;
  return (
    <div ref={ref} className="card mb-3 overflow-hidden !p-0">
      <div className="flex items-center justify-between px-3 py-2 text-xs text-white/60">
        <span>Patrocinado · {win.campaign.owner}</span>
        <Link href="/cookies" className="underline">Porquê este anúncio?</Link>
      </div>
      <div className={`relative h-40 bg-gradient-to-br ${ad.gradient}`}><Media win={win} /></div>
      <div className="flex items-center gap-3 p-3">
        <div className="flex-1"><p className="text-sm font-semibold">{ad.headline}</p><p className="text-xs text-white/70">{ad.text}</p></div>
        <Link href={ad.url} onClick={() => adEvent(win, 'click')} className="btn !px-3 !py-1.5 text-xs">{ad.cta}</Link>
      </div>
    </div>
  );
}

export function SponsoredSlide({ slot, height = 'feed-h' }: { slot: string; height?: string }) {
  const win = useServed('clipes', slot);
  const ref = useImpression(win);
  const { adEvent } = useStore();
  if (!win) return null;
  const ad = win.ad;
  return (
    <div ref={ref} className={`snap-item relative w-full overflow-hidden ${height} bg-gradient-to-br ${ad.gradient}`}>
      <Media win={win} big />
      <span className="absolute left-3 top-14 rounded bg-black/60 px-2 py-0.5 text-[11px] font-bold">PATROCINADO</span>
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 p-4 pb-20">
        <p className="text-xs text-white/60">{win.campaign.owner}</p>
        <p className="font-semibold">{ad.headline}</p>
        <p className="mb-3 text-sm text-white/80">{ad.text}</p>
        <Link href={ad.url} onClick={() => adEvent(win, 'click')} className="btn w-full">{ad.cta} ›</Link>
      </div>
    </div>
  );
}
