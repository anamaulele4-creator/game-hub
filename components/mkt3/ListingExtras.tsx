'use client';

// Página do anúncio — partes do Marketplace 3.0: comprar pelo carrinho (opções/variantes), detalhes de entrega e
// serviço, vídeos, loja, avaliações do produto (compras verificadas), produtos relacionados e denúncia.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { categoryOf } from '@/lib/market';
import type { Listing } from '@/lib/marketApi';
import { errText, fmtDate, fmtMt } from '@/lib/mkt3';
import { J, mkt3 } from '@/lib/mkt3Api';
import { ListingCard, useMarketCfg } from '@/components/market/Kit';
import { Stars } from './Bits';

export function BuyBox3({ l }: { l: Listing }) {
  const { toast, s } = useStore();
  const [variants, setVariants] = useState<J[] | null>(null);
  const [v, setV] = useState<string>('');
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  useEffect(() => { mkt3.variants(l.id).then((x) => setVariants(x.filter((y) => y.active))); void mkt3.view(l.id); }, [l.id]);
  const sel = variants?.find((x) => x.id === v);
  const hasV = (variants?.length ?? 0) > 0;
  const stock = hasV ? sel?.stock ?? 0 : l.kind === 'servico' ? 100 : l.stock;
  const price = hasV ? sel?.price_mzn ?? 0 : l.priceMzn;
  const add = async () => {
    if (!s.account.loggedIn) { toast('Entra na tua conta para comprar.'); return; }
    setBusy(true); const r = await mkt3.cartSet(l.id, hasV ? v : null, qty); setBusy(false);
    if (r.ok) { setAdded(true); toast('Adicionado ao carrinho.'); } else toast(errText(r.code));
  };
  return (
    <div className="bx-card p-4">
      {hasV ? (
        <fieldset>
          <legend className="text-[13px] font-semibold">Escolhe uma opção</legend>
          <div className="mt-2 grid gap-2">
            {variants!.map((x) => (
              <label key={x.id} className={`flex min-h-[44px] cursor-pointer items-center justify-between rounded-xl border px-3 text-[14px] ${v === x.id ? 'border-[var(--bx-acc)] bg-[var(--bx-soft)]' : 'border-[var(--bx-line)]'} ${x.stock < 1 ? 'opacity-50' : ''}`}>
                <span><input type="radio" name="variant" className="mr-2" checked={v === x.id} disabled={x.stock < 1} onChange={() => { setV(x.id); setQty(1); }} />{x.name}</span>
                <b className="tabular-nums">{fmtMt(x.price_mzn)}{x.stock < 1 ? ' · esgotado' : ''}</b>
              </label>
            ))}
          </div>
        </fieldset>
      ) : <b className="bx-acc text-2xl tabular-nums">{price > 0 ? fmtMt(price) : 'Preço a definir'}</b>}
      <p className="bx-muted mt-1 text-[13px]">{l.kind === 'servico' ? 'Serviço' : stock > 0 ? `${stock} em stock` : hasV && !sel ? '' : 'Esgotado'}</p>
      {stock > 1 && (
        <label className="mt-3 flex items-center justify-between gap-3 text-[13px] font-semibold">Quantidade
          <input type="number" min={1} max={Math.min(stock, 100)} className="bx-input !w-24 text-center" value={qty} onChange={(e) => setQty(Math.max(1, Math.min(stock, 100, Math.floor(Number(e.target.value) || 1))))} />
        </label>
      )}
      <button type="button" className="bx-btn mt-3 w-full" disabled={busy || stock < 1 || price <= 0 || (hasV && !sel)} onClick={add}>{hasV && !sel ? 'Escolhe uma opção' : 'Adicionar ao carrinho'}</button>
      {added && <Link href="/marketplace/carrinho" className="bx-ghost mt-2 w-full">Ver carrinho e pagar</Link>}
      <p className="bx-dim mt-2 text-[12px]">Pagas com o saldo da carteira; o valor fica retido até confirmares que recebeste.</p>
    </div>
  );
}

const ytId = (u: string) => u.match(/(?:v=|shorts\/|youtu\.be\/)([A-Za-z0-9_-]{6,20})/)?.[1];

export function ListingDetails3({ id, mine }: { id: string; mine: boolean }) {
  const { toast } = useStore();
  const [p, setP] = useState<J | null>(null);
  const [store, setStore] = useState<J | null>(null);
  const [reviews, setReviews] = useState<J[]>([]);
  const [rep, setRep] = useState(false);
  const [reason, setReason] = useState('');
  useEffect(() => {
    mkt3.product(id).then(async (x) => {
      setP(x);
      if (x?.store_id) { const c = await import('@/lib/supabase').then((m) => m.sb()); const { data } = await c.from('mkt_stores').select('slug,name,status').eq('id', x.store_id).maybeSingle(); setStore(data); }
    });
    mkt3.productReviews(id).then(setReviews);
  }, [id]);
  if (!p) return null;
  const svc = p.kind === 'servico';
  const rows: [string, string][] = ([
    ['Condição', p.condition === 'digital' ? 'Digital' : p.condition === 'novo' ? 'Novo' : 'Usado'],
    ['Entrega', p.delivery_info], ['Portes', p.condition !== 'digital' && p.shipping_mzn ? fmtMt(p.shipping_mzn) : ''], ['Devolução', p.return_policy],
    ...(svc ? [['Área de atendimento', p.service_area], ['Prazo de execução', p.lead_time_days ? `${p.lead_time_days} dia(s)` : ''], ['Requisitos do cliente', p.requirements],
      ['Condições de contratação', p.terms], ['Critérios de conclusão', p.completion_criteria]] : []),
    ['Publicado', p.published_at ? fmtDate(p.published_at) : ''], ['Visualizações', String(p.views ?? 0)],
  ] as [string, string][]).filter(([, v]) => v);
  const report = async () => { const r = await mkt3.report('produto', id, reason); toast(r.ok ? 'Denúncia enviada à moderação.' : errText(r.code)); if (r.ok) { setRep(false); setReason(''); } };
  return (
    <section className="mt-4 space-y-3">
      {store?.status === 'ativa' && <p className="text-[13.5px]">Loja: <Link className="bx-acc font-semibold" href={`/marketplace/loja/?s=${store.slug}`}>{store.name}</Link></p>}
      {(p.videos as string[])?.length > 0 && (
        <div className="grid gap-2">{(p.videos as string[]).map((u) => ytId(u) && (
          <iframe key={u} className="aspect-video w-full rounded-xl" src={`https://www.youtube-nocookie.com/embed/${ytId(u)}`} title="Vídeo do produto" loading="lazy" allow="encrypted-media; picture-in-picture" allowFullScreen />
        ))}</div>
      )}
      <dl className="bx-card grid gap-2 p-3 text-[13.5px] sm:grid-cols-2">
        {rows.map(([k, v]) => <div key={k}><dt className="bx-dim text-[12px]">{k}</dt><dd className="whitespace-pre-line">{v}</dd></div>)}
      </dl>
      <div>
        <h2 className="sec-title mb-2">Avaliações deste produto</h2>
        {reviews.length === 0 ? <p className="bx-muted text-sm">Ainda sem avaliações (só compradores verificados podem avaliar).</p> : (
          <ul className="space-y-2">{reviews.map((r) => (
            <li key={r.order_id} className="bx-card p-3 text-[13.5px]">
              <div className="flex justify-between"><Stars value={r.rating} /><span className="bx-dim text-[12px]">{r.buyer_name} · compra verificada</span></div>
              {r.comment && <p className="mt-1">{r.comment}</p>}
              {r.seller_reply && <p className="bx-muted mt-1 border-l-2 border-[var(--bx-acc)] pl-2">Resposta do vendedor: {r.seller_reply}</p>}
            </li>
          ))}</ul>
        )}
      </div>
      {!mine && (
        <div className="text-right">
          {!rep ? <button type="button" className="bx-dim text-[12px] underline" onClick={() => setRep(true)}>Denunciar anúncio</button> : (
            <div className="bx-card p-3 text-left">
              <textarea className="bx-input min-h-[70px] py-2" maxLength={500} aria-label="Motivo da denúncia" placeholder="Motivo (mín. 5 caracteres)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="mt-2 flex gap-2"><button type="button" className="bx-btn" disabled={reason.trim().length < 5} onClick={report}>Enviar</button><button type="button" className="bx-ghost" onClick={() => setRep(false)}>Cancelar</button></div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function Related({ id }: { id: string }) {
  const { rates } = useMarketCfg();
  const [rows, setRows] = useState<J[]>([]);
  useEffect(() => { mkt3.related(id).then(setRows); }, [id]);
  if (!rows.length) return null;
  return (
    <section className="mt-6">
      <h2 className="sec-title mb-2">Produtos relacionados</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {rows.slice(0, 8).map((p) => <ListingCard key={p.id} rates={rates} l={{ id: p.id, sellerId: '', sellerName: p.seller_name ?? '', category: p.category ?? categoryOf('outros').key, kind: p.kind, delivery: p.delivery, title: p.title, description: '',
          priceMzn: p.price_mzn ?? 0, priceCurrency: p.price_currency ?? 'MZN', priceOriginal: Number(p.price_original ?? 0), stock: p.stock ?? 0, photos: p.photos ?? [], whatsapp: '', status: 'ativo', featured: !!p.featured, sales: p.sales ?? 0, createdAt: p.created_at }} />)}
      </div>
    </section>
  );
}
