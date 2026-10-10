'use client';

import { useState } from 'react';
import { WEEKLY_RANKING, divisionFor } from '@/lib/data';
import { useStore } from '@/lib/store';
import { Page, Tabs, AvatarFace } from '@/components/ui';
import { RankBadge } from '@/components/Hud';

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
          <div key={p.name} className={`podium hud-clip flex w-[30%] max-w-[7.5rem] flex-col items-center justify-end gap-0.5 bg-panel px-1.5 pb-2 pt-3 ${k === 1 ? 'podium-1 h-40 bg-gradient-to-b from-[#2B4FB8] to-panel' : 'h-32'}`} style={k === 1 ? undefined : { boxShadow: 'inset 0 0 0 1px rgba(148,170,235,.22)' }}>
            <span className="text-3xl"><AvatarFace a={p.avatar} name={p.name} /></span><span className="w-full truncate text-center text-xs font-semibold">{p.name}</span>
            <span className="stat-num text-2xl leading-none" style={{ color: k === 1 ? '#FFC20E' : '#fff' }}>#{k === 1 ? 1 : k === 0 ? 2 : 3}</span>
            <span className="stat-num text-[13px] text-neon">{p.xp.toLocaleString('pt-PT')} XP</span>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {list.map((p, k) => {
          const d = divisionFor(p.xp);
          const me = p.name.includes('(tu)');
          return (
            <div key={p.name} className={`card flex min-h-[56px] items-center gap-2.5 !p-3 ${me ? '!border-neon2 shadow-[0_0_14px_rgba(255,194,14,.25)]' : ''}`}>
              <span className={`stat-num w-7 text-center text-xl ${k < 3 ? 'text-neon' : 'text-white/80'}`}>{k + 1}</span><span className="text-2xl"><AvatarFace a={p.avatar} name={p.name} /></span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{p.name}</span><RankBadge name={d.name} size="sm" iconOnly /><span className="stat-num w-[3.75rem] text-right text-sm text-neon">{p.xp.toLocaleString('pt-PT')}</span>
            </div>
          );
        })}
      </div>
    </Page>
  );
}
