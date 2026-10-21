'use client';

// Página pública da loja (Marketplace 3.0): perfil comercial do criador/vendedor, políticas, avaliações e produtos.
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Page } from '@/components/ui';
import { Photo } from '@/components/Photo';
import { categoryOf } from '@/lib/market';
import { STORE_STATUS } from '@/lib/mkt3';
import { J, mkt3 } from '@/lib/mkt3Api';
import { useStore } from '@/lib/store';
import { ListingCard, MarketNav, useMarketCfg } from '@/components/market/Kit';
import { Empty, ErrorNote, Loading, Mkt3Gate, Tag, useLoad } from '@/components/mkt3/Bits';
import type { Listing } from '@/lib/marketApi';

export default function StoreRoute() {
  return <Suspense fallback={<main className="min-h-[70vh]" />}><StorePage /></Suspense>;
}

const toListing = (p: J): Listing => ({
  id: p.id, sellerId: '', sellerName: p.seller_name ?? '', category: p.category, kind: p.kind, delivery: p.delivery, title: p.title, description: '', priceMzn: p.price_mzn ?? 0,
  priceCurrency: p.price_currency ?? 'MZN', priceOriginal: Number(p.price_original ?? 0), stock: p.stock ?? 0, photos: p.photos ?? [], whatsapp: '', status: 'ativo', featured: !!p.featured,
  sales: p.sales ?? 0, createdAt: p.created_at,
});

function StorePage() {
  const slug = useSearchParams().get('s') ?? '';
  const { rates } = useMarketCfg();
  const { toast } = useStore();
  const { data, error, reload } = useLoad(() => mkt3.storePublic(slug), [slug]);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const d = data as J | null;
  const st = d?.store as J | undefined;

  const report = async () => {
    const r = await mkt3.report('loja', st!.id, reason);
    toast(r.ok ? 'Denúncia enviada à moderação.' : (r.code === 'ALREADY' ? 'Já denunciaste esta loja.' : 'Não foi possível enviar.'));
    if (r.ok) { setReporting(false); setReason(''); }
  };

  return (
    <Page title={st?.name ?? 'Loja'} back="/marketplace/pesquisa?t=lojas">
      <div className="bx">
        <MarketNav active="pesquisa" />
        <Mkt3Gate>
          {!slug ? <Empty>Loja não indicada.</Empty> : error ? <ErrorNote code={error} onRetry={reload} /> : !d ? <Loading /> : (
            <>
              <div className="relative aspect-[3/1] w-full overflow-hidden rounded-2xl border border-[var(--bx-line)]">
                <Photo src={st!.cover_url} fallback={categoryOf(st!.category).art} alt="" shade="bottom" priority sizes="(min-width: 768px) 720px, 100vw" />
              </div>
              <div className="-mt-8 flex items-end gap-3 px-2">
                <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl border-2 border-[var(--bx-card)] bg-[var(--bx-card)]"><Photo src={st!.logo_url} fallback="outros" alt={`Logótipo de ${st!.name}`} sizes="64px" /></span>
                <div className="min-w-0 flex-1 pb-1">
                  <h1 className="truncate text-xl font-bold">{st!.name}</h1>
                  <p className="bx-muted text-[12.5px]">por {d.owner?.display_name} <span className="bx-dim">@{d.owner?.handle}</span>{d.owner?.verified ? ' · verificado' : ''}</p>
                </div>
                {st!.status !== 'ativa' && <Tag tone="warn">{STORE_STATUS[st!.status]}</Tag>}
              </div>
              <p className="mt-2 px-2 text-[13px]">{d.rating?.count ? <>★ {d.rating.avg} · {d.rating.count} avaliação(ões)</> : <span className="bx-dim">Sem avaliações</span>}{st!.location ? <span className="bx-dim"> · {st!.location}</span> : null}</p>
              {st!.description && <p className="bx-card mt-3 whitespace-pre-line p-3 text-[14px]">{st!.description}</p>}

              <h2 className="mb-2 mt-5 text-[15px] font-bold">Produtos e serviços</h2>
              {(d.products as J[]).length === 0 ? <Empty>Esta loja ainda não tem produtos publicados.</Empty> : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {(d.products as J[]).map((p) => <ListingCard key={p.id} l={toListing(p)} rates={rates} />)}
                </div>
              )}

              <details className="bx-card mt-5 p-3 text-[13.5px]">
                <summary className="cursor-pointer font-semibold">Informações da loja e políticas</summary>
                <dl className="mt-2 space-y-2">
                  {[['Informações comerciais', st!.business_info], ['Horário', st!.hours], ['Entregas', st!.delivery_policy], ['Devoluções', st!.return_policy], ['Contacto', st!.contact_public]]
                    .filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="bx-dim text-[12px]">{k}</dt><dd className="whitespace-pre-line">{v}</dd></div>)}
                  <div><dt className="bx-dim text-[12px]">Pagamento</dt><dd>Saldo da carteira TXAPILOG (carregada por M-Pesa/e-Mola). O valor fica retido até confirmares a receção.</dd></div>
                </dl>
              </details>
              <div className="mt-3 text-right">
                {!reporting ? <button type="button" className="bx-dim text-[12px] underline" onClick={() => setReporting(true)}>Denunciar loja</button> : (
                  <div className="bx-card p-3 text-left">
                    <textarea className="bx-input min-h-[80px] py-2" maxLength={500} placeholder="Motivo (mín. 5 caracteres)" value={reason} onChange={(e) => setReason(e.target.value)} />
                    <div className="mt-2 flex gap-2"><button type="button" className="bx-btn" disabled={reason.trim().length < 5} onClick={report}>Enviar denúncia</button><button type="button" className="bx-ghost" onClick={() => setReporting(false)}>Cancelar</button></div>
                  </div>
                )}
              </div>
              <p className="mt-4 text-center"><Link className="bx-acc text-[13px] font-semibold" href="/marketplace/pesquisa?t=lojas">Ver outras lojas</Link></p>
            </>
          )}
        </Mkt3Gate>
      </div>
    </Page>
  );
}
