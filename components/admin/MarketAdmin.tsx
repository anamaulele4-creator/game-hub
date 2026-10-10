'use client';

// Admin › Marketplace: catálogo (publicar/rascunho/remover/destacar em massa, importar CSV), pedidos e disputas, tarifas e câmbio.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { Photo } from '@/components/Photo';
import { CSV_HEADER, CURRENCIES, Currency, ORDER_LABEL, OrderAction, Rounding, TBD, categoryOf, fmtMoney, kindName, parseCatalogCsv, toMzn } from '@/lib/market';
import { Listing, ListingStatus, MARKET_ERR, MarketSettings, Order, Res, fetchRates, marketApi } from '@/lib/marketApi';

type Sub = 'Anúncios' | 'Importar CSV' | 'Pedidos e disputas' | 'Tarifas e câmbio';
const SUBS: Sub[] = ['Anúncios', 'Importar CSV', 'Pedidos e disputas', 'Tarifas e câmbio'];
const STATUS_LABEL: Record<ListingStatus, string> = { rascunho: 'Rascunho', ativo: 'Publicado', removido: 'Removido' };

export default function MarketAdmin() {
  const { toast } = useStore();
  const [sub, setSub] = useState<Sub>('Anúncios');
  const run = useCallback(async (p: Promise<Res>, ok: string) => {
    const r = await p.catch((e) => ({ ok: false as const, code: (e as Error).message }));
    toast(r.ok ? ok : MARKET_ERR[r.code] ?? r.code);
    return r.ok;
  }, [toast]);
  return (
    <div className="bx">
      <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
        {SUBS.map((x) => <button key={x} type="button" onClick={() => setSub(x)} aria-pressed={sub === x} className={`bx-chip shrink-0 ${sub === x ? '!border-[var(--bx-acc)] !bg-[var(--bx-acc)] !font-bold !text-[var(--bx-on)]' : ''}`}>{x}</button>)}
      </div>
      {sub === 'Anúncios' && <Listings run={run} />}
      {sub === 'Importar CSV' && <ImportCsv run={run} onDone={() => setSub('Anúncios')} />}
      {sub === 'Pedidos e disputas' && <Orders run={run} />}
      {sub === 'Tarifas e câmbio' && <Fees run={run} />}
    </div>
  );
}

type Run = (p: Promise<Res>, ok: string) => Promise<boolean>;

function Listings({ run }: { run: Run }) {
  const [list, setList] = useState<Listing[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<ListingStatus | 'todos'>('todos');
  const load = useCallback(() => { marketApi.adminListings().then(setList).catch(() => setList([])); }, []);
  useEffect(() => { load(); }, [load]);
  const shown = useMemo(() => (list ?? []).filter((l) => filter === 'todos' || l.status === filter), [list, filter]);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const bulk = async (action: Parameters<typeof marketApi.bulk>[1], label: string) => {
    if (!sel.size) return;
    if (await run(marketApi.bulk([...sel], action), `${label}: ${sel.size} anúncio(s)`)) { setSel(new Set()); load(); }
  };
  const counts = (st: ListingStatus) => (list ?? []).filter((l) => l.status === st).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-[13px]">
        {(['todos', 'rascunho', 'ativo', 'removido'] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className={`bx-chip !min-h-[40px] ${filter === f ? '!border-[var(--bx-acc)]' : ''}`}>
            {f === 'todos' ? `Todos (${list?.length ?? 0})` : `${STATUS_LABEL[f]} (${counts(f)})`}
          </button>
        ))}
      </div>
      <div className="bx-card sticky top-[64px] z-10 flex flex-wrap items-center gap-2 p-2.5">
        <label className="flex min-h-[44px] items-center gap-2 px-1 text-[13px]">
          <input type="checkbox" className="h-5 w-5" checked={shown.length > 0 && shown.every((l) => sel.has(l.id))} onChange={(e) => setSel(e.target.checked ? new Set(shown.map((l) => l.id)) : new Set())} />
          {sel.size} selecionado(s)
        </label>
        <button type="button" className="bx-btn !min-h-[40px] !px-3 !text-[13px]" disabled={!sel.size} onClick={() => bulk('publicar', 'Publicados')}>Publicar selecionados</button>
        <button type="button" className="bx-ghost !min-h-[40px] !px-3 !text-[13px]" disabled={!sel.size} onClick={() => bulk('rascunho', 'Passados a rascunho')}>Rascunho</button>
        <button type="button" className="bx-ghost !min-h-[40px] !px-3 !text-[13px]" disabled={!sel.size} onClick={() => bulk('destacar', 'Destacados')}>Destacar</button>
        <button type="button" className="bx-ghost !min-h-[40px] !px-3 !text-[13px]" disabled={!sel.size} onClick={() => bulk('nao_destacar', 'Sem destaque')}>Tirar destaque</button>
        <button type="button" className="bx-ghost !min-h-[40px] !px-3 !text-[13px] !text-[#FCA5A5]" disabled={!sel.size} onClick={() => { if (window.confirm(`Remover ${sel.size} anúncio(s) da loja?`)) bulk('remover', 'Removidos'); }}>Remover</button>
      </div>
      {!list ? <div className="bx-card h-24 animate-pulse" /> : shown.length === 0 ? <p className="bx-card p-4 text-center text-sm">Nada aqui.</p> : (
        <ul className="space-y-2">
          {shown.map((l) => (
            <li key={l.id} className="bx-card flex items-center gap-3 p-2.5 text-[13px]">
              <input type="checkbox" className="h-5 w-5 shrink-0" checked={sel.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Selecionar ${l.title}`} />
              <span className="relative block h-12 w-16 shrink-0 overflow-hidden rounded-lg"><Photo src={l.photos[0]} fallback={categoryOf(l.category).art} alt="" sizes="64px" /></span>
              <span className="min-w-0 flex-1">
                <b className="block truncate">{l.title}</b>
                <span className="bx-muted block truncate">{categoryOf(l.category).name} · {kindName(l.kind)} · {l.priceMzn > 0 ? fmtMoney(l.priceMzn, 'MZN') : 'preço a definir'} · stock {l.stock}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className={`bx-tag ${l.status === 'ativo' ? 'bg-[#16A34A]' : l.status === 'removido' ? 'bg-[#7F1D1D]' : 'bg-white/20'} text-white`}>{STATUS_LABEL[l.status]}</span>
                {l.featured && <span className="bx-tag bg-[var(--bx-acc)] text-[var(--bx-on)]">Destaque</span>}
                <Link href={`/marketplace/anunciar/?id=${l.id}`} className="bx-acc min-h-[32px] content-center text-[12.5px] font-semibold">Editar</Link>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ImportCsv({ run, onDone }: { run: Run; onDone: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => (text.trim() ? parseCatalogCsv(text) : null), [text]);
  const go = async () => {
    if (!parsed?.rows.length) return;
    setBusy(true);
    const s = await marketApi.settings();
    const { rates } = await fetchRates(s.fxOverride);
    const missingFx = parsed.rows.some((r) => r.currency !== 'MZN' && r.price > 0 && !rates);
    if (missingFx) { setBusy(false); window.alert('Sem câmbio agora: usa preços em MT ou define a taxa manual em Tarifas e câmbio.'); return; }
    const rows = parsed.rows.map((r) => ({
      category: r.category, kind: r.kind, delivery: r.delivery, title: r.title, description: r.description, stock: r.stock, whatsapp: '',
      priceCurrency: r.currency, priceOriginal: r.price, priceMzn: r.currency === 'MZN' ? Math.round(r.price) : rates ? toMzn(r.price, r.currency, rates, s.rounding) : 0,
      photos: [`art:${categoryOf(r.category).art}`],
    }));
    const ok = await run(marketApi.importRows(rows), `${rows.length} anúncio(s) importados como rascunho`);
    setBusy(false);
    if (ok) { setText(''); onDone(); }
  };
  return (
    <div className="space-y-3">
      <p className="bx-muted text-[13px]">Cola o catálogo (uma linha por anúncio, separado por ; ou ,). Ficam em rascunho com a arte do jogo; depois acrescentas as tuas fotos e publicas.</p>
      <pre className="bx-card2 overflow-x-auto p-2.5 text-[12px]">{CSV_HEADER}{'\n'}ff;conta;Conta FF nível 70;Com passes antigos;2500;MZN;1;manual{'\n'}steam;gift card;Cartão Steam 20 USD;;20;USD;5;automática</pre>
      <textarea className="bx-input min-h-[180px] py-2 font-mono text-[12.5px]" value={text} onChange={(e) => setText(e.target.value)} placeholder={CSV_HEADER} aria-label="Catálogo CSV" />
      {parsed && (
        <div className="text-[13px]">
          <p className="font-semibold">{parsed.rows.length} linha(s) válidas{parsed.errors.length ? ` · ${parsed.errors.length} com erro` : ''}</p>
          {parsed.errors.length > 0 && <ul className="mt-1 space-y-0.5 text-[#FCA5A5]">{parsed.errors.slice(0, 10).map((e) => <li key={e}>• {e}</li>)}</ul>}
        </div>
      )}
      <button type="button" className="bx-btn w-full" disabled={busy || !parsed?.rows.length} onClick={go}>{busy ? 'A importar…' : 'Importar como rascunho'}</button>
    </div>
  );
}

const ADMIN_ACTIONS: Partial<Record<OrderAction, string>> = { confirmar_pagamento: 'Registar pagamento', reembolsar: 'Reembolsar comprador', liberar: 'Pagar ao vendedor', cancelar: 'Cancelar' };

function Orders({ run }: { run: Run }) {
  const [list, setList] = useState<Order[] | null>(null);
  const [only, setOnly] = useState(true);
  const load = useCallback(() => { marketApi.orders('all').then(setList).catch(() => setList([])); }, []);
  useEffect(() => { load(); }, [load]);
  const act = async (o: Order, a: OrderAction) => {
    const ask = a === 'confirmar_pagamento' ? 'Referência do pagamento recebido (M-Pesa/e-Mola):' : a === 'reembolsar' || a === 'liberar' ? 'Decisão (fica visível no pedido):' : null;
    let note = '';
    if (ask) { const v = window.prompt(ask); if (v == null) return; note = v; }
    if (await run(marketApi.orderAction(o.id, a, note, 'admin'), 'Pedido atualizado')) load();
  };
  const shown = (list ?? []).filter((o) => !only || o.status === 'disputa' || o.status === 'aguarda_pagamento' || o.status === 'pago');
  return (
    <div className="space-y-3">
      <label className="flex min-h-[44px] items-center gap-2 text-[13px]"><input type="checkbox" className="h-5 w-5" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Só os que precisam de ação</label>
      {!list ? <div className="bx-card h-20 animate-pulse" /> : shown.length === 0 ? <p className="bx-card p-4 text-center text-sm">Sem pedidos.</p> : (
        <ul className="space-y-2">
          {shown.map((o) => (
            <li key={o.id} className="bx-card p-3 text-[13px]">
              <p className="flex justify-between gap-2"><b className="truncate">{o.productTitle}</b><span className={o.status === 'disputa' ? 'font-bold text-[#FCA5A5]' : 'bx-muted'}>{ORDER_LABEL[o.status]}</span></p>
              <p className="bx-muted">{o.qty} × {fmtMoney(o.unitPriceMzn, 'MZN')} = {fmtMoney(o.totalMzn, 'MZN')} · taxa {o.feePct == null ? TBD : `${o.feePct}%`} · {new Date(o.createdAt).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })}</p>
              {o.disputeReason && <p className="mt-1">Disputa: {o.disputeReason}</p>}
              {o.paymentRef && <p className="bx-muted">Ref. pagamento: {o.paymentRef}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                {(Object.keys(ADMIN_ACTIONS) as OrderAction[]).filter((a) => ['confirmar_pagamento', 'reembolsar', 'liberar', 'cancelar'].includes(a))
                  .filter((a) => (a === 'confirmar_pagamento' && o.status === 'aguarda_pagamento') || (a === 'reembolsar' && (o.status === 'disputa' || o.status === 'pago')) || (a === 'liberar' && o.status === 'disputa') || (a === 'cancelar' && o.status === 'aguarda_pagamento'))
                  .map((a) => <button key={a} type="button" className="bx-ghost !min-h-[40px] !px-3 !text-[13px]" onClick={() => act(o, a)}>{ADMIN_ACTIONS[a]}</button>)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Fees({ run }: { run: Run }) {
  const [s, setS] = useState<MarketSettings | null>(null);
  const [f, setF] = useState({ fee: '', hours: '', days: '', rounding: '1', BRL: '', USD: '', ZAR: '' });
  useEffect(() => {
    marketApi.settings().then((x) => {
      setS(x);
      const o = x.fxOverride;
      setF({ fee: x.feePct == null ? '' : String(x.feePct), hours: x.deliveryHours == null ? '' : String(x.deliveryHours), days: x.autoReleaseDays == null ? '' : String(x.autoReleaseDays), rounding: String(x.rounding), BRL: o.BRL ? String(o.BRL) : '', USD: o.USD ? String(o.USD) : '', ZAR: o.ZAR ? String(o.ZAR) : '' });
    });
  }, []);
  const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
  const save = () => {
    const fx: Partial<Record<Currency, number | null>> = {};
    for (const c of CURRENCIES) if (c !== 'MZN') fx[c] = num(f[c as 'BRL' | 'USD' | 'ZAR']);
    const next: MarketSettings = { feePct: num(f.fee), deliveryHours: num(f.hours), autoReleaseDays: num(f.days), rounding: Number(f.rounding) as Rounding, fxOverride: fx };
    if ([next.feePct, next.deliveryHours, next.autoReleaseDays, ...Object.values(fx)].some((x) => x != null && !(x >= 0))) { window.alert('Valores inválidos.'); return; }
    run(marketApi.saveSettings(next), 'Tarifas e câmbio guardados');
  };
  if (!s) return <div className="bx-card h-24 animate-pulse" />;
  const input = (k: keyof typeof f, label: string, hint?: string) => (
    <label className="text-[13px] font-semibold">{label}
      <input className="bx-input mt-1" inputMode="decimal" value={f[k]} placeholder={hint ?? TBD} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  );
  return (
    <div className="space-y-4">
      <section className="bx-card grid gap-3 p-4 sm:grid-cols-3">
        <p className="bx-muted text-[12.5px] sm:col-span-3">Vazio = “{TBD}” nas páginas públicas.</p>
        {input('fee', 'Taxa por venda (%)')}
        {input('hours', 'Prazo de entrega (horas)')}
        {input('days', 'Libertação automática (dias)')}
      </section>
      <section className="bx-card grid gap-3 p-4 sm:grid-cols-3">
        <p className="bx-muted text-[12.5px] sm:col-span-3">Câmbio automático (cache de 12 h). Para fixar uma taxa, indica quantos MT vale 1 unidade; vazio = usar a automática.</p>
        {input('BRL', 'MT por 1 R$', 'automático')}
        {input('USD', 'MT por 1 US$', 'automático')}
        {input('ZAR', 'MT por 1 rand', 'automático')}
        <label className="text-[13px] font-semibold sm:col-span-3">Arredondamento (para cima)
          <select className="bx-input mt-1" value={f.rounding} onChange={(e) => setF({ ...f, rounding: e.target.value })}>
            <option value="1">Ao metical</option><option value="5">Múltiplos de 5 MT</option><option value="10">Múltiplos de 10 MT</option>
          </select>
        </label>
      </section>
      <button type="button" className="bx-btn w-full" onClick={save}>Guardar</button>
    </div>
  );
}
