'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Sheet } from './ui';

/** Pede o PIN de transação (6 dígitos) e devolve uma autorização do servidor. Cria o PIN na hora se ainda não existir. */
export function PinPrompt({ open, onClose, purpose, amount, onAuthorized }: { open: boolean; onClose: () => void; purpose: 'pagamento' | 'levantamento'; amount: number; onAuthorized: (token: string) => void }) {
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [mode, setMode] = useState<'loading' | 'enter' | 'create' | 'frozen'>('loading');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [anti, setAnti] = useState<string | undefined>();

  useEffect(() => {
    if (!open) return;
    setPin(''); setPin2(''); setErr(''); setMode('loading');
    void import('@/lib/security').then((m) => m.status()).then((st) => {
      if (!st) { setErr('Entra na tua conta para continuar.'); setMode('enter'); return; }
      setAnti(st.antiPhishing);
      setMode(st.frozen ? 'frozen' : st.pinSet ? 'enter' : 'create');
    });
  }, [open]);

  const go = async () => {
    setBusy(true); setErr('');
    const m = await import('@/lib/security');
    if (mode === 'create') {
      if (pin !== pin2) { setBusy(false); setErr('Os PINs não coincidem.'); return; }
      const r = await m.setPin(pin);
      if (!r.ok) { setBusy(false); setErr(r.error!); return; }
    }
    const r = await m.authorize(pin, purpose, amount);
    setBusy(false);
    if (!r.ok) { setErr(r.error!); setPin(''); return; }
    onAuthorized(r.data!);
  };

  const Dots = ({ v, set }: { v: string; set: (x: string) => void }) => (
    <input autoFocus inputMode="numeric" type="password" autoComplete="off" maxLength={6} value={v} onChange={(e) => set(e.target.value.replace(/\D/g, ''))}
      className="input w-full text-center font-mono text-3xl tracking-[0.8em]" placeholder="••••••" aria-label="PIN de 6 dígitos" />
  );

  return (
    <Sheet open={open} onClose={onClose} title={mode === 'create' ? 'Cria o teu PIN de transação' : 'Confirma com o teu PIN'}>
      <div className="space-y-3 text-sm">
        <p className="text-center text-xs text-white/60">{purpose === 'levantamento' ? 'Levantamento' : 'Pagamento'} de <b className="text-white">{amount.toLocaleString('pt-PT')} MZN</b>. O PIN é verificado no servidor e nunca é guardado no telemóvel.</p>
        {anti && <p className="rounded-lg bg-lime/10 p-2 text-center text-xs text-lime">Código anti-phishing: <b>{anti}</b></p>}
        {mode === 'loading' && <div className="skeleton h-16 rounded-card" />}
        {mode === 'frozen' && <p className="rounded-lg bg-pink/20 p-3 text-center">A conta está congelada. Contacta o suporte para a reativar.</p>}
        {mode === 'enter' && <Dots v={pin} set={setPin} />}
        {mode === 'create' && (<><Dots v={pin} set={setPin} /><input inputMode="numeric" type="password" maxLength={6} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} className="input w-full text-center font-mono text-2xl tracking-[0.6em]" placeholder="repetir" aria-label="Repetir PIN" /><p className="text-xs text-white/50">Evita datas de nascimento e sequências (123456).</p></>)}
        {err && <p className="text-center text-xs text-pink">{err}</p>}
        {mode !== 'frozen' && mode !== 'loading' && <button className="btn w-full" disabled={busy || pin.length !== 6 || (mode === 'create' && pin2.length !== 6)} onClick={go}>{busy ? 'A verificar…' : 'Confirmar'}</button>}
        <Link href="/seguranca" className="block text-center text-xs text-neon2" onClick={onClose}>Esqueci-me do PIN / segurança da conta</Link>
      </div>
    </Sheet>
  );
}
