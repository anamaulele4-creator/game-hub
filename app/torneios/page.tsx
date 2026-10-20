'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { appRole, canCreateTournament } from '@/lib/affiliates';
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
      <div className="hud-card mb-4 p-5">
        <p className="font-display text-2xl font-bold">Compete, ganha XP e prémios</p>
        <p className="mt-1 text-sm text-white/75">Torneios e campeonatos grátis e pagos. A taxa de inscrição e o prémio são sempre mostrados antes de confirmares.</p>
        {/* Criar: só moderadores e admin (também imposto no servidor por RLS). Os restantes só participam. */}
        {canCreateTournament(appRole(s.user.role)) && <Link href="/organizar" className="btn mt-3 inline-flex">Criar torneio ou campeonato</Link>}
      </div>
      <Tabs tabs={F} value={f} onChange={setF} />
      {list.length === 0 && <p className="card text-center text-sm text-white/60">Nada por aqui ainda. Quando a equipa publicar torneios, aparecem aqui.</p>}
     <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
  {list.map((t) => <TournamentCard key={t.id} t={t} />)}
</div>
    </Page>
  );
}
