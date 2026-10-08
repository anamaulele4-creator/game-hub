'use client';

import { useStore, today } from '@/lib/store';
import Link from 'next/link';
import { Page, Stat } from '@/components/ui';
import { AI_LABEL } from '@/lib/poipakAI';

function lastDays(n: number) {
  const out: { key: string; label: string }[] = [];
  const names = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    out.push({ key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'), label: names[d.getDay()] });
  }
  return out;
}

export default function BemEstarPage() {
  const { s, set, unlock, toast } = useStore();
  const w = s.wellbeing;
  const todayMin = Math.round((s.screen[today()] ?? 0) / 60);
  const days = lastDays(7).map((d) => ({ ...d, min: Math.round((s.screen[d.key] ?? 0) / 60) }));
  const weekTotal = days.reduce((a, d) => a + d.min, 0);
  const max = Math.max(60, ...days.map((d) => d.min));
  const upd = (patch: Partial<typeof w>) => set((p) => ({ ...p, wellbeing: { ...p.wellbeing, ...patch } }));

  return (
    <Page title="Bem-estar" back="/perfil">
      <Link href="/poipak-ia" className="card mb-4 flex items-center gap-3 !p-4"><span className="text-2xl">🩺</span><span className="flex-1"><span className="block font-semibold">Sobre a POIPAK IA</span><span className="block text-xs text-white/60">{AI_LABEL} · pausas, noite, moderação e ajuda</span></span><span className="text-white/40">›</span></Link>
      <div className="card mb-4 text-center">
        <p className="text-sm text-white/70">Tempo hoje</p>
        <p className="text-4xl font-black">{Math.floor(todayMin / 60)}h {todayMin % 60}m</p>
        {w.limitOn && <><div className="mt-2 h-2 rounded bg-panel2"><div className={`h-2 rounded ${todayMin >= w.limitMin ? 'bg-pink' : 'bg-neon2'}`} style={{ width: `${Math.min(100, (todayMin / w.limitMin) * 100)}%` }} /></div><p className="mt-1 text-xs text-white/60">Limite diário: {w.limitMin} min</p></>}
      </div>
      <div className="mb-4 grid grid-cols-3 gap-2">
        <Stat label="Esta semana" value={`${Math.floor(weekTotal / 60)}h ${weekTotal % 60}m`} />
        <Stat label="Média/dia" value={`${Math.round(weekTotal / 7)} min`} />
        <Stat label="Sequência" value={`🔥${s.streak}`} />
      </div>
      <div className="card mb-4">
        <p className="mb-3 text-sm font-semibold">Últimos 7 dias</p>
        <div className="flex h-32 items-end justify-between gap-2">
          {days.map((d) => (
            <div key={d.key} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[9px] text-white/50">{d.min}</span>
              <div className="w-full rounded-t bg-gradient-to-t from-neon to-neon2" style={{ height: `${(d.min / max) * 100}%`, minHeight: 2 }} />
              <span className="text-[11px] text-white/60">{d.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card mb-3">
        <label className="flex items-center justify-between"><span className="text-sm font-semibold">⏳ Limite diário (opcional)</span>
          <input type="checkbox" className="h-5 w-5 accent-sky-600" checked={w.limitOn} onChange={(e) => { upd({ limitOn: e.target.checked }); if (e.target.checked) unlock('a12'); }} /></label>
        {w.limitOn && <><input type="range" min={15} max={240} step={15} value={w.limitMin} onChange={(e) => upd({ limitMin: Number(e.target.value) })} className="mt-3 w-full accent-sky-600" /><p className="text-xs text-white/60">{w.limitMin} minutos por dia. Recebes um aviso quando chegares lá.</p></>}
      </div>
      <div className="card mb-3">
        <label className="flex items-center justify-between"><span className="text-sm font-semibold">💧 Lembretes de pausa</span>
          <input type="checkbox" className="h-5 w-5 accent-sky-600" checked={w.breakOn} onChange={(e) => upd({ breakOn: e.target.checked })} /></label>
        {w.breakOn && <div className="mt-3 flex gap-2">{[30, 45, 60, 90].map((m) => <button key={m} onClick={() => upd({ breakEvery: m })} className={`flex-1 rounded-lg py-1 text-sm ${w.breakEvery === m ? 'bg-neon' : 'bg-panel2'}`}>{m} min</button>)}</div>}
      </div>
      <div className="card mb-3">
        <label className="flex items-center justify-between"><span className="text-sm font-semibold">🌙 Silêncio noturno</span>
          <input type="checkbox" className="h-5 w-5 accent-sky-600" checked={w.nightOn} onChange={(e) => upd({ nightOn: e.target.checked })} /></label>
        {w.nightOn && <div className="mt-3 flex items-center gap-2 text-sm"><span>Das</span><input type="time" className="input" value={w.nightStart} onChange={(e) => upd({ nightStart: e.target.value })} /><span>às</span><input type="time" className="input" value={w.nightEnd} onChange={(e) => upd({ nightEnd: e.target.value })} /></div>}
        <p className="mt-2 text-xs text-white/50">Durante este período não recebes notificações push.</p>
      </div>
      <button className="btn-ghost w-full" onClick={() => toast('💧 Pausa: levanta-te, bebe água e descansa os olhos 5 minutos.')}>Fazer uma pausa agora</button>
    </Page>
  );
}
