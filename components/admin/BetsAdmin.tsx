'use client';

// Admin › Apostas (TXAP Pontos). Tudo o que muda aqui fica no registo de auditoria (bet_admin_log + audit_log).
// Regras escritas à mão, sem IA: odds pelo Elo + margem; liquidação automática ao registar o resultado.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { GAMES_CFG, GAME_KEYS, gameKeyOf } from '@/lib/jogos';
import { BetGame, BetSettings, REAL_MONEY_CONFIRM, fmtMt, fmtOdds, fmtPts, realMoneyUnlockable } from '@/lib/bets';
import { AUTO_DEPOSIT_PENDING, PROVIDERS } from '@/lib/payments';
import type { LogRow, Market, Match, Selection } from '@/lib/betsCore';
import { AdminBet, AdminMoney, AdminOverview, BetsView, RES_TEXT, Res, betsApi } from '@/lib/betsApi';
import { BetRow, BetsBanner, fmtKick, realOn } from '@/components/bets/Bets';
import { IS_DEMO } from '@/lib/config';
import { TeamBadge } from '@/components/TeamBadge';
import { uploadPhoto } from '@/lib/media';
import type { TeamInfo } from '@/lib/betsApi';

type Sub = 'Painel' | 'Jogos e mercados' | 'Equipas' | 'Apostas' | 'Dinheiro real' | 'Definições' | 'Auditoria';
const SUBS: Sub[] = ['Painel', 'Jogos e mercados', 'Equipas', 'Apostas', 'Dinheiro real', 'Definições', 'Auditoria'];

export default function BetsAdmin() {
  const { toast } = useStore();
  const [sub, setSub] = useState<Sub>('Painel');
  const [v, setV] = useState<BetsView | null>(null);
  const [ov, setOv] = useState<AdminOverview | null>(null);
  const [err, setErr] = useState('');
  const reload = useCallback(async () => {
    try { setErr(''); const [a, b] = await Promise.all([betsApi.load({ admin: true }), betsApi.adminOverview()]); setV(a); setOv(b); }
    catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const run = async (p: Promise<Res>, okMsg: string) => {
    try { const r = await p; if (r.ok) { toast(okMsg); await reload(); } else toast(RES_TEXT[r.code] ?? r.code); return r.ok; }
    catch (e) { toast((e as Error).message); return false; }
  };
  return (
    <div className="bx">
      <BetsBanner className="mb-3" />
      {IS_DEMO && <p className="mb-3 text-center text-xs text-white/60">Dados de exemplo (modo demo).</p>}
      <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4" role="tablist" aria-label="Apostas · admin">
        {SUBS.map((x) => <button key={x} type="button" role="tab" aria-selected={sub === x} onClick={() => setSub(x)} className="bx-chip !min-h-[40px] !text-[13px]">{x}{x === 'Painel' && (ov?.alerts.length ?? 0) > 0 ? ` · ${ov!.alerts.length}` : ''}</button>)}
      </div>
      {err && <p className="bx-card mb-3 p-3 text-sm">Erro: {err}. Se a migration de apostas ainda não correu, corre supabase/migrations/2026-10-10-bets.sql.</p>}
      {!v || !ov ? <div className="space-y-3">{[0, 1, 2].map((k) => <div key={k} className="bx-card h-20 animate-pulse" />)}</div> : (
        <>
          {sub === 'Painel' && <Panel v={v} ov={ov} run={run} />}
          {sub === 'Equipas' && <Teams run={run} />}
          {sub === 'Jogos e mercados' && <Markets v={v} run={run} />}
          {sub === 'Apostas' && <BetsList ov={ov} />}
          {sub === 'Dinheiro real' && <Money v={v} run={run} reload={reload} />}
          {sub === 'Definições' && <SettingsForm v={v} run={run} />}
          {sub === 'Auditoria' && <Log />}
        </>
      )}
    </div>
  );
}

function Panel({ v, ov, run }: { v: BetsView; ov: AdminOverview; run: (p: Promise<Res>, ok: string) => Promise<boolean> }) {
  const open = v.markets.filter((m) => m.status === 'aberto').length;
  const tiles: [string, string][] = [
    ['Apostas', String(ov.totals.bets)], ['Em aberto', String(ov.totals.open)], ['Apostado', fmtPts(ov.totals.staked)],
    ['Pago', fmtPts(ov.totals.paid)], ['Exposição', fmtPts(ov.totals.liability)], ['Mercados abertos', String(open)],
    ...(realOn(v.settings) || ov.totals.stakedMt > 0 ? [['Apostado MT', fmtMt(ov.totals.stakedMt)], ['Pago MT', fmtMt(ov.totals.paidMt)], ['Exposição MT', fmtMt(ov.totals.liabilityMt)]] as [string, string][] : []),
  ];
  return (
    <div className="space-y-4">
      <section className="bx-card flex items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold">Apostas ativas</p>
          <p className="bx-muted text-[12.5px]">{v.settings.betsEnabled ? 'Os utilizadores veem os mercados e podem apostar.' : 'Desligadas: ninguém consegue apostar. Saldos e histórico ficam visíveis.'}</p>
        </div>
        <button type="button" role="switch" aria-checked={v.settings.betsEnabled} aria-label="Apostas ativas"
          onClick={() => { if (window.confirm(v.settings.betsEnabled ? 'Desativar as apostas para todos?' : 'Ativar as apostas?')) run(betsApi.setEnabled(!v.settings.betsEnabled), v.settings.betsEnabled ? 'Apostas desativadas' : 'Apostas ativadas'); }}
          className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${v.settings.betsEnabled ? 'bg-[#16A34A]' : 'bg-white/20'}`}>
          <span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition-all ${v.settings.betsEnabled ? 'left-7' : 'left-1'}`} />
        </button>
      </section>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {tiles.map(([k, val]) => <div key={k} className="bx-card p-3"><p className="bx-muted text-[12px]">{k}</p><p className="text-lg font-bold tabular-nums">{val}</p></div>)}
      </div>
      <section className="bx-card p-4">
        <h3 className="mb-2 text-base font-bold">Alertas de risco</h3>
        <p className="bx-dim mb-2 text-[12px]">Aposta ≥ {fmtPts(v.settings.bigStakeAlert)} ou ≥ {v.settings.sameSelectionAlert} apostas na mesma seleção (muda em Definições).</p>
        {ov.alerts.length === 0 ? <p className="bx-muted text-sm">Sem alertas.</p> : (
          <ul className="space-y-1.5 text-[13.5px]">{ov.alerts.map((a, i) => <li key={a.ref + i} className="bx-card2 p-2.5">{a.kind === 'aposta_grande' ? '' : ''} {a.text}</li>)}</ul>
        )}
      </section>
      <section className="bx-card p-4">
        <h3 className="mb-2 text-base font-bold">Exposição por seleção</h3>
        <p className="bx-dim mb-2 text-[12px]">Exposição = retorno possível das apostas em aberto que incluem a seleção.</p>
        {ov.exposure.length === 0 ? <p className="bx-muted text-sm">Ainda não há apostas.</p> : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[13px]">
              <thead><tr className="bx-muted border-b border-[var(--bx-line)] text-[11px] uppercase"><th className="px-2 py-2">Seleção</th><th className="px-2 py-2">Jogo / mercado</th><th className="px-2 py-2 text-right">Apostas</th><th className="px-2 py-2 text-right">Apostado</th><th className="px-2 py-2 text-right">Exposição</th></tr></thead>
              <tbody>{ov.exposure.slice(0, 30).map((e) => (
                <tr key={e.selectionId} className="border-b border-[var(--bx-line)]/50 last:border-0">
                  <td className="px-2 py-2 font-semibold">{e.label}</td><td className="bx-muted px-2 py-2">{e.event} · {e.market}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{e.bets}</td><td className="px-2 py-2 text-right tabular-nums">{fmtPts(e.staked)}</td><td className="bx-acc px-2 py-2 text-right font-bold tabular-nums">{fmtPts(e.liability)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* ---------------- Jogos e mercados ---------------- */
function toLocalInput(iso: string) {
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const STATUS_PT: Record<string, string> = { agendado: 'Agendado', ao_vivo: 'A decorrer', terminado: 'Terminado', cancelado: 'Cancelado', adiado: 'Adiado' };
const MK_PT: Record<string, string> = { aberto: 'Aberto', suspenso: 'Suspenso', liquidado: 'Liquidado', anulado: 'Anulado' };

function Markets({ v, run }: { v: BetsView; run: (p: Promise<Res>, ok: string) => Promise<boolean> }) {
  const { s } = useStore();
  const [open, setOpen] = useState<string | null>(null);
  const [f, setF] = useState<'ativos' | 'todos'>('ativos');
  const tours = s.admin.tournaments;
  const [form, setForm] = useState({ tournamentId: '', game: 'ff' as BetGame, home: '', away: '', start: toLocalInput(new Date(Date.now() + 3 * 3600e3).toISOString()) });
  const tour = tours.find((t) => t.id === form.tournamentId);
  const create = async () => {
    const ok = await run(betsApi.createMatch({ game: tour ? gameKeyOf(tour.game) : form.game, home: form.home, away: form.away, startsAt: new Date(form.start).toISOString(), tournamentId: form.tournamentId || null, tournamentName: tour?.name ?? '' }), 'Jogo agendado · mercados abertos automaticamente');
    if (ok) setForm((x) => ({ ...x, home: '', away: '' }));
  };
  const list = v.matches.filter((m) => f === 'todos' || (!m.voided && m.status !== 'terminado') || Date.now() - Date.parse(m.startsAt) < 86400e3 * 2)
    .sort((a, b) => (f === 'ativos' ? a.startsAt.localeCompare(b.startsAt) : b.startsAt.localeCompare(a.startsAt)));
  const outrights = v.markets.filter((m) => m.kind === 'outright');
  return (
    <div className="space-y-4">
      <section className="bx-card p-4">
        <h3 className="text-base font-bold">Agendar jogo</h3>
        <p className="bx-muted mb-3 text-[12.5px]">Ao guardar, os mercados (Vencedor, Total, Resultado exato no futebol e Vencedor do torneio) abrem logo, com odds automáticas. Fecham sozinhos à hora de início.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-[13px] font-semibold">Torneio
            <select className="bx-input mt-1" value={form.tournamentId} onChange={(e) => setForm({ ...form, tournamentId: e.target.value })}>
              <option value="">Sem torneio (jogo avulso)</option>
              {tours.filter((t) => t.status !== 'terminado').map((t) => <option key={t.id} value={t.id}>{t.name} · {t.game}</option>)}
            </select>
          </label>
          <label className="text-[13px] font-semibold">Jogo
            <select className="bx-input mt-1" value={tour ? gameKeyOf(tour.game) : form.game} disabled={!!tour} onChange={(e) => setForm({ ...form, game: e.target.value as BetGame })}>
              {GAME_KEYS.map((k) => <option key={k} value={k}>{GAMES_CFG[k].name}</option>)}
            </select>
          </label>
          <label className="text-[13px] font-semibold">Equipa / jogador 1<input className="bx-input mt-1" value={form.home} maxLength={60} onChange={(e) => setForm({ ...form, home: e.target.value })} placeholder="Ex.: Mambas FC" /></label>
          <label className="text-[13px] font-semibold">Equipa / jogador 2<input className="bx-input mt-1" value={form.away} maxLength={60} onChange={(e) => setForm({ ...form, away: e.target.value })} placeholder="Ex.: Leões de Maputo" /></label>
          <label className="text-[13px] font-semibold sm:col-span-2">Início (hora de Maputo)<input type="datetime-local" className="bx-input mt-1" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></label>
        </div>
        <button type="button" className="bx-btn mt-3 w-full sm:w-auto" disabled={!form.home.trim() || !form.away.trim() || !form.start} onClick={create}>Agendar e abrir mercados</button>
      </section>

      <div className="flex gap-2">
        {(['ativos', 'todos'] as const).map((k) => <button key={k} type="button" aria-pressed={f === k} onClick={() => setF(k)} className="bx-chip !min-h-[40px] !text-[13px]">{k === 'ativos' ? 'Ativos e recentes' : 'Todos'}</button>)}
      </div>
      {list.length === 0 && <p className="bx-card p-4 text-center text-sm">Ainda não há jogos agendados.</p>}
      {list.map((m) => <MatchAdmin key={m.id} m={m} v={v} run={run} open={open === m.id} onToggle={() => setOpen(open === m.id ? null : m.id)} />)}

      {outrights.length > 0 && <h3 className="bx-muted pt-2 text-[12px] font-bold uppercase tracking-wider">Vencedor do torneio</h3>}
      {outrights.map((mk) => (
        <section key={mk.id} className="bx-card p-3.5">
          <p className="font-bold">{mk.tournamentName || 'Torneio'} <span className="bx-muted text-[12.5px] font-medium">· {MK_PT[mk.status]}{mk.closesAt ? ` · fecha ${fmtKick(mk.closesAt)}` : ''}</span></p>
          <MarketEditor mk={mk} v={v} run={run} outright />
        </section>
      ))}
    </div>
  );
}

function MatchAdmin({ m, v, run, open, onToggle }: { m: Match; v: BetsView; run: (p: Promise<Res>, ok: string) => Promise<boolean>; open: boolean; onToggle: () => void }) {
  const [h, setH] = useState(m.homeScore != null ? String(m.homeScore) : '');
  const [a, setA] = useState(m.awayScore != null ? String(m.awayScore) : '');
  const [when, setWhen] = useState(toLocalInput(m.startsAt));
  const mks = v.markets.filter((x) => x.matchId === m.id);
  const closed = m.voided || m.status === 'cancelado';
  const unit = m.game === 'ff' ? 'kills' : m.game === 'cr' ? 'coroas' : m.game === 'outros' ? 'pontos' : 'golos';
  return (
    <section className="bx-card p-3.5">
      <button type="button" onClick={onToggle} className="flex min-h-[44px] w-full items-center gap-2 text-left" aria-expanded={open}>
        <span className="flex shrink-0 -space-x-2"><TeamBadge name={m.home} logo={v.teams[m.homeTeamId]?.logo} size={30} /><TeamBadge name={m.away} logo={v.teams[m.awayTeamId]?.logo} size={30} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold">{m.home} vs {m.away}{m.status === 'terminado' ? ` · ${m.homeScore}-${m.awayScore}` : ''}</span>
          <span className="bx-muted block truncate text-[12px]">{m.tournamentName || 'Jogo avulso'} · {fmtKick(m.startsAt)} · {m.voided ? 'Anulado' : STATUS_PT[m.status]}{m.example ? ' · Dados de exemplo' : ''}</span>
        </span>
        <span aria-hidden className="bx-muted">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-4 border-t border-[var(--bx-line)] pt-3">
          {!closed && (
            <div>
              <p className="mb-1.5 text-[13px] font-semibold">{m.status === 'terminado' ? 'Corrigir resultado' : 'Registar resultado'} ({unit}) — liquida tudo automaticamente</p>
              <div className="flex items-center gap-2">
                <input className="bx-input !w-20 text-center" inputMode="numeric" aria-label={`${unit} ${m.home}`} value={h} onChange={(e) => setH(e.target.value.replace(/\D/g, '').slice(0, 3))} />
                <span className="bx-muted">–</span>
                <input className="bx-input !w-20 text-center" inputMode="numeric" aria-label={`${unit} ${m.away}`} value={a} onChange={(e) => setA(e.target.value.replace(/\D/g, '').slice(0, 3))} />
                <button type="button" className="bx-btn flex-1 !px-3 !text-[14px]" disabled={h === '' || a === ''}
                  onClick={() => { if (window.confirm(`${m.status === 'terminado' ? 'Corrigir' : 'Registar'} ${m.home} ${h}-${a} ${m.away}? As apostas são liquidadas${m.status === 'terminado' ? ' de novo (os pagamentos anteriores são revertidos)' : ''}.`)) run(betsApi.matchAction(m.id, 'resultado', { home: Number(h), away: Number(a) }), 'Resultado registado · apostas liquidadas'); }}>
                  {m.status === 'terminado' ? 'Corrigir' : 'Liquidar'}
                </button>
              </div>
            </div>
          )}
          {!closed && m.status !== 'terminado' && (
            <div>
              <p className="mb-1.5 text-[13px] font-semibold">Reagendar (até 48 h depois da hora original os mercados reabrem; mais tarde = anulado e reembolsado)</p>
              <div className="flex gap-2">
                <input type="datetime-local" className="bx-input flex-1" value={when} onChange={(e) => setWhen(e.target.value)} />
                <button type="button" className="bx-ghost shrink-0" onClick={() => run(betsApi.matchAction(m.id, 'reagendar', { startsAt: new Date(when).toISOString() }), 'Jogo reagendado')}>Guardar</button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" className="bx-ghost" onClick={() => { if (window.confirm('Marcar como adiado (sem nova data)? Os mercados suspendem; passadas 48 h sem nova data o jogo é anulado e reembolsado.')) run(betsApi.matchAction(m.id, 'adiar'), 'Jogo adiado'); }}>Adiar</button>
                <button type="button" className="bx-ghost !text-[#FCA5A5]" onClick={() => { if (window.confirm('Cancelar o jogo? Todas as apostas neste jogo são anuladas e os pontos devolvidos (nas múltiplas a perna conta 1.00).')) run(betsApi.matchAction(m.id, 'cancelar'), 'Jogo cancelado · reembolsos feitos'); }}>Cancelar jogo</button>
              </div>
            </div>
          )}
          {m.status === 'terminado' && !closed && (
            <button type="button" className="bx-ghost w-full !text-[#FCA5A5]" onClick={() => { if (window.confirm('Anular o jogo depois de liquidado? Os pagamentos são revertidos e as apostas reembolsadas.')) run(betsApi.matchAction(m.id, 'anular'), 'Jogo anulado'); }}>Anular jogo (reembolsar tudo)</button>
          )}
          {mks.map((mk) => (
            <div key={mk.id}>
              <p className="text-[13px] font-semibold">{mk.title} <span className="bx-muted font-medium">· {MK_PT[mk.status]}{mk.autoSuspended ? ' (automático)' : ''}{mk.margin != null ? ` · margem ${Math.round(mk.margin * 1000) / 10}%` : ''}</span></p>
              <MarketEditor mk={mk} v={v} run={run} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function MarketEditor({ mk, v, run, outright }: { mk: Market; v: BetsView; run: (p: Promise<Res>, ok: string) => Promise<boolean>; outright?: boolean }) {
  const sels = useMemo(() => v.selections.filter((x) => x.marketId === mk.id).sort((a, b) => a.sort - b.sort), [v.selections, mk.id]);
  const [edit, setEdit] = useState(false);
  const live = mk.status === 'aberto' || mk.status === 'suspenso';
  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap gap-1.5">
        {sels.map((x) => (
          <span key={x.id} className={`bx-card2 inline-flex items-center gap-1.5 px-2 py-1 text-[12.5px] ${x.result === 'ganha' ? 'ring-1 ring-[#22C55E]' : ''}`}>
            {x.label} <b className="bx-acc tabular-nums">{fmtOdds(x.odds)}</b>{x.manual ? <span className="bx-dim" title="Odd manual"> · manual</span> : null}{x.result !== 'pendente' ? <span className="bx-dim">· {x.result}</span> : null}
          </span>
        ))}
      </div>
      {live && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="bx-ghost !min-h-[44px] !px-3 !text-[13px]" onClick={() => run(betsApi.marketAction(mk.id, mk.status === 'aberto' ? 'suspender' : 'reabrir'), mk.status === 'aberto' ? 'Mercado suspenso' : 'Mercado reaberto')}>{mk.status === 'aberto' ? 'Suspender' : 'Reabrir'}</button>
          <button type="button" className="bx-ghost !min-h-[44px] !px-3 !text-[13px]" onClick={() => setEdit(!edit)} aria-expanded={edit}>Odds e margem</button>
          <button type="button" className="bx-ghost !min-h-[44px] !px-3 !text-[13px] !text-[#FCA5A5]" onClick={() => { if (window.confirm(`Anular o mercado "${mk.title}"? As apostas nele são reembolsadas (nas múltiplas a perna conta 1.00).`)) run(betsApi.marketAction(mk.id, 'anular'), 'Mercado anulado'); }}>Anular</button>
        </div>
      )}
      {outright && live && <OutrightWinner mk={mk} sels={sels} run={run} />}
      {edit && live && <OddsEditor mk={mk} sels={sels} run={run} />}
    </div>
  );
}

function OutrightWinner({ mk, sels, run }: { mk: Market; sels: Selection[]; run: (p: Promise<Res>, ok: string) => Promise<boolean> }) {
  const [w, setW] = useState('');
  return (
    <div className="mt-2 flex gap-2">
      <select className="bx-input flex-1" value={w} onChange={(e) => setW(e.target.value)} aria-label="Vencedor do torneio">
        <option value="">Vencedor…</option>{sels.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
      </select>
      <button type="button" className="bx-btn shrink-0 !px-3 !text-[14px]" disabled={!w} onClick={() => { if (window.confirm('Liquidar o vencedor do torneio?')) run(betsApi.marketAction(mk.id, 'vencedor', null, w), 'Vencedor registado · apostas liquidadas'); }}>Liquidar</button>
    </div>
  );
}

function OddsEditor({ mk, sels, run }: { mk: Market; sels: Selection[]; run: (p: Promise<Res>, ok: string) => Promise<boolean> }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [margin, setMargin] = useState(mk.margin != null ? String(Math.round(mk.margin * 1000) / 10) : '');
  return (
    <div className="bx-card2 mt-2 space-y-2 p-3">
      {sels.map((x) => (
        <div key={x.id} className="flex items-center gap-2 text-[13px]">
          <span className="min-w-0 flex-1 truncate">{x.label} <span className="bx-dim">· {(x.prob * 100).toFixed(1)}%</span></span>
          <input className="bx-input !min-h-[44px] !w-24 text-right" inputMode="decimal" aria-label={`Odd ${x.label}`} placeholder={fmtOdds(x.odds)} value={vals[x.id] ?? ''} onChange={(e) => setVals({ ...vals, [x.id]: e.target.value.replace(',', '.') })} />
          <button type="button" className="bx-ghost !min-h-[44px] shrink-0 !px-3 !text-[13px]" disabled={!vals[x.id]} onClick={() => run(betsApi.marketAction(mk.id, 'odd', Number(vals[x.id]), x.id), `Odd de ${x.label} alterada (registado)`)}>OK</button>
        </div>
      ))}
      <div className="flex items-center gap-2 border-t border-[var(--bx-line)] pt-2 text-[13px]">
        <span className="flex-1">Margem só deste mercado (%)</span>
        <input className="bx-input !min-h-[44px] !w-24 text-right" inputMode="decimal" placeholder="geral" value={margin} onChange={(e) => setMargin(e.target.value.replace(',', '.'))} aria-label="Margem do mercado" />
        <button type="button" className="bx-ghost !min-h-[44px] shrink-0 !px-3 !text-[13px]" onClick={() => run(betsApi.marketAction(mk.id, 'margem', margin.trim() ? Number(margin) / 100 : null), 'Margem do mercado guardada')}>OK</button>
      </div>
      <button type="button" className="bx-ghost w-full !text-[13px]" onClick={() => run(betsApi.marketAction(mk.id, 'odds_auto'), 'Odds voltaram ao cálculo automático')}>Voltar às odds automáticas</button>
    </div>
  );
}

/* ---------------- Apostas por utilizador ---------------- */
function BetsList({ ov }: { ov: AdminOverview }) {
  const [bets, setBets] = useState<AdminBet[] | null>(null);
  const [who, setWho] = useState<string>('');
  useEffect(() => { betsApi.adminBets().then(setBets).catch(() => setBets([])); }, []);
  const list = (bets ?? []).filter((b) => !who || b.userId === who);
  return (
    <div className="space-y-4">
      <section className="bx-card p-4">
        <h3 className="mb-2 text-base font-bold">Apostadores</h3>
        {ov.users.length === 0 ? <p className="bx-muted text-sm">Ainda não há apostas.</p> : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-[13px]">
              <thead><tr className="bx-muted border-b border-[var(--bx-line)] text-[11px] uppercase"><th className="px-2 py-2">Utilizador</th><th className="px-2 py-2 text-right">Apostas</th><th className="px-2 py-2 text-right">Apostado</th><th className="px-2 py-2 text-right">Recebido</th><th className="px-2 py-2 text-right">Saldo</th></tr></thead>
              <tbody>{ov.users.map((u) => (
                <tr key={u.userId} className="border-b border-[var(--bx-line)]/50 last:border-0">
                  <td className="px-2 py-1"><button type="button" className="bx-acc min-h-[44px] font-semibold" onClick={() => setWho(who === u.userId ? '' : u.userId)}>{u.handle}</button></td>
                  <td className="px-2 py-1 text-right tabular-nums">{u.bets}{u.open ? ` (${u.open} abertas)` : ''}</td><td className="px-2 py-1 text-right tabular-nums">{fmtPts(u.staked)}</td><td className="px-2 py-1 text-right tabular-nums">{fmtPts(u.returned)}</td><td className="px-2 py-1 text-right tabular-nums">{fmtPts(u.balance)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </section>
      <h3 className="bx-muted text-[12px] font-bold uppercase tracking-wider">{who ? 'Apostas do utilizador' : 'Últimas apostas'}{who && <button type="button" className="bx-acc ml-2 normal-case" onClick={() => setWho('')}>ver todas</button>}</h3>
      {!bets ? <div className="bx-card h-24 animate-pulse" /> : list.length === 0 ? <p className="bx-card p-4 text-center text-sm">Sem apostas.</p> : list.slice(0, 60).map((b) => <BetRow key={b.id} b={b} who={b.handle} />)}
    </div>
  );
}

/* ---------------- Definições + dinheiro real ---------------- */
function SettingsForm({ v, run }: { v: BetsView; run: (p: Promise<Res>, ok: string) => Promise<boolean> }) {
  const c = v.settings;
  const [f, setF] = useState({
    margin: String(Math.round(c.margin * 1000) / 10), minStake: String(c.minStake), maxStake: String(c.maxStake), maxPayout: String(c.maxPayout), maxLegs: String(c.maxLegs),
    weeklyAllowance: String(c.weeklyAllowance), eloK: String(c.eloK), bigStakeAlert: String(c.bigStakeAlert), sameSelectionAlert: String(c.sameSelectionAlert),
    mtMinStake: String(c.mtMinStake), mtMaxStake: String(c.mtMaxStake), mtMaxPayout: String(c.mtMaxPayout), mtMinWithdraw: String(c.mtMinWithdraw), mtMaxWithdrawDaily: String(c.mtMaxWithdrawDaily),
  });
  const n = (x: string) => Number(x.replace(',', '.'));
  const fields: [keyof typeof f, string][] = [
    ['margin', 'Margem da casa (%)'], ['minStake', 'Aposta mínima (pts)'], ['maxStake', 'Aposta máxima (pts)'], ['maxPayout', 'Pagamento máximo (pts)'], ['maxLegs', 'Máx. seleções na múltipla (1–10)'],
    ['weeklyAllowance', 'Pontos grátis por semana'], ['eloK', 'Fator K do Elo'], ['bigStakeAlert', 'Alerta: aposta grande a partir de (pts)'], ['sameSelectionAlert', 'Alerta: nº de apostas na mesma seleção'],
    ['mtMinStake', 'MT · aposta mínima'], ['mtMaxStake', 'MT · aposta máxima'], ['mtMaxPayout', 'MT · pagamento máximo'], ['mtMinWithdraw', 'MT · levantamento mínimo'], ['mtMaxWithdrawDaily', 'MT · levantamentos por dia'],
  ];
  const save = () => {
    const p: Partial<BetSettings> = {
      margin: n(f.margin) / 100, minStake: n(f.minStake), maxStake: n(f.maxStake), maxPayout: n(f.maxPayout), maxLegs: n(f.maxLegs),
      weeklyAllowance: n(f.weeklyAllowance), eloK: n(f.eloK), bigStakeAlert: n(f.bigStakeAlert), sameSelectionAlert: n(f.sameSelectionAlert),
      mtMinStake: n(f.mtMinStake), mtMaxStake: n(f.mtMaxStake), mtMaxPayout: n(f.mtMaxPayout), mtMinWithdraw: n(f.mtMinWithdraw), mtMaxWithdrawDaily: n(f.mtMaxWithdrawDaily),
    };
    if (Object.values(p).some((x) => typeof x === 'number' && !Number.isFinite(x))) return;
    run(betsApi.saveSettings(p), 'Definições de apostas guardadas (registado)');
  };
  return (
    <div className="space-y-4">
      <section className="bx-card p-4">
        <h3 className="text-base font-bold">Regras gerais</h3>
        <p className="bx-muted mb-3 text-[12.5px]">Mudar a margem recalcula logo as odds automáticas dos mercados abertos (as odds manuais ficam).</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map(([k, l]) => (
            <label key={k} className="text-[13px] font-semibold">{l}<input className="bx-input mt-1" inputMode="decimal" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
          ))}
        </div>
        <button type="button" className="bx-btn mt-3 w-full sm:w-auto" onClick={save}>Guardar regras</button>
      </section>
    </div>
  );
}

/* ---------------- Dinheiro real: licença IGJ, KYC, depósitos manuais, levantamentos ---------------- */
function Money({ v, run, reload }: { v: BetsView; run: (p: Promise<Res>, ok: string) => Promise<boolean>; reload: () => void }) {
  const { toast } = useStore();
  const c = v.settings;
  const on = realOn(c);
  const [lic, setLic] = useState({ licenceNo: c.igjLicenceNo, issue: c.igjLicenceDate || '', expiry: c.igjLicenceExpiry || '', confirm: '' });
  const [m, setM] = useState<AdminMoney | null>(null);
  const [dep, setDep] = useState({ user: '', amount: '', method: 'M-Pesa', reference: '' });
  const [refs, setRefs] = useState<Record<string, string>>({});
  const load = useCallback(() => { betsApi.adminMoney().then(setM).catch((e) => toast((e as Error).message)); }, [toast]);
  useEffect(() => { load(); }, [load]);
  const today = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
  const gate = realMoneyUnlockable({ igjLicenceNo: lic.licenceNo, igjLicenceDate: lic.issue, igjLicenceExpiry: lic.expiry }, lic.confirm, today);
  const act = async (p: Promise<Res>, ok: string) => { if (await run(p, ok)) load(); };
  const enable = async () => {
    const r = await betsApi.setRealMoney(true, lic);
    if (!r.ok) { toast(r.reason ? `Não ativado: ${r.reason}.` : RES_TEXT[r.code] ?? r.code); return; }
    setLic({ ...lic, confirm: '' });
    toast('Dinheiro real ligado.');
    reload();
  };
  const approved = (m?.kyc ?? []).filter((k) => k.status === 'aprovado');
  return (
    <div className="space-y-4">
      <section className="bx-card p-4">
        <div className="flex items-center gap-3">
          <h3 className="flex-1 text-base font-bold">Estado</h3>
          <span className={`bx-tag ${on ? 'bg-[#16A34A]' : 'bg-[#52525B]'} text-white`}>{on ? 'Ligado' : 'Desligado'}</span>
        </div>
        <p className="bx-muted mt-1 text-[13px]">{on ? `Licença IGJ nº ${c.igjLicenceNo}, válida até ${c.igjLicenceExpiry}. O número aparece no rodapé das apostas.` : 'Desligado por omissão. Os TXAP Pontos continuam disponíveis para testar.'}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-[13px] font-semibold sm:col-span-3">Nº da licença IGJ<input className="bx-input mt-1" value={lic.licenceNo} maxLength={60} onChange={(e) => setLic({ ...lic, licenceNo: e.target.value })} /></label>
          <label className="text-[13px] font-semibold">Emissão<input type="date" className="bx-input mt-1" value={lic.issue} onChange={(e) => setLic({ ...lic, issue: e.target.value })} /></label>
          <label className="text-[13px] font-semibold">Validade<input type="date" className="bx-input mt-1" value={lic.expiry} onChange={(e) => setLic({ ...lic, expiry: e.target.value })} /></label>
          {!on && <label className="text-[13px] font-semibold">Escreve {REAL_MONEY_CONFIRM}<input className="bx-input mt-1" value={lic.confirm} autoComplete="off" onChange={(e) => setLic({ ...lic, confirm: e.target.value })} /></label>}
        </div>
        {!on && gate.reason && <p className="bx-muted mt-2 text-[12.5px]">{gate.reason}</p>}
        {on
          ? <button type="button" className="bx-ghost mt-3 w-full" onClick={() => { if (window.confirm('Desligar as apostas com dinheiro real? As apostas em aberto continuam e são liquidadas normalmente.')) run(betsApi.setRealMoney(false, lic), 'Dinheiro real desligado'); }}>Desligar dinheiro real</button>
          : <button type="button" className="bx-btn mt-3 w-full" disabled={!gate.ok} onClick={() => { if (window.confirm(`Ligar apostas com dinheiro real com a licença IGJ nº ${lic.licenceNo.trim()}?`)) enable(); }}>Ligar dinheiro real</button>}
        <ul className="mt-3 space-y-1 text-[12.5px]">
          {PROVIDERS.map((p) => <li key={p.id} className="flex justify-between gap-2"><span>{p.label}</span><span className={p.configured ? 'text-[#86EFAC]' : 'bx-dim'}>{p.configured ? 'Ativo' : 'Requer credenciais da API'}</span></li>)}
        </ul>
      </section>

      {m && (
        <div className="grid grid-cols-2 gap-2">
          {([['Depósitos', m.totals.deposits], ['Pago em levantamentos', m.totals.withdrawn], ['Levantamentos pendentes', m.totals.pendingWithdrawals], ['Saldos dos clientes', m.totals.balances]] as const).map(([k, val]) => (
            <div key={k} className="bx-card p-3"><p className="bx-muted text-[12px]">{k}</p><p className="text-base font-bold tabular-nums">{fmtMt(val)}</p></div>
          ))}
        </div>
      )}

      <section className="bx-card p-4">
        <h3 className="text-base font-bold">Verificações (KYC)</h3>
        {!m ? <div className="bx-card2 mt-2 h-16 animate-pulse" /> : m.kyc.length === 0 ? <p className="bx-muted mt-1 text-sm">Sem pedidos.</p> : (
          <ul className="mt-2 space-y-2">
            {m.kyc.map((k) => (
              <li key={k.userId} className="bx-card2 p-3 text-[13px]">
                <p className="flex justify-between gap-2"><b>{k.fullName}</b><span className="bx-muted">{k.status}</span></p>
                <p className="bx-muted">{k.handle} · nasc. {k.birthDate} · {k.idType} {k.idNumber} · {k.phone}</p>
                {k.status !== 'aprovado' && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button type="button" className="bx-ghost" onClick={() => act(betsApi.kycReview(k.userId, 'aprovado', ''), 'KYC aprovado')}>Aprovar</button>
                    <button type="button" className="bx-ghost !text-[#FCA5A5]" onClick={() => { const note = window.prompt('Motivo da recusa (o utilizador vê):') ?? ''; if (note.trim()) act(betsApi.kycReview(k.userId, 'recusado', note.trim()), 'KYC recusado'); }}>Recusar</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bx-card p-4">
        <h3 className="text-base font-bold">Registar depósito confirmado</h3>
        <p className="mt-1 rounded-xl border border-[#F59E0B]/50 bg-[#F59E0B]/10 p-2.5 text-[12.5px] text-[#FCD34D]">{AUTO_DEPOSIT_PENDING}.</p>
        <p className="bx-muted mt-2 text-[12.5px]">Só depois de veres o dinheiro na conta. A referência não pode repetir; fica no registo de auditoria.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-[13px] font-semibold sm:col-span-2">Cliente (KYC aprovado)
            <select className="bx-input mt-1" value={dep.user} onChange={(e) => setDep({ ...dep, user: e.target.value })}>
              <option value="">Escolher…</option>{approved.map((k) => <option key={k.userId} value={k.userId}>{k.fullName} · {k.handle}</option>)}
            </select>
          </label>
          <label className="text-[13px] font-semibold">Valor (MT)<input className="bx-input mt-1" inputMode="numeric" value={dep.amount} onChange={(e) => setDep({ ...dep, amount: e.target.value.replace(/\D/g, '').slice(0, 7) })} /></label>
          <label className="text-[13px] font-semibold">Método
            <select className="bx-input mt-1" value={dep.method} onChange={(e) => setDep({ ...dep, method: e.target.value })}>{['M-Pesa', 'e-Mola', 'Banco', 'Outro'].map((x) => <option key={x}>{x}</option>)}</select>
          </label>
          <label className="text-[13px] font-semibold sm:col-span-2">Referência da transação<input className="bx-input mt-1" value={dep.reference} maxLength={40} onChange={(e) => setDep({ ...dep, reference: e.target.value })} /></label>
        </div>
        <button type="button" className="bx-btn mt-3 w-full sm:w-auto" disabled={!dep.user || !dep.amount || dep.reference.trim().length < 3}
          onClick={() => { if (window.confirm(`Creditar ${dep.amount} MT (${dep.method} ${dep.reference.trim()})?`)) act(betsApi.deposit(dep.user, Number(dep.amount), dep.method, dep.reference), 'Depósito creditado').then(() => setDep({ ...dep, amount: '', reference: '' })); }}>Creditar</button>
      </section>

      <section className="bx-card p-4">
        <h3 className="text-base font-bold">Levantamentos</h3>
        <p className="bx-muted mt-1 text-[12.5px]">Faz a transferência no M-Pesa/e-Mola e depois marca como pago com a referência. Recusar devolve o valor à carteira do cliente.</p>
        {!m ? <div className="bx-card2 mt-2 h-16 animate-pulse" /> : m.withdrawals.length === 0 ? <p className="bx-muted mt-2 text-sm">Sem pedidos.</p> : (
          <ul className="mt-2 space-y-2">
            {m.withdrawals.map((w) => (
              <li key={w.id} className="bx-card2 p-3 text-[13px]">
                <p className="flex justify-between gap-2"><b>{fmtMt(w.amount)} · {w.method} {w.phone}</b><span className="bx-muted">{w.status}</span></p>
                <p className="bx-muted">{w.handle} · {fmtKick(w.createdAt)}{w.reference ? ` · ref. ${w.reference}` : ''}{w.note ? ` · ${w.note}` : ''}</p>
                {w.status === 'pendente' && (
                  <div className="mt-2 flex gap-2">
                    <input className="bx-input flex-1" placeholder="Referência" value={refs[w.id] ?? ''} onChange={(e) => setRefs({ ...refs, [w.id]: e.target.value })} aria-label="Referência da transferência" />
                    <button type="button" className="bx-ghost shrink-0" disabled={(refs[w.id] ?? '').trim().length < 3} onClick={() => act(betsApi.decideWithdrawal(w.id, 'pago', refs[w.id] ?? ''), 'Marcado como pago')}>Pago</button>
                    <button type="button" className="bx-ghost shrink-0 !text-[#FCA5A5]" onClick={() => { const note = window.prompt('Motivo da recusa:') ?? ''; if (note.trim()) act(betsApi.decideWithdrawal(w.id, 'recusado', note.trim()), 'Recusado e devolvido'); }}>Recusar</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ---------------- Equipas: fotos/logótipos ---------------- */
function Teams({ run }: { run: (p: Promise<Res>, ok: string) => Promise<boolean> }) {
  const { toast } = useStore();
  const [teams, setTeams] = useState<TeamInfo[] | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(() => { betsApi.allTeams().then(setTeams).catch(() => setTeams([])); }, []);
  useEffect(() => { load(); }, [load]);
  const upload = async (t: TeamInfo, file: File) => {
    setBusy(t.id);
    try { const url = await uploadPhoto(file, `teams/admin-${t.id}`, { square: true }); if (await run(betsApi.teamLogo(t.id, url), `Logótipo de ${t.name} guardado`)) load(); }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(''); }
  };
  const list = (teams ?? []).filter((t) => !q.trim() || t.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="space-y-3">
      <p className="bx-muted text-[13px]">As equipas são criadas ao agendar jogos. O logótipo enviado pelo capitão na inscrição entra sozinho; aqui podes carregar, trocar ou remover.</p>
      <input className="bx-input" placeholder="Procurar equipa" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Procurar equipa" />
      {!teams ? <div className="bx-card h-20 animate-pulse" /> : list.length === 0 ? <p className="bx-card p-4 text-center text-sm">Sem equipas.</p> : (
        <ul className="space-y-2">
          {list.map((t) => (
            <li key={t.id} className="bx-card flex items-center gap-3 p-3">
              <TeamBadge name={t.name} logo={t.logo} size={44} />
              <span className="min-w-0 flex-1"><b className="block truncate">{t.name}</b><span className="bx-muted text-[12px]">{GAMES_CFG[t.game]?.name ?? t.game}</span></span>
              <label className="bx-ghost shrink-0 cursor-pointer !px-3 !text-[13px]">
                {busy === t.id ? 'A enviar…' : t.logo ? 'Trocar' : 'Carregar'}
                <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={!!busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(t, f); }} />
              </label>
              {t.logo && <button type="button" className="bx-ghost shrink-0 !px-3 !text-[13px]" onClick={async () => { if (await run(betsApi.teamLogo(t.id, null), 'Logótipo removido')) load(); }}>Remover</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Log() {
  const [rows, setRows] = useState<LogRow[] | null>(null);
  useEffect(() => { betsApi.adminLog().then(setRows).catch(() => setRows([])); }, []);
  if (!rows) return <div className="bx-card h-24 animate-pulse" />;
  if (!rows.length) return <p className="bx-card p-4 text-center text-sm">Ainda não há ações registadas.</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.id} className="bx-card p-3 text-[13px]">
          <p className="flex flex-wrap justify-between gap-2"><b>{r.action.replace(/_/g, ' ')}</b><span className="bx-dim">{new Date(r.at).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })}</span></p>
          <p className="bx-muted break-all">{r.actor} · {r.details !== '{}' ? r.details : r.target}</p>
        </li>
      ))}
    </ul>
  );
}
