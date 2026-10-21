'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DISPUTE_STEPS, PRE_MATCH, STATUS_LABEL, cancelAllowed } from '@/lib/competitive';
import type { Pick } from '@/lib/competitive';
import { compApi } from '@/lib/competitiveApi';
import type { ChallengeView, EventView, TeamView } from '@/lib/competitiveApi';
import { IS_DEMO } from '@/lib/config';
import { DEFAULT_SETTINGS } from '@/lib/bets';
import { betsApi } from '@/lib/betsApi';
import { STAKE_ERR, validateStake } from '@/lib/affiliates';
import { uploadPhoto } from '@/lib/media';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { Sheet, Tabs } from '@/components/ui';
import { TeamBadge } from '@/components/TeamBadge';
import { ChallengeCard, DemoNote, Empty, ExampleTag, Field, Shortcuts, Skel, StatusBadge, Unavailable, fmtDate, useMe, useRun } from './Kit';

const F = ['Abertos', 'Os meus', 'Todos'] as const;
type Fl = (typeof F)[number];
const key = (f: Fl) => (f === 'Abertos' ? 'abertos' : f === 'Os meus' ? 'meus' : 'todos') as 'abertos' | 'meus' | 'todos';

export default function ChallengesArea({ initial }: { initial: { f?: string | null; criar?: boolean; equipa?: string | null; adversario?: string | null } }) {
  const [f, setF] = useState<Fl>(initial.f === 'meus' ? 'Os meus' : initial.f === 'todos' ? 'Todos' : 'Abertos');
  const [list, setList] = useState<ChallengeView[] | null>(null);
  const [create, setCreate] = useState(!!initial.criar);
  const need = useRequireAuth();
  const load = useCallback(async () => { setList(null); await compApi.sweep().catch(() => undefined); setList(await compApi.challenges(key(f)).catch(() => [])); }, [f]);
  useEffect(() => { void load(); }, [load]);
  return (
    <>
      <DemoNote />
      <Shortcuts />
      <div className="hud-card mb-4 flex flex-wrap items-center gap-3 p-5">
        <div className="min-w-0 flex-1">
          <p className="font-display text-2xl font-bold">Desafios entre equipas</p>
          <p className="mt-1 text-sm text-white/75">Desafia uma equipa ou publica um desafio aberto. Os dois capitães confirmam o resultado; se não coincidir, abre-se disputa e a equipa TxapZone decide.</p>
        </div>
        <button type="button" className="btn" onClick={() => need(() => setCreate(true))}>Criar desafio</button>
      </div>
      <Tabs tabs={F} value={f} onChange={setF} />
      {!list ? <Skel /> : list.length === 0 ? <Empty>{f === 'Os meus' ? 'Ainda não tens desafios. Cria uma equipa e desafia outra!' : 'Sem desafios por agora.'}</Empty>
        : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{list.map((c) => <ChallengeCard key={c.id} c={c} />)}</div>}
      <CreateChallengeSheet open={create} onClose={() => setCreate(false)} teamId={initial.equipa ?? null} opponentId={initial.adversario ?? null} />
    </>
  );
}

function CreateChallengeSheet({ open, onClose, teamId, opponentId }: { open: boolean; onClose: () => void; teamId: string | null; opponentId: string | null }) {
  const [mine, setMine] = useState<(TeamView & { canManage: boolean })[]>([]);
  const [opps, setOpps] = useState<TeamView[]>([]);
  const [f, setF] = useState({ team: teamId ?? '', opponent: opponentId ?? '', open: false, title: '', rules: '', players: 1, bestOf: 1, date: '' });
  const [idem] = useState(() => compApi.newIdem());
  const [busy, setBusy] = useState(false);
  const run = useRun();
  const router = useRouter();
  useEffect(() => {
    if (!open) return;
    void compApi.myTeams().then((m) => { const ok = m.filter((t) => t.canManage); setMine(ok); setF((x) => ({ ...x, team: x.team || ok[0]?.id || '' })); });
  }, [open]);
  const myTeam = mine.find((t) => t.id === f.team);
  useEffect(() => { if (myTeam) void compApi.teams({ game: myTeam.game }).then((l) => setOpps(l.filter((t) => t.id !== myTeam.id))); }, [myTeam]);
  return (
    <Sheet open={open} onClose={onClose} title="Criar desafio">
      {mine.length === 0 ? (
        <div className="space-y-3 text-sm"><p>Precisas de ser capitão (ou vice com permissão) de uma equipa.</p><Link className="btn w-full" href="/equipas?criar=1">Criar equipa</Link></div>
      ) : (
        <div className="space-y-3">
          <Field label="A minha equipa"><select className="input" value={f.team} onChange={(e) => setF({ ...f, team: e.target.value })}>{mine.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.game}</option>)}</select></Field>
          <div className="flex gap-2">
            <button type="button" aria-pressed={!f.open} className={`chip flex-1 ${!f.open ? '!bg-neon !text-ink' : ''}`} onClick={() => setF({ ...f, open: false })}>Escolher adversário</button>
            <button type="button" aria-pressed={f.open} className={`chip flex-1 ${f.open ? '!bg-neon !text-ink' : ''}`} onClick={() => setF({ ...f, open: true, opponent: '' })}>Desafio aberto</button>
          </div>
          {!f.open && <Field label={`Adversário (${myTeam?.game ?? ''})`}><select className="input" value={f.opponent} onChange={(e) => setF({ ...f, opponent: e.target.value })}><option value="">Escolhe…</option>{opps.map((t) => <option key={t.id} value={t.id}>{t.name} · Elo {Math.round(t.rating)}</option>)}</select></Field>}
          <Field label="Título (opcional)"><input className="input" maxLength={80} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Regras" hint="Modo, mapa, tempo, o que conta como prova."><textarea className="input min-h-[80px]" maxLength={2000} value={f.rules} onChange={(e) => setF({ ...f, rules: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Jogadores por equipa"><input type="number" min={1} max={11} className="input" value={f.players} onChange={(e) => setF({ ...f, players: Number(e.target.value) })} /></Field>
            <Field label="Melhor de"><select className="input" value={f.bestOf} onChange={(e) => setF({ ...f, bestOf: Number(e.target.value) })}>{[1, 3, 5, 7].map((n) => <option key={n}>{n}</option>)}</select></Field>
          </div>
          <Field label="Data e hora (Maputo)" hint="Opcional agora; pode ser combinada depois de aceite."><input type="datetime-local" className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <button type="button" className="btn w-full" disabled={busy || !f.team || (!f.open && !f.opponent)} onClick={async () => {
            setBusy(true);
            const r = await run(compApi.createChallenge({ teamId: f.team, opponentId: f.open ? null : f.opponent, title: f.title, rules: f.rules, players: f.players, bestOf: f.bestOf,
              scheduledAt: f.date ? new Date(f.date).toISOString() : null, publish: true, idem }), f.open ? 'Desafio aberto publicado' : 'Desafio enviado');
            setBusy(false);
            if (r) router.push(`/desafios/evento?id=${encodeURIComponent(r.challengeId)}`);
          }}>{f.open ? 'Publicar desafio aberto' : 'Enviar desafio'}</button>
        </div>
      )}
    </Sheet>
  );
}

const ACTION_LABEL: Record<string, string> = {
  criar: 'Desafio criado', publicar_aberto: 'Publicado como desafio aberto', enviar_desafio: 'Desafio enviado', aceitar: 'Desafio aceite', recusar: 'Desafio recusado',
  agendar: 'Agendado', iniciar: 'Jogo iniciado', iniciar_automatico: 'Jogo iniciado (hora marcada)', resultado_submetido: 'Resultado submetido', resultado_confirmado: 'Resultado confirmado pelas duas equipas',
  resultados_divergentes: 'Resultados não coincidem — disputa aberta', disputa_aberta: 'Disputa aberta', provas_adicionadas: 'Provas adicionadas', admin_analisar: 'Em análise pela equipa TxapZone',
  admin_resolver: 'Resultado decidido pela equipa TxapZone', admin_anular: 'Anulado pela equipa TxapZone', resultado_verificado: 'Resultado verificado', cancelar: 'Cancelado', expirar: 'Expirou',
  sem_resultado: 'Sem resultado no prazo — em análise', confirmacao_em_falta: 'Falta a confirmação do adversário — em análise', mercado_aberto: 'Confirmado — à espera do início',
};

export function EventPage({ id }: { id: string }) {
  const [v, setV] = useState<EventView | null | undefined>(undefined);
  const [sheet, setSheet] = useState<'' | 'result' | 'dispute' | 'schedule' | 'accept' | 'bet'>('');
  const me = useMe();
  const run = useRun();
  const need = useRequireAuth();
  const load = useCallback(async () => { await compApi.sweep().catch(() => undefined); setV(await compApi.event(id).catch(() => null)); }, [id]);
  useEffect(() => { void load(); }, [load]);
  const now = Date.now();
  const myTeam = useMemo(() => (v?.canManageChallenger ? v.challenge.challenger.id : v?.canManageOpponent ? v.challenge.opponent?.id ?? null : null), [v]);
  if (v === undefined) return <Skel />;
  if (!v) return <Empty>Desafio não encontrado.</Empty>;
  const c = v.challenge;
  const side = v.canManageChallenger ? 'challenger' : v.canManageOpponent ? 'opponent' : 'none';
  const canCancel = cancelAllowed(c.status, side, c.scheduledAt, 2, now);
  const mySub = v.submissions.find((s) => s.teamId === myTeam);
  const predOpen = PRE_MATCH.includes(c.status) && (!c.scheduledAt || Date.parse(c.scheduledAt) > now);
  const totalPred = v.predictions.challenger + v.predictions.draw + v.predictions.opponent;
  const pct = (n: number) => (totalPred ? Math.round((n / totalPred) * 100) : 0);
  const share = async () => {
    const url = window.location.href;
    try { if (navigator.share) await navigator.share({ title: `${c.challenger.name} vs ${c.opponent?.name ?? '?'}`, url }); else { await navigator.clipboard.writeText(url); alert('Link copiado'); } } catch { /* cancelado */ }
  };
  return (
    <>
      <DemoNote />
      <article className="hud-card mb-4 p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-white/75">
          <span className="font-semibold text-neon2">{c.game}</span><span>·</span><span>{fmtDate(c.scheduledAt)}</span>
          <span className="ml-auto flex gap-1.5">{c.example && <ExampleTag />}<StatusBadge s={c.status} /></span>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/equipas/equipa?id=${encodeURIComponent(c.challenger.id)}`} className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
            <TeamBadge name={c.challenger.name} logo={c.challenger.logo} size={64} /><span className="w-full truncate font-bold">{c.challenger.name}</span>
            <span className="text-xs text-white/60">Elo {Math.round(v.challengerTeam.rating)} · {v.challengerTeam.wins}V {v.challengerTeam.losses}D</span>
          </Link>
          <span className="stat-num shrink-0 text-3xl">{c.status === 'COMPLETED' ? `${c.challengerScore} - ${c.opponentScore}` : 'VS'}</span>
          {c.opponent && v.opponentTeam ? (
            <Link href={`/equipas/equipa?id=${encodeURIComponent(c.opponent.id)}`} className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
              <TeamBadge name={c.opponent.name} logo={c.opponent.logo} size={64} /><span className="w-full truncate font-bold">{c.opponent.name}</span>
              <span className="text-xs text-white/60">Elo {Math.round(v.opponentTeam.rating)} · {v.opponentTeam.wins}V {v.opponentTeam.losses}D</span>
            </Link>
          ) : <div className="flex flex-1 flex-col items-center gap-2 text-center"><span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-2xl">?</span><span className="font-bold">Desafio aberto</span></div>}
        </div>
        {c.title && <p className="mt-4 text-center font-semibold">{c.title}</p>}
        {c.status === 'COMPLETED' && <p className="mt-2 text-center text-xs text-white/65">{c.resultSource === 'admin' ? 'Resultado decidido pela equipa TxapZone' : 'Resultado confirmado pelos dois capitães'}{c.resultVerifiedAt ? ' · verificado' : ''}</p>}
        {c.status === 'CANCELLED' && c.cancelReason && <p className="mt-2 text-center text-xs text-white/65">Motivo: {c.cancelReason}</p>}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {c.status === 'PENDING_ACCEPTANCE' && v.canManageOpponent && <>
            <button type="button" className="btn" onClick={async () => { if (await run(compApi.respond(c.id, true, null), 'Desafio aceite')) void load(); }}>Aceitar</button>
            <button type="button" className="btn-ghost" onClick={async () => { const r = window.prompt('Motivo da recusa (opcional)') ?? ''; if (await run(compApi.respond(c.id, false, null, r), 'Desafio recusado')) void load(); }}>Recusar</button>
          </>}
          {c.status === 'OPEN' && !v.canManageChallenger && <button type="button" className="btn" onClick={() => need(() => setSheet('accept'))}>Aceitar com a minha equipa</button>}
          {c.status === 'ACCEPTED' && side !== 'none' && <button type="button" className="btn" onClick={() => setSheet('schedule')}>Marcar data</button>}
          {c.status === 'SCHEDULED' && side !== 'none' && c.scheduledAt && Date.parse(c.scheduledAt) <= now + 15 * 60e3 && <button type="button" className="btn" onClick={async () => { if (await run(compApi.start(c.id), 'Jogo iniciado')) void load(); }}>Iniciar jogo</button>}
          {(c.status === 'IN_PROGRESS' || c.status === 'PENDING_RESULT') && myTeam && !mySub && <button type="button" className="btn" onClick={() => setSheet('result')}>Submeter resultado</button>}
          {['PENDING_RESULT', 'DISPUTED', 'UNDER_REVIEW'].includes(c.status) && myTeam && <button type="button" className="btn-ghost" onClick={() => setSheet('dispute')}>{c.status === 'PENDING_RESULT' ? 'Abrir disputa' : 'Adicionar provas'}</button>}
          {canCancel && <button type="button" className="btn-ghost" onClick={async () => { const r = window.prompt('Motivo do cancelamento'); if (r != null && await run(compApi.cancel(c.id, r), 'Desafio cancelado')) void load(); }}>Cancelar</button>}
          <button type="button" className="btn-ghost" onClick={share}>Partilhar</button>
        </div>
      </article>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <p className="mb-2 font-bold">Regras</p>
          <p className="whitespace-pre-wrap text-sm text-white/80">{c.rules || 'Sem regras adicionais.'}</p>
          <p className="mt-3 text-xs text-white/60">{c.playersPerTeam} jogador(es) por equipa · melhor de {c.bestOf}</p>
        </section>

        <section className="card">
          <p className="mb-1 font-bold">Previsões grátis</p>
          <p className="mb-3 text-xs text-white/60">Só por diversão — sem dinheiro, sem prémios em dinheiro.</p>
          <div className="space-y-2">
            {([['challenger', c.challenger.name, v.predictions.challenger], ['draw', 'Empate', v.predictions.draw], ['opponent', c.opponent?.name ?? 'Adversário', v.predictions.opponent]] as [Pick, string, number][]).map(([k, l, n]) => (
              <button key={k} type="button" disabled={!predOpen || !c.opponent} onClick={() => need(async () => { if (await run(compApi.predict(c.id, k), 'Previsão guardada')) void load(); })}
                className={`relative flex min-h-[44px] w-full items-center overflow-hidden rounded-[12px] bg-panel2 px-3 text-left text-sm ring-1 ring-inset ${v.myPrediction === k ? 'ring-neon' : 'ring-white/10'} disabled:opacity-70`}>
                <span className="absolute inset-y-0 left-0 bg-neon/20" style={{ width: `${pct(n)}%` }} aria-hidden />
                <span className="relative flex-1 truncate">{l}{v.myPrediction === k ? ' ✓' : ''}</span><span className="relative font-bold">{pct(n)}%</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-white/55">{totalPred} previsão(ões){!predOpen ? ' · fechadas' : ''}</p>
        </section>

        <section className="card">
          <p className="mb-2 font-bold">Histórico</p>
          <ol className="space-y-2 border-l border-line pl-4">
            {v.events.map((e, i) => (
              <li key={i} className="relative text-sm">
                <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-neon" aria-hidden />
                <span className="font-semibold">{ACTION_LABEL[e.action] ?? e.action}</span>
                {e.to && e.from !== e.to && <span className="text-white/60"> → {STATUS_LABEL[e.to as keyof typeof STATUS_LABEL] ?? e.to}</span>}
                <span className="block text-xs text-white/50">{fmtDate(e.at)}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[11px] text-white/45">Histórico imutável, registado no servidor.</p>
        </section>

        {(v.submissions.length > 0 || v.disputes.length > 0) && (
          <section className="card lg:col-span-2">
            <p className="mb-2 font-bold">Resultados submetidos e disputas</p>
            <ul className="space-y-1 text-sm">
              {v.submissions.map((s) => <li key={s.teamId}>📝 {s.teamId === c.challenger.id ? c.challenger.name : c.opponent?.name}: <b>{s.challengerScore} - {s.opponentScore}</b>{s.proofs.length ? ` · ${s.proofs.length} prova(s)` : ''}</li>)}
              {v.disputes.map((d) => <li key={d.id}>⚖️ {d.reason} · <b>{d.status}</b>{d.resolution ? ` — ${d.resolution}` : ''}{d.evidence.length ? ` · ${d.evidence.length} prova(s)` : ''}</li>)}
            </ul>
            {v.submissions.flatMap((s) => s.proofs).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">{v.submissions.flatMap((s) => s.proofs).concat(v.disputes.flatMap((d) => d.evidence)).map((u) => (
                // eslint-disable-next-line @next/next/no-img-element
                <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="Prova" className="h-20 w-20 rounded-lg object-cover" /></a>))}
              </div>
            )}
          </section>
        )}

        <section className="card lg:col-span-2">
          <p className="mb-2 font-bold">Como funcionam as disputas</p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-white/80">{DISPUTE_STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
        </section>
      </div>

      <ResultSheet open={sheet === 'result'} onClose={() => setSheet('')} v={v} team={myTeam} meId={me?.id ?? null} onDone={() => { setSheet(''); void load(); }} />
      <DisputeSheet open={sheet === 'dispute'} onClose={() => setSheet('')} v={v} team={myTeam} meId={me?.id ?? null} onDone={() => { setSheet(''); void load(); }} />
      <ScheduleSheet open={sheet === 'schedule'} onClose={() => setSheet('')} id={c.id} onDone={() => { setSheet(''); void load(); }} />
      <AcceptOpenSheet open={sheet === 'accept'} onClose={() => setSheet('')} c={c} onDone={() => { setSheet(''); void load(); }} />
    </>
  );
}

async function uploadProofs(files: FileList | null, meId: string | null): Promise<string[]> {
  if (!files) return [];
  const out: string[] = [];
  for (const f of Array.from(files).slice(0, 5)) out.push(await uploadPhoto(f, `proofs/${IS_DEMO ? 'demo' : meId ?? 'anon'}`));
  return out;
}

function ResultSheet({ open, onClose, v, team, meId, onDone }: { open: boolean; onClose: () => void; v: EventView; team: string | null; meId: string | null; onDone: () => void }) {
  const [cs, setCs] = useState(0); const [os, setOs] = useState(0); const [proofs, setProofs] = useState<string[]>([]); const [busy, setBusy] = useState(false);
  const run = useRun();
  return (
    <Sheet open={open} onClose={onClose} title="Submeter resultado">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={v.challenge.challenger.name}><input type="number" min={0} max={999} className="input" value={cs} onChange={(e) => setCs(Number(e.target.value))} /></Field>
          <Field label={v.challenge.opponent?.name ?? ''}><input type="number" min={0} max={999} className="input" value={os} onChange={(e) => setOs(Number(e.target.value))} /></Field>
        </div>
        <Field label="Provas (capturas, até 5)"><input type="file" accept="image/*" multiple className="text-sm" onChange={async (e) => { try { setProofs(await uploadProofs(e.target.files, meId)); } catch (err) { alert((err as Error).message); } }} /></Field>
        {proofs.length > 0 && <p className="text-xs text-white/65">{proofs.length} prova(s) pronta(s)</p>}
        <p className="text-xs text-white/60">Depois de submetido não pode ser alterado. Se o adversário submeter outro resultado, abre-se uma disputa.</p>
        <button type="button" className="btn w-full" disabled={!team || busy} onClick={async () => { setBusy(true); const r = await run(compApi.submitResult(v.challenge.id, team!, cs, os, proofs), 'Resultado submetido'); setBusy(false); if (r) onDone(); }}>Confirmar {cs} - {os}</button>
      </div>
    </Sheet>
  );
}
function DisputeSheet({ open, onClose, v, team, meId, onDone }: { open: boolean; onClose: () => void; v: EventView; team: string | null; meId: string | null; onDone: () => void }) {
  const [reason, setReason] = useState(''); const [ev, setEv] = useState<string[]>([]);
  const run = useRun();
  return (
    <Sheet open={open} onClose={onClose} title={v.challenge.status === 'PENDING_RESULT' ? 'Abrir disputa' : 'Adicionar provas'}>
      <div className="space-y-3">
        <Field label="Motivo"><textarea className="input min-h-[90px]" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <Field label="Provas (até 5 imagens)"><input type="file" accept="image/*" multiple className="text-sm" onChange={async (e) => { try { setEv(await uploadProofs(e.target.files, meId)); } catch (err) { alert((err as Error).message); } }} /></Field>
        <button type="button" className="btn w-full" disabled={!team || reason.trim().length < 5} onClick={async () => { if (await run(compApi.dispute(v.challenge.id, team!, reason, ev), 'Enviado à equipa TxapZone')) onDone(); }}>Enviar</button>
      </div>
    </Sheet>
  );
}
function ScheduleSheet({ open, onClose, id, onDone }: { open: boolean; onClose: () => void; id: string; onDone: () => void }) {
  const [d, setD] = useState(''); const run = useRun();
  return (
    <Sheet open={open} onClose={onClose} title="Marcar data">
      <div className="space-y-3">
        <Field label="Data e hora (Maputo)" hint="Mínimo 30 minutos a partir de agora."><input type="datetime-local" className="input" value={d} onChange={(e) => setD(e.target.value)} /></Field>
        <button type="button" className="btn w-full" disabled={!d} onClick={async () => { if (await run(compApi.schedule(id, new Date(d).toISOString()), 'Desafio agendado')) onDone(); }}>Agendar</button>
      </div>
    </Sheet>
  );
}
function AcceptOpenSheet({ open, onClose, c, onDone }: { open: boolean; onClose: () => void; c: ChallengeView; onDone: () => void }) {
  const [mine, setMine] = useState<(TeamView & { canManage: boolean })[]>([]); const [t, setT] = useState(''); const run = useRun();
  useEffect(() => { if (open) void compApi.myTeams().then((m) => { const ok = m.filter((x) => x.canManage && x.game === c.game && x.id !== c.challenger.id); setMine(ok); setT(ok[0]?.id ?? ''); }); }, [open, c]);
  return (
    <Sheet open={open} onClose={onClose} title="Aceitar desafio aberto">
      {mine.length === 0 ? <p className="text-sm">Precisas de gerir uma equipa de {c.game}. <Link className="text-neon2 underline" href="/equipas?criar=1">Criar equipa</Link></p> : (
        <div className="space-y-3">
          <Field label="Equipa"><select className="input" value={t} onChange={(e) => setT(e.target.value)}>{mine.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          <button type="button" className="btn w-full" onClick={async () => { if (await run(compApi.respond(c.id, true, t), 'Desafio aceite')) onDone(); }}>Aceitar</button>
        </div>
      )}
    </Sheet>
  );
}
function BetSheet({ open, onClose, v, onDone }: { open: boolean; onClose: () => void; v: EventView; onDone: () => void }) {
  const [sel, setSel] = useState(v.market!.selections[0]?.id ?? ''); const [raw, setRaw] = useState('50'); const [ok, setOk] = useState(false);
  const [idem, setIdem] = useState(() => compApi.newIdem());
  // O utilizador escolhe o próprio valor (MT). Limites = os do servidor (bet_settings.mt_min_stake/mt_max_stake) + limite pessoal.
  const [lim, setLim] = useState({ min: DEFAULT_SETTINGS.mtMinStake, max: DEFAULT_SETTINGS.mtMaxStake, personal: null as number | null });
  useEffect(() => { if (open) void betsApi.load().then((b) => setLim({ min: b.settings.mtMinStake, max: b.settings.mtMaxStake, personal: b.me?.limits.mtMaxStake ?? null })).catch(() => {}); }, [open]);
  const run = useRun();
  const s = v.market!.selections.find((x) => x.id === sel);
  const stake = raw.trim() === '' ? NaN : Number(raw);
  const maxNow = Math.min(lim.max, lim.personal ?? Infinity);
  const stakeErr = validateStake(stake, lim.min, lim.max, lim.personal);
  const potential = s && !stakeErr ? Math.floor(stake * s.odds + 1e-9) : 0;
  return (
    <Sheet open={open} onClose={onClose} title="Confirmar aposta">
      <div className="space-y-3">
        <p className="rounded-[12px] bg-red-700/30 p-2 text-xs"><b>18+</b> Aposta com responsabilidade. Define limites e pausas na tua carteira.</p>
        <Field label="Escolha">{v.market!.selections.map((x) => (
          <label key={x.id} className="mb-1 flex min-h-[44px] items-center gap-2 rounded-[12px] bg-panel2 px-3"><input type="radio" name="sel" checked={sel === x.id} onChange={() => setSel(x.id)} /><span className="flex-1">{x.label}</span><b>{x.odds.toFixed(2)}</b></label>))}
        </Field>
        <Field label="O teu valor (MT)" hint={`Mínimo ${lim.min} MT · máximo ${maxNow} MT${lim.personal != null && lim.personal < lim.max ? ' (o teu limite pessoal)' : ''}`}>
          <input type="number" inputMode="numeric" min={lim.min} max={maxNow} step={1} className="input" value={raw} aria-invalid={!!stakeErr} onChange={(e) => setRaw(e.target.value.replace(/[^\d]/g, '').slice(0, 7))} />
        </Field>
        <div className="flex flex-wrap gap-2">{[lim.min, 50, 100, 250, 500].filter((x, i, a) => x >= lim.min && x <= maxNow && a.indexOf(x) === i).map((x) => <button key={x} type="button" className="chip" onClick={() => setRaw(String(x))}>{x} MT</button>)}</div>
        {stakeErr && raw !== '' && <p role="alert" className="text-xs text-pink">{stakeErr === 'STAKE_MIN' ? `O mínimo é ${lim.min} MT.` : stakeErr === 'STAKE_MAX' ? `O máximo é ${maxNow} MT.` : STAKE_ERR[stakeErr]}</p>}
        <div className="rounded-[12px] bg-panel2 p-3 text-sm">
          <p>Se <b>{s?.label}</b> ganhar, recebes o dobro: <b>{potential} MT</b> (apostaste {stakeErr ? '—' : stake} MT).</p>
          <p className="mt-1 text-xs text-white/60">Se as odds mudarem antes de confirmares, o servidor recusa e pede nova confirmação. Depois de confirmada, nada muda retroativamente. Liquidação só depois de o resultado ser validado; desafio cancelado = reembolso.</p>
        </div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} className="mt-1" />Confirmo que tenho 18+ anos, li os termos e quero apostar {stakeErr ? '…' : stake} MT.</label>
        <button type="button" className="btn w-full" disabled={!ok || !s || !!stakeErr} onClick={async () => {
          const r = await run(compApi.placeBet(v.challenge.id, sel, stake, s!.odds, 'mt', ok, idem), 'Aposta confirmada');
          setIdem(compApi.newIdem());
          if (r) onDone();
        }}>Confirmar aposta</button>
      </div>
    </Sheet>
  );
}
