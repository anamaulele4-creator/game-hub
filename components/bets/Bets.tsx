'use client';

// Apostas com TXAP Pontos (pontos virtuais, sem dinheiro real). Mobile-first, toques de 44 px.
// Usado em /apostas (azul-marinho/amarelo) e no separador Apostas de /jogos/<jogo> (escuro/laranja, via .tz .bx).
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { ageFrom } from '@/lib/age';
import { IS_DEMO } from '@/lib/config';
import { GAMES_CFG } from '@/lib/jogos';
import {
  BETS_BANNER, BetGame, BetSettings, Currency, IdType, POINTS, SLIP_ERROR_TEXT, SlipError, cfgFor, comboOdds, fmtAmount, fmtMt, fmtOdds, fmtPts, limitsFor, potentialReturn, validateKyc, validateSlip,
} from '@/lib/bets';
import { AUTO_DEPOSIT_PENDING } from '@/lib/payments';
import type { Market, Match, Selection } from '@/lib/betsCore';
import { BetsView, MoneyView, MyBet, RES_TEXT, betsApi } from '@/lib/betsApi';
import { BxSheet as Sheet } from '@/components/BxSheet';
import { TeamBadge } from '@/components/TeamBadge';

/* ---------- utilitários ---------- */
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
export function fmtKick(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(new Date(now))) / 86400e3);
  const hm = `${d.getHours()}h${d.getMinutes() ? String(d.getMinutes()).padStart(2, '0') : ''}`;
  const lbl = diff === 0 ? 'Hoje' : diff === 1 ? 'Amanhã' : diff === -1 ? 'Ontem' : `${DIAS[d.getDay()]} ${String(d.getDate()).padStart(2, '0')} ${MESES[d.getMonth()]}`;
  return `${lbl} · ${hm}`;
}
const GAME_FILTERS: ('todos' | BetGame)[] = ['todos', 'ff', 'cr', 'ef', 'dls', 'outros'];
const gName = (g: BetGame) => GAMES_CFG[g]?.short ?? g;

interface SlipItem { selectionId: string; marketId: string; groupId: string; label: string; market: string; event: string; odds: number }
const SLIP_KEY = 'txap-bet-slip';

type Tab = 'jogos' | 'torneio' | 'minhas' | 'carteira' | 'responsavel';
const TABS: [Tab, string][] = [['jogos', 'Jogos'], ['torneio', 'Vencedor do torneio'], ['minhas', 'As minhas apostas'], ['carteira', 'Carteira MT'], ['responsavel', 'Jogo responsável']];

/** Dinheiro real disponível: ligado pelo admin e licença IGJ dentro da validade. */
export function realOn(c?: BetSettings | null): boolean {
  if (!c?.realMoneyEnabled || !c.igjLicenceNo || !c.igjLicenceExpiry) return false;
  return c.igjLicenceExpiry > new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
}
const fmtDate = (d: string) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

export function BetsBanner({ className = '', cur = 'pontos', settings }: { className?: string; cur?: Currency; settings?: BetSettings | null }) {
  if (cur === 'mt' && settings) return (
    <div role="note" className={`bx-banner flex items-start gap-2.5 p-3 text-[13.5px] leading-snug ${className}`}>
      <span className="bx-tag shrink-0 bg-[#B91C1C] text-white">18+</span>
      <p><b>Apostas com dinheiro real (MT).</b> Só maiores de 18 com identidade verificada. Licença IGJ nº {settings.igjLicenceNo}. Aposta com responsabilidade.</p>
    </div>
  );
  return (
    <div role="note" className={`bx-banner flex items-start gap-2.5 p-3 text-[13.5px] leading-snug ${className}`}>
      <span className="bx-tag shrink-0 bg-[#B91C1C] text-white">18+</span>
      <p><b>{BETS_BANNER.split('—')[0].trim()}</b> — {settings && realOn(settings) ? 'pontos de teste, sem valor em dinheiro.' : BETS_BANNER.split('—')[1]?.trim()}</p>
    </div>
  );
}

export function LicenceFooter({ settings }: { settings?: BetSettings | null }) {
  if (!settings || !realOn(settings)) return <p className="bx-dim mt-6 text-center text-[11.5px]">TXAP Pontos: pontos virtuais sem valor monetário. Apostas a dinheiro desligadas.</p>;
  return <p className="bx-dim mt-6 text-center text-[11.5px]">Licença IGJ nº {settings.igjLicenceNo} · emitida {fmtDate(settings.igjLicenceDate)} · válida até {fmtDate(settings.igjLicenceExpiry)} · Proibido a menores de 18 anos.</p>;
}

/* ================================================================== */
export default function BetsArea({ game, theme = 'tx' }: { game?: BetGame; theme?: 'tx' | 'tz' }) {
  const { s, ready, toast } = useStore();
  const [v, setV] = useState<BetsView | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>('jogos');
  useEffect(() => {
    const h = window.location.hash.slice(1) as Tab;
    if (TABS.some(([k]) => k === h)) setTab(h);
  }, []);
  const [filter, setFilter] = useState<'todos' | BetGame>(game ?? 'todos');
  const [slip, setSlip] = useState<SlipItem[]>([]);
  const [slipOpen, setSlipOpen] = useState(false);
  const [ageOpen, setAgeOpen] = useState(false);
  const [cur, setCur] = useState<Currency>('pontos');

  const minor = !!s.account.birth && ageFrom(s.account.birth) > 0 && ageFrom(s.account.birth) < 18;
  const needLogin = !IS_DEMO && ready && !s.account.loggedIn;

  const reload = useCallback(async () => {
    try { setErr(''); const x = await betsApi.load(); setV(x); if (x.weeklyCredited && x.me) toast(`+${fmtPts(x.settings.weeklyAllowance)} grátis desta semana `); }
    catch (e) { setErr((e as Error).message || 'erro'); }
  }, [toast]);
  useEffect(() => { if (ready) reload(); }, [ready, s.account.loggedIn, reload]);
  // sistema automático: volta a varrer de minuto a minuto enquanto a página está aberta
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 60000); return () => clearInterval(t); }, [reload]);
  useEffect(() => { try { const r = sessionStorage.getItem(SLIP_KEY); if (r) setSlip(JSON.parse(r)); } catch {} }, []);
  useEffect(() => { try { sessionStorage.setItem(SLIP_KEY, JSON.stringify(slip)); } catch {} }, [slip]);

  // retira do boletim seleções que deixaram de existir/estar abertas noutra vista
  const selById = useMemo(() => new Map((v?.selections ?? []).map((x) => [x.id, x])), [v]);
  const mkById = useMemo(() => new Map((v?.markets ?? []).map((x) => [x.id, x])), [v]);
  const mtById = useMemo(() => new Map((v?.matches ?? []).map((x) => [x.id, x])), [v]);

  const isOpen = (mk: Market | undefined) => {
    if (!mk || mk.status !== 'aberto') return false;
    if (mk.closesAt && Date.parse(mk.closesAt) <= Date.now()) return false;
    if (mk.matchId) { const m = mtById.get(mk.matchId); return !!m && m.status === 'agendado' && Date.parse(m.startsAt) > Date.now(); }
    return true;
  };

  const toggle = (sel: Selection, mk: Market, event: string) => {
    if (v?.readOnly) { toast('Jogo de exemplo: as apostas abrem quando a equipa agendar jogos reais.'); return; }
    if (!isOpen(mk)) return;
    const groupId = mk.matchId ?? `t:${mk.tournamentId}:${mk.id}`;
    setSlip((cur) => {
      if (cur.some((x) => x.selectionId === sel.id)) return cur.filter((x) => x.selectionId !== sel.id);
      const rest = cur.filter((x) => x.groupId !== groupId); // trocar seleção do mesmo jogo
      if (rest.length >= Math.min(v?.settings.maxLegs ?? 10, 10)) { toast('Máximo de 10 seleções no boletim.'); return cur; }
      if (rest.length < cur.length) toast('Substituído: só uma seleção por jogo no boletim.');
      return [...rest, { selectionId: sel.id, marketId: mk.id, groupId, label: sel.label, market: mk.title, event, odds: sel.odds }];
    });
  };

  const inSlip = (id: string) => slip.some((x) => x.selectionId === id);
  const ageOk = !!v?.me?.limits.ageConfirmedAt;
  const rOn = realOn(v?.settings);
  const curNow: Currency = rOn ? cur : 'pontos';
  const tabs = TABS.filter(([k]) => k !== 'carteira' || rOn);

  if (minor) return (
    <div className={theme === 'tz' ? 'bx' : 'bx'}>
      <BetsBanner className="mb-4" />
      <p className="bx-card p-5 text-sm">A tua conta indica menos de 18 anos. As apostas não estão disponíveis para ti.</p>
    </div>
  );

  return (
    <div className="bx">
      {rOn && (
        <div className="mb-3 grid grid-cols-2 gap-1 rounded-2xl border border-[var(--bx-line)] bg-[var(--bx-card)] p-1" role="radiogroup" aria-label="Modo de aposta">
          {([['pontos', 'TXAP Pontos (teste)'], ['mt', 'Dinheiro (MT)']] as const).map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={curNow === k} onClick={() => setCur(k)} className={`min-h-[44px] rounded-xl text-[14px] font-bold ${curNow === k ? 'bg-[var(--bx-acc)] text-[var(--bx-on)]' : 'text-white/75'}`}>{l}</button>
          ))}
        </div>
      )}
      <BetsBanner className="mb-3" cur={curNow} settings={v?.settings} />

      {/* Saldo */}
      <div className="bx-card mb-4 flex flex-wrap items-center gap-3 p-3.5">
        {curNow === 'mt' ? (
          <div className="min-w-0 flex-1">
            <p className="bx-muted text-[12.5px]">Saldo · dinheiro real</p>
            <p className="text-[22px] font-extrabold tabular-nums leading-tight">{v?.me ? fmtMt(v.me.balanceMt) : '—'}</p>
            <p className="bx-dim text-[12px]">{v?.me?.kyc?.status === 'aprovado' ? 'Identidade verificada' : 'Verifica a identidade em Carteira MT para apostar'}</p>
          </div>
        ) : (
        <div className="min-w-0 flex-1">
          <p className="bx-muted text-[12.5px]">Saldo · {POINTS}</p>
          <p className="text-[22px] font-extrabold tabular-nums leading-tight">{v?.me ? fmtPts(v.me.balance) : needLogin ? '—' : v?.readOnly ? '—' : '…'}</p>
          <p className="bx-dim text-[12px]">+{fmtPts(v?.settings.weeklyAllowance ?? 1000)} grátis por semana · sem valor em dinheiro</p>
        </div>
        )}
        {curNow === 'mt' && <button type="button" className="bx-ghost" onClick={() => setTab('carteira')}>Carteira</button>}
        {v?.example && <span className="bx-tag border border-white/25 bg-black/30 uppercase text-white/85">Dados de exemplo</span>}
        {needLogin && <Link href="/entrar" className="bx-btn">Entrar para apostar</Link>}
      </div>

      <div className="no-scrollbar tz-noscroll -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0" role="tablist" aria-label="Secções de apostas">
        {tabs.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className="bx-chip">{l}{k === 'minhas' && (v?.myBets.filter((b) => b.status === 'aberta').length ?? 0) > 0 ? ` · ${v!.myBets.filter((b) => b.status === 'aberta').length}` : ''}</button>
        ))}
      </div>

      {err && <p className="bx-card mb-4 p-4 text-sm">Não foi possível carregar as apostas ({err}). <button type="button" className="bx-acc font-semibold underline" onClick={reload}>Tentar outra vez</button></p>}

      <div className="grid items-start gap-5 md:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          {v && !v.settings.betsEnabled && (tab === 'jogos' || tab === 'torneio') ? (
            <p className="bx-card p-5 text-center text-sm">As apostas estão desativadas neste momento. O teu saldo e o histórico continuam disponíveis.</p>
          ) : !v ? <div className="space-y-3">{[0, 1, 2].map((k) => <div key={k} className="bx-card h-[120px] animate-pulse" />)}</div> : (
            <>
              {tab === 'jogos' && <Matches v={v} game={game} filter={filter} setFilter={setFilter} toggle={toggle} inSlip={inSlip} isOpen={isOpen} />}
              {tab === 'torneio' && <Outrights v={v} game={game} toggle={toggle} inSlip={inSlip} isOpen={isOpen} />}
              {tab === 'minhas' && <MyBets bets={v.myBets} needLogin={needLogin} />}
              {tab === 'carteira' && rOn && <MoneyWallet v={v} needLogin={needLogin} onChange={reload} />}
              {tab === 'responsavel' && <Responsible v={v} needLogin={needLogin} onChange={reload} />}
            </>
          )}
        </div>
        <aside className="hidden md:sticky md:top-[132px] md:block">
          <SlipPanel v={v} cur={curNow} slip={slip} setSlip={setSlip} ageOk={ageOk} onNeedAge={() => setAgeOpen(true)} onPlaced={reload} needLogin={needLogin} selById={selById} mkById={mkById} isOpen={isOpen} />
        </aside>
      </div>

      {/* Boletim no telemóvel: barra fixa + folha */}
      {slip.length > 0 && (
        <button type="button" onClick={() => setSlipOpen(true)}
          className={`bx-btn fixed inset-x-3 z-[47] !justify-between shadow-[0_12px_30px_-10px_rgba(0,0,0,.8)] md:hidden ${theme === 'tz' ? 'bottom-[calc(12px+env(safe-area-inset-bottom))]' : 'bottom-[calc(var(--nav-h,64px)+10px+env(safe-area-inset-bottom))]'}`}
          aria-label={`Abrir boletim com ${slip.length} seleções`}>
          <span className="flex items-center gap-2"><span className="flex h-7 min-w-[28px] items-center justify-center rounded-full bg-black/25 px-1.5 text-sm">{slip.length}</span> Boletim</span>
          <span className="tabular-nums">Odd {fmtOdds(comboOdds(slip.map((x) => x.odds)))}</span>
        </button>
      )}
      <Sheet open={slipOpen} onClose={() => setSlipOpen(false)} title="Boletim">
        <SlipPanel v={v} cur={curNow} slip={slip} setSlip={setSlip} ageOk={ageOk} onNeedAge={() => setAgeOpen(true)} onPlaced={() => { reload(); }} needLogin={needLogin} selById={selById} mkById={mkById} isOpen={isOpen} bare />
      </Sheet>
      <LicenceFooter settings={v?.settings} />
      <AgeSheet open={ageOpen} onClose={() => setAgeOpen(false)} onDone={() => { setAgeOpen(false); reload(); }} />
    </div>
  );
}

/* ---------------- Jogos ---------------- */
function OddBtn({ sel, mk, event, toggle, inSlip, open, label }: { sel: Selection; mk: Market; event: string; toggle: (s: Selection, m: Market, e: string) => void; inSlip: (id: string) => boolean; open: boolean; label?: string }) {
  const res = sel.result !== 'pendente' ? sel.result : null;
  return (
    <button type="button" className="bx-odd" aria-pressed={inSlip(sel.id)} disabled={!open && !res} onClick={() => toggle(sel, mk, event)}
      aria-label={`${label ?? sel.label}, odd ${fmtOdds(sel.odds)}${open ? '' : ', suspenso'}`}>
      <span className="bx-odd-l">{label ?? sel.label}</span>
      <span className="bx-odd-v">{res === 'ganha' ? '✓ ' : ''}{open || res ? fmtOdds(sel.odds) : ''}</span>
    </button>
  );
}

function statusLine(m: Match): { text: string; tone: string } {
  if (m.voided) return { text: m.status === 'adiado' ? 'Adiado +48 h · anulado e reembolsado' : 'Cancelado · apostas reembolsadas', tone: 'text-white/70' };
  if (m.status === 'terminado') return { text: `Final ${m.homeScore}-${m.awayScore}`, tone: 'text-white' };
  if (m.status === 'ao_vivo') return { text: 'A decorrer · apostas suspensas', tone: 'text-[#FCA5A5]' };
  if (m.status === 'adiado') return { text: 'Adiado · apostas suspensas', tone: 'text-[#FCD34D]' };
  return { text: fmtKick(m.startsAt), tone: 'bx-muted' };
}

function Matches({ v, game, filter, setFilter, toggle, inSlip, isOpen }: {
  v: BetsView; game?: BetGame; filter: 'todos' | BetGame; setFilter: (f: 'todos' | BetGame) => void;
  toggle: (s: Selection, m: Market, e: string) => void; inSlip: (id: string) => boolean; isOpen: (m: Market | undefined) => boolean;
}) {
  const [more, setMore] = useState<string | null>(null);
  const g = game ?? (filter === 'todos' ? null : filter);
  const list = v.matches.filter((m) => !g || m.game === g);
  const upcoming = list.filter((m) => !m.voided && (m.status === 'agendado' || m.status === 'ao_vivo' || m.status === 'adiado')).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const done = list.filter((m) => m.voided || m.status === 'terminado' || m.status === 'cancelado').sort((a, b) => b.startsAt.localeCompare(a.startsAt)).slice(0, 8);
  const marketsOf = (id: string) => v.markets.filter((mk) => mk.matchId === id);
  const selsOf = (id: string) => v.selections.filter((x) => x.marketId === id).sort((a, b) => a.sort - b.sort);

  const card = (m: Match) => {
    const mks = marketsOf(m.id);
    const main = mks.find((x) => x.kind === '1x2' || x.kind === '12');
    const extra = mks.filter((x) => x !== main);
    const ev = `${m.home} vs ${m.away}`;
    const st = statusLine(m);
    const mainOpen = isOpen(main);
    return (
      <article key={m.id} className="bx-card p-3.5">
        <div className="mb-2 flex items-center gap-2 text-[12px]">
          <span className="bx-tag shrink-0" style={{ background: GAMES_CFG[m.game]?.color, color: GAMES_CFG[m.game]?.onColor }}>{GAMES_CFG[m.game]?.abbr}</span>
          <span className="bx-muted min-w-0 flex-1 truncate">{m.tournamentName || gName(m.game)}</span>
          <span className={`shrink-0 font-semibold ${st.tone}`}>{st.text}</span>
        </div>
        <div className="mb-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <span className="flex min-w-0 items-center gap-2"><TeamBadge name={m.home} logo={v.teams[m.homeTeamId]?.logo} size={36} /><b className="min-w-0 text-[15px] leading-tight">{m.home}</b></span>
          <span className="bx-dim text-[12px] font-semibold">{m.status === 'terminado' ? `${m.homeScore}–${m.awayScore}` : 'vs'}</span>
          <span className="flex min-w-0 items-center justify-end gap-2 text-right"><b className="min-w-0 text-[15px] leading-tight">{m.away}</b><TeamBadge name={m.away} logo={v.teams[m.awayTeamId]?.logo} size={36} /></span>
        </div>
        {main && (
          <div className={`grid gap-2 ${main.kind === '1x2' ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {selsOf(main.id).map((x) => <OddBtn key={x.id} sel={x} mk={main} event={ev} toggle={toggle} inSlip={inSlip} open={mainOpen} label={x.code === 'X' ? 'Empate' : x.label} />)}
          </div>
        )}
        {extra.length > 0 && (
          <>
            <button type="button" onClick={() => setMore(more === m.id ? null : m.id)} className="bx-acc mt-1.5 flex min-h-[44px] w-full items-center justify-between text-[13.5px] font-semibold" aria-expanded={more === m.id}>
              <span>{more === m.id ? 'Menos mercados' : `+${extra.length} mercado${extra.length > 1 ? 's' : ''}: ${extra.map((x) => x.kind === 'total' ? 'Total' : 'Resultado exato').join(', ')}`}</span>
              <span aria-hidden>{more === m.id ? '▴' : '▾'}</span>
            </button>
            {more === m.id && extra.map((mk) => (
              <div key={mk.id} className="mt-2">
                <p className="bx-muted mb-1.5 text-[12.5px] font-semibold">{mk.title}{mk.status === 'anulado' ? ' · anulado' : ''}</p>
                <div className={`grid gap-2 ${mk.kind === 'exact' ? 'grid-cols-3 sm:grid-cols-4' : 'grid-cols-2'}`}>
                  {selsOf(mk.id).map((x) => <OddBtn key={x.id} sel={x} mk={mk} event={ev} toggle={toggle} inSlip={inSlip} open={isOpen(mk)} label={x.code === 'outro' ? 'Outro' : undefined} />)}
                </div>
              </div>
            ))}
          </>
        )}
      </article>
    );
  };

  return (
    <>
      {!game && (
        <div className="no-scrollbar tz-noscroll -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
          {GAME_FILTERS.map((f) => <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className="bx-chip !min-h-[40px] !text-[13px]">{f === 'todos' ? 'Todos' : gName(f)}</button>)}
        </div>
      )}
      {upcoming.length === 0 ? (
        <div className="bx-card p-5 text-center text-sm">
          <p className="font-semibold">Ainda não há jogos com apostas{g ? ` em ${gName(g)}` : ''}.</p>
          <p className="bx-muted mt-1">Quando um organizador agendar um jogo de um torneio, os mercados abrem automaticamente aqui.</p>
        </div>
      ) : <div className="space-y-3">{upcoming.map(card)}</div>}
      {done.length > 0 && (
        <>
          <h3 className="bx-muted mb-2 mt-6 text-[12px] font-bold uppercase tracking-wider">Resultados recentes</h3>
          <div className="space-y-3">{done.map(card)}</div>
        </>
      )}
      <p className="bx-dim mt-4 text-[12px] leading-relaxed">Odds calculadas por regras fixas (rating Elo das equipas + margem da casa). Os mercados fecham sozinhos na hora de início e são liquidados quando o organizador regista o resultado. Jogo cancelado ou adiado mais de 48 h = aposta anulada e pontos devolvidos.</p>
    </>
  );
}

/* ---------------- Vencedor do torneio ---------------- */
function Outrights({ v, game, toggle, inSlip, isOpen }: { v: BetsView; game?: BetGame; toggle: (s: Selection, m: Market, e: string) => void; inSlip: (id: string) => boolean; isOpen: (m: Market | undefined) => boolean }) {
  const list = v.markets.filter((m) => m.kind === 'outright' && (!game || m.game === game) && m.status !== 'anulado');
  if (!list.length) return <p className="bx-card p-5 text-center text-sm">Ainda não há torneios com mercado de vencedor. Abre assim que um torneio tiver jogos agendados com pelo menos duas equipas.</p>;
  return (
    <div className="space-y-3">
      {list.map((mk) => {
        const open = isOpen(mk);
        const sels = v.selections.filter((x) => x.marketId === mk.id).sort((a, b) => a.odds - b.odds);
        return (
          <article key={mk.id} className="bx-card p-3.5">
            <div className="mb-2 flex items-center gap-2 text-[12px]">
              <span className="bx-tag" style={{ background: GAMES_CFG[mk.game]?.color, color: GAMES_CFG[mk.game]?.onColor }}>{GAMES_CFG[mk.game]?.abbr}</span>
              <span className="bx-muted flex-1 truncate">Vencedor do torneio</span>
              <span className="bx-muted shrink-0 font-semibold">{mk.status === 'liquidado' ? 'Liquidado' : open ? (mk.closesAt ? `Fecha ${fmtKick(mk.closesAt)}` : 'Aberto') : 'Suspenso'}</span>
            </div>
            <p className="mb-2.5 text-[15.5px] font-bold">{mk.tournamentName || 'Torneio'}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {sels.map((x) => {
                const tm = Object.values(v.teams).find((t) => t.name === x.label && t.game === mk.game);
                return (
                  <div key={x.id} className="flex items-center gap-2">
                    <TeamBadge name={x.label} logo={tm?.logo} size={32} />
                    <div className="min-w-0 flex-1"><OddBtn sel={x} mk={mk} event={mk.tournamentName || 'Torneio'} toggle={toggle} inSlip={inSlip} open={open} /></div>
                  </div>
                );
              })}
            </div>
          </article>
        );
      })}
    </div>
  );
}

/* ---------------- Boletim ---------------- */
function SlipPanel({ v, cur, slip, setSlip, ageOk, onNeedAge, onPlaced, needLogin, selById, mkById, isOpen, bare }: {
  v: BetsView | null; cur: Currency; slip: SlipItem[]; setSlip: React.Dispatch<React.SetStateAction<SlipItem[]>>; ageOk: boolean; onNeedAge: () => void; onPlaced: () => void; needLogin: boolean;
  selById: Map<string, Selection>; mkById: Map<string, Market>; isOpen: (m: Market | undefined) => boolean; bare?: boolean;
}) {
  const { toast } = useStore();
  const [stakeTxt, setStakeTxt] = useState('100');
  const [mode, setMode] = useState<'multipla' | 'simples'>('multipla');
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState<Record<string, number> | null>(null);
  const [done, setDone] = useState('');
  const stake = Math.floor(Number(stakeTxt.replace(/\D/g, '')) || 0);
  const cfg = v?.settings ? cfgFor(v.settings, cur) : undefined;
  const fa = (n: number) => fmtAmount(n, cur);
  const multi = slip.length > 1 && mode === 'multipla';
  const total = multi ? comboOdds(slip.map((x) => x.odds)) : 0;
  const nBets = multi || slip.length <= 1 ? 1 : slip.length;
  const potential = !cfg ? 0 : multi ? potentialReturn(stake, total, cfg.maxPayout) : slip.reduce((a, x) => a + potentialReturn(stake, x.odds, cfg.maxPayout), 0);

  // odds/estado atuais (do servidor) para cada seleção do boletim
  const legsNow = slip.map((x) => { const sel = selById.get(x.selectionId); const mk = mkById.get(x.marketId); return { ...x, now: sel?.odds ?? x.odds, open: isOpen(mk) }; });
  const errors: SlipError[] = useMemo(() => {
    if (!cfg || !v?.me || !slip.length) return [];
    const legs = legsNow.map((l) => ({ selectionId: l.selectionId, groupId: multi ? l.groupId : l.selectionId, odds: l.now, open: l.open }));
    const check = multi || slip.length === 1 ? [legs] : legs.map((l) => [l]);
    let spent = 0; const out = new Set<SlipError>();
    const me = v.me;
    const bal = cur === 'mt' ? me.balanceMt : me.balance, td = cur === 'mt' ? me.mtStakedToday : me.stakedToday, wk = cur === 'mt' ? me.mtStakedWeek : me.stakedWeek;
    if (cur === 'mt' && me.kyc?.status !== 'aprovado') out.add('KYC');
    for (const g of check) {
      validateSlip(g, stake, cfg, limitsFor(me.limits, cur), { balance: bal - spent, stakedToday: td + spent, stakedWeek: wk + spent, now: Date.now() }).forEach((e) => out.add(e));
      spent += stake;
    }
    return [...out].filter((e) => e !== 'NO_AGE');
  }, [cfg, v, slip, stake, multi, cur]); // eslint-disable-line react-hooks/exhaustive-deps

  const place = async (accept = false) => {
    if (!v || !cfg) return;
    if (needLogin) { toast('Entra na tua conta para apostar.'); return; }
    if (!ageOk) { onNeedAge(); return; }
    if (errors.length) return;
    setBusy(true); setDone('');
    try {
      const groups = multi || slip.length === 1 ? [slip] : slip.map((x) => [x]);
      let placed = 0;
      for (const grp of groups) {
        const r = await betsApi.place({ selectionIds: grp.map((x) => x.selectionId), stake, odds: grp.map((x) => x.odds), acceptChanges: accept, currency: cur });
        if (r.ok) { placed++; setSlip((cur) => cur.filter((x) => !grp.some((g) => g.selectionId === x.selectionId))); continue; }
        if (r.code === 'ODDS_CHANGED' && r.odds) {
          setChanged(r.odds);
          setSlip((cur) => cur.map((x) => (r.odds![x.selectionId] != null ? { ...x, odds: Number(r.odds![x.selectionId]) } : x)));
          break;
        }
        toast(SLIP_ERROR_TEXT[r.code as SlipError] ?? RES_TEXT[r.code] ?? 'Não foi possível apostar.');
        break;
      }
      if (placed) { setChanged(null); setDone(placed > 1 ? `${placed} apostas registadas` : 'Aposta registada'); toast(cur === 'mt' ? 'Aposta registada em dinheiro real' : 'Aposta registada com TXAP Pontos'); onPlaced(); }
    } catch (e) { toast('Sem ligação: a aposta não foi registada. ' + ((e as Error).message || '')); }
    finally { setBusy(false); }
  };

  const body = (
    <>
      {!slip.length ? (
        <>
          {done && <p role="status" className="mb-3 rounded-xl bg-[#16A34A]/20 p-3 text-sm font-semibold text-[#86EFAC]">{done}</p>}
          <p className="bx-muted text-sm">Toca numa odd para a juntar ao boletim. Várias seleções de jogos diferentes formam uma múltipla (até 10).</p>
        </>
      ) : (
        <>
          <ul className="mb-3 space-y-2">
            {legsNow.map((l) => {
              const mt = v?.matches.find((m) => m.id === l.groupId);
              const team = mt && (l.label === mt.home ? mt.homeTeamId : l.label === mt.away ? mt.awayTeamId : null);
              const outrightTeam = !mt ? Object.values(v?.teams ?? {}).find((t) => t.name === l.label) : undefined;
              return (
              <li key={l.selectionId} className="bx-card2 flex items-start gap-2 p-2.5">
                {team ? <TeamBadge name={l.label} logo={v?.teams[team]?.logo} size={30} />
                  : outrightTeam ? <TeamBadge name={outrightTeam.name} logo={outrightTeam.logo} size={30} />
                  : mt ? <span className="flex shrink-0 -space-x-2"><TeamBadge name={mt.home} logo={v?.teams[mt.homeTeamId]?.logo} size={24} /><TeamBadge name={mt.away} logo={v?.teams[mt.awayTeamId]?.logo} size={24} /></span> : null}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold">{l.label}</p>
                  <p className="bx-muted truncate text-[12px]">{l.market} · {l.event}</p>
                  {!l.open && <p className="text-[12px] font-semibold text-[#FCA5A5]">Suspenso — retira esta seleção</p>}
                </div>
                <span className="bx-acc shrink-0 pt-0.5 text-[15px] font-extrabold tabular-nums">{fmtOdds(l.odds)}</span>
                <button type="button" onClick={() => setSlip((c) => c.filter((x) => x.selectionId !== l.selectionId))} className="-mr-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/70 hover:bg-white/10" aria-label={`Retirar ${l.label}`}>✕</button>
              </li>
              );
            })}
          </ul>
          {slip.length > 1 && (
            <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl border border-[var(--bx-line)] p-1" role="radiogroup" aria-label="Tipo de aposta">
              {(['multipla', 'simples'] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={`min-h-[44px] rounded-lg text-[13.5px] font-semibold ${mode === m ? 'bg-[var(--bx-acc)] text-[var(--bx-on)]' : 'text-white/75'}`}>
                  {m === 'multipla' ? `Múltipla (${slip.length})` : `${slip.length} simples`}
                </button>
              ))}
            </div>
          )}
          <label htmlFor="bx-stake" className="text-[13px] font-semibold">{cur === 'mt' ? (nBets > 1 ? 'MT por aposta' : 'Valor a apostar (MT)') : nBets > 1 ? 'Pontos por aposta' : 'Pontos a apostar'}</label>
          <input id="bx-stake" className="bx-input mt-1.5" inputMode="numeric" value={stakeTxt} onChange={(e) => setStakeTxt(e.target.value.replace(/\D/g, '').slice(0, 7))} aria-describedby="bx-stake-help" />
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {[50, 100, 250, 500].map((q) => <button key={q} type="button" className="bx-ghost !min-h-[44px] !px-0 !text-[13px]" onClick={() => setStakeTxt(String(q))}>{q}</button>)}
          </div>
          <p id="bx-stake-help" className="bx-dim mt-1.5 text-[11.5px]">Mín. {cfg?.minStake} · máx. {cfg?.maxStake?.toLocaleString('pt-PT')} por aposta · pagamento máx. {cfg ? fa(cfg.maxPayout) : ''}</p>
          <div className="mt-3 space-y-1 border-t border-[var(--bx-line)] pt-3 text-sm">
            {multi && <p className="flex justify-between"><span className="bx-muted">Odd total</span><b className="tabular-nums">{fmtOdds(total)}</b></p>}
            {nBets > 1 && <p className="flex justify-between"><span className="bx-muted">Total apostado</span><b className="tabular-nums">{fa(stake * nBets)}</b></p>}
            <p className="flex justify-between"><span className="bx-muted">Retorno possível</span><b className="bx-acc text-base tabular-nums">{fa(potential)}</b></p>
          </div>
          {changed && (
            <div role="alert" className="mt-3 rounded-xl border border-[#F59E0B]/60 bg-[#F59E0B]/10 p-3 text-[13px]">
              <p className="font-semibold text-[#FCD34D]">As odds mudaram desde que escolheste.</p>
              <p className="bx-muted mt-0.5">O boletim já mostra as novas odds. Aceitas apostar com elas?</p>
            </div>
          )}
          {errors.length > 0 && <ul className="mt-3 space-y-1 text-[13px] text-[#FCA5A5]">{errors.map((e) => <li key={e}>• {SLIP_ERROR_TEXT[e]}</li>)}</ul>}
          <button type="button" className="bx-btn mt-4 w-full" disabled={busy || !v || errors.length > 0 || stake <= 0} onClick={() => place(!!changed)}>
            {busy ? 'A registar…' : needLogin ? 'Entrar para apostar' : !ageOk ? 'Confirmar 18+ e apostar' : changed ? 'Aceitar novas odds e apostar' : `Apostar ${fa(stake * nBets)}`}
          </button>
          <button type="button" className="bx-dim mt-1 min-h-[44px] w-full text-[13px]" onClick={() => { setSlip([]); setChanged(null); }}>Limpar boletim</button>
        </>
      )}
      <p className="bx-dim mt-2 text-center text-[11.5px]">{cur === 'mt' ? 'Aposta em dinheiro real. Define limites em Jogo responsável.' : 'TXAP Pontos não têm valor em dinheiro, não se compram nem se levantam.'}</p>
    </>
  );
  if (bare) return body;
  return (
    <div className="bx-card p-4">
      <p className="mb-3 flex items-center justify-between text-base font-bold">Boletim {slip.length > 0 && <span className="bx-tag bg-[var(--bx-acc)] text-[var(--bx-on)]">{slip.length}</span>}</p>
      {body}
    </div>
  );
}

/* ---------------- 18+ ---------------- */
function AgeSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { s, toast } = useStore();
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = await betsApi.confirmAge(s.account.birth || null);
      if (r.ok) { toast('Idade confirmada.'); onDone(); } else toast(RES_TEXT[r.code] ?? 'Não foi possível confirmar.');
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Só para maiores de 18 anos">
      <p className="bx-muted text-sm">Antes da primeira aposta tens de confirmar que tens 18 anos ou mais. Se a data de nascimento da tua conta indicar menos de 18, a confirmação é recusada.</p>
      <label className="mt-4 flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border border-[var(--bx-line)] p-3 text-sm">
        <input type="checkbox" className="h-5 w-5 shrink-0" checked={ok} onChange={(e) => setOk(e.target.checked)} />
        Confirmo que tenho 18 anos ou mais e que aposto só com TXAP Pontos (sem dinheiro).
      </label>
      <button type="button" className="bx-btn mt-4 w-full" disabled={!ok || busy} onClick={go}>{busy ? 'A confirmar…' : 'Confirmar'}</button>
    </Sheet>
  );
}

/* ---------------- Histórico ---------------- */
const BET_TONE: Record<string, string> = { aberta: 'bg-white/15 text-white', ganha: 'bg-[#16A34A] text-white', perdida: 'bg-[#7F1D1D] text-white', anulada: 'bg-[#52525B] text-white' };
const BET_LABEL: Record<string, string> = { aberta: 'Em aberto', ganha: 'Ganha', perdida: 'Perdida', anulada: 'Anulada · reembolsada' };
const LEG_ICON: Record<string, string> = { pendente: '·', ganha: '✓', perdida: '✕', anulada: '↺' };

export function BetRow({ b, who }: { b: MyBet; who?: string }) {
  return (
    <article className="bx-card p-3.5">
      <div className="mb-2 flex items-center gap-2">
        <span className={`bx-tag ${BET_TONE[b.status]}`}>{BET_LABEL[b.status]}</span>
        {b.currency === 'mt' && <span className="bx-tag bg-[#16A34A] text-white">MT</span>}
        <span className="bx-muted flex-1 truncate text-[12.5px]">{b.kind === 'multipla' ? `Múltipla · ${b.legs.length} seleções` : 'Simples'}{who ? ` · ${who}` : ''}</span>
        <span className="bx-dim shrink-0 text-[12px]">{fmtKick(b.createdAt)}</span>
      </div>
      <ul className="space-y-1">
        {b.legs.map((l) => (
          <li key={l.selectionId} className="flex items-start gap-2 text-[13.5px]">
            <span aria-label={l.result} className="shrink-0">{LEG_ICON[l.result]}</span>
            <span className="min-w-0 flex-1"><b>{l.label}</b> <span className="bx-muted">· {l.market} · {l.event}</span></span>
            <span className="shrink-0 tabular-nums">{fmtOdds(l.result === 'anulada' ? 1 : l.odds)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2.5 flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-[var(--bx-line)] pt-2 text-[13px]">
        <span className="bx-muted">Aposta <b className="text-white">{fmtAmount(b.stake, b.currency ?? 'pontos')}</b> · odd <b className="text-white">{fmtOdds(b.totalOdds)}</b></span>
        <span>{b.status === 'aberta' ? <>Retorno possível <b className="bx-acc">{fmtAmount(b.potential, b.currency ?? 'pontos')}</b></> : <>Recebido <b className={b.payout > 0 ? 'bx-acc' : ''}>{fmtAmount(b.payout, b.currency ?? 'pontos')}</b></>}</span>
      </div>
    </article>
  );
}

function MyBets({ bets, needLogin }: { bets: MyBet[]; needLogin: boolean }) {
  const [f, setF] = useState<'todas' | 'aberta' | 'fechadas'>('todas');
  if (needLogin) return <p className="bx-card p-5 text-center text-sm">Entra na tua conta para ver o histórico das tuas apostas.</p>;
  const list = bets.filter((b) => f === 'todas' || (f === 'aberta' ? b.status === 'aberta' : b.status !== 'aberta'));
  const P = bets.filter((b) => (b.currency ?? 'pontos') === 'pontos');
  const staked = P.reduce((a, b) => a + b.stake, 0); const back = P.reduce((a, b) => a + b.payout, 0);
  return (
    <>
      <div className="mb-3 grid grid-cols-3 gap-2">
        {[['Apostas', String(bets.length)], ['Apostado', fmtPts(staked)], ['Recebido', fmtPts(back)]].map(([k, val]) => (
          <div key={k} className="bx-card p-3"><p className="bx-muted text-[12px]">{k}</p><p className="text-[15px] font-bold tabular-nums">{val}</p></div>
        ))}
      </div>
      <div className="mb-3 flex gap-2">
        {([['todas', 'Todas'], ['aberta', 'Em aberto'], ['fechadas', 'Fechadas']] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={f === k} onClick={() => setF(k)} className="bx-chip !min-h-[40px] !text-[13px]">{l}</button>)}
      </div>
      {list.length === 0 ? <p className="bx-card p-5 text-center text-sm">Ainda não tens apostas{f !== 'todas' ? ' nesta lista' : ''}.</p> : <div className="space-y-3">{list.map((b) => <BetRow key={b.id} b={b} />)}</div>}
    </>
  );
}

/* ---------------- Jogo responsável ---------------- */
function Responsible({ v, needLogin, onChange }: { v: BetsView; needLogin: boolean; onChange: () => void }) {
  const { toast } = useStore();
  const lim = v.me?.limits;
  const [a, setA] = useState(''); const [d, setD] = useState(''); const [w, setW] = useState('');
  const [ma, setMa] = useState(''); const [md, setMd] = useState(''); const [mw, setMw] = useState('');
  const str = (x?: number | null) => (x ? String(x) : '');
  useEffect(() => { setA(str(lim?.maxStake)); setD(str(lim?.maxDaily)); setW(str(lim?.maxWeekly)); setMa(str(lim?.mtMaxStake)); setMd(str(lim?.mtMaxDaily)); setMw(str(lim?.mtMaxWeekly)); },
    [lim?.maxStake, lim?.maxDaily, lim?.maxWeekly, lim?.mtMaxStake, lim?.mtMaxDaily, lim?.mtMaxWeekly]);
  const rOn = realOn(v.settings);
  if (needLogin || !v.me) return <p className="bx-card p-5 text-center text-sm">Entra na tua conta para definir limites e autoexclusão.</p>;
  const n = (x: string) => (x.trim() ? Math.max(1, Math.floor(Number(x.replace(/\D/g, '')) || 0)) : null);
  const excluded = lim?.selfExcludedUntil && Date.parse(lim.selfExcludedUntil) > Date.now();
  const save = async () => {
    const r = await betsApi.setLimits({ maxStake: n(a), maxDaily: n(d), maxWeekly: n(w), mtMaxStake: n(ma), mtMaxDaily: n(md), mtMaxWeekly: n(mw) }).catch((e) => ({ ok: false as const, code: (e as Error).message }));
    toast(r.ok ? 'Limites guardados.' : RES_TEXT[r.code] ?? 'Erro'); if (r.ok) onChange();
  };
  const exclude = async (days: number) => {
    if (!window.confirm(`Autoexclusão por ${days} dias: não vais poder apostar até ao fim do período e não é possível cancelar. Continuar?`)) return;
    const r = await betsApi.selfExclude(days).catch((e) => ({ ok: false as const, code: (e as Error).message }));
    toast(r.ok ? `Autoexclusão ativa por ${days} dias.` : RES_TEXT[r.code] ?? 'Erro'); if (r.ok) onChange();
  };
  return (
    <div className="space-y-4">
      <section className="bx-card p-4">
        <h3 className="text-base font-bold">Os meus limites</h3>
        <p className="bx-muted mt-1 text-[13px]">Deixa em branco para não ter limite pessoal. Hoje apostaste {fmtPts(v.me.stakedToday)}; esta semana {fmtPts(v.me.stakedWeek)}.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {([['Por aposta', a, setA], ['Por dia', d, setD], ['Por semana', w, setW]] as const).map(([l, val, set]) => (
            <label key={l} className="text-[13px] font-semibold">{l} (pts)
              <input className="bx-input mt-1" inputMode="numeric" value={val} placeholder="Sem limite" onChange={(e) => set(e.target.value.replace(/\D/g, '').slice(0, 7))} />
            </label>
          ))}
        </div>
        {rOn && (
          <>
            <p className="mt-4 text-[13px] font-bold">Dinheiro real (MT)</p>
            <p className="bx-muted text-[12.5px]">Hoje {fmtMt(v.me.mtStakedToday)} · esta semana {fmtMt(v.me.mtStakedWeek)}.</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              {([['Por aposta', ma, setMa], ['Por dia', md, setMd], ['Por semana', mw, setMw]] as const).map(([l, val, set]) => (
                <label key={l} className="text-[13px] font-semibold">{l} (MT)
                  <input className="bx-input mt-1" inputMode="numeric" value={val} placeholder="Sem limite" onChange={(e) => set(e.target.value.replace(/\D/g, '').slice(0, 7))} />
                </label>
              ))}
            </div>
          </>
        )}
        <button type="button" className="bx-btn mt-3 w-full sm:w-auto" onClick={save}>Guardar limites</button>
      </section>
      <section className="bx-card p-4">
        <h3 className="text-base font-bold">Autoexclusão</h3>
        {excluded ? <p className="mt-1 text-sm text-[#FCD34D]">Autoexclusão ativa até {new Date(lim!.selfExcludedUntil!).toLocaleString('pt-PT', { dateStyle: 'medium', timeStyle: 'short' })}.</p>
          : <p className="bx-muted mt-1 text-[13px]">Faz uma pausa nas apostas (pontos e dinheiro). Durante o período não consegues apostar e não dá para encurtar. Podes sempre levantar o saldo em MT.</p>}
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[7, 30, 90].map((x) => <button key={x} type="button" className="bx-ghost" onClick={() => exclude(x)}>{x} dias</button>)}
        </div>
      </section>
      <section className="bx-card p-4 text-[13px] leading-relaxed">
        <h3 className="mb-1 text-base font-bold">Joga com cabeça</h3>
        <p className="bx-muted">{rOn ? 'Aposta só o que podes perder. Os pontos são para treinar; o dinheiro real tem limites que tu controlas.' : 'As apostas aqui são um jogo com pontos virtuais, sem dinheiro.'} Se sentires que estás a perder o controlo, faz uma pausa, fala com alguém de confiança ou usa a página <Link href="/bem-estar" className="bx-acc font-semibold underline">Bem-estar</Link>.</p>
      </section>
    </div>
  );
}

/* ---------------- Carteira MT (dinheiro real) ---------------- */
const WD_LABEL: Record<string, string> = { pendente: 'Pendente', pago: 'Pago', recusado: 'Recusado · devolvido' };
const LEDGER_LABEL: Record<string, string> = { deposito: 'Depósito', levantamento: 'Levantamento (reservado)', levantamento_recusado: 'Levantamento devolvido', aposta: 'Aposta', ganho: 'Ganho', reembolso: 'Reembolso', correcao: 'Correção', ajuste: 'Ajuste' };

function MoneyWallet({ v, needLogin, onChange }: { v: BetsView; needLogin: boolean; onChange: () => void }) {
  const { s, toast } = useStore();
  const [mv, setMv] = useState<MoneyView | null>(null);
  const [k, setK] = useState({ fullName: '', birthDate: s.account.birth || '', idType: 'BI' as IdType, idNumber: '', phone: s.account.phone || '' });
  const [amt, setAmt] = useState(''); const [method, setMethod] = useState<'M-Pesa' | 'e-Mola'>('M-Pesa'); const [ph, setPh] = useState('');
  const load = useCallback(() => { betsApi.myMoney().then(setMv).catch(() => setMv({ ledger: [], withdrawals: [] })); }, []);
  useEffect(() => { if (!needLogin) load(); }, [load, needLogin]);
  if (needLogin || !v.me) return <p className="bx-card p-5 text-center text-sm">Entra na tua conta para usar a carteira em MT.</p>;
  const kyc = v.me.kyc;
  const today = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
  const kErr = validateKyc(k, today);
  const sendKyc = async () => {
    const r = await betsApi.submitKyc(k).catch((e) => ({ ok: false as const, code: (e as Error).message }));
    toast(r.ok ? 'Dados enviados. A equipa vai verificar.' : RES_TEXT[r.code] ?? r.code); if (r.ok) onChange();
  };
  const withdraw = async () => {
    const r = await betsApi.withdraw(Math.floor(Number(amt) || 0), method, ph).catch((e) => ({ ok: false as const, code: (e as Error).message }));
    toast(r.ok ? 'Pedido de levantamento enviado. O valor fica reservado até a equipa pagar.' : RES_TEXT[r.code] ?? r.code);
    if (r.ok) { setAmt(''); onChange(); load(); }
  };
  return (
    <div className="space-y-4">
      <section className="bx-card p-4">
        <h3 className="text-base font-bold">Verificação de identidade (KYC)</h3>
        {kyc?.status === 'aprovado' ? <p className="mt-1 text-sm text-[#86EFAC]">✓ Identidade verificada ({kyc.fullName}).</p> : (
          <>
            {kyc?.status === 'pendente' && <p className="mt-1 text-sm text-[#FCD34D]">Em análise pela equipa. Podes corrigir e reenviar.</p>}
            {kyc?.status === 'recusado' && <p className="mt-1 text-sm text-[#FCA5A5]">Recusado{kyc.note ? `: ${kyc.note}` : ''}. Corrige e reenvia.</p>}
            {!kyc && <p className="bx-muted mt-1 text-[13px]">Obrigatório para apostar, depositar e levantar dinheiro. Só para maiores de 18.</p>}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-[13px] font-semibold sm:col-span-2">Nome completo (como no documento)<input className="bx-input mt-1" value={k.fullName} maxLength={80} autoComplete="name" onChange={(e) => setK({ ...k, fullName: e.target.value })} /></label>
              <label className="text-[13px] font-semibold">Data de nascimento<input type="date" className="bx-input mt-1" value={k.birthDate} onChange={(e) => setK({ ...k, birthDate: e.target.value })} /></label>
              <label className="text-[13px] font-semibold">Documento
                <select className="bx-input mt-1" value={k.idType} onChange={(e) => setK({ ...k, idType: e.target.value as IdType })}><option value="BI">BI</option><option value="NUIT">NUIT</option></select>
              </label>
              <label className="text-[13px] font-semibold">Número do {k.idType}<input className="bx-input mt-1" value={k.idNumber} maxLength={20} placeholder={k.idType === 'BI' ? '110100123456A' : '123456789'} onChange={(e) => setK({ ...k, idNumber: e.target.value })} /></label>
              <label className="text-[13px] font-semibold">Telefone M-Pesa/e-Mola<input type="tel" inputMode="tel" className="bx-input mt-1" value={k.phone} placeholder="84 123 4567" onChange={(e) => setK({ ...k, phone: e.target.value })} /></label>
            </div>
            {kErr.length > 0 && (k.fullName || k.idNumber) && <ul className="mt-2 space-y-0.5 text-[12.5px] text-[#FCA5A5]">{kErr.map((e) => <li key={e}>• {e}</li>)}</ul>}
            <button type="button" className="bx-btn mt-3 w-full sm:w-auto" disabled={kErr.length > 0} onClick={sendKyc}>Enviar para verificação</button>
          </>
        )}
      </section>
      <section className="bx-card p-4">
        <h3 className="text-base font-bold">Depositar</h3>
        <p role="status" className="mt-2 rounded-xl border border-[#F59E0B]/50 bg-[#F59E0B]/10 p-3 text-[13px] text-[#FCD34D]">{AUTO_DEPOSIT_PENDING}.</p>
        <p className="bx-muted mt-2 text-[13px]">Por agora os depósitos são confirmados manualmente pela equipa TXAPILOG: depois de pagares pelo canal oficial indicado pela equipa, envia a referência da transação pelo suporte. O saldo aparece aqui quando a equipa confirmar. Nada é cobrado automaticamente.</p>
      </section>
      <section className="bx-card p-4">
        <h3 className="text-base font-bold">Levantar</h3>
        <p className="bx-muted mt-1 text-[13px]">Saldo {fmtMt(v.me.balanceMt)} · mínimo {fmtMt(v.settings.mtMinWithdraw)} · máximo {fmtMt(v.settings.mtMaxWithdrawDaily)} por dia. O valor fica reservado até a equipa fazer a transferência.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-[13px] font-semibold">Valor (MT)<input className="bx-input mt-1" inputMode="numeric" value={amt} onChange={(e) => setAmt(e.target.value.replace(/\D/g, '').slice(0, 7))} /></label>
          <label className="text-[13px] font-semibold">Para
            <select className="bx-input mt-1" value={method} onChange={(e) => setMethod(e.target.value as 'M-Pesa' | 'e-Mola')}><option>M-Pesa</option><option>e-Mola</option></select>
          </label>
          <label className="text-[13px] font-semibold">Número<input type="tel" inputMode="tel" className="bx-input mt-1" value={ph} placeholder="84 123 4567" onChange={(e) => setPh(e.target.value)} /></label>
        </div>
        <button type="button" className="bx-btn mt-3 w-full sm:w-auto" disabled={kyc?.status !== 'aprovado' || !amt || !ph} onClick={withdraw}>Pedir levantamento</button>
        {mv && mv.withdrawals.length > 0 && (
          <ul className="mt-3 space-y-1.5 text-[13px]">
            {mv.withdrawals.map((w) => <li key={w.id} className="bx-card2 flex justify-between gap-2 p-2.5"><span>{fmtMt(w.amount)} · {w.method} {w.phone}</span><span className="bx-muted">{WD_LABEL[w.status]}{w.reference ? ` · ${w.reference}` : ''}</span></li>)}
          </ul>
        )}
      </section>
      <section className="bx-card p-4">
        <h3 className="mb-2 text-base font-bold">Movimentos em MT</h3>
        {!mv ? <div className="bx-card2 h-16 animate-pulse" /> : mv.ledger.length === 0 ? <p className="bx-muted text-sm">Ainda sem movimentos.</p> : (
          <ul className="space-y-1 text-[13px]">
            {mv.ledger.map((r) => <li key={r.id} className="flex justify-between gap-2 border-b border-[var(--bx-line)] py-1.5 last:border-0"><span>{LEDGER_LABEL[r.reason] ?? r.reason}<span className="bx-dim"> · {fmtKick(r.createdAt)}</span></span><span className={`tabular-nums font-semibold ${r.delta > 0 ? 'text-[#86EFAC]' : ''}`}>{r.delta > 0 ? '+' : ''}{fmtMt(r.delta)}</span></li>)}
          </ul>
        )}
      </section>
    </div>
  );
}
