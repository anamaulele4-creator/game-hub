'use client';

import { useState } from 'react';
import { GRADIENTS, LIVES, Tournament, fmt, idol, mzn } from '@/lib/data';
import { Order } from '@/lib/store';
import { Tabs } from '@/components/ui';
import { useAdmin, Badge, Confirm } from './shared';
import { IS_DEMO } from '@/lib/config';
import { CoverField } from '@/components/CoverField';
import { TournamentCover } from '@/components/GameArt';
import type { CoverResult } from '@/lib/coverImage';

export function Tournaments() {
  const { a, upd, act, toast } = useAdmin();
  const [nt, setNt] = useState({ name: '', game: 'Free Fire', fee: 0, prize: 5000, slots: 32, date: '' });
  const [cover, setCover] = useState<CoverResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [editCover, setEditCover] = useState<string | null>(null);

  const create = async () => {
    const used = a.tournaments.map((t) => t.id);
    const id = IS_DEMO ? ['n1', 'n2', 'n3', 'n4', 'n5'].find((x) => !used.includes(x)) : crypto.randomUUID();
    if (!nt.name || !id) { toast(!id ? 'Limite de 5 torneios novos na demo (páginas estáticas pré-geradas)' : 'Indica um nome'); return; }
    let url: string | undefined;
    if (cover) {
      setBusy(true);
      try { const { saveCover } = await import('@/lib/coverImage'); url = await saveCover(id, cover); }
      catch (e) { setBusy(false); toast((e as Error).message + ' O torneio não foi criado.'); return; }
      setBusy(false);
    }
    upd({ tournaments: [{ id, name: nt.name, game: nt.game, mode: 'Squad', fee: nt.fee, prize: nt.prize, slots: nt.slots, filled: 0, date: nt.date.replace('T', ' ') || 'A definir', status: 'aberto', organizer: 'TXAPILOG', rules: ['Regras a publicar'], gradient: GRADIENTS[a.tournaments.length % GRADIENTS.length], ...(url ? { cover: url } : {}) }, ...a.tournaments] });
    setNt({ name: '', game: 'Free Fire', fee: 0, prize: 5000, slots: 32, date: '' }); setCover(null);
    act('Criou torneio', nt.name, url ? 'Torneio criado com imagem de capa' : 'Torneio criado');
    if (url) warnIfNoColumn(toast);
  };

  return (
    <>
      <div className="card mb-3 space-y-2">
        <p className="font-semibold">Criar torneio</p>
        <input className="input w-full" placeholder="Nome" value={nt.name} onChange={(e) => setNt({ ...nt, name: e.target.value })} />
        <select className="input w-full" value={nt.game} onChange={(e) => setNt({ ...nt, game: e.target.value })}>{GAME_OPTIONS.map((g) => <option key={g}>{g}</option>)}</select>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <label>Entrada (MZN)<input type="number" className="input w-full" value={nt.fee} onChange={(e) => setNt({ ...nt, fee: Number(e.target.value) })} /></label>
          <label>Prémio (MZN)<input type="number" className="input w-full" value={nt.prize} onChange={(e) => setNt({ ...nt, prize: Number(e.target.value) })} /></label>
          <label>Vagas<input type="number" className="input w-full" value={nt.slots} onChange={(e) => setNt({ ...nt, slots: Number(e.target.value) })} /></label>
        </div>
        <input type="datetime-local" className="input w-full" value={nt.date} onChange={(e) => setNt({ ...nt, date: e.target.value })} />
        <CoverField game={nt.game} pending={cover} onPick={setCover} onRemove={() => setCover(null)} busy={busy} />
        <button className="btn w-full" disabled={busy} onClick={create}>{busy ? 'A enviar a imagem…' : 'Criar'}</button>
      </div>
      <div className="space-y-2">
        {a.tournaments.map((t) => (
          <div key={t.id} className="card !p-3 text-sm">
            <div className="flex gap-3">
              <span className="relative h-12 w-[86px] shrink-0 overflow-hidden rounded-lg"><TournamentCover t={t} sizes="86px" shade={false} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex justify-between gap-2"><span className="truncate font-semibold">{t.name}</span><span className="shrink-0">{t.filled}/{t.slots}</span></div>
                <p className="text-xs text-white/50">{t.game} · {t.date} · receita {mzn(t.fee * t.filled)} · comissão 15% {mzn(Math.round(t.fee * t.filled * 0.15))}</p>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
              <label>Entrada<input type="number" className="input w-full !py-1" value={t.fee} onChange={(e) => upd({ tournaments: a.tournaments.map((x) => (x.id === t.id ? { ...x, fee: Number(e.target.value) } : x)) })} /></label>
              <label>Prémio<input type="number" className="input w-full !py-1" value={t.prize} onChange={(e) => upd({ tournaments: a.tournaments.map((x) => (x.id === t.id ? { ...x, prize: Number(e.target.value) } : x)) })} /></label>
              <label>Estado<select className="input w-full !py-1" value={t.status} onChange={(e) => { upd({ tournaments: a.tournaments.map((x) => (x.id === t.id ? { ...x, status: e.target.value as typeof t.status } : x)) }); act('Mudou estado do torneio', `${t.name} → ${e.target.value}`); }}><option value="aberto">aberto</option><option value="a decorrer">a decorrer</option><option value="terminado">terminado</option></select></label>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <button type="button" className="text-xs font-semibold text-neon2" onClick={() => setEditCover(editCover === t.id ? null : t.id)} aria-expanded={editCover === t.id}>{editCover === t.id ? 'Fechar imagem de capa' : t.cover ? 'Trocar imagem de capa' : 'Adicionar imagem de capa'}</button>
              <Confirm className="text-xs text-pink" label="Cancelar e eliminar torneio" question={`Eliminar ${t.name}? Inscrições pagas serão reembolsadas.`} onYes={() => { upd({ tournaments: a.tournaments.filter((x) => x.id !== t.id) }); void import('@/lib/coverImage').then((m) => m.dropCover(t.cover)); act('Eliminou torneio', t.name, 'Torneio eliminado (reembolsos automáticos na versão real)'); }} />
            </div>
            {editCover === t.id && <EditCover t={t} />}
          </div>
        ))}
      </div>
    </>
  );
}

const GAME_OPTIONS = ['Free Fire', 'Clash Royale', 'eFootball', 'Dream League Soccer', 'PUBG Mobile', 'Call of Duty Mobile'];

function warnIfNoColumn(toast: (m: string) => void) {
  if (IS_DEMO) return;
  // A sincronização corre logo a seguir; se a coluna cover_url ainda não existir, avisa o admin.
  setTimeout(() => { void import('@/lib/sync').then((m) => { if (m.missingColumn('tournaments', 'cover_url')) toast('A imagem foi enviada mas não ficou gravada: corre o SQL supabase/migrations/2026-10-10_tournament_cover.sql no Supabase.'); }); }, 2500);
}

/** Trocar/remover a capa de um torneio existente (guarda logo). */
function EditCover({ t }: { t: Tournament }) {
  const { a, upd, act, toast } = useAdmin();
  const [busy, setBusy] = useState(false);
  const setCover = (cover?: string) => upd({ tournaments: a.tournaments.map((x) => (x.id === t.id ? { ...x, cover } : x)) });
  return (
    <div className="mt-3 border-t border-line pt-3">
      <CoverField game={t.game} value={t.cover} busy={busy} compact
        onPick={async (r) => {
          setBusy(true);
          try {
            const { saveCover } = await import('@/lib/coverImage');
            const url = await saveCover(t.id, r, t.cover);
            setCover(url); act('Mudou imagem do torneio', t.name, 'Imagem de capa guardada'); warnIfNoColumn(toast);
          } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
        }}
        onRemove={async () => {
          const prev = t.cover; setCover(undefined); act('Removeu imagem do torneio', t.name, 'Imagem removida: volta a capa do jogo');
          const { dropCover } = await import('@/lib/coverImage'); await dropCover(prev);
        }} />
    </div>
  );
}

const OT = ['Produtos', 'Encomendas'] as const;
export function Shop() {
  const { a, upd, act } = useAdmin();
  const [tab, setTab] = useState<(typeof OT)[number]>('Produtos');
  const [np, setNp] = useState({ name: '', price: 500 });
  return (
    <div>
      <Tabs tabs={OT} value={tab} onChange={setTab} />
      {tab === 'Produtos' && (
        <>
          <div className="card mb-3 flex gap-2">
            <input className="input flex-1" placeholder="Novo produto" value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} />
            <input type="number" className="input w-20" value={np.price} onChange={(e) => setNp({ ...np, price: Number(e.target.value) })} />
            <button className="btn" onClick={() => { if (!np.name) return; upd({ products: [...a.products, { id: IS_DEMO ? 'pr' + Date.now() : crypto.randomUUID(), name: np.name, price: np.price, category: 'Acessórios', seller: 'TXAPILOG', emoji: '', stock: 10, rating: 5 }] }); act('Adicionou produto', np.name, 'Produto adicionado'); setNp({ name: '', price: 500 }); }}>+</button>
          </div>
          <div className="space-y-2">
            {a.products.map((p) => (
              <div key={p.id} className="card flex items-center gap-2 !p-3 text-sm">
                <span className="flex-1 truncate">{p.name}<span className="block text-[11px] text-white/50">{p.seller}</span></span>
                <label className="text-[11px]">Preço<input type="number" className="input w-20" value={p.price} onChange={(e) => upd({ products: a.products.map((x) => (x.id === p.id ? { ...x, price: Number(e.target.value) } : x)) })} /></label>
                <label className="text-[11px]">Stock<input type="number" className="input w-16" value={p.stock} onChange={(e) => upd({ products: a.products.map((x) => (x.id === p.id ? { ...x, stock: Number(e.target.value) } : x)) })} /></label>
                <button className="text-pink" aria-label="Remover" onClick={() => { upd({ products: a.products.filter((x) => x.id !== p.id) }); act('Removeu produto', p.name); }}>✕</button>
              </div>
            ))}
          </div>
        </>
      )}
      {tab === 'Encomendas' && (
        <div className="space-y-2">
          {a.orders.map((o) => (
            <div key={o.id} className="card !p-3 text-sm">
              <div className="flex justify-between"><span>{o.items}</span><span className="font-semibold">{mzn(o.total)}</span></div>
              <p className="text-xs text-white/50">{o.id} · {o.user} · {o.date} · comissão 10%: {mzn(Math.round(o.total * 0.1))}</p>
              <select className="input mt-2 w-full" value={o.status} onChange={(e) => { upd({ orders: a.orders.map((x) => (x.id === o.id ? { ...x, status: e.target.value as Order['status'] } : x)) }); act('Atualizou encomenda', `${o.id} → ${e.target.value}`, 'Encomenda atualizada'); }}>
                {['pendente', 'enviado', 'entregue', 'cancelado', 'reembolsado'].map((x) => <option key={x}>{x}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
