'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { mzn } from '@/lib/data';
import { Sheet } from './ui';
import { IS_DEMO } from '@/lib/config';
import { sb } from '@/lib/supabase';
import { friendlyError } from '@/lib/auth';

export interface Line { label: string; amount: number; qty?: number }

// Checkout transparente: o total final está sempre visível, sem custos escondidos, e cancelar é um toque.
export function CheckoutSheet({
  open, onClose, title, lines, recurring, onPaid,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  lines: Line[];
  recurring?: string;
  onPaid: (method: string, total: number) => void;
}) {
  const { set, toast } = useStore();
  const [method, setMethod] = useState<'M-Pesa' | 'e-Mola' | 'Cartão'>('M-Pesa');
  const [phone, setPhone] = useState('84 000 0000');
  const [step, setStep] = useState<'resumo' | 'confirmar' | 'feito'>('resumo');
  const subtotal = lines.reduce((a, l) => a + l.amount * (l.qty ?? 1), 0);
  const fee = 0; // taxa de serviço: 0 MZN (mostrada sempre, mesmo quando é zero)
  const total = subtotal + fee;

  const close = () => { setStep('resumo'); onClose(); };

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pay = async () => {
    if (!IS_DEMO) {
      // MODO REAL: o pagamento é iniciado pela Edge Function `payments` (agregador M-Pesa/e-Mola). Só é concedido após confirmação do servidor.
      setBusy(true); setErr('');
      try {
        const c = await sb();
        const { data: ses } = await c.auth.getSession();
        if (!ses.session) { setErr('Entra na tua conta para pagar.'); setBusy(false); return; }
        const { data, error } = await c.functions.invoke('payments', { body: { title, lines, total, method, phone, recurring: recurring ?? null } });
        setBusy(false);
        if (error || !data?.ok) { setErr(error ? 'Os pagamentos M-Pesa / e-Mola ainda estão a ser ativados. Tenta mais tarde — nada foi cobrado.' : friendlyError(data?.error)); return; }
        setStep('feito');
        toast('Pedido de pagamento enviado. Confirma no telemóvel ✅');
      } catch (e) { setBusy(false); setErr(friendlyError(e)); }
      return;
    }
    set((p) => ({
      ...p,
      purchases: [{ id: 'pu' + Date.now(), item: title, total, method, date: new Date().toLocaleString('pt-PT'), status: 'demo-pago' }, ...p.purchases],
      notifs: [{ id: 'n' + Date.now(), type: 'compra', text: `Demo: ${title} confirmado (${mzn(total)}). Nada foi cobrado.`, time: 'agora', href: '/perfil', read: false }, ...p.notifs],
    }));
    onPaid(method, total);
    setStep('feito');
    toast('Pagamento de demonstração concluído ✅');
  };

  return (
    <Sheet open={open} onClose={close} title={step === 'feito' ? 'Concluído' : 'Checkout'}>
      {step === 'feito' ? (
        <div className="text-center">
          <div className="mb-2 text-5xl">✅</div>
          <p className="mb-1 font-semibold">{title}</p>
          <p className="mb-4 text-sm text-white/60">{IS_DEMO ? 'Demonstração: nenhum valor foi cobrado. Recibo guardado no teu Perfil › Compras.' : 'Confirma o pagamento no teu telemóvel (PIN). O recibo aparece no Perfil › Compras após confirmação.'}</p>
          <button className="btn w-full" onClick={close}>Fechar</button>
        </div>
      ) : (
        <>
          {IS_DEMO && <p className="mb-3 rounded-lg border border-amber-400/40 bg-amber-400/10 p-2 text-center text-[11px] text-amber-200">Modo demonstração: nada é cobrado.</p>}
          <p className="mb-2 font-semibold">{title}</p>
          <div className="space-y-1 text-sm">
            {lines.map((l, i) => (
              <div key={i} className="flex justify-between"><span>{l.label}{l.qty && l.qty > 1 ? ` × ${l.qty}` : ''}</span><span>{mzn(l.amount * (l.qty ?? 1))}</span></div>
            ))}
            <div className="flex justify-between text-white/60"><span>Taxa de serviço</span><span>0 MZN</span></div>
            <div className="flex justify-between text-white/60"><span>IVA incluído</span><span>sim</span></div>
          </div>

          {step === 'resumo' && (
            <div className="mt-4 space-y-3">
              <p className="text-xs text-white/60">Método de pagamento</p>
              <div className="grid grid-cols-3 gap-2">
                {(['M-Pesa', 'e-Mola', 'Cartão'] as const).map((m) => (
                  <button key={m} onClick={() => setMethod(m)} className={`rounded-xl border p-2 text-sm ${method === m ? 'border-neon bg-neon/20' : 'border-line bg-panel2'}`}>{m === 'M-Pesa' ? '📱 ' : m === 'e-Mola' ? '💳 ' : '🏦 '}{m}</button>
                ))}
              </div>
              {method !== 'Cartão' ? (
                <input className="input w-full" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Número de telemóvel" inputMode="tel" />
              ) : (
                <p className="text-xs text-white/50">Cartão: processado pelo agregador de pagamentos numa página segura. O GAME HUB nunca vê os dados do cartão.</p>
              )}
              {recurring && <p className="text-xs text-white/60">Renovação: {recurring}. Cancelas quando quiseres no Perfil, sem perguntas.</p>}
            </div>
          )}

          {step === 'confirmar' && (
            <p className="mt-4 rounded-lg bg-panel2 p-3 text-sm">Vais receber um pedido de confirmação no {method} ({phone}). {IS_DEMO && <><b>Demo:</b> nenhum pedido real é enviado.</>}</p>
          )}

          {err && <p className="mt-3 rounded-lg bg-pink/20 p-2 text-xs">{err}</p>}
          <div className="sticky bottom-0 mt-5 border-t border-line bg-panel pt-3">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-white/70">Total final</span>
              <span className="text-2xl font-black text-neon2">{mzn(total)}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={close} className="btn-ghost flex-1">Cancelar</button>
              {step === 'resumo'
                ? <button onClick={() => setStep('confirmar')} className="btn flex-1">Continuar</button>
                : <button onClick={pay} disabled={busy} className="btn flex-1">{busy ? 'A processar…' : `Pagar ${mzn(total)}`}</button>}
            </div>
          </div>
        </>
      )}
    </Sheet>
  );
}
