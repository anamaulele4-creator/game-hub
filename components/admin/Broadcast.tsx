'use client';

import { useEffect, useState } from 'react';
import { Broadcast as B } from '@/lib/store';
import { PROVINCES } from '@/lib/config';
import { PUSH_CATEGORIES, PushCategory } from '@/lib/push';
import { useAdmin, Badge } from './shared';

const SEGMENTS: [string, number][] = [
  ['Todos', 48210], ['Premium', 1238], ['Criadores', 312], ['Inativos há 7+ dias', 9400], ['Inscritos em torneios', 5120], ['Fãs de Free Fire', 30100],
  ...PROVINCES.map((p) => [`Província: ${p}`, Math.round(48210 / 11)] as [string, number]),
];

export default function Broadcast() {
  const { a, upd, act, pushNotif, toast } = useAdmin();
  const [f, setF] = useState({ title: '', body: '', segment: 'Todos', url: '/', category: 'sistema' as PushCategory, schedule: '' });

  // Envia campanhas agendadas cuja hora já passou (na versão real: cron do Supabase / pg_cron + Edge Function send-push)
  useEffect(() => {
    const now = new Date().toISOString().slice(0, 16);
    const due = a.broadcasts.filter((b) => b.status === 'agendada' && b.schedule && b.schedule <= now);
    if (!due.length) return;
    due.forEach((b) => pushNotif({ type: b.category === 'anuncios' ? 'sistema' : b.category, category: b.category, text: `📣 ${b.title}: ${b.body}`, href: b.url }));
    upd({ broadcasts: a.broadcasts.map((b) => (due.includes(b) ? { ...b, status: 'enviada' } : b)) });
  }, [a.broadcasts]); // eslint-disable-line

  const reach = SEGMENTS.find((s) => s[0] === f.segment)?.[1] ?? 0;
  const send = () => {
    if (!f.title.trim() || !f.body.trim()) { toast('Escreve título e mensagem'); return; }
    const b: B = { id: 'bc' + Date.now(), ...f, status: f.schedule ? 'agendada' : 'enviada', reach };
    upd({ broadcasts: [b, ...a.broadcasts] });
    if (!f.schedule) pushNotif({ type: f.category === 'anuncios' ? 'sistema' : f.category, category: f.category, text: `📣 ${f.title}: ${f.body}`, href: f.url });
    act(f.schedule ? 'Agendou notificação' : 'Enviou notificação', `${f.title} → ${f.segment}`, f.schedule ? `Agendada para ${f.schedule.replace('T', ' ')}` : `Enviada a ~${reach.toLocaleString('pt-PT')} pessoas (demo: só tu recebes)`);
    setF({ ...f, title: '', body: '', schedule: '' });
  };

  return (
    <div className="space-y-3">
      <div className="card space-y-2">
        <p className="font-semibold">Nova notificação</p>
        <input className="input w-full" maxLength={50} placeholder="Título" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <textarea className="input min-h-16 w-full" maxLength={160} placeholder="Mensagem (até 160)" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label>Segmento<select className="input w-full" value={f.segment} onChange={(e) => setF({ ...f, segment: e.target.value })}>{SEGMENTS.map(([s]) => <option key={s}>{s}</option>)}</select></label>
          <label>Categoria<select className="input w-full" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as PushCategory })}>{PUSH_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
          <label>Abrir ao tocar<input className="input w-full" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></label>
          <label>Agendar (opcional)<input type="datetime-local" className="input w-full" value={f.schedule} onChange={(e) => setF({ ...f, schedule: e.target.value })} /></label>
        </div>
        <p className="text-xs text-white/50">Alcance estimado: ~{reach.toLocaleString('pt-PT')} · respeita as preferências de cada utilizador e o silêncio noturno.</p>
        <button className="btn w-full" onClick={send}>{f.schedule ? '🗓️ Agendar' : '📣 Enviar agora'}</button>
      </div>
      <div className="space-y-2">
        {a.broadcasts.map((b) => (
          <div key={b.id} className="card !p-3 text-sm">
            <div className="flex justify-between"><span className="font-semibold">{b.title}</span><Badge tone={b.status === 'enviada' ? 'green' : 'amber'}>{b.status}</Badge></div>
            <p className="text-xs text-white/70">{b.body}</p>
            <p className="text-xs text-white/50">{b.segment} · ~{b.reach.toLocaleString('pt-PT')} · {b.schedule ? b.schedule.replace('T', ' ') : 'imediato'}</p>
            {b.status === 'agendada' && <button className="mt-1 text-xs text-pink" onClick={() => { upd({ broadcasts: a.broadcasts.filter((x) => x.id !== b.id) }); act('Cancelou notificação agendada', b.title, 'Cancelada'); }}>Cancelar</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
