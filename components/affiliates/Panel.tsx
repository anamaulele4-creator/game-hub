'use client';

// Painel de afiliado (moderadores/influenciadores e admin): link e código, convidados, comissões, total e pendente em MT.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { IS_DEMO } from '@/lib/config';
import { AFF_ERR, GAIN_LABEL, appRole, hasAffiliatePanel } from '@/lib/affiliates';
import { AffiliateView, affApi } from '@/lib/affiliatesApi';
import { Empty, Skel, fmtDate } from '@/components/comp/Kit';

const mt = (n: number) => `${Math.round(n).toLocaleString('pt-PT')} MT`;

function Copy({ text, label }: { text: string; label: string }) {
  const { toast } = useStore();
  return (
    <button type="button" className="btn-ghost !min-h-[44px] shrink-0 !px-3 text-sm" onClick={async () => {
      try { await navigator.clipboard.writeText(text); toast(`${label} copiado`); } catch { window.prompt(`Copia o ${label.toLowerCase()}:`, text); }
    }}>Copiar</button>
  );
}

export default function AffiliatePanel() {
  const { s, ready, toast } = useStore();
  const role = appRole(s.user.role);
  const [v, setV] = useState<AffiliateView | null | undefined>(undefined);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    const r = await affApi.me(hasAffiliatePanel(role));
    if ('eligible' in r) { setV(r); setErr(''); } else { setV(null); setErr(r.code); }
  }, [role]);
  useEffect(() => { if (ready) void load(); }, [ready, load]);

  if (!ready || v === undefined) return <Skel />;
  if (!v) return <Empty>{err === 'AUTH' ? <>Entra na tua conta. <Link className="text-neon2 underline" href="/entrar?next=/afiliados">Entrar</Link></> : AFF_ERR[err] ?? 'Não foi possível abrir o painel.'}</Empty>;
  if (!v.eligible) return (
    <div className="space-y-3">
      <section className="card text-sm">
        <p className="font-bold">Programa de afiliados</p>
        <p className="mt-1 text-white/75">O painel de afiliado é para <b>moderadores (influenciadores)</b> da TXAPILOG. Se és criador de conteúdo e queres trazer a tua comunidade, fala com a equipa.</p>
        {v.referredBy && <p className="mt-2 text-white/65">Entraste pelo convite de <b>{v.referredBy}</b>.</p>}
      </section>
      {!v.referredBy && <ApplyCode onDone={load} />}
    </div>
  );

  const share = async () => {
    const text = `Junta-te a mim na TXAPILOG 🎮 Usa o meu código ${v.code}: ${v.link}`;
    if (navigator.share) { try { await navigator.share({ title: 'TXAPILOG', text, url: v.link! }); return; } catch { /* cancelado */ } }
    try { await navigator.clipboard.writeText(text); toast('Convite copiado'); } catch {}
  };

  return (
    <div className="space-y-4">
      {IS_DEMO && <p className="rounded-[14px] border border-neon/40 bg-neon/10 p-2 text-center text-xs text-neon2">Demo: convidados e comissões de exemplo, calculados com as regras reais.</p>}
      <section className="hud-card p-5">
        <p className="text-sm text-white/70">Ganhos de afiliado</p>
        <p className="stat-num text-4xl">{mt(v.total)}</p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <div className="rounded-[14px] bg-panel2 p-2"><p className="text-white/65">Pendente</p><p className="font-bold">{mt(v.pending)}</p><p className="text-[11px] text-white/50">vendas em curso</p></div>
          <div className="rounded-[14px] bg-panel2 p-2"><p className="text-white/65">Convidados</p><p className="font-bold">{v.invitedCount}</p></div>
          <div className="rounded-[14px] bg-panel2 p-2"><p className="text-white/65">Comissão</p><p className="font-bold">{v.pct.toLocaleString('pt-PT')} %</p></div>
        </div>
        {!v.enabled && <p className="mt-3 rounded-[12px] bg-white/10 p-2 text-xs">O programa está em pausa pela equipa: novas comissões não são registadas.</p>}
        <p className="mt-3 text-xs text-white/60">Recebes {v.pct.toLocaleString('pt-PT')} % sempre que um convidado teu <b>ganha dinheiro</b>: lucro de apostas, vitórias em desafios, vendas concluídas no marketplace e prémios de torneios e campeonatos. A comissão é paga pela TXAPILOG — o convidado não perde nada. Registos, depósitos, perdas e compras não contam. O valor entra na tua <Link className="text-neon2 underline" href="/carteira">carteira</Link>.</p>
      </section>

      <section className="card space-y-3">
        <p className="font-bold">O teu link de convite</p>
        <div className="flex items-center gap-2"><input className="input min-w-0 flex-1 !text-sm" readOnly value={v.link ?? ''} aria-label="Link de afiliado" onFocus={(e) => e.target.select()} /><Copy text={v.link ?? ''} label="Link" /></div>
        <div className="flex items-center gap-2">
          <span className="flex min-h-[44px] flex-1 items-center rounded-[12px] bg-panel2 px-3 font-mono text-lg font-bold tracking-widest text-neon2" aria-label="Código de afiliado">{v.code}</span>
          <Copy text={v.code ?? ''} label="Código" />
        </div>
        <button type="button" className="btn w-full" onClick={share}>Partilhar convite</button>
      </section>

      <section className="card">
        <p className="mb-2 font-bold">Convidados ({v.invitedCount})</p>
        {v.invitees.length === 0 ? <p className="text-sm text-white/60">Ainda ninguém se registou com o teu link.</p> : (
          <ul className="divide-y divide-line text-sm">{v.invitees.map((i) => (
            <li key={i.handle} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1"><b className="block truncate">{i.name || i.handle}</b><span className="block text-xs text-white/55">{i.handle} · desde {fmtDate(i.joined)}</span></span>
              <span className="shrink-0 text-xs font-semibold text-emerald-300">{i.earned > 0 ? `+${mt(i.earned)}` : '—'}</span>
            </li>))}
          </ul>
        )}
      </section>

      <section className="card">
        <p className="mb-2 font-bold">Histórico de comissões</p>
        {v.commissions.length === 0 ? <p className="text-sm text-white/60">Sem comissões ainda.</p> : (
          <ul className="divide-y divide-line text-sm">{v.commissions.map((c) => (
            <li key={c.id} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1">
                <b className="block truncate">{GAIN_LABEL[c.kind] ?? c.kind} · {c.invitee}</b>
                <span className="block text-xs text-white/55">ganho {mt(c.gain)} × {Number(c.pct).toLocaleString('pt-PT')} % · {fmtDate(c.at)}</span>
              </span>
              <span className={`shrink-0 font-bold ${c.status === 'anulado' ? 'text-white/45 line-through' : 'text-emerald-300'}`}>+{mt(c.amount)}</span>
            </li>))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-white/45">Cada ganho gera no máximo uma comissão. Se um resultado for corrigido, a comissão é anulada.</p>
      </section>
    </div>
  );
}

export function ApplyCode({ onDone }: { onDone?: () => void }) {
  const { toast } = useStore();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <section className="card space-y-2 text-sm">
      <p className="font-bold">Tens um código de afiliado?</p>
      <p className="text-white/65">Só podes associar um código, nos primeiros 7 dias da conta.</p>
      <div className="flex gap-2">
        <input className="input min-w-0 flex-1 uppercase" value={code} maxLength={16} placeholder="EX.: NYXFF4K2" autoCapitalize="characters" onChange={(e) => setCode(e.target.value)} aria-label="Código de afiliado" />
        <button type="button" className="btn shrink-0 !px-4" disabled={busy || code.trim().length < 4} onClick={async () => {
          setBusy(true); const r = await affApi.applyCode(code); setBusy(false);
          toast(r.ok ? 'Código associado.' : AFF_ERR[r.code] ?? r.code); if (r.ok) onDone?.();
        }}>Usar</button>
      </div>
    </section>
  );
}
