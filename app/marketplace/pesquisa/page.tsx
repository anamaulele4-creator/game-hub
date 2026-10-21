'use client';

// Pesquisa e descoberta (Marketplace 3.0): produtos, serviços, lojas e criadores — só dados reais publicados.
import Link from 'next/link';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Page } from '@/components/ui';
import { Photo } from '@/components/Photo';
import { MARKET_CATEGORIES, LISTING_KINDS, categoryOf, fmtMoney, kindName } from '@/lib/market';
import { pushHistory } from '@/lib/mkt3';
import { J, mkt3 } from '@/lib/mkt3Api';
import { MarketNav, listingHref } from '@/components/market/Kit';
import { Empty, ErrorNote, Loading, Mkt3Gate } from '@/components/mkt3/Bits';

const TYPES = [['produtos', 'Produtos'], ['servicos', 'Serviços'], ['lojas', 'Lojas'], ['criadores', 'Criadores']] as const;
const SORTS = [['relevancia', 'Relevância'], ['recentes', 'Mais recentes'], ['populares', 'Populares'], ['preco_asc', 'Preço ↑'], ['preco_desc', 'Preço ↓']] as const;
const HIST_KEY = 'txap-mkt3-search-history';

export default function SearchRoute() {
  return <Suspense fallback={<main className="min-h-[70vh]" />}><SearchPage /></Suspense>;
}

function SearchPage() {
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [type, setType] = useState<string>(sp.get('t') ?? 'produtos');
  const [cat, setCat] = useState<string>(sp.get('c') ?? '');
  const [kind, setKind] = useState<string>('');
  const [sort, setSort] = useState<string>('relevancia');
  const [min, setMin] = useState(''); const [max, setMax] = useState('');
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<J | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sugg, setSugg] = useState<J | null>(null);
  const [hist, setHist] = useState<string[]>([]);
  const [saveHist, setSaveHist] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { try { const h = JSON.parse(localStorage.getItem(HIST_KEY) ?? 'null'); if (h) { setHist(h.items ?? []); setSaveHist(h.on !== false); } } catch {} }, []);
  const persist = (items: string[], on: boolean) => { try { localStorage.setItem(HIST_KEY, JSON.stringify({ items, on })); } catch {} };

  const run = async (p = 1) => {
    setErr(null); setRes(null); setPage(p);
    const r = await mkt3.search({ q, type, category: cat || null, kind: type === 'produtos' ? kind || null : null, sort, min: min ? Number(min) : null, max: max ? Number(max) : null, page: p, size: 24 });
    if (!r.ok) { setErr(r.code); return; }
    setRes(r);
    if (saveHist && q.trim()) { const h = pushHistory(hist, q); setHist(h); persist(h, true); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void run(1); }, [type, cat, kind, sort]);
  useEffect(() => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) { setSugg(null); return; }
    timer.current = setTimeout(() => { mkt3.suggest(q).then((r) => setSugg(r.ok ? r : null)); }, 250);
  }, [q]);

  const total = Number(res?.total ?? 0); const pages = Math.max(1, Math.ceil(total / 24));
  const rows: J[] = res?.rows ?? [];

  return (
    <Page title="Pesquisar" back="/marketplace">
      <div className="bx">
        <MarketNav active="pesquisa" />
        <Mkt3Gate>
          <form className="relative" role="search" onSubmit={(e) => { e.preventDefault(); setSugg(null); void run(1); }}>
            <label htmlFor="mkt3-q" className="sr-only">Pesquisar no marketplace</label>
            <input id="mkt3-q" className="bx-input" placeholder="Produtos, serviços, lojas ou criadores" value={q} maxLength={80} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
            {sugg && (sugg.products?.length || sugg.stores?.length) ? (
              <ul className="bx-card absolute inset-x-0 top-[50px] z-20 max-h-72 overflow-auto p-1 text-[14px]">
                {(sugg.products as string[]).map((t) => <li key={'p' + t}><button type="button" className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/10" onClick={() => { setQ(t); setSugg(null); }}>{t}</button></li>)}
                {(sugg.stores as J[]).map((s) => <li key={'s' + s.slug}><Link className="block rounded-lg px-3 py-2 hover:bg-white/10" href={`/marketplace/loja/?s=${encodeURIComponent(s.slug)}`}>Loja · {s.name}</Link></li>)}
              </ul>
            ) : null}
          </form>
          {hist.length > 0 && !q && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
              {hist.map((h) => <button key={h} type="button" className="bx-chip !min-h-[36px] !text-[13px]" onClick={() => setQ(h)}>{h}</button>)}
              <button type="button" className="bx-dim underline" onClick={() => { setHist([]); persist([], saveHist); }}>Apagar histórico</button>
            </div>
          )}
          <label className="bx-dim mt-2 flex items-center gap-2 text-[12px]"><input type="checkbox" checked={saveHist} onChange={(e) => { setSaveHist(e.target.checked); persist(e.target.checked ? hist : [], e.target.checked); if (!e.target.checked) setHist([]); }} /> Guardar histórico de pesquisas neste dispositivo</label>

          <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4" role="tablist">
            {TYPES.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={type === k} className="bx-chip !min-h-[40px] !text-[13px]" onClick={() => setType(k)}>{l}</button>)}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <select aria-label="Categoria" className="bx-input" value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">Todas as categorias</option>
              {MARKET_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
            </select>
            {type === 'produtos' && (
              <select aria-label="Tipo" className="bx-input" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="">Todos os tipos</option>
                {LISTING_KINDS.map((k) => <option key={k.key} value={k.key}>{k.name}</option>)}
              </select>
            )}
            <select aria-label="Ordenar" className="bx-input" value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {(type === 'produtos' || type === 'servicos') && (
              <div className="col-span-2 flex gap-2 sm:col-span-1">
                <input aria-label="Preço mínimo (MT)" className="bx-input" inputMode="numeric" placeholder="Mín. MT" value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ''))} onBlur={() => void run(1)} />
                <input aria-label="Preço máximo (MT)" className="bx-input" inputMode="numeric" placeholder="Máx. MT" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} onBlur={() => void run(1)} />
              </div>
            )}
          </div>

          <div className="mt-4" aria-live="polite">
            {err ? <ErrorNote code={err} onRetry={() => void run(page)} /> : !res ? <Loading /> : rows.length === 0 ? <Empty>Sem resultados. Experimenta outras palavras ou filtros.</Empty> : (
              <>
                <p className="bx-dim mb-2 text-[12px]">{total} resultado(s)</p>
                {(type === 'produtos' || type === 'servicos') && (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {rows.map((p) => (
                      <Link key={p.id} href={listingHref(p.id)} className="bx-card flex min-w-0 flex-col overflow-hidden hover:border-[var(--bx-acc)]">
                        <span className="relative block aspect-[4/3]"><Photo src={p.photos?.[0]} fallback={categoryOf(p.category).art} alt={p.title} sizes="(min-width: 1024px) 240px, 46vw" /></span>
                        <span className="flex flex-1 flex-col gap-1 p-2.5">
                          <span className="bx-muted truncate text-[11.5px]">{categoryOf(p.category).name} · {kindName(p.kind)}</span>
                          <span className="line-clamp-2 text-[13.5px] font-semibold">{p.title}</span>
                          <span className="bx-dim truncate text-[11.5px]">{p.store_slug ? 'Loja' : 'Vendedor'}: {p.seller_name}</span>
                          <b className="bx-acc mt-auto text-[15px] tabular-nums">{p.has_variants ? 'Desde ' : ''}{p.price_mzn > 0 ? fmtMoney(p.price_mzn, 'MZN') : 'Preço por opção'}</b>
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
                {type === 'lojas' && (
                  <ul className="space-y-2">
                    {rows.map((s) => (
                      <li key={s.id}><Link href={`/marketplace/loja/?s=${encodeURIComponent(s.slug)}`} className="bx-card flex items-center gap-3 p-3 hover:border-[var(--bx-acc)]">
                        <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl"><Photo src={s.logo_url} fallback="outros" alt="" sizes="48px" /></span>
                        <span className="min-w-0 flex-1"><b className="block truncate">{s.name}</b><span className="bx-muted line-clamp-1 text-[12.5px]">{s.description || categoryOf(s.category).name}</span></span>
                        <span className="bx-dim text-right text-[12px]">{s.products} produto(s){s.rating ? <><br />★ {s.rating}</> : null}</span>
                      </Link></li>
                    ))}
                  </ul>
                )}
                {type === 'criadores' && (
                  <ul className="space-y-2">
                    {rows.map((c) => (
                      <li key={c.id} className="bx-card flex items-center gap-3 p-3">
                        <span className="min-w-0 flex-1"><b className="block truncate">{c.display_name} <span className="bx-dim font-normal">@{c.handle}</span></b><span className="bx-muted line-clamp-1 text-[12.5px]">{c.bio}</span></span>
                        {c.store_slug ? <Link className="bx-ghost" href={`/marketplace/loja/?s=${encodeURIComponent(c.store_slug)}`}>Ver loja</Link> : <span className="bx-dim text-[12px]">{c.products} produto(s)</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {pages > 1 && (
                  <nav className="mt-4 flex items-center justify-center gap-3" aria-label="Paginação">
                    <button type="button" className="bx-ghost" disabled={page <= 1} onClick={() => void run(page - 1)}>Anterior</button>
                    <span className="text-[13px] tabular-nums">{page} / {pages}</span>
                    <button type="button" className="bx-ghost" disabled={page >= pages} onClick={() => void run(page + 1)}>Seguinte</button>
                  </nav>
                )}
              </>
            )}
          </div>
        </Mkt3Gate>
      </div>
    </Page>
  );
}
