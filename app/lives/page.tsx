'use client';

import { useState } from 'react';
import { LIVES, idol } from '@/lib/data';
import { useStore } from '@/lib/store';
import { LiveCard, Page, Section, Tabs } from '@/components/ui';

const F = ['Todas', 'Free Fire', 'eFootball', 'PUBG Mobile', 'Seguindo'] as const;
type Fl = (typeof F)[number];

export default function LivesPage() {
  const [f, setF] = useState<Fl>('Todas');
  const { s } = useStore();
  const list = LIVES.filter((l) => (s.admin.liveStatus[l.id] ?? 'ao vivo') === 'ao vivo' && !s.blocked.includes(l.idolId)).filter((l) => f === 'Todas' || (f === 'Seguindo' ? s.following.includes(l.idolId) : l.game === f));
  const upcoming = [
    { who: 'kaze', when: 'Hoje 21:00', title: 'Treino de sniper com seguidores' },
    { who: 'lua', when: 'Amanhã 19:30', title: 'Noite de humor e clipes' },
    { who: 'zuri', when: 'Sábado 15:00', title: 'Taça Beira: meias-finais' },
  ];
  return (
    <Page title="Lives">
      <Tabs tabs={F} value={f} onChange={setF} />
      <Section title={`🔴 Ao vivo agora (${list.length})`}>
        <div className="space-y-3">
          {list.length === 0 && <p className="card text-center text-sm text-white/60">Nenhuma live neste filtro agora.</p>}
          {list.map((l) => <LiveCard key={l.id} l={l} big />)}
        </div>
      </Section>
      <Section title="📅 Próximas lives">
        {upcoming.map((u) => {
          const i = idol(u.who);
          return (
            <div key={u.title} className="card mb-2 flex items-center gap-3 !p-3">
              <span className="text-3xl">{i.avatar}</span>
              <div className="flex-1"><p className="text-sm font-semibold">{u.title}</p><p className="text-xs text-white/60">{i.name} · {u.when}</p></div>
              <span className="chip">🔔 Lembrete</span>
            </div>
          );
        })}
      </Section>
    </Page>
  );
}
