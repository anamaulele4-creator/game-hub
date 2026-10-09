'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Page, Tabs, TournamentCard } from '@/components/ui';

const F = ['Todos', 'Grátis', 'Pagos', 'Inscrito', 'Terminados'] as const;
type Fl = (typeof F)[number];

export default function TorneiosPage() {
  const { s } = useStore();
  const [f, setF] = useState<Fl>('Todos');
  const list = s.admin.tournaments.filter((t) =>
    f === 'Todos' ? t.status !== 'terminado'
      : f === 'Grátis' ? t.fee === 0 && t.status !== 'terminado'
      : f === 'Pagos' ? t.fee > 0 && t.status !== 'terminado'
      : f === 'Inscrito' ? s.entries.includes(t.id)
      : t.status === 'terminado');
  return (
    <Page title="Torneios">
      <div className="hud-card mb-4 p-4">
        <p className="font-display text-xl font-bold uppercase tracking-wider">🏆 Compete, ganha XP e prémios</p>
        <p className="mt-1 text-xs text-white/75">Torneios grátis e pagos. A taxa de inscrição e o prémio são sempre mostrados antes de confirmares.</p>
      </div>
      <Tabs tabs={F} value={f} onChange={setF} />
      <div className="space-y-3">
        {list.length === 0 && <p className="card text-center text-sm text-white/60">Nada por aqui ainda.</p>}
        {list.map((t) => <TournamentCard key={t.id} t={t} />)}
      </div>
    </Page>
  );
}
