'use client';

// Pedido (Marketplace 3.0): mensagens, reclamação/disputa e avaliação. Todas as regras são verificadas no servidor.
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { uploadPhoto } from '@/lib/media';
import { DISPUTE_REASONS, DISPUTE_STATUS, errText, fmtDate, fmtMt } from '@/lib/mkt3';
import { J, mkt3 } from '@/lib/mkt3Api';
import { Field, Stars, Tag, toneFor } from './Bits';

async function uploadMine(files: FileList | null, max: number, toast: (s: string) => void): Promise<string[]> {
  if (!files?.length) return [];
  const { sb } = await import('@/lib/supabase');
  const c = await sb(); const { data } = await c.auth.getSession(); const uid = data.session?.user.id;
  if (!uid) { toast('Entra na tua conta.'); return []; }
  const out: string[] = [];
  for (const f of Array.from(files).slice(0, max)) {
    try { out.push(await uploadPhoto(f, `products/${uid}`)); } catch (e) { toast((e as Error).message); }
  }
  return out;
}

export function OrderChat({ orderId }: { orderId: string }) {
  const { toast } = useStore();
  const [rows, setRows] = useState<J[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const load = async () => { const r = await mkt3.messages(orderId); if (r.ok) { setRows(r.rows); setErr(null); } else setErr(r.code); };
  useEffect(() => { void load(); const t = setInterval(load, 20_000); return () => clearInterval(t); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);
  const send = async (image: string | null = null) => {
    if (!text.trim() && !image) return;
    setBusy(true);
    const r = await mkt3.messageSend(orderId, text, image);
    setBusy(false);
    if (r.ok) { setText(''); void load(); } else toast(errText(r.code));
  };
  const report = async (id: string) => {
    const reason = window.prompt('Porque denuncias esta mensagem? (mín. 5 caracteres)'); if (!reason) return;
    const r = await mkt3.report('mensagem', id, reason); toast(r.ok ? 'Denúncia enviada.' : errText(r.code));
  };
  return (
    <section className="bx-card p-4" aria-label="Mensagens do pedido">
      <h2 className="mb-2 font-bold">Mensagens</h2>
      {err ? <p className="text-[13px]">{errText(err)}</p> : !rows ? <p className="bx-dim text-[13px]">A carregar…</p> : rows.length === 0 ? <p className="bx-dim text-[13px]">Ainda sem mensagens. Combina aqui os detalhes — nunca pagues fora da plataforma.</p> : (
        <ul className="max-h-80 space-y-2 overflow-auto pr-1" aria-live="polite">
          {rows.map((m) => (
            <li key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[13.5px] ${m.mine ? 'bg-[var(--bx-soft)]' : 'bg-[var(--bx-card2)]'}`}>
                {!m.mine && <p className="bx-dim text-[11px]">@{m.sender}</p>}
                {m.hidden ? <p className="bx-dim italic">Mensagem ocultada pela moderação.</p> : <>
                  {m.body && <p className="whitespace-pre-line break-words">{m.body}</p>}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {m.image_url && <a href={m.image_url} target="_blank" rel="noreferrer"><img src={m.image_url} alt="Imagem enviada" className="mt-1 max-h-48 rounded-lg" loading="lazy" /></a>}
                </>}
                <p className="bx-dim mt-0.5 text-right text-[10.5px]">{fmtDate(m.at)}{m.mine ? (m.read ? ' · lida' : ' · enviada') : ''}{!m.mine && !m.hidden && <> · <button type="button" className="underline" onClick={() => report(m.id)}>denunciar</button></>}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {!err && (
        <div className="mt-3 flex gap-2">
          <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={async (e) => { setBusy(true); const u = await uploadMine(e.target.files, 1, toast); setBusy(false); if (file.current) file.current.value = ''; if (u[0]) await send(u[0]); }} />
          <button type="button" className="bx-ghost !px-3" aria-label="Enviar imagem" disabled={busy} onClick={() => file.current?.click()}>📷</button>
          <input className="bx-input" aria-label="Mensagem" maxLength={1000} placeholder="Escreve uma mensagem" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void send(); }} />
          <button type="button" className="bx-btn" disabled={busy || !text.trim()} onClick={() => send()}>Enviar</button>
        </div>
      )}
    </section>
  );
}

export function DisputeBox({ order, role, onChange }: { order: J; role: string; onChange: () => void }) {
  const { toast } = useStore();
  const [d, setD] = useState<J | null>(null);
  const [form, setForm] = useState({ reason: 'nao_recebido', text: '' });
  const [evidence, setEvidence] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const load = async () => { const r = await mkt3.disputeGet(order.id); if (r.ok) setD(r); };
  useEffect(() => { void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id, order.status]);
  const pick = async (fl: FileList | null) => { setBusy(true); const u = await uploadMine(fl, 5 - evidence.length, toast); setEvidence((e) => [...e, ...u].slice(0, 5)); setBusy(false); };
  const act = async (p: Promise<{ ok: boolean; code?: string }>, okMsg: string) => {
    setBusy(true); const r = await p; setBusy(false);
    if (r.ok) { toast(okMsg); setMsg(''); setEvidence([]); setAmount(''); await load(); onChange(); } else toast(errText(r.code));
  };
  const dispute = d?.dispute as J | null | undefined;
  const canOpen = role === 'comprador' && !dispute && ['pago', 'em_preparacao', 'enviado', 'em_execucao', 'entregue'].includes(order.status);
  if (!dispute && !canOpen) return null;
  if (!dispute) {
    return (
      <section className="bx-card p-4">
        {!open ? <button type="button" className="bx-ghost" onClick={() => setOpen(true)}>Abrir reclamação</button> : (
          <div className="space-y-3">
            <h2 className="font-bold">Abrir reclamação</h2>
            <p className="bx-dim text-[12.5px]">O valor continua retido até haver acordo ou decisão da equipa.</p>
            <Field label="Motivo"><select className="bx-input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>{Object.entries(DISPUTE_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Descreve o problema (mín. 10 caracteres)"><textarea className="bx-input min-h-[90px] py-2" maxLength={2000} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} /></Field>
            <Field label={`Provas (imagens, até 5) · ${evidence.length} anexada(s)`}><input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => pick(e.target.files)} /></Field>
            <div className="flex gap-2">
              <button type="button" className="bx-btn" disabled={busy || form.text.trim().length < 10} onClick={() => act(mkt3.disputeOpen(order.id, form.reason, form.text, evidence), 'Reclamação aberta.')}>Enviar reclamação</button>
              <button type="button" className="bx-ghost" onClick={() => setOpen(false)}>Cancelar</button>
            </div>
          </div>
        )}
      </section>
    );
  }
  const closed = ['resolvida', 'rejeitada', 'encerrada'].includes(dispute.status);
  return (
    <section className="bx-card p-4 text-[13.5px]" aria-label="Reclamação">
      <div className="flex items-center justify-between gap-2"><h2 className="font-bold">Reclamação · {DISPUTE_REASONS[dispute.reason_code] ?? dispute.reason_code}</h2><Tag tone={toneFor(dispute.status)}>{DISPUTE_STATUS[dispute.status] ?? dispute.status}</Tag></div>
      {dispute.response_due_at && !closed && dispute.status === 'aguardando_resposta' && <p className="bx-dim text-[12px]">Resposta do vendedor até {fmtDate(dispute.response_due_at)}</p>}
      <ul className="mt-2 space-y-2">
        {(d!.messages as J[]).map((m, i) => (
          <li key={i} className="rounded-lg bg-[var(--bx-card2)] p-2">
            <p className="bx-dim text-[11px]">{m.role} · {fmtDate(m.at)}</p>
            <p className="whitespace-pre-line">{m.body}</p>
            {(m.evidence as string[]).length > 0 && <p className="mt-1 flex flex-wrap gap-2">{(m.evidence as string[]).map((u, k) => <a key={k} href={u} target="_blank" rel="noreferrer" className="bx-acc underline">prova {k + 1}</a>)}</p>}
          </li>
        ))}
      </ul>
      {dispute.decision && <p className="mt-2 font-semibold">Decisão: {dispute.decision}{dispute.decision_amount ? ` · ${fmtMt(dispute.decision_amount)}` : ''}{dispute.decision_reason ? ` — ${dispute.decision_reason}` : ''}</p>}
      {!closed && (role === 'comprador' || role === 'vendedor') && (
        <div className="mt-3 space-y-2">
          <textarea className="bx-input min-h-[70px] py-2" aria-label="Resposta" maxLength={2000} placeholder={role === 'vendedor' ? 'Responde e apresenta provas' : 'Acrescenta informação'} value={msg} onChange={(e) => setMsg(e.target.value)} />
          <input type="file" multiple accept="image/jpeg,image/png,image/webp" aria-label="Anexar provas" disabled={busy} onChange={(e) => pick(e.target.files)} />
          {evidence.length > 0 && <p className="bx-dim text-[12px]">{evidence.length} prova(s) anexada(s)</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="bx-btn" disabled={busy || (msg.trim().length < 2 && !evidence.length)} onClick={() => act(mkt3.disputeAction(dispute.id, 'mensagem', msg, evidence), 'Enviado.')}>Enviar</button>
            {role === 'vendedor' && (
              <span className="flex items-center gap-2">
                <input className="bx-input !w-28" inputMode="numeric" aria-label="Valor a reembolsar (MT)" placeholder="MT" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} />
                <button type="button" className="bx-ghost" disabled={busy || !Number(amount)} onClick={() => act(mkt3.disputeAction(dispute.id, 'propor', msg, [], Number(amount)), 'Proposta enviada ao comprador.')}>Propor reembolso</button>
              </span>
            )}
            {role === 'comprador' && dispute.status === 'solucao_proposta' && dispute.proposal && (
              <button type="button" className="bx-btn" disabled={busy} onClick={() => window.confirm(`Aceitas o reembolso de ${fmtMt(dispute.proposal.amount)}? O restante é libertado ao vendedor.`) && act(mkt3.disputeAction(dispute.id, 'aceitar'), 'Acordo concluído.')}>Aceitar proposta ({fmtMt(dispute.proposal.amount)})</button>
            )}
            {role === 'comprador' && <button type="button" className="bx-ghost" disabled={busy} onClick={() => window.confirm('Retirar a reclamação e libertar o valor ao vendedor?') && act(mkt3.disputeAction(dispute.id, 'desistir', 'Problema resolvido'), 'Reclamação retirada.')}>Retirar reclamação</button>}
          </div>
        </div>
      )}
    </section>
  );
}

export function ReviewBox({ order }: { order: J }) {
  const { toast } = useStore();
  const [stars, setStars] = useState(0);
  const [text, setText] = useState('');
  const [done, setDone] = useState(false);
  if (!['concluido', 'parcialmente_reembolsado'].includes(order.status)) return null;
  const save = async () => {
    const r = await mkt3.reviewSave(order.id, stars, text);
    if (r.ok) { setDone(true); toast('Obrigado pela avaliação.'); } else toast(errText(r.code));
  };
  return (
    <section className="bx-card p-4">
      <h2 className="font-bold">Avaliar a compra</h2>
      {done ? <p className="bx-muted text-[13px]">Avaliação registada. Podes editá-la uma vez nos próximos 7 dias.</p> : <>
        <Stars value={stars} onChange={setStars} />
        <input className="bx-input mt-1" maxLength={500} aria-label="Comentário" placeholder="Comentário (opcional)" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="button" className="bx-ghost mt-2" disabled={!stars} onClick={save}>Enviar avaliação</button>
      </>}
    </section>
  );
}
