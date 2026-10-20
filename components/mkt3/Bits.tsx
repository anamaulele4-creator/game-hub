'use client';

// Peças partilhadas do Marketplace 3.0 (estados vazios, carregamento, erros, etiquetas, campos).
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { errText } from '@/lib/mkt3';
import { useMkt3 } from '@/lib/mkt3Api';

export function Loading({ rows = 3 }: { rows?: number }) {
  return <div className="space-y-3" aria-busy="true" aria-live="polite">{Array.from({ length: rows }, (_, i) => <div key={i} className="bx-card h-20 animate-pulse" />)}</div>;
}
export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="bx-card p-5 text-center text-[14px] bx-muted">{children}</p>;
}
export function ErrorNote({ code, onRetry }: { code: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="bx-card border-[#FF6B6B]/50 p-4 text-[14px]">
      <p>{errText(code)}</p>
      {onRetry && <button type="button" className="bx-ghost mt-2" onClick={onRetry}>Tentar de novo</button>}
    </div>
  );
}
export function Tag({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'acc' }) {
  const c = { neutral: 'bg-white/15 text-white', ok: 'bg-[#16A34A]/90 text-white', warn: 'bg-[#F59E0B]/90 text-[#1a1200]', bad: 'bg-[#DC2626]/90 text-white', acc: 'bg-[var(--bx-acc)] text-[var(--bx-on)]' }[tone];
  return <span className={`bx-tag shrink-0 ${c}`}>{children}</span>;
}
export const toneFor = (s: string): 'neutral' | 'ok' | 'warn' | 'bad' | 'acc' =>
  ['concluido', 'ativa', 'ativo', 'confirmado', 'pago', 'resolvida', 'procedente'].includes(s) ? 'ok'
    : ['cancelado', 'suspensa', 'suspenso', 'recusado', 'falhou', 'expirado', 'reembolsado', 'rejeitada', 'encerrada', 'disputa'].includes(s) ? 'bad'
      : ['pendente', 'aguarda_pagamento', 'aguardando_resposta', 'aguardando_provas', 'em_analise', 'pedido', 'em_processamento', 'solucao_proposta', 'parcialmente_reembolsado'].includes(s) ? 'warn' : 'neutral';

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-[13px]">
      <span className="mb-1 block font-semibold">{label}</span>
      {children}
      {hint && <span className="bx-dim mt-1 block text-[12px]">{hint}</span>}
    </label>
  );
}

export function Kpi({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="bx-card p-3">
      <p className="bx-muted text-[12px]">{label}</p>
      <p className="mt-0.5 text-[18px] font-bold tabular-nums">{value}</p>
      {hint && <p className="bx-dim text-[11px]">{hint}</p>}
    </div>
  );
}

export function Tabs<T extends string>({ items, value, onChange }: { items: readonly (readonly [T, string])[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4" role="tablist">
      {items.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={value === k} className="bx-chip !min-h-[40px] !text-[13px]" onClick={() => onChange(k)}>{l}</button>)}
    </div>
  );
}

/** Mostra o conteúdo só quando o Marketplace 3.0 está instalado e aberto a este utilizador. */
/** allowClosed: também com o interruptor desligado (para quem já tem pedidos/vendas continuar a acompanhá-los). */
export function Mkt3Gate({ children, staffOnly, allowClosed }: { children: React.ReactNode; staffOnly?: boolean; allowClosed?: boolean }) {
  const m = useMkt3();
  if (m.loading) return <Loading />;
  if (!m.installed) return <Empty>Esta área do marketplace ainda não está disponível.</Empty>;
  if (staffOnly ? !m.isStaff : !(m.open || allowClosed)) return <Empty>Esta área do marketplace ainda não está aberta. <Link href="/marketplace" className="bx-acc font-semibold">Voltar ao marketplace</Link></Empty>;
  return <>{children}</>;
}

/** Carrega dados com estado de carregamento/erro e permite recarregar. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  useEffect(() => {
    let live = true; setError(null);
    run().then((d) => { if (!live) return; const x = d as unknown as { ok?: boolean; code?: string }; if (x && typeof x === 'object' && x.ok === false) { setError(x.code ?? 'ERRO'); setData(null); } else setData(d); })
      .catch((e) => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [run, n]);
  return { data, error, reload: () => setN((x) => x + 1), setData };
}

export function Stars({ value, onChange, size = 'text-2xl' }: { value: number; onChange?: (n: number) => void; size?: string }) {
  return (
    <span className="inline-flex gap-1" role={onChange ? 'radiogroup' : undefined} aria-label={`${value} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((n) => onChange
        ? <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} estrelas`} onClick={() => onChange(n)} className={`h-11 w-11 ${size} ${n <= value ? 'text-[#FFC20E]' : 'text-white/25'}`}>★</button>
        : <span key={n} aria-hidden className={n <= value ? 'text-[#FFC20E]' : 'text-white/25'}>★</span>)}
    </span>
  );
}
