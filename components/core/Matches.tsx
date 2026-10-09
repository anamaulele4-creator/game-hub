'use client';
import React, { useMemo, useState } from 'react';
import { setValidation } from '@/lib/core/repo';
import type { CoreParticipation, CoreResult, Validation } from '@/lib/core/stats';
import { DataTable, Empty, NA, Origin, Panel, Segmented, Select, SourceTag, V, ValidationBadge, btnGhost, can, fmtDate, useAction, useCore } from './kit';

type StatusF = 'todos' | Validation;

export default function Matches() {
  const { bundle, arg, role, go } = useCore();
  const d = bundle.data;
  const [view, setView] = useState<'jogadores' | 'equipas'>('jogadores');
  const [st, setSt] = useState<StatusF>(arg === 'submetido' || arg === 'verificado' || arg === 'rejeitado' ? arg : 'todos');
  const [tour, setTour] = useState('');
  const [src, setSrc] = useState('');
  const maps = useMemo(() => ({
    m: new Map(d.matches.map((x) => [x.id, x])), p: new Map(d.players.map((x) => [x.id, x])),
    t: new Map(d.teams.map((x) => [x.id, x])), c: new Map(d.tournaments.map((x) => [x.id, x])),
  }), [d]);
  const keep = (r: { validation_status: Validation; source: string; match_id: string }) =>
    (st === 'todos' || r.validation_status === st) && (!src || r.source === src) && (!tour || maps.m.get(r.match_id)?.tournament_id === (tour === '_none' ? null : tour));
  const parts = useMemo(() => d.participations.filter(keep), [d, st, tour, src]); // eslint-disable-line react-hooks/exhaustive-deps
  const results = useMemo(() => d.results.filter(keep), [d, st, tour, src]); // eslint-disable-line react-hooks/exhaustive-deps
  const when = (mid: string, fb: string) => maps.m.get(mid)?.played_at ?? fb;
  const where = (mid: string) => { const m = maps.m.get(mid); if (!m) return '—'; const c = m.tournament_id ? maps.c.get(m.tournament_id) : null; return `${c ? c.name : 'Avulsa'}${m.round_label ? ' · ' + m.round_label : ''}${m.map ? ' · ' + m.map : ''}`; };
  const pending = d.participations.filter((p) => p.validation_status === 'submetido').length + d.results.filter((r) => r.validation_status === 'submetido').length;

  const toolbar = (
    <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
      <Select label="Torneio" value={tour} onChange={setTour} options={[['', 'Todos'], ['_none', 'Partidas avulsas'], ...d.tournaments.map((t) => [t.id, t.name] as [string, string])]} className="sm:w-52" />
      <Select label="Origem" value={src} onChange={setSrc} options={[['', 'Todas'], ['torneio_txapilog', 'Torneio TXAPILOG'], ['submetido_jogador', 'Submetido pelo jogador'], ['provedor_autorizado', 'Fornecedor autorizado']]} className="sm:w-48" />
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Vista" value={view} onChange={setView} options={[['jogadores', 'Por jogador'], ['equipas', 'Resultados de equipa']]} />
        <Segmented label="Estado" value={st} onChange={setSt} options={[['todos', 'Todos'], ['submetido', `Por verificar (${pending})`], ['verificado', 'Verificados'], ['rejeitado', 'Rejeitados']]} />
      </div>
      {view === 'jogadores' ? (
        <Panel title="Participações" sub="Cada linha é o registo de um jogador numa partida.">
          <DataTable rowKey={(p) => p.id} rows={parts} initialSort={{ key: 'd', dir: -1 }} toolbar={toolbar}
            search={(p) => `${maps.p.get(p.player_id)?.nickname ?? ''} ${where(p.match_id)} ${p.team_id ? maps.t.get(p.team_id)?.name ?? '' : ''}`}
            placeholder="Jogador, equipa, torneio…"
            card={(p) => (
              <div className="text-sm">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <button onClick={() => go('perfil', p.player_id)} className="mr-auto min-w-0 break-all text-left font-semibold">{maps.p.get(p.player_id)?.nickname ?? '—'}</button>
                  <ValidationBadge s={p.validation_status} />
                </div>
                <p className="mt-0.5 truncate text-[12px] text-white/60">{fmtDate(when(p.match_id, p.created_at))} · {where(p.match_id)}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                  <span><b className="tabular-nums">{p.kills}</b> abates</span><span>{p.placement == null ? <NA /> : `${p.placement}.º lugar`}</span><span>Dano <V v={p.damage} /></span><SourceTag s={p.source} />
                </div>
                {p.rejection_reason && <p className="mt-1 text-[12px] text-red-300">Motivo: {p.rejection_reason}</p>}
                {can(role, 'validar') && p.validation_status === 'submetido' && <div className="mt-2"><ValidateButtons kind="participacao" id={p.id} status={p.validation_status} /></div>}
              </div>
            )}
            empty={<Empty title="Sem participações neste filtro" text={d.participations.length ? 'Muda os filtros.' : 'Ainda não há partidas registadas na TXAPILOG.'} />}
            cols={[
              { key: 'd', label: 'Data', sort: (p) => when(p.match_id, p.created_at), render: (p) => <span className="whitespace-nowrap text-[13px]">{fmtDate(when(p.match_id, p.created_at))}</span> },
              { key: 'j', label: 'Jogador', sort: (p) => maps.p.get(p.player_id)?.nickname.toLowerCase() ?? '', render: (p) => <button onClick={() => go('perfil', p.player_id)} className="font-semibold hover:underline">{maps.p.get(p.player_id)?.nickname ?? '—'}</button> },
              { key: 'w', label: 'Partida', render: (p) => <span className="block max-w-[220px] truncate text-[13px] text-white/75" title={where(p.match_id)}>{where(p.match_id)}</span> },
              { key: 'k', label: 'Abates', sort: (p) => p.kills, render: (p) => <b className="tabular-nums">{p.kills}</b> },
              { key: 'p', label: 'Pos.', sort: (p) => p.placement ?? 99, render: (p) => p.placement == null ? <NA /> : `${p.placement}.º` },
              { key: 'g', label: 'Dano', sort: (p) => p.damage ?? -1, render: (p) => <V v={p.damage} /> },
              { key: 'o', label: 'Origem', render: (p) => <SourceTag s={p.source} /> },
              { key: 's', label: 'Estado', render: (p) => <div><ValidationBadge s={p.validation_status} />{p.rejection_reason && <p className="mt-0.5 max-w-[160px] truncate text-[11px] text-red-300" title={p.rejection_reason}>{p.rejection_reason}</p>}</div> },
              ...(can(role, 'validar') ? [{ key: 'a', label: 'Ação', render: (p: CoreParticipation) => <ValidateButtons kind="participacao" id={p.id} status={p.validation_status} /> }] : []),
            ]} />
          <Origin>Linhas “Submetido · não verificado” contam nas estatísticas marcadas como “verificadas + submetidas”, nunca nas “só verificadas”. Rejeitadas nunca contam.</Origin>
        </Panel>
      ) : (
        <Panel title="Resultados de equipa" sub="Posição final, abates e pontos por equipa e partida.">
          <DataTable rowKey={(r) => r.id} rows={results} initialSort={{ key: 'd', dir: -1 }} toolbar={toolbar}
            search={(r) => `${maps.t.get(r.team_id)?.name ?? ''} ${where(r.match_id)}`} placeholder="Equipa, torneio…"
            card={(r) => (
              <div className="text-sm">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><button onClick={() => go('equipas', r.team_id)} className="mr-auto min-w-0 text-left font-semibold">{maps.t.get(r.team_id)?.name ?? '—'}</button><ValidationBadge s={r.validation_status} /></div>
                <p className="mt-0.5 truncate text-[12px] text-white/60">{fmtDate(when(r.match_id, r.created_at))} · {where(r.match_id)}</p>
                <p className="mt-1.5 text-[13px]"><b>{r.placement}.º</b> · {r.kills_total} abates · {r.points == null ? <NA /> : `${r.points} pts`}</p>
                {can(role, 'validar') && r.validation_status === 'submetido' && <div className="mt-2"><ValidateButtons kind="resultado" id={r.id} status={r.validation_status} /></div>}
              </div>
            )}
            empty={<Empty title="Sem resultados neste filtro" />}
            cols={[
              { key: 'd', label: 'Data', sort: (r) => when(r.match_id, r.created_at), render: (r) => <span className="whitespace-nowrap text-[13px]">{fmtDate(when(r.match_id, r.created_at))}</span> },
              { key: 't', label: 'Equipa', render: (r) => <button onClick={() => go('equipas', r.team_id)} className="font-semibold hover:underline">{maps.t.get(r.team_id)?.name ?? '—'}</button> },
              { key: 'w', label: 'Partida', render: (r) => <span className="block max-w-[220px] truncate text-[13px] text-white/75">{where(r.match_id)}</span> },
              { key: 'p', label: 'Pos.', sort: (r) => r.placement, render: (r) => `${r.placement}.º` },
              { key: 'k', label: 'Abates', sort: (r) => r.kills_total, render: (r) => r.kills_total },
              { key: 'pt', label: 'Pontos', sort: (r) => r.points ?? -1, render: (r) => <V v={r.points} /> },
              { key: 's', label: 'Estado', render: (r) => <ValidationBadge s={r.validation_status} /> },
              ...(can(role, 'validar') ? [{ key: 'a', label: 'Ação', render: (r: CoreResult) => <ValidateButtons kind="resultado" id={r.id} status={r.validation_status} /> }] : []),
            ]} />
        </Panel>
      )}
    </div>
  );
}

function ValidateButtons({ kind, id, status }: { kind: 'participacao' | 'resultado'; id: string; status: Validation }) {
  const { busy, run } = useAction();
  if (status !== 'submetido') return <span className="text-[12px] text-white/45">—</span>;
  return (
    <div className="flex gap-1.5">
      <button disabled={busy} onClick={() => run(() => setValidation(kind, id, 'verificado'), 'Marcado como verificado.')} className="rounded-lg bg-emerald-400 px-2.5 py-1.5 text-[12px] font-bold text-ink disabled:opacity-40" aria-label="Verificar">✓ Verificar</button>
      <button disabled={busy} onClick={() => { const r = window.prompt('Motivo da rejeição (obrigatório):'); if (r && r.trim()) void run(() => setValidation(kind, id, 'rejeitado', r.trim().slice(0, 300)), 'Rejeitado.'); }} className={`${btnGhost} !min-h-0 px-2.5 py-1.5 text-[12px]`} aria-label="Rejeitar">✕</button>
    </div>
  );
}
