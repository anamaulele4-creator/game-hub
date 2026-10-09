'use client';
import React, { useMemo, useRef, useState } from 'react';
import { LineChart } from '@/components/Charts';
import { buildProviders, searchExternalId, type ProviderLookup } from '@/lib/core/providers';
import { comparePlayers, confidenceFor, detectAnomalies, fmtNum, isValidFreeFireId, pct, playerStats, rankPlayers, trendFor, type CorePlayer, type RankMetric } from '@/lib/core/stats';
import { registerPlayer } from '@/lib/core/repo';
import { ConfidenceBadge, DataTable, Empty, NA, Origin, Panel, Segmented, Select, SourceTag, StatCard, V, ValidationBadge, btn, btnGhost, can, fmtDate, input, useAction, useCore } from './kit';

const REGIONS: [string, string][] = [['', 'Todas as regiões'], ['AF', 'África (AF)'], ['BR', 'Brasil (BR)'], ['IND', 'Índia (IND)'], ['SG', 'Singapura (SG)'], ['ME', 'Médio Oriente (ME)'], ['EU', 'Europa (EU)'], ['US', 'América do Norte (US)']];

export function Search() {
  const { bundle, go, role } = useCore();
  const [id, setId] = useState('');
  const [region, setRegion] = useState('');
  const [res, setRes] = useState<ProviderLookup[] | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const dataRef = useRef(bundle.data); dataRef.current = bundle.data;
  const providers = useMemo(() => buildProviders(() => dataRef.current), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = id.replace(/\s/g, '');
    if (!isValidFreeFireId(v)) { setErr('O ID Free Fire tem só números (6 a 13 dígitos).'); setRes(null); return; }
    setErr(''); setLoading(true);
    try { setRes(await searchExternalId(providers, v, region || undefined)); } finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <Panel title="Pesquisar jogador por ID Free Fire" sub="Pesquisa em todas as fontes. Só são mostrados dados realmente obtidos.">
        <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-[12px] text-white/65">ID do jogador (UID)
            <input value={id} onChange={(e) => setId(e.target.value)} inputMode="numeric" autoComplete="off" placeholder="ex.: 1234567890" className={input} aria-invalid={!!err} />
          </label>
          <Select label="Região" value={region} onChange={setRegion} options={REGIONS} className="sm:w-48" />
          <button className={btn} disabled={loading}>{loading ? 'A pesquisar…' : 'Pesquisar'}</button>
        </form>
        {err && <p role="alert" className="mt-2 text-sm text-red-300">{err}</p>}
      </Panel>

      {res && (
        <div className="space-y-3" aria-live="polite">
          {res.map((r) => {
            const p = providers.find((x) => x.id === r.provider)!;
            return (
              <Panel key={r.provider} title={p.name} action={<span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${p.enabled ? 'bg-emerald-400 text-ink' : 'bg-white/15 text-white/80'}`}>{p.statusLabel}</span>}>
                {r.status === 'indisponivel' && <p className="text-sm text-white/70">Indisponível — {p.detail}</p>}
                {r.status === 'sem_dados' && <Empty icon="" title="Sem dados para este ID" text={r.message} />}
                {r.status === 'encontrado' && r.players.map((pl) => <PlayerHit key={pl.id} player={pl} lookup={r} onOpen={() => go('perfil', pl.id)} />)}
              </Panel>
            );
          })}
        </div>
      )}

      <Panel title="Jogadores registados" sub="Pesquisa por nickname ou ID">
        <DataTable rowKey={(p) => p.id} rows={bundle.data.players}
          search={(p) => `${p.nickname} ${bundle.data.externalIds.filter((e) => e.player_id === p.id).map((e) => e.external_id).join(' ')}`}
          placeholder="Nickname ou ID…"
          empty={<Empty title="Nenhum jogador registado" text="Regista jogadores abaixo ou através dos torneios TXAPILOG." />}
          cols={[
            { key: 'n', label: 'Jogador', sort: (p) => p.nickname.toLowerCase(), render: (p) => <button onClick={() => go('perfil', p.id)} className="font-semibold text-neon2 hover:underline">{p.nickname}</button> },
            { key: 'id', label: 'ID Free Fire', render: (p) => { const e = bundle.data.externalIds.filter((x) => x.player_id === p.id); return e.length ? e.map((x) => <span key={x.id} className="mr-1 font-mono text-[13px]">{x.external_id}<span className={`ml-1 text-[11px] ${x.status === 'verificado' ? 'text-emerald-300' : 'text-neon2'}`}>{x.status === 'verificado' ? '✓' : '· pendente'}</span></span>) : <NA />; } },
            { key: 'm', label: 'Partidas', sort: (p) => bundle.data.participations.filter((x) => x.player_id === p.id && x.validation_status !== 'rejeitado').length, render: (p) => bundle.data.participations.filter((x) => x.player_id === p.id && x.validation_status !== 'rejeitado').length },
            { key: 'v', label: 'Perfil', render: (p) => bundle.data.verifications.some((v) => v.player_id === p.id) ? <span className="text-emerald-300">Verificado</span> : <span className="text-white/55">Não verificado</span> },
          ]} />
      </Panel>
      {can(role, 'registar') && <RegisterForm />}
    </div>
  );
}

function PlayerHit({ player, lookup, onOpen }: { player: CorePlayer; lookup: ProviderLookup; onOpen: () => void }) {
  const { bundle } = useCore();
  const parts = lookup.participations.filter((p) => p.player_id === player.id);
  const s = playerStats(parts, bundle.data.matches);
  const c = confidenceFor(s);
  return (
    <div className="rounded-xl border border-core-line bg-core-bg/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-lg font-bold">{player.nickname}</p>
        <ConfidenceBadge c={c.level} />
        <button onClick={onOpen} className={btnGhost}>Abrir perfil</button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">{lookup.externalIds.filter((e) => e.player_id === player.id).map((e) => <span key={e.id} className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[12px]">{e.external_id} · {e.region} · {e.status}</span>)}</div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Mini l="Partidas" v={s.matches} /><Mini l="Média abates" v={fmtNum(s.avgKills)} /><Mini l="K/D" v={fmtNum(s.kd)} /><Mini l="Vitórias" v={s.wins == null ? 'indisponível' : `${s.wins} (${pct(s.winRate)})`} />
      </div>
      <Origin>Origem: {lookup.message} {c.reasons.join(' ')}</Origin>
    </div>
  );
}
function Mini({ l, v }: { l: string; v: React.ReactNode }) {
  return <div className="min-w-0 rounded-lg bg-core-panel2 px-2.5 py-2"><p className="truncate text-[11px] text-white/60">{l}</p><p className={`truncate font-bold tabular-nums ${v === 'indisponível' ? 'text-white/45' : ''}`}>{v}</p></div>;
}

function RegisterForm() {
  const { busy, run } = useAction();
  const [nick, setNick] = useState(''); const [ext, setExt] = useState(''); const [reg, setReg] = useState('AF');
  return (
    <Panel title="Registar jogador" sub="O ID fica pendente até um moderador o confirmar (captura do perfil no jogo ou presença em torneio).">
      <form className="grid gap-2 sm:grid-cols-[1fr_1fr_160px_auto] sm:items-end" onSubmit={async (e) => { e.preventDefault(); if (await run(() => registerPlayer(nick, ext.replace(/\s/g, ''), reg), 'Jogador registado.')) { setNick(''); setExt(''); } }}>
        <label className="flex flex-col gap-1 text-[12px] text-white/65">Nickname<input className={input} value={nick} onChange={(e) => setNick(e.target.value)} maxLength={32} required /></label>
        <label className="flex flex-col gap-1 text-[12px] text-white/65">ID Free Fire<input className={input} value={ext} onChange={(e) => setExt(e.target.value)} inputMode="numeric" pattern="[0-9 ]{6,16}" required /></label>
        <Select label="Região" value={reg} onChange={setReg} options={REGIONS.slice(1)} />
        <button className={btn} disabled={busy}>Registar</button>
      </form>
    </Panel>
  );
}

// ---------------- Perfil ----------------
export function Profile() {
  const { bundle, arg, go } = useCore();
  const d = bundle.data;
  const player = d.players.find((p) => p.id === arg) ?? null;
  const [onlyV, setOnlyV] = useState<'todas' | 'verificadas'>('todas');
  const data = useMemo(() => {
    if (!player) return null;
    const parts = d.participations.filter((p) => p.player_id === player.id);
    const stats = playerStats(parts, d.matches, onlyV === 'verificadas');
    const all = playerStats(parts, d.matches);
    const mById = new Map(d.matches.map((m) => [m.id, m]));
    const ordered = parts.filter((p) => p.validation_status !== 'rejeitado' && (onlyV === 'todas' || p.validation_status === 'verificado'))
      .sort((a, b) => (mById.get(a.match_id)?.played_at ?? a.created_at).localeCompare(mById.get(b.match_id)?.played_at ?? b.created_at));
    return {
      parts, stats, conf: confidenceFor(all), trend: trendFor(parts, d.matches),
      series: ordered.slice(-20).map((p, i) => ({ label: String(i + 1), value: p.kills })),
      teams: d.members.filter((m) => m.player_id === player.id && !m.left_at).map((m) => ({ m, t: d.teams.find((t) => t.id === m.team_id) })),
      ids: d.externalIds.filter((e) => e.player_id === player.id),
      verified: d.verifications.find((v) => v.player_id === player.id),
      anomalies: detectAnomalies(d).filter((a) => a.entity_id === player.id || a.evidence.some((e) => parts.some((p) => p.id === e))),
      mById,
    };
  }, [player, d, onlyV]);

  if (!player || !data) return (
    <Panel title="Escolhe um jogador">
      <DataTable rowKey={(p) => p.id} rows={d.players} search={(p) => p.nickname} placeholder="Pesquisar nickname…" empty={<Empty title="Nenhum jogador registado" />}
        cols={[
          { key: 'n', label: 'Jogador', sort: (p) => p.nickname.toLowerCase(), render: (p) => <button onClick={() => go('perfil', p.id)} className="font-semibold text-neon2 hover:underline">{p.nickname}</button> },
          { key: 'm', label: 'Partidas', render: (p) => d.participations.filter((x) => x.player_id === p.id && x.validation_status !== 'rejeitado').length },
          { key: 'c', label: 'Desde', render: (p) => fmtDate(p.created_at, false) },
        ]} />
    </Panel>
  );
  const s = data.stats;
  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-neon text-2xl font-black text-ink">{player.nickname.charAt(0).toUpperCase()}</span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-extrabold">{player.nickname}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px]">
              {data.verified ? <span className="rounded-full bg-emerald-400 px-2 py-0.5 font-bold text-ink">Perfil verificado</span> : <span className="rounded-full bg-white/15 px-2 py-0.5">Perfil não verificado</span>}
              <ConfidenceBadge c={data.conf.level} />
              {player.status === 'suspenso' && <span className="rounded-full bg-red-500 px-2 py-0.5 font-bold">Suspenso</span>}
            </div>
          </div>
          <div className="flex gap-2"><button className={btnGhost} onClick={() => go('ia', player.id)}>Analisar</button><button className={btnGhost} onClick={() => go('rankings', player.id)}>Comparar</button></div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {data.ids.length ? data.ids.map((e) => <span key={e.id} className="rounded-md bg-white/10 px-2 py-1 font-mono text-[12px]">FF {e.external_id} · {e.region} · <span className={e.status === 'verificado' ? 'text-emerald-300' : e.status === 'pendente' ? 'text-neon2' : 'text-red-300'}>{e.status}</span></span>) : <span className="text-sm text-white/60">Sem ID Free Fire associado.</span>}
          {data.teams.map(({ m, t }) => t && <button key={t.id} onClick={() => go('equipas', t.id)} className="rounded-md bg-core-panel2 px-2 py-1 text-[12px]">{t.name} · {m.role}</button>)}
        </div>
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented label="Linhas incluídas" value={onlyV} onChange={setOnlyV} options={[['todas', 'Verificadas + submetidas'], ['verificadas', 'Só verificadas']]} />
        <span className="text-[12px] text-white/60">{s.matches} partida(s) · {s.rejected} rejeitada(s) excluída(s)</span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Partidas" value={s.matches} sub={`${s.verified} verificadas · ${s.unverified} não verificadas`} />
        <StatCard label="Média de abates" value={<V v={s.avgKills} />} sub={s.maxKills == null ? undefined : `máximo ${s.maxKills}`} />
        <StatCard label="K/D" value={<V v={s.kd} />} sub="abates ÷ partidas não ganhas" />
        <StatCard label="Vitórias" value={s.wins == null ? <NA /> : s.wins} sub={s.winRate == null ? undefined : `${pct(s.winRate)} · top 10 ${pct(s.top10Rate)}`} />
        <StatCard label="Posição média" value={<V v={s.avgPlacement} />} sub={`${s.placementSamples} com posição`} />
        <StatCard label="Dano médio" value={<V v={s.avgDamage} />} sub={`${s.damageSamples} com dano`} />
        <StatCard label="Tendência" value={data.trend.direction === 'indisponivel' ? <NA /> : data.trend.direction === 'subida' ? 'subida' : data.trend.direction === 'descida' ? 'descida' : '→ estável'} sub={data.trend.direction === 'indisponivel' ? 'precisa de 10 partidas' : `${fmtNum(data.trend.previousAvgKills)} → ${fmtNum(data.trend.recentAvgKills)} abates`} />
        <StatCard label="Última partida" value={s.lastPlayedAt ? fmtDate(s.lastPlayedAt, false) : <NA />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Abates por partida" sub="Últimas 20, da mais antiga para a mais recente">
          {data.series.length >= 2 ? <LineChart data={data.series} height={140} /> : <Empty icon="" title="Dados insuficientes para o gráfico" />}
          <Origin>{data.conf.reasons.join(' ')}</Origin>
        </Panel>
        <Panel title="Sinais para revisão" sub="Detetados por regras; não são acusações">
          {data.anomalies.length ? <ul className="space-y-2 text-sm">{data.anomalies.map((a, i) => <li key={i} className="rounded-xl bg-core-bg/60 p-2.5"><b>{a.title}</b><p className="text-[13px] text-white/70">{a.detail}</p></li>)}</ul> : <Empty icon="" title="Nenhuma inconsistência detetada" text="Com os dados registados, não há valores fora do padrão nem duplicados." />}
        </Panel>
      </div>

      <Panel title="Histórico de partidas do jogador">
        <DataTable rowKey={(p) => p.id} rows={data.parts} initialSort={{ key: 'd', dir: -1 }}
          empty={<Empty title="Sem partidas registadas" text="Estatísticas indisponíveis até haver partidas de torneios TXAPILOG ou submissões." />}
          card={(p) => (
            <div className="text-sm">
              <div className="flex items-center gap-2"><span className="flex-1 text-[12px] text-white/60">{fmtDate(data.mById.get(p.match_id)?.played_at ?? p.created_at)}</span><ValidationBadge s={p.validation_status} /></div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]"><span><b className="tabular-nums">{p.kills}</b> abates</span><span>{p.placement == null ? <NA /> : `${p.placement}.º lugar`}</span><span>Dano <V v={p.damage} /></span><SourceTag s={p.source} /></div>
            </div>
          )}
          cols={[
            { key: 'd', label: 'Data', sort: (p) => data.mById.get(p.match_id)?.played_at ?? p.created_at, render: (p) => <span className="whitespace-nowrap">{fmtDate(data.mById.get(p.match_id)?.played_at ?? p.created_at)}</span> },
            { key: 'k', label: 'Abates', sort: (p) => p.kills, render: (p) => <b className="tabular-nums">{p.kills}</b> },
            { key: 'p', label: 'Posição', sort: (p) => p.placement ?? 99, render: (p) => p.placement == null ? <NA /> : `${p.placement}.º` },
            { key: 'g', label: 'Dano', render: (p) => <V v={p.damage} /> },
            { key: 'o', label: 'Origem', render: (p) => <SourceTag s={p.source} /> },
            { key: 's', label: 'Estado', render: (p) => <ValidationBadge s={p.validation_status} /> },
          ]} />
      </Panel>
    </div>
  );
}

// ---------------- Rankings e comparação ----------------
const METRICS: [RankMetric, string][] = [['avgKills', 'Média de abates'], ['kd', 'K/D'], ['winRate', 'Taxa de vitória'], ['kills', 'Total de abates'], ['matches', 'Partidas']];
export function Rankings() {
  const { bundle, arg, go } = useCore();
  const d = bundle.data;
  const [metric, setMetric] = useState<RankMetric>('avgKills');
  const [minM, setMinM] = useState('5');
  const [onlyV, setOnlyV] = useState<'sim' | 'nao'>('sim');
  const rows = useMemo(() => rankPlayers(d, metric, Number(minM), onlyV === 'sim'), [d, metric, minM, onlyV]);
  const [a, setA] = useState(arg && d.players.some((p) => p.id === arg) ? arg : d.players[0]?.id ?? '');
  const [b, setB] = useState(d.players.find((p) => p.id !== a)?.id ?? '');
  const cmp = useMemo(() => {
    if (!a || !b) return null;
    const pa = d.participations.filter((p) => p.player_id === a), pb = d.participations.filter((p) => p.player_id === b);
    const sa = playerStats(pa, d.matches, onlyV === 'sim'), sb = playerStats(pb, d.matches, onlyV === 'sim');
    return { rows: comparePlayers(sa, sb), ca: confidenceFor(playerStats(pa, d.matches)), cb: confidenceFor(playerStats(pb, d.matches)) };
  }, [a, b, d, onlyV]);
  const fmt = (m: string, v: number | null) => v == null ? 'indisponível' : m === 'Taxa de vitória' || m === 'Top 10' ? pct(v) : fmtNum(v);
  const opts = d.players.map((p) => [p.id, p.nickname] as [string, string]);
  const name = (id: string) => d.players.find((p) => p.id === id)?.nickname ?? '—';
  return (
    <div className="space-y-4">
      <Panel title="Ranking de jogadores" sub="Jogadores abaixo da amostra mínima ficam de fora — nada é extrapolado.">
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Select label="Métrica" value={metric} onChange={(v) => setMetric(v as RankMetric)} options={METRICS} />
          <Select label="Mínimo de partidas" value={minM} onChange={setMinM} options={[['1', '1'], ['3', '3'], ['5', '5'], ['10', '10'], ['20', '20']]} />
          <Select label="Linhas" value={onlyV} onChange={(v) => setOnlyV(v as 'sim' | 'nao')} options={[['sim', 'Só verificadas'], ['nao', 'Verificadas + submetidas']]} className="col-span-2 sm:col-span-1" />
        </div>
        <DataTable rowKey={(r) => r.player.id} rows={rows} search={(r) => r.player.nickname} placeholder="Filtrar jogador…"
          empty={<Empty icon="" title="Sem jogadores com amostra suficiente" text="Baixa o mínimo de partidas ou inclui as submetidas." />}
          cols={[
            { key: 'r', label: '#', render: (r) => <span className="font-bold text-neon2">{rows.indexOf(r) + 1}</span> },
            { key: 'n', label: 'Jogador', render: (r) => <button onClick={() => go('perfil', r.player.id)} className="font-semibold hover:underline">{r.player.nickname}</button> },
            { key: 'v', label: METRICS.find((m) => m[0] === metric)![1], sort: (r) => r.value ?? -1, render: (r) => <b className="tabular-nums">{metric === 'winRate' ? pct(r.value) : fmtNum(r.value)}</b> },
            { key: 'm', label: 'Partidas', sort: (r) => r.stats.matches, render: (r) => r.stats.matches },
            { key: 'c', label: 'Confiança', render: (r) => <ConfidenceBadge c={confidenceFor(r.stats).level} /> },
          ]} />
      </Panel>
      <Panel title="Comparar dois jogadores">
        {d.players.length < 2 ? <Empty title="São precisos pelo menos 2 jogadores registados" /> : (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <Select label="Jogador A" value={a} onChange={setA} options={opts} />
              <Select label="Jogador B" value={b} onChange={setB} options={opts} />
            </div>
            {cmp && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-core-line text-left text-[12px] text-white/60"><th className="py-2 pr-2">Métrica</th><th className="px-2 text-right">{name(a)}</th><th className="pl-2 text-right">{name(b)}</th></tr></thead>
                  <tbody>
                    {cmp.rows.map((r) => (
                      <tr key={r.metric} className="border-b border-core-line/50">
                        <td className="py-2 pr-2 text-white/80">{r.metric}</td>
                        <td className={`px-2 text-right tabular-nums ${r.better === 'a' ? 'font-bold text-neon' : r.a == null ? 'text-white/45' : ''}`}>{fmt(r.metric, r.a)}</td>
                        <td className={`pl-2 text-right tabular-nums ${r.better === 'b' ? 'font-bold text-neon' : r.b == null ? 'text-white/45' : ''}`}>{fmt(r.metric, r.b)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-2 flex flex-wrap gap-2 text-[12px]"><span>{name(a)}: <ConfidenceBadge c={cmp.ca.level} /></span><span>{name(b)}: <ConfidenceBadge c={cmp.cb.level} /></span></div>
              </div>
            )}
            <Origin>Comparação feita só com linhas {onlyV === 'sim' ? 'verificadas' : 'verificadas e submetidas'} registadas na TXAPILOG. “indisponível” = não há dados para essa métrica.</Origin>
          </>
        )}
      </Panel>
    </div>
  );
}
