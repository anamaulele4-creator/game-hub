'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Notif } from '@/lib/data';
import { useStore } from '@/lib/store';
import { Page, Tabs } from '@/components/ui';

const F = ['Todas', 'Não lidas', 'Lives', 'Social', 'Torneios', 'Compras', 'Sistema'] as const;
type Fl = (typeof F)[number];
const TYPE: Partial<Record<Fl, Notif['type']>> = { Lives: 'live', Social: 'social', Torneios: 'torneio', Compras: 'compra', Sistema: 'sistema' };
const ICON: Record<Notif['type'], string> = { live: '🔴', social: '💬', torneio: '🏆', compra: '🧾', sistema: '⚙️' };

export default function NotificacoesPage() {
  const { s, set, nightNow } = useStore();
  const [f, setF] = useState<Fl>('Todas');
  const list = s.notifs.filter((n) => (f === 'Todas' ? true : f === 'Não lidas' ? !n.read : n.type === TYPE[f]));
  const markAll = () => set((p) => ({ ...p, notifs: p.notifs.map((n) => ({ ...n, read: true })) }));
  const read = (id: string) => set((p) => ({ ...p, notifs: p.notifs.map((n) => (n.id === id ? { ...n, read: true } : n)) }));
  const del = (id: string) => set((p) => ({ ...p, notifs: p.notifs.filter((n) => n.id !== id) }));
  return (
    <Page title="Notificações" back="/">
      {nightNow && <p className="mb-3 rounded-lg bg-indigo-900/60 p-2 text-center text-xs">🌙 Silêncio noturno: estas notificações não fizeram som.</p>}
      <Tabs tabs={F} value={f} onChange={setF} />
      <button onClick={markAll} className="mb-3 text-xs text-neon2">Marcar todas como lidas</button>
      <div className="space-y-2">
        {list.length === 0 && <p className="card text-center text-sm text-white/60">Sem notificações.</p>}
        {list.map((n) => (
          <div key={n.id} className={`card flex items-center gap-3 !p-3 ${n.read ? 'opacity-60' : 'border-neon/60'}`}>
            <span className="text-xl">{ICON[n.type]}</span>
            <Link href={n.href} onClick={() => read(n.id)} className="flex-1"><p className="text-sm">{n.text}</p><p className="text-[11px] text-white/50">{n.time}</p></Link>
            {!n.read && <span className="h-2 w-2 rounded-full bg-pink" />}
            <button onClick={() => del(n.id)} className="text-white/40" aria-label="Apagar">✕</button>
          </div>
        ))}
      </div>
    </Page>
  );
}
