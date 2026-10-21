'use client';

// Pagamento direto por M-Pesa/e-Mola no checkout (Marketplace 3.0 · Parte 9).
// O servidor cria um depósito com o valor EXATO em falta (total − saldo), ligado a este pagamento; a Edge Function
// existente envia o pedido ao telemóvel. Só quando o FORNECEDOR confirma (consulta do servidor, webhook ou reconciliação)
// é que o servidor credita a carteira e paga o pedido automaticamente. Este ecrã só mostra o estado.
import { useEffect, useRef, useState } from 'react';
import { errText, fmtMt, mzPhone } from '@/lib/mkt3';
import { J, mkt3, newIdem } from '@/lib/mkt3Api';
import { Field } from './Bits';

type Phase = 'idle' | 'enviando' | 'aguarda' | 'pago' | 'carteira' | 'falhou';

export function DirectPay({ paymentId, total, onPaid }: { paymentId: string; total: number; onPaid: () => void }) {
  const [opt, setOpt] = useState<J | null>(null);
  const [method, setMethod] = useState<'M-Pesa' | 'e-Mola'>('M-Pesa');
  const [phone, setPhone] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [msg, setMsg] = useState<string | null>(null);
  const [dep, setDep] = useState<J | null>(null);
  const idem = useRef(newIdem());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { void mkt3.directOptions().then((r) => setOpt(r.ok ? r : { enabled: false })); return () => { if (timer.current) clearTimeout(timer.current); }; }, []);
  useEffect(() => { if (opt && !opt.mpesa && opt.emola) setMethod('e-Mola'); }, [opt]);

  const poll = (depositId: string, n = 0) => {
    timer.current = setTimeout(async () => {
      await mkt3.directCheck(depositId); // o servidor pergunta ao fornecedor (nunca confirma pelo cliente)
      const st = await mkt3.directStatus(paymentId);
      if (st.ok && st.payment_status === 'confirmado') { setPhase('pago'); onPaid(); return; }
      const link = (st.ok ? st.deposit?.link_status : null) as string | null;
      if (link === 'falhou') { setPhase('falhou'); setMsg('O pagamento não foi concluído no telemóvel. Nada foi cobrado.'); idem.current = newIdem(); return; }
      if (link === 'saldo_na_carteira') { setPhase('carteira'); setMsg('Recebemos o valor, mas o pedido já não podia ser pago. O valor está no saldo da tua carteira.'); return; }
      if (n < 60) poll(depositId, n + 1);
      else setMsg('Ainda à espera da confirmação do operador. Podes fechar esta página: quando o operador confirmar, o pedido é pago automaticamente e recebes um aviso.');
    }, n < 12 ? 5000 : 10000);
  };

  const start = async () => {
    const ph = mzPhone(phone);
    setMsg(null); setPhase('enviando');
    const r = await mkt3.directStart(paymentId, method, ph, idem.current);
    if (!r.ok) {
      setPhase('idle'); setMsg(errText(r.code));
      if (r.code !== 'DIRECT_IN_PROGRESS') idem.current = newIdem();
      return;
    }
    if (r.enough_balance) { setPhase('idle'); setMsg('Já tens saldo suficiente na carteira: usa o botão “Pagar com a carteira”.'); return; }
    if (r.status === 'confirmado') { setPhase('pago'); onPaid(); return; }
    setDep(r); setPhase('aguarda'); poll(r.deposit_id as string);
  };

  if (!opt) return null;
  const ready = !!(opt.enabled && (opt.mpesa || opt.emola));
  const missing = Math.max(0, total - Number(opt.balance ?? 0));
  if (!ready) return <p className="bx-dim mt-3 text-[13px]">M-Pesa/e-Mola direto: Pagamento ainda não disponível.</p>;
  if (missing <= 0) return null;
  const phoneOk = method === 'M-Pesa' ? /^8[45]\d{7}$/.test(mzPhone(phone)) : /^8[67]\d{7}$/.test(mzPhone(phone));
  return (
    <div className="mt-4 rounded-lg border border-[var(--bx-line)] p-3 text-[13.5px]">
      <p className="font-semibold">Pagar agora por M-Pesa / e-Mola</p>
      <p className="bx-muted text-[12.5px]">Pagas só o que falta: <b className="text-white">{fmtMt(missing)}</b> (o resto sai do saldo da carteira). O pedido fica pago quando o operador confirmar.</p>
      {phase === 'aguarda' || phase === 'enviando' ? (
        <p className="mt-2" aria-live="polite">{phase === 'enviando' ? 'A enviar o pedido ao telemóvel…' : `Aprova o pagamento de ${fmtMt(dep?.amount_mzn)} no teu telemóvel (${method}). A aguardar a confirmação do operador…`}</p>
      ) : phase === 'pago' ? <p className="mt-2 text-[#4ADE80]">Pagamento confirmado pelo operador.</p> : (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Field label="Método">
            <select className="bx-input !w-auto" value={method} onChange={(e) => setMethod(e.target.value as 'M-Pesa' | 'e-Mola')}>
              {opt.mpesa && <option value="M-Pesa">M-Pesa (84/85)</option>}{opt.emola && <option value="e-Mola">e-Mola (86/87)</option>}
            </select>
          </Field>
          <Field label="Número"><input className="bx-input !w-40" inputMode="tel" autoComplete="tel" placeholder="84 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <button type="button" className="bx-btn !min-h-[44px]" disabled={!phoneOk} onClick={start}>Pagar {fmtMt(missing)} por {method}</button>
        </div>
      )}
      {msg && <p className={`mt-2 ${phase === 'falhou' ? 'text-[#FCA5A5]' : ''}`} role="status">{msg}</p>}
    </div>
  );
}
