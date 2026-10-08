'use client';

import { useState } from 'react';
import { GRADIENTS, LIVES, fmt, idol, mzn } from '@/lib/data';
import { Order } from '@/lib/store';
import { Tabs } from '@/components/ui';
import { useAdmin, Badge, Confirm } from './shared';
import { IS_DEMO } from '@/lib/config';

export function Tournaments() {
  const { a, upd, act, toast } = useAdmin();
  const [nt, setNt] = useState({ name: '', game: 'Free Fire', fee: 0, prize: 5000, slots: 32, date: '' });
  return (
    <>
      <div className="card mb-3 space-y-2">
        <p className="font-semibold">Criar torneio</p>
        <input className="input w-full" placeholder="Nome" value={nt.name} onChange={(e) => setNt({ ...nt, name: e.target.value })} />
        <select className="input w-full" value={nt.game} onChange={(e) => setNt({ ...nt, game: e.target.value })}>{['Free Fire', 'eFootball', 'PUBG Mobile', 'Call of Duty Mobile'].map((g) => <option key={g}>{g}</option>)}</select>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <label>Entrada (MZN)<input type="number" className="input w-full" value={nt.fee} onChange={(e) => setNt({ ...nt, fee: Number(e.target.value) })} /></label>
          <label>Prémio (MZN)<input type="number" className="input w-full" value={nt.prize} onChange={(e) => setNt({ ...nt, prize: Number(e.target.value) })} /></label>
          <label>Vagas<input type="number" className="input w-full" value={nt.slots} onChange={(e) => setNt({ ...nt, slots: Number(e.target.value) })} /></label>
        </div>
        <input type="datetime-local" className="input w-full" value={nt.date} onChange={(e) => setNt({ ...nt, date: e.target.value })} />
        <button className="btn w-full" onClick={() => {
          const used = a.tournaments.map((t) => t.id);
          const id = IS_DEMO ? ['n1', 'n2', 'n3', 'n4', 'n5'].find((x) => !used.includes(x)) : crypto.randomUUID();
          if (!nt.name || !id) { toast(!id ? 'Limite de 5 torneios novos na demo (páginas estáticas pré-geradas)' : 'Indica um nome'); return; }
          upd({ tournaments: [{ id, name: nt.name, game: nt.game, mode: 'Squad', fee: nt.fee, prize: nt.prize, slots: nt.slots, filled: 0, date: nt.date.replace('T', ' ') || 'A definir', status: 'aberto', organizer: 'Social POIPAK', rules: ['Regras a publicar'], gradient: GRADIENTS[a.tournaments.length % GRADIENTS.length] }, ...a.tournaments] });
          setNt({ name: '', game: 'Free Fire', fee: 0, prize: 5000, slots: 32, date: '' }); act('Criou torneio', nt.name, 'Torneio criado');
        }}>Criar</button>
      </div>
      <div className="space-y-2">
        {a.tournaments.map((t) => (
          <div key={t.id} className="card !p-3 text-sm">
            <div className="flex justify-between"><span className="font-semibold">{t.name}</span><span>{t.filled}/{t.slots}</span></div>
            <p className="text-xs text-white/50">{t.game} · {t.date} · receita {mzn(t.fee * t.filled)} · comissão 15% {mzn(Math.round(t.fee * t.filled * 0.15))}</p>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
              <label>Entrada<input type="number" className="input w-full !py-1" value={t.fee} onChange={(e) => upd({ tournaments: a.tournaments.map((x) => (x.id === t.id ? { ...x, fee: Number(e.target.value) } : x)) })} /></label>
              <label>Prémio<input type="number" className="input w-full !py-1" value={t.prize} onChange={(e) => upd({ tournaments: a.tournaments.map((x) => (x.id === t.id ? { ...x, prize: Number(e.target.value) } : x)) })} /></label>
              <label>Estado<select className="input w-full !py-1" value={t.status} onChange={(e) => { upd({ tournaments: a.tournaments.map((x) => (x.id === t.id ? { ...x, status: e.target.value as typeof t.status } : x)) }); act('Mudou estado do torneio', `${t.name} → ${e.target.value}`); }}><option value="aberto">aberto</option><option value="a decorrer">a decorrer</option><option value="terminado">terminado</option></select></label>
            </div>
            <Confirm className="mt-2 text-xs text-pink" label="Cancelar e eliminar torneio" question={`Eliminar ${t.name}? Inscrições pagas serão reembolsadas.`} onYes={() => { upd({ tournaments: a.tournaments.filter((x) => x.id !== t.id) }); act('Eliminou torneio', t.name, 'Torneio eliminado (reembolsos automáticos na versão real)'); }} />
          </div>
        ))}
      </div>
    </>
  );
}

export function Lives() {
  const { a, upd, act } = useAdmin();
  return (
    <div className="space-y-2">
      <div className="card flex items-center justify-between !p-3 text-sm"><span>Presentes nas lives</span><button className={a.settings.features.presentes ? 'btn !px-3 !py-1 text-xs' : 'btn-ghost !px-3 !py-1 text-xs'} onClick={() => { upd({ settings: { ...a.settings, features: { ...a.settings.features, presentes: !a.settings.features.presentes } } }); act('Alternou presentes nas lives', String(!a.settings.features.presentes)); }}>{a.settings.features.presentes ? 'Ligados' : 'Desligados'}</button></div>
      {LIVES.map((l) => {
        const st = a.liveStatus[l.id] ?? 'ao vivo';
        return (
          <div key={l.id} className="card !p-3 text-sm">
            <div className="flex justify-between"><span className="font-semibold">{l.title}</span><Badge tone={st === 'ao vivo' ? 'green' : st === 'suspensa' ? 'red' : 'gray'}>{st}</Badge></div>
            <p className="text-xs text-white/50">{idol(l.idolId).name} · {l.game} · {fmt(l.viewers)} espectadores · há {l.startedMin} min</p>
            <div className="mt-2 flex gap-2 text-xs">
              <button className="btn-ghost flex-1 !py-1" onClick={() => { upd({ liveStatus: { ...a.liveStatus, [l.id]: st === 'suspensa' ? 'ao vivo' : 'suspensa' } }); act(st === 'suspensa' ? 'Restaurou live' : 'Suspendeu live', l.title, st === 'suspensa' ? 'Live restaurada' : 'Live suspensa'); }}>{st === 'suspensa' ? 'Restaurar' : 'Suspender'}</button>
              <button className="btn-ghost flex-1 !py-1" onClick={() => { upd({ liveStatus: { ...a.liveStatus, [l.id]: 'terminada' } }); act('Terminou live', l.title, 'Live terminada'); }}>Terminar</button>
            </div>
          </div>
        );
      })}
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
            <button className="btn" onClick={() => { if (!np.name) return; upd({ products: [...a.products, { id: IS_DEMO ? 'pr' + Date.now() : crypto.randomUUID(), name: np.name, price: np.price, category: 'Acessórios', seller: 'Social POIPAK', emoji: '📦', stock: 10, rating: 5 }] }); act('Adicionou produto', np.name, 'Produto adicionado'); setNp({ name: '', price: 500 }); }}>+</button>
          </div>
          <div className="space-y-2">
            {a.products.map((p) => (
              <div key={p.id} className="card flex items-center gap-2 !p-3 text-sm">
                <span className="text-xl">{p.emoji}</span><span className="flex-1 truncate">{p.name}<span className="block text-[11px] text-white/50">{p.seller}</span></span>
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

export function Events() {
  const { a, upd, act } = useAdmin();
  return (
    <div className="space-y-2">
      {a.events.map((e) => (
        <div key={e.id} className="card !p-3 text-sm">
          <p className="font-semibold">{e.emoji} {e.name}</p>
          <p className="text-xs text-white/50">{e.place} · {e.date}</p>
          <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
            <label>Normal (MZN)<input type="number" className="input w-full !py-1" value={e.price} onChange={(x) => upd({ events: a.events.map((y) => (y.id === e.id ? { ...y, price: Number(x.target.value) } : y)) })} /></label>
            <label>VIP (MZN)<input type="number" className="input w-full !py-1" value={e.vipPrice} onChange={(x) => upd({ events: a.events.map((y) => (y.id === e.id ? { ...y, vipPrice: Number(x.target.value) } : y)) })} /></label>
            <label>Bilhetes restantes<input type="number" className="input w-full !py-1" value={e.left} onChange={(x) => upd({ events: a.events.map((y) => (y.id === e.id ? { ...y, left: Number(x.target.value) } : y)) })} /></label>
          </div>
          <div className="mt-2 flex justify-between text-xs text-white/60"><span>Comissão 8% por bilhete</span><button className="text-neon2" onClick={() => act('Exportou lista de bilhetes', e.name, 'Lista de bilhetes exportada (demo)')}>Exportar lista ⬇️</button></div>
        </div>
      ))}
      <p className="text-center text-xs text-white/40">Novos eventos exigem páginas novas; na versão Supabase são criados dinamicamente.</p>
    </div>
  );
}
