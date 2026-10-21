'use client';

// Carrinho (Marketplace 3.0): guardado no servidor (recupera-se depois de entrar noutro dispositivo).
// Preços, stock, portes e descontos são SEMPRE recalculados no servidor (mkt_cart_view).
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Page } from '@/components/ui';
import { Photo } from '@/components/Photo';
import { useStore } from '@/lib/store';
import { categoryOf } from '@/lib/market';
import { COUPON_KEY, errText, fmtMt } from '@/lib/mkt3';
import { J, mkt3 } from '@/lib/mkt3Api';
import { MarketNav, listingHref } from '@/components/market/Kit';
import { Empty, ErrorNote, Loading, Mkt3Gate } from '@/components/mkt3/Bits';

const ISSUE: Record<string, string> = { INDISPONIVEL: 'Já não está disponível', STOCK: 'Stock insuficiente', VARIANT_REQUIRED: 'Escolhe uma opção no anúncio', NO_PRICE: 'Sem preço', OWN: 'É teu' };

export default function CartPage() {
  const { s, toast } = useStore();
  const [cart, setCart] = useState<J | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [coupons, setCoupons] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = async (cs = coupons) => {
    setErr(null);
    const r = await mkt3.cartView(cs);
    if (r.ok) setCart(r); else setErr(r.code);
  };
  useEffect(() => {
    let cs: string[] = [];
    try { cs = JSON.parse(sessionStorage.getItem(COUPON_KEY) ?? '[]'); } catch {}
    setCoupons(cs); void load(cs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.account.loggedIn]);

  const setQty = async (l: J, qty: number) => {
    setBusy(l.cart_id);
    const r = await mkt3.cartSet(l.product_id, l.variant_id, qty);
    setBusy(null);
    if (!r.ok) toast(errText(r.code)); await load();
  };
  const addCoupon = async () => {
    const c = code.trim().toUpperCase(); if (!/^[A-Z0-9]{4,16}$/.test(c)) { toast('Código inválido.'); return; }
    const cs = Array.from(new Set([...coupons, c])); setCoupons(cs); sessionStorage.setItem(COUPON_KEY, JSON.stringify(cs)); setCode(''); await load(cs);
  };
  const removeCoupon = async (c: string) => { const cs = coupons.filter((x) => x !== c); setCoupons(cs); sessionStorage.setItem(COUPON_KEY, JSON.stringify(cs)); await load(cs); };

  const lines: J[] = cart?.lines ?? [];
  const applied = new Set(lines.map((l) => l.coupon).filter(Boolean));

  return (
    <Page title="Carrinho" back="/marketplace">
      <div className="bx">
        <MarketNav active="carrinho" />
        <Mkt3Gate>
          {err === 'AUTH' ? <Empty>Entra na tua conta para veres o teu carrinho. <Link href="/entrar" className="bx-acc font-semibold">Entrar</Link></Empty>
            : err ? <ErrorNote code={err} onRetry={() => void load()} /> : !cart ? <Loading /> : lines.length === 0 ? (
              <Empty>O carrinho está vazio. <Link href="/marketplace/pesquisa" className="bx-acc font-semibold">Procurar produtos</Link></Empty>
            ) : (
              <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
                <ul className="space-y-2">
                  {lines.map((l) => (
                    <li key={l.cart_id} className={`bx-card flex gap-3 p-3 ${l.issue ? 'border-[#F59E0B]/60' : ''}`}>
                      <Link href={listingHref(l.product_id)} className="relative h-16 w-20 shrink-0 overflow-hidden rounded-lg"><Photo src={l.photo} fallback={categoryOf(l.category).art} alt="" sizes="80px" /></Link>
                      <div className="min-w-0 flex-1 text-[13.5px]">
                        <Link href={listingHref(l.product_id)} className="line-clamp-2 font-semibold hover:underline">{l.title}{l.variant_name ? ` · ${l.variant_name}` : ''}</Link>
                        <p className="bx-dim text-[12px]">{l.seller_name}</p>
                        <p className="tabular-nums">{fmtMt(l.unit_mzn)} × {l.qty} = <b>{fmtMt(l.items_mzn)}</b></p>
                        {l.discount_mzn > 0 && <p className="text-[12px] text-[#4ADE80]">Desconto {l.coupon}: −{fmtMt(l.discount_mzn)}</p>}
                        {l.shipping_mzn > 0 && <p className="bx-dim text-[12px]">Portes: {fmtMt(l.shipping_mzn)}</p>}
                        {l.issue && <p className="text-[12.5px] font-semibold text-[#FBBF24]">{ISSUE[l.issue] ?? l.issue}{l.issue === 'STOCK' ? ` (disponível: ${l.available})` : ''}</p>}
                        <div className="mt-1.5 flex items-center gap-2">
                          <button type="button" className="bx-ghost !min-h-[36px] !px-3" aria-label="Menos um" disabled={busy === l.cart_id || l.qty <= 1} onClick={() => setQty(l, l.qty - 1)}>−</button>
                          <span className="w-8 text-center tabular-nums" aria-label="Quantidade">{l.qty}</span>
                          <button type="button" className="bx-ghost !min-h-[36px] !px-3" aria-label="Mais um" disabled={busy === l.cart_id || l.qty >= Math.min(l.available, 100)} onClick={() => setQty(l, l.qty + 1)}>+</button>
                          <button type="button" className="bx-dim ml-auto text-[12.5px] underline" disabled={busy === l.cart_id} onClick={() => setQty(l, 0)}>Remover</button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <aside className="bx-card h-fit p-4 text-[14px]">
                  <h2 className="mb-2 font-bold">Resumo</h2>
                  <dl className="space-y-1 tabular-nums">
                    <div className="flex justify-between"><dt>Subtotal</dt><dd>{fmtMt(cart.items_mzn)}</dd></div>
                    {cart.discount_mzn > 0 && <div className="flex justify-between text-[#4ADE80]"><dt>Descontos</dt><dd>−{fmtMt(cart.discount_mzn)}</dd></div>}
                    <div className="flex justify-between"><dt>Portes</dt><dd>{fmtMt(cart.shipping_mzn)}</dd></div>
                    <div className="bx-dim flex justify-between text-[12px]"><dt>Impostos</dt><dd>IVA incluído nos preços</dd></div>
                    <div className="flex justify-between border-t border-[var(--bx-line)] pt-2 text-[16px] font-bold"><dt>Total</dt><dd>{fmtMt(cart.total_mzn)}</dd></div>
                  </dl>
                  <div className="mt-3 flex gap-2">
                    <input className="bx-input !min-h-[40px]" aria-label="Código de desconto" placeholder="Código de desconto" value={code} maxLength={16} onChange={(e) => setCode(e.target.value)} />
                    <button type="button" className="bx-ghost !min-h-[40px]" onClick={addCoupon}>Aplicar</button>
                  </div>
                  {coupons.length > 0 && (
                    <ul className="mt-2 space-y-1 text-[12.5px]">
                      {coupons.map((c) => <li key={c} className="flex justify-between"><span>{c} {applied.has(c) ? '✓ aplicado' : '· não aplicável'}</span><button type="button" className="bx-dim underline" onClick={() => removeCoupon(c)}>retirar</button></li>)}
                    </ul>
                  )}
                  {cart.issues > 0 ? <p className="mt-3 text-[13px] text-[#FBBF24]">Resolve os avisos acima para continuar.</p>
                    : !cart.checkout_enabled ? <p className="mt-3 rounded-lg bg-[#F59E0B]/15 p-2 text-[13px]">Pagamento ainda não disponível. O teu carrinho fica guardado.</p>
                      : <Link href="/marketplace/checkout" className="bx-btn mt-3 w-full">Continuar para o checkout</Link>}
                </aside>
              </div>
            )}
        </Mkt3Gate>
      </div>
    </Page>
  );
}
