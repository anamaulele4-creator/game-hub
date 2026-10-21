'use client';

// Apostas v2 — apostas individuais com saldo de TESTE. Valor escolhido pelo utilizador; a odd fica trancada na
// confirmação (se mudou entretanto, o servidor recusa e mostramos a odd nova para confirmar outra vez).
import { useCallback, useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { IS_DEMO } from '@/lib/config';
import { GAMES_CFG } from '@/lib/jogos';
import { V2Res, V2_BANNER, V2_RESULT_NAMES, fmtOddsV2, fmtTest, isOpenBet, potentialV2, v2ErrText, validateStakeV2 } from '@/lib/apostasV2';
import { V2MarketView, V2Me, V2MyBet, V2SelView, apostasV2Api, newRequestId } from '@/lib/apostasV2Api';
import { BxSheet as Sheet } from '@/components/BxSheet';

const gName = (g: string) => (GAMES_CFG as Record<string, { short?: string }>)[g]?.short ?? 'Outros';
const fmtWhen = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }) : '');

export function ApostasDesativadas({ installed = true }: { installed?: boolean }) {
  return (
    <div className="bx bx-pm">
      <div className="bx-card p-6 text-center">
        <p className="text-4xl" aria-hidden>⏸️</p>
        <h2 className="mt-2 text-lg font-bold">Apostas desativadas</h2>
        <p className="bx-muted mt-1 text-[14px]">As apostas estão desligadas neste momento. Volta mais tarde — avisamos quando abrirem.</p>
        {!installed && IS_DEMO === false && <p className="bx-dim mt-3 text-[12px]">(Admin: instala o SQL em sql-apostas.html e liga em Admin › Apostas.)</p>}
      </div>
    </div>
  );
}

export default function ApostasV2() {
  const { s, ready, toast } = useStore();
  const [me, setMe] = useState<V2Me | null>(null);
  const [markets, setMarkets] = useState<V2MarketView[] | null>(null);
  const [bets, setBets] = useState<V2MyBet[]>([]);
  const [tab, setTab] = useState<'mercados' | 'minhas'>('mercados');
  const [pick, setPick] = useState<{ m: V2MarketView; s: V2SelView } | null>(null);
  const [err, setErr] = useState('');

  const reload = useCallback(async () => {
    try {
      setErr('');
      const [a, b, c] = await Promise.all([apostasV2Api.me(), apostasV2Api.markets(), apostasV2Api.myBets()]);
      setMe(a); setMarkets(b); setBets(c);
    } catch (e) { setErr(v2ErrText((e as Error).message)); }
  }, []);
  useEffect(() => { if (ready) void reload(); }, [ready, s.account.loggedIn, reload]);

  if (!me || !markets) return err ? <p className="bx-card p-4 text-sm">{err}</p> : <div className="space-y-3">{[0, 1].map((k) => <div key={k} className="h-28 animate-pulse rounded-xl bg-[#232326]" />)}</div>;
  if (!me.enabled) return <ApostasDesativadas installed={me.installed} />;

  const claim = async () => { const r = await apostasV2Api.claim(); if (r.ok) { toast('Saldo de teste creditado.'); void reload(); } else toast(v2ErrText(r.code)); };

  return (
    <div className="bx bx-pm">
      <div role="note" className="bx-banner mb-3 p-3 text-[13.5px] leading-snug"><b>Apostas v2 · teste.</b> {V2_BANNER}</div>
      <div className="bx-card mb-3 flex items-center justify-between gap-3 p-4">
        <div><p className="bx-muted text-[12px]">O teu saldo de teste</p><p className="text-xl font-bold">{fmtTest(me.balance)}</p></div>
        {me.loggedIn && !me.claimed && <button type="button" className="bx-btn !w-auto px-4" onClick={claim}>Receber {fmtTest(me.limits.initial_test_balance)}</button>}
        {!me.loggedIn && <span className="bx-muted text-[13px]">Entra na tua conta para apostar.</span>}
      </div>
      <div className="mb-3 flex gap-2" role="tablist">
        {([['mercados', 'Mercados'], ['minhas', `As minhas apostas${bets.length ? ` · ${bets.length}` : ''}`]] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className="bx-chip" onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'mercados' && (markets.length === 0 ? <p className="bx-card p-4 text-center text-sm">Ainda não há mercados abertos.</p> : (
        <div className="space-y-3">
          {markets.map((m) => (
            <section key={m.id} className="bx-card p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div><span className="bx-tag mr-2">{gName(m.game)}</span><b className="text-[15px]">{m.title}</b></div>
                {m.status === 'suspenso' && <span className="bx-tag">Suspenso</span>}
              </div>
              {m.closesAt && <p className="bx-dim mb-2 text-[12px]">Fecha: {fmtWhen(m.closesAt)}</p>}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {m.selections.map((x) => (
                  <button key={x.id} type="button" className="bx-odd" disabled={m.status !== 'aberto' || !me.loggedIn} onClick={() => setPick({ m, s: x })} aria-label={`${x.label}, odd ${fmtOddsV2(x.odds)}`}>
                    <span className="bx-odd-l truncate">{x.label}</span><span className="bx-odd-v font-bold">{fmtOddsV2(x.odds)}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      ))}
      {tab === 'minhas' && (bets.length === 0 ? <p className="bx-card p-4 text-center text-sm">Ainda não fizeste apostas.</p> : (
        <ul className="space-y-2">
          {bets.map((b) => (
            <li key={b.id} className="bx-card p-3 text-[13.5px]">
              <div className="flex justify-between gap-2"><b>{b.label}</b><span className="bx-tag">{V2_RESULT_NAMES[b.status]}</span></div>
              <p className="bx-muted">{b.market}</p>
              <p className="mt-1">Valor {fmtTest(b.stake)} · odd {fmtOddsV2(b.oddsLocked)} (trancada) · retorno {fmtTest(isOpenBet(b.status) ? b.potential : b.payout)}</p>
              <p className="bx-dim text-[11.5px]">{fmtWhen(b.createdAt)}</p>
            </li>
          ))}
        </ul>
      ))}
      {pick && <Slip key={pick.s.id} pick={pick} me={me} onClose={() => setPick(null)} onDone={() => { setPick(null); setTab('minhas'); void reload(); }} onRefresh={reload} />}
    </div>
  );
}

function Slip({ pick, me, onClose, onDone, onRefresh }: { pick: { m: V2MarketView; s: V2SelView }; me: V2Me; onClose: () => void; onDone: () => void; onRefresh: () => void }) {
  const { toast } = useStore();
  const [stake, setStake] = useState('');
  const [odds, setOdds] = useState(pick.s.odds);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [req] = useState(newRequestId);
  const n = Number(stake.replace(',', '.'));
  const code = stake ? validateStakeV2(n, me.limits, me.balance) : null;
  const confirm = async () => {
    setBusy(true);
    const r: V2Res = await apostasV2Api.place(pick.s.id, n, odds, req).catch((e) => ({ ok: false as const, code: (e as Error).message }));
    setBusy(false);
    if (r.ok) { toast(`Aposta confirmada com odd ${fmtOddsV2(Number(r.odds))}.`); onDone(); return; }
    if (r.code === 'ODDS_CHANGED' && r.odds != null) { setOdds(Number(r.odds)); setChanged(true); onRefresh(); return; }
    toast(v2ErrText(r.code) + (r.code === 'STAKE_MIN' ? ` (${me.limits.min_stake})` : r.code === 'STAKE_MAX' ? ` (${me.limits.max_stake})` : ''));
  };
  return (
    <Sheet open onClose={onClose} title="Confirmar aposta">
      <div className="space-y-3">
        <p className="text-[14px]"><b>{pick.s.label}</b><br /><span className="bx-muted">{pick.m.title}</span></p>
        <p className="text-[14px]">Odd: <b>{fmtOddsV2(odds)}</b> <span className="bx-dim">— fica trancada ao confirmar</span></p>
        {changed && <p role="alert" className="rounded-lg bg-[#B45309]/30 p-2 text-[13px]">A odd mudou para <b>{fmtOddsV2(odds)}</b>. Confirma de novo se aceitas a odd nova.</p>}
        <label className="block text-[13px] font-semibold">Valor (pontos de teste)
          <input className="bx-input mt-1" inputMode="numeric" value={stake} placeholder={`${me.limits.min_stake} – ${Math.min(me.limits.max_stake, me.balance)}`} onChange={(e) => setStake(e.target.value.replace(/[^\d]/g, '').slice(0, 7))} />
        </label>
        <p className="bx-muted text-[12.5px]">Mín. {fmtTest(me.limits.min_stake)} · máx. {fmtTest(me.limits.max_stake)} · saldo {fmtTest(me.balance)}</p>
        {code && <p className="text-[13px] text-[#FCA5A5]">{v2ErrText(code)}</p>}
        {!code && n > 0 && <p className="text-[14px]">Retorno se ganhar: <b>{fmtTest(potentialV2(n, odds))}</b></p>}
        <button type="button" className="bx-btn w-full" disabled={busy || !stake || !!code} onClick={confirm}>{busy ? 'A confirmar…' : changed ? `Confirmar com odd ${fmtOddsV2(odds)}` : 'Confirmar aposta'}</button>
      </div>
    </Sheet>
  );
}
