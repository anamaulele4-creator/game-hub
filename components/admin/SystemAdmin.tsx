'use client';

// Painel "IA do sistema": erros registados pelos utilizadores + verificação de saúde das rotas e do Supabase.
import { useEffect, useState } from 'react';
import { IS_DEMO, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/config';
import { localSystemErrors, setLocalSystemErrors } from '@/lib/systemErrors';
import { useAdmin, Badge } from './shared';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const ROUTES: [string, string][] = [['Início', '/'], ['Clipes', '/clipes/'], ['Lives', '/lives/'], ['Torneios', '/torneios/'], ['Loja', '/loja/'], ['Perfil', '/perfil/'], ['Admin', '/admin/'], ['SQL', '/sql.html']];

interface Row { id: string; message: string; stack?: string | null; route: string | null; count: number; status: 'new' | 'auto_fixed' | 'resolved'; last_seen: string }
interface Check { name: string; ok: boolean | null; detail: string }

const STATUS: Record<Row['status'], [string, 'red' | 'amber' | 'green']> = { new: ['novo', 'red'], auto_fixed: ['recuperado sozinho', 'amber'], resolved: ['resolvido', 'green'] };
const when = (iso: string) => { const d = new Date(iso); const m = Math.round((Date.now() - d.getTime()) / 60000); return m < 1 ? 'agora' : m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : d.toLocaleDateString('pt-PT'); };

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> { const t = performance.now(); const r = await fn(); return [r, Math.round(performance.now() - t)]; }

export default function SystemAdmin() {
  const { act } = useAdmin();
  const [rows, setRows] = useState<Row[] | null | undefined>(undefined);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<'abertos' | 'todos'>('abertos');
  const [open, setOpen] = useState<string | null>(null);
  const [checks, setChecks] = useState<Check[]>([]);
  const [checking, setChecking] = useState(false);

  const load = async () => {
    setRows(undefined); setErr('');
    if (IS_DEMO) {
      setRows(localSystemErrors().map((e) => ({ id: e.fingerprint, message: e.message, stack: e.stack, route: e.route, count: e.count ?? 1, status: (e.status as Row['status']) || (e.auto_fixed ? 'auto_fixed' : 'new'), last_seen: new Date(e.at).toISOString() })));
      return;
    }
    try {
      const { sb } = await import('@/lib/supabase');
      const { data, error } = await (await sb()).from('system_errors').select('id,message,stack,route,count,status,last_seen').order('last_seen', { ascending: false }).limit(200);
      if (error) { setErr(/does not exist|42P01|schema cache/i.test(error.message) ? 'Tabela em falta: corra supabase/system-ai.sql no SQL Editor do Supabase.' : error.message); setRows(null); return; }
      setRows((data ?? []).map((d) => ({ ...d, id: String(d.id) })) as Row[]);
    } catch (e) { setErr((e as Error).message); setRows(null); }
  };

  const setStatus = async (ids: string[], status: Row['status']) => {
    if (!ids.length) return;
    if (IS_DEMO) {
      setLocalSystemErrors(localSystemErrors().map((e) => (ids.includes(e.fingerprint) ? { ...e, status } : e)));
    } else {
      const { sb } = await import('@/lib/supabase');
      const { error } = await (await sb()).from('system_errors').update({ status }).in('id', ids.map(Number));
      if (error) { setErr(error.message); return; }
    }
    act(status === 'resolved' ? 'Marcou erro(s) como resolvido(s)' : 'Reabriu erro', `${ids.length} erro(s)`, status === 'resolved' ? 'Marcado como resolvido ✅' : 'Reaberto');
    setRows((r) => r?.map((x) => (ids.includes(x.id) ? { ...x, status } : x)));
  };

  const runChecks = async () => {
    setChecking(true);
    const out: Check[] = await Promise.all(ROUTES.map(async ([name, p]) => {
      try { const [r, ms] = await timed(() => fetch(`${BASE}${p}`, { cache: 'no-store' })); return { name: `${name} (${p})`, ok: r.ok, detail: `${r.status} · ${ms} ms` }; }
      catch (e) { return { name: `${name} (${p})`, ok: false, detail: (e as Error).message || 'sem resposta' }; }
    }));
    if (IS_DEMO) out.push({ name: 'Supabase', ok: null, detail: 'modo demo (sem base de dados)' });
    else {
      try {
        const [r, ms] = await timed(() => fetch(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: SUPABASE_ANON_KEY }, cache: 'no-store' }));
        out.push({ name: 'Supabase · autenticação', ok: r.ok, detail: `${r.status} · ${ms} ms` });
      } catch (e) { out.push({ name: 'Supabase · autenticação', ok: false, detail: (e as Error).message || 'sem resposta' }); }
      try {
        const { sb } = await import('@/lib/supabase');
        const c = await sb();
        const [r, ms] = await timed(async () => await c.from('system_errors').select('id', { count: 'exact', head: true }));
        out.push({ name: 'Supabase · base de dados', ok: !r.error, detail: r.error ? r.error.message : `ok · ${ms} ms` });
      } catch (e) { out.push({ name: 'Supabase · base de dados', ok: false, detail: (e as Error).message }); }
    }
    setChecks(out); setChecking(false);
  };

  useEffect(() => { void load(); void runChecks(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const list = (rows ?? []).filter((r) => filter === 'todos' || r.status !== 'resolved');
  const openCount = (rows ?? []).filter((r) => r.status !== 'resolved').length;
  const okCount = checks.filter((c) => c.ok).length;
  const bad = checks.filter((c) => c.ok === false).length;

  return (
    <div className="space-y-3 text-sm">
      <div className="card space-y-1">
        <p className="font-semibold">🩺 IA do sistema</p>
        <p className="text-xs text-white/60">Deteta erros na app de cada utilizador, regista-os aqui e tenta recuperar sozinha: volta a desenhar a página, depois limpa a cache e recarrega uma vez. Só se mesmo assim falhar é que o utilizador vê o ecrã “A recuperar…”.</p>
      </div>

      <div className="card space-y-2">
        <div className="flex items-center justify-between">
          <p className="font-semibold">💓 Saúde {checks.length > 0 && <Badge tone={bad ? 'red' : 'green'}>{bad ? `${bad} com falha` : `${okCount}/${checks.length} ok`}</Badge>}</p>
          <button onClick={() => void runChecks()} disabled={checking} className="text-xs text-white/50 underline disabled:opacity-40">{checking ? 'A verificar…' : 'Verificar agora'}</button>
        </div>
        {checks.length === 0 ? <div className="skeleton h-16 rounded-ctl" /> : checks.map((c) => (
          <p key={c.name} className="flex items-center justify-between gap-2 text-xs">
            <span>{c.ok === null ? '⚪' : c.ok ? '🟢' : '🔴'} {c.name}</span><span className="text-white/50">{c.detail}</span>
          </p>
        ))}
      </div>

      <div className="card space-y-2">
        <div className="flex items-center justify-between">
          <p className="font-semibold">🐞 Erros {openCount > 0 && <Badge tone="red">{openCount} por resolver</Badge>}</p>
          <button onClick={() => void load()} className="text-xs text-white/50 underline">Atualizar</button>
        </div>
        <div className="flex items-center gap-2">
          {(['abertos', 'todos'] as const).map((f) => <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1 text-xs ${filter === f ? 'bg-neon' : 'bg-panel2 text-white/70'}`}>{f === 'abertos' ? 'Por resolver' : 'Todos'}</button>)}
          {openCount > 1 && <button onClick={() => { if (window.confirm('Marcar todos os erros por resolver como resolvidos?')) void setStatus((rows ?? []).filter((r) => r.status !== 'resolved').map((r) => r.id), 'resolved'); }} className="ml-auto text-xs text-white/60 underline">Resolver todos</button>}
        </div>
        {err && <p className="rounded-lg bg-pink/20 p-2 text-xs">⚠️ {err}</p>}
        {rows === undefined ? <div className="skeleton h-16 rounded-ctl" /> : list.length === 0 ? (
          <p className="py-4 text-center text-xs text-white/50">{rows === null ? 'Sem dados.' : 'Nenhum erro por resolver. Tudo a funcionar 🎉'}</p>
        ) : list.map((r) => (
          <div key={r.id} className="rounded-xl bg-panel2 p-2">
            <button onClick={() => setOpen(open === r.id ? null : r.id)} className="w-full text-left">
              <p className="line-clamp-2 break-words text-xs font-semibold">{r.message}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-white/50">
                <Badge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge>
                <span>×{r.count}</span><span>📍 {r.route || '—'}</span><span>🕒 {when(r.last_seen)}</span>
              </p>
            </button>
            {open === r.id && r.stack && <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-black/40 p-2 text-[11px] text-white/60">{r.stack}</pre>}
            <div className="mt-2 flex justify-end">
              {r.status === 'resolved'
                ? <button onClick={() => void setStatus([r.id], 'new')} className="rounded-full bg-white/10 px-3 py-1 text-xs">Reabrir</button>
                : <button onClick={() => void setStatus([r.id], 'resolved')} className="rounded-full bg-lime px-3 py-1 text-xs font-semibold text-black">✓ Marcar resolvido</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
