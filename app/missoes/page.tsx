'use client';

import Link from 'next/link';
import { DIVISIONS, MISSIONS, divisionFor, levelFor } from '@/lib/data';
import { useStore } from '@/lib/store';
import { Page, Stat } from '@/components/ui';

const HOW: Record<string, string> = { watch: '/clipes', like: '/clipes', comment: '/clipes', share: '/clipes', follow: '/idolos' };

export default function MissoesPage() {
  const { s } = useStore();
  const d = divisionFor(s.xp);
  const lv = levelFor(s.xp);
  const week = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];
  return (
    <Page title="Missões e XP" back="/perfil">
      <div className="card mb-4 text-center">
        <p className="text-5xl">{d.emoji}</p>
        <p className="text-xl font-bold" style={{ color: d.color }}>{d.name}</p>
        <p className="text-sm text-white/60">Nível {lv.level} · {s.xp} XP</p>
        <div className="mt-2 h-2 rounded bg-panel2"><div className="h-2 rounded bg-gradient-to-r from-neon to-neon2" style={{ width: `${lv.pct}%` }} /></div>
        <p className="mt-1 text-xs text-white/50">{lv.into}/250 XP para o nível {lv.level + 1}</p>
      </div>

      <div className="card mb-4">
        <p className="mb-2 font-semibold">🔥 Sequência diária: {s.streak} {s.streak === 1 ? 'dia' : 'dias'}</p>
        <div className="flex justify-between">
          {week.map((w, k) => <div key={k} className={`flex h-9 w-9 items-center justify-center rounded-full text-xs ${k < Math.min(s.streak, 7) ? 'bg-neon text-black' : 'bg-panel2'}`}>{k < Math.min(s.streak, 7) ? '🔥' : w}</div>)}
        </div>
        <p className="mt-2 text-xs text-white/50">Entra todos os dias para +20 XP. 3 dias = conquista &quot;Em Chamas&quot;, 7 dias = &quot;Semana Perfeita&quot;.</p>
      </div>

      <h3 className="mb-2 font-bold">🎯 Missões de hoje ({s.missions.claimed.length}/5)</h3>
      <div className="mb-4 space-y-2">
        {MISSIONS.map((m) => {
          const prog = Math.min(s.missions.progress[m.action] ?? 0, m.goal);
          const done = s.missions.claimed.includes(m.id);
          return (
            <Link key={m.id} href={HOW[m.action]} className={`card flex items-center gap-3 !p-3 ${done ? 'border-lime/50' : ''}`}>
              <span className="text-2xl">{done ? '✅' : m.emoji}</span>
              <div className="flex-1">
                <p className="text-sm font-semibold">{m.name}</p>
                <div className="mt-1 h-1.5 rounded bg-panel2"><div className="h-1.5 rounded bg-lime" style={{ width: `${(prog / m.goal) * 100}%` }} /></div>
              </div>
              <span className="text-xs text-neon">{prog}/{m.goal} · +{m.xp} XP</span>
            </Link>
          );
        })}
      </div>

      <h3 className="mb-2 font-bold">🏅 Divisões</h3>
      <div className="grid grid-cols-4 gap-2">
        {DIVISIONS.map((x) => <Stat key={x.name} label={`${x.minXp}+ XP`} value={<span style={{ color: x.color }} className={x.name === d.name ? 'underline' : ''}>{x.emoji} {x.name}</span>} />)}
      </div>
    </Page>
  );
}
