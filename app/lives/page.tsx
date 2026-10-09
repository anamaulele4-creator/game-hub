'use client';

import Link from 'next/link';
import { useState } from 'react';
import { LIVES, UPCOMING_LIVES, idol } from '@/lib/data';
import { IS_DEMO } from '@/lib/config';
import { useStore } from '@/lib/store';
import { whenLabel } from '@/lib/lives';
import { AvatarFace, Button, EmptyState, LiveCard, Page, Section, Tabs } from '@/components/ui';

const F = ['Todas', 'Free Fire', 'eFootball', 'PUBG Mobile', 'Seguindo'] as const;
type Fl = (typeof F)[number];

export default function LivesPage() {
  const [f, setF] = useState<Fl>('Todas');
  const { s } = useStore();
  const list = LIVES.filter((l) => (s.admin.liveStatus[l.id] ?? l.status ?? 'ao vivo') === 'ao vivo' && !s.blocked.includes(l.idolId)).filter((l) => f === 'Todas' || (f === 'Seguindo' ? s.following.includes(l.idolId) : l.game === f));
  const demoUpcoming = [
    { id: 'u1', who: 'kaze', when: 'Hoje 21:00', title: 'Treino de sniper com seguidores' },
    { id: 'u2', who: 'lua', when: 'Amanhã 19:30', title: 'Noite de humor e clipes' },
    { id: 'u3', who: 'zuri', when: 'Sábado 15:00', title: 'Taça Beira: meias-finais' },
  ];
  const upcoming = IS_DEMO ? demoUpcoming : UPCOMING_LIVES
    .filter((l) => (s.admin.liveStatus[l.id] ?? 'agendada') === 'agendada' && !s.blocked.includes(l.idolId))
    .filter((l) => f === 'Todas' || (f === 'Seguindo' ? s.following.includes(l.idolId) : l.game === f))
    .map((l) => ({ id: l.id, who: l.idolId, when: whenLabel(l.startsAt), title: l.title }));
  return (
    <Page title="Lives">
      <Link href="/lives/criar" className="mb-3 flex min-h-[3.5rem] items-center gap-3 rounded-2xl border border-neon/50 bg-neon/10 px-4 py-3 text-base font-bold">
        <span className="text-2xl" aria-hidden>🔴</span><span className="flex-1">Criar live<span className="block text-sm font-normal text-white/60">Agora ou agendada</span></span><span aria-hidden className="text-white/60">›</span>
      </Link>
      <Tabs tabs={F} value={f} onChange={setF} />
      <Section title={`🔴 Ao vivo agora (${list.length})`}>
        {list.length === 0 ? <EmptyState icon="📡" title="Nenhuma live neste filtro" text="Experimenta outro filtro ou cria a tua live agora." action={<Button href="/lives/criar">Criar live</Button>} /> : (
          <div className="grid gap-3 lg:grid-cols-2">
            {list.map((l) => <LiveCard key={l.id} l={l} big />)}
          </div>
        )}
      </Section>
      <Section title="📅 Próximas lives">
        {upcoming.length === 0 && <p className="card text-center text-sm text-white/60">Nenhuma live agendada. <Link href="/lives/criar" className="text-neon2">Agenda a tua</Link></p>}
        {upcoming.map((u) => {
          const i = idol(u.who);
          return (
            <Link key={u.id} href={IS_DEMO ? '/lives' : `/lives/${u.id}`} className="card mb-2 flex items-center gap-3 !p-3">
              <span className="text-3xl"><AvatarFace a={i.avatar} name={i.name} /></span>
              <div className="flex-1"><p className="text-sm font-semibold">{u.title}</p><p className="text-xs text-white/60">{i.name} · {u.when}</p></div>
              <span className="chip">📅 Agendada</span>
            </Link>
          );
        })}
      </Section>
    </Page>
  );
}
