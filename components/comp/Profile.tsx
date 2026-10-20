'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { compApi } from '@/lib/competitiveApi';
import { ROLE_LABEL } from '@/lib/competitive';
import type { MemberRole } from '@/lib/competitive';
import { Avatar } from '@/components/ui';
import { TeamBadge } from '@/components/TeamBadge';
import { DemoNote, Empty, ExampleTag, Skel, fmtDate } from './Kit';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Perfil público de jogador: equipas e histórico de desafios concluídos. */
export default function PublicProfile({ handle }: { handle: string }) {
  const [p, setP] = useState<Row | null | undefined>(undefined);
  useEffect(() => { compApi.profile(handle).then(setP).catch(() => setP(null)); }, [handle]);
  if (p === undefined) return <Skel />;
  if (!p) return <Empty>Jogador não encontrado.</Empty>;
  return (
    <>
      <DemoNote />
      <div className="hud-card mb-4 flex items-center gap-4 p-5">
        <Avatar a={p.avatar_url} name={p.display_name} size={64} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-display text-2xl font-bold">{p.display_name}{p.verified && <span title="Verificado">✔️</span>}{p.example && <ExampleTag />}</p>
          <p className="text-sm text-white/70">@{p.handle}{p.main_game ? ` · ${p.main_game}` : ''}{p.province ? ` · ${p.province}` : ''}</p>
          {p.bio && <p className="mt-1 text-sm text-white/80">{p.bio}</p>}
        </div>
      </div>
      <section className="card mb-4">
        <p className="mb-2 font-bold">Equipas</p>
        {(p.teams ?? []).length === 0 ? <p className="text-sm text-white/60">Sem equipa.</p> : (
          <ul className="divide-y divide-line">{p.teams.map((t: Row) => (
            <li key={t.id}><Link href={`/equipas/equipa?id=${encodeURIComponent(t.id)}`} className="flex items-center gap-3 py-2"><TeamBadge name={t.name} logo={t.logo_url} size={36} />
              <span className="flex-1"><b>{t.name}</b> <span className="text-xs text-white/60">{t.game}</span></span><span className="text-xs">{ROLE_LABEL[t.role as MemberRole]}</span></Link></li>))}
          </ul>
        )}
      </section>
      <section className="card">
        <p className="mb-2 font-bold">Histórico</p>
        {(p.history ?? []).length === 0 ? <p className="text-sm text-white/60">Sem desafios concluídos.</p> : (
          <ul className="divide-y divide-line text-sm">{p.history.map((h: Row) => (
            <li key={h.id}><Link href={`/desafios/evento?id=${encodeURIComponent(h.id)}`} className="flex items-center gap-2 py-2"><span className="flex-1">{h.challenger} <b>{h.challenger_score} - {h.opponent_score}</b> {h.opponent}</span><span className="text-xs text-white/55">{fmtDate(h.completed_at)}</span></Link></li>))}
          </ul>
        )}
      </section>
    </>
  );
}
