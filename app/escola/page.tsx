'use client';

import Link from 'next/link';
import { useState } from 'react';
import { LESSONS } from '@/lib/data';
import { useStore } from '@/lib/store';
import { Page, Sheet, Tabs } from '@/components/ui';

const L = ['Todas', 'Iniciante', 'Intermédio', 'Avançado'] as const;
type Lv = (typeof L)[number];

export default function EscolaPage() {
  const { s, set, addXp, unlock, toggleSave, isSaved } = useStore();
  const [lv, setLv] = useState<Lv>('Todas');
  const [open, setOpen] = useState<string | null>(null);
  const lesson = LESSONS.find((x) => x.id === open);
  const premium = s.plans.includes('premium');
  const done = s.lessonsDone.length;

  const finish = (id: string) => {
    if (s.lessonsDone.includes(id)) return;
    set((p) => ({ ...p, lessonsDone: [...p.lessonsDone, id] }));
    addXp(60, 'aula concluída');
    if (done + 1 >= 3) unlock('a11');
    setOpen(null);
  };

  return (
    <Page title="Escola Free Fire" back="/mais">
      <div className="card mb-4 bg-gradient-to-r from-neon/30 to-pink/20">
        <p className="font-semibold">🎓 Aprende com os melhores de MZ</p>
        <p className="text-xs text-white/70">Aulas curtas com coaches como Kaze. Progresso: {done}/{LESSONS.length}</p>
        <div className="mt-2 h-1.5 rounded bg-panel2"><div className="h-1.5 rounded bg-lime" style={{ width: `${(done / LESSONS.length) * 100}%` }} /></div>
      </div>
      <Tabs tabs={L} value={lv} onChange={setLv} />
      <div className="space-y-2">
        {LESSONS.filter((x) => lv === 'Todas' || x.level === lv).map((x) => (
          <button key={x.id} onClick={() => setOpen(x.id)} className="card flex w-full items-center gap-3 !p-3 text-left">
            <span className="text-3xl">{s.lessonsDone.includes(x.id) ? '✅' : x.emoji}</span>
            <div className="flex-1"><p className="text-sm font-semibold">{x.title}</p><p className="text-xs text-white/60">{x.level} · {x.minutes} min</p></div>
            {x.premium && <span className="chip !bg-amber-400 !text-black">👑 Premium</span>}
          </button>
        ))}
      </div>
      <Link href="/planos" className="card mt-4 block text-center text-sm">🤖 Experimenta o <b>Coach IA</b>: análise das tuas partidas e plano de treino</Link>
      <Sheet open={!!lesson} onClose={() => setOpen(null)} title={lesson?.title ?? ''}>
        {lesson && (lesson.premium && !premium ? (
          <div className="text-center"><p className="mb-3 text-5xl">👑</p><p className="mb-4 text-sm">Esta aula faz parte do Premium.</p><Link href="/planos" className="btn w-full">Ver Premium</Link></div>
        ) : (
          <>
            <div className="mb-4 flex h-40 items-center justify-center rounded-xl bg-gradient-to-br from-neon to-neon2 text-6xl">{lesson.emoji}</div>
            <ol className="mb-4 list-inside list-decimal space-y-2 text-sm">{lesson.steps.map((st) => <li key={st}>{st}</li>)}</ol>
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={() => toggleSave({ kind: 'aula', id: lesson.id })}>{isSaved({ kind: 'aula', id: lesson.id }) ? '🔖' : '📑'}</button>
              <button className="btn flex-1" onClick={() => finish(lesson.id)}>{s.lessonsDone.includes(lesson.id) ? 'Concluída ✓' : 'Marcar como concluída (+60 XP)'}</button>
            </div>
          </>
        ))}
      </Sheet>
    </Page>
  );
}
