'use client';
// Centro de IA: análises determinísticas (sempre) + resumo opcional por LLM (Edge Function core-ai),
// que recebe apenas linhas reais lidas no servidor e tem de citar os ids. Sem dados → "indisponível".
import React, { useMemo, useState } from 'react';
import { createAlertFromAnomaly, requestAiSummary } from '@/lib/core/repo';
import { detectAnomalies, fmtNum, originBreakdown, playerReport, teamStats, trendFor, type Anomaly } from '@/lib/core/stats';
import { ConfidenceBadge, Empty, Origin, Panel, Segmented, Select, SeverityDot, btn, btnGhost, useAction, useCore, SOURCE_LABEL } from './kit';
import { Icon } from '@/components/icons';

const KIND_LABEL: Record<Anomaly['kind'], string> = {
  kills_outlier: 'Abates fora do padrão', kills_improvavel: 'Valor improvável', team_kills_mismatch: 'Abates não batem certo',
  duplicate_external_id: 'ID duplicado', duplicate_nickname: 'Possível conta duplicada', placement_conflict: 'Posição repetida',
  placement_inconsistent: 'Posição inconsistente', team_overlap: 'Jogador em 2 equipas', submitted_vs_verified: 'Submissões acima do verificado',
};

export default function AiCenter() {
  const { bundle, arg, go } = useCore();
  const d = bundle.data;
  const { busy, run } = useAction();
  const anomalies = useMemo(() => detectAnomalies(d), [d]);
  const open = new Set(bundle.alerts.filter((a) => a.status === 'aberto' || a.status === 'em_revisao').map((a) => `${a.kind}|${a.entity_id}`));
  const [sev, setSev] = useState<'todas' | 'alta' | 'media' | 'baixa'>('todas');
  const list = anomalies.filter((a) => sev === 'todas' || a.severity === sev);
  const trends = useMemo(() => d.players.map((p) => ({ p, t: trendFor(d.participations.filter((x) => x.player_id === p.id), d.matches) })).filter((x) => x.t.direction !== 'indisponivel'), [d]);

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neon text-ink" aria-hidden><Icon name="spark" size={20} /></span>
          <div className="min-w-0 text-sm text-white/80">
            <p className="font-bold text-white">Como funciona o motor</p>
            <p className="mt-0.5">Analisa apenas dados registados e autorizados na TXAPILOG. Os números vêm de cálculos determinísticos sobre as linhas guardadas — a IA generativa só pode <b>resumir</b> esses números e tem de citar as linhas. Nunca inventa partidas, abates, vitórias ou estatísticas: sem dados mostra <i>indisponível</i>. Os sinais são para <b>revisão humana</b>, nunca punição automática.</p>
          </div>
        </div>
      </Panel>

      <Report initial={arg} />

      <Panel title={`Inconsistências e possíveis duplicados (${anomalies.length})`} sub="Regras: IQR por jogador, valores improváveis, IDs/nicknames repetidos, somas de equipa, posições, equipas sobrepostas."
        action={<Segmented label="Severidade" value={sev} onChange={setSev} options={[['todas', 'Todas'], ['alta', 'Alta'], ['media', 'Média'], ['baixa', 'Baixa']]} />}>
        {list.length === 0 ? <Empty icon="" title="Nada a assinalar" text={d.participations.length ? 'Os dados registados não mostram inconsistências com as regras atuais.' : 'Sem dados registados para analisar.'} /> : (
          <ul className="space-y-2">
            {list.map((a, i) => {
              const sent = open.has(`${a.kind}|${a.entity_id}`);
              return (
                <li key={i} className="rounded-xl border border-core-line bg-core-bg/60 p-3">
                  <div className="flex items-start gap-2">
                    <span className="mt-1.5"><SeverityDot s={a.severity} /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-white/55">{KIND_LABEL[a.kind]} · severidade {a.severity}</p>
                      <p className="font-semibold leading-snug">{a.title}</p>
                      <p className="mt-0.5 text-[13px] text-white/70">{a.detail}</p>
                      <details className="mt-1 text-[12px] text-white/55"><summary className="cursor-pointer">{a.evidence.length} linha(s) de evidência</summary><p className="mt-1 break-all font-mono">{a.evidence.join(', ')}</p></details>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {sent ? <span className="rounded-lg bg-white/10 px-3 py-1.5 text-[13px] text-white/70">Já em revisão</span>
                      : <button disabled={busy} className={btnGhost} onClick={() => run(() => createAlertFromAnomaly(a), 'Enviado para revisão humana.')}>Enviar para revisão</button>}
                    {a.entity_type === 'player' && <button className={btnGhost} onClick={() => go('perfil', a.entity_id)}>Ver jogador</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <Origin>Origem: regras determinísticas em lib/core/stats.ts sobre as tabelas core_*. Confiança das regras depende da amostra (ex.: padrão por jogador só com ≥ 8 partidas).</Origin>
      </Panel>

      <Panel title="Tendências" sub="Últimas 5 partidas vs 5 anteriores · só jogadores com ≥ 10 partidas">
        {trends.length ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {trends.sort((a, b) => Math.abs(b.t.deltaKills ?? 0) - Math.abs(a.t.deltaKills ?? 0)).slice(0, 8).map(({ p, t }) => (
              <li key={p.id}><button onClick={() => go('perfil', p.id)} className="flex w-full items-center gap-3 rounded-xl bg-core-bg/60 px-3 py-2 text-left text-sm hover:bg-white/5">
                <span className={`text-lg ${t.direction === 'subida' ? 'text-emerald-300' : t.direction === 'descida' ? 'text-red-300' : 'text-white/60'}`} aria-hidden>{t.direction === 'subida' ? '↑' : t.direction === 'descida' ? '↓' : '→'}</span>
                <span className="min-w-0 flex-1 truncate font-semibold">{p.nickname}</span>
                <span className="tabular-nums text-white/75">{fmtNum(t.previousAvgKills)} → {fmtNum(t.recentAvgKills)}</span>
              </button></li>
            ))}
          </ul>
        ) : <Empty icon="" title="Tendências indisponíveis" text="Nenhum jogador tem 10 partidas registadas." />}
      </Panel>
    </div>
  );
}

function Report({ initial }: { initial: string }) {
  const { bundle } = useCore();
  const d = bundle.data;
  const [scope, setScope] = useState<'player' | 'team'>(d.teams.some((t) => t.id === initial) ? 'team' : 'player');
  const [id, setId] = useState(initial && (d.players.some((p) => p.id === initial) || d.teams.some((t) => t.id === initial)) ? initial : d.players[0]?.id ?? '');
  const [ai, setAi] = useState<{ text?: string; error?: string; citations?: string[]; generator?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const player = scope === 'player' ? d.players.find((p) => p.id === id) : undefined;
  const team = scope === 'team' ? d.teams.find((t) => t.id === id) : undefined;
  const rep = useMemo(() => player ? playerReport(player, d) : null, [player, d]);
  const tRep = useMemo(() => {
    if (!team) return null;
    const s = teamStats(team.id, d.results, d.members);
    const rs = d.results.filter((r) => r.team_id === team.id && r.validation_status !== 'rejeitado');
    const level = !s.matches ? 'indisponivel' : s.verified >= 10 && s.verified / s.matches >= 0.8 ? 'alta' : s.verified >= 3 ? 'media' : 'baixa';
    const lines = !s.matches ? [{ text: `${team.name}: resultados indisponíveis — nenhum resultado registado.`, evidence: [] as string[] }] : [
      { text: `${team.name} (${team.kind}) tem ${s.matches} resultado(s), ${s.verified} verificado(s); ${s.activeMembers} membro(s) ativos.`, evidence: rs.map((r) => r.id) },
      { text: `Vitórias: ${s.wins}; posição média ${fmtNum(s.avgPlacement)}; ${s.kills} abates; ${s.points ?? 'indisponível'} pontos.`, evidence: rs.map((r) => r.id) },
    ];
    return { lines, level: level as 'alta' | 'media' | 'baixa' | 'indisponivel', origin: originBreakdown(rs) };
  }, [team, d]);
  const origin = rep ? originBreakdown(d.participations.filter((p) => p.player_id === id && p.validation_status !== 'rejeitado')) : tRep?.origin;
  const lines = rep?.lines ?? tRep?.lines ?? [];
  const conf = rep?.confidence.level ?? tRep?.level ?? 'indisponivel';

  const gen = async () => { setLoading(true); setAi(null); try { setAi(await requestAiSummary(scope, id)); } finally { setLoading(false); } };
  const opts = (scope === 'player' ? d.players.map((p) => [p.id, p.nickname]) : d.teams.map((t) => [t.id, t.name])) as [string, string][];

  return (
    <Panel title="Relatório automático" sub="Resumo de jogador ou equipa com origem e nível de confiança">
      <div className="mb-3 grid gap-2 sm:grid-cols-[auto_1fr_auto] sm:items-end">
        <Segmented label="Âmbito" value={scope} onChange={(v) => { setScope(v); setId(v === 'player' ? d.players[0]?.id ?? '' : d.teams[0]?.id ?? ''); setAi(null); }} options={[['player', 'Jogador'], ['team', 'Equipa']]} />
        <Select label={scope === 'player' ? 'Jogador' : 'Equipa'} value={id} onChange={(v) => { setId(v); setAi(null); }} options={opts.length ? opts : [['', '— sem registos —']]} />
        <button className={btn} onClick={gen} disabled={!id || loading}>{loading ? 'A gerar…' : 'Resumo com IA'}</button>
      </div>
      {!id ? <Empty title="Sem registos para analisar" /> : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2"><ConfidenceBadge c={conf} /><span className="text-[12px] text-white/60">Gerador: determinístico (cálculo direto)</span></div>
          <ul className="space-y-1.5 text-sm">
            {lines.map((l, i) => <li key={i} className="flex gap-2"><span className="text-neon" aria-hidden>•</span><span className="min-w-0 flex-1">{l.text}{l.evidence.length > 0 && <span className="ml-1 whitespace-nowrap text-[11px] text-white/50">[{l.evidence.length} linha{l.evidence.length === 1 ? '' : 's'}]</span>}</span></li>)}
          </ul>
          {ai && (
            <div className={`mt-3 rounded-xl border p-3 text-sm ${ai.text ? 'border-neon/50 bg-neon/5' : 'border-core-line bg-core-bg/60 text-white/75'}`}>
              {ai.text ? (<><p className="mb-1 text-[12px] font-semibold text-neon2">Resumo com IA · {ai.generator} · cita {ai.citations?.length ?? 0} linha(s) reais</p><p className="whitespace-pre-wrap">{ai.text}</p></>) : <p>{ai.error}</p>}
            </div>
          )}
          <Origin>
            Origem: {origin && origin.total ? (Object.entries(origin.bySource).filter(([, n]) => n > 0).map(([k, n]) => `${n} × ${SOURCE_LABEL[k as keyof typeof SOURCE_LABEL]}`).join(', ')) : 'sem linhas registadas'}.
            {' '}Estatísticas oficiais Garena: indisponível (sem fonte autorizada). {rep?.confidence.reasons.join(' ')}
          </Origin>
        </>
      )}
    </Panel>
  );
}
