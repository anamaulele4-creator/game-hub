'use client';

import { useState } from 'react';
import { CLIPS, COMMISSIONS, GRADIENTS, PLANS, REVENUE, fmt, idol, mzn } from '@/lib/data';
import { useStore } from '@/lib/store';
import { Page, Stat, Tabs } from '@/components/ui';

const T = ['Receitas', 'Utilizadores', 'Conteúdo', 'Torneios', 'Anúncios', 'Planos', 'Loja', 'Comissões', 'Pagamentos'] as const;
type Tb = (typeof T)[number];

export default function AdminPage() {
  const { s, set, toast } = useStore();
  const [tab, setTab] = useState<Tb>('Receitas');
  const a = s.admin;
  const upd = (patch: Partial<typeof a>) => set((p) => ({ ...p, admin: { ...p.admin, ...patch } }));
  const total = REVENUE.reduce((x, r) => x + r.value, 0);
  const max = Math.max(...REVENUE.map((r) => r.value));
  const [nt, setNt] = useState({ name: '', game: 'Free Fire', fee: 0, prize: 5000 });
  const [np, setNp] = useState({ name: '', price: 500 });

  if (s.user.role !== 'admin') return <Page title="Admin"><p>Sem acesso.</p></Page>;

  return (
    <Page title="Painel Admin" back="/perfil">
      <p className="mb-3 rounded-lg border border-amber-400/40 bg-amber-400/10 p-2 text-center text-[11px] text-amber-200">Dados simulados para demonstração (MZN, mês corrente).</p>
      <Tabs tabs={T} value={tab} onChange={setTab} />

      {tab === 'Receitas' && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2">
            <Stat label="Receita total (mês)" value={mzn(total)} />
            <Stat label="Utilizadores ativos" value={fmt(48210)} />
            <Stat label="Assinantes pagos" value={fmt(1238)} />
            <Stat label="Pagamentos pendentes" value={a.payments.filter((p) => p.status === 'pendente').length} />
          </div>
          <div className="card space-y-3">
            <p className="font-semibold">Receita por fonte</p>
            {REVENUE.map((r) => (
              <div key={r.source}>
                <div className="flex justify-between text-xs"><span>{r.source}</span><span>{mzn(r.value)} · {Math.round((r.value / total) * 100)}%</span></div>
                <div className="mt-1 h-2 rounded bg-panel2"><div className="h-2 rounded bg-gradient-to-r from-neon to-neon2" style={{ width: `${(r.value / max) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'Utilizadores' && (
        <div className="space-y-2">
          {a.users.map((u) => (
            <div key={u.id} className={`card !p-3 text-sm ${u.banned ? 'border-red-500/60' : ''}`}>
              <div className="flex justify-between"><span className="font-semibold">{u.name} {u.verified && '✅'} {u.premium && '👑'}</span><span className="chip">{u.plan}</span></div>
              <p className="text-[11px] text-white/50">{u.handle} · desde {u.joined}{u.banned ? ' · BANIDO' : ''}</p>
              <div className="mt-2 flex gap-2 text-xs">
                <button className="btn-ghost flex-1 !py-1" onClick={() => { upd({ users: a.users.map((x) => (x.id === u.id ? { ...x, verified: !x.verified } : x)) }); toast(u.verified ? 'Verificação removida' : 'Utilizador verificado'); }}>{u.verified ? 'Tirar verif.' : 'Verificar'}</button>
                <button className="btn-ghost flex-1 !py-1" onClick={() => { upd({ users: a.users.map((x) => (x.id === u.id ? { ...x, premium: !x.premium, plan: !x.premium ? 'Premium (oferta)' : 'Grátis' } : x)) }); toast(u.premium ? 'Premium removido' : 'Premium oferecido'); }}>{u.premium ? 'Tirar Premium' : 'Dar Premium'}</button>
                <button className={`flex-1 rounded-xl py-1 font-semibold ${u.banned ? 'bg-lime text-black' : 'bg-red-600'}`} onClick={() => { upd({ users: a.users.map((x) => (x.id === u.id ? { ...x, banned: !x.banned } : x)) }); toast(u.banned ? 'Utilizador readmitido' : 'Utilizador banido'); }}>{u.banned ? 'Readmitir' : 'Banir'}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'Conteúdo' && (
        <div className="space-y-2">
          <p className="text-xs text-white/60">Moderação de clipes. Denúncias simuladas.</p>
          {CLIPS.map((c, k) => {
            const hidden = a.hiddenClips.includes(c.id);
            return (
              <div key={c.id} className="card flex items-center gap-3 !p-3 text-sm">
                <span className="text-2xl">{c.emoji}</span>
                <div className="flex-1"><p>{c.title}</p><p className="text-[11px] text-white/50">{idol(c.idolId).name} · {fmt(c.views)} views · {k % 3 === 0 ? `${k + 1} denúncias` : 'sem denúncias'}</p></div>
                <button className={hidden ? 'btn !px-3 !py-1 text-xs' : 'btn-ghost !px-3 !py-1 text-xs'} onClick={() => upd({ hiddenClips: hidden ? a.hiddenClips.filter((x) => x !== c.id) : [...a.hiddenClips, c.id] })}>{hidden ? 'Repor' : 'Ocultar'}</button>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'Torneios' && (
        <>
          <div className="card mb-3 space-y-2">
            <p className="font-semibold">Criar torneio</p>
            <input className="input w-full" placeholder="Nome" value={nt.name} onChange={(e) => setNt({ ...nt, name: e.target.value })} />
            <select className="input w-full" value={nt.game} onChange={(e) => setNt({ ...nt, game: e.target.value })}>{['Free Fire', 'eFootball', 'PUBG Mobile', 'Call of Duty Mobile'].map((g) => <option key={g}>{g}</option>)}</select>
            <div className="flex gap-2"><label className="flex-1 text-xs">Entrada (MZN)<input type="number" className="input w-full" value={nt.fee} onChange={(e) => setNt({ ...nt, fee: Number(e.target.value) })} /></label><label className="flex-1 text-xs">Prémio (MZN)<input type="number" className="input w-full" value={nt.prize} onChange={(e) => setNt({ ...nt, prize: Number(e.target.value) })} /></label></div>
            <button className="btn w-full" onClick={() => {
              const used = a.tournaments.map((t) => t.id);
              const id = ['n1', 'n2', 'n3', 'n4', 'n5'].find((x) => !used.includes(x));
              if (!nt.name || !id) { toast(!id ? 'Limite de 5 torneios novos na demo' : 'Indica um nome'); return; }
              upd({ tournaments: [{ id, name: nt.name, game: nt.game, mode: 'Squad', fee: nt.fee, prize: nt.prize, slots: 32, filled: 0, date: 'A definir', status: 'aberto', organizer: 'GAME HUB', rules: ['Regras a publicar'], gradient: GRADIENTS[a.tournaments.length % GRADIENTS.length] }, ...a.tournaments] });
              setNt({ name: '', game: 'Free Fire', fee: 0, prize: 5000 }); toast('Torneio criado');
            }}>Criar</button>
          </div>
          <div className="space-y-2">
            {a.tournaments.map((t) => (
              <div key={t.id} className="card !p-3 text-sm">
                <div className="flex justify-between"><span className="font-semibold">{t.name}</span><span>{t.filled}/{t.slots}</span></div>
                <p className="text-[11px] text-white/50">{t.game} · entrada {mzn(t.fee)} · receita {mzn(t.fee * t.filled)}</p>
                <select className="input mt-2 w-full" value={t.status} onChange={(e) => upd({ tournaments: a.tournaments.map((x) => (x.id === t.id ? { ...x, status: e.target.value as typeof t.status } : x)) })}>
                  <option value="aberto">aberto</option><option value="a decorrer">a decorrer</option><option value="terminado">terminado</option>
                </select>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'Anúncios' && (
        <div className="space-y-2">
          {a.ads.map((ad) => (
            <div key={ad.id} className="card flex items-center justify-between !p-3 text-sm">
              <div><p className="font-semibold">{ad.brand}</p><p className="text-[11px] text-white/50">{ad.type} · {mzn(ad.value)}</p></div>
              <button className="chip !text-xs" onClick={() => upd({ ads: a.ads.map((x) => (x.id === ad.id ? { ...x, status: x.status === 'ativo' ? 'pausado' : 'ativo' } : x)) })}>{ad.status} ⇄</button>
            </div>
          ))}
          <p className="text-center text-xs text-white/50">Patrocínios ativos: {mzn(a.ads.filter((x) => x.status === 'ativo').reduce((t, x) => t + x.value, 0))}</p>
        </div>
      )}

      {tab === 'Planos' && (
        <div className="space-y-2">
          {PLANS.map((p) => (
            <div key={p.id} className="card flex items-center gap-3 !p-3 text-sm">
              <span className="text-2xl">{p.emoji}</span><span className="flex-1">{p.name}<span className="block text-[11px] text-white/50">/{p.period}</span></span>
              <input type="number" className="input w-24" value={a.planPrices[p.id] ?? p.price} onChange={(e) => upd({ planPrices: { ...a.planPrices, [p.id]: Number(e.target.value) } })} /><span className="text-xs">MZN</span>
            </div>
          ))}
          <p className="text-center text-xs text-white/50">Os preços alterados aparecem logo na página Planos.</p>
        </div>
      )}

      {tab === 'Loja' && (
        <>
          <div className="card mb-3 flex gap-2">
            <input className="input flex-1" placeholder="Novo produto" value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} />
            <input type="number" className="input w-20" value={np.price} onChange={(e) => setNp({ ...np, price: Number(e.target.value) })} />
            <button className="btn" onClick={() => { if (!np.name) return; upd({ products: [...a.products, { id: 'pr' + Date.now(), name: np.name, price: np.price, category: 'Acessórios', seller: 'GAME HUB', emoji: '📦', stock: 10, rating: 5 }] }); setNp({ name: '', price: 500 }); toast('Produto adicionado'); }}>+</button>
          </div>
          <div className="space-y-2">
            {a.products.map((p) => (
              <div key={p.id} className="card flex items-center gap-2 !p-3 text-sm">
                <span className="text-xl">{p.emoji}</span><span className="flex-1 truncate">{p.name}</span>
                <label className="text-[10px]">Preço<input type="number" className="input w-20" value={p.price} onChange={(e) => upd({ products: a.products.map((x) => (x.id === p.id ? { ...x, price: Number(e.target.value) } : x)) })} /></label>
                <label className="text-[10px]">Stock<input type="number" className="input w-16" value={p.stock} onChange={(e) => upd({ products: a.products.map((x) => (x.id === p.id ? { ...x, stock: Number(e.target.value) } : x)) })} /></label>
                <button className="text-pink" onClick={() => upd({ products: a.products.filter((x) => x.id !== p.id) })}>✕</button>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'Comissões' && (
        <div className="card space-y-2 text-sm">
          {COMMISSIONS.map((c) => <div key={c.area} className="flex justify-between border-b border-line pb-2 last:border-0"><span>{c.area}</span><span className="font-semibold text-neon2">{c.rate}</span></div>)}
        </div>
      )}

      {tab === 'Pagamentos' && (
        <div className="space-y-2">
          <p className="text-xs text-white/60">Integração M-Pesa / e-Mola via agregador: <b>não ativa</b> (ver supabase/functions/payments).</p>
          {a.payments.map((p) => (
            <div key={p.id} className="card !p-3 text-sm">
              <div className="flex justify-between"><span>{p.item}</span><span className="font-semibold">{mzn(p.amount)}</span></div>
              <p className="text-[11px] text-white/50">{p.user} · {p.method}</p>
              <select className="input mt-2 w-full" value={p.status} onChange={(e) => upd({ payments: a.payments.map((x) => (x.id === p.id ? { ...x, status: e.target.value } : x)) })}>
                {['pago', 'pendente', 'em processamento', 'falhou', 'reembolsado'].map((st) => <option key={st}>{st}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}
