'use client';

import { useState } from 'react';
import { EVENTS, GHEvent, mzn } from '@/lib/data';
import { useStore } from '@/lib/store';
import { CheckoutSheet } from '@/components/Checkout';
import { Page, ShareSheet, Sheet } from '@/components/ui';

export default function EventosPage() {
  const { s, set, toggleSave, isSaved, toast } = useStore();
  const [ev, setEv] = useState<GHEvent | null>(null);
  const [tier, setTier] = useState<'Normal' | 'VIP'>('Normal');
  const [qty, setQty] = useState(1);
  const [pay, setPay] = useState(false);
  const [sh, setSh] = useState<GHEvent | null>(null);
  const price = ev ? (tier === 'VIP' ? ev.vipPrice : ev.price) : 0;

  const issue = () => {
    if (!ev) return;
    set((p) => ({ ...p, tickets: [...p.tickets, { id: 'TK' + Date.now(), eventId: ev.id, tier, qty }] }));
    toast('🎟️ Bilhete emitido (demo). Vê no teu Perfil.');
    setEv(null);
  };

  return (
    <Page title="Eventos" back="/mais">
      <div className="space-y-3">
        {EVENTS.map((e) => {
          const mine = s.tickets.filter((t) => t.eventId === e.id).reduce((a, t) => a + t.qty, 0);
          return (
            <div key={e.id} className="card">
              <div className="mb-2 flex h-24 items-center justify-center rounded-xl bg-gradient-to-br from-neon to-neon2 text-5xl">{e.emoji}</div>
              <p className="font-semibold">{e.name}</p>
              <p className="text-xs text-white/60">📅 {e.date} · 📍 {e.place}</p>
              <p className="my-2 text-sm">{e.desc}</p>
              <div className="flex items-center justify-between text-xs"><span>Normal {mzn(e.price)} · VIP {mzn(e.vipPrice)}</span><span className="text-amber-300">{e.left} restantes</span></div>
              {mine > 0 && <p className="mt-1 text-xs text-lime">✓ Tens {mine} bilhete(s)</p>}
              <div className="mt-3 flex gap-2">
                <button className="btn flex-1" onClick={() => { setEv(e); setTier('Normal'); setQty(1); }}>Comprar bilhete</button>
                <button className="btn-ghost" onClick={() => toggleSave({ kind: 'evento', id: e.id })}>{isSaved({ kind: 'evento', id: e.id }) ? '🔖' : '📑'}</button>
                <button className="btn-ghost" onClick={() => setSh(e)}>📤</button>
              </div>
            </div>
          );
        })}
      </div>
      <Sheet open={!!ev && !pay} onClose={() => setEv(null)} title={ev?.name ?? ''}>
        {ev && (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2">
              {(['Normal', 'VIP'] as const).map((t) => (
                <button key={t} onClick={() => setTier(t)} className={`rounded-xl border p-3 ${tier === t ? 'border-neon bg-neon/20' : 'border-line bg-panel2'}`}>{t}<span className="block font-bold">{mzn(t === 'VIP' ? ev.vipPrice : ev.price)}</span></button>
              ))}
            </div>
            <div className="mb-4 flex items-center justify-center gap-4"><button className="rounded bg-panel2 px-3 py-1" onClick={() => setQty(Math.max(1, qty - 1))}>−</button><span className="text-xl">{qty}</span><button className="rounded bg-panel2 px-3 py-1" onClick={() => setQty(Math.min(6, qty + 1))}>+</button></div>
            <div className="mb-3 flex justify-between text-lg font-bold"><span>Total final</span><span className="text-neon2">{mzn(price * qty)}</span></div>
            <button className="btn w-full" onClick={() => (price === 0 ? issue() : setPay(true))}>{price === 0 ? 'Reservar grátis' : 'Continuar para pagamento'}</button>
          </>
        )}
      </Sheet>
      {ev && <CheckoutSheet open={pay} onClose={() => { setPay(false); setEv(null); }} title={`Bilhete ${tier}: ${ev.name}`} lines={[{ label: `Bilhete ${tier}`, amount: price, qty }]} onPaid={issue} />}
      {sh && <ShareSheet open={!!sh} onClose={() => setSh(null)} path="/eventos" text={`Vamos ao ${sh.name}?`} target={sh.id} />}
    </Page>
  );
}
