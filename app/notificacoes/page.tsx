'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Notif } from '@/lib/data';
import { useStore } from '@/lib/store';
import { PUSH_CATEGORIES, enablePush, permission } from '@/lib/push';
import { Page, Tabs } from '@/components/ui';
import { IS_DEMO } from '@/lib/config';

const F = ['Todas', 'Não lidas', 'Lives', 'Social', 'Torneios', 'Compras', 'Sistema'] as const;
type Fl = (typeof F)[number];
const TYPE: Partial<Record<Fl, Notif['type']>> = { Lives: 'live', Social: 'social', Torneios: 'torneio', Compras: 'compra', Sistema: 'sistema' };
const ICON: Record<Notif['type'], string> = { live: '🔴', social: '💬', torneio: '🏆', compra: '🧾', sistema: '⚙️' };
const RECENT = /agora|min|h$|há \d+ h/;

export default function NotificacoesPage() {
  const { s, set, nightNow, toast, pushNotif } = useStore();
  const [f, setF] = useState<Fl>('Todas');
  const list = s.notifs.filter((n) => (f === 'Todas' ? true : f === 'Não lidas' ? !n.read : n.type === TYPE[f]));
  const unread = s.notifs.filter((n) => !n.read).length;
  const markAll = () => set((p) => ({ ...p, notifs: p.notifs.map((n) => ({ ...n, read: true })) }));
  const read = (id: string) => set((p) => ({ ...p, notifs: p.notifs.map((n) => (n.id === id ? { ...n, read: true } : n)) }));
  const del = (id: string) => set((p) => ({ ...p, notifs: p.notifs.filter((n) => n.id !== id) }));
  const mute = (t: Notif['type']) => { set((p) => ({ ...p, notifPrefs: { ...p.notifPrefs, [t]: { inApp: false, push: false } } })); toast(`Categoria “${PUSH_CATEGORIES.find((c) => c.id === t)?.label}” silenciada. Reativa em Definições.`); };
  const groups: [string, Notif[]][] = [['Recentes', list.filter((n) => RECENT.test(n.time))], ['Anteriores', list.filter((n) => !RECENT.test(n.time))]];
  const perm = permission();
  const [anti, setAnti] = useState<string | undefined>();
  useEffect(() => { void import('@/lib/security').then((m) => m.status()).then((x) => setAnti(x?.antiPhishing)).catch(() => {}); }, []);

  return (
    <Page title="Notificações" back="/">
      {nightNow && <p className="mb-3 rounded-lg bg-ink/70 p-2 text-center text-xs">🌙 Silêncio noturno: estas notificações não fizeram som.</p>}
      {!(s.pushEnabled && perm === 'granted') && perm !== 'unsupported' && perm !== 'denied' && (
        <div className="card mb-3 flex items-center gap-3 !p-3">
          <span className="text-2xl">🔔</span>
          <p className="flex-1 text-xs">Recebe alertas quando os teus ídolos entram em direto, mesmo com a app fechada.</p>
          <button className="btn !px-3 !py-1.5 text-xs" onClick={async () => { const r = await enablePush(PUSH_CATEGORIES.map((c) => c.id)); if (r.ok) set((p) => ({ ...p, pushEnabled: true })); toast(r.msg); }}>Ativar</button>
        </div>
      )}
      {anti ? <p className="mb-3 rounded-lg bg-lime/10 p-2 text-center text-xs text-lime">🛡️ Avisos oficiais · código anti-phishing <b>{anti}</b></p> : <Link href="/seguranca" className="mb-3 block rounded-lg bg-panel2 p-2 text-center text-xs text-white/60">🛡️ Define um código anti-phishing para reconhecer avisos oficiais ›</Link>}
      <Tabs tabs={F} value={f} onChange={setF} />
      <div className="mb-3 flex items-center justify-between text-xs">
        <button onClick={markAll} className="text-neon2" disabled={!unread}>Marcar todas como lidas ({unread})</button>
        <div className="flex gap-3">
          {IS_DEMO && <button className="text-white/50" onClick={() => pushNotif({ type: 'live', text: 'Demo: Kaze entrou em direto — Escola ao vivo 🎯', href: '/lives/l3' })}>+ Simular</button>}
          <Link href="/definicoes" className="text-white/70">⚙️ Preferências</Link>
        </div>
      </div>
      {list.length === 0 && <p className="card text-center text-sm text-white/60">Sem notificações.</p>}
      {groups.map(([title, items]) => items.length > 0 && (
        <section key={title} className="mb-4">
          <p className="mb-2 text-xs font-semibold text-white/50">{title}</p>
          <div className="space-y-2">
            {items.map((n) => (
              <div key={n.id} className={`card flex items-center gap-3 !p-3 ${n.read ? 'opacity-60' : 'border-neon/60'}`}>
                <span className="text-xl">{ICON[n.type]}</span>
                <Link href={n.href} onClick={() => read(n.id)} className="flex-1"><p className="text-sm">{n.text}</p><p className="text-xs text-white/50">{n.time}</p></Link>
                {!n.read && <span className="h-2 w-2 rounded-full bg-pink" />}
                <details className="relative">
                  <summary className="cursor-pointer list-none px-1 text-white/50" aria-label="Opções">⋯</summary>
                  <div className="absolute right-0 z-10 mt-1 w-44 rounded-xl border border-line bg-panel2 p-1 text-xs">
                    {!n.read && <button className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-panel" onClick={() => read(n.id)}>Marcar como lida</button>}
                    <button className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-panel" onClick={() => del(n.id)}>Apagar</button>
                    <button className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-panel" onClick={() => mute(n.type)}>Silenciar este tipo</button>
                  </div>
                </details>
              </div>
            ))}
          </div>
        </section>
      ))}
    </Page>
  );
}
