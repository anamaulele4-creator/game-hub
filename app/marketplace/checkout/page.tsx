'use client';

// Checkout (Marketplace 3.0). O servidor recalcula tudo, reserva o stock e cria os pedidos; o pagamento é feito
// com o saldo da carteira numa só transação no servidor. Nada é dado como pago sem o débito real na carteira.
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Page } from '@/components/ui';
import { useStore } from '@/lib/store';
import { COUPON_KEY, errText, fmtMt, mzPhone } from '@/lib/mkt3';
import { J, mkt3, newIdem } from '@/lib/mkt3Api';
import { MarketNav } from '@/components/market/Kit';
import { Empty, ErrorNote, Field, Loading, Mkt3Gate } from '@/components/mkt3/Bits';
import { DirectPay } from '@/components/mkt3/DirectPay';

export default function CheckoutPage() {
  const { toast } = useStore();
  const router = useRouter();
  const [cart, setCart] = useState<J | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [coupons, setCoupons] = useState<string[]>([]);
  const [d, setD] = useState({ name: '', phone: '', city: '', address: '', notes: '', service_date: '' });
  const [note, setNote] = useState('');
  const [step, setStep] = useState<'rever' | 'pagar' | 'feito'>('rever');
  const [busy, setBusy] = useState(false);
  const [payment, setPayment] = useState<J | null>(null);
  const [payErr, setPayErr] = useState<string | null>(null);
  const idem = useRef(newIdem());
  const payIdem = useRef(newIdem());

  useEffect(() => {
    let cs: string[] = [];
    try { cs = JSON.parse(sessionStorage.getItem(COUPON_KEY) ?? '[]'); } catch {}
    setCoupons(cs);
    mkt3.cartView(cs).then((r) => (r.ok ? setCart(r) : setErr(r.code)));
  }, []);

  const lines: J[] = cart?.lines ?? [];
  const hasService = lines.some((l) => l.kind === 'servico');
  const needsAddr = !!cart?.needs_address;
  const phoneOk = /^8[2-7]\d{7}$/.test(mzPhone(d.phone));
  const addrOk = !needsAddr || (d.name.trim().length >= 2 && phoneOk && d.city.trim().length >= 2 && d.address.trim().length >= 5);

  const confirm = async () => {
    if (!addrOk) { toast(errText('ADDRESS')); return; }
    if (!window.confirm(`Confirmas a encomenda de ${fmtMt(cart!.total_mzn)}? O valor será debitado da tua carteira e fica retido até confirmares a receção.`)) return;
    setBusy(true);
    const r = await mkt3.checkout(idem.current, { ...d, phone: mzPhone(d.phone) }, coupons, note);
    if (!r.ok) { setBusy(false); toast(errText(r.code)); if (r.code === 'CART_ISSUES' || r.code === 'STOCK') router.push('/marketplace/carrinho'); return; }
    sessionStorage.removeItem(COUPON_KEY);
    setPayment(r); setStep('pagar');
    await pay(r.payment_id);
    setBusy(false);
  };
  const pay = async (pid: string) => {
    setPayErr(null);
    const r = await mkt3.pay(pid, payIdem.current);
    if (r.ok) { setStep('feito'); return; }
    setPayErr(r.code);
    payIdem.current = newIdem(); // uma nova tentativa é um novo pedido de pagamento (o servidor impede débitos duplicados)
  };

  return (
    <Page title="Checkout" back="/marketplace/carrinho">
      <div className="bx">
        <MarketNav active="carrinho" />
        <Mkt3Gate>
          {err ? <ErrorNote code={err} /> : !cart ? <Loading /> : step === 'feito' ? (
            <div className="bx-card p-5 text-center">
              <p className="text-3xl" aria-hidden>✅</p>
              <h2 className="mt-2 text-lg font-bold">Pagamento confirmado</h2>
              <p className="bx-muted mt-1 text-[14px]">Pagaste {fmtMt(payment?.total_mzn)}. O valor fica retido até confirmares que recebeste. O vendedor já foi avisado.</p>
              <Link href="/marketplace/pedidos" className="bx-btn mt-4">Ver os meus pedidos</Link>
            </div>
          ) : step === 'pagar' ? (
            <div className="bx-card p-5 text-[14px]">
              <h2 className="text-lg font-bold">Pedido registado · falta pagar</h2>
              <p className="bx-muted mt-1">Total: <b className="text-white">{fmtMt(payment?.total_mzn)}</b>. O pedido fica reservado durante 30 minutos.</p>
              {payErr === 'BALANCE' ? (
                <p className="mt-3 rounded-lg bg-[#F59E0B]/15 p-3">Saldo insuficiente. Paga o que falta por M-Pesa/e-Mola aqui em baixo, ou <Link href="/carteira" className="bx-acc font-semibold">carrega a carteira</Link> e volta a tocar em “Pagar”. Também podes pagar mais tarde em “Os meus pedidos”.</p>
              ) : payErr ? <p className="mt-3 text-[#FCA5A5]">{errText(payErr)}</p> : busy ? <p className="mt-3">A pagar…</p> : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className="bx-btn" disabled={busy} onClick={async () => { setBusy(true); await pay(payment!.payment_id); setBusy(false); }}>Pagar {fmtMt(payment?.total_mzn)} com a carteira</button>
                <Link href="/marketplace/pedidos" className="bx-ghost">Pagar mais tarde</Link>
              </div>
              <DirectPay paymentId={payment!.payment_id} total={payment!.total_mzn} onPaid={() => setStep('feito')} />
            </div>
          ) : lines.length === 0 ? <Empty>O carrinho está vazio.</Empty> : !cart.checkout_enabled ? (
            <Empty>Pagamento ainda não disponível. Nada foi cobrado e o teu carrinho fica guardado.</Empty>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
              <div className="space-y-4">
                <section className="bx-card p-4 text-[14px]">
                  <h2 className="mb-2 font-bold">Produtos</h2>
                  <ul className="space-y-1.5">
                    {lines.map((l) => (
                      <li key={l.cart_id} className="flex justify-between gap-2 tabular-nums">
                        <span className="min-w-0">{l.qty} × {l.title}{l.variant_name ? ` · ${l.variant_name}` : ''} <span className="bx-dim">({fmtMt(l.unit_mzn)})</span></span>
                        <b>{fmtMt(l.total_mzn)}</b>
                      </li>
                    ))}
                  </ul>
                </section>
                {needsAddr && (
                  <section className="bx-card space-y-3 p-4">
                    <h2 className="font-bold">Dados de entrega</h2>
                    <Field label="Nome do destinatário"><input className="bx-input" autoComplete="name" maxLength={80} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
                    <Field label="Telefone" hint={d.phone && !phoneOk ? 'Número moçambicano (82–87…).' : undefined}><input className="bx-input" inputMode="tel" autoComplete="tel" value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} /></Field>
                    <Field label="Cidade"><input className="bx-input" maxLength={60} value={d.city} onChange={(e) => setD({ ...d, city: e.target.value })} /></Field>
                    <Field label="Morada"><input className="bx-input" autoComplete="street-address" maxLength={200} value={d.address} onChange={(e) => setD({ ...d, address: e.target.value })} /></Field>
                    <Field label="Indicações (opcional)"><input className="bx-input" maxLength={300} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} /></Field>
                  </section>
                )}
                {hasService && (
                  <section className="bx-card space-y-3 p-4">
                    <h2 className="font-bold">Serviço</h2>
                    <Field label="Data pretendida (opcional)" hint="Sem data, conta o prazo de execução indicado pelo prestador."><input type="date" className="bx-input" value={d.service_date} onChange={(e) => setD({ ...d, service_date: e.target.value })} /></Field>
                  </section>
                )}
                <section className="bx-card p-4">
                  <Field label="Mensagem para o vendedor (opcional)" hint="Ex.: o teu ID no jogo. Nunca partilhes palavras-passe."><textarea className="bx-input min-h-[70px] py-2" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                </section>
              </div>
              <aside className="bx-card h-fit p-4 text-[14px]">
                <h2 className="mb-2 font-bold">Resumo</h2>
                <dl className="space-y-1 tabular-nums">
                  <div className="flex justify-between"><dt>Subtotal</dt><dd>{fmtMt(cart.items_mzn)}</dd></div>
                  {cart.discount_mzn > 0 && <div className="flex justify-between text-[#4ADE80]"><dt>Descontos</dt><dd>−{fmtMt(cart.discount_mzn)}</dd></div>}
                  <div className="flex justify-between"><dt>Portes</dt><dd>{fmtMt(cart.shipping_mzn)}</dd></div>
                  <div className="bx-dim flex justify-between text-[12px]"><dt>Impostos</dt><dd>IVA incluído</dd></div>
                  <div className="flex justify-between border-t border-[var(--bx-line)] pt-2 text-[16px] font-bold"><dt>Total</dt><dd>{fmtMt(cart.total_mzn)}</dd></div>
                </dl>
                <p className="mt-3 text-[13px] font-semibold">Método de pagamento</p>
                <p className="bx-muted text-[13px]">Saldo da carteira: <b className="text-white">{fmtMt(cart.wallet_balance)}</b></p>
                {cart.wallet_balance < cart.total_mzn && <p className="mt-1 text-[12.5px] text-[#FBBF24]">Saldo insuficiente: depois de confirmares podes pagar o que falta por M-Pesa/e-Mola (se disponível) ou <Link href="/carteira" className="underline">carregar a carteira</Link>.</p>}
                <button type="button" className="bx-btn mt-3 w-full" disabled={busy || !addrOk || cart.issues > 0} onClick={confirm}>{busy ? 'A processar…' : `Confirmar e pagar ${fmtMt(cart.total_mzn)}`}</button>
                <p className="bx-dim mt-2 text-[11.5px]">O valor fica retido pela plataforma e só é libertado ao vendedor quando confirmares a receção (ou pela decisão de uma reclamação).</p>
              </aside>
            </div>
          )}
        </Mkt3Gate>
      </div>
    </Page>
  );
}
