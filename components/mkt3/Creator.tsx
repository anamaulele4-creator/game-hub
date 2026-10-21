'use client';

// Creator OS — secções do painel do criador/vendedor. Todos os números vêm de registos reais no servidor.
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { uploadPhoto } from '@/lib/media';
import { MARKET_CATEGORIES, categoryOf, kindName } from '@/lib/market';
import { JOURNAL_KIND, PAYOUT_STATUS, PRODUCT_STATUS, STORE_STATUS, errText, fmtDate, fmtMt, mzPhone, orderLabel, slugify, toCsv, validSlug, validYoutube } from '@/lib/mkt3';
import { J, downloadText, mkt3, newIdem, useMkt3 } from '@/lib/mkt3Api';
import { listingHref } from '@/components/market/Kit';
import { Photo } from '@/components/Photo';
import { Empty, ErrorNote, Field, Kpi, Loading, Stars, Tag, toneFor, useLoad } from './Bits';

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

/* ------------------------------ Resumo ------------------------------ */
export function Overview() {
  const [from, setFrom] = useState(daysAgo(29)); const [to, setTo] = useState(today());
  const { data, error, reload } = useLoad(() => mkt3.creatorDashboard(from, to), [from, to]);
  const d = data as J | null;
  if (error) return <ErrorNote code={error} onRetry={reload} />;
  if (!d) return <Loading />;
  const k = d.kpi ?? {};
  const series = (d.series ?? []) as J[]; const maxS = Math.max(1, ...series.map((x) => x.sales));
  return (
    <div className="space-y-4">
      {d.open_disputes > 0 && <p className="bx-card p-3 text-[13.5px] text-[#FBBF24]">Tens {d.open_disputes} reclamação(ões) em aberto sobre vendas — vê o separador <b>Reclamações</b>.</p>}
      {!d.store && <p className="bx-card p-3 text-[13.5px]">Ainda não tens loja. Cria-a no separador <b>Loja</b> para teres uma página própria.</p>}
      {d.store && d.store.status !== 'ativa' && <p className="bx-card p-3 text-[13.5px]">Loja: <Tag tone={toneFor(d.store.status)}>{STORE_STATUS[d.store.status]}</Tag> {d.store.status_reason}</p>}
      <div className="flex flex-wrap items-end gap-2 text-[13px]">
        <Field label="De"><input type="date" className="bx-input !min-h-[40px]" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Até"><input type="date" className="bx-input !min-h-[40px]" value={to} min={from} max={today()} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="Total de vendas" value={k.sales_count ?? 0} hint="pedidos concluídos" />
        <Kpi label="Pedidos" value={k.orders ?? 0} />
        <Kpi label="Pendentes" value={k.pending ?? 0} />
        <Kpi label="Concluídos" value={k.completed ?? 0} />
        <Kpi label="Cancelamentos/reembolsos" value={k.cancelled ?? 0} />
        <Kpi label="Valor bruto vendido" value={fmtMt(k.gross)} />
        <Kpi label="Comissões cobradas" value={fmtMt(k.commissions)} />
        <Kpi label="Valor líquido estimado" value={fmtMt((k.net_settled ?? 0) + (k.net_pending ?? 0))} hint={`${fmtMt(k.net_settled)} recebido + ${fmtMt(k.net_pending)} em pedidos em curso`} />
        <Kpi label="Pagamentos pendentes" value={fmtMt(d.payouts?.pending)} />
        <Kpi label="Pagamentos concluídos" value={fmtMt(d.payouts?.done)} />
        <Kpi label="Avaliação média" value={d.rating?.count ? `${d.rating.avg} ★ (${d.rating.count})` : '—'} />
        <Kpi label="Clientes recorrentes" value={`${d.repeat_customers ?? 0} de ${d.customers ?? 0}`} />
      </div>
      <section className="bx-card p-4">
        <h3 className="mb-2 font-bold">Evolução das vendas</h3>
        {series.length === 0 ? <p className="bx-dim text-[13px]">Sem vendas neste período.</p> : (
          <div className="flex h-32 items-end gap-1" role="img" aria-label="Vendas por dia">
            {series.map((x) => <div key={x.day} title={`${x.day}: ${fmtMt(x.sales)} · ${x.orders} pedido(s)`} className="flex-1 rounded-t bg-[var(--bx-acc)]" style={{ height: `${Math.max(4, (x.sales / maxS) * 100)}%` }} />)}
          </div>
        )}
      </section>
      <section className="bx-card p-4 text-[13.5px]">
        <h3 className="mb-2 font-bold">Produtos mais vendidos</h3>
        {(d.top_products as J[]).length === 0 ? <p className="bx-dim">Ainda sem vendas concluídas.</p> : (
          <ol className="space-y-1">{(d.top_products as J[]).map((p) => <li key={p.product_id} className="flex justify-between gap-2"><Link className="hover:underline" href={listingHref(p.product_id)}>{p.title}</Link><span className="tabular-nums">{p.qty} un. · {fmtMt(p.revenue)}</span></li>)}</ol>
        )}
      </section>
      {(d.low_stock as J[]).length > 0 && (
        <section className="bx-card p-4 text-[13.5px]"><h3 className="mb-1 font-bold">Stock baixo</h3>{(d.low_stock as J[]).map((p) => <p key={p.id}>{p.title}: <b>{p.stock}</b></p>)}</section>
      )}
      <section className="bx-card p-4 text-[13px]">
        <h3 className="mb-2 font-bold">Avisos recentes {d.automation_errors > 0 && <Tag tone="bad">{d.automation_errors} com erro</Tag>}</h3>
        {(d.notifications as J[]).length === 0 ? <p className="bx-dim">Sem avisos.</p> : (
          <ul className="space-y-1">{(d.notifications as J[]).map((n, i) => <li key={i} className="flex justify-between gap-2"><span>{n.href ? <Link className="hover:underline" href={n.href}>{n.body}</Link> : n.body}</span><span className="bx-dim shrink-0">{n.status === 'enviada' ? fmtDate(n.at) : n.status.replace('_', ' ')}</span></li>)}</ul>
        )}
      </section>
    </div>
  );
}

/* ------------------------------ Loja ------------------------------ */
export function StoreEditor() {
  const { toast } = useStore();
  const me = useMkt3();
  const { data, error, reload } = useLoad(() => mkt3.creatorDashboard(null, null), []);
  const [f, setF] = useState<J | null>(null);
  const [busy, setBusy] = useState(false);
  const logo = useRef<HTMLInputElement>(null); const cover = useRef<HTMLInputElement>(null);
  const store = (data as J | null)?.store as J | null | undefined;
  useEffect(() => {
    if (!data) return;
    if (!store) { setF({ name: '', slug: '', description: '', category: 'outros', location: '', business_info: '', hours: '', delivery_policy: '', return_policy: '', contact_public: '', logo_url: '', cover_url: '' }); return; }
    mkt3.storePublic(store.slug).then((r) => { if (r.ok) setF({ ...r.store }); });
  }, [data, store]);
  if (error) return <ErrorNote code={error} onRetry={reload} />;
  if (!data || !f) return <Loading />;
  if (!(data as J).can_sell) return <Empty>Só criadores ou vendedores verificados (documento + selfie) podem ter loja. <Link className="bx-acc font-semibold" href="/seguranca/verificacao/?f=vendedor">Verificar identidade</Link></Empty>;
  const up = async (fl: FileList | null, key: 'logo_url' | 'cover_url') => {
    if (!fl?.[0] || !me.userId) return;
    setBusy(true);
    try { const u = await uploadPhoto(fl[0], `products/${me.userId}`, { square: key === 'logo_url' }); setF((x) => ({ ...x!, [key]: u })); } catch (e) { toast((e as Error).message); }
    setBusy(false);
  };
  const slugOk = validSlug(f.slug ?? '');
  const save = async () => {
    setBusy(true); const r = await mkt3.storeSave(f); setBusy(false);
    toast(r.ok ? 'Loja guardada.' : errText(r.code)); if (r.ok) reload();
  };
  const owner = async (a: 'submeter' | 'encerrar') => {
    if (a === 'encerrar' && !window.confirm('Encerrar a loja? Os produtos da loja são arquivados.')) return;
    const r = await mkt3.storeOwnerAction(a); toast(r.ok ? (a === 'submeter' ? (r.status === 'pendente' ? 'Enviada para verificação.' : 'Loja ativa!') : 'Loja encerrada.') : errText(r.code)); if (r.ok) reload();
  };
  const T = (k: string, label: string, max: number, rows = 0) => (
    <Field label={label}>{rows ? <textarea className="bx-input min-h-[80px] py-2" maxLength={max} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      : <input className="bx-input" maxLength={max} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}</Field>
  );
  return (
    <div className="space-y-3">
      {store && <p className="text-[13.5px]">Estado: <Tag tone={toneFor(store.status)}>{STORE_STATUS[store.status]}</Tag> {store.status_reason && <span className="bx-muted">— {store.status_reason}</span>} {store.status === 'ativa' && <Link className="bx-acc ml-2 font-semibold" href={`/marketplace/loja/?s=${store.slug}`}>Ver página pública</Link>}</p>}
      <div className="bx-card space-y-3 p-4">
        {T('name', 'Nome da loja', 60)}
        <Field label="Endereço (identificador único)" hint={`txapilog…/marketplace/loja/?s=${f.slug || '…'}${f.slug && !slugOk ? ' · só letras minúsculas, números e hífens (3–40)' : ''}`}>
          <div className="flex gap-2"><input className="bx-input" maxLength={40} value={f.slug ?? ''} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} />
            <button type="button" className="bx-ghost" onClick={() => setF({ ...f, slug: slugify(f.name ?? '') })}>Gerar</button></div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Logótipo"><button type="button" className="relative block aspect-square w-24 overflow-hidden rounded-xl border border-[var(--bx-line)]" onClick={() => logo.current?.click()} aria-label="Escolher logótipo"><Photo src={f.logo_url || null} fallback="outros" alt="" sizes="96px" /></button></Field>
          <Field label="Capa"><button type="button" className="relative block aspect-[3/1] w-full overflow-hidden rounded-xl border border-[var(--bx-line)]" onClick={() => cover.current?.click()} aria-label="Escolher capa"><Photo src={f.cover_url || null} fallback="outros" alt="" sizes="300px" /></button></Field>
          <input ref={logo} type="file" accept="image/*" className="hidden" onChange={(e) => up(e.target.files, 'logo_url')} />
          <input ref={cover} type="file" accept="image/*" className="hidden" onChange={(e) => up(e.target.files, 'cover_url')} />
        </div>
        <Field label="Categoria principal"><select className="bx-input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{MARKET_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</select></Field>
        {T('description', 'Apresentação', 2000, 4)}
        {T('location', 'Localização (opcional)', 120)}
        {T('business_info', 'Informações comerciais (ex.: NUIT, nome comercial)', 500, 2)}
        {T('hours', 'Horário (opcional)', 200)}
        {T('delivery_policy', 'Política de entrega', 1000, 3)}
        {T('return_policy', 'Política de devoluções', 1000, 3)}
        {T('contact_public', 'Contacto público (opcional)', 120)}
        <p className="bx-dim text-[12px]">Métodos de pagamento: saldo da carteira TxapZone (o único suportado de momento).</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="bx-btn" disabled={busy || !slugOk || (f.name ?? '').trim().length < 2} onClick={save}>{store ? 'Guardar alterações' : 'Criar loja'}</button>
          {store?.status === 'configuracao' && <button type="button" className="bx-ghost" onClick={() => owner('submeter')}>Enviar para verificação / ativar</button>}
          {store && ['configuracao', 'pendente', 'ativa'].includes(store.status) && <button type="button" className="bx-ghost" onClick={() => owner('encerrar')}>Encerrar loja</button>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Produtos ------------------------------ */
export function Products() {
  const { toast } = useStore();
  const { data, error, reload } = useLoad(() => mkt3.myProducts(), []);
  const [store, setStore] = useState<J | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { mkt3.creatorDashboard(null, null).then((r) => r.ok && setStore(r.store ?? null)); }, []);
  if (error) return <ErrorNote code={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const rows = data as J[];
  const quick = async (p: J, patch: J, msg: string) => { const r = await mkt3.productUpdate(p.id, patch); toast(r.ok ? msg : errText(r.code)); if (r.ok) reload(); };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2"><Link href="/marketplace/anunciar" className="bx-btn">Novo produto ou serviço</Link></div>
      {rows.length === 0 ? <Empty>Ainda não publicaste nada.</Empty> : (
        <ul className="space-y-2">
          {rows.map((p) => (
            <li key={p.id} className="bx-card p-3 text-[13.5px]">
              <div className="flex gap-3">
                <span className="relative h-14 w-16 shrink-0 overflow-hidden rounded-lg"><Photo src={p.photos?.[0]} fallback={categoryOf(p.category).art} alt="" sizes="64px" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2"><Link className="line-clamp-1 font-semibold hover:underline" href={listingHref(p.id)}>{p.title}</Link><Tag tone={toneFor(p.status)}>{PRODUCT_STATUS[p.status] ?? p.status}</Tag></div>
                  <p className="bx-dim text-[12px]">{kindName(p.kind)} · {p.views} visualizações · {p.sales} vendido(s){p.store_id ? ' · na loja' : ''}</p>
                  {p.moderation_reason && <p className="text-[12px] text-[#FBBF24]">Moderação: {p.moderation_reason}</p>}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <InlineNum label="Preço (MT)" value={p.price_mzn} onSave={(v) => quick(p, { price_mzn: v, price_currency: 'MZN', price_original: v }, 'Preço atualizado.')} />
                {p.kind !== 'servico' && <InlineNum label="Stock" value={p.stock} onSave={(v) => quick(p, { stock: v }, 'Stock atualizado.')} />}
                <Link className="bx-ghost !min-h-[38px]" href={`/marketplace/anunciar?id=${p.id}`}>Editar</Link>
                <button type="button" className="bx-ghost !min-h-[38px]" onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? 'Fechar detalhes' : 'Detalhes e opções'}</button>
                <button type="button" className="bx-ghost !min-h-[38px]" onClick={async () => { const r = await mkt3.duplicate(p.id); toast(r.ok ? 'Cópia criada como rascunho.' : errText(r.code)); if (r.ok) reload(); }}>Duplicar</button>
                {['ativo', 'esgotado', 'pendente', 'rascunho'].includes(p.status) && <button type="button" className="bx-ghost !min-h-[38px]" onClick={() => window.confirm('Arquivar este produto?') && quick(p, { status: 'arquivado' }, 'Arquivado.')}>Arquivar</button>}
                {['rascunho', 'arquivado'].includes(p.status) && <button type="button" className="bx-ghost !min-h-[38px]" onClick={() => quick(p, { status: 'ativo' }, 'Enviado para publicação.')}>Publicar</button>}
                {p.status === 'ativo' && <button type="button" className="bx-ghost !min-h-[38px]" onClick={() => quick(p, { status: 'rascunho' }, 'Passou a rascunho.')}>Despublicar</button>}
              </div>
              {open === p.id && <ProductDetails p={p} store={store} onSaved={reload} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function InlineNum({ label, value, onSave }: { label: string; value: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value ?? 0));
  useEffect(() => setV(String(value ?? 0)), [value]);
  const n = Math.floor(Number(v));
  return (
    <span className="flex items-center gap-1">
      <label className="bx-dim text-[12px]">{label}<input className="bx-input !min-h-[38px] !w-24 ml-1 inline-block" inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ''))} /></label>
      {n !== value && v !== '' && <button type="button" className="bx-ghost !min-h-[38px]" onClick={() => onSave(n)}>OK</button>}
    </span>
  );
}

function ProductDetails({ p, store, onSaved }: { p: J; store: J | null; onSaved: () => void }) {
  const { toast } = useStore();
  const [f, setF] = useState<J>({
    store_id: p.store_id ?? '', condition: p.condition ?? 'digital', shipping_mzn: String(p.shipping_mzn ?? 0), delivery_info: p.delivery_info ?? '', return_policy: p.return_policy ?? '',
    videos: (p.videos ?? []).join('\n'), low_stock_threshold: String(p.low_stock_threshold ?? 2), service_area: p.service_area ?? '', lead_time_days: p.lead_time_days ? String(p.lead_time_days) : '',
    requirements: p.requirements ?? '', terms: p.terms ?? '', completion_criteria: p.completion_criteria ?? '',
  });
  const [variants, setVariants] = useState<J[] | null>(null);
  const [nv, setNv] = useState({ name: '', price: '', stock: '' });
  const loadV = () => mkt3.variants(p.id).then(setVariants);
  useEffect(() => { void loadV(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id]);
  const vids = (f.videos as string).split('\n').map((x) => x.trim()).filter(Boolean);
  const vidsOk = vids.length <= 3 && vids.every(validYoutube);
  const svc = p.kind === 'servico';
  const save = async () => {
    const patch: J = {
      store_id: f.store_id || null, condition: f.condition, shipping_mzn: Number(f.shipping_mzn) || 0, delivery_info: f.delivery_info, return_policy: f.return_policy, videos: vids,
      low_stock_threshold: Number(f.low_stock_threshold) || 0,
      ...(svc ? { service_area: f.service_area, lead_time_days: f.lead_time_days ? Number(f.lead_time_days) : null, requirements: f.requirements, terms: f.terms, completion_criteria: f.completion_criteria } : {}),
    };
    const r = await mkt3.productUpdate(p.id, patch); toast(r.ok ? 'Detalhes guardados.' : errText(r.code)); if (r.ok) onSaved();
  };
  const addVariant = async () => {
    const r = await mkt3.variantSave(p.id, null, nv.name, Number(nv.price), Number(nv.stock) || 0, true);
    toast(r.ok ? 'Opção adicionada.' : errText(r.code)); if (r.ok) { setNv({ name: '', price: '', stock: '' }); void loadV(); }
  };
  const T = (k: string, label: string, max: number, rows = 0) => (
    <Field label={label}>{rows ? <textarea className="bx-input min-h-[60px] py-2" maxLength={max} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      : <input className="bx-input" maxLength={max} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}</Field>
  );
  return (
    <div className="mt-3 space-y-3 border-t border-[var(--bx-line)] pt-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Loja"><select className="bx-input" value={f.store_id} onChange={(e) => setF({ ...f, store_id: e.target.value })}><option value="">Sem loja (anúncio individual)</option>{store && ['configuracao', 'pendente', 'ativa'].includes(store.status) && <option value={store.id}>{store.name}</option>}</select></Field>
        <Field label="Condição"><select className="bx-input" value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })}><option value="digital">Digital (sem envio)</option><option value="novo">Físico · novo</option><option value="usado">Físico · usado</option></select></Field>
        {f.condition !== 'digital' && <Field label="Portes (MT)"><input className="bx-input" inputMode="numeric" value={f.shipping_mzn} onChange={(e) => setF({ ...f, shipping_mzn: e.target.value.replace(/\D/g, '') })} /></Field>}
        {!svc && <Field label="Aviso de stock baixo abaixo de"><input className="bx-input" inputMode="numeric" value={f.low_stock_threshold} onChange={(e) => setF({ ...f, low_stock_threshold: e.target.value.replace(/\D/g, '') })} /></Field>}
      </div>
      {T('delivery_info', 'Informações de entrega', 500, 2)}
      {T('return_policy', 'Política de devolução deste produto', 500, 2)}
      <Field label="Vídeos (links do YouTube, um por linha, até 3)" hint={!vidsOk ? 'Só links youtube.com/watch, youtube.com/shorts ou youtu.be.' : undefined}><textarea className="bx-input min-h-[60px] py-2" value={f.videos} onChange={(e) => setF({ ...f, videos: e.target.value })} /></Field>
      {svc && <>
        <div className="grid gap-3 sm:grid-cols-2">{T('service_area', 'Área de atendimento', 200)}<Field label="Prazo de execução (dias)"><input className="bx-input" inputMode="numeric" value={f.lead_time_days} onChange={(e) => setF({ ...f, lead_time_days: e.target.value.replace(/\D/g, '') })} /></Field></div>
        {T('requirements', 'Requisitos do cliente', 1000, 2)}{T('terms', 'Condições de contratação', 1000, 2)}{T('completion_criteria', 'Critérios de conclusão', 1000, 2)}
      </>}
      <button type="button" className="bx-btn" disabled={!vidsOk} onClick={save}>Guardar detalhes</button>
      <div>
        <h4 className="mb-1 font-semibold">Variantes / opções</h4>
        <p className="bx-dim mb-2 text-[12px]">Com opções ativas, o comprador escolhe uma (cada opção tem preço e stock próprios).</p>
        {!variants ? null : variants.length === 0 ? <p className="bx-dim text-[12.5px]">Sem opções.</p> : (
          <ul className="space-y-1">{variants.map((v) => <VariantRow key={v.id} v={v} product={p.id} onSaved={loadV} />)}</ul>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <input className="bx-input !w-40" placeholder="Nome (ex.: 520 💎)" maxLength={40} value={nv.name} onChange={(e) => setNv({ ...nv, name: e.target.value })} />
          <input className="bx-input !w-24" placeholder="Preço" inputMode="numeric" value={nv.price} onChange={(e) => setNv({ ...nv, price: e.target.value.replace(/\D/g, '') })} />
          <input className="bx-input !w-20" placeholder="Stock" inputMode="numeric" value={nv.stock} onChange={(e) => setNv({ ...nv, stock: e.target.value.replace(/\D/g, '') })} />
          <button type="button" className="bx-ghost" disabled={!nv.name.trim() || !Number(nv.price)} onClick={addVariant}>Adicionar</button>
        </div>
      </div>
    </div>
  );
}

function VariantRow({ v, product, onSaved }: { v: J; product: string; onSaved: () => void }) {
  const { toast } = useStore();
  const [x, setX] = useState({ price: String(v.price_mzn), stock: String(v.stock), active: v.active });
  const save = async (active = x.active) => { const r = await mkt3.variantSave(product, v.id, v.name, Number(x.price), Number(x.stock) || 0, active); toast(r.ok ? 'Opção guardada.' : errText(r.code)); if (r.ok) onSaved(); };
  return (
    <li className="flex flex-wrap items-center gap-2 text-[13px]">
      <b className="w-32 truncate">{v.name}</b>
      <input className="bx-input !min-h-[36px] !w-24" aria-label={`Preço de ${v.name}`} inputMode="numeric" value={x.price} onChange={(e) => setX({ ...x, price: e.target.value.replace(/\D/g, '') })} />
      <input className="bx-input !min-h-[36px] !w-20" aria-label={`Stock de ${v.name}`} inputMode="numeric" value={x.stock} onChange={(e) => setX({ ...x, stock: e.target.value.replace(/\D/g, '') })} />
      <button type="button" className="bx-ghost !min-h-[36px]" onClick={() => save()}>Guardar</button>
      <button type="button" className="bx-ghost !min-h-[36px]" onClick={() => { setX({ ...x, active: !x.active }); void save(!x.active); }}>{x.active ? 'Desativar' : 'Ativar'}</button>
    </li>
  );
}

/* ------------------------------ Vendas ------------------------------ */
export function Sales() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, reload } = useLoad(() => mkt3.ordersMine('vendas', status || null, page), [status, page]);
  const rows = ((data as J | null)?.rows ?? []) as J[];
  return (
    <div className="space-y-3">
      <select className="bx-input !w-auto" aria-label="Filtrar por estado" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
        <option value="">Todos os estados</option>
        {['aguarda_pagamento', 'pago', 'em_preparacao', 'enviado', 'em_execucao', 'entregue', 'disputa', 'concluido', 'cancelado', 'reembolsado', 'parcialmente_reembolsado'].map((s) => <option key={s} value={s}>{orderLabel(s)}</option>)}
      </select>
      <p className="bx-dim text-[12.5px]">Abre um pedido para o avançar e responder ao cliente no chat do pedido.</p>
      {error ? <ErrorNote code={error} onRetry={reload} /> : !data ? <Loading /> : rows.length === 0 ? <Empty>Sem pedidos.</Empty> : (
        <ul className="space-y-2">
          {rows.map((o) => (
            <li key={o.id}><Link href={`/marketplace/pedido/?id=${o.id}`} className="bx-card flex items-center gap-3 p-3 text-[13.5px] hover:border-[var(--bx-acc)]">
              <span className="min-w-0 flex-1"><b className="line-clamp-1">{o.product_title}</b><span className="bx-dim block text-[12px]">{fmtDate(o.created_at)} · @{o.other_handle} · {o.qty} un.</span></span>
              <span className="text-right"><b className="block tabular-nums">{fmtMt(o.seller_net_mzn)}</b><Tag tone={toneFor(o.status)}>{orderLabel(o.status)}</Tag></span>
            </Link></li>
          ))}
        </ul>
      )}
      <div className="flex justify-center gap-2"><button type="button" className="bx-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button><button type="button" className="bx-ghost" disabled={rows.length < 30} onClick={() => setPage(page + 1)}>Seguinte</button></div>
    </div>
  );
}

/* ------------------------------ Finanças e pagamentos ------------------------------ */
export function Finance() {
  const { toast } = useStore();
  const { data, error, reload } = useLoad(() => mkt3.sellerFinance(), []);
  const [f, setF] = useState({ amount: '', method: 'M-Pesa', phone: '' });
  const [busy, setBusy] = useState(false);
  const idem = useRef(newIdem());
  const saved = useLoad(() => mkt3.payoutMethods(), []);
  const d = data as J | null;
  if (error) return <ErrorNote code={error} onRetry={reload} />;
  if (!d) return <Loading />;
  const request = async () => {
    if (!window.confirm(`Pedir ${fmtMt(Number(f.amount))} por ${f.method} para ${mzPhone(f.phone)}? O valor sai já do saldo disponível.`)) return;
    setBusy(true); const r = await mkt3.payoutRequest(Number(f.amount), f.method, mzPhone(f.phone), idem.current); setBusy(false);
    idem.current = newIdem();
    toast(r.ok ? 'Pedido de pagamento registado.' : errText(r.code)); if (r.ok) { setF({ ...f, amount: '' }); reload(); }
  };
  const rule = d.commission_rule as J | null;
  const methods = ((saved.data as J | null)?.rows ?? []) as J[];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Kpi label="Disponível (carteira)" value={fmtMt(d.available)} />
        <Kpi label="Retido em pedidos em curso" value={fmtMt(d.pending_escrow)} hint="Libertado quando o comprador confirma" />
        <Kpi label="Retido em reclamações" value={fmtMt(d.in_dispute)} />
        <Kpi label="Bruto vendido" value={fmtMt(d.gross)} />
        <Kpi label="Comissões" value={fmtMt(d.commissions)} />
        <Kpi label="Reembolsos" value={fmtMt(d.refunds)} />
        <Kpi label="Líquido recebido" value={fmtMt(d.net)} />
        <Kpi label="Pagamentos pendentes" value={fmtMt(d.payouts_pending)} />
        <Kpi label="Pagamentos concluídos" value={fmtMt(d.payouts_done)} />
      </div>
      <p className="bx-muted text-[12.5px]">Comissão atual: {rule ? `${Number(rule.pct)}%${rule.fixed ? ` + ${rule.fixed} MT` : ''} por venda` : 'ainda não definida pela plataforma'}. Cada pedido guarda a comissão aplicada no momento da compra.</p>
      <section className="bx-card space-y-3 p-4">
        <h3 className="font-bold">Pedir pagamento</h3>
        {!d.payouts_enabled ? <p className="text-[13px]">Pagamentos aos vendedores ainda não disponíveis.</p> : !d.identity_ok ? (
          <p className="text-[13px]">Para receber, verifica a tua identidade (documento + selfie). <Link className="bx-acc font-semibold" href="/seguranca/verificacao/?f=levantamento">Verificar</Link></p>
        ) : <>
          {methods.length > 0 && (
            <div className="flex flex-wrap gap-2 text-[13px]">{methods.map((m) => (
              <button key={m.id} type="button" className="bx-chip !min-h-[38px]" aria-pressed={f.method === m.method && mzPhone(f.phone) === m.phone} onClick={() => setF({ ...f, method: m.method, phone: m.phone })}>
                {m.method} {m.phone}{m.is_default ? ' · principal' : ''}</button>))}</div>
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Valor (MT, mín. 100)"><input className="bx-input" inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="Método"><select className="bx-input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option>M-Pesa</option><option>e-Mola</option></select></Field>
            <Field label="Número"><input className="bx-input" inputMode="tel" placeholder={f.method === 'M-Pesa' ? '84/85…' : '86/87…'} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          </div>
          <button type="button" className="bx-btn" disabled={busy || Number(f.amount) < 100 || Number(f.amount) > d.available} onClick={request}>Pedir pagamento</button>
          <p className="bx-dim text-[12px]">O pagamento só aparece como “Pago” depois de a equipa enviar o valor e registar a referência da transação do operador.</p>
        </>}
      </section>
      <PayoutMethods data={saved.data as J | null} error={saved.error} reload={saved.reload} />
      <section className="bx-card p-4 text-[13px]">
        <h3 className="mb-2 font-bold">Pedidos de pagamento</h3>
        {(d.payouts as J[]).length === 0 ? <p className="bx-dim">Nenhum.</p> : (
          <ul className="space-y-1">{(d.payouts as J[]).map((p) => <li key={p.id} className="flex justify-between gap-2"><span>{fmtMt(p.amount)} · {p.method} {p.phone} · {fmtDate(p.at)}{p.ref ? ` · ref. ${p.ref}` : ''}{p.reason ? ` · ${p.reason}` : ''}</span><Tag tone={toneFor(p.status)}>{PAYOUT_STATUS[p.status] ?? p.status}</Tag></li>)}</ul>
        )}
      </section>
      <section className="bx-card p-4 text-[13px]">
        <h3 className="mb-2 font-bold">Movimentos do marketplace</h3>
        {(d.movements as J[]).length === 0 ? <p className="bx-dim">Sem movimentos.</p> : (
          <ul className="space-y-1">{(d.movements as J[]).map((m, i) => <li key={i} className="flex justify-between gap-2"><span>{JOURNAL_KIND[m.kind] ?? m.kind} · {m.description} <span className="bx-dim">{fmtDate(m.at)}</span></span><b className={`tabular-nums ${m.amount < 0 ? 'text-[#FCA5A5]' : 'text-[#4ADE80]'}`}>{m.amount > 0 ? '+' : ''}{fmtMt(m.amount)}</b></li>)}</ul>
        )}
      </section>
    </div>
  );
}

/* ------------------------------ Avaliações ------------------------------ */
export function Reviews() {
  const { toast } = useStore();
  const { data, error, reload } = useLoad(() => mkt3.myReviews(), []);
  const [reply, setReply] = useState<Record<string, string>>({});
  if (error) return <ErrorNote code={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const rows = data as J[];
  return rows.length === 0 ? <Empty>Ainda sem avaliações.</Empty> : (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.order_id} className="bx-card p-3 text-[13.5px]">
          <div className="flex justify-between"><Stars value={r.rating} /><span className="bx-dim text-[12px]">{r.buyer_name} · {fmtDate(r.created_at)}{r.edited_at ? ' · editada' : ''}</span></div>
          {r.comment && <p className="mt-1">{r.comment}</p>}
          {r.hidden && <p className="text-[12px] text-[#FBBF24]">Oculta pela moderação{r.hidden_reason ? `: ${r.hidden_reason}` : ''}</p>}
          {r.seller_reply ? <p className="bx-muted mt-1 border-l-2 border-[var(--bx-acc)] pl-2">A tua resposta: {r.seller_reply}</p> : (
            <div className="mt-2 flex gap-2">
              <input className="bx-input !min-h-[38px]" maxLength={500} aria-label="Resposta" placeholder="Responder publicamente" value={reply[r.order_id] ?? ''} onChange={(e) => setReply({ ...reply, [r.order_id]: e.target.value })} />
              <button type="button" className="bx-ghost !min-h-[38px]" disabled={(reply[r.order_id] ?? '').trim().length < 2} onClick={async () => { const x = await mkt3.reviewReply(r.order_id, reply[r.order_id]); toast(x.ok ? 'Resposta publicada.' : errText(x.code)); if (x.ok) reload(); }}>Responder</button>
            </div>
          )}
        </li>
      ))}
      <p className="bx-dim text-[12px]">As avaliações não podem ser apagadas pelo vendedor. Se uma avaliação for abusiva, denuncia-a à moderação.</p>
    </ul>
  );
}

/* ------------------------------ Cupões ------------------------------ */
export function Coupons() {
  const { toast } = useStore();
  const { data, error, reload } = useLoad(() => mkt3.coupons(), []);
  const [f, setF] = useState({ code: '', pct: '10', max: '100', until: '' });
  if (error) return <ErrorNote code={error} onRetry={reload} />;
  const save = async (code: string, pct: number, max: number, until: string | null, active: boolean) => {
    const r = await mkt3.couponSave(code, pct, max, until, active); toast(r.ok ? 'Cupão guardado.' : errText(r.code)); if (r.ok) reload();
  };
  return (
    <div className="space-y-3">
      <div className="bx-card grid gap-2 p-4 sm:grid-cols-5">
        <Field label="Código"><input className="bx-input" maxLength={16} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} /></Field>
        <Field label="Desconto %"><input className="bx-input" inputMode="numeric" value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="Usos máx."><input className="bx-input" inputMode="numeric" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="Válido até"><input type="date" className="bx-input" value={f.until} onChange={(e) => setF({ ...f, until: e.target.value })} /></Field>
        <div className="flex items-end"><button type="button" className="bx-btn w-full" disabled={f.code.length < 4 || !Number(f.pct)} onClick={() => save(f.code, Number(f.pct), Number(f.max) || 100, f.until ? `${f.until}T23:59:59+02:00` : null, true)}>Criar</button></div>
      </div>
      {!data ? <Loading /> : (data as J[]).length === 0 ? <Empty>Sem cupões.</Empty> : (
        <ul className="space-y-1 text-[13.5px]">
          {(data as J[]).map((c) => <li key={c.id} className="bx-card flex items-center justify-between gap-2 p-3"><span><b>{c.code}</b> · {c.pct}% · {c.used}/{c.max_uses} usos{c.valid_until ? ` · até ${fmtDate(c.valid_until)}` : ''}</span>
            <button type="button" className="bx-ghost !min-h-[36px]" onClick={() => save(c.code, c.pct, c.max_uses, c.valid_until, !c.active)}>{c.active ? 'Desativar' : 'Ativar'}</button></li>)}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------ Relatórios ------------------------------ */
export function Reports() {
  const { toast } = useStore();
  const [from, setFrom] = useState(daysAgo(29)); const [to, setTo] = useState(today());
  const exp = async () => {
    const r = await mkt3.creatorReport(from, to);
    if (!r.ok) { toast(errText(r.code)); return; }
    const rows = r.rows as J[];
    if (!rows.length) { toast('Sem pedidos neste período.'); return; }
    downloadText(`vendas-${from}-${to}.csv`, toCsv(rows.map((x) => ({ ...x, status: orderLabel(x.status) })),
      ['id', 'created_at', 'product_title', 'qty', 'status', 'total_mzn', 'refunded_mzn', 'commission_pct', 'commission_mzn', 'seller_net_mzn', 'settled_commission_mzn', 'settled_net_mzn', 'settled_at']));
  };
  return (
    <div className="bx-card space-y-3 p-4 text-[13.5px]">
      <p>Exporta as tuas vendas (pedidos, comissões, reembolsos e valores recebidos) em CSV.</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="De"><input type="date" className="bx-input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Até"><input type="date" className="bx-input" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        <button type="button" className="bx-btn" onClick={exp}>Exportar CSV</button>
      </div>
      <p className="bx-dim text-[12px]">Pedidos da compra segura anterior aparecem sem comissão (v3 = falso): não tiveram movimento financeiro no sistema.</p>
    </div>
  );
}

/* ------------------------------ Notificações ------------------------------ */
const EVENTS: [string, string][] = [
  ['novo_pedido', 'Novo pedido'], ['pagamento_confirmado', 'Pagamento confirmado'], ['pedido_atualizado', 'Alteração de pedido'], ['pedido_cancelado', 'Pedido cancelado'],
  ['pedido_concluido', 'Pedido concluído'], ['nova_avaliacao', 'Nova avaliação'], ['nova_mensagem', 'Nova mensagem'], ['reclamacao', 'Reclamação'], ['disputa_resolvida', 'Resolução de disputa'],
  ['reembolso', 'Reembolso'], ['pagamento_vendedor', 'Pagamento disponibilizado'], ['stock_baixo', 'Stock baixo'], ['conta', 'Alterações relevantes na conta (obrigatório)'],
];
export function NotifPrefs() {
  const { toast } = useStore();
  const { data, reload } = useLoad(() => mkt3.notifPrefs(), []);
  if (!data) return <Loading rows={1} />;
  const p = data as Record<string, boolean>;
  return (
    <div className="space-y-4">
    <Automations />
    <div className="bx-card p-4 text-[14px]">
      <p className="bx-muted mb-2 text-[13px]">Avisos dentro da plataforma. Email e SMS não estão ativos (sem integração configurada). Avisos de conta e segurança são sempre enviados.</p>
      <ul className="space-y-1">
        {EVENTS.map(([k, l]) => (
          <li key={k}><label className="flex min-h-[40px] items-center justify-between gap-2"><span>{l}</span>
            <input type="checkbox" className="h-5 w-5" disabled={k === 'conta'} checked={k === 'conta' || p[k] !== false} onChange={async (e) => { const r = await mkt3.notifPrefSet(k, e.target.checked); if (!r.ok) toast(errText(r.code)); reload(); }} /></label></li>
        ))}
      </ul>
    </div>
    </div>
  );
}

const AUTO_STATUS: Record<string, string> = { enviada: 'enviado', ignorada_preferencia: 'desligado por ti', falhou: 'falhou', canal_indisponivel: 'canal indisponível' };
/** Estado de execução de cada automação do criador (últimos 30 dias), a partir do registo real de avisos. */
function Automations() {
  const { data, error, reload } = useLoad(() => mkt3.creatorAutomations(), []);
  if (error) return <ErrorNote code={error} onRetry={reload} />;
  if (!data) return <Loading rows={1} />;
  const rows = ((data as J).rows ?? []) as J[];
  return (
    <section className="bx-card p-4 text-[13px]">
      <h3 className="mb-1 font-bold">Automações (últimos 30 dias)</h3>
      <p className="bx-dim mb-2 text-[12px]">Cada aviso fica registado com o estado. Os que falham são tentados de novo automaticamente (até 3 vezes) pelo processamento de prazos.</p>
      <ul className="divide-y divide-[var(--bx-line)]">{rows.map((r) => (
        <li key={r.event} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
          <span>{r.label}{!r.enabled && <span className="bx-dim"> · desligado</span>}</span>
          <span className="flex items-center gap-2 tabular-nums">
            <span className="bx-dim">{r.sent} enviado(s){r.skipped ? ` · ${r.skipped} desligado(s)` : ''}</span>
            {r.failed > 0 && <Tag tone="bad">{r.failed} com erro</Tag>}
            {r.last ? <span className="bx-dim">último: {AUTO_STATUS[r.last.status] ?? r.last.status} · {fmtDate(r.last.at)}{r.last.attempts > 1 ? ` · ${r.last.attempts} tentativas` : ''}</span> : <span className="bx-dim">ainda não disparou</span>}
          </span>
          {r.last?.status === 'falhou' && r.last.error && <span className="w-full text-[12px] text-[#FCA5A5]">Erro: {r.last.error}</span>}
        </li>
      ))}</ul>
    </section>
  );
}

/* ------------------------------ Métodos de recebimento ------------------------------ */
function PayoutMethods({ data, error, reload }: { data: J | null; error: string | null; reload: () => void }) {
  const { toast } = useStore();
  const [f, setF] = useState({ method: 'M-Pesa', phone: '', holder: '' });
  if (error) return <ErrorNote code={error} onRetry={reload} />;
  const rows = (data?.rows ?? []) as J[];
  const save = async (isDefault: boolean) => {
    const r = await mkt3.payoutMethodSave(f.method, mzPhone(f.phone), f.holder, isDefault);
    toast(r.ok ? 'Método guardado.' : errText(r.code)); if (r.ok) { setF({ ...f, phone: '' }); reload(); }
  };
  return (
    <section className="bx-card space-y-2 p-4 text-[13px]">
      <h3 className="font-bold">Métodos de recebimento</h3>
      <p className="bx-dim text-[12px]">Suportados: M-Pesa (84/85) e e-Mola (86/87). Até 3 números. Usa-os ao pedir pagamento.</p>
      {rows.length === 0 ? <p className="bx-dim">Nenhum guardado.</p> : (
        <ul className="space-y-1">{rows.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2"><span>{m.method} {m.phone}{m.holder_name ? ` · ${m.holder_name}` : ''} {m.is_default && <Tag tone="acc">principal</Tag>}</span>
            <span className="flex gap-2">
              {!m.is_default && <button type="button" className="bx-ghost !min-h-[34px]" onClick={async () => { const r = await mkt3.payoutMethodSave(m.method, m.phone, m.holder_name, true); toast(r.ok ? 'Agora é o principal.' : errText(r.code)); reload(); }}>Tornar principal</button>}
              <button type="button" className="bx-ghost !min-h-[34px]" onClick={async () => { if (!window.confirm('Remover este método?')) return; const r = await mkt3.payoutMethodRemove(m.id); toast(r.ok ? 'Removido.' : errText(r.code)); reload(); }}>Remover</button>
            </span></li>
        ))}</ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Método"><select className="bx-input !w-auto" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option>M-Pesa</option><option>e-Mola</option></select></Field>
        <Field label="Número"><input className="bx-input !w-36" inputMode="tel" value={f.phone} placeholder={f.method === 'M-Pesa' ? '84/85…' : '86/87…'} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Titular (opcional)"><input className="bx-input !w-40" maxLength={80} value={f.holder} onChange={(e) => setF({ ...f, holder: e.target.value })} /></Field>
        <button type="button" className="bx-btn !min-h-[44px]" disabled={!/^8[4-7]\d{7}$/.test(mzPhone(f.phone))} onClick={() => save(rows.length === 0)}>Guardar</button>
      </div>
    </section>
  );
}

/* ------------------------------ Perfil do criador ------------------------------ */
export function ProfileEditor() {
  const { toast } = useStore();
  const me = useMkt3();
  const { data, error, reload } = useLoad(() => mkt3.creatorProfile(), []);
  const [f, setF] = useState<{ name: string; bio: string; avatar: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const d = data as J | null;
  useEffect(() => { if (d) setF({ name: d.display_name ?? '', bio: d.bio ?? '', avatar: d.avatar_url ?? '' }); }, [d]);
  if (error) return <ErrorNote code={error} onRetry={reload} />;
  if (!d || !f) return <Loading />;
  const isUrl = /^https?:\/\//.test(f.avatar);
  const pick = async (fl: FileList | null) => {
    if (!fl?.[0] || !me.userId) return;
    try { const u = await uploadPhoto(fl[0], `products/${me.userId}`, { square: true }); setF((x) => ({ ...x!, avatar: u })); } catch (e) { toast((e as Error).message); }
  };
  const save = async () => {
    setBusy(true); const r = await mkt3.creatorProfileSave(f.name, f.bio, f.avatar || null); setBusy(false);
    toast(r.ok ? 'Perfil guardado.' : errText(r.code)); if (r.ok) reload();
  };
  return (
    <div className="space-y-3">
      <section className="bx-card space-y-3 p-4 text-[13.5px]">
        <h3 className="font-bold">Perfil público</h3>
        <div className="flex items-center gap-3">
          <span className="grid h-16 w-16 place-items-center overflow-hidden rounded-full bg-white/10 text-3xl">{isUrl ? <img src={f.avatar} alt="Fotografia" className="h-full w-full object-cover" /> : (f.avatar || '🙂')}</span>
          <button type="button" className="bx-ghost" onClick={() => file.current?.click()}>Mudar fotografia</button>
          <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files)} />
        </div>
        <Field label="Nome público"><input className="bx-input" maxLength={50} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Apresentação" hint={`${f.bio.length}/500 · aparece no teu perfil e na página da loja`}><textarea className="bx-input min-h-[100px] py-2" maxLength={500} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} /></Field>
        <button type="button" className="bx-btn" disabled={busy || f.name.trim().length < 2} onClick={save}>Guardar perfil</button>
      </section>
      <section className="bx-card p-4 text-[13.5px]">
        <h3 className="mb-1 font-bold">Capa e logótipo</h3>
        {d.store ? <p>A capa e o logótipo são os da tua loja “{d.store.name}” — muda-os no separador <b>Loja</b>. <Link className="bx-acc font-semibold" href={`/marketplace/loja/?s=${d.store.slug}`}>Ver a loja</Link></p>
          : <p>Cria a tua loja no separador <b>Loja</b> para teres capa, logótipo e página própria.</p>}
      </section>
    </div>
  );
}

/* ------------------------------ Reclamações das minhas vendas ------------------------------ */
const DISPUTE_LABEL: Record<string, string> = { aberta: 'Aberta', aguardando_resposta: 'A aguardar a tua resposta', em_analise: 'Em análise', aguardando_provas: 'A aguardar provas',
  solucao_proposta: 'Solução proposta', resolvida: 'Resolvida', rejeitada: 'Rejeitada', encerrada: 'Encerrada' };
export function SellerDisputes() {
  const [open, setOpen] = useState(true);
  const { data, error, reload } = useLoad(() => mkt3.creatorDisputes(open), [open]);
  if (error) return <ErrorNote code={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const rows = ((data as J).rows ?? []) as J[];
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} /> Só em aberto</label>
      {rows.length === 0 ? <Empty>{open ? 'Sem reclamações em aberto.' : 'Ainda sem reclamações.'}</Empty> : (
        <ul className="space-y-2">{rows.map((r) => (
          <li key={r.id} className="bx-card p-3 text-[13.5px]">
            <div className="flex items-start justify-between gap-2"><b>{r.product_title}</b><Tag tone={toneFor(r.status)}>{DISPUTE_LABEL[r.status] ?? r.status}</Tag></div>
            <p className="bx-dim text-[12px]">@{r.buyer_handle} · {fmtMt(r.total_mzn)} · {fmtDate(r.created_at)}{r.decision ? ` · decisão: ${r.decision}` : ''}</p>
            <p className="mt-1">{r.description}</p>
            <Link className="bx-btn mt-2 !min-h-[40px] !text-[13px]" href={`/marketplace/pedido/?id=${r.order_id}#reclamacao`}>Responder e enviar provas</Link>
          </li>
        ))}</ul>
      )}
    </div>
  );
}
