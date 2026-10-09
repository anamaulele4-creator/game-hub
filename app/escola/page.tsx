'use client';

import Link from 'next/link';
import { useState } from 'react';
import { LESSONS } from '@/lib/data';
import { useStore } from '@/lib/store';
import { Page, Sheet, Tabs } from '@/components/ui';
import { Icon } from '@/components/icons';

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
      <div className="card mb-4 bg-gradient-to-r from-neon/20 to-neon2/10">
        <p className="flex items-center gap-2 font-semibold"><Icon name="cap" size={20} className="text-[#FFC107]" />Aprende com os melhores de MZ</p>
        <p className="text-xs text-white/70">Aulas curtas com coaches como Kaze. Progresso: {done}/{LESSONS.length}</p>
        <div className="mt-2 h-1.5 rounded bg-panel2"><div className="h-1.5 rounded bg-lime" style={{ width: `${(done / LESSONS.length) * 100}%` }} /></div>
      </div>
      <Tabs tabs={L} value={lv} onChange={setLv} />
      <div className="space-y-2">
        {LESSONS.filter((x) => lv === 'Todas' || x.level === lv).map((x) => (
          <button key={x.id} onClick={() => setOpen(x.id)} className="card flex w-full items-center gap-3 !p-3 text-left">
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${s.lessonsDone.includes(x.id) ? 'bg-ok/15 text-ok' : 'bg-panel2 text-[#FFC107]'}`}><Icon name={s.lessonsDone.includes(x.id) ? 'check' : 'book'} size={22} /></span>
            <div className="flex-1"><p className="text-sm font-semibold">{x.title}</p><p className="text-xs text-white/60">{x.level} · {x.minutes} min</p></div>
            {x.premium && <span className="chip !bg-neon !text-ink">Premium</span>}
          </button>
        ))}
      </div>
      <Link href="/planos" className="card mt-4 block text-center text-sm">Experimenta o <b>Coach IA</b>: análise das tuas partidas e plano de treino</Link>
      <Sheet open={!!lesson} onClose={() => setOpen(null)} title={lesson?.title ?? ''}>
        {lesson && (lesson.premium && !premium ? (
          <div className="text-center"><Icon name="crown" size={48} className="mx-auto mb-3 text-[#FFC107]" /><p className="mb-4 text-sm">Esta aula faz parte do Premium.</p><Link href="/planos" className="btn w-full">Ver Premium</Link></div>
        ) : (
          <>
            <div className="mb-4 flex h-40 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-brand2 text-[#FFC107]"><Icon name="book" size={56} strokeWidth={1.4} /></div>
            <ol className="mb-4 list-inside list-decimal space-y-2 text-sm">{lesson.steps.map((st) => <li key={st}>{st}</li>)}</ol>
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={() => toggleSave({ kind: 'aula', id: lesson.id })} aria-label={isSaved({ kind: 'aula', id: lesson.id }) ? 'Remover dos guardados' : 'Guardar'} aria-pressed={isSaved({ kind: 'aula', id: lesson.id })}><Icon name="star" size={18} className={isSaved({ kind: 'aula', id: lesson.id }) ? 'fill-[#FFC107] text-[#FFC107]' : ''} /></button>
              <button className="btn flex-1" onClick={() => finish(lesson.id)}>{s.lessonsDone.includes(lesson.id) ? 'Concluída ✓' : 'Marcar como concluída (+60 XP)'}</button>
            </div>
          </>
        ))}
      </Sheet>
    </Page>
  );
}
