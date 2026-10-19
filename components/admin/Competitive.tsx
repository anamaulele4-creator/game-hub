'use client';

// Admin › Competitivo: visão geral, licença e interruptores monetários, disputas e verificação de resultados,
// equipas, fraude, transações e reconciliação, atividade e auditoria. Tudo passa por RPCs com is_admin() e, nas
// operações sensíveis, MFA (aal2) verificado DENTRO da função no servidor.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { STATUS_LABEL, UNAVAILABLE, compText } from '@/lib/competitive';
import type { ChallengeStatus } from '@/lib/competitive';
import { compApi } from '@/lib/competitiveApi';
import type { AdminView } from '@/lib/competitiveApi';
import { IS_DEMO } from '@/lib/config';
import { useStore } from '@/lib/store';
import { Badge } from './shared';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const SUB = ['Visão geral', 'Licença & funcionalidades', 'Disputas & resultados', 'Equipas', 'Fraude', 'Transações', 'Reconciliação', 'Auditoria'] as const;
type Sub = (typeof SUB)[number];
const d = (s?: string | null) => (s ? new Date(s).toLocaleString('pt-PT', { timeZone: 'Africa/Maputo' }) : '—');

export default function CompetitiveAdmin() {
  const { toast } = useStore();
  const [sub, setSub] = useState<Sub>('Visão geral');
  const [v, setV] = useState<AdminView | null>(null);
  const [err, setErr] = useState('');
  const [rec, setRec] = useState<Row | null>(null);
  const load = useCallback(async () => {
    const r = await compApi.adminOverview().catch(() => ({ ok: false as const, code: 'ERRO' }));
    if ('counts' in r) { setV(r); setErr(''); } else setErr(r.code);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const act = async (p: Promise<{ ok: boolean; code?: string }>, ok: string) => {
    const r = await p.catch(() => ({ ok: false, code: 'ERRO' }));
    toast(r.ok ? ok : compText((r as { code?: string }).code)); if (r.ok) void load();
    return r.ok;
  };
  if (err) return <p className="card text-sm">{err === 'NOT_INSTALLED' ? 'Módulo competitivo não instalado: corre supabase/competitive.sql no SQL Editor do Supabase (ver COMPETITIVO.md).' : compText(err)}</p>;
  if (!v) return <div className="card h-24 animate-pulse" />;
  const s = v.settings as Row;
  return (
    <div>
      <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto">
        {SUB.map((x) => <button key={x} type="button" onClick={() => { setSub(x); if (x === 'Reconciliação') void compApi.adminReconcile().then(setRec); }} className={`min-h-[40px] shrink-0 rounded-full px-3 text-xs ${sub === x ? 'bg-neon2 font-semibold text-ink' : 'bg-white/5 text-white/70'}`}>{x}</button>)}
      </div>
      {!v.strongAuth && <p className="mb-3 rounded-lg bg-pink/20 p-2 text-xs">Sessão sem 2FA (aal1): ativar funcionalidades, registar licenças, resolver disputas e abrir mercados exigem entrar com a app autenticadora. <Link className="underline" href="/seguranca">Segurança</Link></p>}
      {IS_DEMO && <p className="mb-3 rounded-lg bg-neon/10 p-2 text-xs text-neon2">Demo: o 2FA é simulado. Em produção o servidor exige aal2.</p>}

      {sub === 'Visão geral' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[['Equipas ativas', v.counts.teams], ['Disputas abertas', v.counts.open_disputes], ['Alertas de risco', v.counts.risk_open], ['Desafios (7 d)', v.activity.challenges_7d ?? 0],
              ['Concluídos (7 d)', v.activity.completed_7d ?? 0], ['Equipas novas (7 d)', v.activity.teams_7d ?? 0], ['Previsões (7 d)', v.activity.predictions_7d ?? 0]].map(([l, n]) => (
              <div key={l as string} className="card text-center"><p className="stat-num text-2xl">{n as number}</p><p className="text-xs text-white/65">{l}</p></div>))}
          </div>
          <div className="card text-sm">
            <p className="mb-1 font-bold">Desafios por estado</p>
            <div className="flex flex-wrap gap-2">{Object.entries(v.counts.challenges ?? {}).map(([k, n]) => <span key={k} className="rounded-full bg-white/10 px-2 py-0.5 text-xs">{STATUS_LABEL[k as ChallengeStatus] ?? k}: {n}</span>)}</div>
          </div>
          <div className="card text-sm">
            <p className="font-bold">Funcionalidades monetárias: {v.monetaryOn ? <Badge tone="green">LIGADAS</Badge> : <Badge tone="red">DESLIGADAS</Badge>} · Apostas: {v.bettingOn ? <Badge tone="green">LIGADAS</Badge> : <Badge tone="red">DESLIGADAS</Badge>}</p>
            {!v.monetaryOn && <p className="mt-1 text-white/65">Os utilizadores veem “{UNAVAILABLE}”.</p>}
          </div>
        </div>
      )}

      {sub === 'Licença & funcionalidades' && <LicencePanel v={v} act={act} />}

      {sub === 'Disputas & resultados' && (
        <div className="space-y-3">
          <p className="text-xs text-white/60">Procedimento: Em disputa → Analisar (fica Em análise) → ver provas na página do evento → Resolver com resultado e fundamentação (ou Anular). Resultados por acordo com mercado de apostas só liquidam depois de “Verificar”.</p>
          {v.review.length === 0 && <p className="card text-sm text-white/60">Nada a rever.</p>}
          {v.review.map((c) => <ReviewRow key={c.id} c={c} act={act} betting={v.bettingOn} />)}
          {v.disputes.length > 0 && <div className="card text-sm"><p className="mb-1 font-bold">Disputas abertas</p>{v.disputes.map((x) => <p key={x.id}>⚖️ {x.challenger} vs {x.opponent}: {x.reason} <span className="text-white/55">({x.status}, {d(x.created_at)}, {(x.evidence_urls ?? []).length} prova(s))</span></p>)}</div>}
        </div>
      )}

      {sub === 'Equipas' && (
        <ul className="card divide-y divide-line !p-0 text-sm">{v.teams.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <Link href={`/equipas/equipa?id=${encodeURIComponent(t.id)}`} className="flex-1"><b>{t.name}</b> <span className="text-xs text-white/60">{t.game} · {t.members} membros · Elo {Math.round(t.rating)}</span></Link>
            <Badge tone={t.status === 'ativa' ? 'green' : 'red'}>{t.status}</Badge>
            {t.status !== 'dissolvida' && <button type="button" className="chip text-xs" onClick={() => { const n = window.prompt('Motivo') ?? ''; void act(compApi.adminTeam(t.id, t.status === 'ativa' ? 'suspender' : 'reativar', n), 'Equipa atualizada'); }}>{t.status === 'ativa' ? 'Suspender' : 'Reativar'}</button>}
          </li>))}
        </ul>
      )}

      {sub === 'Fraude' && (
        <div className="space-y-2 text-sm">
          <p className="text-xs text-white/60">Alertas automáticos: membro a apostar no próprio desafio, ritmo de apostas, aposta anómala, disputas frequentes, valor do webhook diferente, referência duplicada. Gestão em Admin › Risco & Fraude.</p>
          {v.risk.length === 0 ? <p className="card text-white/60">Sem alertas.</p> : v.risk.map((r) => <p key={r.id} className="card">🚩 <b>{r.user_handle ?? '?'}</b> · {r.kind} · {(r.rules ?? []).join(', ')} · risco {r.score} · {r.status} <span className="text-white/55">{d(r.created_at)}</span></p>)}
        </div>
      )}

      {sub === 'Transações' && (
        <ul className="card divide-y divide-line !p-0 text-xs">{v.transactions.length === 0 ? <li className="p-3 text-white/60">Sem movimentos.</li> : v.transactions.map((t) => (
          <li key={t.entry_id} className="flex gap-2 px-3 py-2"><span className="flex-1">@{t.handle} · {t.reason} · <span className="text-white/55">{t.ref}</span></span><b>{t.delta > 0 ? '+' : ''}{t.delta} MT</b><span className="w-32 text-right text-white/55">{d(t.created_at)}</span></li>))}
        </ul>
      )}

      {sub === 'Reconciliação' && (!rec ? <div className="card h-20 animate-pulse" /> : (
        <div className="space-y-2 text-sm">
          <div className="card grid grid-cols-2 gap-2 sm:grid-cols-3">{Object.entries(rec.totals ?? {}).map(([k, n]) => <p key={k}><span className="text-white/60">{k}</span><br /><b>{String(n)} MT</b></p>)}</div>
          {[['Pagos sem movimento no livro-razão', rec.paid_without_ledger], ['Movimentos sem pagamento confirmado', rec.ledger_without_payment], ['Pendentes há mais de 30 min', rec.stale_pending], ['Anomalias do fornecedor (assinatura/estado)', rec.provider_anomalies]].map(([l, L]) => (
            <div key={l as string} className="card"><p className="font-bold">{l as string}: {(L as Row[] ?? []).length}</p>{(L as Row[] ?? []).slice(0, 20).map((x, i) => <p key={i} className="text-xs text-white/70">{JSON.stringify(x)}</p>)}</div>))}
        </div>
      ))}

      {sub === 'Auditoria' && (
        <ul className="card divide-y divide-line !p-0 text-xs">{v.audit.map((a) => (
          <li key={a.id} className="px-3 py-2"><b>{a.action}</b> · {a.target} · @{a.actor ?? 'sistema'} · {a.aal ?? ''} <span className="text-white/55">{d(a.created_at)}</span>{a.details && Object.keys(a.details).length > 0 && <span className="block text-white/55">{JSON.stringify(a.details)}</span>}</li>))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-white/45">Definições: janela de cancelamento {String(s.cancel_window_hours ?? s.cancelWindowHours ?? 2)} h · resposta {String(s.acceptance_hours ?? s.acceptanceHours ?? 72)} h · resultado {String(s.result_hours ?? s.resultHours ?? 24)} h.</p>
    </div>
  );
}

function ReviewRow({ c, act, betting }: { c: Row; act: (p: Promise<{ ok: boolean; code?: string }>, ok: string) => Promise<boolean>; betting: boolean }) {
  const [cs, setCs] = useState(c.challenger_score ?? 0); const [os, setOs] = useState(c.opponent_score ?? 0);
  const st = c.status as ChallengeStatus;
  return (
    <div className="card text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/desafios/evento?id=${encodeURIComponent(c.id)}`} className="flex-1 font-semibold underline-offset-2 hover:underline">{c.challenger} vs {c.opponent ?? '?'} · {c.game}</Link>
        <Badge tone={st === 'DISPUTED' ? 'red' : st === 'UNDER_REVIEW' ? 'amber' : 'gray'}>{STATUS_LABEL[st]}</Badge>
      </div>
      <p className="text-xs text-white/60">{d(c.scheduled_at)}{c.result_source ? ` · resultado por ${c.result_source}` : ''}{c.bet_match_id ? ' · com mercado' : ''}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {['DISPUTED', 'PENDING_RESULT', 'IN_PROGRESS'].includes(st) && <button type="button" className="chip text-xs" onClick={() => act(compApi.adminChallenge(c.id, 'analisar', null, null, 'Em análise'), 'Em análise')}>Analisar</button>}
        {['UNDER_REVIEW', 'DISPUTED'].includes(st) && <>
          <input type="number" min={0} className="input !w-16 !py-1" value={cs} onChange={(e) => setCs(Number(e.target.value))} aria-label="Golos desafiante" />
          <span>-</span>
          <input type="number" min={0} className="input !w-16 !py-1" value={os} onChange={(e) => setOs(Number(e.target.value))} aria-label="Golos adversário" />
          <button type="button" className="chip text-xs" onClick={() => { const n = window.prompt('Fundamentação da decisão (fica no histórico)'); if (n) void act(compApi.adminChallenge(c.id, 'resolver', cs, os, n), 'Resultado decidido'); }}>Resolver</button>
        </>}
        {st === 'COMPLETED' && !c.result_verified_at && <button type="button" className="chip text-xs" onClick={() => act(compApi.adminChallenge(c.id, 'verificar', null, null, 'Verificado'), 'Resultado verificado')}>Verificar resultado</button>}
        {st === 'SCHEDULED' && betting && !c.bet_match_id && <button type="button" className="chip text-xs" onClick={() => act(compApi.adminOpenMarket(c.id), 'Mercado aberto')}>Abrir mercado de apostas</button>}
        {!['COMPLETED', 'CANCELLED'].includes(st) && <button type="button" className="chip text-xs" onClick={() => { const n = window.prompt('Motivo da anulação'); if (n) void act(compApi.adminChallenge(c.id, 'anular', null, null, n), 'Desafio anulado'); }}>Anular</button>}
      </div>
    </div>
  );
}

function LicencePanel({ v, act }: { v: AdminView; act: (p: Promise<{ ok: boolean; code?: string }>, ok: string) => Promise<boolean> }) {
  const [l, setL] = useState({ scope: 'apostas' as 'apostas' | 'pagamentos', authority: 'Inspecção Geral de Jogos (IGJ)', licenceNo: '', validFrom: '', validUntil: '', notes: '' });
  const [confirm, setConfirm] = useState('');
  const mon = !!(v.settings as Row).monetary_features_enabled; const bet = !!(v.settings as Row).betting_enabled;
  return (
    <div className="space-y-3 text-sm">
      <div className="card">
        <p className="mb-2 font-bold">1. Licença (registo no servidor, imutável)</p>
        {v.licences.length === 0 ? <p className="text-white/60">Nenhuma licença registada.</p> : (
          <ul className="mb-2 space-y-1">{v.licences.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-2"><span className="flex-1">{x.authority} · nº <b>{x.licenceNo}</b> · {x.scope} · {x.validFrom} → {x.validUntil}</span>
              {x.revokedAt ? <Badge tone="red">revogada</Badge> : <button type="button" className="chip text-xs" onClick={() => { if (window.confirm('Revogar esta licença? As funcionalidades monetárias deixam de funcionar.')) void act(compApi.adminRevokeLicence(x.id), 'Licença revogada'); }}>Revogar</button>}
            </li>))}
          </ul>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <select className="input" value={l.scope} onChange={(e) => setL({ ...l, scope: e.target.value as 'apostas' | 'pagamentos' })}><option value="apostas">Jogos/apostas</option><option value="pagamentos">Pagamentos</option></select>
          <input className="input" placeholder="Entidade emissora" value={l.authority} onChange={(e) => setL({ ...l, authority: e.target.value })} />
          <input className="input" placeholder="Número da licença" value={l.licenceNo} onChange={(e) => setL({ ...l, licenceNo: e.target.value })} />
          <input className="input" placeholder="Notas (opcional)" value={l.notes} onChange={(e) => setL({ ...l, notes: e.target.value })} />
          <label className="text-xs">Válida desde<input type="date" className="input" value={l.validFrom} onChange={(e) => setL({ ...l, validFrom: e.target.value })} /></label>
          <label className="text-xs">Válida até<input type="date" className="input" value={l.validUntil} onChange={(e) => setL({ ...l, validUntil: e.target.value })} /></label>
        </div>
        <button type="button" className="btn mt-2" disabled={!l.licenceNo || !l.validFrom || !l.validUntil} onClick={() => act(compApi.adminRecordLicence(l), 'Licença registada')}>Registar licença</button>
      </div>
      <div className="card">
        <p className="mb-1 font-bold">2. Fornecedor de pagamentos</p>
        {v.providers.length === 0 ? <p className="text-white/60">M-Pesa: sem verificação ainda. Publica a Edge Function “payments”, define os segredos e chama /health (ver COMPETITIVO.md).</p>
          : v.providers.map((p) => <p key={p.provider}>{p.provider}: {p.configured ? 'configurado' : 'sem segredos'} · {p.live ? 'ao vivo' : 'desligado'} <span className="text-white/55">({d(p.checked_at)})</span></p>)}
        {IS_DEMO && <button type="button" className="chip mt-1 text-xs" onClick={() => act(compApi.demoSetProvider(!(v.providers[0]?.configured)).then(() => ({ ok: true })), 'Demo: fornecedor alterado')}>Demo: alternar fornecedor</button>}
      </div>
      <div className="card">
        <p className="mb-1 font-bold">3. Interruptores (admin + 2FA, auditados)</p>
        <p>Monetário: {mon ? <Badge tone="green">ligado</Badge> : <Badge tone="red">desligado</Badge>} · Apostas: {bet ? <Badge tone="green">ligadas</Badge> : <Badge tone="red">desligadas</Badge>} · efetivo: {v.bettingOn ? 'apostas ativas' : v.monetaryOn ? 'só monetário' : 'tudo bloqueado'}</p>
        <p className="mt-1 text-xs text-white/60">Para ligar escreve <b>ATIVAR</b>. Exige licença válida hoje. Desligar é imediato.</p>
        <input className="input mt-2" placeholder="ATIVAR" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="btn" onClick={() => act(compApi.adminSetFlags(true, false, confirm), 'Funcionalidades monetárias ligadas')}>Ligar monetário</button>
          <button type="button" className="btn" onClick={() => act(compApi.adminSetFlags(true, true, confirm), 'Monetário + apostas ligados')}>Ligar monetário + apostas</button>
          <button type="button" className="btn-ghost" onClick={() => act(compApi.adminSetFlags(false, false, ''), 'Tudo desligado')}>Desligar tudo</button>
        </div>
      </div>
    </div>
  );
}
