'use client';

import { useState } from 'react';
import { CLIPS, LIVES, SEED_COMMENTS, fmt, idol } from '@/lib/data';
import { Report } from '@/lib/store';
import { Tabs } from '@/components/ui';
import { useAdmin, Badge } from './shared';

const T = ['Fila de denúncias', 'Clipes', 'Comentários', 'Lives', 'Resolvidas'] as const;

export default function Moderation() {
  const { s, a, upd, act, set } = useAdmin();
  const [tab, setTab] = useState<(typeof T)[number]>('Fila de denúncias');
  const isRemoved = (id: string) => a.removed.includes(id) || a.hiddenClips.includes(id);
  const removeContent = (kind: Report['kind'], id: string, on: boolean) => {
    if (kind === 'clipe') upd({ hiddenClips: on ? Array.from(new Set([...a.hiddenClips, id])) : a.hiddenClips.filter((x) => x !== id) });
    else if (kind === 'live') upd({ liveStatus: { ...a.liveStatus, [id]: on ? 'suspensa' : 'ao vivo' } });
    else if (kind === 'utilizador') upd({ users: a.users.map((u) => (u.handle === id ? { ...u, banned: on } : u)) });
    else if (kind === 'anúncio') set((p) => ({ ...p, adsMgr: { ...p.adsMgr, ads: p.adsMgr.ads.map((x) => (x.id === id ? { ...x, review: on ? 'rejeitado' : 'aprovado', reviewNote: on ? 'Removido após denúncia' : undefined } : x)) } }));
    if (kind !== 'clipe' && kind !== 'live') {
      const removed = on ? Array.from(new Set([...a.removed, id])) : a.removed.filter((x) => x !== id);
      if (kind === 'comentário' || kind === 'post') upd({ removed });
    }
  };
  const resolve = (r: Report, status: Report['status']) => {
    if (status === 'removido') removeContent(r.kind, r.target, true);
    set((p) => ({
      ...p,
      admin: { ...p.admin, reports: p.admin.reports.map((x) => (x.id === r.id ? { ...x, status } : x)), ...(r.kind === 'comentário' || r.kind === 'post' ? { removed: status === 'removido' ? Array.from(new Set([...p.admin.removed, r.target])) : p.admin.removed } : {}) },
      myReports: p.myReports.map((x) => (x.id === r.id ? { ...x, status } : x)),
    }));
    act(status === 'removido' ? `Removeu ${r.kind} (denúncia)` : 'Rejeitou denúncia', r.label, status === 'removido' ? 'Conteúdo removido' : 'Denúncia rejeitada');
  };
  const open = a.reports.filter((r) => r.status === 'aberta').sort((x, y) => (x.reason.startsWith('Segurança de menores') ? -1 : 0) - (y.reason.startsWith('Segurança de menores') ? -1 : 0));
  const comments = Object.entries({ ...SEED_COMMENTS, ...s.comments }).flatMap(([target, list]) => list.map((c) => ({ ...c, target })));

  return (
    <div>
      <Tabs tabs={T} value={tab} onChange={setTab} />
      {tab === 'Fila de denúncias' && (
        <div className="space-y-2">
          {open.length === 0 && <p className="card text-center text-sm text-white/60">Fila vazia 🎉</p>}
          {open.map((r) => (
            <div key={r.id} className={`card !p-3 text-sm ${r.reason.startsWith('Segurança de menores') ? 'border-pink' : ''}`}>
              <div className="flex justify-between gap-2"><span className="font-semibold">{r.label}</span><Badge tone={r.reason.startsWith('Segurança de menores') ? 'red' : 'amber'}>{r.kind}</Badge></div>
              <p className="text-[11px] text-white/60">Motivo: {r.reason} · por {r.by} · {r.date}</p>
              {r.reason.startsWith('Segurança de menores') && <p className="mt-1 text-[11px] text-pink">Prioridade CSAE: remover, banir, preservar provas e denunciar às autoridades.</p>}
              <div className="mt-2 flex gap-2 text-xs">
                <button className="flex-1 rounded-xl bg-red-600 py-1.5 font-semibold" onClick={() => resolve(r, 'removido')}>Remover {r.kind === 'utilizador' ? '(banir)' : ''}</button>
                <button className="btn-ghost flex-1 !py-1.5" onClick={() => resolve(r, 'rejeitada')}>Manter (rejeitar)</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {tab === 'Clipes' && (
        <div className="space-y-2">
          {CLIPS.map((c) => {
            const hidden = isRemoved(c.id);
            const n = a.reports.filter((r) => r.target === c.id).length;
            return (
              <div key={c.id} className="card flex items-center gap-3 !p-3 text-sm">
                <span className="text-2xl">{c.emoji}</span>
                <div className="flex-1"><p>{c.title}</p><p className="text-[11px] text-white/50">{idol(c.idolId).name} · {fmt(c.views)} views · {n} denúncia(s){hidden ? ' · REMOVIDO' : ''}</p></div>
                <button className={hidden ? 'btn !px-3 !py-1 text-xs' : 'btn-ghost !px-3 !py-1 text-xs'} onClick={() => { removeContent('clipe', c.id, !hidden); act(hidden ? 'Repôs clipe' : 'Removeu clipe', c.title, hidden ? 'Clipe reposto' : 'Clipe removido'); }}>{hidden ? 'Repor' : 'Remover'}</button>
              </div>
            );
          })}
        </div>
      )}
      {tab === 'Comentários' && (
        <div className="space-y-2">
          {comments.map((c) => {
            const rm = a.removed.includes(c.id);
            return (
              <div key={c.id} className={`card flex items-center gap-3 !p-3 text-sm ${rm ? 'opacity-50' : ''}`}>
                <span className="text-xl">{c.avatar}</span>
                <div className="flex-1"><p className="text-xs text-white/60">{c.author} · em {c.target}</p><p>{c.text}</p></div>
                <button className="btn-ghost !px-3 !py-1 text-xs" onClick={() => { upd({ removed: rm ? a.removed.filter((x) => x !== c.id) : [...a.removed, c.id] }); act(rm ? 'Repôs comentário' : 'Removeu comentário', c.text.slice(0, 40), rm ? 'Reposto' : 'Removido'); }}>{rm ? 'Repor' : 'Remover'}</button>
              </div>
            );
          })}
        </div>
      )}
      {tab === 'Lives' && (
        <div className="space-y-2">
          {LIVES.map((l) => {
            const st = a.liveStatus[l.id] ?? 'ao vivo';
            return (
              <div key={l.id} className="card !p-3 text-sm">
                <div className="flex justify-between"><span className="font-semibold">{l.title}</span><Badge tone={st === 'ao vivo' ? 'green' : st === 'suspensa' ? 'red' : 'gray'}>{st}</Badge></div>
                <p className="text-[11px] text-white/50">{idol(l.idolId).name} · {fmt(l.viewers)} a ver</p>
                <div className="mt-2 flex gap-2 text-xs">
                  {(['ao vivo', 'suspensa', 'terminada'] as const).map((x) => <button key={x} disabled={st === x} className="btn-ghost flex-1 !py-1 disabled:opacity-40" onClick={() => { upd({ liveStatus: { ...a.liveStatus, [l.id]: x } }); act(`Live: ${x}`, l.title, `Live ${x}`); }}>{x === 'ao vivo' ? 'Restaurar' : x === 'suspensa' ? 'Suspender' : 'Terminar'}</button>)}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {tab === 'Resolvidas' && (
        <div className="space-y-2">
          {a.reports.filter((r) => r.status !== 'aberta').map((r) => (
            <div key={r.id} className="card !p-3 text-xs">
              <div className="flex justify-between"><span>{r.kind}: {r.label}</span><Badge tone={r.status === 'removido' ? 'red' : 'gray'}>{r.status}</Badge></div>
              <p className="text-white/50">{r.reason}</p>
              <button className="mt-1 text-neon2" onClick={() => { removeContent(r.kind, r.target, false); set((p) => ({ ...p, admin: { ...p.admin, reports: p.admin.reports.map((x) => (x.id === r.id ? { ...x, status: 'aberta' } : x)), removed: p.admin.removed.filter((x) => x !== r.target) } })); act('Reabriu denúncia', r.label, 'Denúncia reaberta e conteúdo reposto'); }}>Reabrir / repor</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
