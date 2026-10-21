'use client';

// Painel de valor da aposta, estilo Aviator: abre quando se toca em 1 ou 2. Mostra equipa, jogo e odd, um campo grande
// com − / +, chips rápidos (10, 20, 50, 100, 500 MT e Máx. = saldo), retorno e lucro em tempo real, APOSTAR → confirmar.
// Coloca a aposta pelo caminho que a página já usa (betsApi.place → RPC bets_place, moeda 'mt'); o servidor valida tudo.
// Depois de confirmada a aposta é irrevogável: aqui só se pode mudar ou retirar a seleção ANTES de confirmar.
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { cfgFor, fmtMt, fmtOdds, limitsFor } from '@/lib/bets';
import type { BetsView } from '@/lib/betsApi';
import { RES_TEXT, betsApi } from '@/lib/betsApi';
import {
  PLACE_CODE_TEXT, STAKE_ISSUE_TEXT, StakeCtx, clampStake, maxAllowed, parseStake, stakeChips, stakeIssues, stakeMath, stepStake,
} from '@/lib/stake';
import { BxSheet as Sheet } from '@/components/BxSheet';
import { TeamBadge } from '@/components/TeamBadge';
import { useRequireAuth } from '@/lib/useRequireAuth';

export interface StakeItem { selectionId: string; marketId: string; groupId: string; label: string; market: string; event: string; odds: number; stake?: number }

export function StakeSheet({ v, item, closed, open, onClose, onStake, onRemove, onPlaced, onOddsChanged, needLogin, ageOk, onNeedAge, onWallet, slipCount }: {
  v: BetsView | null; item: StakeItem | null; closed: string | null; open: boolean; onClose: () => void;
  onStake: (stake: number) => void; onRemove: () => void; onPlaced: () => void; onOddsChanged: (odds: number) => void;
  needLogin: boolean; ageOk: boolean; onNeedAge: () => void; onWallet: () => void; slipCount: number;
}) {
  const { toast } = useStore();
  const requireAuth = useRequireAuth();
  const [txt, setTxt] = useState('');
  const [step, setStep] = useState<'valor' | 'confirmar' | 'feito'>('valor');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; wallet?: boolean } | null>(null);
  const [oddsMoved, setOddsMoved] = useState(false);

  const me = v?.me ?? null;
  const ctx: StakeCtx | null = useMemo(() => {
    if (!v) return null;
    return {
      cfg: cfgFor(v.settings, 'mt'),
      limits: me ? limitsFor(me.limits, 'mt') : null,
      balance: me ? me.balanceMt : null,
      stakedToday: me?.mtStakedToday ?? 0, stakedWeek: me?.mtStakedWeek ?? 0,
    };
  }, [v, me]);

  // valor próprio de cada seleção (fica guardado no boletim)
  useEffect(() => {
    if (!open || !item) return;
    setTxt(String(item.stake ?? ''));
    setStep('valor'); setMsg(null); setOddsMoved(false);
  }, [open, item?.selectionId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item || !ctx) return null;
  const stake = parseStake(txt);
  const set = (n: number) => { const s = Math.max(0, Math.floor(n)); setTxt(s ? String(s) : ''); onStake(s); setMsg(null); };
  const { retorno, lucro, capped } = stakeMath(stake, item.odds, ctx.cfg.maxPayout);
  const issues = me ? stakeIssues(stake, ctx) : (stake < ctx.cfg.minStake ? ['STAKE_MIN' as const] : []);
  const hi = maxAllowed(ctx);
  const chips = stakeChips(ctx);
  const kycOk = me?.kyc?.status === 'aprovado';
  const offText = !v?.settings.realMoneyEnabled ? 'Apostas indisponíveis neste momento.' : v.settings.betsEnabled === false ? 'As apostas foram desativadas pela plataforma neste momento.' : null;
  const blocker = offText ?? closed;
  const mt = v?.matches.find((m) => m.id === item.groupId);
  const teamId = mt && (item.label === mt.home ? mt.homeTeamId : item.label === mt.away ? mt.awayTeamId : null);

  const goApostar = () => {
    setMsg(null);
    if (blocker) { setMsg({ text: blocker }); return; }
    if (needLogin) { requireAuth(); return; }
    if (!kycOk) { setMsg({ text: PLACE_CODE_TEXT.KYC, wallet: true }); return; }
    if (!ageOk) { onNeedAge(); return; }
    if (issues.length) { setMsg({ text: STAKE_ISSUE_TEXT[issues[0]], wallet: issues.includes('BALANCE') }); return; }
    setStep('confirmar');
  };

  const confirmar = async () => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await betsApi.place({ selectionIds: [item.selectionId], stake, odds: [item.odds], acceptChanges: oddsMoved, currency: 'mt' });
      if (r.ok) {
        try { localStorage.setItem('txap-stake-last', String(stake)); } catch {}
        setStep('feito'); toast('Aposta registada em dinheiro real'); onPlaced();
        return;
      }
      if (r.code === 'ODDS_CHANGED' && r.odds?.[item.selectionId] != null) {
        onOddsChanged(Number(r.odds[item.selectionId])); setOddsMoved(true);
        setMsg({ text: `A odd mudou para ${fmtOdds(Number(r.odds[item.selectionId]))}. Revê o retorno e confirma outra vez.` });
        return;
      }
      setStep('valor');
      setMsg({ text: PLACE_CODE_TEXT[r.code] ?? RES_TEXT[r.code] ?? 'Não foi possível apostar.', wallet: r.code === 'BALANCE' || r.code === 'KYC' });
    } catch (e) {
      setMsg({ text: 'Sem ligação: a aposta não foi registada. ' + ((e as Error).message || '') });
    } finally { setBusy(false); }
  };

  const header = (
    <div className="bx-card2 flex items-center gap-3 p-3">
      {teamId ? <TeamBadge name={item.label} logo={v?.teams[teamId]?.logo} size={40} /> : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[16px] font-bold">{item.label}</p>
        <p className="bx-muted truncate text-[12.5px]">{item.market} · {item.event}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="bx-dim text-[11px] uppercase tracking-wider">Odd</p>
        <p className="bx-acc text-[22px] font-extrabold tabular-nums leading-none" data-testid="stake-odds">{fmtOdds(item.odds)}×</p>
      </div>
    </div>
  );

  const summary = (
    <div className="mt-3 grid grid-cols-2 gap-2 text-center" aria-live="polite">
      <div className="bx-card2 p-2.5"><p className="bx-muted text-[12px]">Retorno potencial</p><p className="bx-acc text-[19px] font-extrabold tabular-nums" data-testid="stake-retorno">{fmtMt(retorno)}</p></div>
      <div className="bx-card2 p-2.5"><p className="bx-muted text-[12px]">Lucro</p><p className="text-[19px] font-extrabold tabular-nums text-[#86EFAC]" data-testid="stake-lucro">{lucro > 0 ? '+' : ''}{fmtMt(lucro)}</p></div>
      {capped && <p className="bx-dim col-span-2 text-[11.5px]">Limitado ao pagamento máximo de {fmtMt(ctx.cfg.maxPayout)}.</p>}
    </div>
  );

  const note = msg && (
    <div role="alert" className="mt-3 rounded-xl border border-[#F87171]/50 bg-[#7F1D1D]/30 p-3 text-[13.5px] text-[#FECACA]">
      <p>{msg.text}</p>
      {msg.wallet && (
        <p className="mt-1.5 flex flex-wrap gap-3">
          <Link href="/carteira" className="bx-acc font-semibold underline">Abrir a Carteira</Link>
          <button type="button" className="bx-acc font-semibold underline" onClick={onWallet}>Carteira MT (KYC e saldo)</button>
        </p>
      )}
    </div>
  );

  return (
    <Sheet open={open} onClose={busy ? () => undefined : onClose} title={step === 'confirmar' ? 'Confirmar aposta' : step === 'feito' ? 'Aposta registada' : 'Quanto queres apostar?'}>
      {header}
      {step === 'feito' ? (
        <div className="mt-4 text-center" data-testid="stake-done">
          <p className="text-4xl" aria-hidden>✅</p>
          <p className="mt-1 text-base font-bold">Aposta de {fmtMt(stake)} registada</p>
          <p className="bx-muted mt-1 text-[13px]">Retorno potencial {fmtMt(retorno)}. Uma aposta confirmada não pode ser retirada nem alterada. Vês o estado em “As minhas apostas”.</p>
          <button type="button" className="bx-btn mt-4 w-full" onClick={onClose}>Fechar</button>
        </div>
      ) : step === 'confirmar' ? (
        <>
          <dl className="mt-3 space-y-1.5 text-[14px]">
            <div className="flex justify-between"><dt className="bx-muted">Valor</dt><dd className="font-bold tabular-nums">{fmtMt(stake)}</dd></div>
            <div className="flex justify-between"><dt className="bx-muted">Odd</dt><dd className="font-bold tabular-nums">{fmtOdds(item.odds)}</dd></div>
            <div className="flex justify-between"><dt className="bx-muted">Retorno potencial</dt><dd className="bx-acc font-extrabold tabular-nums">{fmtMt(retorno)}</dd></div>
            <div className="flex justify-between"><dt className="bx-muted">Lucro</dt><dd className="font-bold tabular-nums text-[#86EFAC]">+{fmtMt(lucro)}</dd></div>
            {me && <div className="flex justify-between"><dt className="bx-muted">Saldo depois</dt><dd className="tabular-nums">{fmtMt(me.balanceMt - stake)}</dd></div>}
          </dl>
          <p className="mt-3 rounded-xl border border-[#F59E0B]/50 bg-[#F59E0B]/10 p-3 text-[13px] text-[#FCD34D]">Dinheiro real. Depois de confirmares, a aposta <b>não pode ser retirada, cancelada nem reduzida</b>.</p>
          {note}
          <button type="button" className="bx-btn mt-4 w-full !min-h-[56px] !text-[17px]" disabled={busy} onClick={confirmar} data-testid="stake-confirm">
            {busy ? 'A registar…' : oddsMoved ? `Confirmar com odd ${fmtOdds(item.odds)}` : `Confirmar ${fmtMt(stake)}`}
          </button>
          <button type="button" className="bx-dim mt-1 min-h-[44px] w-full text-[13px]" disabled={busy} onClick={() => { setStep('valor'); setMsg(null); }}>Voltar e mudar o valor</button>
        </>
      ) : (
        <>
          {blocker && <p role="status" className="mt-3 rounded-xl border border-[#F87171]/50 bg-[#7F1D1D]/30 p-3 text-[13.5px] font-semibold text-[#FECACA]">{blocker}</p>}
          <label htmlFor="stake-amount" className="bx-muted mt-4 block text-center text-[12.5px]">Valor da aposta (MT)</label>
          <div className="mt-1.5 flex items-center gap-2">
            <button type="button" aria-label="Diminuir" className="bx-ghost !h-14 !w-14 shrink-0 !p-0 !text-2xl" disabled={stake <= ctx.cfg.minStake} onClick={() => set(stepStake(stake, -1, ctx))}>−</button>
            <input id="stake-amount" data-testid="stake-amount" inputMode="numeric" autoComplete="off" placeholder="0"
              className="bx-input !h-14 min-w-0 flex-1 text-center !text-[28px] font-extrabold tabular-nums"
              value={txt} onChange={(e) => { const d = e.target.value.replace(/\D/g, '').slice(0, 7); setTxt(d); onStake(parseStake(d)); setMsg(null); }}
              aria-describedby="stake-help" />
            <button type="button" aria-label="Aumentar" className="bx-ghost !h-14 !w-14 shrink-0 !p-0 !text-2xl" disabled={stake >= hi} onClick={() => set(stake ? stepStake(stake, 1, ctx) : clampStake(ctx.cfg.minStake, ctx))}>+</button>
          </div>
          <div className="mt-2 grid grid-cols-6 gap-1.5">
            {chips.map((c) => (
              <button key={c.label} type="button" className={`bx-ghost !min-h-[42px] !px-0 !text-[13px] ${stake === c.value && c.value > 0 ? '!border-[var(--bx-acc)] !text-[var(--bx-acc)]' : ''}`} disabled={c.disabled} title={c.why || undefined}
                aria-pressed={stake === c.value && c.value > 0} onClick={() => set(c.value)}>{c.label}</button>
            ))}
          </div>
          <p id="stake-help" className="bx-dim mt-1.5 text-center text-[11.5px]">
            Mín. {fmtMt(ctx.cfg.minStake)} · máx. {fmtMt(hi)} por aposta{me ? ` · saldo ${fmtMt(me.balanceMt)}` : ''}
          </p>
          {summary}
          {note}
          <button type="button" className="bx-btn mt-4 w-full !min-h-[56px] !text-[18px] !font-extrabold tracking-wide" data-testid="stake-apostar"
            disabled={!!blocker || stake <= 0} onClick={goApostar}>
            {needLogin ? 'ENTRAR PARA APOSTAR' : `APOSTAR ${stake > 0 ? fmtMt(stake) : ''}`.trim()}
          </button>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <button type="button" className="bx-dim min-h-[44px] text-[13px]" onClick={onClose}>{slipCount > 1 ? 'Manter no boletim' : 'Fechar'}</button>
            <button type="button" className="bx-dim min-h-[44px] text-[13px]" onClick={onRemove}>Retirar seleção</button>
          </div>
        </>
      )}
    </Sheet>
  );
}
