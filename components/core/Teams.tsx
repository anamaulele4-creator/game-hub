'use client';
import React, { useMemo, useState } from 'react';
import { createTeam, createTournament } from '@/lib/core/repo';
import { fmtNum, teamStats, type CoreTournament } from '@/lib/core/stats';
import { DataTable, Empty, Origin, Panel, Segmented, Select, StatCard, V, ValidationBadge, btn, btnGhost, can, fmtDate, input, useAction, useCore } from './kit';

export function Teams() {
  const { bundle, arg, go, role } = useCore();
  const d = bundle.data;
  const [kind, setKind] = useState<'todas' | 'duo' | 'squad'>('todas');
  const rows = useMemo(() => d.teams.filter((t) => kind === 'todas' || t.kind === kind).map((t) => ({ t, s: teamStats(t.id, d.results, d.members) })), [d, kind]);
  const sel = d.teams.find((t) => t.id === arg);
  const nick = (id: string) => d.players.find((p) => p.id === id)?.nickname ?? '—';
  return (
    <div className="space-y-4">
      {sel && (() => {
        const s = teamStats(sel.id, d.results, d.members);
        const mem = d.members.filter((m) => m.team_id === sel.id && !m.left_at);
        const res = d.results.filter((r) => r.team_id === sel.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
        return (
          <Panel title={<>{sel.name} {sel.tag && <span className="text-white/55">[{sel.tag}]</span>}</>} sub={`${sel.kind === 'duo' ? 'Duo' : 'Squad'} · criada ${fmtDate(sel.created_at, false)}`} action={<button className={btnGhost} onClick={() => go('equipas')}>Fechar</button>}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Partidas" value={s.matches} sub={`${s.verified} verificadas`} />
              <StatCard label="Vitórias" value={<V v={s.wins} />} />
              <StatCard label="Posição média" value={<V v={s.avgPlacement} />} />
              <StatCard label="Pontos" value={<V v={s.points} />} sub={s.kills == null ? undefined : `${s.kills} abates`} />
            </div>
            <h3 className="mb-2 mt-4 text-sm font-semibold text-white/80">Membros ({mem.length})</h3>
            <div className="flex flex-wrap gap-2">{mem.length ? mem.map((m) => <button key={m.player_id} onClick={() => go('perfil', m.player_id)} className="rounded-xl bg-core-panel2 px-3 py-1.5 text-sm">{nick(m.player_id)} <span className="text-white/55">· {m.role}</span></button>) : <span className="text-sm text-white/60">Sem membros ativos.</span>}</div>
            <h3 className="mb-2 mt-4 text-sm font-semibold text-white/80">Últimos resultados</h3>
            {res.length ? <ul className="divide-y divide-core-line/60 text-sm">{res.slice(0, 8).map((r) => <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5"><span className="w-12 font-bold">{r.placement}.º</span><span className="flex-1 text-white/75">{r.kills_total} abates · {r.points ?? '—'} pts</span><ValidationBadge s={r.validation_status} /></li>)}</ul> : <Empty title="Sem resultados registados" />}
            <Origin>Calculado a partir de core_results (excluídas as rejeitadas). Sem resultados → indisponível.</Origin>
          </Panel>
        );
      })()}
      <Panel title="Equipas" action={<Segmented label="Tipo" value={kind} onChange={setKind} options={[['todas', 'Todas'], ['duo', 'Duos'], ['squad', 'Squads']]} />}>
        <DataTable rowKey={(r) => r.t.id} rows={rows} search={(r) => `${r.t.name} ${r.t.tag ?? ''} ${d.members.filter((m) => m.team_id === r.t.id).map((m) => nick(m.player_id)).join(' ')}`} placeholder="Equipa, tag ou jogador…"
          empty={<Empty icon="" title="Nenhuma equipa registada" />}
          cols={[
            { key: 'n', label: 'Equipa', sort: (r) => r.t.name.toLowerCase(), render: (r) => <button onClick={() => go('equipas', r.t.id)} className="font-semibold text-neon2 hover:underline">{r.t.name}</button> },
            { key: 'k', label: 'Tipo', render: (r) => r.t.kind === 'duo' ? 'Duo' : 'Squad' },
            { key: 'm', label: 'Membros', sort: (r) => r.s.activeMembers, render: (r) => r.s.activeMembers },
            { key: 'p', label: 'Partidas', sort: (r) => r.s.matches, render: (r) => r.s.matches },
            { key: 'w', label: 'Vitórias', sort: (r) => r.s.wins ?? -1, render: (r) => <V v={r.s.wins} /> },
            { key: 'a', label: 'Pos. média', sort: (r) => -(r.s.avgPlacement ?? 99), render: (r) => <V v={r.s.avgPlacement} /> },
            { key: 'pt', label: 'Pontos', sort: (r) => r.s.points ?? -1, render: (r) => <V v={r.s.points} /> },
          ]} />
      </Panel>
      {can(role, 'registar') && <NewTeam />}
    </div>
  );
}

function NewTeam() {
  const { busy, run } = useAction();
  const [name, setName] = useState(''); const [tag, setTag] = useState(''); const [kind, setKind] = useState('squad');
  return (
    <Panel title="Nova equipa">
      <form className="grid gap-2 sm:grid-cols-[1fr_120px_140px_auto] sm:items-end" onSubmit={async (e) => { e.preventDefault(); if (await run(() => createTeam(name, kind as 'duo' | 'squad', tag.trim()), 'Equipa criada.')) { setName(''); setTag(''); } }}>
        <label className="flex flex-col gap-1 text-[12px] text-white/65">Nome<input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required /></label>
        <label className="flex flex-col gap-1 text-[12px] text-white/65">Tag<input className={input} value={tag} onChange={(e) => setTag(e.target.value)} maxLength={6} /></label>
        <Select label="Tipo" value={kind} onChange={setKind} options={[['squad', 'Squad (4)'], ['duo', 'Duo (2)']]} />
        <button className={btn} disabled={busy}>Criar</button>
      </form>
    </Panel>
  );
}

const T_STATUS: Record<CoreTournament['status'], string> = { rascunho: 'Rascunho', inscricoes: 'Inscrições', a_decorrer: 'A decorrer', terminado: 'Terminado', cancelado: 'Cancelado' };

export function Tournaments() {
  const { bundle, arg, go, role } = useCore();
  const d = bundle.data;
  const [f, setF] = useState<'todos' | 'ativos' | 'terminado'>('todos');
  const [onlyV, setOnlyV] = useState<'sim' | 'nao'>('sim');
  const list = d.tournaments.filter((t) => f === 'todos' || (f === 'ativos' ? t.status === 'inscricoes' || t.status === 'a_decorrer' : t.status === 'terminado'));
  const sel = d.tournaments.find((t) => t.id === arg);
  const info = (t: CoreTournament) => {
    const ms = d.matches.filter((m) => m.tournament_id === t.id && m.validation_status !== 'rejeitado');
    const ids = new Set(ms.map((m) => m.id));
    const rs = d.results.filter((r) => ids.has(r.match_id) && r.validation_status !== 'rejeitado');
    return { ms, rs, teams: d.tournamentTeams.filter((x) => x.tournament_id === t.id).length, verifiedShare: rs.length ? rs.filter((r) => r.validation_status === 'verificado').length / rs.length : null };
  };
  return (
    <div className="space-y-4">
      {sel && (() => {
        const i = info(sel);
        const rs = i.rs.filter((r) => onlyV === 'nao' || r.validation_status === 'verificado');
        const table = new Map<string, { pts: number; kills: number; n: number; wins: number; hasPts: boolean }>();
        for (const r of rs) { const x = table.get(r.team_id) ?? { pts: 0, kills: 0, n: 0, wins: 0, hasPts: false }; x.pts += r.points ?? 0; x.hasPts ||= r.points != null; x.kills += r.kills_total; x.n++; if (r.placement === 1) x.wins++; table.set(r.team_id, x); }
        const standings = [...table.entries()].map(([team, x]) => ({ team, ...x })).sort((a, b) => b.pts - a.pts || b.wins - a.wins || b.kills - a.kills);
        return (
          <Panel title={`${sel.name}`} sub={`${T_STATUS[sel.status]} · ${sel.mode} · ${sel.region} · início ${fmtDate(sel.starts_at)}`} action={<button className={btnGhost} onClick={() => go('torneios')}>Fechar</button>}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Equipas inscritas" value={i.teams} />
              <StatCard label="Partidas" value={i.ms.length} />
              <StatCard label="Resultados" value={i.rs.length} />
              <StatCard label="Verificados" value={i.verifiedShare == null ? <V v={null} /> : `${Math.round(i.verifiedShare * 100)}%`} tone={i.verifiedShare != null && i.verifiedShare < 1 ? 'warn' : 'default'} />
            </div>
            <div className="mb-2 mt-4 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-white/80">Classificação</h3><Segmented label="Linhas" value={onlyV} onChange={setOnlyV} options={[['sim', 'Só verificados'], ['nao', 'Incluir submetidos']]} /></div>
            {standings.length ? (
              <ol className="space-y-1">{standings.map((s, k) => (
                <li key={s.team} className="flex items-center gap-3 rounded-xl bg-core-bg/60 px-3 py-2 text-sm">
                  <span className={`flex h-7 w-7 items-center justify-center rounded-lg font-bold ${k === 0 ? 'bg-neon text-ink' : 'bg-core-panel2'}`}>{k + 1}</span>
                  <button onClick={() => go('equipas', s.team)} className="min-w-0 flex-1 truncate text-left font-semibold">{d.teams.find((t) => t.id === s.team)?.name ?? '—'}</button>
                  <span className="text-[12px] text-white/60">{s.n} jogos · {s.wins} · {s.kills} abates</span>
                  <b className="w-14 text-right tabular-nums">{s.hasPts ? `${s.pts} pts` : '—'}</b>
                </li>))}
              </ol>
            ) : <Empty icon="" title="Classificação indisponível" text={onlyV === 'sim' && i.rs.length ? 'Ainda não há resultados verificados. Verifica-os no Histórico ou inclui os submetidos.' : 'Ainda não há resultados registados neste torneio.'} action={onlyV === 'sim' && i.rs.length ? <button className={btnGhost} onClick={() => go('historico', 'submetido')}>Verificar resultados</button> : undefined} />}
            <Origin>Pontos somados de core_results deste torneio. Desempate: vitórias, depois abates.</Origin>
          </Panel>
        );
      })()}
      <Panel title="Torneios registados na TXAPILOG" action={<Segmented label="Estado" value={f} onChange={setF} options={[['todos', 'Todos'], ['ativos', 'Ativos'], ['terminado', 'Terminados']]} />}>
        <DataTable rowKey={(t) => t.id} rows={list} search={(t) => t.name} placeholder="Nome do torneio…"
          empty={<Empty icon="" title="Sem torneios neste filtro" />}
          cols={[
            { key: 'n', label: 'Torneio', sort: (t) => t.name.toLowerCase(), render: (t) => <button onClick={() => go('torneios', t.id)} className="font-semibold text-neon2 hover:underline">{t.name}</button> },
            { key: 's', label: 'Estado', render: (t) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${t.status === 'a_decorrer' ? 'bg-neon text-ink' : t.status === 'inscricoes' ? 'bg-sky-300 text-ink' : 'bg-white/15'}`}>{T_STATUS[t.status]}</span> },
            { key: 'm', label: 'Modo', render: (t) => t.mode },
            { key: 'd', label: 'Início', sort: (t) => t.starts_at ?? '', render: (t) => <span className="whitespace-nowrap">{fmtDate(t.starts_at, false)}</span> },
            { key: 'e', label: 'Equipas', render: (t) => info(t).teams },
            { key: 'p', label: 'Partidas', render: (t) => info(t).ms.length },
            { key: 'v', label: '% verif.', render: (t) => { const v = info(t).verifiedShare; return v == null ? <V v={null} /> : `${fmtNum(v * 100, 0)}%`; } },
          ]} />
      </Panel>
      {can(role, 'criar_torneio') && <NewTournament />}
    </div>
  );
}

function NewTournament() {
  const { busy, run } = useAction();
  const [name, setName] = useState(''); const [mode, setMode] = useState('squad'); const [start, setStart] = useState('');
  return (
    <Panel title="Novo torneio" sub="Fica em rascunho. Os resultados inseridos pelo organizador são a fonte “Torneio TXAPILOG”.">
      <form className="grid gap-2 sm:grid-cols-[1fr_140px_200px_auto] sm:items-end" onSubmit={async (e) => { e.preventDefault(); if (await run(() => createTournament(name, mode as 'solo' | 'duo' | 'squad', start ? new Date(start).toISOString() : null), 'Torneio criado.')) { setName(''); setStart(''); } }}>
        <label className="flex flex-col gap-1 text-[12px] text-white/65">Nome<input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required /></label>
        <Select label="Modo" value={mode} onChange={setMode} options={[['squad', 'Squad'], ['duo', 'Duo'], ['solo', 'Solo']]} />
        <label className="flex flex-col gap-1 text-[12px] text-white/65">Início<input type="datetime-local" className={input} value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <button className={btn} disabled={busy}>Criar</button>
      </form>
    </Panel>
  );
}
