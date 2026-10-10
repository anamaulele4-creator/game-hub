'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Clip, fmt, isHot } from '@/lib/data';
import { IS_DEMO } from '@/lib/config';
import { useStore } from '@/lib/store';
import { Sheet } from './ui';

let uidCache: string | null | undefined;
/** id do utilizador com sessão (modo real). */
export function useMyUid() {
  const { s } = useStore();
  const [uid, setUid] = useState<string | null>(uidCache ?? null);
  useEffect(() => {
    if (IS_DEMO) return;
    let alive = true;
    void import('@/lib/supabase').then((m) => m.sb()).then((c) => c.auth.getSession()).then(({ data }) => { uidCache = data.session?.user.id ?? null; if (alive) setUid(uidCache); }).catch(() => {});
    return () => { alive = false; };
  }, [s.account.loggedIn]);
  return uid;
}

export function HotBadge({ id, className = '' }: { id: string; className?: string }) {
  if (!isHot(id)) return null;
  return <span className={`rounded-full bg-neon px-2 py-0.5 text-[11px] font-bold ${className}`}>🔥 Em alta</span>;
}

export function Views({ n, className = '' }: { n: number; className?: string }) {
  return <span className={className}>👁 {fmt(n)}</span>;
}

/** Painel do criador: visualizações, gostos, tempo médio, conclusão; editar visibilidade, apagar; admin: destacar. */
export function ClipStatsSheet({ c, open, onClose, onDeleted }: { c: Clip; open: boolean; onClose: () => void; onDeleted?: () => void }) {
  const { s, set, toast, audit } = useStore();
  const uid = useMyUid();
  const mine = IS_DEMO ? c.idolId === 'me' : !!uid && uid === c.idolId;
  const isAdmin = s.user.role === 'admin';
  const [st, setSt] = useState<import('@/lib/clips').ClipStats | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [vis, setVis] = useState(c.visibility ?? 'public');
  const [featured, setFeatured] = useState(!!c.featured);

  useEffect(() => {
    if (!open) return;
    setErr(''); setConfirmDel(false);
    if (IS_DEMO) { setSt({ views: c.views, likes: c.likes, comments: c.comments, shares: c.shares, avg_watch_s: 9.4, completion: 41, duration: 18, views_24h: Math.round(c.views / 12), views_7d: Math.round(c.views / 2), rank: 3, featured: !!c.featured, status: 'published' }); return; }
    void import('@/lib/clips').then((m) => m.clipStats(c.id)).then(setSt).catch((e) => setErr(String(e.message)));
  }, [open, c]);

  const refresh = () => set((p) => ({ ...p }));
  const doDelete = async () => {
    setBusy(true);
    try { if (!IS_DEMO) await (await import('@/lib/clips')).deleteClip(c); toast('Clipe apagado 🗑️'); refresh(); onClose(); onDeleted?.(); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const doVis = async (v: 'public' | 'followers') => {
    setVis(v);
    try { if (!IS_DEMO) await (await import('@/lib/clips')).updateClip(c.id, { visibility: v }); c.visibility = v; toast(v === 'public' ? 'Visível para todos 🌍' : 'Só para seguidores 👥'); }
    catch (e) { toast((e as Error).message); }
  };
  const doFeature = async () => {
    const on = !featured; setFeatured(on);
    try { if (!IS_DEMO) await (await import('@/lib/clips')).setFeatured(c.id, on); c.featured = on; audit(on ? 'Destacou clipe' : 'Retirou destaque', c.title); toast(on ? '⭐ Clipe destacado no topo' : 'Destaque retirado'); refresh(); }
    catch (e) { setFeatured(!on); toast((e as Error).message); }
  };

  return (
    <Sheet open={open} onClose={onClose} title="📊 Estatísticas do clipe">
      <p className="mb-3 truncate text-sm font-semibold">{c.title}</p>
      {err && <p className="mb-2 rounded-lg bg-pink/20 p-2 text-xs">{err}</p>}
      {!st && !err && <div className="mb-3 grid grid-cols-3 gap-2" aria-busy="true" aria-label="A carregar">{Array.from({ length: 9 }).map((_, k) => <span key={k} className="skeleton h-16 rounded-[14px]" />)}</div>}
      {st && (
        <div className="mb-3 grid grid-cols-3 gap-2 text-center">
          {[['👁 Visualizações', fmt(st.views)], ['💜 Gostos', fmt(st.likes)], ['💬 Comentários', fmt(st.comments)], ['📤 Partilhas', fmt(st.shares)],
            ['⏱ Tempo médio', `${st.avg_watch_s}s`], ['✅ Vistos até ao fim', `${st.completion}%`], ['📈 Últimas 24 h', fmt(st.views_24h)], ['🗓 7 dias', fmt(st.views_7d)], ['🏅 Posição', `#${st.rank}`]]
            .map(([l, v]) => <div key={l} className="rounded-xl bg-panel2 p-2"><p className="text-base font-bold">{v}</p><p className="text-[11px] text-white/60">{l}</p></div>)}
        </div>
      )}
      {st && st.duration ? <p className="mb-3 text-xs text-white/50">Duração {Math.round(Number(st.duration))}s · contamos 1 visualização por pessoa a cada 24 h, após 3 s.</p> : null}
      {mine && (
        <div className="mb-3 space-y-2">
          <p className="text-xs text-white/60">Quem pode ver</p>
          <div className="flex gap-2">
            {(['public', 'followers'] as const).map((v) => <button key={v} onClick={() => doVis(v)} className={`flex-1 rounded-xl border p-2 text-xs ${vis === v ? 'border-neon bg-neon/20' : 'border-line bg-panel2'}`}>{v === 'public' ? '🌍 Público' : '👥 Só seguidores'}</button>)}
          </div>
        </div>
      )}
      {isAdmin && <button onClick={doFeature} className={`mb-2 w-full ${featured ? 'btn' : 'btn-ghost'}`}>{featured ? '⭐ Destacado · retirar' : '⭐ Destacar / fixar no topo'}</button>}
      {mine && !confirmDel && <button onClick={() => setConfirmDel(true)} className="w-full rounded-xl bg-red-600/80 py-2 text-sm font-semibold">🗑️ Apagar clipe</button>}
      {mine && confirmDel && (
        <div className="rounded-xl border border-red-500/60 p-3 text-center text-sm">
          <p className="mb-2">Apagar para sempre? O vídeo, gostos e comentários deixam de aparecer.</p>
          <div className="flex gap-2"><button className="btn-ghost flex-1" onClick={() => setConfirmDel(false)}>Cancelar</button><button disabled={busy} className="flex-1 rounded-xl bg-red-600 py-2 font-semibold" onClick={doDelete}>{busy ? 'A apagar…' : 'Apagar'}</button></div>
        </div>
      )}
      <Link href={`/clipe/${c.id}`} onClick={onClose} className="mt-3 block text-center text-xs text-neon2">Abrir clipe ›</Link>
    </Sheet>
  );
}
