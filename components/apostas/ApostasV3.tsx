'use client';

// Apostas v3 — página APOSTAS: ao vivo, próximos, todos os jogos, torneios, desafios, pesquisar equipas, minhas apostas,
// histórico, regras e ajuda. Fluxo: escolher jogo → confronto → equipa → valor → ver retorno → confirmar → acompanhar → liquidação.
// Tudo o que conta (saldo, mercado aberto, multiplicador, limites, liquidação) é decidido no servidor (apv2_bet_confirm).
// SALDO DE TESTE APENAS — sem dinheiro real até haver autorização legal.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import {
  V2Res, V2_RESULT_NAMES, V3_GAMES, V3_MATCH_STATUS, V3_TABS, V3Tab, calcStake, filterBetsV3, fmtMTTeste, fmtOddsV2, isOpenBet, v2ErrText, v3GameName, validateStakeV2,
} from '@/lib/apostasV2';
import { V2MarketView, V3BetView, V3EventView, V3MatchView, V3Me, apostasV2Api, apostasV3Api, newRequestId } from '@/lib/apostasV2Api';
import { betsApi } from '@/lib/betsApi';
import { BxSheet as Sheet } from '@/components/BxSheet';
import { TeamBadge } from '@/components/TeamBadge';
import ApostasV2, { ApostasDesativadas } from './ApostasV2';

type Sec = 'ao_vivo' | 'proximos' | 'todos' | 'torneios' | 'desafios' | 'pesquisar' | 'minhas' | 'historico' | 'regras';
const SECS: { key: Sec; label: string }[] = [
  { key: 'ao_vivo', label: 'Ao vivo' }, { key: 'proximos', label: 'Próximos' }, { key: 'todos', label: 'Todos os jogos' }, { key: 'torneios', label: 'Torneios' },
  { key: 'desafios', label: 'Desafios' }, { key: 'pesquisar', label: 'Pesquisar equipas' }, { key: 'minhas', label: 'Minhas apostas' }, { key: 'historico', label: 'Histórico' },
  { key: 'regras', label: 'Regras e ajuda' },
];
const LIVE = ['em_andamento', 'aguarda_resultado', 'resultado_em_analise'];
const FINAL = ['finalizado', 'cancelado'];
const fmtWhen = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('pt-PT', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const shortId = (id: string) => id.replace(/-/g, '').slice(0, 8).toUpperCase();
const gameMeta = (k: string) => V3_GAMES.find((g) => g.key === k) ?? V3_GAMES[V3_GAMES.length - 1];

/** Uma aposta escolhida: tanto confronto (v3) como mercado antigo (v2). */
interface Pick { game: string; title: string; confrontoId: string; selectionId: string; label: string; odds: number; startsAt: string | null }

export default function ApostasV3() {
  const { s, ready, toast } = useStore();
  const [me, setMe] = useState<V3Me | null>(null);
  const [matches, setMatches] = useState<V3MatchView[] | null>(null);
  const [extra, setExtra] = useState<V2MarketView[]>([]);
  const [bets, setBets] = useState<V3BetView[]>([]);
  const [sec, setSec] = useState<Sec>('proximos');
  const [game, setGame] = useState<string>('');
  const [pick, setPick] = useState<Pick | null>(null);
  const [detail, setDetail] = useState<V3BetView | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    const h = (typeof window !== 'undefined' ? window.location.hash.replace('#', '') : '') as Sec;
    if (SECS.some((x) => x.key === h)) setSec(h);
  }, []);
  const reload = useCallback(async () => {
    try {
      setErr('');
      const m = await apostasV3Api.me();
      setMe(m);
      if (!m.v3 || !m.enabled) return;
      const [a, b, c] = await Promise.all([apostasV3Api.matches(), apostasV3Api.myBets(), apostasV2Api.markets().catch(() => [] as V2MarketView[])]);
      setMatches(a); setBets(b);
      const ids = new Set(a.map((x) => x.marketId));
      setExtra(c.filter((x) => !ids.has(x.id))); // mercados antigos (sem confronto)
    } catch (e) { setErr(v2ErrText((e as Error).message)); }
  }, []);
  useEffect(() => { if (ready) void reload(); }, [ready, s.account.loggedIn, reload]);

  if (!me) return err ? <p className="bx-card p-4 text-sm">{err}</p> : <Skel />;
  if (!me.v3) return <ApostasV2 />; // SQL v3 ainda não instalado: continua tudo como na v2
  if (!me.enabled) return <ApostasDesativadas installed={me.installed} />;
  if (!matches) return err ? <p className="bx-card p-4 text-sm">{err} <button type="button" className="bx-acc underline" onClick={() => void reload()}>Tentar outra vez</button></p> : <Skel />;

  const claim = async () => { const r = await apostasV3Api.claim(); if (r.ok) { toast('Saldo de teste creditado.'); void reload(); } else toast(v2ErrText(r.code)); };
  const inGame = (m: V3MatchView) => !game || m.game === game;
  const reserved = bets.filter((b) => isOpenBet(b.status)).reduce((a, b) => a + b.stake, 0);
  const choose = (m: V3MatchView, selId: string) => {
    const sel = m.selections.find((x) => x.id === selId)!;
    setPick({ game: m.game, title: `${m.teamA} VS ${m.teamB}`, confrontoId: m.id, selectionId: sel.id, label: sel.label, odds: sel.odds, startsAt: m.startsAt });
  };

  return (
    <div className="bx bx-pm">
      <div role="note" className="bx-banner mb-3 p-3 text-[13px] leading-snug"><b>Modo demonstração.</b> Saldo de teste sem valor monetário: não se compra nem se levanta. Dinheiro real só com autorização legal.</div>
      <div className="bx-card mb-3 grid grid-cols-2 gap-3 p-4">
        <div><p className="bx-muted text-[12px]">Saldo disponível</p><p className="text-xl font-bold">{fmtMTTeste(me.balance)}</p></div>
        <div><p className="bx-muted text-[12px]">Em jogo</p><p className="text-xl font-bold">{fmtMTTeste(reserved)}</p></div>
        {me.loggedIn && !me.claimed && <button type="button" className="bx-btn col-span-2" onClick={claim}>Receber {fmtMTTeste(me.limits.initial_test_balance)} de teste</button>}
        {!me.loggedIn && <p className="bx-muted col-span-2 text-[13px]">Entra na tua conta para apostar. <Link className="bx-acc underline" href="/entrar?next=/apostas">Entrar</Link></p>}
        {me.block && <p role="alert" className="col-span-2 rounded-lg bg-[#B45309]/30 p-2 text-[13px]">{v2ErrText(me.block)}</p>}
      </div>

      <nav className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4" role="tablist" aria-label="Secções de apostas">
        {SECS.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={sec === x.key} className="bx-chip" onClick={() => { setSec(x.key); history.replaceState(null, '', `#${x.key}`); }}>
            {x.label}{x.key === 'minhas' && bets.filter((b) => isOpenBet(b.status)).length ? ` · ${bets.filter((b) => isOpenBet(b.status)).length}` : ''}
          </button>
        ))}
      </nav>

      {['ao_vivo', 'proximos', 'todos', 'torneios'].includes(sec) && (
        <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4" aria-label="Filtrar por jogo">
          <button type="button" className="bx-chip !min-h-[38px] !text-[13px]" aria-pressed={!game} onClick={() => setGame('')}>Todos</button>
          {V3_GAMES.map((g) => <button key={g.key} type="button" className="bx-chip !min-h-[38px] !text-[13px]" aria-pressed={game === g.key} onClick={() => setGame(g.key)}>{g.emoji} {g.name}</button>)}
        </div>
      )}

      {sec === 'ao_vivo' && <MatchList list={matches.filter((m) => LIVE.includes(m.status) && inGame(m))} empty="Nenhum confronto a decorrer agora." me={me} onPick={choose} />}
      {sec === 'proximos' && <MatchList list={matches.filter((m) => ['apostas_abertas', 'agendado', 'suspenso'].includes(m.status) && inGame(m))} empty="Ainda não há confrontos marcados." me={me} onPick={choose} />}
      {sec === 'todos' && (
        <div className="space-y-5">
          {V3_GAMES.filter((g) => !game || g.key === game).map((g) => {
            const list = matches.filter((m) => m.game === g.key && !FINAL.includes(m.status));
            if (!list.length) return null;
            return <section key={g.key}><h2 className="mb-2 text-[15px] font-bold">{g.emoji} {g.name}</h2><MatchList list={list} empty="" me={me} onPick={choose} /></section>;
          })}
          {!matches.some((m) => !FINAL.includes(m.status) && inGame(m)) && <p className="bx-card p-4 text-center text-sm">Sem confrontos para este jogo.</p>}
          {extra.length > 0 && !game && <ExtraMarkets markets={extra} me={me} onPick={setPick} />}
        </div>
      )}
      {sec === 'torneios' && <Tournaments matches={matches.filter(inGame)} me={me} onPick={choose} />}
      {sec === 'desafios' && (
        <div className="bx-card p-4 text-[14px]">
          <p className="font-bold">Desafios entre equipas</p>
          <p className="bx-muted mt-1">Os desafios competitivos (equipa contra equipa, com prémio) vivem na área Desafios. Quando um desafio vira confronto com apostas, aparece aqui em Próximos.</p>
          <Link href="/desafios" className="bx-btn mt-3 w-full">Abrir Desafios</Link>
        </div>
      )}
      {sec === 'pesquisar' && <Search matches={matches} me={me} onPick={choose} />}
      {sec === 'minhas' && <MyBets bets={bets} onOpen={setDetail} />}
      {sec === 'historico' && <History bets={bets} matches={matches} onOpen={setDetail} />}
      {sec === 'regras' && <Rules me={me} />}

      {pick && <ConfirmSheet key={pick.selectionId} pick={pick} me={me} onClose={() => setPick(null)} onDone={() => { setPick(null); setSec('minhas'); void reload(); }} onRefresh={reload} />}
      {detail && <BetDetail bet={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function Skel() { return <div className="space-y-3">{[0, 1, 2].map((k) => <div key={k} className="h-28 animate-pulse rounded-xl bg-[#1A2A5E]" />)}</div>; }

function StatusPill({ status }: { status: string }) {
  const cls = status === 'apostas_abertas' ? 'bg-emerald-600' : LIVE.includes(status) ? 'bg-red-600' : status === 'suspenso' ? 'bg-amber-600' : 'bg-white/15';
  return <span className={`bx-tag ${cls} text-white`}>{LIVE.includes(status) && status === 'em_andamento' ? '● ' : ''}{V3_MATCH_STATUS[status as keyof typeof V3_MATCH_STATUS] ?? status}</span>;
}

function MatchList({ list, empty, me, onPick }: { list: V3MatchView[]; empty: string; me: V3Me; onPick: (m: V3MatchView, sel: string) => void }) {
  if (!list.length) return empty ? <p className="bx-card p-4 text-center text-sm">{empty}</p> : null;
  return <div className="space-y-3">{list.map((m) => <MatchCard key={m.id} m={m} me={me} onPick={onPick} />)}</div>;
}

function MatchCard({ m, me, onPick }: { m: V3MatchView; me: V3Me; onPick: (m: V3MatchView, sel: string) => void }) {
  const g = gameMeta(m.game);
  const open = m.status === 'apostas_abertas' && m.marketStatus === 'aberto' && Date.parse(m.startsAt) > Date.now();
  const can = open && me.loggedIn && !me.block;
  return (
    <article className="bx-card p-4" aria-label={`${m.teamA} contra ${m.teamB}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="bx-tag text-[#0B1B4D]" style={{ background: g.color }}>{g.emoji} {g.name}</span>
        <StatusPill status={m.marketStatus === 'suspenso' && m.status === 'apostas_abertas' ? 'suspenso' : m.status} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2"><TeamBadge name={m.teamA} logo={m.logoA} size={36} /><b className="truncate text-[15px]">{m.teamA}</b></div>
        <span className="bx-acc shrink-0 text-[13px] font-black">VS</span>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2"><b className="truncate text-right text-[15px]">{m.teamB}</b><TeamBadge name={m.teamB} logo={m.logoB} size={36} /></div>
      </div>
      <p className="bx-dim mt-2 text-[12px]">{fmtWhen(m.startsAt)}{m.tournamentName ? ` · ${m.tournamentName}` : ''}{m.status === 'finalizado' && m.scoreA != null ? ` · ${m.scoreA}–${m.scoreB}` : ''}</p>
      <div className={`mt-3 grid gap-2 ${m.selections.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {m.selections.map((x) => (
          <button key={x.id} type="button" className="bx-odd" disabled={!can} onClick={() => onPick(m, x.id)} aria-label={`Apostar em ${x.label}, multiplicador ${fmtOddsV2(x.odds)}`}>
            <span className="bx-odd-l">{x.label}</span><span className="bx-odd-v">×{fmtOddsV2(x.odds)}</span>
          </button>
        ))}
      </div>
      {!open && m.status === 'agendado' && <p className="bx-dim mt-2 text-[12px]">As apostas ainda não abriram.</p>}
      {m.rules && <details className="mt-2 text-[12.5px]"><summary className="bx-muted cursor-pointer">Regras do confronto{m.organizer ? ` · ${m.organizer}` : ''}</summary><p className="bx-muted mt-1 whitespace-pre-line">{m.rules}</p></details>}
    </article>
  );
}

function ExtraMarkets({ markets, me, onPick }: { markets: V2MarketView[]; me: V3Me; onPick: (p: Pick) => void }) {
  return (
    <section>
      <h2 className="mb-2 text-[15px] font-bold">Mercados especiais</h2>
      <div className="space-y-3">{markets.map((m) => (
        <article key={m.id} className="bx-card p-4">
          <div className="mb-2"><span className="bx-tag mr-2 bg-white/15">{v3GameName(m.game)}</span><b className="text-[15px]">{m.title}</b></div>
          <div className="grid grid-cols-2 gap-2">{m.selections.map((x) => (
            <button key={x.id} type="button" className="bx-odd" disabled={m.status !== 'aberto' || !me.loggedIn || !!me.block} onClick={() => onPick({ game: m.game, title: m.title, confrontoId: m.id, selectionId: x.id, label: x.label, odds: x.odds, startsAt: m.closesAt })}>
              <span className="bx-odd-l">{x.label}</span><span className="bx-odd-v">×{fmtOddsV2(x.odds)}</span>
            </button>))}
          </div>
        </article>))}
      </div>
    </section>
  );
}

function Tournaments({ matches, me, onPick }: { matches: V3MatchView[]; me: V3Me; onPick: (m: V3MatchView, sel: string) => void }) {
  const groups = useMemo(() => {
    const g = new Map<string, V3MatchView[]>();
    for (const m of matches) if (m.tournamentName && !FINAL.includes(m.status)) g.set(m.tournamentName, [...(g.get(m.tournamentName) ?? []), m]);
    return [...g.entries()];
  }, [matches]);
  if (!groups.length) return <p className="bx-card p-4 text-center text-sm">Nenhum torneio com apostas neste momento. <Link className="bx-acc underline" href="/torneios">Ver torneios</Link></p>;
  return <div className="space-y-5">{groups.map(([name, list]) => <section key={name}><h2 className="mb-2 text-[15px] font-bold">🏆 {name}</h2><MatchList list={list} empty="" me={me} onPick={onPick} /></section>)}</div>;
}

function Search({ matches, me, onPick }: { matches: V3MatchView[]; me: V3Me; onPick: (m: V3MatchView, sel: string) => void }) {
  const [q, setQ] = useState('');
  const t = q.trim().toLowerCase();
  const list = t.length < 2 ? [] : matches.filter((m) => `${m.teamA} ${m.teamB} ${m.tournamentName}`.toLowerCase().includes(t));
  return (
    <div>
      <label className="mb-3 block text-[13px] font-semibold">Pesquisar equipas
        <input className="bx-input mt-1" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome da equipa ou torneio" autoFocus />
      </label>
      {t.length >= 2 && <MatchList list={list} empty={`Nada encontrado para “${q.trim()}”.`} me={me} onPick={onPick} />}
    </div>
  );
}

function BetCard({ b, onOpen }: { b: V3BetView; onOpen: (b: V3BetView) => void }) {
  const open = isOpenBet(b.status);
  const tone = b.status === 'ganha' ? 'bg-emerald-600' : b.status === 'perdida' ? 'bg-red-700' : open ? 'bg-amber-600' : 'bg-white/15';
  return (
    <li>
      <button type="button" className="bx-card w-full p-3 text-left text-[13.5px]" onClick={() => onOpen(b)}>
        <div className="flex justify-between gap-2"><b className="truncate">{b.label}</b><span className={`bx-tag ${tone} text-white`}>{V2_RESULT_NAMES[b.status] ?? b.status}</span></div>
        <p className="bx-muted truncate">{b.teamA ? `${b.teamA} VS ${b.teamB}` : b.market} · {v3GameName(b.game)}</p>
        <p className="mt-1">Valor {fmtMTTeste(b.stake)} · ×{fmtOddsV2(b.oddsLocked)} · {open ? `retorno ${fmtMTTeste(b.potential)}` : `recebido ${fmtMTTeste(b.payout)}`}</p>
        <p className="bx-dim text-[11.5px]">{fmtWhen(b.createdAt)} · #{shortId(b.id)}</p>
      </button>
    </li>
  );
}

function MyBets({ bets, onOpen }: { bets: V3BetView[]; onOpen: (b: V3BetView) => void }) {
  const [tab, setTab] = useState<V3Tab>('todas');
  const [g, setG] = useState(''); const [st, setSt] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const list = filterBetsV3(bets, { tab, game: g || undefined, status: st || undefined, from: from || undefined, to: to || undefined });
  if (!bets.length) return <p className="bx-card p-4 text-center text-sm">Ainda não fizeste apostas. Escolhe um confronto em Próximos.</p>;
  return (
    <div>
      <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4" role="tablist" aria-label="Estado das apostas">
        {V3_TABS.map((t) => <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className="bx-chip !min-h-[38px] !text-[13px]" onClick={() => setTab(t.key)}>{t.label} · {bets.filter((b) => t.match(b.status)).length}</button>)}
      </div>
      <details className="bx-card mb-3 p-3 text-[13px]">
        <summary className="cursor-pointer font-semibold">Filtros</summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label>Jogo<select className="bx-input mt-1" value={g} onChange={(e) => setG(e.target.value)}><option value="">Todos</option>{V3_GAMES.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}</select></label>
          <label>Estado<select className="bx-input mt-1" value={st} onChange={(e) => setSt(e.target.value)}><option value="">Todos</option>{Object.entries(V2_RESULT_NAMES).filter(([k]) => k !== 'aberta').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>De<input className="bx-input mt-1" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>Até<input className="bx-input mt-1" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
      </details>
      {list.length === 0 ? <p className="bx-card p-4 text-center text-sm">Nenhuma aposta com estes filtros.</p> : <ul className="space-y-2">{list.map((b) => <BetCard key={b.id} b={b} onOpen={onOpen} />)}</ul>}
    </div>
  );
}

function History({ bets, matches, onOpen }: { bets: V3BetView[]; matches: V3MatchView[]; onOpen: (b: V3BetView) => void }) {
  const settled = bets.filter((b) => !isOpenBet(b.status));
  const done = matches.filter((m) => FINAL.includes(m.status));
  const net = settled.reduce((a, b) => a + b.payout - b.stake, 0);
  return (
    <div className="space-y-4">
      <div className="bx-card grid grid-cols-3 gap-2 p-3 text-center text-[12.5px]">
        <div><p className="bx-muted">Liquidadas</p><b className="text-[15px]">{settled.length}</b></div>
        <div><p className="bx-muted">Ganhas</p><b className="text-[15px]">{settled.filter((b) => b.status === 'ganha').length}</b></div>
        <div><p className="bx-muted">Saldo líquido</p><b className={`text-[15px] ${net >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{net >= 0 ? '+' : ''}{net}</b></div>
      </div>
      <section><h2 className="mb-2 text-[15px] font-bold">As minhas apostas liquidadas</h2>
        {settled.length ? <ul className="space-y-2">{settled.map((b) => <BetCard key={b.id} b={b} onOpen={onOpen} />)}</ul> : <p className="bx-card p-4 text-center text-sm">Ainda nada liquidado.</p>}
      </section>
      <section><h2 className="mb-2 text-[15px] font-bold">Resultados oficiais</h2>
        {done.length ? <ul className="space-y-2">{done.map((m) => (
          <li key={m.id} className="bx-card p-3 text-[13.5px]"><b>{m.teamA} VS {m.teamB}</b> <span className="bx-muted">· {v3GameName(m.game)}</span>
            <p className="bx-muted">{m.status === 'cancelado' ? 'Cancelado — apostas reembolsadas' : `Vencedor: ${m.result === 'a' ? m.teamA : m.result === 'b' ? m.teamB : 'Empate'}${m.scoreA != null ? ` (${m.scoreA}–${m.scoreB})` : ''}`}</p></li>))}
        </ul> : <p className="bx-card p-4 text-center text-sm">Sem resultados recentes.</p>}
      </section>
    </div>
  );
}

function Rules({ me }: { me: V3Me }) {
  const { toast } = useStore();
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const exclude = async (days: number) => {
    if (!confirm(`Autoexcluir-te das apostas durante ${days} dias? Não dá para desfazer antes do fim.`)) return;
    const r = await betsApi.selfExclude(days); toast(r.ok ? `Autoexclusão ativa durante ${days} dias.` : v2ErrText(String(r.code)));
  };
  const send = async () => { setBusy(true); const r = await apostasV3Api.complaint(null, null, msg); setBusy(false); if (r.ok) { setMsg(''); toast('Reclamação enviada. Respondemos aqui.'); } else toast(v2ErrText(r.code)); };
  return (
    <div className="space-y-3 text-[14px]">
      <section className="bx-card p-4">
        <h2 className="font-bold">Como funciona</h2>
        <ol className="bx-muted mt-2 list-decimal space-y-1 pl-5">
          <li>Escolhe o jogo e o confronto.</li><li>Toca na equipa — o botão mostra o multiplicador.</li>
          <li>Escreve o valor ou toca num valor sugerido. Vês o retorno total (valor × multiplicador) e o ganho líquido (retorno − valor).</li>
          <li>Confirma. O multiplicador fica congelado na tua aposta; se mudar antes de confirmares, pedimos nova confirmação.</li>
          <li>Acompanha em Minhas apostas. Quando o resultado oficial é validado por duas pessoas da equipa, a aposta é liquidada automaticamente.</li>
        </ol>
      </section>
      <section className="bx-card p-4">
        <h2 className="font-bold">Regras</h2>
        <ul className="bx-muted mt-2 list-disc space-y-1 pl-5">
          <li>Valor mínimo {fmtMTTeste(me.limits.min_stake)}, máximo {fmtMTTeste(me.limits.max_stake)} por aposta (podem existir limites menores por confronto).</li>
          <li>As apostas fecham à hora de início do confronto (relógio do servidor) ou quando o confronto é suspenso.</li>
          <li>Confronto cancelado: todas as apostas são reembolsadas. Nunca há pagamento a dobrar.</li>
          <li>Só maiores de 18 anos. Cada pessoa vê apenas as suas apostas.</li>
          <li>Saldo de teste: sem valor monetário, não se deposita nem se levanta.</li>
        </ul>
      </section>
      <section className="bx-card p-4">
        <h2 className="font-bold">Jogo responsável</h2>
        <p className="bx-muted mt-1">Precisas de uma pausa? A autoexclusão bloqueia todas as apostas durante o período escolhido.</p>
        <div className="mt-2 flex flex-wrap gap-2">{[7, 30, 90].map((d) => <button key={d} type="button" className="bx-ghost" onClick={() => void exclude(d)} disabled={!me.loggedIn}>{d} dias</button>)}</div>
      </section>
      <section className="bx-card p-4">
        <h2 className="font-bold">Reclamações</h2>
        <p className="bx-muted mt-1">Sobre uma aposta específica, abre-a em Minhas apostas e toca em “Reclamar”. Para outro assunto, escreve aqui.</p>
        <textarea className="bx-input mt-2 min-h-[90px] py-2" value={msg} maxLength={1000} onChange={(e) => setMsg(e.target.value)} placeholder="Descreve o problema" />
        <button type="button" className="bx-btn mt-2 w-full" disabled={busy || msg.trim().length < 5 || !me.loggedIn} onClick={send}>Enviar reclamação</button>
      </section>
    </div>
  );
}

/** Formulário de confirmação. O requestId é fixo enquanto a folha estiver aberta: duplo clique ou nova tentativa após falha de rede nunca debitam 2x. */
function ConfirmSheet({ pick, me, onClose, onDone, onRefresh }: { pick: Pick; me: V3Me; onClose: () => void; onDone: () => void; onRefresh: () => void }) {
  const { toast } = useStore();
  const [stake, setStake] = useState('');
  const [odds, setOdds] = useState(pick.odds);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [req, setReq] = useState(newRequestId);
  const lock = useRef(false);
  const n = stake ? Number(stake) : NaN;
  const code = stake ? validateStakeV2(n, me.limits, me.balance) : null;
  const calc = !code && stake ? calcStake(n, odds) : null;
  const g = gameMeta(pick.game);
  const go = async () => {
    if (lock.current) return; // trava de duplo clique (além da idempotência no servidor)
    lock.current = true; setBusy(true); setError('');
    const r: V2Res = await apostasV3Api.confirm(pick.selectionId, n, odds, req).catch(() => ({ ok: false as const, code: 'NETWORK' }));
    lock.current = false; setBusy(false);
    if (r.ok) { toast(r.replay ? 'Aposta já registada (pedido repetido).' : `Aposta confirmada com multiplicador ×${fmtOddsV2(Number(r.odds))}.`); onDone(); return; }
    if (r.code === 'ODDS_CHANGED' && r.odds != null) { setOdds(Number(r.odds)); setChanged(true); setReq(newRequestId()); onRefresh(); return; }
    if (r.code !== 'NETWORK') setReq(newRequestId()); // falha de rede: mantém o mesmo pedido para a nova tentativa
    setError(v2ErrText(r.code) + (r.code === 'STAKE_MIN' ? ` (mín. ${me.limits.min_stake})` : r.code === 'STAKE_MAX' || r.code === 'LIMIT_STAKE' ? ` (máx. ${String(r.max ?? me.limits.max_stake)})` : ''));
    if (['CLOSED', 'SUSPENDED', 'LIMIT_EXPOSURE'].includes(r.code)) onRefresh();
  };
  return (
    <Sheet open onClose={onClose} title="Confirmar aposta">
      <div className="space-y-3 text-[14px]">
        <dl className="bx-card2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 p-3 text-[13.5px]">
          <dt className="bx-muted">Jogo</dt><dd className="text-right font-semibold">{g.emoji} {g.name}</dd>
          <dt className="bx-muted">Confronto</dt><dd className="text-right font-semibold">{pick.title}</dd>
          <dt className="bx-muted">ID</dt><dd className="text-right font-mono text-[12.5px]">#{shortId(pick.confrontoId)}</dd>
          <dt className="bx-muted">Equipa</dt><dd className="text-right font-bold">{pick.label}</dd>
          <dt className="bx-muted">Multiplicador atual</dt><dd className="bx-acc text-right text-[16px] font-black">×{fmtOddsV2(odds)}</dd>
        </dl>
        {changed && <p role="alert" className="rounded-lg bg-[#B45309]/30 p-2 text-[13px]">O multiplicador mudou para <b>×{fmtOddsV2(odds)}</b>. Revê o retorno e confirma outra vez se aceitas.</p>}
        <label className="block text-[13px] font-semibold">Valor da aposta (MT de teste)
          <input className="bx-input mt-1" inputMode="numeric" autoComplete="off" value={stake} placeholder={`${me.limits.min_stake} – ${Math.min(me.limits.max_stake, me.balance)}`} onChange={(e) => { setStake(e.target.value.replace(/[^\d]/g, '').slice(0, 7)); setError(''); }} />
        </label>
        <div className="flex flex-wrap gap-2" aria-label="Valores sugeridos">
          {me.chips.map((c) => <button key={c} type="button" className="bx-chip !min-h-[38px] !text-[13px]" aria-pressed={n === c} disabled={c > me.balance} onClick={() => { setStake(String(c)); setError(''); }}>{c} MT</button>)}
        </div>
        <dl className="grid grid-cols-[1fr,auto] gap-y-1 text-[14px]">
          <dt className="bx-muted">Saldo disponível</dt><dd className="text-right">{fmtMTTeste(me.balance)}</dd>
          <dt className="bx-muted">Retorno total</dt><dd className="text-right font-bold">{calc ? fmtMTTeste(calc.retorno) : '—'}</dd>
          <dt className="bx-muted">Ganho líquido</dt><dd className="text-right font-bold text-emerald-300">{calc ? `+${fmtMTTeste(calc.ganho)}` : '—'}</dd>
        </dl>
        {code && <p className="text-[13px] text-[#FCA5A5]">{v2ErrText(code)}</p>}
        {error && <p role="alert" className="rounded-lg bg-red-900/40 p-2 text-[13px]">{error}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="bx-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className="bx-btn" disabled={busy || !stake || !!code} onClick={go}>{busy ? 'A confirmar…' : changed ? `Confirmar ×${fmtOddsV2(odds)}` : 'Confirmar'}</button>
        </div>
        <p className="bx-dim text-[11.5px]">Ao confirmar, o valor é debitado e o multiplicador fica congelado. Saldo de teste — sem valor monetário.</p>
      </div>
    </Sheet>
  );
}

function BetDetail({ bet, onClose }: { bet: V3BetView; onClose: () => void }) {
  const { toast } = useStore();
  const [ev, setEv] = useState<V3EventView[] | null>(null);
  const [msg, setMsg] = useState(''); const [show, setShow] = useState(false);
  useEffect(() => { void apostasV3Api.betEvents(bet.id).then(setEv).catch(() => setEv([])); }, [bet.id]);
  const calc = calcStake(bet.stake, bet.oddsLocked);
  const receipt = [
    'TxapZone · Comprovativo de aposta (saldo de teste)', `Aposta #${shortId(bet.id)}`, `Jogo: ${v3GameName(bet.game)}`,
    `Confronto: ${bet.teamA ? `${bet.teamA} VS ${bet.teamB}` : bet.market}${bet.matchId ? ` (#${shortId(bet.matchId)})` : ''}`, `Equipa: ${bet.label}`,
    `Valor: ${bet.stake} MT · Multiplicador: ×${fmtOddsV2(bet.oddsLocked)} · Retorno: ${bet.potential} MT`, `Estado: ${V2_RESULT_NAMES[bet.status] ?? bet.status}`,
    `Data: ${fmtWhen(bet.createdAt)}`, bet.settledAt ? `Liquidada: ${fmtWhen(bet.settledAt)} · ${bet.payout} MT${bet.officialResult ? ` · Resultado: ${bet.officialResult}` : ''}` : '',
  ].filter(Boolean).join('\n');
  const copy = async () => { try { await navigator.clipboard.writeText(receipt); toast('Comprovativo copiado.'); } catch { toast('Não foi possível copiar.'); } };
  const send = async () => { const r = await apostasV3Api.complaint(bet.id, bet.matchId, msg); if (r.ok) { toast('Reclamação enviada.'); setShow(false); setMsg(''); } else toast(v2ErrText(r.code)); };
  return (
    <Sheet open onClose={onClose} title={`Aposta #${shortId(bet.id)}`}>
      <div className="space-y-3 text-[13.5px]">
        <dl className="bx-card2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 p-3">
          <dt className="bx-muted">Jogo</dt><dd className="text-right">{v3GameName(bet.game)}</dd>
          <dt className="bx-muted">Confronto</dt><dd className="text-right">{bet.teamA ? `${bet.teamA} VS ${bet.teamB}` : bet.market}</dd>
          <dt className="bx-muted">Equipa</dt><dd className="text-right font-bold">{bet.label}</dd>
          <dt className="bx-muted">Valor</dt><dd className="text-right">{fmtMTTeste(bet.stake)}</dd>
          <dt className="bx-muted">Multiplicador</dt><dd className="text-right">×{fmtOddsV2(bet.oddsLocked)} (congelado)</dd>
          <dt className="bx-muted">Retorno total</dt><dd className="text-right">{fmtMTTeste(bet.potential)}</dd>
          <dt className="bx-muted">Ganho líquido</dt><dd className="text-right">{calc ? fmtMTTeste(calc.ganho) : '—'}</dd>
          <dt className="bx-muted">Estado</dt><dd className="text-right font-bold">{V2_RESULT_NAMES[bet.status] ?? bet.status}</dd>
          {bet.officialResult && <><dt className="bx-muted">Resultado</dt><dd className="text-right">{bet.officialResult}</dd></>}
          {!isOpenBet(bet.status) && <><dt className="bx-muted">Liquidado</dt><dd className="text-right">{fmtMTTeste(bet.payout)}{bet.settledAt ? ` · ${fmtWhen(bet.settledAt)}` : ''}</dd></>}
        </dl>
        <section>
          <h4 className="mb-1 font-bold">Histórico</h4>
          {!ev ? <p className="bx-muted">A carregar…</p> : ev.length === 0 ? <p className="bx-muted">Sem eventos registados (aposta anterior à v3).</p> : (
            <ol className="space-y-1 border-l border-white/15 pl-3">{ev.map((e) => (
              <li key={e.id}><b>{V2_RESULT_NAMES[e.to as keyof typeof V2_RESULT_NAMES] ?? e.to}</b> <span className="bx-dim text-[11.5px]">{fmtWhen(e.at)}</span>{e.note && <p className="bx-muted text-[12.5px]">{e.note}</p>}</li>))}
            </ol>
          )}
        </section>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="bx-ghost" onClick={copy}>Copiar comprovativo</button>
          <button type="button" className="bx-ghost" onClick={() => setShow((x) => !x)}>Reclamar</button>
        </div>
        {show && (
          <div>
            <textarea className="bx-input min-h-[80px] py-2" maxLength={1000} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="O que aconteceu com esta aposta?" />
            <button type="button" className="bx-btn mt-2 w-full" disabled={msg.trim().length < 5} onClick={send}>Enviar reclamação</button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
