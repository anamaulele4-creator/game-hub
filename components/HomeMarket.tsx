'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Photo } from '@/components/Photo';
import { listingHref } from '@/components/market/Kit';
import { categoryOf, fmtMoney, kindName } from '@/lib/market';
import type { Listing } from '@/lib/marketApi';

const STEP = 6;

function HomeListingCard({ l }: { l: Listing }) {
  const cat = categoryOf(l.category);
  return (
    <Link href={listingHref(l.id)} className="card flex min-w-0 flex-col !p-2.5">
      <span className="relative block aspect-[16/10] w-full overflow-hidden rounded-xl">
        <Photo src={l.photos[0]} fallback={cat.art} alt={l.title} sizes="(min-width: 1024px) 320px, 46vw" />
        {l.delivery === 'automatica' && (
          <span className="absolute left-2 top-2 rounded-md bg-[#16A34A] px-1.5 py-0.5 text-[10.5px] font-bold text-white">Automática</span>
        )}
      </span>
      <span className="mt-2.5 flex flex-1 flex-col gap-1 px-1">
        <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-white/55">{cat.name} · {kindName(l.kind)}</span>
        <span className="line-clamp-2 text-[15px] font-bold leading-snug">{l.title}</span>
      </span>
      <span className="mt-3 flex overflow-hidden rounded-lg">
        <span className="stat-num flex flex-1 items-center bg-[#FFC20E] px-3 py-2 text-[15px] text-ink">
          {l.priceMzn > 0 ? fmtMoney(l.priceMzn, 'MZN') : 'Preço a definir'}
        </span>
        <span className="flex items-center bg-white/10 px-3.5 text-[13px] font-semibold">Ver</span>
      </span>
    </Link>
  );
}

export function HomeMarket({ listings, className = '' }: { listings: Listing[] | null; className?: string }) {
  const [n, setN] = useState(STEP);
  return (
    <section className={className}>
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="sec-title">Destaques do marketplace</h2>
        <Link href="/marketplace" className="min-h-[44px] content-center text-sm font-semibold text-neon2">Ver tudo</Link>
      </div>
      {!listings ? <div className="card h-40 animate-pulse" />
        : listings.length === 0 ? <p className="card text-sm text-white/70">Ainda sem anúncios.</p>
        : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {listings.slice(0, n).map((l) => <HomeListingCard key={l.id} l={l} />)}
            </div>
            <div className="mt-4 flex justify-center">
              {n < listings.length
                ? <button type="button" onClick={() => setN((v) => v + STEP)} className="btn-ghost !min-h-[44px] px-8">Ver mais</button>
                : <Link href="/marketplace" className="btn-ghost !min-h-[44px] px-8">Ver todo o marketplace</Link>}
            </div>
          </>
        )}
    </section>
  );
}