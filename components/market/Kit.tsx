'use client';

// Peças partilhadas do marketplace (cartões, preço com câmbio, estrelas, galeria).
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Photo } from '@/components/Photo';
import type { ArtId } from '@/lib/gameArt';
import { Currency, MznRates, categoryOf, fmtMoney, fromMzn, kindName } from '@/lib/market';
import { DEFAULT_MARKET_SETTINGS, Listing, MarketSettings, fetchRates, marketApi } from '@/lib/marketApi';

export const listingHref = (id: string) => `/marketplace/anuncio/?id=${encodeURIComponent(id)}`;

/** Definições do marketplace + câmbio (cache 12 h). */
export function useMarketCfg() {
  const [settings, setSettings] = useState<MarketSettings>(DEFAULT_MARKET_SETTINGS);
  const [rates, setRates] = useState<MznRates | null>(null);
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    marketApi.settings().catch(() => DEFAULT_MARKET_SETTINGS).then(async (s) => {
      if (!live) return; setSettings(s);
      const r = await fetchRates(s.fxOverride); if (live) { setRates(r.rates); setAt(r.at); }
    });
    return () => { live = false; };
  }, []);
  return { settings, rates, ratesAt: at };
}

export function Price({ l, rates, big }: { l: Pick<Listing, 'priceMzn' | 'priceCurrency' | 'priceOriginal'>; rates: MznRates | null; big?: boolean }) {
  if (l.priceMzn <= 0) return <span className={`font-bold text-white/80 ${big ? 'text-xl' : 'text-[14px]'}`}>Preço a definir</span>;
  const second: Currency = l.priceCurrency !== 'MZN' ? l.priceCurrency : 'BRL';
  const approx = l.priceCurrency !== 'MZN' ? l.priceOriginal : rates ? fromMzn(l.priceMzn, 'BRL', rates) : null;
  return (
    <span className="flex flex-col">
      <b className={`bx-acc tabular-nums ${big ? 'text-2xl' : 'text-[15px]'}`}>{fmtMoney(l.priceMzn, 'MZN')}</b>
      {approx != null && approx > 0 && <span className="bx-dim text-[11.5px] tabular-nums">≈ {fmtMoney(approx, second)}</span>}
    </span>
  );
}

export function Stars({ value, size = 14 }: { value: number | null; size?: number }) {
  if (value == null) return <span className="bx-dim text-[12px]">Sem avaliações</span>;
  const full = Math.round(value);
  return (
    <span className="inline-flex items-center gap-1" aria-label={`${value} de 5 estrelas`}>
      <span style={{ fontSize: size }} className="tracking-tight text-[#FFC20E]" aria-hidden>{'★★★★★'.slice(0, full)}<span className="text-white/25">{'★★★★★'.slice(full)}</span></span>
      <span className="text-[12px] font-semibold tabular-nums">{value.toFixed(1)}</span>
    </span>
  );
}

export function ListingCard({ l, rates, href }: { l: Listing; rates: MznRates | null; href?: string }) {
  const cat = categoryOf(l.category);
  return (
    <Link href={href ?? listingHref(l.id)} className="bx-card flex min-w-0 flex-col overflow-hidden transition-colors hover:border-[var(--bx-acc)]">
      <span className="relative block aspect-[4/3] w-full"><Photo src={l.photos[0]} fallback={cat.art} alt={l.title} sizes="(min-width: 1024px) 240px, 46vw" /></span>
      <span className="flex flex-1 flex-col gap-1 p-2.5">
        <span className="bx-muted truncate text-[11.5px]">{cat.name} · {kindName(l.kind)}</span>
        <span className="line-clamp-2 text-[13.5px] font-semibold leading-snug">{l.title}</span>
        <span className="mt-auto flex items-end justify-between gap-2 pt-1">
          <Price l={l} rates={rates} />
          {l.delivery === 'automatica' && <span className="bx-tag shrink-0 bg-[#16A34A]/90 text-white">Automática</span>}
        </span>
      </span>
    </Link>
  );
}

export function CategoryTile({ name, art, href, active, onClick }: { name: string; art: ArtId; href: string; active?: boolean; onClick?: () => void }) {
  return (
    <Link href={href} onClick={onClick ? (e) => { e.preventDefault(); onClick(); } : undefined} aria-current={active ? 'page' : undefined} className={`relative block aspect-[4/3] overflow-hidden rounded-xl border ${active ? 'border-[var(--bx-acc)]' : 'border-[var(--bx-line)]'}`}>
      <Photo src={null} fallback={art} alt={name} shade="bottom" sizes="(min-width: 1024px) 180px, 31vw" />
      <span className="absolute inset-x-0 bottom-0 p-2 text-[12.5px] font-bold leading-tight [text-shadow:0_1px_6px_rgba(0,0,0,.7)]">{name}</span>
    </Link>
  );
}

export function Gallery({ photos, fallback, alt }: { photos: string[]; fallback: ArtId; alt: string }) {
  const [i, setI] = useState(0);
  const touch = useRef<number | null>(null);
  const list = photos.length ? photos : [''];
  const go = (k: number) => setI(((k % list.length) + list.length) % list.length);
  return (
    <div>
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-[var(--bx-line)]"
        onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => { const x = touch.current; touch.current = null; if (x == null) return; const dx = e.changedTouches[0].clientX - x; if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1)); }}>
        <Photo src={list[i] || null} fallback={fallback} alt={`${alt} — foto ${i + 1}`} priority sizes="(min-width: 768px) 560px, 100vw" />
        {list.length > 1 && <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[12px] tabular-nums">{i + 1}/{list.length}</span>}
      </div>
      {list.length > 1 && (
        <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto">
          {list.map((p, k) => (
            <button key={k} type="button" onClick={() => setI(k)} aria-label={`Foto ${k + 1}`} aria-current={k === i}
              className={`relative h-14 w-[72px] shrink-0 overflow-hidden rounded-lg border-2 ${k === i ? 'border-[var(--bx-acc)]' : 'border-transparent'}`}>
              <Photo src={p || null} fallback={fallback} alt="" sizes="72px" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function MarketNav({ active }: { active: 'inicio' | 'anunciar' | 'pedidos' | 'info' }) {
  const items: [typeof active, string, string][] = [['inicio', 'Marketplace', '/marketplace'], ['anunciar', 'Anunciar', '/marketplace/anunciar'], ['pedidos', 'Os meus pedidos', '/marketplace/pedidos'], ['info', 'Como funciona', '/marketplace/como-funciona']];
  return (
    <nav className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4" aria-label="Marketplace">
      {items.map(([k, l, h]) => <Link key={k} href={h} aria-current={active === k ? 'page' : undefined} className={`bx-chip !min-h-[40px] !text-[13px] ${active === k ? '!border-[var(--bx-acc)] !bg-[var(--bx-acc)] !font-bold !text-[var(--bx-on)]' : ''}`}>{l}</Link>)}
    </nav>
  );
}

export function ExampleNote() {
  return <span className="bx-tag border border-white/25 bg-black/30 uppercase text-white/85">Dados de exemplo</span>;
}
