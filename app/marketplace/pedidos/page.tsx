'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Page } from '@/components/ui';
import { useStore } from '@/lib/store';
import { ORDER_LABEL, OrderAction, PAY_DISABLED, Role, actionsFor, fmtMoney } from '@/lib/market';
import { MARKET_ERR, Order, marketApi } from '@/lib/marketApi';
import { MarketNav, listingHref } from '@/components/market/Kit';
import { J, mkt3, useMkt3 } from '@/lib/mkt3Api';
import { fmtDate, fmtMt, orderLabel } from '@/lib/mkt3';
import { Tag, toneFor } from '@/components/mkt3/Bits';

const ACTION_LABEL: Partial<Record<OrderAction, string>> = {
  entregar: 'Marcar como entregue', confirmar_rececao: 'Confirmar que recebi', abrir_disputa: 'Abrir disputa', cancelar: 'Cancelar pedido',
};
const NEEDS_NOTE: Partial<Record<OrderAction, string>> = { abrir_disputa: 'Explica o que aconteceu (mín. 5 caracteres):', entregar: 'Nota de entrega para o comprador (opcional):' };

export default function PedidosPage() {
  const { toast } = useStore();
  const [me, setMe] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [rate, setRate] = useState<Record<string, { stars: number; text: string }>>({});
  const m3 = useMkt3();
  const [side, setSide] = useState<'compras' | 'vendas'>('compras');
  const [v3, setV3] = useState<J[] | null>(null);
  const [v3ids, setV3ids] = useState<Set<string>>(new Set());
  // Pedidos do Marketplace 3.0 têm página própria; a lista antiga mostra só os pedidos da compra segura anterior.
  useEffect(() => {
    if (!m3.installed) return;
    mkt3.ordersMine(side).then((r) => setV3(r.ok ? r.rows : []));
  }, [m3.installed, side]);
  useEffect(() => {
    if (!m3.installed) return;
    Promise.all([mkt3.ordersMine('compras'), mkt3.ordersMine('vendas')]).then(([a, b]) => setV3ids(new Set([...(a.ok ? a.rows : []), ...(b.ok ? b.rows : [])].map((x: J) => x.id))));
  }, [m3.installed]);
  const load = useCallback(() => { marketApi.orders('mine').then(setOrders).catch(() => setOrders([])); }, []);
  useEffect(() => { marketApi.me().then(setMe); load(); }, [load]);

  const act = async (o: Order, a: OrderAction, role: Role) => {
    let note = '';
    if (NEEDS_NOTE[a]) { const v = window.prompt(NEEDS_NOTE[a]); if (v == null) return; note = v; }
    if (a === 'confirmar_rececao' && !window.confirm('Confirmas que recebeste tudo? O valor é libertado ao vendedor.')) return;
    const r = await marketApi.orderAction(o.id, a, note, role).catch((e) => ({ ok: false as const, code: (e as Error).message }));
    toast(r.ok ? 'Pedido atualizado.' : MARKET_ERR[r.code] ?? r.code); if (r.ok) load();
  };
  const review = async (o: Order) => {
    const x = rate[o.id]; if (!x?.stars) return;
    const r = await marketApi.review(o.id, x.stars, x.text);
    toast(r.ok ? 'Obrigado pela avaliação.' : MARKET_ERR[r.code] ?? r.code); if (r.ok) load();
  };

  return (
    <Page title="Os meus pedidos" back="/marketplace">
      <div className="bx">
        <MarketNav active="pedidos" />
        {m3.installed && (m3.open || (v3 && v3.length > 0) || v3ids.size > 0) && (
          <section className="mb-5" aria-label="Pedidos do marketplace">
            <div className="mb-3 flex gap-2" role="tablist">
              {(['compras', 'vendas'] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={side === k} className="bx-chip !min-h-[40px] !text-[13px]" onClick={() => setSide(k)}>{k === 'compras' ? 'Compras' : 'Vendas'}</button>)}
            </div>
            {!v3 ? <div className="bx-card h-20 animate-pulse" /> : v3.length === 0 ? <p className="bx-card p-4 text-center text-[13.5px] bx-muted">{side === 'compras' ? 'Ainda não fizeste compras pelo carrinho.' : 'Ainda não tens vendas.'}</p> : (
              <ul className="space-y-2">
                {v3.map((o) => (
                  <li key={o.id}><Link href={`/marketplace/pedido/?id=${o.id}`} className="bx-card flex items-center gap-3 p-3 text-[13.5px] hover:border-[var(--bx-acc)]">
                    <span className="min-w-0 flex-1"><b className="line-clamp-1">{o.product_title}</b><span className="bx-dim block text-[12px]">{fmtDate(o.created_at)} · @{o.other_handle}</span></span>
                    <span className="text-right"><b className="block tabular-nums">{fmtMt(side === 'vendas' ? o.seller_net_mzn : o.total_mzn)}</b><Tag tone={toneFor(o.status)}>{orderLabel(o.status)}</Tag></span>
                  </Link></li>
                ))}
              </ul>
            )}
            <h2 className="mb-2 mt-5 text-[14px] font-bold">Compra segura (pedidos anteriores)</h2>
          </section>
        )}
        {!orders ? <div className="bx-card h-24 animate-pulse" /> : orders.filter((o) => !v3ids.has(o.id)).length === 0 ? (
          <p className="bx-card p-5 text-center text-sm">Ainda não tens pedidos. <Link href="/marketplace" className="bx-acc font-semibold">Ver anúncios</Link></p>
        ) : (
          <ul className="space-y-3">
            {orders.filter((o) => !v3ids.has(o.id)).map((o) => {
              const role: Role = o.buyerId === me ? 'comprador' : 'vendedor';
              const acts = actionsFor(o.status, role).filter((a) => ACTION_LABEL[a]);
              return (
                <li key={o.id} className="bx-card p-3.5 text-[13.5px]">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={listingHref(o.productId)} className="min-w-0 font-semibold hover:underline">{o.productTitle}</Link>
                    <span className="bx-tag shrink-0 bg-white/15 text-white">{role === 'comprador' ? 'Compra' : 'Venda'}</span>
                  </div>
                  <p className="bx-muted mt-0.5">{o.qty} × {fmtMoney(o.unitPriceMzn, 'MZN')} = <b className="text-white">{fmtMoney(o.totalMzn, 'MZN')}</b></p>
                  <p className="mt-1 font-semibold">{ORDER_LABEL[o.status]}</p>
                  {o.status === 'aguarda_pagamento' && <p className="mt-1 text-[12.5px] text-[#FFB38A]">{PAY_DISABLED}</p>}
                  {o.deliveryNote && <p className="bx-muted mt-1">Entrega: {o.deliveryNote}</p>}
                  {o.disputeReason && <p className="bx-muted mt-1">Disputa: {o.disputeReason}</p>}
                  {o.resolution && <p className="bx-muted mt-1">Decisão: {o.resolution}</p>}
                  {acts.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {acts.map((a) => <button key={a} type="button" className={a === 'abrir_disputa' || a === 'cancelar' ? 'bx-ghost' : 'bx-btn !min-h-[44px] !text-[14px]'} onClick={() => act(o, a, role)}>{ACTION_LABEL[a]}</button>)}
                    </div>
                  )}
                  {o.status === 'concluido' && role === 'comprador' && (
                    <div className="mt-3 border-t border-[var(--bx-line)] pt-3">
                      <p className="text-[13px] font-semibold">Avaliar o vendedor</p>
                      <div className="mt-1 flex gap-1" role="radiogroup" aria-label="Estrelas">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button key={n} type="button" role="radio" aria-checked={rate[o.id]?.stars === n} aria-label={`${n} estrelas`} onClick={() => setRate({ ...rate, [o.id]: { stars: n, text: rate[o.id]?.text ?? '' } })}
                            className={`h-11 w-11 text-2xl ${n <= (rate[o.id]?.stars ?? 0) ? 'text-[#FFC20E]' : 'text-white/25'}`}>★</button>
                        ))}
                      </div>
                      <input className="bx-input mt-1" maxLength={500} placeholder="Comentário (opcional)" value={rate[o.id]?.text ?? ''} onChange={(e) => setRate({ ...rate, [o.id]: { stars: rate[o.id]?.stars ?? 0, text: e.target.value } })} />
                      <button type="button" className="bx-ghost mt-2" disabled={!rate[o.id]?.stars} onClick={() => review(o)}>Enviar avaliação</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Page>
  );
}
