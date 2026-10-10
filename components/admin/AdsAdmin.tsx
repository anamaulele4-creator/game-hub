'use client';

import { useState } from 'react';
import { mzn } from '@/lib/data';
import { OBJECTIVES, campaignTotals, ctr } from '@/lib/ads';
import { Stat, Tabs } from '@/components/ui';
import { Bars } from '@/components/Charts';
import { useAdmin, Badge } from './shared';

const T = ['Revisão', 'Campanhas', 'Preços', 'Receita', 'Patrocínios'] as const;

export default function AdsAdmin() {
  const { s, set, a, upd, act } = useAdmin();
  const [tab, setTab] = useState<(typeof T)[number]>('Revisão');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const st = s.adsMgr;
  const pending = st.ads.filter((x) => x.review === 'pendente');
  const review = (id: string, ok: boolean) => {
    const ad = st.ads.find((x) => x.id === id)!;
    const camp = st.campaigns.find((c) => c.id === ad.campaignId);
    set((p) => ({
      ...p,
      adsMgr: { ...p.adsMgr, ads: p.adsMgr.ads.map((x) => (x.id === id ? { ...x, review: ok ? 'aprovado' : 'rejeitado', reviewNote: ok ? undefined : notes[id] || 'Viola as políticas de anúncios' } : x)) },
      notifs: camp?.owner === p.user.handle ? [{ id: 'n' + Date.now(), type: 'sistema', text: `📢 Anúncio “${ad.name}” ${ok ? 'aprovado e a correr' : 'rejeitado: ' + (notes[id] || 'viola as políticas')}`, time: 'agora', href: '/anuncios', read: false }, ...p.notifs] : p.notifs,
    }));
    act(ok ? 'Aprovou anúncio' : 'Rejeitou anúncio', `${ad.headline} (${camp?.owner})`, ok ? 'Anúncio aprovado' : 'Anúncio rejeitado');
  };
  const revenue = st.campaigns.map((c) => ({ c, t: campaignTotals(st, c.id) }));
  const totalRev = revenue.reduce((x, r) => x + r.t.spend, 0);
  const pr = a.adPricing;
  return (
    <div>
      <Tabs tabs={T} value={tab} onChange={setTab} />
      {tab === 'Revisão' && (
        <div className="space-y-2">
          {pending.length === 0 && <p className="card text-center text-sm text-white/60">Sem anúncios por rever ✅</p>}
          {pending.map((ad) => {
            const camp = st.campaigns.find((c) => c.id === ad.campaignId);
            return (
              <div key={ad.id} className="card !p-3 text-sm">
                <div className={`relative mb-2 h-28 overflow-hidden rounded-xl bg-gradient-to-br ${ad.gradient}`}>
                  {ad.media && ad.format === 'imagem' ? <img src={ad.media} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <span className="absolute inset-0 flex items-center justify-center text-5xl">{ad.emoji}</span>}
                </div>
                <p className="font-semibold">{ad.headline} <span className="text-xs text-white/50">· {ad.cta} → {ad.url}</span></p>
                <p className="text-xs text-white/70">{ad.text}</p>
                <p className="text-xs text-white/50">{camp?.owner} · {camp?.name} · {OBJECTIVES.find((o) => o.id === camp?.objective)?.label}</p>
                {/gr[aá]tis|free|aposta|bet/i.test(ad.text + ad.headline) && <p className="mt-1 text-xs text-neon">⚠️ Possível violação: promessas de grátis / apostas</p>}
                <input className="input mt-2 w-full text-xs" placeholder="Motivo da rejeição (enviado ao anunciante)" value={notes[ad.id] ?? ''} onChange={(e) => setNotes({ ...notes, [ad.id]: e.target.value })} />
                <div className="mt-2 flex gap-2 text-xs"><button className="btn flex-1 !py-1.5" onClick={() => review(ad.id, true)}>Aprovar</button><button className="flex-1 rounded-xl bg-red-600 py-1.5 font-semibold" onClick={() => review(ad.id, false)}>Rejeitar</button></div>
              </div>
            );
          })}
        </div>
      )}
      {tab === 'Campanhas' && (
        <div className="space-y-2">
          {revenue.map(({ c, t }) => (
            <div key={c.id} className="card !p-3 text-sm">
              <div className="flex justify-between"><span className="font-semibold">{c.name}</span><Badge tone={c.status === 'ativa' ? 'green' : 'amber'}>{c.status}</Badge></div>
              <p className="text-xs text-white/50">{c.owner} · {mzn(c.budget)} {c.budgetType} · {t.imp} impr. · CTR {ctr(t).toFixed(2)}% · gasto {mzn(Math.round(t.spend))}</p>
              <button className="mt-1 text-xs text-pink" onClick={() => { set((p) => ({ ...p, adsMgr: { ...p.adsMgr, campaigns: p.adsMgr.campaigns.map((x) => (x.id === c.id ? { ...x, status: x.status === 'ativa' ? 'pausada' : 'ativa' } : x)) } })); act(c.status === 'ativa' ? 'Pausou campanha (admin)' : 'Reativou campanha (admin)', c.name); }}>{c.status === 'ativa' ? 'Pausar (admin)' : 'Reativar'}</button>
            </div>
          ))}
        </div>
      )}
      {tab === 'Preços' && (
        <div className="card space-y-2 text-sm">
          {([['minCpm', 'CPM mínimo (MZN / 1000 impressões)'], ['minCpc', 'CPC mínimo (MZN / clique)'], ['minCpf', 'Mínimo por seguidor'], ['minCpa', 'Mínimo por inscrição'], ['minDaily', 'Orçamento diário mínimo'], ['frequencyCap', 'Máx. vezes / utilizador / dia']] as const).map(([k, l]) => (
            <label key={k} className="flex items-center justify-between gap-2"><span className="text-xs">{l}</span><input type="number" className="input w-24" value={pr[k]} onChange={(e) => upd({ adPricing: { ...pr, [k]: Number(e.target.value) } })} onBlur={() => act('Alterou preço de anúncios', l)} /></label>
          ))}
          <label className="flex items-center justify-between text-xs"><span>Revisão manual obrigatória</span><input type="checkbox" className="h-5 w-5 accent-neon" checked={pr.reviewRequired} onChange={() => { upd({ adPricing: { ...pr, reviewRequired: !pr.reviewRequired } }); act('Revisão de anúncios', String(!pr.reviewRequired)); }} /></label>
          <label className="flex items-center justify-between text-xs"><span>Sistema de anúncios ligado</span><input type="checkbox" className="h-5 w-5 accent-neon" checked={a.settings.features.anuncios} onChange={() => { upd({ settings: { ...a.settings, features: { ...a.settings.features, anuncios: !a.settings.features.anuncios } } }); act('Sistema de anúncios', String(!a.settings.features.anuncios)); }} /></label>
        </div>
      )}
      {tab === 'Receita' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2"><Stat label="Receita de anúncios (total)" value={mzn(Math.round(totalRev))} /><Stat label="Campanhas ativas" value={st.campaigns.filter((c) => c.status === 'ativa').length} /></div>
          <div className="card"><p className="mb-2 text-sm font-semibold">Gasto por anunciante</p><Bars data={revenue.map(({ c, t }) => ({ label: `${c.owner} · ${c.name}`, value: Math.round(t.spend) }))} fmt={mzn} /></div>
        </div>
      )}
      {tab === 'Patrocínios' && (
        <div className="space-y-2">
          {a.ads.map((ad) => (
            <div key={ad.id} className="card flex items-center justify-between !p-3 text-sm">
              <div><p className="font-semibold">{ad.brand}</p><p className="text-xs text-white/50">{ad.type} · {mzn(ad.value)}</p></div>
              <button className="chip !text-xs" onClick={() => { upd({ ads: a.ads.map((x) => (x.id === ad.id ? { ...x, status: x.status === 'ativo' ? 'pausado' : 'ativo' } : x)) }); act('Alternou patrocínio', ad.brand); }}>{ad.status} ⇄</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
