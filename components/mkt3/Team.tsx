'use client';

// Equipa da loja (Marketplace 3.0 · Parte 8). O dono gere os membros; cada membro vê só o que a sua função permite.
// Tudo é verificado no servidor (mkt_store_member_set / mkt_team_* + RLS) e fica na auditoria.
import Link from 'next/link';
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { errText, fmtDate, fmtMt, orderLabel, PRODUCT_STATUS } from '@/lib/mkt3';
import { J, mkt3, useMkt3 } from '@/lib/mkt3Api';
import { Empty, ErrorNote, Field, Loading, Tag, toneFor, useLoad } from './Bits';

const ROLE: Record<string, string> = { gestor: 'Gestor(a)', atendimento: 'Atendimento', dono: 'Dono(a)' };
const ROLE_HINT: Record<string, string> = {
  gestor: 'Edita produtos da loja (dados, preço, stock, publicar/arquivar, opções), avança pedidos (preparar, enviar, entregar) e responde aos clientes.',
  atendimento: 'Vê os pedidos da loja e responde aos clientes. Não mexe em produtos nem em estados.',
};

export function TeamPanel() {
  const own = useLoad(() => mkt3.storeTeam(null), []);
  const mine = useLoad(() => mkt3.teamStores(), []);
  const ownErr = own.error && own.error !== 'NOT_FOUND' ? own.error : null;
  const rows = ((mine.data as J | null)?.rows ?? []) as J[];
  return (
    <div className="space-y-4">
      {ownErr ? <ErrorNote code={ownErr} onRetry={own.reload} /> : own.error === 'NOT_FOUND' ? (
        <p className="bx-card p-3 text-[13.5px]">Para teres equipa, cria primeiro a tua loja no separador <b>Loja</b>.</p>
      ) : !own.data ? <Loading rows={1} /> : <OwnerTeam data={own.data as J} reload={own.reload} />}
      {mine.error ? <ErrorNote code={mine.error} onRetry={mine.reload} /> : !mine.data ? <Loading rows={1} /> : rows.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-bold">Lojas onde estou na equipa</h3>
          {rows.map((s) => <MemberStore key={s.store_id} s={s} reload={mine.reload} />)}
        </section>
      )}
    </div>
  );
}

function OwnerTeam({ data, reload }: { data: J; reload: () => void }) {
  const { toast } = useStore();
  const [h, setH] = useState(''); const [role, setRole] = useState<'gestor' | 'atendimento'>('atendimento'); const [busy, setBusy] = useState(false);
  const members = (data.members ?? []) as J[];
  const add = async () => {
    if (h.trim().replace(/^@/, '').length < 2) { toast('Escreve o @utilizador.'); return; }
    setBusy(true); const r = await mkt3.memberSet(h.trim(), role); setBusy(false);
    toast(r.ok ? 'Equipa atualizada (fica na auditoria).' : errText(r.code)); if (r.ok) { setH(''); reload(); }
  };
  const change = async (m: J, r2: 'gestor' | 'atendimento') => { const r = await mkt3.memberSet(m.handle, r2); toast(r.ok ? 'Função alterada.' : errText(r.code)); reload(); };
  const remove = async (m: J) => {
    if (!window.confirm(`Remover @${m.handle} da equipa?`)) return;
    const r = await mkt3.memberRemove(data.store_id, m.user_id); toast(r.ok ? 'Removido da equipa.' : errText(r.code)); reload();
  };
  return (
    <section className="bx-card space-y-3 p-4 text-[13.5px]">
      <h3 className="font-bold">Equipa da loja “{data.store_name}”</h3>
      <p className="bx-muted text-[12.5px]">Só tu (dono) geres a equipa, o dinheiro, os pagamentos e os dados da loja. Máximo 10 membros.</p>
      {members.length === 0 ? <p className="bx-dim">Ainda sem membros.</p> : (
        <ul className="divide-y divide-[var(--bx-line)]">
          {members.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><b>@{m.handle}</b> <span className="bx-dim">{m.display_name} · desde {fmtDate(m.since)}</span></span>
              <span className="flex items-center gap-2">
                <select className="bx-input !min-h-[38px] !w-auto" aria-label={`Função de @${m.handle}`} value={m.role} onChange={(e) => change(m, e.target.value as 'gestor' | 'atendimento')}>
                  <option value="gestor">{ROLE.gestor}</option><option value="atendimento">{ROLE.atendimento}</option>
                </select>
                <button type="button" className="bx-ghost !min-h-[38px]" onClick={() => remove(m)}>Remover</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Convidar (@utilizador)"><input className="bx-input !w-48" value={h} placeholder="@utilizador" onChange={(e) => setH(e.target.value)} /></Field>
        <Field label="Função">
          <select className="bx-input !w-auto" value={role} onChange={(e) => setRole(e.target.value as 'gestor' | 'atendimento')}>
            <option value="atendimento">{ROLE.atendimento}</option><option value="gestor">{ROLE.gestor}</option>
          </select>
        </Field>
        <button type="button" className="bx-btn !min-h-[44px]" disabled={busy} onClick={add}>Adicionar</button>
      </div>
      <p className="bx-dim text-[12px]">{ROLE_HINT[role]}</p>
    </section>
  );
}

function MemberStore({ s, reload }: { s: J; reload: () => void }) {
  const { toast } = useStore();
  const me = useMkt3();
  const orders = useLoad(() => mkt3.teamOrders(s.store_id, null, 1), [s.store_id]);
  const leave = async () => {
    if (!window.confirm(`Sair da equipa da loja “${s.name}”?`)) return;
    if (!me.userId) return;
    const r = await mkt3.memberRemove(s.store_id, me.userId);
    toast(r.ok ? 'Saíste da equipa.' : errText(r.code)); reload();
  };
  const rows = ((orders.data as J | null)?.rows ?? []) as J[];
  return (
    <div className="bx-card space-y-3 p-4 text-[13.5px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span><b>{s.name}</b> <Tag tone="acc">{ROLE[s.role]}</Tag> <span className="bx-dim">dono @{s.owner_handle}</span></span>
        <span className="flex gap-2"><Link className="bx-ghost !min-h-[38px]" href={`/marketplace/loja/?s=${s.slug}`}>Ver loja</Link><button type="button" className="bx-ghost !min-h-[38px]" onClick={leave}>Sair da equipa</button></span>
      </div>
      <p className="bx-dim text-[12px]">{ROLE_HINT[s.role]}</p>
      <div>
        <h4 className="mb-1 font-semibold">Pedidos da loja ({s.open_orders} em curso)</h4>
        {orders.error ? <ErrorNote code={orders.error} onRetry={orders.reload} /> : !orders.data ? <Loading rows={1} /> : rows.length === 0 ? <p className="bx-dim">Sem pedidos.</p> : (
          <ul className="space-y-1">{rows.map((o) => (
            <li key={o.id} className="flex justify-between gap-2"><Link className="hover:underline" href={`/marketplace/pedido/?id=${o.id}`}>{o.product_title} · @{o.other_handle}</Link>
              <span className="flex items-center gap-2 tabular-nums">{fmtMt(o.total_mzn)} <Tag tone={toneFor(o.status)}>{orderLabel(o.status)}</Tag></span></li>
          ))}</ul>
        )}
        <p className="bx-dim mt-1 text-[12px]">Abre o pedido para {s.role === 'gestor' ? 'avançar o estado e ' : ''}responder ao cliente no chat do pedido.</p>
      </div>
      {s.role === 'gestor' && <TeamProducts products={(s.products ?? []) as J[]} reload={reload} />}
    </div>
  );
}

function TeamProducts({ products, reload }: { products: J[]; reload: () => void }) {
  const [edit, setEdit] = useState<J | null>(null);
  if (products.length === 0) return <p className="bx-dim">A loja ainda não tem produtos.</p>;
  return (
    <div>
      <h4 className="mb-1 font-semibold">Produtos da loja</h4>
      <ul className="space-y-1">{products.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
          <span>{p.title} <span className="bx-dim">· {fmtMt(p.price_mzn)}{p.kind !== 'servico' ? ` · stock ${p.stock}` : ''}</span></span>
          <span className="flex items-center gap-2"><Tag tone={toneFor(p.status)}>{PRODUCT_STATUS[p.status] ?? p.status}</Tag><button type="button" className="bx-ghost !min-h-[36px]" onClick={() => setEdit(p)}>Editar</button></span>
        </li>
      ))}</ul>
      {edit && <TeamProductForm p={edit} onDone={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function TeamProductForm({ p, onDone }: { p: J; onDone: () => void }) {
  const { toast } = useStore();
  const [f, setF] = useState({ title: p.title, description: p.description ?? '', price_mzn: String(p.price_mzn), stock: String(p.stock), delivery_info: p.delivery_info ?? '', status: p.status });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await mkt3.teamProductSave(p.id, { title: f.title, description: f.description, price_mzn: Number(f.price_mzn), stock: Number(f.stock), delivery_info: f.delivery_info,
      status: ['rascunho', 'ativo', 'arquivado'].includes(f.status) ? f.status : undefined });
    setBusy(false); toast(r.ok ? 'Produto atualizado (fica na auditoria).' : errText(r.code)); if (r.ok) onDone();
  };
  return (
    <div className="mt-3 grid gap-2 rounded-lg border border-[var(--bx-line)] p-3 sm:grid-cols-2">
      <Field label="Título"><input className="bx-input" maxLength={80} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="Preço (MT)"><input className="bx-input" inputMode="numeric" value={f.price_mzn} onChange={(e) => setF({ ...f, price_mzn: e.target.value.replace(/\D/g, '') })} /></Field>
      {p.kind !== 'servico' && <Field label="Stock"><input className="bx-input" inputMode="numeric" value={f.stock} onChange={(e) => setF({ ...f, stock: e.target.value.replace(/\D/g, '') })} /></Field>}
      <Field label="Estado">
        <select className="bx-input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} disabled={!['rascunho', 'ativo', 'arquivado', 'esgotado'].includes(p.status)}>
          {['rascunho', 'ativo', 'arquivado'].map((s) => <option key={s} value={s}>{PRODUCT_STATUS[s]}</option>)}
          {!['rascunho', 'ativo', 'arquivado'].includes(p.status) && <option value={p.status}>{PRODUCT_STATUS[p.status] ?? p.status}</option>}
        </select>
      </Field>
      <Field label="Descrição"><textarea className="bx-input min-h-[70px] py-2" maxLength={1000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Informação de entrega"><textarea className="bx-input min-h-[70px] py-2" maxLength={500} value={f.delivery_info} onChange={(e) => setF({ ...f, delivery_info: e.target.value })} /></Field>
      <div className="flex gap-2 sm:col-span-2"><button type="button" className="bx-btn" disabled={busy} onClick={save}>Guardar</button><button type="button" className="bx-ghost" onClick={onDone}>Fechar</button></div>
    </div>
  );
}
