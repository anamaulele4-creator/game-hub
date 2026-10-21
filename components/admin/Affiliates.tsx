'use client';

// Admin › Afiliados & verificação: % de comissão, influenciadores e comissões recentes.
// A análise de documentos (vendedores, afiliados, todos) está na fila ÚNICA Admin › KYC — aqui só há o atalho.
import { useCallback, useEffect, useState } from 'react';
import { AFF_ERR, GAIN_LABEL, MAX_COMMISSION_PCT } from '@/lib/affiliates';
import { AffOverview, affApi } from '@/lib/affiliatesApi';
import { kycApi } from '@/lib/kycApi';
import { fmtDate } from '@/components/comp/Kit';
import { Badge, useAdmin } from './shared';

const mt = (n: number) => `${Math.round(n).toLocaleString('pt-PT')} MT`;

export default function Affiliates() {
  const { toast, act } = useAdmin();
  const [ov, setOv] = useState<AffOverview | null | undefined>(undefined);
  const [pct, setPct] = useState('10');
  const [enabled, setEnabled] = useState(true);
  const [kyc, setKyc] = useState<{ open: number; sellers: number } | null>(null);
  const load = useCallback(async () => {
    const o = await affApi.adminOverview(); setOv(o);
    if (o) { setPct(String(o.pct)); setEnabled(o.enabled); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void kycApi.queue({ status: '' }).then((r) => {
      if ('ok' in r) { setKyc({ open: 0, sellers: 0 }); return; }
      const open = (r.counts.pendente ?? 0) + (r.counts.em_analise ?? 0);
      setKyc({ open, sellers: r.items.filter((x) => x.purpose === 'vendedor' && (x.status === 'pendente' || x.status === 'em_analise')).length });
    });
  }, []);

  return (
    <div className="space-y-4">
      <section className="card space-y-3 text-sm">
        <p className="font-bold">Comissão de afiliados</p>
        {ov === null && <p className="rounded-lg bg-pink/20 p-2 text-xs">Sem dados: corre o SQL em /sql-afiliados.html (supabase/migrations/2026-10-20-moderador-afiliados.sql).</p>}
        <p className="text-white/70">Paga pela plataforma ao moderador (influenciador) que convidou, só quando o convidado ganha dinheiro (lucro de apostas, desafios, vendas concluídas, prémios). O convidado fica com 100 %.</p>
        <div className="flex items-end gap-2">
          <label className="flex-1 text-xs">Percentagem (0–{MAX_COMMISSION_PCT})
            <input className="input mt-1 w-full" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d.,]/g, ''))} />
          </label>
          <label className="flex min-h-[44px] items-center gap-2 text-xs"><input type="checkbox" className="h-5 w-5" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />Ativo</label>
          <button type="button" className="btn !px-4" onClick={async () => {
            const n = Number(pct.replace(',', '.'));
            const r = await affApi.adminSetSettings(n, enabled);
            if (r.ok) { act('Alterou comissão de afiliados', `${n}% ${enabled ? 'ativo' : 'em pausa'}`, 'Comissão guardada'); void load(); } else toast(AFF_ERR[r.code] ?? r.code);
          }}>Guardar</button>
        </div>
        {ov && <p className="text-xs text-white/60">Total pago em comissões: <b>{mt(ov.totalPaid)}</b> · verificações pendentes: <b>{ov.pendingVerifications}</b></p>}
      </section>

      {ov && ov.referrers.length > 0 && (
        <section className="card text-sm">
          <p className="mb-2 font-bold">Influenciadores</p>
          <ul className="divide-y divide-line">{ov.referrers.map((r) => (
            <li key={r.handle} className="flex items-center gap-2 py-2"><span className="flex-1">@{r.handle} <span className="text-xs text-white/50">{r.role}</span></span><span className="text-xs">{r.invited} convidado(s)</span><b className="w-24 text-right">{mt(r.earned)}</b></li>))}
          </ul>
        </section>
      )}
      {ov && ov.recent.length > 0 && (
        <section className="card text-sm">
          <p className="mb-2 font-bold">Comissões recentes</p>
          <ul className="divide-y divide-line">{ov.recent.map((c, i) => (
            <li key={i} className="py-2"><span className="block">{GAIN_LABEL[c.kind] ?? c.kind}: @{c.invitee} → @{c.referrer} <b className={c.status === 'anulado' ? 'line-through text-white/45' : 'text-emerald-300'}>+{mt(c.amount)}</b></span><span className="text-xs text-white/50">ganho {mt(c.gain)} · {fmtDate(c.at)}</span></li>))}
          </ul>
        </section>
      )}

      <section className="card space-y-2 text-sm">
        <p className="font-bold">Verificação de vendedores e afiliados</p>
        <p className="text-xs text-white/60">Todas as verificações de identidade e documentos (vendedores de contas/diamantes, afiliados/moderadores, levantamentos, criadores) são decididas num só sítio: Admin › KYC.</p>
        {kyc && <p className="text-xs">Por decidir: <b>{kyc.open}</b> (vendedores: <b>{kyc.sellers}</b>)</p>}
        <a href="#kyc" className="btn w-full !min-h-[48px]">Abrir a fila KYC</a>
      </section>
    </div>
  );
}
