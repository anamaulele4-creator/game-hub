'use client';

// Organizar torneios e campeonatos — moderadores (influenciadores) e admin. Utilizadores e criadores só participam.
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { appRole, canCreateTournament } from '@/lib/affiliates';
import { IS_DEMO } from '@/lib/config';
import { Page } from '@/components/ui';
import { Skel } from '@/components/comp/Kit';

const Tournaments = dynamic(() => import('@/components/admin/Tournaments'), { ssr: false, loading: Skel });

export default function OrganizarPage() {
  const { s, ready } = useStore();
  const allowed = canCreateTournament(appRole(s.user.role));
  return (
    <Page title="Organizar torneios" back="/torneios">
      {!ready ? <Skel /> : !allowed ? (
        <div className="card space-y-2 text-center text-sm">
          <p className="font-bold">Só moderadores criam torneios e campeonatos</p>
          <p className="text-white/70">Podes participar em todos os torneios e campeonatos abertos.</p>
          <Link href="/torneios" className="btn w-full">Ver torneios</Link>
        </div>
      ) : (
        <>
          {IS_DEMO && <p className="mb-3 rounded-lg border border-neon/40 bg-neon/10 p-2 text-center text-xs text-neon2">Modo demo: alterações guardadas só neste navegador.</p>}
          <p className="mb-3 text-sm text-white/70">Cria e gere os teus torneios e campeonatos. Inscrições pagas e prémios em dinheiro continuam desligados até haver pagamentos aprovados; os prémios são registados pela equipa.</p>
          {s.user.role === 'admin' && <p className="mb-3 text-xs text-white/55">Admin: todos os torneios estão em <Link href="/admin" className="text-neon2 underline">Painel Admin › Torneios</Link>.</p>}
          <Tournaments scope="mine" />
        </>
      )}
    </Page>
  );
}
