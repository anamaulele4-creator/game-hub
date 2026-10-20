'use client';

// Gestão do Marketplace 3.0 (admin e equipa com permissões). Cada módulo só aparece com a permissão respetiva e
// TODAS as operações são verificadas de novo no servidor (as recusas ficam na auditoria).
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { MARKET_CATEGORIES } from '@/lib/market';
import {
  DISPUTE_REASONS, DISPUTE_STATUS, PAYMENT_STATUS, PAYOUT_STATUS, PERMISSIONS, PERM_LABEL, PRODUCT_STATUS, Perm, STORE_STATUS, errText, fmtDate, fmtMt, orderLabel, toCsv,
} from '@/lib/mkt3';
import { AuditFilter, J, downloadText, mkt3, useMkt3 } from '@/lib/mkt3Api';
import { Empty, ErrorNote, Field, Kpi, Loading, Tabs, Tag, toneFor, useLoad } from './Bits';

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const ask = (q: string, min = 5): string | null => { const v = window.prompt(q); if (v == null) return null; if (v.trim().length < min) { window.alert(`Escreve pelo menos ${min} caracteres.`); return null; } return v.trim(); };

type Mod = 'painel' | 'lojas' | 'produtos' | 'pedidos' | 'pagamentos' | 'payouts' | 'disputas' | 'moderacao' | 'risco' | 'utilizadores' | 'comissoes' | 'equipa' | 'auditoria' | 'relatorios' | 'definicoes';
const MODS: [Mod, string, Perm | 'ADMIN' | 'STAFF'][] = [
  ['painel', 'Painel', 'STAFF'], ['lojas', 'Lojas', 'STORES_VIEW'], ['produtos', 'Produtos', 'PRODUCTS_VIEW'], ['pedidos', 'Pedidos e reembolsos', 'ORDERS_VIEW'],
  ['pagamentos', 'Pagamentos', 'PAYMENTS_VIEW'], ['payouts', 'Pagamentos a vendedores', 'PAYOUTS_VIEW'], ['disputas', 'Reclamações', 'DISPUTES_VIEW'],
  ['moderacao', 'Avaliações e denúncias', 'PRODUCTS_VIEW'], ['risco', 'Segurança', 'SECURITY_MANAGE'], ['utilizadores', 'Utilizadores e criadores', 'USERS_VIEW'],
  ['comissoes', 'Comissões', 'SETTINGS_MANAGE'], ['equipa', 'Equipa e permissões', 'ADMIN'], ['auditoria', 'Auditoria', 'AUDIT_LOGS_VIEW'],
  ['relatorios', 'Relatórios', 'REPORTS_VIEW'], ['definicoes', 'Definições', 'ADMIN'],
];

export function Mkt3Admin() {
  const m = useMkt3();
  const allowed = MODS.filter(([, , p]) => (p === 'ADMIN' ? m.isAdmin : p === 'STAFF' ? m.isStaff : m.can(p)));
  const [mod, setMod] = useState<Mod>('painel');
  if (m.loading) return <Loading />;
  if (!m.installed) return <Empty>O SQL do Marketplace 3.0 ainda não foi instalado (ver /sql-marketplace.html).</Empty>;
  if (!m.isStaff) return <Empty>Sem acesso.</Empty>;
  const cur = allowed.find(([k]) => k === mod) ? mod : allowed[0][0];
  return (
    <div>
      <Tabs items={allowed.map(([k, l]) => [k, l] as const)} value={cur} onChange={setMod} />
      {cur === 'painel' && <Dashboard />}
      {cur === 'lojas' && <Stores />}
      {cur === 'produtos' && <ProductsMod />}
      {cur === 'pedidos' && <Orders />}
      {cur === 'pagamentos' && <Payments />}
      {cur === 'payouts' && <Payouts />}
      {cur === 'disputas' && <Disputes />}
      {cur === 'moderacao' && <Moderation />}
      {cur === 'risco' && <Risk />}
      {cur === 'utilizadores' && <Users />}
      {cur === 'comissoes' && <Commissions />}
      {cur === 'equipa' && <Team />}
      {cur === 'auditoria' && <Audit />}
      {cur === 'relatorios' && <ReportsMod />}
      {cur === 'definicoes' && <SettingsMod />}
    </div>
  );
}

function Dates({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (s: string) => void; setTo: (s: string) => void }) {
  return (
    <div className="mb-3 flex flex-wrap items-end gap-2 text-[13px]">
      <Field label="De"><input type="date" className="bx-input !min-h-[40px]" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
      <Field label="Até"><input type="date" className="bx-input !min-h-[40px]" value={to} min={from} max={today()} onChange={(e) => setTo(e.target.value)} /></Field>
    </div>
  );
}

function Dashboard() {
  const [from, setFrom] = useState(daysAgo(29)); const [to, setTo] = useState(today());
  const { data, error, reload } = useLoad(() => mkt3.admin.dashboard(from, to), [from, to]);
  const d = data as J | null;
  return (
    <div>
      <Dates from={from} to={to} setFrom={setFrom} setTo={setTo} />
      {error ? <ErrorNote code={error} onRetry={reload} /> : !d ? <Loading /> : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Kpi label="Utilizadores registados" value={d.users_total} hint={`+${d.users_new} no período`} />
          <Kpi label="Utilizadores ativos (com login)" value={d.users_active} />
          <Kpi label="Criadores ativos" value={d.creators_active} />
          <Kpi label="Lojas ativas" value={d.stores_active} hint={`${d.stores_pending} por verificar`} />
          <Kpi label="Produtos publicados" value={d.products_published} hint={`${d.products_pending} por rever`} />
          <Kpi label="Pedidos realizados" value={d.orders} />
          <Kpi label="Pedidos concluídos" value={d.orders_completed} />
          <Kpi label="Pagamentos confirmados" value={d.payments_confirmed?.count} hint={fmtMt(d.payments_confirmed?.amount)} />
          <Kpi label="Volume de vendas (liquidado)" value={fmtMt(d.sales_volume)} />
          <Kpi label="Comissões registadas" value={fmtMt(d.commissions)} />
          <Kpi label="Reembolsos" value={fmtMt(d.refunds)} />
          <Kpi label="Reclamações pendentes" value={d.disputes_open} />
          <Kpi label="Pagamentos a vendedores pendentes" value={d.payouts_pending?.count} hint={fmtMt(d.payouts_pending?.amount)} />
          <Kpi label="Denúncias abertas" value={d.reports_open} />
          <Kpi label="Incidentes de segurança" value={d.security_incidents} />
          <Kpi label="Acessos negados" value={d.denied_attempts} />
        </div>
      )}
    </div>
  );
}

/** Lista paginada genérica com filtro de estado e pesquisa. */
function useList(entity: string) {
  const [status, setStatus] = useState(''); const [q, setQ] = useState(''); const [qq, setQq] = useState(''); const [page, setPage] = useState(1);
  const r = useLoad(() => mkt3.admin.list(entity, status || null, qq, page), [entity, status, qq, page]);
  const rows = ((r.data as J | null)?.rows ?? []) as J[];
  const bar = (statuses: Record<string, string>, search = true) => (
    <div className="mb-3 flex flex-wrap gap-2">
      <select className="bx-input !w-auto" aria-label="Estado" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
        <option value="">Todos os estados</option>{Object.entries(statuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      {search && <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setQq(q); setPage(1); }}><input className="bx-input !w-48" aria-label="Pesquisar" placeholder="Pesquisar" value={q} onChange={(e) => setQ(e.target.value)} /><button className="bx-ghost">Procurar</button></form>}
    </div>
  );
  const pager = <div className="mt-3 flex justify-center gap-2"><button type="button" className="bx-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button><span className="self-center text-[13px]">{page}</span><button type="button" className="bx-ghost" disabled={rows.length < 50} onClick={() => setPage(page + 1)}>Seguinte</button></div>;
  return { ...r, rows, bar, pager };
}
function ListBody({ l, children }: { l: ReturnType<typeof useList>; children: React.ReactNode }) {
  return l.error ? <ErrorNote code={l.error} onRetry={l.reload} /> : !l.data ? <Loading /> : l.rows.length === 0 ? <Empty>Nada para mostrar.</Empty> : <>{children}{l.pager}</>;
}
function useAct(reload: () => void) {
  const { toast } = useStore();
  return async (p: Promise<{ ok: boolean; code?: string }>, ok = 'Feito.') => { const r = await p; toast(r.ok ? ok : errText(r.code)); if (r.ok) reload(); };
}

function Stores() {
  const m = useMkt3(); const l = useList('lojas'); const act = useAct(l.reload);
  const go = (id: string, a: string, needReason: boolean) => { const r = needReason ? ask(`Motivo (${a}):`) : ''; if (r == null) return; void act(mkt3.admin.storeAction(id, a, r)); };
  return (
    <div>{l.bar(STORE_STATUS)}<ListBody l={l}><ul className="space-y-2">
      {l.rows.map((s) => (
        <li key={s.id} className="bx-card p-3 text-[13.5px]">
          <div className="flex justify-between gap-2"><span><b>{s.name}</b> <span className="bx-dim">/{s.slug} · @{s.owner} · {s.products} produto(s)</span></span><Tag tone={toneFor(s.status)}>{STORE_STATUS[s.status]}</Tag></div>
          {s.status_reason && <p className="bx-muted text-[12.5px]">Motivo: {s.status_reason}</p>}
          <details className="mt-1 text-[12.5px]"><summary className="cursor-pointer bx-dim">Histórico de decisões</summary>
            <ul className="mt-1 space-y-0.5">{(s.history as J[]).map((h, i) => <li key={i}>{fmtDate(h.at)} · {h.action}: {h.from ?? '—'} → {h.to}{h.reason ? ` (${h.reason})` : ''}</li>)}</ul></details>
          {m.can('STORES_MANAGE') && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Link className="bx-ghost !min-h-[36px]" href={`/marketplace/loja/?s=${s.slug}`}>Ver</Link>
              {s.status === 'pendente' && <><button type="button" className="bx-btn !min-h-[36px]" onClick={() => go(s.id, 'aprovar', false)}>Aprovar</button><button type="button" className="bx-ghost !min-h-[36px]" onClick={() => go(s.id, 'rejeitar', true)}>Pedir correções</button></>}
              {['pendente', 'ativa', 'configuracao'].includes(s.status) && <button type="button" className="bx-ghost !min-h-[36px]" onClick={() => go(s.id, 'suspender', true)}>Suspender</button>}
              {s.status === 'suspensa' && <button type="button" className="bx-ghost !min-h-[36px]" onClick={() => go(s.id, 'reativar', false)}>Reativar</button>}
              {s.status !== 'encerrada' && <button type="button" className="bx-ghost !min-h-[36px]" onClick={() => go(s.id, 'encerrar', true)}>Encerrar</button>}
            </div>
          )}
        </li>
      ))}
    </ul></ListBody></div>
  );
}

function ProductsMod() {
  const m = useMkt3(); const l = useList('produtos'); const act = useAct(l.reload);
  const go = (id: string, a: string, needReason: boolean) => { const r = needReason ? ask(`Motivo (${a}):`) : ''; if (r == null) return; void act(mkt3.admin.productAction([id], a, r)); };
  return (
    <div>{l.bar(PRODUCT_STATUS)}<ListBody l={l}><ul className="space-y-2">
      {l.rows.map((p) => (
        <li key={p.id} className="bx-card p-3 text-[13.5px]">
          <div className="flex justify-between gap-2"><Link className="font-semibold hover:underline" href={`/marketplace/anuncio/?id=${p.id}`}>{p.title}</Link><Tag tone={toneFor(p.status)}>{PRODUCT_STATUS[p.status] ?? p.status}</Tag></div>
          <p className="bx-dim text-[12px]">{p.seller_name} · {fmtMt(p.price_mzn)} · stock {p.stock} · {p.sales} vendas · {p.views} visualizações{p.reports ? ` · ${p.reports} denúncia(s)` : ''}</p>
          {p.moderation_reason && <p className="text-[12px] text-[#FBBF24]">{p.moderation_reason}</p>}
          {m.can('PRODUCTS_MODERATE') && (
            <div className="mt-2 flex flex-wrap gap-2">
              {p.status === 'pendente' && <><button type="button" className="bx-btn !min-h-[36px]" onClick={() => go(p.id, 'aprovar', false)}>Aprovar</button><button type="button" className="bx-ghost !min-h-[36px]" onClick={() => go(p.id, 'rejeitar', true)}>Rejeitar</button></>}
              {['ativo', 'pendente', 'esgotado', 'rascunho'].includes(p.status) && <button type="button" className="bx-ghost !min-h-[36px]" onClick={() => go(p.id, 'suspender', true)}>Suspender</button>}
              {p.status === 'suspenso' && <button type="button" className="bx-ghost !min-h-[36px]" onClick={() => go(p.id, 'reativar', false)}>Reativar</button>}
              {p.status !== 'arquivado' && <button type="button" className="bx-ghost !min-h-[36px]" onClick={() => go(p.id, 'arquivar', false)}>Arquivar</button>}
            </div>
          )}
        </li>
      ))}
    </ul></ListBody></div>
  );
}

function Orders() {
  const m = useMkt3(); const l = useList('pedidos'); const act = useAct(l.reload);
  const refund = (o: J) => {
    const max = o.total_mzn - o.refunded_mzn; const a = window.prompt(`Valor a reembolsar (máx. ${max} MT):`, String(max)); if (a == null) return;
    const n = Math.floor(Number(a)); if (!(n > 0 && n <= max)) { window.alert('Valor inválido.'); return; }
    const r = ask('Motivo do reembolso (fica na auditoria):'); if (!r) return;
    if (!window.confirm(`Reembolsar ${n} MT ao comprador @${o.buyer}?`)) return;
    void act(mkt3.admin.refund(o.id, n, r), 'Reembolso feito.');
  };
  const st: Record<string, string> = Object.fromEntries(['aguarda_pagamento', 'pago', 'em_preparacao', 'enviado', 'em_execucao', 'entregue', 'disputa', 'concluido', 'cancelado', 'reembolsado', 'parcialmente_reembolsado'].map((s) => [s, orderLabel(s)]));
  return (
    <div>{l.bar(st)}<ListBody l={l}><ul className="space-y-2">
      {l.rows.map((o) => (
        <li key={o.id} className="bx-card p-3 text-[13.5px]">
          <div className="flex justify-between gap-2"><span><b>{o.product_title}</b> <span className="bx-dim">· @{o.buyer} → @{o.seller}</span></span><Tag tone={toneFor(o.status)}>{orderLabel(o.status)}</Tag></div>
          <p className="bx-dim text-[12px]">{fmtDate(o.created_at)} · total {fmtMt(o.total_mzn)}{o.v3 ? ` · comissão ${fmtMt(o.commission_mzn)} · vendedor ${fmtMt(o.seller_net_mzn)}` : ' · compra segura antiga'}{o.refunded_mzn ? ` · reembolsado ${fmtMt(o.refunded_mzn)}` : ''}</p>
          {o.v3 && <div className="mt-2 flex flex-wrap gap-2">
            <Link className="bx-ghost !min-h-[36px]" href={`/marketplace/pedido/?id=${o.id}`}>Ver pedido</Link>
            {m.can('REFUNDS_MANAGE') && ['pago', 'em_preparacao', 'enviado', 'em_execucao', 'entregue', 'disputa'].includes(o.status) && <button type="button" className="bx-ghost !min-h-[36px]" onClick={() => refund(o)}>Reembolsar</button>}
          </div>}
        </li>
      ))}
    </ul></ListBody></div>
  );
}

function Payments() {
  const l = useList('pagamentos'); const { toast } = useStore();
  const [rec, setRec] = useState<J | null>(null);
  const reconcile = async () => { const r = await mkt3.admin.reconcile(); if (r.ok) setRec(r); else toast(errText(r.code)); };
  return (
    <div>
      <div className="bx-card mb-3 p-3 text-[13.5px]">
        <button type="button" className="bx-btn" onClick={reconcile}>Reconciliar agora</button>
        {rec && <div className="mt-2">
          <p>Retido (escrow): <b>{fmtMt(rec.escrow)}</b> · Comissões: <b>{fmtMt(rec.revenue)}</b> · Pagamentos a vendedores em curso: <b>{fmtMt(rec.payouts_in_progress)}</b> · Pago a vendedores: <b>{fmtMt(rec.paid_out)}</b></p>
          {(rec.issues as J[]).length === 0 ? <p className="mt-1 text-[#4ADE80]">✓ Tudo certo: diário equilibrado, carteiras e pedidos coincidem.</p>
            : <ul className="mt-1 space-y-0.5 text-[#FCA5A5]">{(rec.issues as J[]).map((i, k) => <li key={k}>{i.type}: {JSON.stringify(i)}</li>)}</ul>}
        </div>}
      </div>
      {l.bar(PAYMENT_STATUS)}
      <ListBody l={l}><ul className="space-y-2">
        {l.rows.map((p) => (
          <li key={p.id} className="bx-card p-3 text-[13.5px]">
            <div className="flex justify-between gap-2"><span><b>{fmtMt(p.amount_mzn)}</b> · @{p.buyer} · {p.method}</span><Tag tone={toneFor(p.status)}>{PAYMENT_STATUS[p.status] ?? p.status}</Tag></div>
            <p className="bx-dim text-[12px]">{p.id.slice(0, 8)} · {fmtDate(p.created_at)}{p.provider_ref ? ` · ref ${p.provider_ref}` : ''}{p.failure_reason ? ` · ${p.failure_reason}` : ''}{p.refunded_mzn ? ` · reembolsado ${fmtMt(p.refunded_mzn)}` : ''}</p>
            <p className="bx-dim text-[11.5px]">{(p.events as J[]).map((e) => `${PAYMENT_STATUS[e.to] ?? e.to} (${e.source})`).join(' → ')}</p>
          </li>
        ))}
      </ul></ListBody>
    </div>
  );
}

function Payouts() {
  const m = useMkt3(); const l = useList('payouts'); const act = useAct(l.reload);
  const go = (p: J, a: string) => {
    let ref = ''; let reason = '';
    if (a === 'pago') { const v = ask(`Referência da transação ${p.method} que enviou ${p.amount_mzn} MT para ${p.phone}:`, 6); if (!v) return; ref = v; if (!window.confirm(`Confirmas que ENVIASTE ${p.amount_mzn} MT a @${p.seller} (ref. ${ref})?`)) return; }
    if (a === 'recusar' || a === 'falhou') { const v = ask('Motivo (o valor volta à carteira do vendedor):'); if (!v) return; reason = v; }
    void act(mkt3.admin.payoutAction(p.id, a, ref, reason));
  };
  return (
    <div>{l.bar(PAYOUT_STATUS)}<ListBody l={l}><ul className="space-y-2">
      {l.rows.map((p) => (
        <li key={p.id} className="bx-card p-3 text-[13.5px]">
          <div className="flex justify-between gap-2"><span><b>{fmtMt(p.amount_mzn)}</b> · @{p.seller} · {p.method} {p.phone}{!p.identity_ok && <Tag tone="bad">identidade não verificada</Tag>}</span><Tag tone={toneFor(p.status)}>{PAYOUT_STATUS[p.status]}</Tag></div>
          <p className="bx-dim text-[12px]">{fmtDate(p.requested_at)}{p.provider_ref ? ` · ref ${p.provider_ref}` : ''}{p.reason ? ` · ${p.reason}` : ''}</p>
          {m.can('PAYOUTS_MANAGE') && ['pedido', 'em_processamento'].includes(p.status) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {p.status === 'pedido' && <button type="button" className="bx-ghost !min-h-[36px]" onClick={() => go(p, 'processar')}>Em processamento</button>}
              <button type="button" className="bx-btn !min-h-[36px]" onClick={() => go(p, 'pago')}>Marcar como pago (com referência)</button>
              <button type="button" className="bx-ghost !min-h-[36px]" onClick={() => go(p, 'falhou')}>Falhou</button>
              <button type="button" className="bx-ghost !min-h-[36px]" onClick={() => go(p, 'recusar')}>Recusar</button>
            </div>
          )}
        </li>
      ))}
    </ul></ListBody>
    <p className="bx-dim mt-2 text-[12px]">Os pagamentos são enviados manualmente pelo operador (M-Pesa/e-Mola); “Pago” exige a referência da transação. Envio automático por API: pendente de credenciais B2C.</p></div>
  );
}

function Disputes() {
  const m = useMkt3(); const l = useList('disputas');
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div>{l.bar(DISPUTE_STATUS, false)}<ListBody l={l}><ul className="space-y-2">
      {l.rows.map((d) => (
        <li key={d.id} className="bx-card p-3 text-[13.5px]">
          <div className="flex justify-between gap-2"><span><b>{d.product_title}</b> <span className="bx-dim">· @{d.buyer} vs @{d.seller} · {fmtMt(d.total_mzn)}</span></span><Tag tone={toneFor(d.status)}>{DISPUTE_STATUS[d.status]}</Tag></div>
          <p className="bx-muted text-[12.5px]">{DISPUTE_REASONS[d.reason_code]} — {d.description}</p>
          {d.proposal && <p className="text-[12.5px]">Proposta do vendedor: reembolso de {fmtMt(d.proposal.amount)}</p>}
          <div className="mt-2 flex gap-2"><Link className="bx-ghost !min-h-[36px]" href={`/marketplace/pedido/?id=${d.order_id}`}>Ver pedido</Link>
            <button type="button" className="bx-ghost !min-h-[36px]" onClick={() => setOpen(open === d.id ? null : d.id)}>{open === d.id ? 'Fechar' : 'Analisar'}</button></div>
          {open === d.id && <DisputeStaff d={d} canManage={m.can('DISPUTES_MANAGE')} canRefund={m.can('REFUNDS_MANAGE')} onDone={l.reload} />}
        </li>
      ))}
    </ul></ListBody></div>
  );
}
function DisputeStaff({ d, canManage, canRefund, onDone }: { d: J; canManage: boolean; canRefund: boolean; onDone: () => void }) {
  const [x, setX] = useState<J | null>(null);
  const act = useAct(() => { onDone(); mkt3.disputeGet(d.order_id).then((r) => r.ok && setX(r)); });
  useEffect(() => { mkt3.disputeGet(d.order_id).then((r) => r.ok && setX(r)); }, [d.order_id]);
  const closed = ['resolvida', 'rejeitada', 'encerrada'].includes(d.status);
  const decide = (a: string) => {
    let amount: number | null = null;
    if (a === 'reembolso_parcial') { const v = window.prompt(`Valor a reembolsar (máx. ${d.total_mzn - d.refunded_mzn} MT):`); if (!v) return; amount = Math.floor(Number(v)); }
    const r = ask('Justificação da decisão (mín. 10 caracteres, visível às partes):', 10); if (!r) return;
    if (!window.confirm('Confirmas a decisão? Os movimentos financeiros são definitivos.')) return;
    void act(mkt3.admin.disputeAction(d.id, a, r, amount), 'Decisão registada.');
  };
  return (
    <div className="mt-3 border-t border-[var(--bx-line)] pt-3">
      {!x ? <Loading rows={1} /> : <ul className="space-y-1.5 text-[12.5px]">{(x.messages as J[]).map((mm, i) => <li key={i} className="rounded bg-[var(--bx-card2)] p-2"><span className="bx-dim">{mm.role} · {fmtDate(mm.at)}</span><br />{mm.body}{(mm.evidence as string[]).map((u, k) => <a key={k} className="bx-acc ml-2 underline" href={u} target="_blank" rel="noreferrer">prova {k + 1}</a>)}</li>)}</ul>}
      {canManage && !closed && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="bx-ghost !min-h-[36px]" onClick={() => act(mkt3.admin.disputeAction(d.id, 'analisar', '', null))}>Em análise</button>
          <button type="button" className="bx-ghost !min-h-[36px]" onClick={() => { const r = ask('Que provas são necessárias?'); if (r) void act(mkt3.admin.disputeAction(d.id, 'pedir_provas', r, null)); }}>Pedir provas</button>
          <button type="button" className="bx-ghost !min-h-[36px]" onClick={() => decide('liberar_vendedor')}>Dar razão ao vendedor</button>
          <button type="button" className="bx-ghost !min-h-[36px]" onClick={() => decide('rejeitar')}>Rejeitar reclamação</button>
          {canRefund && <><button type="button" className="bx-btn !min-h-[36px]" onClick={() => decide('reembolso_total')}>Reembolso total</button><button type="button" className="bx-ghost !min-h-[36px]" onClick={() => decide('reembolso_parcial')}>Reembolso parcial</button></>}
        </div>
      )}
    </div>
  );
}

function Moderation() {
  const m = useMkt3(); const rep = useList('denuncias'); const rev = useList('avaliacoes');
  const act = useAct(() => { rep.reload(); rev.reload(); });
  const canAct = m.can('PRODUCTS_MODERATE') || m.can('DISPUTES_MANAGE') || m.can('SECURITY_MANAGE');
  return (
    <div className="space-y-5">
      <section><h3 className="mb-2 font-bold">Denúncias</h3>{rep.bar({ aberta: 'Aberta', em_analise: 'Em análise', procedente: 'Procedente', improcedente: 'Improcedente' }, false)}
        <ListBody l={rep}><ul className="space-y-2">{rep.rows.map((r) => (
          <li key={r.id} className="bx-card p-3 text-[13.5px]">
            <div className="flex justify-between gap-2"><span><b>{r.kind}</b> {r.kind === 'produto' ? <Link className="underline" href={`/marketplace/anuncio/?id=${r.target_id}`}>{r.target_id.slice(0, 8)}</Link> : r.target_id.slice(0, 8)} · por @{r.reporter}</span><Tag tone={toneFor(r.status)}>{r.status}</Tag></div>
            <p className="bx-muted">{r.reason}</p>{r.resolution && <p className="bx-dim text-[12px]">Decisão: {r.resolution}</p>}
            {canAct && ['aberta', 'em_analise'].includes(r.status) && <div className="mt-2 flex gap-2">
              <button type="button" className="bx-ghost !min-h-[36px]" onClick={() => { const n = ask('Justificação (a mensagem/avaliação denunciada fica oculta):'); if (n) void act(mkt3.admin.reportAction(r.id, 'procedente', n)); }}>Procedente</button>
              <button type="button" className="bx-ghost !min-h-[36px]" onClick={() => { const n = ask('Justificação:'); if (n) void act(mkt3.admin.reportAction(r.id, 'improcedente', n)); }}>Improcedente</button>
            </div>}
          </li>))}</ul></ListBody>
      </section>
      <section><h3 className="mb-2 font-bold">Avaliações</h3>{rev.bar({ visiveis: 'Visíveis', ocultas: 'Ocultas' }, false)}
        <ListBody l={rev}><ul className="space-y-2">{rev.rows.map((r) => (
          <li key={r.order_id} className="bx-card p-3 text-[13.5px]"><b>{'★'.repeat(r.rating)}</b> <span className="bx-dim">@{r.buyer} → @{r.seller} · {fmtDate(r.created_at)}</span>{r.hidden && <Tag tone="bad">oculta</Tag>}<p>{r.comment}</p>{r.seller_reply && <p className="bx-muted">Resposta: {r.seller_reply}</p>}</li>
        ))}</ul></ListBody>
        <p className="bx-dim mt-2 text-[12px]">Avaliações só são ocultadas através de uma denúncia procedente (com justificação registada) — nunca apagadas.</p>
      </section>
    </div>
  );
}

function Risk() {
  const l = useList('risco'); const act = useAct(l.reload);
  return (
    <div>{l.bar({ aberto: 'Aberto', em_revisao: 'Em revisão', confirmado: 'Fraude confirmada', descartado: 'Descartado' }, false)}<ListBody l={l}><ul className="space-y-2">
      {l.rows.map((r) => (
        <li key={r.id} className="bx-card p-3 text-[13.5px]">
          <div className="flex justify-between gap-2"><span><b>{r.kind}</b> · @{r.handle ?? '—'} · risco {r.score}</span><Tag tone={toneFor(r.status)}>{r.status}</Tag></div>
          <p className="bx-dim text-[12px]">{fmtDate(r.created_at)} · {r.ref} {JSON.stringify(r.detail)}</p>
          {['aberto', 'em_revisao'].includes(r.status) && <div className="mt-2 flex flex-wrap gap-2">
            {r.status === 'aberto' && <button type="button" className="bx-ghost !min-h-[36px]" onClick={() => act(mkt3.admin.riskAction(r.id, 'em_revisao', ''))}>Rever</button>}
            <button type="button" className="bx-ghost !min-h-[36px]" onClick={() => { const n = ask('Nota:'); if (n) void act(mkt3.admin.riskAction(r.id, 'confirmado', n)); }}>Confirmar fraude</button>
            <button type="button" className="bx-ghost !min-h-[36px]" onClick={() => { const n = ask('Nota:'); if (n) void act(mkt3.admin.riskAction(r.id, 'descartado', n)); }}>Descartar</button>
          </div>}
        </li>
      ))}
    </ul></ListBody><p className="bx-dim mt-2 text-[12px]">Nada é bloqueado automaticamente: os sinais servem para revisão humana. Suspensões temporárias fazem-se em “Utilizadores”.</p></div>
  );
}

function Users() {
  const m = useMkt3(); const [ent, setEnt] = useState<'utilizadores' | 'criadores'>('utilizadores');
  const l = useList(ent); const act = useAct(l.reload);
  const suspend = (u: J) => {
    const h = window.prompt('Suspender por quantas horas? (1–720; 0 = levantar suspensão)', u.suspended_until ? '0' : '24'); if (h == null) return;
    const n = Math.floor(Number(h)); if (!(n >= 0 && n <= 720)) return;
    const r = ask('Motivo (mín. 10 caracteres; o utilizador é avisado):', 10); if (!r) return;
    void act(mkt3.admin.suspend(u.id, n, r));
  };
  return (
    <div>
      <div className="mb-2 flex gap-2">{(['utilizadores', 'criadores'] as const).map((k) => <button key={k} type="button" className="bx-chip !min-h-[36px]" aria-pressed={ent === k} onClick={() => setEnt(k)}>{k === 'utilizadores' ? 'Todos' : 'Criadores'}</button>)}</div>
      {l.bar({}, true)}<ListBody l={l}><ul className="space-y-2">
        {l.rows.map((u) => (
          <li key={u.id} className="bx-card flex flex-wrap items-center justify-between gap-2 p-3 text-[13.5px]">
            <span><b>{u.display_name}</b> <span className="bx-dim">@{u.handle} · {u.role}{u.seller_verified ? ' · vendedor verificado' : ''}{u.store ? ` · loja /${u.store}` : ''} · {u.products} produto(s)</span>
              {u.banned && <Tag tone="bad">banido</Tag>}{u.suspended_until && new Date(u.suspended_until) > new Date() && <Tag tone="warn">suspenso até {fmtDate(u.suspended_until)}</Tag>}</span>
            {m.can('USERS_MANAGE') && u.role !== 'admin' && <button type="button" className="bx-ghost !min-h-[36px]" onClick={() => suspend(u)}>Suspensão temporária</button>}
          </li>
        ))}
      </ul></ListBody>
      <p className="bx-dim mt-2 text-[12px]">Funções (criador/moderador/admin) e banimentos definitivos continuam em Admin › Utilizadores.</p>
    </div>
  );
}

function Commissions() {
  const l = useList('comissoes'); const act = useAct(l.reload);
  const [f, setF] = useState({ scope: 'global', category: 'ff', seller: '', pct: '', fixed: '0', note: '' });
  const save = async () => {
    let seller: string | null = null;
    if (f.scope === 'vendedor') { const u = await mkt3.admin.findUser(f.seller); if (!u.ok) { window.alert('Utilizador não encontrado.'); return; } seller = u.id as string; }
    if (!window.confirm('Criar esta regra? A anterior do mesmo âmbito é desativada; pedidos já feitos mantêm a regra antiga.')) return;
    void act(mkt3.admin.commissionSet(f.scope, f.scope === 'categoria' ? f.category : null, seller, f.pct === '' ? null : Number(f.pct), Number(f.fixed) || 0, f.note), 'Regra guardada.');
  };
  return (
    <div className="space-y-3">
      <div className="bx-card grid gap-2 p-4 sm:grid-cols-3">
        <Field label="Âmbito"><select className="bx-input" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}><option value="global">Global</option><option value="categoria">Categoria</option><option value="vendedor">Vendedor</option></select></Field>
        {f.scope === 'categoria' && <Field label="Categoria"><select className="bx-input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{MARKET_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</select></Field>}
        {f.scope === 'vendedor' && <Field label="@utilizador"><input className="bx-input" value={f.seller} onChange={(e) => setF({ ...f, seller: e.target.value })} /></Field>}
        <Field label="Percentagem (0–50)" hint="Vazio = retirar a regra deste âmbito"><input className="bx-input" inputMode="decimal" value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value.replace(',', '.') })} /></Field>
        <Field label="Taxa fixa por pedido (MT)"><input className="bx-input" inputMode="numeric" value={f.fixed} onChange={(e) => setF({ ...f, fixed: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="Nota"><input className="bx-input" maxLength={300} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <div className="flex items-end"><button type="button" className="bx-btn w-full" onClick={save}>Guardar regra</button></div>
      </div>
      <p className="bx-dim text-[12px]">Prioridade: vendedor → categoria → global → taxa antiga do marketplace (Admin › Marketplace). Sem nenhuma, o checkout fica indisponível.</p>
      <ListBody l={l}><ul className="space-y-1 text-[13.5px]">{l.rows.map((c) => (
        <li key={c.id} className="bx-card flex justify-between gap-2 p-3"><span><b>{c.scope}</b>{c.category ? ` · ${c.category}` : ''}{c.seller ? ` · @${c.seller}` : ''} · {Number(c.pct)}%{c.fixed_mzn ? ` + ${c.fixed_mzn} MT` : ''} <span className="bx-dim">· {fmtDate(c.created_at)}{c.note ? ` · ${c.note}` : ''}</span></span><Tag tone={c.active ? 'ok' : 'neutral'}>{c.active ? 'ativa' : 'histórico'}</Tag></li>
      ))}</ul></ListBody>
    </div>
  );
}

function Team() {
  const { data, error, reload } = useLoad(() => mkt3.admin.staff(), []);
  const act = useAct(reload);
  const [h, setH] = useState('');
  const add = async (preset: string) => {
    const u = await mkt3.admin.findUser(h); if (!u.ok) { window.alert('Utilizador não encontrado.'); return; }
    void act(mkt3.admin.setPerm(u.id as string, preset, true), 'Permissões atribuídas.'); setH('');
  };
  const rows = ((data as J | null)?.rows ?? []) as J[];
  return (
    <div className="space-y-3">
      <div className="bx-card flex flex-wrap items-end gap-2 p-4">
        <Field label="Adicionar à equipa (@utilizador)"><input className="bx-input !w-48" value={h} onChange={(e) => setH(e.target.value)} /></Field>
        <button type="button" className="bx-ghost" disabled={!h} onClick={() => add('PRESET_SUPORTE')}>Suporte</button>
        <button type="button" className="bx-ghost" disabled={!h} onClick={() => add('PRESET_MODERACAO')}>Moderação</button>
        <button type="button" className="bx-ghost" disabled={!h} onClick={() => add('PRESET_FINANCEIRO')}>Financeiro</button>
      </div>
      {error ? <ErrorNote code={error} onRetry={reload} /> : !data ? <Loading /> : (
        <ul className="space-y-2">{rows.map((u) => (
          <li key={u.id} className="bx-card p-3 text-[13px]">
            <p className="mb-2"><b>{u.display_name}</b> <span className="bx-dim">@{u.handle} · {u.role}</span>{u.role === 'admin' && <span className="bx-dim"> — admin tem todas as permissões</span>}</p>
            {u.role !== 'admin' && <div className="grid gap-1 sm:grid-cols-2">{PERMISSIONS.map((p) => (
              <label key={p} className="flex items-center gap-2"><input type="checkbox" checked={(u.perms as string[]).includes(p)} onChange={(e) => act(mkt3.admin.setPerm(u.id, p, e.target.checked), 'Atualizado.')} /> {PERM_LABEL[p]} <span className="bx-dim text-[11px]">{p}</span></label>
            ))}</div>}
          </li>
        ))}</ul>
      )}
    </div>
  );
}

const EMPTY_F: AuditFilter = { actor: '', action: '', resource: '', result: '', area: '', from: daysAgo(30), to: today() };
function Audit() {
  const m = useMkt3(); const { toast } = useStore();
  const [f, setF] = useState<AuditFilter>(EMPTY_F); const [applied, setApplied] = useState<AuditFilter>(EMPTY_F); const [page, setPage] = useState(1);
  const { data, error, reload } = useLoad(() => mkt3.admin.audit(applied, page), [applied, page]);
  const rows = ((data as J | null)?.rows ?? []) as J[]; const legacy = ((data as J | null)?.legacy ?? []) as J[];
  const exp = async () => {
    const r = await mkt3.admin.auditExport(applied); if (!r.ok) { toast(errText(r.code)); return; }
    downloadText(`auditoria-${applied.from}-${applied.to}.csv`, toCsv(r.rows as J[], ['id', 'created_at', 'area', 'action', 'target', 'actor_handle', 'result', 'reason', 'before', 'after', 'meta']));
  };
  const I = (k: keyof AuditFilter, label: string, type = 'text') => <Field label={label}><input type={type} className="bx-input !min-h-[40px]" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>;
  return (
    <div>
      <form className="bx-card mb-3 grid gap-2 p-3 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); setApplied(f); setPage(1); }}>
        {I('actor', 'Administrador (@)')}{I('action', 'Ação')}{I('resource', 'Recurso')}
        <Field label="Resultado"><select className="bx-input !min-h-[40px]" value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })}><option value="">Todos</option><option value="ok">OK</option><option value="negado">Acesso negado</option><option value="erro">Erro</option><option value="diferencas">Diferenças</option></select></Field>
        <Field label="Área"><select className="bx-input !min-h-[40px]" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })}><option value="">Todas</option><option value="marketplace">Marketplace</option><option value="definicoes">Definições</option><option value="apostas">Apostas</option><option value="legado">Registo antigo</option></select></Field>
        {I('from', 'De', 'date')}{I('to', 'Até', 'date')}
        <div className="flex items-end gap-2"><button className="bx-btn">Filtrar</button>{m.can('AUDIT_LOGS_EXPORT') && <button type="button" className="bx-ghost" onClick={exp}>Exportar CSV</button>}</div>
      </form>
      {error ? <ErrorNote code={error} onRetry={reload} /> : !data ? <Loading /> : (
        <>
          {rows.length === 0 && legacy.length === 0 ? <Empty>Sem registos.</Empty> : (
            <ul className="space-y-1 text-[12.5px]">
              {rows.map((r) => (
                <li key={r.id} className="bx-card p-2"><span className="bx-dim">{fmtDate(r.created_at)}</span> · <b>@{r.actor_handle || '—'}</b> · {r.area}/{r.action} · {r.target} {r.result !== 'ok' && <Tag tone={r.result === 'negado' ? 'bad' : 'warn'}>{r.result}</Tag>}
                  {r.reason && <span className="bx-muted"> · {r.reason}</span>}{(r.before || r.after) && <span className="bx-dim block break-all">{r.before ? `antes ${JSON.stringify(r.before)} ` : ''}{r.after ? `depois ${JSON.stringify(r.after)}` : ''}</span>}</li>
              ))}
              {legacy.map((r, i) => <li key={'l' + i} className="bx-card p-2"><span className="bx-dim">{fmtDate(r.created_at)}</span> · <b>@{r.actor_handle || '—'}</b> · {r.action} · {r.target} <Tag>antigo</Tag></li>)}
            </ul>
          )}
          <div className="mt-3 flex justify-center gap-2"><button type="button" className="bx-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button><span className="self-center text-[13px]">{page}</span><button type="button" className="bx-ghost" disabled={rows.length < 50} onClick={() => setPage(page + 1)}>Seguinte</button></div>
          <p className="bx-dim mt-2 text-[12px]">Os registos não podem ser alterados nem apagados. As consultas sensíveis e as exportações também ficam registadas.</p>
        </>
      )}
    </div>
  );
}

function ReportsMod() {
  const [from, setFrom] = useState(daysAgo(29)); const [to, setTo] = useState(today());
  const { data, error, reload } = useLoad(() => mkt3.admin.report(from, to), [from, to]);
  const rows = ((data as J | null)?.rows ?? []) as J[];
  const cols = ['day', 'new_users', 'new_stores', 'payments', 'payments_mzn', 'sales_mzn', 'commissions_mzn', 'refunds_mzn', 'disputes', 'fraud_confirmed', 'checkouts_started', 'checkouts_paid', 'avg_hours_to_complete'];
  const sum = (k: string) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  return (
    <div>
      <Dates from={from} to={to} setFrom={setFrom} setTo={setTo} />
      {error ? <ErrorNote code={error} onRetry={reload} /> : !data ? <Loading /> : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Kpi label="Novos utilizadores" value={sum('new_users')} /><Kpi label="Novas lojas" value={sum('new_stores')} />
            <Kpi label="Transações confirmadas" value={sum('payments')} hint={fmtMt(sum('payments_mzn'))} /><Kpi label="Vendas liquidadas" value={fmtMt(sum('sales_mzn'))} />
            <Kpi label="Comissões" value={fmtMt(sum('commissions_mzn'))} /><Kpi label="Reembolsos" value={fmtMt(sum('refunds_mzn'))} />
            <Kpi label="Reclamações" value={sum('disputes')} /><Kpi label="Fraudes confirmadas" value={sum('fraud_confirmed')} />
            <Kpi label="Conversão checkout → pago" value={sum('checkouts_started') ? `${Math.round((sum('checkouts_paid') / sum('checkouts_started')) * 100)}%` : '—'} />
          </div>
          <button type="button" className="bx-btn mt-3" onClick={() => downloadText(`relatorio-${from}-${to}.csv`, toCsv(rows, cols))}>Exportar CSV (diário)</button>
          <p className="bx-dim mt-2 text-[12px]">Valores reais registados; não incluem estimativas. Pedidos da compra segura antiga não entram nos valores financeiros.</p>
        </>
      )}
    </div>
  );
}

const FLAGS: [string, string, string][] = [
  ['mkt3_enabled', 'Marketplace 3.0 aberto ao público', 'Mostra pesquisa, lojas, carrinho e painel do criador a todos. Desligado: só a equipa vê.'],
  ['mkt3_checkout_enabled', 'Pagamentos com dinheiro real', 'Permite pagar pedidos com o saldo da carteira. Exige comissão definida. Desligado: “Pagamento ainda não disponível”.'],
  ['mkt3_payouts_enabled', 'Pedidos de pagamento a vendedores', 'Vendedores verificados podem pedir o envio do saldo para M-Pesa/e-Mola.'],
  ['mkt3_store_review_required', 'Lojas novas precisam de verificação', 'Recomendado ligado.'],
  ['mkt3_product_review_required', 'Produtos novos precisam de revisão', 'Publicar passa por “Pendente de revisão”.'],
];
function SettingsMod() {
  const { toast } = useStore();
  const { data, error, reload } = useLoad(() => mkt3.admin.dashboard(null, null), []);
  const flags = ((data as J | null)?.flags ?? {}) as Record<string, boolean>;
  const set = async (k: string, on: boolean) => {
    if (k === 'mkt3_checkout_enabled' && on && !window.confirm('Ligar pagamentos com dinheiro real no marketplace? Confirma que a comissão está definida e que os depósitos da carteira funcionam.')) return;
    const r = await mkt3.admin.setFlag(k, on); toast(r.ok ? 'Guardado (fica na auditoria).' : errText(r.code)); reload();
  };
  const sweep = async () => { const r = await mkt3.admin.sweep(); toast(r.ok ? `Prazos processados: ${r.expired} expirado(s), ${r.auto_completed} concluído(s) automaticamente.` : errText(r.code)); };
  if (error) return <ErrorNote code={error} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <div className="space-y-3">
      <ul className="space-y-2">{FLAGS.map(([k, l, h]) => (
        <li key={k} className="bx-card p-3"><label className="flex items-center justify-between gap-3"><span><b className="text-[14px]">{l}</b><span className="bx-dim block text-[12px]">{h}</span></span>
          <input type="checkbox" className="h-6 w-6" checked={!!flags[k]} onChange={(e) => set(k, e.target.checked)} /></label></li>
      ))}</ul>
      <div className="bx-card p-3 text-[13.5px]">
        <p>Pedidos não pagos expiram ao fim de 30 min; pedidos entregues sem resposta concluem após os dias definidos em Admin › Marketplace (“libertação automática”).</p>
        <button type="button" className="bx-ghost mt-2" onClick={sweep}>Processar prazos agora</button>
      </div>
    </div>
  );
}
