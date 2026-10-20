'use client';

// Detalhe do pedido (Marketplace 3.0): estado, histórico, entrega/execução, pagamento, mensagens, reclamação e avaliação.
import Link from 'next/link';
import { Suspense, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Page } from '@/components/ui';
import { useStore } from '@/lib/store';
import { ACTION_LABEL, OrderLike, PAYMENT_STATUS, SellerAction, BuyerAction, buyerActions, errText, fmtDate, fmtMt, orderLabel, sellerActions } from '@/lib/mkt3';
import { J, mkt3, newIdem } from '@/lib/mkt3Api';
import { MarketNav, listingHref } from '@/components/market/Kit';
import { Empty, ErrorNote, Loading, Mkt3Gate, Tag, toneFor, useLoad } from '@/components/mkt3/Bits';
import { DisputeBox, OrderChat, ReviewBox } from '@/components/mkt3/Order';

export default function OrderRoute() {
  return <Suspense fallback={<main className="min-h-[70vh]" />}><OrderPage /></Suspense>;
}

const NEEDS_NOTE: Partial<Record<SellerAction | BuyerAction, string>> = {
  entregar: 'Descreve a entrega (o que entregaste e como). Fica registado como evidência:',
  pedir_revisao: 'O que precisa de ser revisto?',
  cancelar_venda: 'Motivo do cancelamento (o comprador é reembolsado na totalidade):',
};

function OrderPage() {
  const id = useSearchParams().get('id') ?? '';
  const { toast } = useStore();
  const { data, error, reload } = useLoad(() => mkt3.orderGet(id), [id]);
  const [busy, setBusy] = useState(false);
  const [ship, setShip] = useState({ carrier: '', tracking: '' });
  const payIdem = useRef(newIdem());
  const d = data as J | null;
  const o = d?.order as J | undefined;
  const role = d?.role as string | undefined;

  const act = async (a: SellerAction | BuyerAction) => {
    if (a === 'abrir_disputa') { document.getElementById('reclamacao')?.scrollIntoView({ behavior: 'smooth' }); return; }
    let note = '';
    if (NEEDS_NOTE[a]) { const v = window.prompt(NEEDS_NOTE[a]); if (v == null) return; note = v; }
    if (a === 'confirmar' && !window.confirm('Confirmas que recebeste tudo? O valor é libertado ao vendedor e não pode ser revertido.')) return;
    if (a === 'cancelar' && !window.confirm('Cancelar este pedido?')) return;
    if (a === 'enviar' && ship.carrier.trim().length < 2) { toast(errText('CARRIER')); return; }
    setBusy(true);
    const r = await mkt3.orderAction(o!.id, a, note, a === 'enviar' ? ship : {});
    setBusy(false);
    toast(r.ok ? 'Pedido atualizado.' : errText(r.code)); if (r.ok) reload();
  };
  const pay = async () => {
    setBusy(true); const r = await mkt3.pay(o!.payment_id, payIdem.current); setBusy(false);
    if (r.ok) { toast('Pagamento confirmado.'); reload(); } else { toast(errText(r.code)); payIdem.current = newIdem(); }
  };

  const teamRole = d?.team_role as string | undefined;
  const sellerSide = role === 'vendedor' || (role === 'equipa' && teamRole === 'gestor');
  // Equipa (gestor): avança o pedido mas não cancela/reembolsa (só o dono). Atendimento: só vê e responde.
  const acts: (SellerAction | BuyerAction)[] = !o ? [] : role === 'vendedor' ? sellerActions(o as OrderLike)
    : sellerSide ? sellerActions(o as OrderLike).filter((a) => a !== 'cancelar_venda') : role === 'comprador' ? buyerActions(o as OrderLike, false) : [];

  return (
    <Page title="Pedido" back="/marketplace/pedidos">
      <div className="bx">
        <MarketNav active="pedidos" />
        <Mkt3Gate allowClosed>
          {!id ? <Empty>Pedido não indicado.</Empty> : error ? <ErrorNote code={error} onRetry={reload} /> : !o ? <Loading /> : (
            <div className="space-y-4">
              <section className="bx-card p-4 text-[14px]">
                <div className="flex items-start justify-between gap-2">
                  <Link href={listingHref(o.product_id)} className="font-semibold hover:underline">{o.product_title}</Link>
                  <Tag tone={toneFor(o.status)}>{orderLabel(o.status)}</Tag>
                </div>
                <p className="bx-dim text-[12px]">Pedido {o.id.slice(0, 8)} · {fmtDate(o.created_at)} · {role === 'comprador' ? `vendedor @${d!.seller?.handle}` : `comprador @${d!.buyer?.handle}`}{d!.store ? <> · <Link className="underline" href={`/marketplace/loja/?s=${d!.store.slug}`}>{d!.store.name}</Link></> : null}{role === 'equipa' ? ` · equipa (${teamRole === 'gestor' ? 'gestor' : 'atendimento'})` : ''}</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums sm:grid-cols-3">
                  <div><dt className="bx-dim text-[12px]">Quantidade</dt><dd>{o.qty} × {fmtMt(o.unit_price_mzn)}</dd></div>
                  {o.discount_mzn > 0 && <div><dt className="bx-dim text-[12px]">Desconto</dt><dd>−{fmtMt(o.discount_mzn)}</dd></div>}
                  {o.shipping_mzn > 0 && <div><dt className="bx-dim text-[12px]">Portes</dt><dd>{fmtMt(o.shipping_mzn)}</dd></div>}
                  <div><dt className="bx-dim text-[12px]">Total</dt><dd className="font-bold">{fmtMt(o.total_mzn)}</dd></div>
                  {o.refunded_mzn > 0 && <div><dt className="bx-dim text-[12px]">Reembolsado</dt><dd>{fmtMt(o.refunded_mzn)}</dd></div>}
                  {role !== 'comprador' && o.commission_mzn != null && <>
                    <div><dt className="bx-dim text-[12px]">Comissão ({Number(o.commission_pct)}%{o.commission_fixed_mzn ? ` + ${o.commission_fixed_mzn} MT` : ''})</dt><dd>−{fmtMt(o.settled_commission_mzn ?? o.commission_mzn)}</dd></div>
                    <div><dt className="bx-dim text-[12px]">Líquido para o vendedor</dt><dd className="font-bold">{fmtMt(o.settled_net_mzn ?? o.seller_net_mzn)}</dd></div>
                  </>}
                </dl>
                {d!.payment && <p className="mt-2 text-[13px]">Pagamento: <b>{PAYMENT_STATUS[d!.payment.status] ?? d!.payment.status}</b>{d!.payment.status === 'pendente' || d!.payment.status === 'recusado' ? ` · expira ${fmtDate(d!.payment.expires_at)}` : ''}</p>}
                {o.buyer_note && <p className="bx-muted mt-2 text-[13px]">Nota do comprador: {o.buyer_note}</p>}
                {o.delivery && (o.delivery.address || o.delivery.notes || o.delivery.service_date) && role !== 'staff' && (
                  <p className="bx-muted mt-2 text-[13px]">{o.delivery.address ? <>Entrega: {o.delivery.name} · {o.delivery.phone} · {o.delivery.address}, {o.delivery.city}</> : null}{o.delivery.notes ? <> · {o.delivery.notes}</> : null}</p>
                )}
                {o.service_due_at && <p className="bx-muted mt-1 text-[13px]">Prazo do serviço: {fmtDate(o.service_due_at)}{o.revision_count ? ` · revisões pedidas: ${o.revision_count}/3` : ''}</p>}
                {o.carrier && <p className="mt-1 text-[13px]">Envio: {o.carrier}{o.tracking_code ? ` · código ${o.tracking_code}` : ''}</p>}
                {o.delivery_note && <p className="mt-1 whitespace-pre-line text-[13px]">Entrega registada: {o.delivery_note}</p>}
                {o.resolution && <p className="mt-1 text-[13px]">Decisão: {o.resolution}</p>}

                {role === 'comprador' && o.status === 'aguarda_pagamento' && (
                  <div className="mt-3 rounded-lg bg-[#F59E0B]/15 p-3 text-[13px]">
                    Falta pagar. <button type="button" className="bx-btn ml-1 !min-h-[38px]" disabled={busy} onClick={pay}>Pagar {fmtMt(o.total_mzn)} com a carteira</button>
                    <p className="bx-dim mt-1">Sem saldo? <Link className="underline" href="/carteira">Carregar a carteira</Link>.</p>
                  </div>
                )}
                {sellerSide && acts.includes('enviar') && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <input className="bx-input" aria-label="Transportadora" placeholder="Transportadora / meio" value={ship.carrier} onChange={(e) => setShip({ ...ship, carrier: e.target.value })} />
                    <input className="bx-input" aria-label="Código de acompanhamento" placeholder="Código (opcional)" value={ship.tracking} onChange={(e) => setShip({ ...ship, tracking: e.target.value })} />
                  </div>
                )}
                {acts.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {acts.map((a) => <button key={a} type="button" disabled={busy} className={['cancelar', 'cancelar_venda', 'abrir_disputa'].includes(a) ? 'bx-ghost' : 'bx-btn !min-h-[44px] !text-[14px]'} onClick={() => act(a)}>{ACTION_LABEL[a]}</button>)}
                  </div>
                )}
              </section>

              <section className="bx-card p-4 text-[13px]" aria-label="Histórico">
                <h2 className="mb-2 font-bold">Histórico</h2>
                <ol className="space-y-1.5 border-l border-[var(--bx-line)] pl-3">
                  {(d!.events as J[]).map((e, i) => <li key={i}><b>{orderLabel(e.to)}</b> <span className="bx-dim">· {fmtDate(e.at)} · {e.role}</span>{e.note ? <span className="bx-muted block">{e.note}</span> : null}</li>)}
                </ol>
              </section>

              {(role === 'comprador' || role === 'vendedor' || role === 'equipa') && <OrderChat orderId={o.id} />}
              <div id="reclamacao"><DisputeBox order={o} role={role!} onChange={reload} /></div>
              {role === 'comprador' && <ReviewBox order={o} />}
            </div>
          )}
        </Mkt3Gate>
      </div>
    </Page>
  );
}
