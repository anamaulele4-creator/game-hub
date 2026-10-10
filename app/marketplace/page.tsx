'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Page } from '@/components/ui';
import { IS_DEMO } from '@/lib/config';
import { MARKET_CATEGORIES, categoryOf } from '@/lib/market';
import { Listing, Review, marketApi } from '@/lib/marketApi';
import { CategoryTile, ExampleNote, ListingCard, MarketNav, Stars, useMarketCfg } from '@/components/market/Kit';

export default function MarketplacePage() {
  const { rates } = useMarketCfg();
  const [cat, setCat] = useState<string | null>(null);
  const [list, setList] = useState<Listing[] | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  useEffect(() => {
    const read = () => setCat(new URLSearchParams(window.location.search).get('c'));
    read(); window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);
  useEffect(() => {
    marketApi.listings().then(setList).catch(() => setList([]));
    marketApi.recentReviews().then(setReviews).catch(() => {});
  }, []);
  const pick = (c: string | null) => { setCat(c); history.pushState(null, '', c ? `?c=${c}` : location.pathname); window.scrollTo({ top: 0 }); };

  const inCat = (list ?? []).filter((l) => !cat || l.category === cat);
  const featured = inCat.filter((l) => l.featured);
  const popular = [...inCat].sort((a, b) => b.sales - a.sales || b.createdAt.localeCompare(a.createdAt));
  const c = cat ? categoryOf(cat) : null;

  return (
    <Page title="Marketplace">
      <div className="bx">
        <MarketNav active="inicio" />
        {IS_DEMO && <div className="mb-3"><ExampleNote /></div>}

        <section className="mb-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="sec-title">{c ? c.name : 'Categorias populares'}</h2>
            {c && <button type="button" className="bx-acc min-h-[44px] text-sm font-semibold" onClick={() => pick(null)}>Todas</button>}
          </div>
          {!c && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {MARKET_CATEGORIES.map((x) => (
                <CategoryTile key={x.key} name={x.name} art={x.art} href={`/marketplace/?c=${x.key}`} onClick={() => pick(x.key)} />
              ))}
            </div>
          )}
        </section>

        {!list ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((k) => <div key={k} className="bx-card aspect-[3/4] animate-pulse" />)}</div> : (
          <>
            {inCat.length === 0 && <p className="bx-card p-5 text-center text-sm">Ainda não há anúncios{c ? ` em ${c.name}` : ''}. <Link href="/marketplace/anunciar" className="bx-acc font-semibold">Anuncia o primeiro</Link>.</p>}
            {featured.length > 0 && <Shelf title="Em destaque" items={featured} rates={rates} />}
            {popular.length > 0 && <Shelf title={c ? 'Anúncios' : 'Mais populares'} items={c ? popular : popular.slice(0, 12)} rates={rates} grid />}
          </>
        )}

        {!c && (
          <section className="mt-6">
            <h2 className="sec-title mb-2">Avaliações recentes</h2>
            {reviews.length === 0 ? <p className="bx-card bx-muted p-4 text-sm">As avaliações aparecem depois das primeiras compras concluídas.</p> : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {reviews.map((r) => (
                  <li key={r.orderId} className="bx-card p-3 text-[13.5px]">
                    <div className="flex items-center justify-between gap-2"><b className="truncate">{r.buyerName}</b><Stars value={r.rating} /></div>
                    {r.comment && <p className="bx-muted mt-1">{r.comment}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <footer className="bx-dim mt-8 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[12.5px]">
          <Link href="/marketplace/como-funciona" className="min-h-[44px] content-center">Como funciona</Link>
          <Link href="/marketplace/tarifas" className="min-h-[44px] content-center">Tarifas e prazos</Link>
          <Link href="/marketplace/reembolsos" className="min-h-[44px] content-center">Política de reembolso</Link>
        </footer>
      </div>
    </Page>
  );
}

function Shelf({ title, items, rates, grid }: { title: string; items: Listing[]; rates: ReturnType<typeof useMarketCfg>['rates']; grid?: boolean }) {
  return (
    <section className="mb-6">
      <h2 className="sec-title mb-2">{title}</h2>
      {grid ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{items.map((l) => <ListingCard key={l.id} l={l} rates={rates} />)}</div>
      ) : (
        <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4">{items.map((l) => <div key={l.id} className="w-[46%] shrink-0 sm:w-[220px]"><ListingCard l={l} rates={rates} /></div>)}</div>
      )}
    </section>
  );
}
