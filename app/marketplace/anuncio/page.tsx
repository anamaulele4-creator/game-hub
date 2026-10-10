'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Page, Sheet } from '@/components/ui';
import { useStore } from '@/lib/store';
import { IS_DEMO } from '@/lib/config';
import { PAY_DISABLED, TBD, avgRating, categoryOf, feeOf, fmtMoney, kindName } from '@/lib/market';
import { Listing, MARKET_ERR, Question, Review, marketApi } from '@/lib/marketApi';
import { ExampleNote, Gallery, MarketNav, Price, Stars, useMarketCfg } from '@/components/market/Kit';

export default function ListingPage() {
  const { toast, s } = useStore();
  const { rates, settings } = useMarketCfg();
  const [id, setId] = useState('');
  const [data, setData] = useState<{ listing: Listing | null; questions: Question[]; reviews: Review[] } | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [buy, setBuy] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const load = useCallback((x: string) => { marketApi.listing(x).then(setData).catch(() => setData({ listing: null, questions: [], reviews: [] })); }, []);
  useEffect(() => { const x = new URLSearchParams(window.location.search).get('id') ?? ''; setId(x); load(x); marketApi.me().then(setMe).catch(() => {}); }, [load]);

  const l = data?.listing;
  if (data && !l) return <Page title="Anúncio" back="/marketplace"><p className="card mt-4 text-center text-sm">Anúncio não encontrado ou já retirado.</p></Page>;
  const cat = l ? categoryOf(l.category) : null;
  const rating = avgRating((data?.reviews ?? []).map((r) => r.rating));
  const mine = !!l && !!me && l.sellerId === me;
  const total = l ? l.priceMzn * qty : 0;
  const fee = feeOf(total, settings.feePct);

  const startOrder = async () => {
    if (!l) return;
    if (!IS_DEMO && !s.account.loggedIn) { toast('Entra na tua conta para comprar.'); return; }
    const r = await marketApi.createOrder(l.id, qty).catch((e) => ({ ok: false as const, code: (e as Error).message }));
    if (r.ok) { setOrderId(r.id ?? null); setBuy(true); } else toast(MARKET_ERR[r.code] ?? r.code);
  };
  const ask = async () => {
    const r = await marketApi.ask(id, q).catch((e) => ({ ok: false as const, code: (e as Error).message }));
    if (r.ok) { setQ(''); load(id); toast('Pergunta enviada ao vendedor.'); } else toast(MARKET_ERR[r.code] ?? r.code);
  };
  const answer = async (qid: string) => {
    const r = await marketApi.answer(qid, answers[qid] ?? '');
    if (r.ok) { load(id); toast('Resposta publicada.'); } else toast(MARKET_ERR[r.code] ?? r.code);
  };

  return (
    <Page title="Anúncio" back="/marketplace">
      <div className="bx">
        <MarketNav active="inicio" />
        {!l || !cat ? <div className="bx-card aspect-[4/3] animate-pulse" /> : (
          <div className="grid gap-5 md:grid-cols-[1fr_340px]">
            <div className="min-w-0">
              <Gallery photos={l.photos} fallback={cat.art} alt={l.title} />
              {IS_DEMO && <div className="mt-2"><ExampleNote /></div>}
              <h1 className="mt-3 text-[20px] font-bold leading-snug">{l.title}</h1>
              <p className="bx-muted mt-1 text-[13px]">{cat.name} · {kindName(l.kind)} · Entrega {l.delivery === 'automatica' ? 'automática' : 'manual'}</p>
              {l.description && <p className="mt-3 whitespace-pre-line text-[14.5px] leading-relaxed">{l.description}</p>}

              <section className="mt-6">
                <h2 className="sec-title mb-2">Perguntas ao vendedor</h2>
                {!mine && (
                  <div className="mb-3 flex gap-2">
                    <input className="bx-input flex-1" value={q} maxLength={500} placeholder="Escreve a tua pergunta" onChange={(e) => setQ(e.target.value)} aria-label="Pergunta" />
                    <button type="button" className="bx-btn shrink-0 !px-4" disabled={q.trim().length < 3} onClick={ask}>Enviar</button>
                  </div>
                )}
                {data!.questions.length === 0 ? <p className="bx-muted text-sm">Ainda sem perguntas.</p> : (
                  <ul className="space-y-2">
                    {data!.questions.map((x) => (
                      <li key={x.id} className="bx-card p-3 text-[13.5px]">
                        <p><b>{x.askerName}:</b> {x.question}</p>
                        {x.answer ? <p className="bx-muted mt-1">↳ <b className="text-white">Vendedor:</b> {x.answer}</p>
                          : mine ? (
                            <div className="mt-2 flex gap-2">
                              <input className="bx-input flex-1" value={answers[x.id] ?? ''} placeholder="Responder" onChange={(e) => setAnswers({ ...answers, [x.id]: e.target.value })} aria-label="Resposta" />
                              <button type="button" className="bx-ghost shrink-0" disabled={!(answers[x.id] ?? '').trim()} onClick={() => answer(x.id)}>Responder</button>
                            </div>
                          ) : <p className="bx-dim mt-1 text-[12px]">A aguardar resposta</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <aside className="space-y-3 md:sticky md:top-[80px] md:self-start">
              <div className="bx-card p-4">
                <Price l={l} rates={rates} big />
                <p className="bx-muted mt-1 text-[13px]">{l.stock > 0 ? `${l.stock} em stock` : 'Esgotado'}</p>
                {mine ? (
                  <Link href={`/marketplace/anunciar/?id=${l.id}`} className="bx-btn mt-3 w-full">Editar anúncio</Link>
                ) : (
                  <>
                    {l.stock > 1 && (
                      <label className="mt-3 flex items-center justify-between gap-3 text-[13px] font-semibold">Quantidade
                        <input type="number" min={1} max={Math.min(l.stock, 100)} className="bx-input !w-24 text-center" value={qty} onChange={(e) => setQty(Math.max(1, Math.min(l.stock, Math.floor(Number(e.target.value) || 1))))} />
                      </label>
                    )}
                    <button type="button" className="bx-btn mt-3 w-full" disabled={l.stock < 1 || l.priceMzn <= 0} onClick={startOrder}>{l.priceMzn <= 0 ? 'Preço a definir' : 'Comprar com compra segura'}</button>
                    <p className="bx-dim mt-2 text-[12px]">O valor fica retido até confirmares que recebeste. <Link href="/marketplace/como-funciona" className="underline">Como funciona</Link></p>
                  </>
                )}
              </div>
              <div className="bx-card p-4">
                <p className="text-[13px] font-semibold">Vendedor</p>
                <p className="mt-1 font-bold">{l.sellerName}</p>
                <div className="mt-1"><Stars value={rating} /></div>
                <p className="bx-dim mt-1 text-[12px]">{data!.reviews.length} avaliação(ões) · {l.sales} venda(s) deste anúncio</p>
                {data!.reviews.slice(0, 3).map((r) => <p key={r.orderId} className="bx-muted mt-2 border-t border-[var(--bx-line)] pt-2 text-[12.5px]"><Stars value={r.rating} size={12} /> {r.comment}</p>)}
              </div>
            </aside>
          </div>
        )}
      </div>

      <Sheet open={buy} onClose={() => setBuy(false)} title="Compra segura">
        {l && (
          <div className="bx">
            <div className="bx-card2 space-y-1.5 p-3 text-sm">
              <p className="flex justify-between gap-3"><span className="bx-muted">Anúncio</span><span className="text-right">{l.title}</span></p>
              <p className="flex justify-between"><span className="bx-muted">Quantidade</span><span>{qty}</span></p>
              <p className="flex justify-between"><span className="bx-muted">Taxa da plataforma</span><span>{fee == null ? TBD : fmtMoney(fee, 'MZN')}</span></p>
              <p className="flex justify-between font-bold"><span>Total</span><span className="bx-acc">{fmtMoney(total, 'MZN')}</span></p>
            </div>
            <ol className="bx-muted mt-3 list-decimal space-y-1 pl-5 text-[13px]">
              <li>Pagas e o valor fica retido pela TXAPILOG.</li>
              <li>O vendedor entrega ({l.delivery === 'automatica' ? 'automática' : 'manual'}){settings.deliveryHours ? ` em até ${settings.deliveryHours} h` : ''}.</li>
              <li>Confirmas a receção e o vendedor recebe. Se algo correr mal, abres uma disputa.</li>
            </ol>
            <button type="button" className="bx-btn mt-4 w-full" disabled>Pagar com M-Pesa / e-Mola</button>
            <p role="status" className="mt-3 rounded-xl border border-[#FF6B1A]/50 bg-[#FF6B1A]/10 p-3 text-sm font-semibold text-[#FFB38A]">{PAY_DISABLED}</p>
            {orderId && <p className="bx-dim mt-2 text-[12px]">Pedido guardado em <Link href="/marketplace/pedidos" className="underline">Os meus pedidos</Link> a aguardar pagamento.</p>}
          </div>
        )}
      </Sheet>
    </Page>
  );
}
