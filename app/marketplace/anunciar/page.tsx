'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Page } from '@/components/ui';
import { Photo } from '@/components/Photo';
import { useStore } from '@/lib/store';
import { IS_DEMO } from '@/lib/config';
import { normalizeMzPhone } from '@/lib/jogos';
import { uploadPhoto } from '@/lib/media';
import { CURRENCIES, Currency, Delivery, LISTING_KINDS, ListingKind, MARKET_CATEGORIES, categoryOf, fmtMoney, toMzn } from '@/lib/market';
import { FX_SOURCE, MARKET_ERR, marketApi } from '@/lib/marketApi';
import { MarketNav, listingHref, useMarketCfg } from '@/components/market/Kit';

const MAX_PHOTOS = 5;

export default function AnunciarPage() {
  const { s, toast } = useStore();
  const router = useRouter();
  const { rates, settings, ratesAt } = useMarketCfg();
  const [id, setId] = useState<string | undefined>();
  const [f, setF] = useState({ category: 'ff', kind: 'conta' as ListingKind, title: '', description: '', price: '', currency: 'MZN' as Currency, stock: '1', delivery: 'manual' as Delivery, whatsapp: '' });
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const x = new URLSearchParams(window.location.search).get('id');
    if (!x) return;
    marketApi.listing(x).then(({ listing: l }) => {
      if (!l) return;
      setId(l.id); setPhotos(l.photos);
      setF({ category: l.category, kind: l.kind, title: l.title, description: l.description, price: l.priceCurrency === 'MZN' ? (l.priceMzn ? String(l.priceMzn) : '') : String(l.priceOriginal || ''), currency: l.priceCurrency, stock: String(l.stock), delivery: l.delivery, whatsapp: l.whatsapp });
    });
  }, []);

  const amount = Number(f.price.replace(',', '.')) || 0;
  const mzn = f.currency === 'MZN' ? Math.round(amount) : rates ? toMzn(amount, f.currency, rates, settings.rounding) : 0;
  const stock = Math.floor(Number(f.stock));
  const wa = f.whatsapp.trim() ? normalizeMzPhone(f.whatsapp) : '';
  const errs: string[] = [];
  if (f.title.trim().length < 3) errs.push('Título com pelo menos 3 caracteres.');
  if (!photos.length) errs.push('Adiciona pelo menos 1 foto.');
  if (!(stock >= 0 && stock <= 100000)) errs.push('Stock inválido.');
  if (f.currency !== 'MZN' && amount > 0 && !rates) errs.push('Câmbio indisponível agora: indica o preço em MT.');
  if (wa === null) errs.push('WhatsApp: número moçambicano (84–87).');

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    const folder = `products/${IS_DEMO ? 'demo' : (await marketApi.me()) ?? 'anon'}`;
    const room = MAX_PHOTOS - photos.length;
    const list = Array.from(files).slice(0, room);
    if (files.length > room) toast(`Máximo ${MAX_PHOTOS} fotos.`);
    setUploading(list.length);
    for (const fl of list) {
      try { const url = await uploadPhoto(fl, folder); setPhotos((p) => [...p, url]); }
      catch (e) { toast((e as Error).message); }
      setUploading((n) => n - 1);
    }
    if (file.current) file.current.value = '';
  };
  const move = (i: number, d: number) => setPhotos((p) => { const n = [...p]; const j = i + d; if (j < 0 || j >= n.length) return p; [n[i], n[j]] = [n[j], n[i]]; return n; });

  const save = async () => {
    if (!IS_DEMO && !s.account.loggedIn) { toast('Entra na tua conta para anunciar.'); return; }
    setBusy(true);
    const r = await marketApi.save({ id, category: f.category, kind: f.kind, delivery: f.delivery, title: f.title, description: f.description, priceMzn: mzn, priceCurrency: f.currency, priceOriginal: amount, stock, photos, whatsapp: wa || '' })
      .catch((e) => ({ ok: false as const, code: (e as Error).message }));
    setBusy(false);
    if (r.ok) { toast(id ? 'Anúncio atualizado.' : 'Anúncio publicado.'); router.push(listingHref(r.id ?? id ?? '')); }
    else toast(MARKET_ERR[r.code] ?? r.code);
  };

  return (
    <Page title={id ? 'Editar anúncio' : 'Anunciar'} back="/marketplace">
      <div className="bx max-w-2xl">
        <MarketNav active="anunciar" />
        <div className="space-y-4">
          <section className="bx-card grid gap-3 p-4 sm:grid-cols-2">
            <label className="text-[13px] font-semibold">Categoria
              <select className="bx-input mt-1" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{MARKET_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</select>
            </label>
            <label className="text-[13px] font-semibold">Tipo
              <select className="bx-input mt-1" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as ListingKind })}>{LISTING_KINDS.map((k) => <option key={k.key} value={k.key}>{k.name}</option>)}</select>
            </label>
            <label className="text-[13px] font-semibold sm:col-span-2">Título<input className="bx-input mt-1" value={f.title} maxLength={80} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
            <label className="text-[13px] font-semibold sm:col-span-2">Descrição
              <textarea className="bx-input mt-1 min-h-[110px] py-2" value={f.description} maxLength={1000} onChange={(e) => setF({ ...f, description: e.target.value })} />
            </label>
          </section>

          <section className="bx-card p-4">
            <p className="text-[13px] font-semibold">Fotos ({photos.length}/{MAX_PHOTOS}) · a primeira é a capa</p>
            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
              {photos.map((p, i) => (
                <div key={p + i} className="relative aspect-square overflow-hidden rounded-xl border border-[var(--bx-line)]">
                  <Photo src={p} fallback={categoryOf(f.category).art} alt={`Foto ${i + 1}`} sizes="120px" />
                  <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/55">
                    <button type="button" className="h-11 w-11 text-sm" onClick={() => move(i, -1)} aria-label="Mover para a esquerda" disabled={i === 0}>‹</button>
                    <button type="button" className="h-11 w-11 text-sm" onClick={() => setPhotos(photos.filter((_, k) => k !== i))} aria-label={`Retirar foto ${i + 1}`}>✕</button>
                    <button type="button" className="h-11 w-11 text-sm" onClick={() => move(i, 1)} aria-label="Mover para a direita" disabled={i === photos.length - 1}>›</button>
                  </div>
                </div>
              ))}
              {photos.length + uploading < MAX_PHOTOS && (
                <button type="button" onClick={() => file.current?.click()} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-[var(--bx-line)] text-[12.5px] text-white/75">
                  <span className="text-2xl leading-none">+</span>Adicionar
                </button>
              )}
              {Array.from({ length: uploading }).map((_, k) => <div key={k} className="aspect-square animate-pulse rounded-xl bg-[var(--bx-card2)]" />)}
            </div>
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => pick(e.target.files)} />
            <p className="bx-dim mt-2 text-[12px]">As fotos são reduzidas no teu telemóvel antes do envio (poupa dados).</p>
          </section>

          <section className="bx-card grid gap-3 p-4 sm:grid-cols-2">
            <label className="text-[13px] font-semibold">Preço
              <div className="mt-1 flex gap-2">
                <input className="bx-input flex-1" inputMode="decimal" value={f.price} placeholder="Vazio = a definir" onChange={(e) => setF({ ...f, price: e.target.value.replace(/[^\d.,]/g, '') })} />
                <select className="bx-input !w-24" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as Currency })} aria-label="Moeda">{CURRENCIES.map((c) => <option key={c} value={c}>{c === 'MZN' ? 'MT' : c}</option>)}</select>
              </div>
              <span className="bx-muted mt-1 block text-[12px] font-normal">
                {amount <= 0 ? 'Sem preço o anúncio mostra "Preço a definir".' : f.currency === 'MZN' ? `Preço de venda: ${fmtMoney(mzn, 'MZN')}` : rates ? `${fmtMoney(amount, f.currency)} ≈ ${fmtMoney(mzn, 'MZN')} (arredondado a ${settings.rounding} MT)` : 'A obter câmbio…'}
              </span>
            </label>
            <label className="text-[13px] font-semibold">Stock<input className="bx-input mt-1" inputMode="numeric" value={f.stock} onChange={(e) => setF({ ...f, stock: e.target.value.replace(/\D/g, '').slice(0, 6) })} /></label>
            <fieldset className="text-[13px] font-semibold">
              <legend>Entrega</legend>
              <div className="mt-1 grid grid-cols-2 gap-1 rounded-xl border border-[var(--bx-line)] p-1" role="radiogroup">
                {(['manual', 'automatica'] as const).map((d) => <button key={d} type="button" role="radio" aria-checked={f.delivery === d} onClick={() => setF({ ...f, delivery: d })} className={`min-h-[44px] rounded-lg ${f.delivery === d ? 'bg-[var(--bx-acc)] text-[var(--bx-on)]' : 'text-white/75'}`}>{d === 'manual' ? 'Manual' : 'Automática'}</button>)}
              </div>
            </fieldset>
            <label className="text-[13px] font-semibold">WhatsApp para o comprador (opcional)<input type="tel" inputMode="tel" className="bx-input mt-1" value={f.whatsapp} placeholder="84 123 4567" onChange={(e) => setF({ ...f, whatsapp: e.target.value })} /></label>
            {f.currency !== 'MZN' && <p className="bx-dim text-[11.5px] sm:col-span-2">Câmbio: <a href={FX_SOURCE.url} target="_blank" rel="noopener noreferrer" className="underline">{FX_SOURCE.name}</a>{ratesAt ? `, atualizado ${new Date(ratesAt).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })}` : ''}{Object.values(settings.fxOverride).some(Boolean) ? ' · com taxa definida pelo admin' : ''}.</p>}
          </section>

          {errs.length > 0 && <ul className="space-y-0.5 text-[13px] text-[#FCA5A5]">{errs.map((e) => <li key={e}>• {e}</li>)}</ul>}
          <button type="button" className="bx-btn w-full" disabled={busy || uploading > 0 || errs.length > 0} onClick={save}>{busy ? 'A guardar…' : id ? 'Guardar alterações' : 'Publicar anúncio'}</button>
          <p className="bx-dim text-center text-[12px]">Ao anunciar aceitas as regras da <Link href="/marketplace/como-funciona" className="underline">compra segura</Link> e a <Link href="/marketplace/reembolsos" className="underline">política de reembolso</Link>.</p>
        </div>
      </div>
    </Page>
  );
}
