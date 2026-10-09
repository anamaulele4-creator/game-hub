'use client';
// TXAPILOG AI CORE · estrutura do painel: barra lateral (desktop), barra inferior + gaveta (telemóvel).
import dynamic from 'next/dynamic';
import Link from 'next/link';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { loadCore, type CoreBundle } from '@/lib/core/repo';
import type { CoreRole } from '@/lib/core/stats';
import { CoreCtx, DemoBadge, ErrorBox, Skeleton, Updated, can, type SectionKey } from './kit';
import { Icon, IconName } from '@/components/icons';

const L = () => <Skeleton rows={4} />;
const SECTIONS: Record<SectionKey, { label: string; icon: IconName; C: React.ComponentType; staff?: boolean; roles?: CoreRole[] }> = {
  visao: { icon: 'chart', label: 'Visão geral', C: dynamic(() => import('./Overview'), { ssr: false, loading: L }) },
  pesquisa: { icon: 'search', label: 'Pesquisa por ID', C: dynamic(() => import('./Players').then((m) => m.Search), { ssr: false, loading: L }) },
  perfil: { icon: 'user', label: 'Perfil e estatísticas', C: dynamic(() => import('./Players').then((m) => m.Profile), { ssr: false, loading: L }) },
  historico: { icon: 'clock', label: 'Histórico de partidas', C: dynamic(() => import('./Matches'), { ssr: false, loading: L }) },
  equipas: { icon: 'users', label: 'Equipas', C: dynamic(() => import('./Teams').then((m) => m.Teams), { ssr: false, loading: L }) },
  torneios: { icon: 'trophy', label: 'Torneios', C: dynamic(() => import('./Teams').then((m) => m.Tournaments), { ssr: false, loading: L }) },
  rankings: { icon: 'star', label: 'Rankings e comparação', C: dynamic(() => import('./Players').then((m) => m.Rankings), { ssr: false, loading: L }) },
  notificacoes: { icon: 'bell', label: 'Notificações', C: dynamic(() => import('./Overview').then((m) => m.Notifications), { ssr: false, loading: L }) },
  ia: { icon: 'spark', label: 'Centro de IA', C: dynamic(() => import('./AiCenter'), { ssr: false, loading: L }) },
  utilizadores: { icon: 'shield', label: 'Utilizadores e permissões', C: dynamic(() => import('./Admin').then((m) => m.Users), { ssr: false, loading: L }), roles: ['admin', 'moderador'] },
  auditoria: { icon: 'receipt', label: 'Auditoria e integrações', C: dynamic(() => import('./Admin').then((m) => m.AuditIntegrations), { ssr: false, loading: L }) },
};
const ORDER = Object.keys(SECTIONS) as SectionKey[];
const MOBILE_TABS: SectionKey[] = ['visao', 'pesquisa', 'historico', 'ia'];
const STAFF: CoreRole[] = ['admin', 'moderador', 'organizador'];

function parseHash(): [SectionKey, string] {
  if (typeof window === 'undefined') return ['visao', ''];
  const [k, ...rest] = decodeURIComponent(window.location.hash.replace(/^#/, '')).split(':');
  return [(ORDER.includes(k as SectionKey) ? k : 'visao') as SectionKey, rest.join(':')];
}

export default function CoreApp() {
  const { s, ready, toast } = useStore();
  const [bundle, setBundle] = useState<CoreBundle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [[sec, arg], setNav] = useState<[SectionKey, string]>(['visao', '']);
  const [drawer, setDrawer] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fallbackRole: CoreRole | null = s.user.role === 'admin' ? 'admin' : null;
  const reload = useCallback(async () => {
    setRefreshing(true);
    try { setBundle(await loadCore(fallbackRole)); setErr(null); } catch (e) { setErr((e as Error).message || 'Falha ao carregar.'); } finally { setRefreshing(false); }
  }, [fallbackRole]);

  useEffect(() => { if (ready) void reload(); }, [ready, reload]);
  useEffect(() => {
    const on = () => { setNav(parseHash()); setDrawer(false); };
    on(); window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  useEffect(() => { document.title = `${SECTIONS[sec].label} · TXAPILOG AI CORE`; }, [sec]);

  const go = useCallback((k: SectionKey, a = '') => {
    const h = '#' + k + (a ? ':' + a : '');
    if (window.location.hash !== h) window.location.hash = h; else setNav([k, a]);
    document.getElementById('core-main')?.scrollTo({ top: 0 });
  }, []);

  const role = bundle?.myRole ?? null;
  const visible = useMemo(() => ORDER.filter((k) => !SECTIONS[k].roles || (role && SECTIONS[k].roles!.includes(role))), [role]);
  const ctx = useMemo(() => bundle && { bundle, reload, go, arg, role, notify: toast }, [bundle, reload, go, arg, role, toast]);

  // ---- estados de acesso ----
  const shell = (body: React.ReactNode) => <div className="fixed inset-0 z-[55] flex items-center justify-center overflow-y-auto bg-core-bg p-6 text-white">{body}</div>;
  if (!ready || (!bundle && !err)) return shell(<div className="w-full max-w-md"><p className="mb-3 text-center text-sm text-white/70">A carregar o TXAPILOG AI CORE…</p><Skeleton rows={4} /></div>);
  if (err && !bundle) return shell(<div className="w-full max-w-md space-y-3"><ErrorBox text={`Não foi possível carregar o AI CORE: ${err}`} onRetry={reload} /><Link href="/" className="block text-center text-sm text-neon2">Voltar à app</Link></div>);
  if (!role || !STAFF.includes(role)) return shell(
    <div className="max-w-sm text-center">
      <Icon name="lock" size={44} strokeWidth={1.6} className="mx-auto text-[#FFC107]" /><h1 className="mt-2 text-lg font-bold">Sem permissão</h1>
      <p className="mt-1 text-sm text-white/70">O TXAPILOG AI CORE é reservado a administradores, moderadores e organizadores de torneios.</p>
      <Link href="/" className="mt-4 inline-block rounded-xl bg-neon px-4 py-2 font-semibold text-ink">Voltar à app</Link>
    </div>);

  const cur = visible.includes(sec) ? sec : 'visao';
  const C = SECTIONS[cur].C;
  const NavList = ({ onPick }: { onPick?: () => void }) => (
    <nav aria-label="Secções do AI CORE" className="space-y-0.5">
      {visible.map((k) => (
        <a key={k} href={'#' + k} onClick={onPick} aria-current={k === cur ? 'page' : undefined}
          className={`flex min-h-[42px] items-center gap-3 rounded-xl px-3 text-sm ${k === cur ? 'bg-neon font-semibold text-ink' : 'text-white/80 hover:bg-white/5'}`}>
          <Icon name={SECTIONS[k].icon} size={18} /><span className="truncate">{SECTIONS[k].label}</span>
          {k === 'notificacoes' && bundle!.alerts.filter((a) => a.status === 'aberto').length > 0 && (
            <span className={`ml-auto rounded-full px-1.5 text-[11px] font-bold ${k === cur ? 'bg-ink text-white' : 'bg-red-500 text-white'}`}>{bundle!.alerts.filter((a) => a.status === 'aberto').length}</span>
          )}
        </a>
      ))}
    </nav>
  );
  const Brand = () => (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neon text-sm font-black text-ink">AI</span>
      <div className="min-w-0 leading-tight"><p className="truncate text-sm font-extrabold tracking-wide">TXAPILOG <span className="text-neon">AI CORE</span></p><p className="truncate text-[11px] text-white/55">Free Fire · inteligência de jogadores</p></div>
    </div>
  );

  return (
    <CoreCtx.Provider value={ctx!}>
      <div className="fixed inset-0 z-[55] flex bg-core-bg text-white">
        {/* Barra lateral (desktop) */}
        <aside className="hidden w-64 shrink-0 flex-col border-r border-core-line bg-[#09163F] p-3 md:flex">
          <div className="mb-4 px-1 pt-1"><Brand /></div>
          <div className="min-h-0 flex-1 overflow-y-auto"><NavList /></div>
          <div className="mt-3 space-y-1 border-t border-core-line pt-3 text-[12px] text-white/60">
            <p>Papel: <b className="text-white">{role}</b></p>
            <Link href="/admin" className="block hover:text-white">← Painel Admin</Link>
            <Link href="/" className="block hover:text-white">← Voltar à app</Link>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Cabeçalho */}
          <header className="flex min-h-[56px] shrink-0 items-center gap-2 border-b border-core-line bg-core-bg/95 px-3 pt-[env(safe-area-inset-top)] md:px-6">
            <button onClick={() => setDrawer(true)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-core-panel2 text-lg md:hidden" aria-label="Abrir menu de secções">☰</button>
            <div className="min-w-0 flex-1">
              <div className="md:hidden"><Brand /></div>
              <h1 className="hidden truncate text-lg font-bold md:block">{SECTIONS[cur].label}</h1>
            </div>
            <div className="hidden sm:block"><DemoBadge /></div>
            <div className="hidden text-right sm:block"><Updated at={bundle!.loadedAt} /></div>
            <button onClick={() => void reload()} disabled={refreshing} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-core-panel2 disabled:opacity-50" aria-label="Atualizar dados" title="Atualizar dados">
              <span className={refreshing ? 'animate-spin' : ''} aria-hidden>⟳</span>
            </button>
          </header>

          <main id="core-main" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            <div className="mx-auto w-full max-w-6xl px-4 pb-28 pt-4 md:px-6 md:pb-10">
              <div className="mb-3 flex flex-wrap items-center gap-2 md:hidden">
                <h1 className="mr-auto min-w-0 truncate text-lg font-bold">{SECTIONS[cur].label}</h1>
                <DemoBadge /><Updated at={bundle!.loadedAt} />
              </div>
              {bundle!.mode === 'demo' && <p className="mb-3 rounded-xl border border-neon/50 bg-neon/10 p-2.5 text-[13px] text-neon3"><b>Dados de exemplo</b> — esta é uma build de demonstração. Nenhum destes jogadores, partidas ou estatísticas é real e não há ligação à Garena.</p>}
              {bundle!.missingMigration && (
                <div className="mb-3 rounded-xl border border-neon/60 bg-neon/10 p-3 text-sm">
                  <p className="font-semibold text-neon2">Base de dados do AI CORE ainda não instalada</p>
                  <p className="mt-1 text-white/80">Corre <code className="rounded bg-black/30 px-1">supabase/migrations/2026-10-09-ai-core.sql</code> no SQL Editor do Supabase (ver docs/AI-CORE.md). Até lá não há dados para mostrar — nada é simulado.</p>
                </div>
              )}
              {bundle!.errors.length > 0 && <div className="mb-3"><ErrorBox text={bundle!.errors[0]} onRetry={reload} /></div>}
              <C key={cur} />
            </div>
          </main>

          {/* Barra inferior (telemóvel) */}
          <nav aria-label="Navegação rápida do AI CORE" className="flex shrink-0 justify-around border-t border-core-line bg-[#09163F] pb-[env(safe-area-inset-bottom)] md:hidden">
            {MOBILE_TABS.map((k) => (
              <a key={k} href={'#' + k} aria-current={k === cur ? 'page' : undefined} className="flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5">
                <Icon name={SECTIONS[k].icon} size={20} />
                <span className={`text-[11px] leading-none ${k === cur ? 'font-bold text-neon' : 'text-white/70'}`}>{k === 'visao' ? 'Visão' : k === 'pesquisa' ? 'Pesquisa' : k === 'historico' ? 'Partidas' : 'IA'}</span>
              </a>
            ))}
            <button onClick={() => setDrawer(true)} className="flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5" aria-label="Mais secções">
              <span aria-hidden className="text-lg leading-none">☰</span>
              <span className={`text-[11px] leading-none ${!MOBILE_TABS.includes(cur) ? 'font-bold text-neon' : 'text-white/70'}`}>Mais</span>
            </button>
          </nav>
        </div>

        {/* Gaveta (telemóvel) */}
        {drawer && (
          <div className="fixed inset-0 z-[56] flex md:hidden" role="dialog" aria-modal="true" aria-label="Secções do AI CORE">
            <div className="flex w-[82%] max-w-xs flex-col bg-[#09163F] p-3 shadow-2xl">
              <div className="mb-3 flex items-center justify-between gap-2"><Brand /><button onClick={() => setDrawer(false)} className="flex h-10 w-10 items-center justify-center rounded-xl bg-core-panel2" aria-label="Fechar menu">✕</button></div>
              <div className="min-h-0 flex-1 overflow-y-auto"><NavList onPick={() => setDrawer(false)} /></div>
              <div className="mt-3 space-y-1 border-t border-core-line pt-3 text-[13px] text-white/65">
                <p>Papel: <b className="text-white">{role}</b></p>
                <Link href="/admin" className="block py-1">← Painel Admin</Link>
                <Link href="/" className="block py-1">← Voltar à app</Link>
              </div>
            </div>
            <button className="flex-1 bg-black/60" aria-label="Fechar menu" onClick={() => setDrawer(false)} />
          </div>
        )}
      </div>
    </CoreCtx.Provider>
  );
}

export { can };
