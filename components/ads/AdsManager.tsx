'use client';

import { useMemo, useState } from 'react';
import { mzn, GRADIENTS } from '@/lib/data';
import { useStore } from '@/lib/store';
import { GAMES, INTERESTS, IS_DEMO, PROVINCES } from '@/lib/config';
import {
  Ad, AdSet, Campaign, CTAS, Cta, OBJECTIVES, Objective, Placement, ViewerCtx, budgetLeft, campaignSpend, campaignTotals, ctr, dayKey, minBid, recordEvent, runAuction,
} from '@/lib/ads';
import { Stat, Tabs, DemoBanner } from '@/components/ui';
import { Bars, LineChart } from '@/components/Charts';

import { CheckoutSheet } from '@/components/LazyCheckout';

const TABS = ['Visão geral', 'Criar campanha', 'Relatórios', 'Faturação'] as const;
type T = (typeof TABS)[number];
const n2 = (n: number) => n.toLocaleString('pt-PT', { maximumFractionDigits: 2 });
const STATUS_COLOR: Record<string, string> = { ativa: 'bg-lime text-black', pausada: 'bg-white/20', 'sem orçamento': 'bg-amber-400 text-black', 'sem saldo': 'bg-amber-400 text-black', terminada: 'bg-white/10' };

function chips<T extends string>(all: readonly T[], sel: string[], onChange: (v: string[]) => void) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {all.map((x) => {
        const on = sel.includes(x);
        return <button key={x} type="button" onClick={() => onChange(on ? sel.filter((y) => y !== x) : [...sel, x])} className={`rounded-full px-2.5 py-1 text-xs ${on ? 'bg-neon text-white' : 'bg-panel2 text-white/70'}`}>{x}</button>;
      })}
    </div>
  );
}

export default function AdsManager() {
  const { s, set, toast, feature } = useStore();
  const [tab, setTab] = useState<T>('Visão geral');
  const me = s.user.handle;
  const st = s.adsMgr;
  const mine = st.campaigns.filter((c) => c.owner === me);
  const pricing = s.admin.adPricing;

  const totals = useMemo(() => mine.reduce((t, c) => { const x = campaignTotals(st, c.id); return { imp: t.imp + x.imp, clicks: t.clicks + x.clicks, results: t.results + x.results, spend: t.spend + x.spend }; }, { imp: 0, clicks: 0, results: 0, spend: 0 }), [st, mine]);

  const updCampaign = (id: string, patch: Partial<Campaign>) => set((p) => ({ ...p, adsMgr: { ...p.adsMgr, campaigns: p.adsMgr.campaigns.map((c) => (c.id === id ? { ...c, ...patch } : c)) } }));

  if (!feature('anuncios')) return <p className="card text-center text-sm">O Gestor de Anúncios está temporariamente desativado pela administração.</p>;

  return (
    <div>
      <DemoBanner />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'Visão geral' && (
        <Overview st={st} mine={mine} totals={totals} onToggle={(c) => {
          if (c.status === 'ativa') { updCampaign(c.id, { status: 'pausada' }); toast('Campanha pausada'); return; }
          if (st.wallet <= 0) { toast('Saldo insuficiente. Carrega saldo em Faturação.'); setTab('Faturação'); return; }
          if (c.budgetType === 'total' && budgetLeft(st, c) <= 0) { toast('Orçamento total esgotado. Aumenta o orçamento.'); return; }
          updCampaign(c.id, { status: 'ativa' }); toast('Campanha ativada');
        }} onBudget={(c, b) => updCampaign(c.id, { budget: b })} onNew={() => setTab('Criar campanha')} />
      )}
      {tab === 'Criar campanha' && <Wizard onDone={() => setTab('Visão geral')} />}
      {tab === 'Relatórios' && <Reports mine={mine} />}
      {tab === 'Faturação' && <Billing />}
      <p className="mt-6 text-center text-xs text-white/40">Preços mínimos: CPM {mzn(pricing.minCpm)} · CPC {mzn(pricing.minCpc)} · por seguidor {mzn(pricing.minCpf)} · por inscrição {mzn(pricing.minCpa)} · orçamento diário mín. {mzn(pricing.minDaily)}. Leilão de segundo preço: pagas no máximo a tua licitação.</p>
    </div>
  );

  function Overview({ st, mine, totals, onToggle, onBudget, onNew }: { st: typeof s.adsMgr; mine: Campaign[]; totals: { imp: number; clicks: number; results: number; spend: number }; onToggle: (c: Campaign) => void; onBudget: (c: Campaign, b: number) => void; onNew: () => void }) {
    const days = Array.from({ length: 7 }, (_, i) => dayKey(new Date(Date.now() - (6 - i) * 86400000)));
    const series = days.map((d) => ({ label: d.slice(8), value: mine.reduce((t, c) => t + campaignSpend(st, c.id, d), 0) }));
    return (
      <>
        <div className="mb-3 grid grid-cols-3 gap-2">
          <Stat label="Gasto total" value={mzn(Math.round(totals.spend))} />
          <Stat label="Impressões" value={totals.imp.toLocaleString('pt-PT')} />
          <Stat label="CTR" value={`${n2(ctr(totals))}%`} />
          <Stat label="Cliques" value={totals.clicks.toLocaleString('pt-PT')} />
          <Stat label="Resultados" value={totals.results.toLocaleString('pt-PT')} />
          <Stat label="Saldo" value={mzn(Math.round(st.wallet))} />
        </div>
        <div className="card mb-3"><p className="mb-1 text-sm font-semibold">Gasto diário (7 dias, MZN)</p><LineChart data={series} fmt={(v) => n2(v)} /></div>
        <div className="mb-2 flex items-center justify-between"><p className="font-semibold">As minhas campanhas</p><button className="btn !px-3 !py-1 text-xs" onClick={onNew}>+ Nova</button></div>
        {mine.length === 0 && <p className="card text-center text-sm text-white/60">Ainda não tens campanhas.</p>}
        <div className="space-y-2">
          {mine.map((c) => {
            const t = campaignTotals(st, c.id);
            const o = OBJECTIVES.find((x) => x.id === c.objective)!;
            const ads = st.ads.filter((a) => a.campaignId === c.id);
            const pending = ads.filter((a) => a.review === 'pendente').length;
            const rejected = ads.filter((a) => a.review === 'rejeitado');
            const spentPeriod = c.budgetType === 'diario' ? campaignSpend(st, c.id, dayKey()) : t.spend;
            return (
              <div key={c.id} className="card !p-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{o.emoji}</span>
                  <div className="flex-1"><p className="font-semibold">{c.name}</p><p className="text-xs text-white/50">{o.label} · {c.start} → {c.end}</p></div>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_COLOR[c.status]}`}>{c.status}</span>
                  <button role="switch" aria-checked={c.status === 'ativa'} aria-label="Ligar/desligar" onClick={() => onToggle(c)} className={`relative h-6 w-11 rounded-full ${c.status === 'ativa' ? 'bg-neon' : 'bg-white/20'}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${c.status === 'ativa' ? 'left-[22px]' : 'left-0.5'}`} /></button>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-1 text-center text-xs">
                  <div><p className="font-bold">{t.imp.toLocaleString('pt-PT')}</p><p className="text-white/50">impr.</p></div>
                  <div><p className="font-bold">{t.clicks}</p><p className="text-white/50">cliques</p></div>
                  <div><p className="font-bold">{n2(ctr(t))}%</p><p className="text-white/50">CTR</p></div>
                  <div><p className="font-bold">{t.results ? n2(t.spend / t.results) : '—'}</p><p className="text-white/50">MZN/result.</p></div>
                </div>
                <div className="mt-2 h-1.5 rounded bg-panel2"><div className="h-1.5 rounded bg-neon2" style={{ width: `${Math.min(100, (spentPeriod / c.budget) * 100)}%` }} /></div>
                <div className="mt-1 flex items-center justify-between text-xs text-white/60">
                  <span>{c.budgetType === 'diario' ? 'Hoje' : 'Total'}: {n2(spentPeriod)} / {mzn(c.budget)}</span>
                  <label className="flex items-center gap-1">Orçamento <input type="number" className="input w-20 !py-0.5 text-xs" value={c.budget} min={pricing.minDaily} onChange={(e) => onBudget(c, Math.max(0, Number(e.target.value)))} /></label>
                </div>
                {pending > 0 && <p className="mt-1 text-xs text-amber-300">⏳ {pending} anúncio(s) em revisão</p>}
                {rejected.map((a) => <p key={a.id} className="mt-1 text-xs text-pink">✕ “{a.name}” rejeitado: {a.reviewNote || 'viola as políticas de anúncios'}</p>)}
              </div>
            );
          })}
        </div>
        {IS_DEMO && <Simulator />}
      </>
    );
  }

  function Simulator() {
    // Demo: simula tráfego de utilizadores variados para ver o leilão, o pacing e a pausa automática a funcionar.
    const run = (n: number) => {
      set((p) => {
        let ads = p.adsMgr;
        let served = 0, mineServed = 0, clicks = 0;
        const stoppedNames: string[] = [];
        for (let i = 0; i < n; i++) {
          const v: ViewerCtx = { age: 13 + Math.floor(Math.random() * 30), province: PROVINCES[Math.floor(Math.random() * PROVINCES.length)], games: [GAMES[Math.floor(Math.random() * 3)]], interests: [INTERESTS[Math.floor(Math.random() * INTERESTS.length)]], premium: false };
          const pl: Placement = Math.random() < 0.5 ? 'feed' : 'clipes';
          const w = runAuction(ads, pl, v, p.admin.adPricing);
          if (!w) continue;
          served++;
          if (w.campaign.owner === p.user.handle) mineServed++;
          let r = recordEvent(ads, w, 'imp', p.user.handle);
          ads = r.st; stoppedNames.push(...r.stopped.map((c) => c.name));
          if (Math.random() < 0.035) { const cw = { ...w, campaign: ads.campaigns.find((c) => c.id === w.campaign.id)! }; r = recordEvent(ads, cw, 'click', p.user.handle); ads = r.st; clicks++; stoppedNames.push(...r.stopped.map((c) => c.name)); }
        }
        setTimeout(() => toast(`Simulação: ${served} impressões (${mineServed} tuas), ${clicks} cliques${stoppedNames.length ? ` · pausadas: ${Array.from(new Set(stoppedNames)).join(', ')}` : ''}`), 20);
        return { ...p, adsMgr: ads };
      });
    };
    return (
      <div className="card mt-4 space-y-2 text-sm">
        <p className="font-semibold">🧪 Simulador de tráfego (demo)</p>
        <p className="text-xs text-white/60">Corre o motor de leilão com utilizadores fictícios (idades, províncias e jogos aleatórios). Vês gasto, CTR e a pausa automática quando o orçamento/saldo acaba.</p>
        <div className="flex gap-2"><button className="btn-ghost flex-1 !py-1 text-xs" onClick={() => run(200)}>+200 visitas</button><button className="btn-ghost flex-1 !py-1 text-xs" onClick={() => run(2000)}>+2000 visitas</button></div>
      </div>
    );
  }
}

/** Modo real: envia o ficheiro para o Supabase Storage (bucket público `ad-media`, pasta do utilizador). */
async function uploadMedia(f: File): Promise<string | null> {
  const { sb } = await import('@/lib/supabase');
  const c = await sb();
  const { data: u } = await c.auth.getUser();
  if (!u.user) return null;
  const path = `${u.user.id}/${Date.now()}-${f.name.replace(/[^\w.-]/g, '_')}`;
  const { error } = await c.storage.from('ad-media').upload(path, f, { cacheControl: '31536000', upsert: false });
  if (error) return null;
  return c.storage.from('ad-media').getPublicUrl(path).data.publicUrl;
}

function Wizard({ onDone }: { onDone: () => void }) {
  const { s, set, toast, audit } = useStore();
  const pricing = s.admin.adPricing;
  const today = dayKey();
  const [step, setStep] = useState(0);
  const [c, setC] = useState({ name: '', objective: 'cliques' as Objective, budgetType: 'diario' as 'diario' | 'total', budget: 200, start: today, end: dayKey(new Date(Date.now() + 14 * 86400000)) });
  const [as, setAs] = useState({ name: 'Público principal', ageMin: 16, ageMax: 40, provinces: [] as string[], games: [] as string[], interests: [] as string[], placements: ['feed', 'clipes'] as Placement[], bid: 0 });
  const [ad, setAd] = useState({ name: 'Anúncio 1', format: 'imagem' as 'imagem' | 'clipe', media: '' as string, emoji: '🎮', headline: '', text: '', cta: 'Ver mais' as Cta, url: '/' });
  const [err, setErr] = useState('');
  const bid = as.bid || minBid(c.objective, pricing) * 2;
  const reach = Math.round(48210 * (as.provinces.length ? as.provinces.length / 11 : 1) * (as.games.length ? 0.6 : 1) * ((as.ageMax - as.ageMin + 1) / 50));
  const estDaily = c.objective === 'visualizacoes' ? Math.round(((c.budgetType === 'diario' ? c.budget : c.budget / 14) / bid) * 1000) : Math.round((c.budgetType === 'diario' ? c.budget : c.budget / 14) / bid);

  const onFile = (f?: File) => {
    if (!f) return;
    const isVideo = f.type.startsWith('video');
    if (!IS_DEMO) {
      if (f.size > (isVideo ? 15 : 2) * 1024 * 1024) return setErr(isVideo ? 'Clipe até 15 MB.' : 'Imagem até 2 MB.');
      toast('A carregar ficheiro…');
      void uploadMedia(f).then((url) => { if (url) setAd((x) => ({ ...x, format: isVideo ? 'clipe' : 'imagem', media: url })); else setErr('Falha no envio do ficheiro. Entra na conta e tenta de novo.'); });
      return;
    }
    if (isVideo) {
      if (f.size > 15 * 1024 * 1024) return setErr('Clipe até 15 MB.');
      setAd((x) => ({ ...x, format: 'clipe', media: URL.createObjectURL(f) }));
      toast('Demo: o clipe só fica disponível nesta sessão.');
      return;
    }
    if (f.size > 2 * 1024 * 1024) return setErr('Imagem até 2 MB.');
    const img = new Image();
    const r = new FileReader();
    r.onload = () => {
      img.onload = () => {
        // Reduz para 720px e JPEG 0.75 para caber no armazenamento local
        const scale = Math.min(1, 720 / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
        cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
        setAd((x) => ({ ...x, format: 'imagem', media: cv.toDataURL('image/jpeg', 0.75) }));
      };
      img.src = r.result as string;
    };
    r.readAsDataURL(f);
  };

  const validate = (k: number) => {
    setErr('');
    if (k === 0 && !c.name.trim()) return setErr('Dá um nome à campanha.'), false;
    if (k === 1) {
      if (c.budget < pricing.minDaily && c.budgetType === 'diario') return setErr(`Orçamento diário mínimo: ${pricing.minDaily} MZN.`), false;
      if (c.end < c.start) return setErr('A data de fim tem de ser depois do início.'), false;
      if (bid < minBid(c.objective, pricing)) return setErr(`Licitação mínima: ${minBid(c.objective, pricing)} MZN.`), false;
      if (!as.placements.length) return setErr('Escolhe pelo menos um posicionamento.'), false;
    }
    if (k === 2 && (!ad.headline.trim() || !ad.text.trim())) return setErr('Escreve título e texto.'), false;
    return true;
  };

  const publish = () => {
    if (s.adsMgr.wallet < Math.min(c.budget, pricing.minDaily)) { setErr('Saldo insuficiente. Carrega saldo em Faturação antes de publicar.'); return; }
    const id = IS_DEMO ? Date.now().toString(36) : crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const camp: Campaign = { id: 'cp' + id, owner: s.user.handle, name: c.name, objective: c.objective, status: 'ativa', budgetType: c.budgetType, budget: c.budget, start: c.start, end: c.end, createdAt: today };
    const set_: AdSet = { id: 'as' + id, campaignId: camp.id, name: as.name, ageMin: as.ageMin, ageMax: as.ageMax, provinces: as.provinces, games: as.games, interests: as.interests, placements: as.placements, bid, status: 'ativo' };
    const a: Ad = { id: 'ad' + id, adSetId: set_.id, campaignId: camp.id, name: ad.name, format: ad.format, media: ad.media && ad.media.startsWith('data:') ? ad.media : ad.media || undefined, emoji: ad.emoji, gradient: GRADIENTS[Math.floor(Math.random() * GRADIENTS.length)], headline: ad.headline, text: ad.text, cta: ad.cta, url: ad.url, review: pricing.reviewRequired ? 'pendente' : 'aprovado', status: 'ativo' };
    set((p) => ({ ...p, adsMgr: { ...p.adsMgr, campaigns: [camp, ...p.adsMgr.campaigns], adsets: [set_, ...p.adsMgr.adsets], ads: [a, ...p.adsMgr.ads] } }));
    audit('Criou campanha de anúncios', camp.name);
    toast(pricing.reviewRequired ? 'Campanha publicada. Anúncio em revisão (normalmente < 24 h).' : 'Campanha publicada e ativa 🚀');
    onDone();
  };

  const labels = ['Objetivo', 'Público e orçamento', 'Anúncio', 'Rever'];
  return (
    <div>
      <div className="mb-3 flex gap-1">{labels.map((l, i) => <div key={l} className="flex-1"><div className={`h-1 rounded ${i <= step ? 'bg-neon' : 'bg-panel2'}`} /><p className={`mt-1 text-center text-[11px] ${i === step ? 'text-white' : 'text-white/40'}`}>{l}</p></div>)}</div>

      {step === 0 && (
        <div className="card space-y-3">
          <input className="input w-full" placeholder="Nome da campanha" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
          <p className="text-xs text-white/60">Qual é o objetivo?</p>
          <div className="grid grid-cols-2 gap-2">
            {OBJECTIVES.map((o) => (
              <button key={o.id} onClick={() => { setC({ ...c, objective: o.id }); setAs({ ...as, bid: 0 }); setAd({ ...ad, cta: o.id === 'seguidores' ? 'Seguir' : o.id === 'inscricoes' ? 'Inscrever' : o.id === 'visualizacoes' ? 'Assistir' : 'Ver mais' }); }} className={`rounded-xl border p-3 text-left ${c.objective === o.id ? 'border-neon bg-neon/20' : 'border-line bg-panel2'}`}>
                <p className="text-xl">{o.emoji}</p><p className="text-sm font-semibold">{o.label}</p><p className="text-[11px] text-white/60">{o.desc}</p><p className="mt-1 text-[11px] text-neon2">Pagas {o.unit}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="card space-y-3 text-sm">
          <p className="font-semibold">Público</p>
          <div className="flex items-center gap-2 text-xs">Idade <input type="number" min={13} max={65} className="input w-16" value={as.ageMin} onChange={(e) => setAs({ ...as, ageMin: Math.max(13, Number(e.target.value)) })} /> a <input type="number" min={13} max={65} className="input w-16" value={as.ageMax} onChange={(e) => setAs({ ...as, ageMax: Math.min(65, Number(e.target.value)) })} /></div>
          <p className="text-xs text-white/50">Mínimo 13. Menores de 18 só recebem anúncios não personalizados e nunca de categorias restritas.</p>
          <p className="text-xs text-white/60">Províncias (vazio = todo o país)</p>{chips(PROVINCES, as.provinces, (v) => setAs({ ...as, provinces: v }))}
          <p className="text-xs text-white/60">Jogos</p>{chips(GAMES, as.games, (v) => setAs({ ...as, games: v }))}
          <p className="text-xs text-white/60">Interesses</p>{chips(INTERESTS, as.interests, (v) => setAs({ ...as, interests: v }))}
          <p className="text-xs text-white/60">Posicionamentos</p>{chips(['feed', 'clipes'] as const, as.placements, (v) => setAs({ ...as, placements: v as Placement[] }))}
          <p className="rounded-lg bg-panel2 p-2 text-xs">Alcance potencial estimado: <b>{reach.toLocaleString('pt-PT')}</b> pessoas</p>
          <p className="pt-2 font-semibold">Orçamento e calendário</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <button onClick={() => setC({ ...c, budgetType: 'diario' })} className={`rounded-xl border p-2 ${c.budgetType === 'diario' ? 'border-neon bg-neon/20' : 'border-line'}`}>Diário</button>
            <button onClick={() => setC({ ...c, budgetType: 'total' })} className={`rounded-xl border p-2 ${c.budgetType === 'total' ? 'border-neon bg-neon/20' : 'border-line'}`}>Total da campanha</button>
          </div>
          <label className="block text-xs">Orçamento (MZN)<input type="number" className="input w-full" value={c.budget} onChange={(e) => setC({ ...c, budget: Number(e.target.value) })} /></label>
          <div className="flex gap-2 text-xs"><label className="flex-1">Início<input type="date" className="input w-full" value={c.start} min={today} onChange={(e) => setC({ ...c, start: e.target.value })} /></label><label className="flex-1">Fim<input type="date" className="input w-full" value={c.end} min={c.start} onChange={(e) => setC({ ...c, end: e.target.value })} /></label></div>
          <label className="block text-xs">Licitação máxima (MZN {OBJECTIVES.find((o) => o.id === c.objective)!.unit}) · mín. {minBid(c.objective, pricing)}<input type="number" className="input w-full" value={bid} onChange={(e) => setAs({ ...as, bid: Number(e.target.value) })} /></label>
          <p className="rounded-lg bg-panel2 p-2 text-xs">Estimativa: ~<b>{estDaily.toLocaleString('pt-PT')}</b> {c.objective === 'visualizacoes' ? 'impressões' : 'resultados'} por dia. Pausa automática quando o orçamento acaba.</p>
        </div>
      )}

      {step === 2 && (
        <div className="card space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2 text-xs">
            {(['imagem', 'clipe'] as const).map((f) => <button key={f} onClick={() => setAd({ ...ad, format: f, media: '' })} className={`rounded-xl border p-2 ${ad.format === f ? 'border-neon bg-neon/20' : 'border-line'}`}>{f === 'imagem' ? '🖼️ Imagem' : '🎬 Clipe (vídeo)'}</button>)}
          </div>
          <label className="block rounded-xl border border-dashed border-white/30 p-4 text-center text-xs">
            {ad.media ? '✓ Ficheiro carregado · tocar para trocar' : `Carregar ${ad.format === 'imagem' ? 'imagem (JPG/PNG até 2 MB)' : 'clipe (MP4 até 15 MB, 9:16)'}`}
            <input type="file" className="hidden" accept={ad.format === 'imagem' ? 'image/*' : 'video/*'} onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          {!ad.media && <div className="flex flex-wrap gap-1">{['🎮', '🏆', '🔥', '💎', '🎧', '📶', '👕', '🎟️'].map((e) => <button key={e} onClick={() => setAd({ ...ad, emoji: e })} className={`rounded-lg p-1.5 text-xl ${ad.emoji === e ? 'bg-neon' : 'bg-panel2'}`}>{e}</button>)}<span className="self-center text-[11px] text-white/40">(ícone se não houver ficheiro)</span></div>}
          <input className="input w-full" maxLength={40} placeholder="Título (até 40)" value={ad.headline} onChange={(e) => setAd({ ...ad, headline: e.target.value })} />
          <textarea className="input min-h-16 w-full" maxLength={125} placeholder="Texto (até 125)" value={ad.text} onChange={(e) => setAd({ ...ad, text: e.target.value })} />
          <div className="flex gap-2">
            <select className="input flex-1" value={ad.cta} onChange={(e) => setAd({ ...ad, cta: e.target.value as Cta })}>{CTAS.map((x) => <option key={x}>{x}</option>)}</select>
            <input className="input flex-1" placeholder="Destino (ex.: /torneios/t2 ou https://wa.me/…)" value={ad.url} onChange={(e) => setAd({ ...ad, url: e.target.value })} />
          </div>
          <p className="text-xs text-white/60">Pré-visualização</p>
          <div className="overflow-hidden rounded-2xl border border-line">
            <p className="px-3 py-1.5 text-[11px] text-white/50">Patrocinado · {s.user.handle}</p>
            <div className={`relative h-36 bg-gradient-to-br ${GRADIENTS[1]}`}>
              {ad.media ? (ad.format === 'imagem' ? <img src={ad.media} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <video src={ad.media} className="absolute inset-0 h-full w-full object-cover" muted autoPlay loop playsInline />) : <span className="absolute inset-0 flex items-center justify-center text-6xl">{ad.emoji}</span>}
            </div>
            <div className="flex items-center gap-2 p-3"><div className="flex-1"><p className="text-sm font-semibold">{ad.headline || 'Título'}</p><p className="text-xs text-white/60">{ad.text || 'Texto do anúncio'}</p></div><span className="btn !px-3 !py-1 text-xs">{ad.cta}</span></div>
          </div>
          <p className="text-[11px] text-white/40">Proibido: promessas de diamantes grátis, apostas, álcool/tabaco, conteúdo adulto, alegações enganosas. Ver Termos § Anúncios.</p>
        </div>
      )}

      {step === 3 && (
        <div className="card space-y-2 text-sm">
          <p className="font-semibold">Rever e publicar</p>
          {[
            ['Campanha', c.name], ['Objetivo', OBJECTIVES.find((o) => o.id === c.objective)!.label],
            ['Orçamento', `${mzn(c.budget)} ${c.budgetType === 'diario' ? 'por dia' : 'no total'}`], ['Datas', `${c.start} → ${c.end}`],
            ['Público', `${as.ageMin}–${as.ageMax} anos · ${as.provinces.length ? as.provinces.join(', ') : 'todo o país'}${as.games.length ? ' · ' + as.games.join(', ') : ''}`],
            ['Licitação máx.', `${mzn(bid)} ${OBJECTIVES.find((o) => o.id === c.objective)!.unit}`], ['Anúncio', `${ad.headline} · ${ad.cta}`],
            ['Gasto máximo', c.budgetType === 'diario' ? `${mzn(c.budget)} × dias ativos` : mzn(c.budget)], ['Saldo disponível', mzn(Math.round(s.adsMgr.wallet))],
          ].map(([k, v]) => <div key={k} className="flex justify-between gap-3 border-b border-line pb-1 last:border-0"><span className="text-white/60">{k}</span><span className="text-right">{v}</span></div>)}
          <p className="text-xs text-white/50">O gasto é descontado do saldo pré-pago. Nunca pagas mais do que o orçamento. {s.admin.adPricing.reviewRequired ? 'O anúncio passa por revisão antes de ser exibido.' : ''}</p>
        </div>
      )}

      {err && <p className="mt-2 text-xs text-pink">{err}</p>}
      <div className="mt-3 flex gap-2">
        {step > 0 && <button className="btn-ghost flex-1" onClick={() => setStep(step - 1)}>‹ Voltar</button>}
        {step < 3 ? <button className="btn flex-1" onClick={() => validate(step) && setStep(step + 1)}>Continuar ›</button> : <button className="btn flex-1" onClick={publish}>🚀 Publicar campanha</button>}
      </div>
    </div>
  );
}

function Reports({ mine }: { mine: Campaign[] }) {
  const { s } = useStore();
  const st = s.adsMgr;
  const [cid, setCid] = useState(mine[0]?.id ?? '');
  const [metric, setMetric] = useState<'imp' | 'clicks' | 'spend' | 'ctr'>('imp');
  const c = mine.find((x) => x.id === cid);
  if (!c) return <p className="card text-center text-sm text-white/60">Sem campanhas para mostrar.</p>;
  const ads = st.ads.filter((a) => a.campaignId === c.id);
  const days = Array.from({ length: 14 }, (_, i) => dayKey(new Date(Date.now() - (13 - i) * 86400000)));
  const day = (d: string) => ads.reduce((t, a) => { const x = st.stats[a.id]?.byDay[d]; return x ? { imp: t.imp + x.imp, clicks: t.clicks + x.clicks, results: t.results + x.results, spend: t.spend + x.spend } : t; }, { imp: 0, clicks: 0, results: 0, spend: 0 });
  const series = days.map((d) => { const x = day(d); return { label: d.slice(8), value: metric === 'ctr' ? ctr(x) : x[metric] }; });
  const t = campaignTotals(st, c.id);
  const csv = () => {
    const rows = [['data', 'impressoes', 'cliques', 'resultados', 'gasto_mzn', 'ctr_%'], ...days.map((d) => { const x = day(d); return [d, x.imp, x.clicks, x.results, x.spend.toFixed(2), ctr(x).toFixed(2)]; })];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' }));
    a.download = `relatorio-${c.name}.csv`; a.click();
  };
  return (
    <div className="space-y-3">
      <select className="input w-full" value={cid} onChange={(e) => setCid(e.target.value)}>{mine.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <div className="grid grid-cols-4 gap-2 text-center"><Stat label="Impr." value={t.imp} /><Stat label="Cliques" value={t.clicks} /><Stat label="CTR" value={`${n2(ctr(t))}%`} /><Stat label="Gasto" value={n2(t.spend)} /></div>
      <div className="card">
        <div className="mb-2 flex gap-1 text-xs">{([['imp', 'Impressões'], ['clicks', 'Cliques'], ['spend', 'Gasto'], ['ctr', 'CTR %']] as const).map(([k, l]) => <button key={k} onClick={() => setMetric(k)} className={`rounded-full px-2 py-1 ${metric === k ? 'bg-neon' : 'bg-panel2'}`}>{l}</button>)}</div>
        <LineChart data={series} color={metric === 'spend' ? '#d98a8a' : '#4fb3a9'} fmt={(v) => n2(v)} />
      </div>
      <div className="card"><p className="mb-2 text-sm font-semibold">Por anúncio (cliques)</p><Bars data={ads.map((a) => ({ label: `${a.name} (${a.review})`, value: st.stats[a.id]?.clicks ?? 0 }))} /></div>
      <button className="btn-ghost w-full text-xs" onClick={csv}>⬇️ Exportar CSV</button>
    </div>
  );
}

function Billing() {
  const { s, set } = useStore();
  const [amount, setAmount] = useState(1000);
  const [open, setOpen] = useState(false);
  const st = s.adsMgr;
  return (
    <div className="space-y-3">
      <div className="card text-center"><p className="text-xs text-white/60">Saldo de anúncios (pré-pago)</p><p className="text-3xl font-black text-neon2">{mzn(Math.round(st.wallet))}</p></div>
      <div className="card space-y-2">
        <p className="font-semibold">Carregar saldo</p>
        <div className="grid grid-cols-4 gap-2">{[500, 1000, 2500, 5000].map((v) => <button key={v} onClick={() => setAmount(v)} className={`rounded-xl border p-2 text-xs ${amount === v ? 'border-neon bg-neon/20' : 'border-line'}`}>{v}</button>)}</div>
        <input type="number" className="input w-full" value={amount} min={100} onChange={(e) => setAmount(Number(e.target.value))} />
        <button className="btn w-full" disabled={amount < 100} onClick={() => setOpen(true)}>Pagar {mzn(amount)} (M-Pesa / e-Mola / cartão)</button>
        <p className="text-xs text-white/50">Saldo não usado é reembolsável a pedido (ver Política de Reembolsos). Fatura emitida por cada carregamento.</p>
      </div>
      <div className="card space-y-1 text-sm">
        <p className="mb-1 font-semibold">Faturas</p>
        {st.invoices.map((i) => <div key={i.id} className="flex justify-between text-xs"><span>{i.date} · {i.method}</span><span>{mzn(i.amount)} · {i.status}</span></div>)}
      </div>
      {open && (
        <CheckoutSheet open={open} onClose={() => setOpen(false)} title="Saldo de anúncios Social POIPAK" lines={[{ label: 'Carregamento de saldo', amount }]} onPaid={(method, total) => {
          set((p) => ({ ...p, adsMgr: { ...p.adsMgr, wallet: p.adsMgr.wallet + total, invoices: [{ id: 'inv' + Date.now(), amount: total, date: dayKey(), method, status: 'demo-pago' }, ...p.adsMgr.invoices], campaigns: p.adsMgr.campaigns.map((c) => (c.owner === p.user.handle && c.status === 'sem saldo' ? { ...c, status: 'ativa' } : c)) } }));
        }} />
      )}
    </div>
  );
}
