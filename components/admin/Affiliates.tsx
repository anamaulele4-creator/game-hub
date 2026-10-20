'use client';

// Admin › Afiliados & verificação: % de comissão, influenciadores, comissões recentes e análise de documentos de vendedores.
import { useCallback, useEffect, useState } from 'react';
import { AFF_ERR, GAIN_LABEL, MAX_COMMISSION_PCT, VERIF_LABEL } from '@/lib/affiliates';
import { AffOverview, VerificationItem, affApi } from '@/lib/affiliatesApi';
import { fmtDate } from '@/components/comp/Kit';
import { Badge, useAdmin } from './shared';

const mt = (n: number) => `${Math.round(n).toLocaleString('pt-PT')} MT`;

export default function Affiliates() {
  const { toast, act } = useAdmin();
  const [ov, setOv] = useState<AffOverview | null | undefined>(undefined);
  const [pct, setPct] = useState('10');
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState<'pendente' | 'aprovado' | 'rejeitado'>('pendente');
  const [items, setItems] = useState<VerificationItem[] | null>(null);
  const load = useCallback(async () => {
    const o = await affApi.adminOverview(); setOv(o);
    if (o) { setPct(String(o.pct)); setEnabled(o.enabled); }
  }, []);
  const loadV = useCallback(async () => { setItems(null); setItems(await affApi.adminVerifications(status)); }, [status]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadV(); }, [loadV]);

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

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2"><p className="font-bold">Verificação de vendedores</p>
          <div className="flex gap-1 text-xs">{(['pendente', 'aprovado', 'rejeitado'] as const).map((x) => <button key={x} type="button" onClick={() => setStatus(x)} className={`min-h-[40px] rounded-full px-3 ${status === x ? 'bg-neon font-semibold text-ink' : 'bg-panel2'}`}>{VERIF_LABEL[x]}</button>)}</div>
        </div>
        <p className="text-xs text-white/55">Obrigatória para vender contas e diamantes. As fotos estão num armazenamento privado e abrem com links temporários (5 min). Ao recusar, as fotos são apagadas.</p>
        {!items ? <div className="card h-20 animate-pulse" /> : items.length === 0 ? <p className="card text-center text-sm text-white/60">Nada por aqui.</p> : items.map((it) => <VerifCard key={it.userId} it={it} onDone={() => { void loadV(); void load(); }} />)}
      </section>
    </div>
  );
}

function VerifCard({ it, onDone }: { it: VerificationItem; onDone: () => void }) {
  const { toast, act } = useAdmin();
  const [urls, setUrls] = useState<{ doc: string | null; selfie: string | null } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const decide = async (approve: boolean) => {
    if (!approve && reason.trim().length < 5) { toast(AFF_ERR.REASON); return; }
    setBusy(true); const r = await affApi.adminReview(it, approve, reason); setBusy(false);
    if (r.ok) { act(approve ? 'Aprovou vendedor' : 'Recusou vendedor', it.handle, approve ? 'Vendedor aprovado' : 'Verificação recusada'); onDone(); } else toast(AFF_ERR[r.code] ?? r.code);
  };
  return (
    <div className="card space-y-2 !p-3 text-sm">
      <div className="flex items-center justify-between gap-2"><b>{it.name || it.handle} <span className="font-normal text-white/55">{it.handle}</span></b><Badge tone={it.status === 'aprovado' ? 'green' : it.status === 'rejeitado' ? 'red' : 'amber'}>{VERIF_LABEL[it.status]}</Badge></div>
      <p className="text-xs text-white/55">Enviado {fmtDate(it.submittedAt)}{it.reason ? ` · motivo: ${it.reason}` : ''}</p>
      {!urls ? (
        <button type="button" className="btn-ghost w-full !min-h-[44px] text-sm" onClick={async () => setUrls({ doc: await affApi.adminSignedUrl(it.docPath), selfie: await affApi.adminSignedUrl(it.selfiePath) })}>Ver documento e selfie</button>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {(['doc', 'selfie'] as const).map((k) => (
            <figure key={k} className="overflow-hidden rounded-lg border border-line bg-black/30">
              {urls[k] ? <img src={urls[k]!} alt={k === 'doc' ? 'Documento' : 'Selfie'} className="aspect-[4/3] w-full object-contain" referrerPolicy="no-referrer" /> : <p className="p-3 text-xs">Sem imagem</p>}
              <figcaption className="px-2 py-1 text-[11px] text-white/60">{k === 'doc' ? 'Documento' : 'Selfie'}</figcaption>
            </figure>
          ))}
        </div>
      )}
      {it.status === 'pendente' && (
        <>
          <input className="input w-full" placeholder="Motivo se recusares (ex.: documento ilegível)" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="rounded-xl bg-red-600 py-2 font-semibold" disabled={busy} onClick={() => decide(false)}>Recusar</button>
            <button type="button" className="rounded-xl bg-lime py-2 font-semibold text-black" disabled={busy} onClick={() => decide(true)}>Aprovar</button>
          </div>
        </>
      )}
    </div>
  );
}
