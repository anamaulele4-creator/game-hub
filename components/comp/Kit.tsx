'use client';

// Peças partilhadas do módulo competitivo (equipas, desafios, carteira). Identidade TXAPILOG: fundo azul-noite, destaques amarelos.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { IS_DEMO } from '@/lib/config';
import { STATUS_LABEL, UNAVAILABLE, compText } from '@/lib/competitive';
import type { ChallengeStatus } from '@/lib/competitive';
import type { ChallengeView, Me, Res } from '@/lib/competitiveApi';
import { compApi } from '@/lib/competitiveApi';
import { TeamBadge } from '@/components/TeamBadge';

const TONE: Record<ChallengeStatus, string> = {
  DRAFT: 'bg-white/10 text-white/80', OPEN: 'bg-neon text-ink', PENDING_ACCEPTANCE: 'bg-neon2/90 text-ink', ACCEPTED: 'bg-sky-400 text-ink',
  SCHEDULED: 'bg-sky-300 text-ink', IN_PROGRESS: 'bg-emerald-400 text-ink', PENDING_RESULT: 'bg-amber-300 text-ink', UNDER_REVIEW: 'bg-violet-300 text-ink',
  COMPLETED: 'bg-emerald-600 text-white', CANCELLED: 'bg-white/15 text-white/70', DISPUTED: 'bg-red-500 text-white',
};
export function StatusBadge({ s }: { s: ChallengeStatus }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[12px] font-bold ${TONE[s]}`}>{STATUS_LABEL[s]}</span>;
}
export const ExampleTag = () => <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/75">Exemplo · demo</span>;

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return 'Data a combinar';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-PT', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Maputo' });
}

export function ChallengeCard({ c }: { c: ChallengeView }) {
  const done = c.status === 'COMPLETED';
  return (
    <Link href={`/desafios/evento?id=${encodeURIComponent(c.id)}`} className="hud-card block p-4 transition hover:brightness-110">
      <div className="mb-3 flex items-center gap-2 text-xs text-white/70">
        <span className="font-semibold text-neon2">{c.game}</span><span aria-hidden>·</span><span className="truncate">{fmtDate(c.scheduledAt)}</span>
        <span className="ml-auto flex items-center gap-1.5">{c.example && <ExampleTag />}<StatusBadge s={c.status} /></span>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2"><TeamBadge name={c.challenger.name} logo={c.challenger.logo} size={36} /><span className="truncate font-bold">{c.challenger.name}</span></div>
        <span className="stat-num shrink-0 text-lg">{done ? `${c.challengerScore} - ${c.opponentScore}` : 'VS'}</span>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 text-right">
          <span className="truncate font-bold">{c.opponent?.name ?? 'Desafio aberto'}</span>
          {c.opponent ? <TeamBadge name={c.opponent.name} logo={c.opponent.logo} size={36} /> : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-lg">?</span>}
        </div>
      </div>
      {c.title && <p className="mt-2 truncate text-sm text-white/70">{c.title}</p>}
    </Link>
  );
}

/** Estado claro quando as funcionalidades monetárias estão desligadas. */
export function Unavailable({ what = 'Esta funcionalidade', detail }: { what?: string; detail?: string }) {
  return (
    <div role="status" className="rounded-[14px] border border-neon/40 bg-neon/10 p-4 text-sm">
      <p className="font-bold text-neon2">🔒 {UNAVAILABLE}</p>
      <p className="mt-1 text-white/80">{what}: disponível só depois de a licença estar registada e de a funcionalidade ser ativada pela equipa TXAPILOG. {detail ?? 'Nada é cobrado.'}</p>
    </div>
  );
}

export function DemoNote() {
  if (!IS_DEMO) return null;
  return <p className="mb-3 rounded-[14px] bg-neon/10 p-2.5 text-center text-xs text-neon2">Modo demonstração: equipas e desafios marcados “Exemplo” são fictícios. Nada é cobrado nem pago.</p>;
}

const SHORTCUTS: [string, string, string][] = [
  ['/equipas?criar=1', '➕', 'Criar equipa'], ['/desafios?criar=1', '⚔️', 'Criar desafio'], ['/desafios?f=meus', '📋', 'Os meus desafios'],
  ['/apostas#minhas', '🎯', 'As minhas apostas'], ['/carteira', '👛', 'A minha carteira'],
];
export function Shortcuts() {
  return (
    <nav aria-label="Atalhos" className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      {SHORTCUTS.map(([h, i, l]) => (
        <Link key={h} href={h} className="flex min-h-[44px] shrink-0 items-center gap-2 rounded-full bg-panel2 px-4 text-sm font-semibold ring-1 ring-inset ring-white/10 hover:bg-white/10">
          <span aria-hidden>{i}</span>{l}
        </Link>
      ))}
    </nav>
  );
}

/** Executa uma ação do servidor e mostra o resultado em português. Devolve true quando correu bem. */
export function useRun() {
  const { toast } = useStore();
  return useCallback(async <T extends object>(p: Promise<Res<T>>, okMsg?: string): Promise<(Res<T> & { ok: true }) | null> => {
    try {
      const r = await p;
      if (r.ok) { if (okMsg) toast(okMsg); return r as Res<T> & { ok: true }; }
      toast(compText(r.code) + (r.reasons?.length ? ` (${r.reasons.join(', ')})` : ''));
      return null;
    } catch (e) { toast(compText('ERRO')); console.error(e); return null; }
  }, [toast]);
}

export function useMe() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => { compApi.me().then(setMe).catch(() => setMe(null)); }, []);
  return me;
}

export const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <label className="block text-sm [&_input:not([type=checkbox]):not([type=radio]):not([type=file])]:w-full [&_select]:w-full [&_textarea]:w-full"><span className="mb-1 block font-semibold text-white/85">{label}</span>{children}{hint && <span className="mt-1 block text-xs text-white/55">{hint}</span>}</label>
);

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="card text-center text-sm text-white/65">{children}</p>;
}
export const Skel = () => <div className="space-y-3">{[0, 1, 2].map((k) => <div key={k} className="h-24 animate-pulse rounded-xl bg-panel2" />)}</div>;
