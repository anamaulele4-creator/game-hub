'use client';

import { useState } from 'react';
import { WEEKLY_RANKING, divisionFor } from '@/lib/data';
import { useStore } from '@/lib/store';
import { Page, Tabs } from '@/components/ui';

const T = ['Semanal', 'Amigos', 'Free Fire'] as const;
type Tb = (typeof T)[number];

export default function RankingPage() {
  const { s } = useStore();
  const [t, setT] = useState<Tb>('Semanal');
  const weekXp = Math.round(s.xp * 0.6);
  const base = [...WEEKLY_RANKING, { name: s.user.name + ' (tu)', avatar: s.user.avatar, xp: weekXp }].sort((a, b) => b.xp - a.xp);
  const list = t === 'Amigos' ? base.filter((x) => ['Mário_FF', 'Shaira', 'Dércio'].includes(x.name) || x.name.includes('(tu)')) : t === 'Free Fire' ? base.filter((x) => !['Zuri Play', 'Tembo', 'Rocha'].includes(x.name)) : base;
  const podium = list.slice(0, 3);
  return (
    <Page title="Ranking" back="/perfil">
      <Tabs tabs={T} value={t} onChange={setT} />
      <p className="mb-3 text-center text-xs text-white/60">Reinicia segunda-feira às 00:00. Top 3 ganha emblema e 500 moedas.</p>
      <div className="mb-4 flex items-end justify-center gap-2">
        {[podium[1], podium[0], podium[2]].filter(Boolean).map((p, k) => (
          <div key={p.name} className={`card flex w-24 flex-col items-center !p-2 ${k === 1 ? 'h-36 border-amber-400' : 'h-28'}`}>
            <span className="text-3xl">{p.avatar}</span><span className="truncate text-xs">{p.name}</span>
            <span className="text-lg">{k === 1 ? '🥇' : k === 0 ? '🥈' : '🥉'}</span><span className="text-[11px] text-amber-300">{p.xp} XP</span>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {list.map((p, k) => {
          const d = divisionFor(p.xp);
          const me = p.name.includes('(tu)');
          return (
            <div key={p.name} className={`card flex items-center gap-3 !p-3 ${me ? 'border-neon2' : ''}`}>
              <span className="w-6 text-center font-bold">{k + 1}</span><span className="text-2xl">{p.avatar}</span>
              <span className="flex-1 text-sm">{p.name}</span><span className="text-xs" style={{ color: d.color }}>{d.emoji}</span><span className="text-xs text-amber-300">{p.xp} XP</span>
            </div>
          );
        })}
      </div>
    </Page>
  );
}
