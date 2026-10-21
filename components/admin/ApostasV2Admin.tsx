'use client';

// Admin › Apostas: interruptor Ligar/Desligar (desligado por omissão), mercados e odds, liquidação, permissões,
// auditoria e as apostas clássicas (TXAP Pontos). Tudo imposto no servidor (funções apv2_* + RLS); aqui é só a interface.
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { IS_DEMO } from '@/lib/config';
import { V2Limits, V2Perm, V2Res, V2_PERMS, V2_PERM_NAMES, V2_RESULT_NAMES, V3_GAMES, fmtOddsV2, fmtTest, isOpenBet, v2ErrText } from '@/lib/apostasV2';
import { V2AdminView, V2MarketView, apostasV2Api } from '@/lib/apostasV2Api';

const V2_BANNER = 'Apostas com saldo de teste — sem dinheiro real. Não se compra, não se levanta.';

const L = () => <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="bx-card h-20 animate-pulse" />)}</div>;
const Classic = dynamic(() => import('@/components/admin/BetsAdmin'), { ssr: false, loading: L });
const V3 = dynamic(() => import('@/components/admin/ApostasV3Admin'), { ssr: false, loading: L });

// v3: Confrontos, Equipas, Resultados, Limites, Reembolsos, Reclamações, Exposição e Transações (components/admin/ApostasV3Admin.tsx).
const V3_SUBS = ['Confrontos', 'Equipas', 'Resultados', 'Limites', 'Reembolsos', 'Reclamações', 'Exposição', 'Transações'] as const;
type V3Sub = (typeof V3_SUBS)[number];
type Sub = 'Ligar/Desligar' | 'Mercados' | 'Liquidação' | 'Permissões' | 'Auditoria' | 'Clássicas (TXAP Pontos)' | V3Sub;
const SUBS: Sub[] = ['Ligar/Desligar', 'Confrontos', 'Resultados', 'Equipas', 'Mercados', 'Liquidação', 'Limites', 'Reembolsos', 'Reclamações', 'Exposição', 'Transações', 'Permissões', 'Auditoria', 'Clássicas (TXAP Pontos)'];
const isV3Sub = (x: Sub): x is V3Sub => (V3_SUBS as readonly string[]).includes(x);
type Run = (p: Promise<V2Res>, ok: string) => Promise<boolean>;

export default function ApostasV2Admin() {
  const { toast } = useStore();
  const [sub, setSub] = useState<Sub>('Ligar/Desligar');
  const [v, setV] = useState<V2AdminView | null>(null);
  const [markets, setMarkets] = useState<V2MarketView[]>([]);
  const [err, setErr] = useState('');
  const reload = useCallback(async () => {
    const a = await apostasV2Api.adminView();
    if ('error' in a) { setErr(a.error); setV(null); return; }
    setErr(''); setV(a);
    setMarkets(await apostasV2Api.markets(true).catch(() => []));
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  const run: Run = async (p, ok) => {
    try { const r = await p; if (r.ok) { toast(ok); await reload(); return true; } toast(v2ErrText(r.code)); return false; }
    catch (e) { toast((e as Error).message); return false; }
  };
  const has = (p: V2Perm) => !!v?.myPerms.includes(p);

  return (
    <div className="bx">
      <p role="note" className="bx-banner mb-3 p-3 text-[13px]">{V2_BANNER} Dinheiro real continua desligado.</p>
      {IS_DEMO && <p className="mb-3 text-center text-xs text-white/60">Dados de exemplo (modo demo).</p>}
      <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4" role="tablist" aria-label="Apostas · admin">
        {SUBS.map((x) => <button key={x} type="button" role="tab" aria-selected={sub === x} onClick={() => setSub(x)} className="bx-chip !min-h-[40px] !text-[13px]">{x}</button>)}
      </div>
      {sub === 'Clássicas (TXAP Pontos)' ? <Classic /> : err ? (
        <p className="bx-card p-4 text-sm">{err === 'FORBIDDEN' ? 'Sem permissões de Apostas. Pede a um admin em Admin › Apostas › Permissões.' : err === 'NOT_INSTALLED' ? 'Apostas v2 ainda não instaladas: corre o SQL da página sql-apostas.html no Supabase.' : `Erro: ${v2ErrText(err)}`}</p>
      ) : !v ? <L /> : (
        <>
          {sub === 'Ligar/Desligar' && <Toggle v={v} can={has('toggle')} run={run} />}
          {sub === 'Mercados' && <Markets markets={markets} canMk={has('markets')} canOdds={has('odds')} run={run} />}
          {sub === 'Liquidação' && <Settle v={v} markets={markets} can={has('settle')} run={run} />}
          {sub === 'Permissões' && <Perms v={v} can={has('permissions')} run={run} />}
          {sub === 'Auditoria' && <Audit v={v} />}
          {isV3Sub(sub) && <V3 sub={sub} v2={v} perms={v.myPerms} toast={toast} />}
        </>
      )}
    </div>
  );
}

const NoPerm = ({ p }: { p: V2Perm }) => <p className="bx-dim text-[12.5px]">Precisas da permissão “{V2_PERM_NAMES[p]}” (Admin › Apostas › Permissões).</p>;

function Toggle({ v, can, run }: { v: V2AdminView; can: boolean; run: Run }) {
  const [l, setL] = useState<V2Limits>(v.limits);
  const num = (k: keyof V2Limits) => (e: React.ChangeEvent<HTMLInputElement>) => setL({ ...l, [k]: Number(e.target.value.replace(/\D/g, '')) || 0 });
  return (
    <div className="space-y-3">
      <section className="bx-card flex items-center justify-between gap-3 p-4">
        <div>
          <b className="block text-[15px]">Sistema de apostas: {v.enabled ? 'LIGADO' : 'DESLIGADO'}</b>
          <span className="bx-muted text-[13px]">Desligado: /apostas mostra “Apostas desativadas” e o servidor recusa todas as apostas (v2, clássicas e desafios).</span>
        </div>
        <button type="button" role="switch" aria-checked={v.enabled} disabled={!can} className={`bx-btn !w-auto shrink-0 px-5 ${v.enabled ? '!bg-[#B91C1C] !text-white' : ''}`}
          onClick={() => run(apostasV2Api.setEnabled(!v.enabled), v.enabled ? 'Apostas desligadas.' : 'Apostas ligadas.')}>
          {v.enabled ? 'Desligar' : 'Ligar'}
        </button>
      </section>
      {!can && <NoPerm p="toggle" />}
      <section className="bx-card grid gap-3 p-4 sm:grid-cols-3">
        <label className="text-[13px] font-semibold">Valor mínimo<input className="bx-input mt-1" inputMode="numeric" value={l.min_stake} onChange={num('min_stake')} disabled={!can} /></label>
        <label className="text-[13px] font-semibold">Valor máximo<input className="bx-input mt-1" inputMode="numeric" value={l.max_stake} onChange={num('max_stake')} disabled={!can} /></label>
        <label className="text-[13px] font-semibold">Saldo de teste inicial<input className="bx-input mt-1" inputMode="numeric" value={l.initial_test_balance} onChange={num('initial_test_balance')} disabled={!can} /></label>
        <button type="button" className="bx-btn sm:col-span-3" disabled={!can} onClick={() => run(apostasV2Api.setLimits(l), 'Limites guardados.')}>Guardar limites</button>
      </section>
    </div>
  );
}

function Markets({ markets, canMk, canOdds, run }: { markets: V2MarketView[]; canMk: boolean; canOdds: boolean; run: Run }) {
  const [title, setTitle] = useState('');
  const [game, setGame] = useState('ff');
  const [closes, setCloses] = useState('');
  const [sels, setSels] = useState([{ label: '', odds: '2.00' }, { label: '', odds: '2.00' }]);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const create = async () => {
    const ok = await run(apostasV2Api.createMarket(title, game, closes ? new Date(closes).toISOString() : null, sels.map((s) => ({ label: s.label, odds: Number(s.odds.replace(',', '.')) }))), 'Mercado criado.');
    if (ok) { setTitle(''); setSels([{ label: '', odds: '2.00' }, { label: '', odds: '2.00' }]); }
  };
  return (
    <div className="space-y-3">
      <section className="bx-card space-y-2 p-4">
        <b className="block">Novo mercado</b>
        {!canMk && <NoPerm p="markets" />}
        <input className="bx-input" placeholder="Título (ex.: Final FF — Fênix vs Raio)" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} disabled={!canMk} />
        <div className="grid grid-cols-2 gap-2">
          <select className="bx-input" value={game} onChange={(e) => setGame(e.target.value)} disabled={!canMk} aria-label="Jogo">
            {V3_GAMES.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
          </select>
          <input className="bx-input" type="datetime-local" value={closes} onChange={(e) => setCloses(e.target.value)} disabled={!canMk} aria-label="Fecha em" />
        </div>
        {sels.map((s, i) => (
          <div key={i} className="flex gap-2">
            <input className="bx-input flex-1" placeholder={`Seleção ${i + 1}`} value={s.label} maxLength={60} onChange={(e) => setSels(sels.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} disabled={!canMk} />
            <input className="bx-input !w-24" inputMode="decimal" value={s.odds} onChange={(e) => setSels(sels.map((x, k) => (k === i ? { ...x, odds: e.target.value.replace(/[^\d.,]/g, '') } : x)))} disabled={!canMk} aria-label="Odd" />
            {sels.length > 2 && <button type="button" className="bx-ghost px-3" onClick={() => setSels(sels.filter((_, k) => k !== i))} aria-label="Retirar">✕</button>}
          </div>
        ))}
        <div className="flex gap-2">
          <button type="button" className="bx-ghost flex-1" disabled={!canMk || sels.length >= 20} onClick={() => setSels([...sels, { label: '', odds: '2.00' }])}>+ Seleção</button>
          <button type="button" className="bx-btn flex-1" disabled={!canMk || title.trim().length < 3 || sels.some((s) => !s.label.trim())} onClick={create}>Criar mercado</button>
        </div>
      </section>
      {markets.map((m) => (
        <section key={m.id} className="bx-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <b>{m.title}</b><span className="bx-tag">{m.status}</span>
          </div>
          <ul className="mt-2 space-y-1.5">
            {m.selections.map((x) => (
              <li key={x.id} className="flex items-center gap-2 text-[13.5px]">
                <span className="min-w-0 flex-1 truncate">{x.label} · <b>{fmtOddsV2(x.odds)}</b> <span className="bx-dim">v{x.oddsVersion}{x.result !== 'pendente' ? ` · ${x.result}` : ''}</span></span>
                {canOdds && x.result === 'pendente' && !['liquidado', 'anulado'].includes(m.status) && (
                  <>
                    <input className="bx-input !w-20" inputMode="decimal" value={edit[x.id] ?? ''} placeholder={fmtOddsV2(x.odds)} onChange={(e) => setEdit({ ...edit, [x.id]: e.target.value.replace(/[^\d.,]/g, '') })} aria-label={`Nova odd para ${x.label}`} />
                    <button type="button" className="bx-ghost px-3" disabled={!edit[x.id]} onClick={async () => { if (await run(apostasV2Api.setOdds(x.id, Number(edit[x.id].replace(',', '.'))), 'Odd atualizada.')) setEdit({ ...edit, [x.id]: '' }); }}>OK</button>
                  </>
                )}
              </li>
            ))}
          </ul>
          {canMk && !['liquidado', 'anulado'].includes(m.status) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {(['aberto', 'suspenso', 'fechado'] as const).filter((st) => st !== m.status).map((st) => (
                <button key={st} type="button" className="bx-ghost px-3 text-[13px]" onClick={() => run(apostasV2Api.marketStatus(m.id, st), 'Estado mudado.')}>{st === 'aberto' ? 'Abrir' : st === 'suspenso' ? 'Suspender' : 'Fechar apostas'}</button>
              ))}
            </div>
          )}
        </section>
      ))}
      {!canOdds && <NoPerm p="odds" />}
    </div>
  );
}

function Settle({ v, markets, can, run }: { v: V2AdminView; markets: V2MarketView[]; can: boolean; run: Run }) {
  const open = v.bets.filter((b) => isOpenBet(b.status));
  const pending = markets.filter((m) => !['liquidado', 'anulado'].includes(m.status));
  const [credit, setCredit] = useState({ user: '', amount: '', ref: '' });
  return (
    <div className="space-y-3">
      {!can && <NoPerm p="settle" />}
      <p className="bx-dim text-[12.5px]">Cada aposta é liquidada sozinha no servidor e nunca é paga duas vezes. Ganha = valor × odd trancada; anulada/reembolsada = devolve o valor.</p>
      {pending.map((m) => (
        <section key={m.id} className="bx-card p-4">
          <b className="block">{m.title}</b>
          <p className="bx-muted mb-2 text-[12.5px]">Liquidar o mercado inteiro: escolhe o vencedor (as restantes seleções perdem) ou anula.</p>
          <div className="flex flex-wrap gap-2">
            {m.selections.map((x) => <button key={x.id} type="button" className="bx-ghost px-3 text-[13px]" disabled={!can} onClick={() => confirm(`Vencedor: ${x.label}?`) && run(apostasV2Api.settleMarket(m.id, x.id), 'Mercado liquidado.')}>Venceu: {x.label}</button>)}
            <button type="button" className="bx-ghost px-3 text-[13px]" disabled={!can} onClick={() => confirm('Anular o mercado e devolver todos os valores?') && run(apostasV2Api.settleMarket(m.id, null), 'Mercado anulado.')}>Anular mercado</button>
          </div>
        </section>
      ))}
      <h3 className="pt-2 text-[14px] font-bold">Apostas abertas ({open.length})</h3>
      {open.length === 0 && <p className="bx-card p-3 text-center text-sm">Sem apostas abertas.</p>}
      <ul className="space-y-2">
        {open.map((b) => (
          <li key={b.id} className="bx-card p-3 text-[13px]">
            <p><b>@{b.handle}</b> · {b.label} · {b.market}</p>
            <p className="bx-muted">{fmtTest(b.stake)} × {fmtOddsV2(b.oddsLocked)} = {fmtTest(b.potential)}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(['won', 'lost', 'void', 'refund'] as const).map((r) => (
                <button key={r} type="button" className="bx-ghost px-3 text-[12.5px]" disabled={!can} onClick={() => run(apostasV2Api.settleBet(b.id, r), 'Aposta liquidada.')}>
                  {r === 'won' ? 'Ganha' : r === 'lost' ? 'Perdida' : r === 'void' ? 'Anular' : 'Reembolsar'}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <h3 className="pt-2 text-[14px] font-bold">Últimas liquidadas</h3>
      <ul className="space-y-1 text-[12.5px]">
        {v.bets.filter((b) => !isOpenBet(b.status)).slice(0, 30).map((b) => <li key={b.id} className="bx-card p-2">@{b.handle} · {b.label} · {V2_RESULT_NAMES[b.status]} · pago {fmtTest(b.payout)}</li>)}
      </ul>
      <section className="bx-card space-y-2 p-4">
        <b className="block">Crédito de saldo de teste</b>
        <p className="bx-dim text-[12px]">Só pontos de teste (sem valor). A referência impede creditar duas vezes.</p>
        <input className="bx-input" placeholder="ID do utilizador (uuid)" value={credit.user} onChange={(e) => setCredit({ ...credit, user: e.target.value.trim() })} disabled={!can} />
        <div className="flex gap-2">
          <input className="bx-input flex-1" inputMode="numeric" placeholder="Valor" value={credit.amount} onChange={(e) => setCredit({ ...credit, amount: e.target.value.replace(/\D/g, '') })} disabled={!can} />
          <input className="bx-input flex-1" placeholder="Referência" value={credit.ref} onChange={(e) => setCredit({ ...credit, ref: e.target.value })} disabled={!can} />
        </div>
        <button type="button" className="bx-btn w-full" disabled={!can || !credit.user || !credit.amount || credit.ref.trim().length < 3} onClick={() => run(apostasV2Api.testCredit(credit.user, Number(credit.amount), credit.ref), 'Saldo de teste creditado.')}>Creditar</button>
      </section>
    </div>
  );
}

function Perms({ v, can, run }: { v: V2AdminView; can: boolean; run: Run }) {
  return (
    <div className="space-y-3">
      <p className="bx-dim text-[12.5px]">Admins podem sempre gerir permissões; as outras têm de ser dadas (também a ti próprio). Só admins e moderadores podem recebê-las. Imposto no servidor.</p>
      {!can && <NoPerm p="permissions" />}
      {v.staff.map((u) => (
        <section key={u.id} className="bx-card p-4">
          <b className="block">{u.name || u.handle} <span className="bx-muted font-normal">@{u.handle} · {u.role === 'admin' ? 'Admin' : 'Moderador'}</span></b>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {V2_PERMS.map((p) => {
              const implicit = p === 'permissions' && u.role === 'admin';
              const on = implicit || u.perms.includes(p);
              return (
                <label key={p} className="flex min-h-[44px] items-center gap-2 text-[13px]">
                  <input type="checkbox" className="h-5 w-5" checked={on} disabled={!can || implicit} onChange={(e) => run(apostasV2Api.grant(u.id, p, e.target.checked), 'Permissão atualizada.')} />
                  {V2_PERM_NAMES[p]}{implicit ? ' (sempre, admin)' : ''}
                </label>
              );
            })}
          </div>
          {can && V2_PERMS.some((p) => p !== 'permissions' && !u.perms.includes(p)) && (
            <button type="button" className="bx-ghost mt-2 px-3 text-[13px]" onClick={async () => { for (const p of V2_PERMS) if (!u.perms.includes(p) && !(p === 'permissions' && u.role === 'admin')) await apostasV2Api.grant(u.id, p, true); await run(Promise.resolve({ ok: true }), 'Todas as permissões dadas.'); }}>Dar todas</button>
          )}
        </section>
      ))}
    </div>
  );
}

function Audit({ v }: { v: V2AdminView }) {
  const j = (x: unknown) => (x == null ? '—' : JSON.stringify(x));
  return (
    <ul className="space-y-2">
      {v.audit.length === 0 && <li className="bx-card p-3 text-center text-sm">Sem registos.</li>}
      {v.audit.map((a) => (
        <li key={a.id} className="bx-card break-words p-3 text-[12.5px]">
          <p><b>{a.action}</b> · @{a.actor || 'sistema'} · {new Date(a.at).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'medium' })}</p>
          <p className="bx-muted">Alvo: {a.target}</p>
          <p className="bx-dim">Antes: {j(a.before)}</p>
          <p className="bx-dim">Depois: {j(a.after)}</p>
        </li>
      ))}
    </ul>
  );
}
