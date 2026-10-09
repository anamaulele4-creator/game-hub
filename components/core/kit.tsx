'use client';
// TXAPILOG AI CORE · componentes base (cartões, tabelas pesquisáveis, estados, selos).
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { CoreBundle } from '@/lib/core/repo';
import type { Confidence, CoreRole, Source, Validation } from '@/lib/core/stats';
import { timeAgo } from '@/lib/core/stats';

export type SectionKey = 'visao' | 'pesquisa' | 'perfil' | 'historico' | 'equipas' | 'torneios' | 'rankings' | 'notificacoes' | 'ia' | 'utilizadores' | 'auditoria';

export type Perm = 'validar' | 'rever_alertas' | 'papeis' | 'auditoria' | 'criar_torneio' | 'registar' | 'ver_papeis';
const PERMS: Record<Perm, CoreRole[]> = {
  validar: ['admin', 'moderador', 'organizador'],
  rever_alertas: ['admin', 'moderador'],
  papeis: ['admin'],
  ver_papeis: ['admin', 'moderador'],
  auditoria: ['admin'],
  criar_torneio: ['admin', 'moderador', 'organizador'],
  registar: ['admin', 'moderador', 'organizador'],
};
export const can = (role: CoreRole | null, p: Perm) => !!role && PERMS[p].includes(role);

export interface CoreCtxValue {
  bundle: CoreBundle;
  reload: () => Promise<void>;
  go: (s: SectionKey, arg?: string) => void;
  arg: string;
  role: CoreRole | null;
  notify: (msg: string) => void;
}
export const CoreCtx = createContext<CoreCtxValue | null>(null);
export function useCore() { const c = useContext(CoreCtx); if (!c) throw new Error('CoreCtx'); return c; }

/** Executa uma ação e mostra o resultado (inclui o aviso de "Dados de exemplo"). */
export function useAction() {
  const { reload, notify } = useCore();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<'ok' | 'demo'>, okMsg: string) => {
    if (busy) return false;
    setBusy(true);
    try {
      const r = await fn();
      notify(r === 'demo' ? `${okMsg} (Dados de exemplo: só nesta sessão)` : okMsg);
      await reload();
      return true;
    } catch (e) { notify((e as Error).message || 'Falhou.'); return false; } finally { setBusy(false); }
  };
  return { busy, run };
}

export function Panel({ title, action, children, className = '', sub }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; sub?: React.ReactNode }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-core-line bg-core-panel p-4 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0"><h2 className="text-[15px] font-bold leading-tight">{title}</h2>{sub && <p className="mt-0.5 text-xs text-white/60">{sub}</p>}</div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatCard({ label, value, sub, tone = 'default', onClick }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'default' | 'warn' | 'bad' | 'good'; onClick?: () => void }) {
  const ring = { default: 'border-core-line', warn: 'border-neon/60', bad: 'border-red-400/70', good: 'border-emerald-400/60' }[tone];
  const C = onClick ? 'button' : 'div';
  return (
    <C onClick={onClick} className={`min-w-0 rounded-2xl border ${ring} bg-core-panel p-3.5 text-left ${onClick ? 'transition-colors hover:bg-core-panel2' : ''}`}>
      <p className="truncate text-xs text-white/65">{label}</p>
      <p className="mt-1 truncate text-2xl font-extrabold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 truncate text-[12px] text-white/55">{sub}</p>}
    </C>
  );
}

export function NA() { return <span className="text-white/45" title="Sem dados registados">indisponível</span>; }
export function V({ v, f }: { v: number | null | undefined; f?: (n: number) => string }) { return v == null ? <NA /> : <>{f ? f(v) : String(v).replace('.', ',')}</>; }

const VAL: Record<Validation, [string, string]> = {
  submetido: ['Submetido · não verificado', 'border border-neon/70 text-neon2'],
  verificado: ['Verificado', 'bg-emerald-400 text-ink'],
  rejeitado: ['Rejeitado', 'bg-red-500/90 text-white'],
};
export function ValidationBadge({ s }: { s: Validation }) {
  const [l, c] = VAL[s];
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${c}`}>{l}</span>;
}
export const SOURCE_LABEL: Record<Source, string> = { torneio_txapilog: 'Torneio TXAPILOG', submetido_jogador: 'Submetido pelo jogador', provedor_autorizado: 'Fornecedor autorizado' };
export function SourceTag({ s }: { s: Source }) { return <span className="whitespace-nowrap rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] text-white/80">{SOURCE_LABEL[s]}</span>; }

const CONF: Record<Confidence, [string, string]> = {
  alta: ['Confiança alta', 'bg-emerald-400 text-ink'], media: ['Confiança média', 'bg-neon text-ink'],
  baixa: ['Confiança baixa', 'bg-orange-400 text-ink'], indisponivel: ['Confiança: indisponível', 'bg-white/15 text-white/80'],
};
export function ConfidenceBadge({ c }: { c: Confidence }) { const [l, k] = CONF[c]; return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${k}`}>{l}</span>; }

export function SeverityDot({ s }: { s: 'baixa' | 'media' | 'alta' }) {
  const c = { alta: 'bg-red-400', media: 'bg-neon', baixa: 'bg-sky-300' }[s];
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${c}`} aria-label={`Severidade ${s}`} />;
}

/** "Atualizado há X" que se atualiza sozinho. */
export function Updated({ at, prefix = 'Atualizado' }: { at: number | string | null; prefix?: string }) {
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(i); }, []);
  return <span className="whitespace-nowrap text-[12px] text-white/60">{prefix} {timeAgo(at)}</span>;
}

export function DemoBadge() {
  const { bundle } = useCore();
  if (bundle.mode !== 'demo') return null;
  return <span className="whitespace-nowrap rounded-full border border-neon bg-neon/15 px-2 py-0.5 text-[11px] font-bold text-neon2">Dados de exemplo</span>;
}

export function Empty({ icon, title, text, action }: { icon?: React.ReactNode; title: string; text?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-core-line px-4 py-8 text-center">
      {icon && <span className="text-neon" aria-hidden>{icon}</span>}
      <p className="font-semibold">{title}</p>
      {text && <p className="max-w-md text-sm text-white/65">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
export function ErrorBox({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-400/60 bg-red-500/10 p-3 text-sm">
      <span className="flex-1">{text}</span>{onRetry && <button onClick={onRetry} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm">Tentar de novo</button>}
    </div>
  );
}
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return <div className="space-y-2" aria-busy="true" aria-label="A carregar">{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton h-12 rounded-xl" />)}</div>;
}

export function Origin({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 border-t border-core-line pt-2 text-[12px] leading-snug text-white/60">{children}</p>;
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="no-scrollbar flex max-w-full gap-1 overflow-x-auto rounded-xl bg-core-bg p-1">
      {options.map(([v, l]) => (
        <button key={v} role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={`min-h-[34px] shrink-0 rounded-lg px-2.5 text-[13px] ${value === v ? 'bg-neon font-semibold text-ink' : 'text-white/75 hover:bg-white/5'}`}>{l}</button>
      ))}
    </div>
  );
}

export function Select({ value, onChange, options, label, className = '' }: { value: string; onChange: (v: string) => void; options: [string, string][]; label: string; className?: string }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 text-[12px] text-white/65 ${className}`}>{label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="min-h-[40px] min-w-0 rounded-xl border border-core-line bg-core-bg px-2.5 text-sm text-white outline-none focus:border-neon">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

export interface Col<T> { key: string; label: string; render: (r: T) => React.ReactNode; sort?: (r: T) => number | string; className?: string; hideSm?: boolean }

/** Tabela com pesquisa, ordenação e paginação simples. Em ecrãs pequenos rola na horizontal dentro do cartão. */
export function DataTable<T>({ rows, cols, search, placeholder = 'Pesquisar…', empty, pageSize = 25, toolbar, rowKey, initialSort, card }: {
  rows: T[]; cols: Col<T>[]; search?: (r: T) => string; placeholder?: string; empty: React.ReactNode; pageSize?: number; toolbar?: React.ReactNode; rowKey: (r: T) => string; initialSort?: { key: string; dir: 1 | -1 };
  /** Em ecrãs pequenos (< 640 px) mostra cartões em vez da tabela. */
  card?: (r: T) => React.ReactNode;
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(initialSort ?? null);
  const [limit, setLimit] = useState(pageSize);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    let r = t && search ? rows.filter((x) => search(x).toLowerCase().includes(t)) : rows;
    const c = sort && cols.find((x) => x.key === sort.key);
    if (c?.sort) r = r.slice().sort((a, b) => { const x = c.sort!(a), y = c.sort!(b); return (x < y ? -1 : x > y ? 1 : 0) * sort!.dir; });
    return r;
  }, [rows, q, sort, cols, search]);
  return (
    <div className="min-w-0">
      {(search || toolbar) && (
        <div className="mb-3 flex flex-wrap items-end gap-2">
          {search && <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(pageSize); }} placeholder={placeholder} aria-label={placeholder}
            className="min-h-[40px] w-full min-w-0 flex-1 rounded-xl border border-core-line bg-core-bg px-3 text-sm outline-none placeholder:text-white/40 focus:border-neon sm:w-auto sm:min-w-[200px]" />}
          {toolbar}
        </div>
      )}
      {filtered.length === 0 ? empty : (
        <>
          {card && <ul className="space-y-2 sm:hidden">{filtered.slice(0, limit).map((r) => <li key={rowKey(r)} className="rounded-xl border border-core-line bg-core-bg/60 p-3">{card(r)}</li>)}</ul>}
          <div className={`-mx-4 overflow-x-auto px-4 ${card ? 'hidden sm:block' : ''}`}>
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-core-line text-left text-[12px] text-white/60">
                  {cols.map((c) => (
                    <th key={c.key} scope="col" className={`whitespace-nowrap px-2 py-2 font-semibold ${c.className ?? ''}`}>
                      {c.sort ? (
                        <button onClick={() => setSort((s) => ({ key: c.key, dir: s?.key === c.key ? (s.dir === 1 ? -1 : 1) : -1 }))} className="inline-flex items-center gap-1 hover:text-white">
                          {c.label}<span aria-hidden className="text-[10px]">{sort?.key === c.key ? (sort.dir === 1 ? '▲' : '▼') : ''}</span>
                        </button>
                      ) : c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, limit).map((r) => (
                  <tr key={rowKey(r)} className="border-b border-core-line/60 last:border-0 hover:bg-white/[.03]">
                    {cols.map((c) => <td key={c.key} className={`px-2 py-2 align-middle ${c.className ?? ''}`}>{c.render(r)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex items-center justify-between text-[12px] text-white/55">
            <span>{Math.min(limit, filtered.length)} de {filtered.length}</span>
            {filtered.length > limit && <button onClick={() => setLimit((l) => l + pageSize)} className="rounded-lg bg-white/10 px-3 py-1.5 text-white">Mostrar mais</button>}
          </div>
        </>
      )}
    </div>
  );
}

export function fmtDate(iso: string | null | undefined, withTime = true) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: '2-digit' }) + (withTime ? ' ' + d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }) : '');
}

export const btn = 'inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl bg-neon px-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#FFD54F] disabled:opacity-40';
export const btnGhost = 'inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-core-line bg-core-panel2 px-3.5 text-sm font-semibold text-white/90 hover:bg-[#1F3C96] disabled:opacity-40';
export const input = 'min-h-[40px] w-full min-w-0 rounded-xl border border-core-line bg-core-bg px-3 text-sm text-white outline-none placeholder:text-white/40 focus:border-neon';
