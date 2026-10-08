'use client';

// Painel "🩺 POIPAK IA": versão, estado de saúde, erros recentes, auto-reparações e bloqueios da moderação.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { IS_DEMO } from '@/lib/config';
import { AI_CAPABILITIES, AI_LABEL, aiStats, checkHealth, type AiStats, type Health } from '@/lib/poipakAI';
import { Badge } from './shared';

interface Row { id: number | string; message: string; route?: string; count?: number; status?: string; last_seen?: string }

export default function PoipakAdmin() {
  const [h, setH] = useState<Health | null>(null);
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<AiStats | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [server, setServer] = useState<{ fixed: number; mod: number } | null>(null);

  const load = async () => {
    setLocal(aiStats());
    if (IS_DEMO) {
      const m = await import('@/lib/systemErrors');
      const l = m.localSystemErrors();
      setRows(l.slice(-8).reverse().map((e, k) => ({ id: k, message: e.message, route: e.route, count: e.count, status: e.status, last_seen: new Date(e.at).toISOString() })));
      setServer({ fixed: l.filter((e) => e.auto_fixed).length, mod: l.filter((e) => e.message.includes('moderação')).length });
      return;
    }
    try {
      const { sb } = await import('@/lib/supabase');
      const c = await sb();
      const [list, fixed, mod] = await Promise.all([
        c.from('system_errors').select('id,message,route,count,status,last_seen').not('message', 'ilike', '%moderação]%').order('last_seen', { ascending: false }).limit(8),
        c.from('system_errors').select('id', { count: 'exact', head: true }).eq('status', 'auto_fixed'),
        c.from('system_errors').select('count').ilike('message', '%POIPAK IA · moderação%').limit(1000),
      ]);
      setRows((list.data ?? []) as Row[]);
      setServer({ fixed: fixed.count ?? 0, mod: ((mod.data ?? []) as { count: number }[]).reduce((a, r) => a + (r.count ?? 1), 0) });
    } catch { setRows([]); }
  };
  const run = async () => { setBusy(true); setH(await checkHealth()); setLocal(aiStats()); setBusy(false); };
  useEffect(() => { void load(); void run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const tone = (ok: boolean | null) => (ok === null ? 'gray' : ok ? 'green' : 'red') as 'gray' | 'green' | 'red';
  return (
    <div className="space-y-3 text-sm">
      <div className="card">
        <div className="flex items-center justify-between"><p className="text-base font-bold">🩺 POIPAK IA</p><Badge tone="blue">v2.0</Badge></div>
        <p className="text-white/70">{AI_LABEL} · regras próprias, sem APIs pagas, funciona offline.</p>
        <p className="mt-1 text-xs text-white/50">{AI_CAPABILITIES.map((c) => c.icon + ' ' + c.title).join(' · ')}</p>
        <Link href="/poipak-ia" className="mt-2 inline-block text-xs text-neon2">Ver página pública ›</Link>
      </div>

      <div className="card space-y-2">
        <div className="flex items-center justify-between"><p className="font-semibold">Saúde (este dispositivo)</p><button className="btn-ghost !min-h-0 !px-3 !py-1 text-xs" disabled={busy} onClick={() => void run()}>{busy ? 'A verificar…' : 'Verificar agora'}</button></div>
        {h ? (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <p>Servidor <Badge tone={IS_DEMO ? 'gray' : tone(h.server === 'ok' ? true : h.server === 'lento' ? null : false)}>{h.server}{h.ms ? ` · ${h.ms} ms` : ''}</Badge></p>
            <p>Sessão <Badge tone={h.session === 'falha' ? 'red' : 'green'}>{h.session}</Badge></p>
            <p>Armazenamento <Badge tone={tone(h.storage)}>{h.storage ? 'ok' : 'falha'}</Badge></p>
            <p>App/SW <Badge tone={h.sw === 'falha' ? 'red' : 'green'}>{h.sw}</Badge></p>
            <p className="col-span-2">Modo seguro <Badge tone={h.safeMode ? 'amber' : 'green'}>{h.safeMode ? 'ativo' : 'desligado'}</Badge></p>
          </div>
        ) : <p className="text-white/50">A verificar…</p>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="card !p-3 text-center"><p className="text-2xl font-bold">{server?.fixed ?? '…'}</p><p className="text-xs text-white/60">auto-reparações (plataforma)</p></div>
        <div className="card !p-3 text-center"><p className="text-2xl font-bold">{server?.mod ?? '…'}</p><p className="text-xs text-white/60">bloqueios da moderação</p></div>
        <div className="card !p-3 text-center"><p className="text-2xl font-bold">{local?.autoFixes ?? 0}</p><p className="text-xs text-white/60">auto-reparações (este dispositivo)</p></div>
        <div className="card !p-3 text-center"><p className="text-2xl font-bold">{local ? `${local.modBlocks}/${local.modWarnings}` : '0/0'}</p><p className="text-xs text-white/60">bloqueios/avisos (este dispositivo)</p></div>
      </div>

      <div className="card space-y-2">
        <p className="font-semibold">Erros recentes</p>
        {rows === null ? <p className="text-white/50">A carregar…</p> : rows.length === 0 ? <p className="text-white/60">Sem erros registados 🎉</p> : rows.map((r) => (
          <div key={r.id} className="border-b border-line pb-2 last:border-0">
            <p className="line-clamp-2 text-xs">{r.message}</p>
            <p className="text-[11px] text-white/50">{r.route ?? ''} · ×{r.count ?? 1} · {r.status ?? 'new'}{r.last_seen ? ` · ${new Date(r.last_seen).toLocaleString('pt-PT')}` : ''}</p>
          </div>
        ))}
        <p className="text-xs text-white/50">Detalhes e ações em “IA do sistema”.</p>
      </div>
    </div>
  );
}
