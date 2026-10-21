'use client';

// Admin › Apostas (v3): confrontos, equipas, resultados (dupla validação), limites e valores sugeridos, reembolsos,
// reclamações, exposição e transações. Tudo imposto no servidor (funções apv2_admin_* + RLS); aqui é só a interface.
// Ações sensíveis pedem sempre um motivo, que fica no registo de auditoria.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  V2Perm, V2Res, V3Limit, V3MatchStatus, V3_GAMES, V3_MATCH_STATUS, fmtOddsV2, isOpenBet, matchNextOk, v2ErrText, v3GameName,
} from '@/lib/apostasV2';
import { V2AdminView, V3AdminMatch, V3AdminView, V3MatchView, apostasV2Api, apostasV3Api, newRequestId } from '@/lib/apostasV2Api';

type Sub = 'Confrontos' | 'Equipas' | 'Resultados' | 'Limites' | 'Reembolsos' | 'Reclamações' | 'Exposição' | 'Transações';
type Run = (p: Promise<V2Res>, ok: string) => Promise<boolean>;
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const short = (id: string) => id.replace(/-/g, '').slice(0, 8).toUpperCase();
const askMotivo = (what: string): string | null => {
  const m = typeof window === 'undefined' ? null : window.prompt(`Motivo (${what}) — fica na auditoria:`);
  if (m == null) return null;
  return m.trim();
};
const NoPerm = ({ what }: { what: string }) => <p className="bx-dim text-[12.5px]">Precisas da permissão “{what}” (Admin › Apostas › Permissões).</p>;

export default function ApostasV3Admin({ sub, v2, perms, toast }: { sub: Sub; v2: V2AdminView; perms: V2Perm[]; toast: (m: string) => void }) {
  const [v, setV] = useState<V3AdminView | null>(null);
  const [pub, setPub] = useState<V3MatchView[]>([]);
  const [err, setErr] = useState('');
  const reload = useCallback(async () => {
    const a = await apostasV3Api.adminView();
    if ('error' in a) { setErr(a.error); setV(null); return; }
    setErr(''); setV(a);
    setPub(await apostasV3Api.matches().catch(() => []));
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  const run: Run = async (p, ok) => {
    try { const r = await p; if (r.ok) { toast(r.already ? 'Já estava feito (nada repetido).' : ok); await reload(); return true; } toast(v2ErrText(r.code)); return false; }
    catch (e) { toast(v2ErrText((e as Error).message)); return false; }
  };
  const has = (p: V2Perm) => perms.includes(p);
  if (err) return <p className="bx-card p-4 text-sm">{err === 'NOT_INSTALLED' ? 'Apostas v3 ainda não instaladas: corre o SQL de sql-apostas-v3.html no Supabase (depois da v2).' : err === 'FORBIDDEN' ? 'Sem permissões de Apostas.' : `Erro: ${v2ErrText(err)}`}</p>;
  if (!v) return <div className="bx-card h-24 animate-pulse" />;
  return (
    <>
      {sub === 'Confrontos' && <Matches v={v} pub={pub} canMk={has('markets')} canOdds={has('odds')} canSettle={has('settle')} run={run} />}
      {sub === 'Equipas' && <Teams v={v} can={has('markets')} run={run} />}
      {sub === 'Resultados' && <Results v={v} can={has('settle')} run={run} />}
      {sub === 'Limites' && <Limits v={v} can={has('toggle')} run={run} />}
      {sub === 'Reembolsos' && <Refunds v2={v2} can={has('settle')} run={run} />}
      {sub === 'Reclamações' && <Complaints v={v} can={has('settle')} run={run} />}
      {sub === 'Exposição' && <Exposure v={v} />}
      {sub === 'Transações' && <Ledger v={v} />}
    </>
  );
}

const ACTIONS: { to: V3MatchStatus; label: string }[] = [
  { to: 'apostas_abertas', label: 'Abrir apostas' }, { to: 'suspenso', label: 'Suspender' }, { to: 'agendado', label: 'Voltar a agendado' },
  { to: 'em_andamento', label: 'Começou (fecha apostas)' }, { to: 'aguarda_resultado', label: 'Aguarda resultado' },
];

function Matches({ v, pub, canMk, canOdds, canSettle, run }: { v: V3AdminView; pub: V3MatchView[]; canMk: boolean; canOdds: boolean; canSettle: boolean; run: Run }) {
  const empty = { game: 'ff', teamAId: '', teamBId: '', teamA: '', teamB: '', startsAt: '', organizer: 'TxapZone', rules: '', tournamentName: '', tournamentRef: '', oddsA: '1.90', oddsB: '1.90', oddsDraw: '' };
  const [f, setF] = useState(empty);
  const [odds, setOdds] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<'ativos' | 'todos'>('ativos');
  const teams = v.teams.filter((t) => t.game === f.game);
  const num = (s: string) => Number(s.replace(',', '.'));
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const create = async () => {
    const a = teams.find((t) => t.id === f.teamAId); const b = teams.find((t) => t.id === f.teamBId);
    const ok = await run(apostasV3Api.matchSave(null, {
      game: f.game, teamAId: a?.id ?? null, teamBId: b?.id ?? null, teamA: a?.name ?? f.teamA, teamB: b?.name ?? f.teamB, logoA: a?.logo ?? null, logoB: b?.logo ?? null,
      startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : '', organizer: f.organizer, rules: f.rules, tournamentName: f.tournamentName, tournamentRef: f.tournamentRef || null,
      oddsA: num(f.oddsA), oddsB: num(f.oddsB), oddsDraw: f.oddsDraw ? num(f.oddsDraw) : null,
    }, null), 'Confronto criado (agendado). Abre as apostas quando estiver pronto.');
    if (ok) setF({ ...empty, game: f.game });
  };
  const sels = useMemo(() => new Map(pub.map((m) => [m.id, m.selections])), [pub]);
  const list = v.matches.filter((m) => filter === 'todos' || !['finalizado', 'cancelado'].includes(m.status));
  const status = async (m: V3AdminMatch, to: V3MatchStatus) => { const mo = askMotivo(`${V3_MATCH_STATUS[to]} — ${m.teamA} vs ${m.teamB}`); if (mo != null) await run(apostasV3Api.matchStatus(m.id, to, mo), 'Estado atualizado.'); };
  const cancel = async (m: V3AdminMatch) => { const mo = askMotivo(`CANCELAR ${m.teamA} vs ${m.teamB} — todas as apostas em aberto são reembolsadas`); if (mo != null) await run(apostasV3Api.matchCancel(m.id, mo), 'Confronto cancelado e apostas reembolsadas.'); };
  const reschedule = async (m: V3AdminMatch) => {
    const d = window.prompt('Nova data e hora (AAAA-MM-DD HH:MM, hora de Maputo):', new Date(m.startsAt).toLocaleString('sv-SE', { timeZone: 'Africa/Maputo' }).slice(0, 16));
    if (!d) return;
    const mo = m.bets > 0 ? askMotivo('alterar a data com apostas feitas') : '';
    if (mo == null) return;
    const iso = new Date(`${d.replace(' ', 'T')}:00+02:00`).toISOString();
    await run(apostasV3Api.matchSave(m.id, { game: m.game, teamA: m.teamA, teamB: m.teamB, logoA: m.logoA, logoB: m.logoB, startsAt: iso, organizer: m.organizer, rules: m.rules, tournamentName: m.tournamentName, tournamentRef: m.tournamentRef, oddsA: 2, oddsB: 2 }, mo || null), 'Data alterada.');
  };
  return (
    <div className="space-y-3">
      <section className="bx-card space-y-2 p-4">
        <b className="block">Novo confronto</b>
        {!canMk && <NoPerm what="Criar e gerir mercados" />}
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[12.5px]">Jogo<select className="bx-input mt-1" value={f.game} onChange={(e) => setF({ ...f, game: e.target.value, teamAId: '', teamBId: '' })} disabled={!canMk}>{V3_GAMES.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}</select></label>
          <label className="text-[12.5px]">Data e hora<input className="bx-input mt-1" type="datetime-local" value={f.startsAt} onChange={set('startsAt')} disabled={!canMk} /></label>
          {(['A', 'B'] as const).map((s) => (
            <div key={s} className="space-y-1">
              <label className="text-[12.5px]">Equipa {s}
                <select className="bx-input mt-1" value={s === 'A' ? f.teamAId : f.teamBId} onChange={set(s === 'A' ? 'teamAId' : 'teamBId')} disabled={!canMk}>
                  <option value="">— escrever nome —</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              {!(s === 'A' ? f.teamAId : f.teamBId) && <input className="bx-input" placeholder={`Nome da equipa ${s}`} maxLength={60} value={s === 'A' ? f.teamA : f.teamB} onChange={set(s === 'A' ? 'teamA' : 'teamB')} disabled={!canMk} />}
              <input className="bx-input" inputMode="decimal" aria-label={`Multiplicador equipa ${s}`} placeholder="Multiplicador" value={s === 'A' ? f.oddsA : f.oddsB} onChange={set(s === 'A' ? 'oddsA' : 'oddsB')} disabled={!canMk} />
            </div>
          ))}
          <label className="text-[12.5px]">Empate (opcional)<input className="bx-input mt-1" inputMode="decimal" placeholder="ex.: 3.20" value={f.oddsDraw} onChange={set('oddsDraw')} disabled={!canMk} /></label>
          <label className="text-[12.5px]">Organizador<input className="bx-input mt-1" maxLength={80} value={f.organizer} onChange={set('organizer')} disabled={!canMk} /></label>
          <label className="text-[12.5px]">Torneio/evento<input className="bx-input mt-1" maxLength={120} value={f.tournamentName} onChange={set('tournamentName')} disabled={!canMk} /></label>
          <label className="text-[12.5px]">Ref. do evento (limites)<input className="bx-input mt-1" maxLength={80} placeholder="ex.: liga-ff-2026" value={f.tournamentRef} onChange={set('tournamentRef')} disabled={!canMk} /></label>
        </div>
        <textarea className="bx-input min-h-[70px] py-2" placeholder="Regras (formato, mapa, critérios de vitória…)" maxLength={2000} value={f.rules} onChange={set('rules')} disabled={!canMk} />
        <button type="button" className="bx-btn w-full" disabled={!canMk || !f.startsAt || (!f.teamAId && !f.teamA.trim()) || (!f.teamBId && !f.teamB.trim())} onClick={create}>Criar confronto</button>
      </section>
      <div className="flex flex-wrap items-center gap-2">
        {(['ativos', 'todos'] as const).map((x) => <button key={x} type="button" className="bx-chip !min-h-[38px] !text-[13px]" aria-pressed={filter === x} onClick={() => setFilter(x)}>{x === 'ativos' ? 'Ativos' : 'Todos'}</button>)}
        <button type="button" className="bx-ghost ml-auto px-3 text-[13px]" disabled={!canMk} onClick={() => run(apostasV3Api.tick(), 'Estados atualizados pela hora de início.')}>Atualizar pela hora de início</button>
      </div>
      {list.length === 0 && <p className="bx-card p-3 text-center text-sm">Sem confrontos.</p>}
      {list.map((m) => (
        <section key={m.id} className="bx-card p-4 text-[13.5px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <b>{m.teamA} VS {m.teamB}</b><span className="bx-tag bg-white/15">{V3_MATCH_STATUS[m.status]}</span>
          </div>
          <p className="bx-muted">{v3GameName(m.game)} · {when(m.startsAt)} · #{short(m.id)}{m.tournamentName ? ` · ${m.tournamentName}` : ''}</p>
          <p className="bx-dim text-[12.5px]">{m.bets} apostas · em jogo {m.openStake} MT (teste){m.result ? ` · resultado: ${m.result === 'a' ? m.teamA : m.result === 'b' ? m.teamB : m.result}` : ''}</p>
          <ul className="mt-2 space-y-1">
            {(sels.get(m.id) ?? []).map((x) => (
              <li key={x.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{x.label} · <b>×{fmtOddsV2(x.odds)}</b> <span className="bx-dim">v{x.oddsVersion}</span></span>
                {canOdds && x.result === 'pendente' && !['finalizado', 'cancelado'].includes(m.status) && (
                  <>
                    <input className="bx-input !w-20" inputMode="decimal" value={odds[x.id] ?? ''} placeholder={fmtOddsV2(x.odds)} onChange={(e) => setOdds({ ...odds, [x.id]: e.target.value.replace(/[^\d.,]/g, '') })} aria-label={`Novo multiplicador ${x.label}`} />
                    <button type="button" className="bx-ghost px-3" disabled={!odds[x.id]} onClick={async () => { if (await run(apostasV2Api.setOdds(x.id, Number(odds[x.id].replace(',', '.'))), 'Multiplicador atualizado (apostas confirmadas mantêm o seu).')) setOdds({ ...odds, [x.id]: '' }); }}>OK</button>
                  </>
                )}
              </li>
            ))}
          </ul>
          {!['finalizado', 'cancelado'].includes(m.status) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {canMk && ACTIONS.filter((a) => a.to !== m.status && matchNextOk(m.status, a.to)).map((a) => <button key={a.to} type="button" className="bx-ghost px-3 text-[12.5px]" onClick={() => void status(m, a.to)}>{a.label}</button>)}
              {canMk && ['agendado', 'apostas_abertas', 'suspenso'].includes(m.status) && <button type="button" className="bx-ghost px-3 text-[12.5px]" onClick={() => void reschedule(m)}>Alterar data</button>}
              {canSettle && <button type="button" className="bx-ghost px-3 text-[12.5px] !text-red-300" onClick={() => void cancel(m)}>Cancelar e reembolsar</button>}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function Teams({ v, can, run }: { v: V3AdminView; can: boolean; run: Run }) {
  const [f, setF] = useState({ id: '', game: 'ff', name: '', logo: '' });
  const [g, setG] = useState('');
  const save = async () => { if (await run(apostasV3Api.teamSave(f.id || null, f.game, f.name, f.logo || null), f.id ? 'Equipa atualizada.' : 'Equipa criada.')) setF({ id: '', game: f.game, name: '', logo: '' }); };
  return (
    <div className="space-y-3">
      <section className="bx-card space-y-2 p-4">
        <b className="block">{f.id ? 'Editar equipa' : 'Nova equipa'}</b>
        {!can && <NoPerm what="Criar e gerir mercados" />}
        <div className="grid grid-cols-2 gap-2">
          <select className="bx-input" value={f.game} onChange={(e) => setF({ ...f, game: e.target.value })} disabled={!can} aria-label="Jogo">{V3_GAMES.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}</select>
          <input className="bx-input" placeholder="Nome" maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} disabled={!can} />
        </div>
        <input className="bx-input" placeholder="URL do logótipo (…/storage/v1/object/public/media/teams/…)" value={f.logo} onChange={(e) => setF({ ...f, logo: e.target.value.trim() })} disabled={!can} />
        <p className="bx-dim text-[12px]">Carrega o logótipo em Admin › Apostas › Clássicas › Equipas (fica no armazenamento da app) e cola aqui o endereço. Sem logótipo, aparece um monograma.</p>
        <div className="flex gap-2">
          {f.id && <button type="button" className="bx-ghost flex-1" onClick={() => setF({ id: '', game: f.game, name: '', logo: '' })}>Cancelar edição</button>}
          <button type="button" className="bx-btn flex-1" disabled={!can || !f.name.trim()} onClick={save}>Guardar equipa</button>
        </div>
      </section>
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        <button type="button" className="bx-chip !min-h-[38px] !text-[13px]" aria-pressed={!g} onClick={() => setG('')}>Todos</button>
        {V3_GAMES.map((x) => <button key={x.key} type="button" className="bx-chip !min-h-[38px] !text-[13px]" aria-pressed={g === x.key} onClick={() => setG(x.key)}>{x.name}</button>)}
      </div>
      <ul className="space-y-1.5">
        {v.teams.filter((t) => !g || t.game === g).map((t) => (
          <li key={t.id} className="bx-card flex items-center gap-2 p-2 text-[13.5px]">
            <span className="flex-1 truncate">{t.name} <span className="bx-dim">· {v3GameName(t.game)}{t.logo ? ' · com logótipo' : ''}</span></span>
            {can && <button type="button" className="bx-ghost px-3 text-[12.5px]" onClick={() => setF({ id: t.id, game: t.game, name: t.name, logo: t.logo ?? '' })}>Editar</button>}
          </li>
        ))}
        {v.teams.length === 0 && <li className="bx-card p-3 text-center text-sm">Sem equipas ainda (também podes escrever os nomes direto no confronto).</li>}
      </ul>
    </div>
  );
}

function Results({ v, can, run }: { v: V3AdminView; can: boolean; run: Run }) {
  const pending = v.matches.filter((m) => m.status === 'em_andamento' || m.status === 'aguarda_resultado');
  const [f, setF] = useState<Record<string, { w: string; a: string; b: string; ev: string; mo: string; req: string }>>({});
  const get = (id: string) => f[id] ?? { w: 'a', a: '', b: '', ev: '', mo: '', req: newRequestId() };
  const upd = (id: string, k: string, val: string) => setF({ ...f, [id]: { ...get(id), [k]: val } });
  const byId = new Map(v.matches.map((m) => [m.id, m]));
  const review = async (id: string, approve: boolean) => { const mo = askMotivo(approve ? 'APROVAR e liquidar todas as apostas' : 'rejeitar o resultado'); if (mo != null) await run(apostasV3Api.reviewResult(id, approve, mo), approve ? 'Resultado aprovado e apostas liquidadas.' : 'Resultado rejeitado: o confronto volta a aguardar resultado.'); };
  return (
    <div className="space-y-3">
      <p className="bx-dim text-[12.5px]">Dupla validação: quem propõe o resultado não o pode aprovar. Só depois da aprovação por outra pessoa as apostas são liquidadas (uma única vez). Sem integração automática de resultados: usa as provas (prints, link da transmissão).</p>
      {!can && <NoPerm what="Liquidar apostas" />}
      <h3 className="text-[14px] font-bold">À espera de revisão</h3>
      {v.results.filter((r) => r.status === 'proposto').length === 0 && <p className="bx-card p-3 text-center text-sm">Nada à espera de revisão.</p>}
      {v.results.filter((r) => r.status === 'proposto').map((r) => {
        const m = byId.get(r.matchId);
        return (
          <section key={r.id} className="bx-card p-4 text-[13.5px]">
            <b>{m ? `${m.teamA} VS ${m.teamB}` : r.matchId}</b>
            <p>Vencedor proposto: <b>{r.winner === 'a' ? m?.teamA : r.winner === 'b' ? m?.teamB : 'Empate'}</b>{r.scoreA != null ? ` (${r.scoreA}–${r.scoreB})` : ''}</p>
            <p className="bx-muted">por @{r.proposer || '—'} · {when(r.at)} · motivo: {r.motivo}</p>
            {r.evidence && <p className="bx-dim break-words">Provas: {r.evidence}</p>}
            <div className="mt-2 flex gap-2">
              <button type="button" className="bx-btn flex-1" disabled={!can} onClick={() => void review(r.id, true)}>Aprovar e liquidar</button>
              <button type="button" className="bx-ghost flex-1" disabled={!can} onClick={() => void review(r.id, false)}>Rejeitar</button>
            </div>
          </section>
        );
      })}
      <h3 className="pt-2 text-[14px] font-bold">Propor resultado</h3>
      {pending.length === 0 && <p className="bx-card p-3 text-center text-sm">Nenhum confronto em andamento ou à espera de resultado.</p>}
      {pending.map((m) => {
        const x = get(m.id);
        return (
          <section key={m.id} className="bx-card space-y-2 p-4 text-[13.5px]">
            <b>{m.teamA} VS {m.teamB}</b> <span className="bx-dim">· {V3_MATCH_STATUS[m.status]}</span>
            <div className="grid grid-cols-3 gap-2">
              <select className="bx-input col-span-3" value={x.w} onChange={(e) => upd(m.id, 'w', e.target.value)} disabled={!can} aria-label="Vencedor"><option value="a">Venceu {m.teamA}</option><option value="b">Venceu {m.teamB}</option><option value="empate">Empate</option></select>
              <input className="bx-input" inputMode="numeric" placeholder={`Pontos ${m.teamA}`} value={x.a} onChange={(e) => upd(m.id, 'a', e.target.value.replace(/\D/g, ''))} disabled={!can} />
              <input className="bx-input" inputMode="numeric" placeholder={`Pontos ${m.teamB}`} value={x.b} onChange={(e) => upd(m.id, 'b', e.target.value.replace(/\D/g, ''))} disabled={!can} />
              <span className="bx-dim self-center text-[11.5px]">placar opcional</span>
            </div>
            <input className="bx-input" placeholder="Provas (link do print / transmissão)" maxLength={1000} value={x.ev} onChange={(e) => upd(m.id, 'ev', e.target.value)} disabled={!can} />
            <input className="bx-input" placeholder="Motivo / observação (obrigatório)" maxLength={500} value={x.mo} onChange={(e) => upd(m.id, 'mo', e.target.value)} disabled={!can} />
            <button type="button" className="bx-btn w-full" disabled={!can || x.mo.trim().length < 3} onClick={async () => {
              if (await run(apostasV3Api.proposeResult(m.id, x.w, x.a ? Number(x.a) : null, x.b ? Number(x.b) : null, x.ev, x.mo, x.req), 'Resultado proposto. Agora outra pessoa tem de o rever.')) setF({ ...f, [m.id]: { w: 'a', a: '', b: '', ev: '', mo: '', req: newRequestId() } });
            }}>Propor resultado</button>
          </section>
        );
      })}
      <h3 className="pt-2 text-[14px] font-bold">Histórico de resultados</h3>
      <ul className="space-y-1 text-[12.5px]">
        {v.results.filter((r) => r.status !== 'proposto').slice(0, 50).map((r) => { const m = byId.get(r.matchId); return (
          <li key={r.id} className="bx-card p-2">{m ? `${m.teamA} vs ${m.teamB}` : short(r.matchId)} · {r.winner} · <b>{r.status}</b> · propôs @{r.proposer} · reviu @{r.reviewer || '—'} · {r.reviewMotivo}</li>); })}
      </ul>
    </div>
  );
}

function Limits({ v, can, run }: { v: V3AdminView; can: boolean; run: Run }) {
  const [chips, setChips] = useState(v.chips.join(', '));
  const [f, setF] = useState<{ scope: V3Limit['scope']; ref: string; maxStake: string; maxExposure: string; autoSuspend: boolean; active: boolean }>({ scope: 'global_exposure', ref: '', maxStake: '', maxExposure: '', autoSuspend: true, active: true });
  const refOptions = f.scope === 'match' ? v.matches.filter((m) => !['finalizado', 'cancelado'].includes(m.status)).map((m) => ({ id: m.id, label: `${m.teamA} vs ${m.teamB}` }))
    : f.scope === 'market' ? v.matches.filter((m) => m.marketId && !['finalizado', 'cancelado'].includes(m.status)).map((m) => ({ id: m.marketId!, label: `Mercado: ${m.teamA} vs ${m.teamB}` }))
      : f.scope === 'event' ? [...new Set(v.matches.map((m) => m.tournamentRef).filter(Boolean) as string[])].map((r) => ({ id: r, label: r })) : [];
  const save = async () => {
    const mo = askMotivo('alterar limite'); if (mo == null) return;
    await run(apostasV3Api.setLimit({ scope: f.scope, ref: f.scope === 'global_exposure' ? '' : f.ref, maxStake: f.maxStake ? Number(f.maxStake) : null, maxExposure: f.maxExposure ? Number(f.maxExposure) : null, autoSuspend: f.autoSuspend, active: f.active }, mo), 'Limite guardado.');
  };
  const SC: Record<V3Limit['scope'], string> = { user: 'Utilizador', match: 'Confronto', market: 'Mercado', event: 'Evento/torneio', global_exposure: 'Exposição global' };
  return (
    <div className="space-y-3">
      {!can && <NoPerm what="Ligar/desligar apostas" />}
      <section className="bx-card space-y-2 p-4">
        <b className="block">Valores sugeridos (MT de teste)</b>
        <input className="bx-input" value={chips} onChange={(e) => setChips(e.target.value.replace(/[^\d, ]/g, ''))} disabled={!can} aria-label="Valores sugeridos separados por vírgula" />
        <p className="bx-dim text-[12px]">Até 8 valores, por ordem crescente (ex.: 50, 100, 200, 500, 1000).</p>
        <button type="button" className="bx-btn w-full" disabled={!can} onClick={() => run(apostasV3Api.setChips(chips.split(',').map((x) => Number(x.trim())).filter((x) => x > 0)), 'Valores sugeridos guardados.')}>Guardar valores sugeridos</button>
      </section>
      <section className="bx-card space-y-2 p-4">
        <b className="block">Limite</b>
        <p className="bx-dim text-[12px]">Valor máx. por aposta e/ou exposição máxima (pior caso para a casa). Ao atingir a exposição, o mercado é suspenso automaticamente. Utilizador sem ID = todos.</p>
        <div className="grid grid-cols-2 gap-2">
          <select className="bx-input" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value as V3Limit['scope'], ref: '' })} disabled={!can} aria-label="Âmbito">{Object.entries(SC).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          {f.scope === 'user' ? <input className="bx-input" placeholder="ID do utilizador (vazio = todos)" value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value.trim() })} disabled={!can} />
            : f.scope === 'global_exposure' ? <span className="bx-dim self-center text-[12.5px]">Toda a plataforma</span>
              : <select className="bx-input" value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} disabled={!can} aria-label="Referência"><option value="">— escolher —</option>{refOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>}
          <input className="bx-input" inputMode="numeric" placeholder="Máx. por aposta" value={f.maxStake} onChange={(e) => setF({ ...f, maxStake: e.target.value.replace(/\D/g, '') })} disabled={!can} />
          <input className="bx-input" inputMode="numeric" placeholder="Exposição máx." value={f.maxExposure} onChange={(e) => setF({ ...f, maxExposure: e.target.value.replace(/\D/g, '') })} disabled={!can} />
          <label className="flex min-h-[44px] items-center gap-2 text-[13px]"><input type="checkbox" className="h-5 w-5" checked={f.autoSuspend} onChange={(e) => setF({ ...f, autoSuspend: e.target.checked })} disabled={!can} />Suspender ao atingir</label>
          <label className="flex min-h-[44px] items-center gap-2 text-[13px]"><input type="checkbox" className="h-5 w-5" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} disabled={!can} />Ativo</label>
        </div>
        <button type="button" className="bx-btn w-full" disabled={!can || (['match', 'market', 'event'].includes(f.scope) && !f.ref)} onClick={save}>Guardar limite</button>
      </section>
      <ul className="space-y-1.5 text-[13px]">
        {v.limits.length === 0 && <li className="bx-card p-3 text-center text-sm">Sem limites extra (valem o mínimo/máximo gerais em Ligar/Desligar).</li>}
        {v.limits.map((l) => (
          <li key={`${l.scope}:${l.ref}`} className="bx-card flex items-center gap-2 p-2">
            <span className="flex-1">{SC[l.scope]}{l.ref ? ` · ${l.ref.length > 20 ? short(l.ref) : l.ref}` : l.scope === 'user' ? ' · todos' : ''} — máx. aposta {l.maxStake ?? '—'} · exposição {l.maxExposure ?? '—'}{l.autoSuspend ? ' · auto-suspende' : ''}{l.active ? '' : ' · INATIVO'}</span>
            {can && <button type="button" className="bx-ghost px-3 text-[12.5px]" onClick={() => setF({ scope: l.scope, ref: l.ref, maxStake: l.maxStake?.toString() ?? '', maxExposure: l.maxExposure?.toString() ?? '', autoSuspend: l.autoSuspend, active: l.active })}>Editar</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Refunds({ v2, can, run }: { v2: V2AdminView; can: boolean; run: Run }) {
  const open = v2.bets.filter((b) => isOpenBet(b.status));
  const refund = async (id: string) => { const mo = askMotivo('reembolsar esta aposta'); if (mo != null) await run(apostasV3Api.refund(id, mo), 'Aposta reembolsada (uma única vez).'); };
  return (
    <div className="space-y-2">
      <p className="bx-dim text-[12.5px]">Reembolso individual: devolve o valor apostado. Repetir não volta a creditar. Para reembolsar um confronto inteiro usa “Cancelar e reembolsar” em Confrontos.</p>
      {!can && <NoPerm what="Liquidar apostas" />}
      {open.length === 0 && <p className="bx-card p-3 text-center text-sm">Sem apostas em aberto.</p>}
      <ul className="space-y-2">{open.map((b) => (
        <li key={b.id} className="bx-card flex items-center gap-2 p-3 text-[13px]">
          <span className="flex-1"><b>@{b.handle}</b> · {b.label} · {b.market}<span className="bx-dim block">{b.stake} MT × {fmtOddsV2(b.oddsLocked)} · #{short(b.id)}</span></span>
          <button type="button" className="bx-ghost px-3 text-[12.5px]" disabled={!can} onClick={() => void refund(b.id)}>Reembolsar</button>
        </li>))}
      </ul>
    </div>
  );
}

function Complaints({ v, can, run }: { v: V3AdminView; can: boolean; run: Run }) {
  const [resp, setResp] = useState<Record<string, string>>({});
  return (
    <div className="space-y-2">
      {!can && <NoPerm what="Liquidar apostas" />}
      {v.complaints.length === 0 && <p className="bx-card p-3 text-center text-sm">Sem reclamações.</p>}
      {v.complaints.map((c) => (
        <section key={c.id} className="bx-card space-y-2 p-3 text-[13.5px]">
          <div className="flex justify-between gap-2"><b>@{c.handle}</b><span className="bx-tag bg-white/15">{c.status}</span></div>
          <p className="whitespace-pre-line">{c.message}</p>
          <p className="bx-dim text-[12px]">{when(c.at)}{c.betId ? ` · aposta #${short(c.betId)}` : ''}{c.matchId ? ` · confronto #${short(c.matchId)}` : ''}</p>
          {c.response && <p className="bx-muted">Resposta: {c.response}</p>}
          {can && !['resolvida', 'rejeitada'].includes(c.status) && (
            <>
              <input className="bx-input" placeholder="Resposta ao utilizador" maxLength={1000} value={resp[c.id] ?? ''} onChange={(e) => setResp({ ...resp, [c.id]: e.target.value })} />
              <div className="flex flex-wrap gap-2">
                {c.status === 'aberta' && <button type="button" className="bx-ghost px-3 text-[12.5px]" onClick={() => run(apostasV3Api.complaintUpdate(c.id, 'em_analise', resp[c.id] ?? ''), 'Em análise.')}>Em análise</button>}
                <button type="button" className="bx-ghost px-3 text-[12.5px]" disabled={(resp[c.id] ?? '').trim().length < 3} onClick={() => run(apostasV3Api.complaintUpdate(c.id, 'resolvida', resp[c.id] ?? ''), 'Reclamação resolvida.')}>Resolver</button>
                <button type="button" className="bx-ghost px-3 text-[12.5px]" disabled={(resp[c.id] ?? '').trim().length < 3} onClick={() => run(apostasV3Api.complaintUpdate(c.id, 'rejeitada', resp[c.id] ?? ''), 'Reclamação rejeitada.')}>Rejeitar</button>
              </div>
            </>
          )}
        </section>
      ))}
    </div>
  );
}

function Exposure({ v }: { v: V3AdminView }) {
  const total = v.exposure.reduce((a, x) => a + x.exposure, 0);
  return (
    <div className="space-y-2">
      <section className="bx-card grid grid-cols-3 gap-2 p-3 text-center text-[12.5px]">
        <div><p className="bx-muted">Exposição total</p><b className="text-[15px]">{total}</b></div>
        <div><p className="bx-muted">Em jogo</p><b className="text-[15px]">{v.exposure.reduce((a, x) => a + x.openStake, 0)}</b></div>
        <div><p className="bx-muted">Apostas abertas</p><b className="text-[15px]">{v.exposure.reduce((a, x) => a + x.openBets, 0)}</b></div>
      </section>
      <p className="bx-dim text-[12px]">Exposição = pior caso para a casa: o maior total a pagar numa seleção menos tudo o que foi apostado no mercado (MT de teste).</p>
      {v.exposure.length === 0 && <p className="bx-card p-3 text-center text-sm">Sem apostas em aberto.</p>}
      <ul className="space-y-1.5 text-[13px]">{v.exposure.map((x) => (
        <li key={x.marketId} className="bx-card flex items-center gap-2 p-2"><span className="flex-1 truncate">{x.title} <span className="bx-dim">· {x.status}</span></span><span className="bx-dim">{x.openBets} ap. · {x.openStake}</span><b className="w-16 text-right">{x.exposure}</b></li>))}
      </ul>
    </div>
  );
}

function Ledger({ v }: { v: V3AdminView }) {
  const R: Record<string, string> = { inicial: 'Saldo inicial', aposta: 'Aposta', liquidacao: 'Liquidação', admin: 'Crédito admin' };
  return (
    <ul className="space-y-1.5 text-[12.5px]">
      {v.ledger.length === 0 && <li className="bx-card p-3 text-center text-sm">Sem transações.</li>}
      {v.ledger.map((l) => (
        <li key={`${l.id}-${l.ref}`} className="bx-card flex items-center gap-2 p-2">
          <span className="flex-1 truncate">@{l.handle || '—'} · {R[l.reason] ?? l.reason} <span className="bx-dim">· {l.ref.length > 20 ? `#${short(l.ref)}` : l.ref} · {when(l.at)}</span></span>
          <b className={l.delta > 0 ? 'text-emerald-300' : ''}>{l.delta > 0 ? '+' : ''}{l.delta}</b><span className="bx-dim w-14 text-right">{l.balanceAfter}</span>
        </li>
      ))}
    </ul>
  );
}
