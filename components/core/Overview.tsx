'use client';
import React, { useMemo, useState } from 'react';
import { Bars, LineChart } from '@/components/Charts';
import { detectAnomalies, matchesPerDay, originBreakdown, rankPlayers, fmtNum, timeAgo } from '@/lib/core/stats';
import { setAlertStatus, type CoreAlert } from '@/lib/core/repo';
import { Empty, Origin, Panel, Segmented, SeverityDot, StatCard, Updated, ValidationBadge, can, fmtDate, useAction, useCore, SOURCE_LABEL, btnGhost } from './kit';

export default function Overview() {
  const { bundle, go } = useCore();
  const d = bundle.data;
  const now = bundle.loadedAt;
  const m = useMemo(() => {
    const recent = d.matches.filter((x) => x.validation_status !== 'rejeitado' && now - new Date(x.played_at).getTime() < 30 * 864e5);
    const pending = d.participations.filter((p) => p.validation_status === 'submetido').length + d.results.filter((r) => r.validation_status === 'submetido').length;
    const anomalies = detectAnomalies(d);
    const alerted = new Set(bundle.alerts.filter((a) => a.status === 'aberto' || a.status === 'em_revisao').map((a) => `${a.kind}|${a.entity_id}`));
    return {
      recent, pending, anomalies, newAnomalies: anomalies.filter((a) => !alerted.has(`${a.kind}|${a.entity_id}`)),
      verifiedIds: d.externalIds.filter((e) => e.status === 'verificado').length,
      pendingIds: d.externalIds.filter((e) => e.status === 'pendente').length,
      openAlerts: bundle.alerts.filter((a) => a.status === 'aberto'),
      activeTours: d.tournaments.filter((t) => t.status === 'a_decorrer' || t.status === 'inscricoes'),
      series: matchesPerDay(d.matches, 14, new Date(now)),
      origin: originBreakdown(d.participations),
      top: rankPlayers(d, 'avgKills', 5, true).slice(0, 5),
      lastMatch: d.matches.reduce<string | null>((a, x) => (!a || x.played_at > a ? x.played_at : a), null),
    };
  }, [d, bundle.alerts, now]);
  const inactive = 2; // fontes oficiais/externas sem autorização (ver Auditoria e integrações)

  if (!d.players.length && !d.matches.length) return (
    <Panel title="Ainda sem dados">
      <Empty icon="" title="Nenhum jogador ou partida registados na TXAPILOG"
        text="O AI CORE só mostra dados reais: jogadores registados, partidas de torneios TXAPILOG e submissões dos jogadores. Regista o primeiro jogador ou cria um torneio para começar."
        action={<div className="flex flex-wrap justify-center gap-2"><button className={btnGhost} onClick={() => go('pesquisa')}>Registar jogador</button><button className={btnGhost} onClick={() => go('torneios')}>Criar torneio</button></div>} />
    </Panel>
  );

  const o = m.origin;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Jogadores registados" value={d.players.length} sub={`${d.verifications.length} perfis verificados`} onClick={() => go('perfil')} />
        <StatCard label="IDs Free Fire verificados" value={`${m.verifiedIds}/${d.externalIds.length}`} sub={`${m.pendingIds} pendentes`} tone={m.pendingIds ? 'warn' : 'default'} onClick={() => go('pesquisa')} />
        <StatCard label="Partidas · 30 dias" value={m.recent.length} sub={m.lastMatch ? `última ${timeAgo(m.lastMatch, now)}` : 'sem partidas'} onClick={() => go('historico')} />
        <StatCard label="Por verificar" value={m.pending} sub="resultados submetidos" tone={m.pending ? 'warn' : 'good'} onClick={() => go('historico', 'submetido')} />
        <StatCard label="Alertas abertos" value={m.openAlerts.length} sub={`${m.newAnomalies.length} sinais novos da IA`} tone={m.openAlerts.some((a) => a.severity === 'alta') ? 'bad' : m.openAlerts.length ? 'warn' : 'good'} onClick={() => go('notificacoes')} />
        <StatCard label="Torneios ativos" value={m.activeTours.length} sub={`${d.teams.length} equipas`} onClick={() => go('torneios')} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="Partidas registadas por dia" sub="Últimos 14 dias · exclui rejeitadas" action={<Updated at={bundle.loadedAt} />}>
          <LineChart data={m.series} height={150} />
          <Origin>Contagem direta de <code>core_matches.played_at</code>. Só partidas registadas na TXAPILOG — sem estimativas.</Origin>
        </Panel>
        <Panel title="Indicadores que pedem atenção">
          <ul className="space-y-2 text-sm">
            <Attention n={m.pending} text="resultados submetidos aguardam verificação" onClick={() => go('historico', 'submetido')} tone="warn" />
            <Attention n={m.openAlerts.filter((a) => a.severity === 'alta').length} text="alertas de severidade alta abertos" onClick={() => go('notificacoes')} tone="bad" />
            <Attention n={m.newAnomalies.length} text="inconsistências detetadas ainda sem revisão" onClick={() => go('ia')} tone="warn" />
            <Attention n={m.pendingIds} text="IDs Free Fire por confirmar" onClick={() => go('pesquisa')} tone="warn" />
            <Attention n={inactive} text="fontes externas não configuradas (sem fonte autorizada)" onClick={() => go('auditoria')} tone="info" />
          </ul>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Estado de validação das participações" sub={`${o.total} linhas`}>
          {o.total ? (
            <>
              <div className="flex h-3 overflow-hidden rounded-full bg-core-bg" role="img" aria-label={`Verificadas ${o.byStatus.verificado}, submetidas ${o.byStatus.submetido}, rejeitadas ${o.byStatus.rejeitado}`}>
                <span className="bg-emerald-400" style={{ width: `${(o.byStatus.verificado / o.total) * 100}%` }} />
                <span className="bg-neon" style={{ width: `${(o.byStatus.submetido / o.total) * 100}%` }} />
                <span className="bg-red-500" style={{ width: `${(o.byStatus.rejeitado / o.total) * 100}%` }} />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                <span><b>{o.byStatus.verificado}</b> verificadas</span><span><b>{o.byStatus.submetido}</b> submetidas · não verificadas</span><span><b>{o.byStatus.rejeitado}</b> rejeitadas</span>
              </div>
              <div className="mt-4"><Bars data={(Object.keys(o.bySource) as (keyof typeof o.bySource)[]).map((k) => ({ label: SOURCE_LABEL[k], value: o.bySource[k] }))} /></div>
            </>
          ) : <Empty title="Sem participações registadas" />}
          <Origin>Origem de cada linha guardada em <code>source</code>; estatísticas oficiais da Garena: indisponível (sem fonte autorizada).</Origin>
        </Panel>
        <Panel title="Top 5 · média de abates" sub="Só partidas verificadas · mínimo 5" action={<button onClick={() => go('rankings')} className="text-sm text-neon2">Ver rankings</button>}>
          {m.top.length ? (
            <ol className="space-y-1.5">
              {m.top.map((r, i) => (
                <li key={r.player.id}>
                  <button onClick={() => go('perfil', r.player.id)} className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-white/5">
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${i === 0 ? 'bg-neon text-ink' : 'bg-core-panel2'}`}>{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{r.player.nickname}</span>
                    <span className="tabular-nums font-bold">{fmtNum(r.value)}</span>
                    <span className="w-16 text-right text-[12px] text-white/55">{r.stats.matches} part.</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : <Empty icon="" title="Amostra insuficiente" text="Nenhum jogador tem 5 partidas verificadas. O ranking aparece quando houver dados suficientes." />}
        </Panel>
      </div>

      <Panel title="Últimas partidas" action={<button onClick={() => go('historico')} className="text-sm text-neon2">Histórico completo</button>}>
        {d.matches.length ? (
          <ul className="divide-y divide-core-line/60">
            {d.matches.slice().sort((a, b) => b.played_at.localeCompare(a.played_at)).slice(0, 5).map((x) => {
              const t = d.tournaments.find((t) => t.id === x.tournament_id);
              return (
                <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{t ? `${t.name} · ${x.round_label ?? ''}` : 'Partida avulsa'} <span className="text-white/55">· {x.map ?? 'mapa indisponível'}</span></span>
                  <span className="text-[12px] text-white/60">{fmtDate(x.played_at)}</span>
                  <ValidationBadge s={x.validation_status} />
                </li>
              );
            })}
          </ul>
        ) : <Empty title="Sem partidas registadas" />}
      </Panel>
    </div>
  );
}

function Attention({ n, text, onClick, tone }: { n: number; text: string; onClick: () => void; tone: 'warn' | 'bad' | 'info' }) {
  const c = n === 0 ? 'bg-emerald-400/90 text-ink' : tone === 'bad' ? 'bg-red-500 text-white' : tone === 'warn' ? 'bg-neon text-ink' : 'bg-white/15 text-white';
  return (
    <li>
      <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl px-1 py-1 text-left hover:bg-white/5">
        <span className={`flex h-7 min-w-[28px] items-center justify-center rounded-lg px-1.5 text-sm font-bold ${c}`}>{n}</span>
        <span className="min-w-0 flex-1 text-white/85">{text}</span><span aria-hidden className="text-white/40">›</span>
      </button>
    </li>
  );
}

const ALERT_STATUS: Record<CoreAlert['status'], string> = { aberto: 'Aberto', em_revisao: 'Em revisão', resolvido: 'Resolvido', descartado: 'Descartado' };

export function Notifications() {
  const { bundle, role, go } = useCore();
  const { busy, run } = useAction();
  const [f, setF] = useState<'ativos' | 'todos' | 'resolvidos'>('ativos');
  const d = bundle.data;
  const alerts = bundle.alerts.filter((a) => f === 'todos' ? true : f === 'ativos' ? a.status === 'aberto' || a.status === 'em_revisao' : a.status === 'resolvido' || a.status === 'descartado');
  const pendP = d.participations.filter((p) => p.validation_status === 'submetido');
  const pendR = d.results.filter((r) => r.validation_status === 'submetido');
  const pendIds = d.externalIds.filter((e) => e.status === 'pendente');
  const soon = d.tournaments.filter((t) => t.starts_at && t.status !== 'cancelado' && t.status !== 'terminado' && new Date(t.starts_at).getTime() > bundle.loadedAt && new Date(t.starts_at).getTime() - bundle.loadedAt < 7 * 864e5);
  return (
    <div className="space-y-4">
      <Panel title="Pendentes" sub="Gerado a partir dos registos atuais">
        <ul className="space-y-2 text-sm">
          {pendP.length + pendR.length > 0 && <Notice icon="" text={`${pendP.length} participação(ões) e ${pendR.length} resultado(s) de equipa: Submetido · não verificado`} cta="Verificar" onClick={() => go('historico', 'submetido')} />}
          {pendIds.length > 0 && <Notice icon="" text={`${pendIds.length} ID(s) Free Fire por confirmar`} cta="Ver" onClick={() => go('pesquisa')} />}
          {soon.map((t) => <Notice key={t.id} icon="" text={`${t.name} começa ${fmtDate(t.starts_at)}`} cta="Abrir" onClick={() => go('torneios', t.id)} />)}
          {pendP.length + pendR.length + pendIds.length + soon.length === 0 && <li className="text-white/65">Nada pendente.</li>}
        </ul>
      </Panel>
      <Panel title="Alertas para revisão humana" sub="Criados pelo motor de IA, pelo sistema ou por utilizadores. Um alerta não é uma acusação: é um pedido de verificação."
        action={<Segmented label="Filtrar alertas" value={f} onChange={setF} options={[['ativos', 'Ativos'], ['resolvidos', 'Fechados'], ['todos', 'Todos']]} />}>
        {alerts.length === 0 ? <Empty icon="" title="Sem alertas neste filtro" text="Os sinais detetados pelo motor aparecem no Centro de IA; envia-os para revisão a partir de lá." action={<button className={btnGhost} onClick={() => go('ia')}>Abrir Centro de IA</button>} /> : (
          <ul className="space-y-2">
            {alerts.map((a) => (
              <li key={a.id} className="rounded-xl border border-core-line bg-core-bg/60 p-3">
                <div className="flex items-start gap-2">
                  <span className="mt-1.5"><SeverityDot s={a.severity} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold leading-snug">{a.title}</p>
                    {a.detail && <p className="mt-0.5 text-[13px] text-white/70">{a.detail}</p>}
                    <p className="mt-1 text-[12px] text-white/55">{ALERT_STATUS[a.status]} · origem: {a.origin === 'motor_ia' ? 'motor de IA (regras determinísticas)' : a.origin} · {a.evidence.length} evidência(s) · {timeAgo(a.created_at)}</p>
                  </div>
                </div>
                {can(role, 'rever_alertas') && (a.status === 'aberto' || a.status === 'em_revisao') && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {a.status === 'aberto' && <button disabled={busy} className={btnGhost} onClick={() => run(() => setAlertStatus(a.id, 'em_revisao'), 'Alerta em revisão.')}>Em revisão</button>}
                    <button disabled={busy} className={btnGhost} onClick={() => run(() => setAlertStatus(a.id, 'resolvido'), 'Alerta resolvido.')}>Resolver</button>
                    <button disabled={busy} className={btnGhost} onClick={() => run(() => setAlertStatus(a.id, 'descartado'), 'Alerta descartado.')}>Descartar</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Notice({ icon, text, cta, onClick }: { icon?: React.ReactNode; text: string; cta: string; onClick: () => void }) {
  return (
    <li className="flex items-center gap-3 rounded-xl bg-core-bg/60 px-3 py-2">
      {icon && <span aria-hidden>{icon}</span>}<span className="min-w-0 flex-1">{text}</span>
      <button onClick={onClick} className="shrink-0 rounded-lg bg-white/10 px-3 py-1.5 text-[13px]">{cta}</button>
    </li>
  );
}
