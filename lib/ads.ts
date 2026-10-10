// Sistema de anúncios self-serve do TXAPILOG (estilo Meta Ads): campanhas → conjuntos → anúncios.
// Motor simples de leilão (segundo preço sobre eCPM) + pacing de orçamento + pausa automática.
// Na demo tudo corre no navegador; em produção o mesmo cálculo corre numa Edge Function (ver supabase/schema.sql: ad_*).

import { GRADIENTS } from './data';

export type Objective = 'visualizacoes' | 'seguidores' | 'cliques' | 'inscricoes';
export type Placement = 'feed' | 'clipes';
export type CampaignStatus = 'ativa' | 'pausada' | 'sem orçamento' | 'sem saldo' | 'terminada';
export type Review = 'pendente' | 'aprovado' | 'rejeitado';
export type Cta = 'Ver mais' | 'Seguir' | 'Inscrever' | 'Comprar' | 'Assistir';

export const OBJECTIVES: { id: Objective; label: string; emoji: string; unit: string; desc: string }[] = [
  { id: 'visualizacoes', label: 'Visualizações', emoji: '👁', unit: 'CPM (por 1000 impressões)', desc: 'Mostrar o teu anúncio ao maior número de pessoas.' },
  { id: 'seguidores', label: 'Seguidores', emoji: '➕', unit: 'por seguidor', desc: 'Ganhar seguidores para o teu perfil ou equipa.' },
  { id: 'cliques', label: 'Cliques', emoji: '👆', unit: 'CPC (por clique)', desc: 'Levar pessoas a um link: loja, WhatsApp, site.' },
  { id: 'inscricoes', label: 'Inscrições em torneios', emoji: '🏆', unit: 'por inscrição', desc: 'Encher as vagas do teu torneio.' },
];
export const CTAS: Cta[] = ['Ver mais', 'Seguir', 'Inscrever', 'Comprar', 'Assistir'];

export interface Campaign {
  id: string; owner: string; name: string; objective: Objective; status: CampaignStatus;
  budgetType: 'diario' | 'total'; budget: number; start: string; end: string; createdAt: string;
}
export interface AdSet {
  id: string; campaignId: string; name: string; ageMin: number; ageMax: number;
  provinces: string[]; games: string[]; interests: string[]; placements: Placement[]; bid: number; status: 'ativo' | 'pausado';
}
export interface Ad {
  id: string; adSetId: string; campaignId: string; name: string; format: 'imagem' | 'clipe';
  media?: string; emoji: string; gradient: string; headline: string; text: string; cta: Cta; url: string;
  review: Review; reviewNote?: string; status: 'ativo' | 'pausado';
}
export interface DayStat { imp: number; clicks: number; results: number; spend: number }
export interface AdStat extends DayStat { byDay: Record<string, DayStat> }
export interface Invoice { id: string; amount: number; date: string; method: string; status: 'demo-pago' }
export interface AdPricing { minCpm: number; minCpc: number; minCpf: number; minCpa: number; minDaily: number; platformFee: number; reviewRequired: boolean; frequencyCap: number }
export interface AdsState { campaigns: Campaign[]; adsets: AdSet[]; ads: Ad[]; stats: Record<string, AdStat>; wallet: number; invoices: Invoice[] }
export interface ViewerCtx { age: number; province: string; games: string[]; interests: string[]; premium: boolean }

export const DEFAULT_PRICING: AdPricing = { minCpm: 60, minCpc: 3, minCpf: 5, minCpa: 25, minDaily: 100, platformFee: 0, reviewRequired: true, frequencyCap: 3 };

export function minBid(o: Objective, p: AdPricing) {
  return o === 'visualizacoes' ? p.minCpm : o === 'cliques' ? p.minCpc : o === 'seguidores' ? p.minCpf : p.minCpa;
}

export function dayKey(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const empty = (): DayStat => ({ imp: 0, clicks: 0, results: 0, spend: 0 });

export function campaignSpend(st: AdsState, campaignId: string, day?: string) {
  let s = 0;
  for (const ad of st.ads) {
    if (ad.campaignId !== campaignId) continue;
    const x = st.stats[ad.id];
    if (!x) continue;
    s += day ? x.byDay[day]?.spend ?? 0 : x.spend;
  }
  return s;
}

export function campaignTotals(st: AdsState, campaignId: string) {
  const t = empty();
  for (const ad of st.ads) {
    if (ad.campaignId !== campaignId) continue;
    const x = st.stats[ad.id];
    if (!x) continue;
    t.imp += x.imp; t.clicks += x.clicks; t.results += x.results; t.spend += x.spend;
  }
  return t;
}

export function budgetLeft(st: AdsState, c: Campaign, day = dayKey()) {
  return c.budgetType === 'diario' ? c.budget - campaignSpend(st, c.id, day) : c.budget - campaignSpend(st, c.id);
}

function overlaps(a: string[], b: string[]) {
  return a.length === 0 || a.some((x) => b.includes(x));
}

export function matches(set: AdSet, v: ViewerCtx) {
  return v.age >= set.ageMin && v.age <= set.ageMax
    && (set.provinces.length === 0 || set.provinces.includes(v.province))
    && overlaps(set.games, v.games)
    && overlaps(set.interests, v.interests.concat(v.games));
}

/** Probabilidade de clique estimada (média suavizada com prior de 2%). */
export function pctr(st: AdsState, adId: string) {
  const x = st.stats[adId];
  return ((x?.clicks ?? 0) + 1) / ((x?.imp ?? 0) + 50);
}

/** eCPM = quanto vale mostrar este anúncio 1000 vezes. */
export function ecpm(st: AdsState, ad: Ad, set: AdSet, c: Campaign) {
  const base = c.objective === 'visualizacoes' ? set.bid : set.bid * pctr(st, ad.id) * 1000;
  // Pacing: se a campanha diária já gastou mais do que a fração do dia que passou, abranda.
  if (c.budgetType === 'diario') {
    const now = new Date();
    const dayFrac = Math.max(0.05, (now.getHours() * 60 + now.getMinutes()) / 1440);
    const spentFrac = campaignSpend(st, c.id, dayKey()) / c.budget;
    if (spentFrac > dayFrac) return base * 0.35;
  }
  return base;
}

export interface Win { ad: Ad; set: AdSet; campaign: Campaign; price: number; ecpm: number }

/** Leilão: escolhe o anúncio elegível com maior eCPM; o vencedor paga o segundo preço (mínimo da tabela). */
export function runAuction(st: AdsState, placement: Placement, v: ViewerCtx, pricing: AdPricing, seen: Record<string, number> = {}, today = dayKey()): Win | null {
  if (v.premium) return null; // Premium = sem anúncios
  const cands: Win[] = [];
  for (const ad of st.ads) {
    if (ad.review !== 'aprovado' || ad.status !== 'ativo') continue;
    if ((seen[ad.id] ?? 0) >= pricing.frequencyCap) continue;
    const set = st.adsets.find((s) => s.id === ad.adSetId);
    const c = st.campaigns.find((x) => x.id === ad.campaignId);
    if (!set || !c || set.status !== 'ativo' || c.status !== 'ativa') continue;
    if (today < c.start || today > c.end) continue;
    if (!set.placements.includes(placement)) continue;
    if (budgetLeft(st, c, today) <= 0) continue;
    if (!matches(set, v)) continue;
    cands.push({ ad, set, campaign: c, price: 0, ecpm: ecpm(st, ad, set, c) });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.ecpm - a.ecpm);
  // Pequena aleatoriedade entre empates próximos para rodar criativos
  const top = cands.filter((x) => x.ecpm >= cands[0].ecpm * 0.9);
  const w = top[Math.floor(Math.random() * top.length)];
  const second = cands.find((x) => x !== w)?.ecpm ?? 0;
  const floor = minBid(w.campaign.objective, pricing);
  // Converter o segundo eCPM de volta à unidade do objetivo do vencedor
  const unitSecond = w.campaign.objective === 'visualizacoes' ? second : second / (pctr(st, w.ad.id) * 1000);
  w.price = Math.min(w.set.bid, Math.max(floor, unitSecond + 0.01));
  return w;
}

function bump(st: AdsState, adId: string, d: Partial<DayStat>, day: string): AdsState {
  const cur: AdStat = st.stats[adId] ?? { ...empty(), byDay: {} };
  const dd = cur.byDay[day] ?? empty();
  const add = (a: DayStat): DayStat => ({ imp: a.imp + (d.imp ?? 0), clicks: a.clicks + (d.clicks ?? 0), results: a.results + (d.results ?? 0), spend: +(a.spend + (d.spend ?? 0)).toFixed(2) });
  return { ...st, stats: { ...st.stats, [adId]: { ...add(cur), byDay: { ...cur.byDay, [day]: add(dd) } } } };
}

/** Verifica orçamentos/saldo e pausa automaticamente. Devolve campanhas que acabaram de parar. */
export function enforceBudgets(st: AdsState, owner: string, day = dayKey()): { st: AdsState; stopped: Campaign[] } {
  const stopped: Campaign[] = [];
  const campaigns = st.campaigns.map((c) => {
    if (c.status !== 'ativa') return c;
    if (day > c.end) { stopped.push(c); return { ...c, status: 'terminada' as CampaignStatus }; }
    if (c.budgetType === 'total' && budgetLeft(st, c, day) <= 0) { stopped.push(c); return { ...c, status: 'sem orçamento' as CampaignStatus }; }
    if (c.owner === owner && st.wallet <= 0) { stopped.push(c); return { ...c, status: 'sem saldo' as CampaignStatus }; }
    return c;
  });
  return { st: { ...st, campaigns }, stopped };
}

/** Regista impressão/clique e cobra conforme o objetivo (CPM na impressão; restantes no resultado). */
export function recordEvent(st: AdsState, win: Pick<Win, 'ad' | 'campaign' | 'price'>, kind: 'imp' | 'click', owner: string, day = dayKey()) {
  const o = win.campaign.objective;
  let spend = 0;
  if (kind === 'imp' && o === 'visualizacoes') spend = win.price / 1000;
  if (kind === 'click' && o !== 'visualizacoes') spend = win.price;
  const d: Partial<DayStat> = kind === 'imp' ? { imp: 1, spend, results: o === 'visualizacoes' ? 1 : 0 } : { clicks: 1, spend, results: o === 'visualizacoes' ? 0 : 1 };
  let next = bump(st, win.ad.id, d, day);
  if (win.campaign.owner === owner) next = { ...next, wallet: +(next.wallet - spend).toFixed(2) };
  return enforceBudgets(next, owner, day);
}

export function ctr(t: DayStat) { return t.imp ? (t.clicks / t.imp) * 100 : 0; }

function seedDays(base: number, n = 7) {
  const byDay: Record<string, DayStat> = {};
  const tot = empty();
  for (let i = n; i >= 1; i--) {
    const k = dayKey(new Date(Date.now() - i * 86400000));
    const imp = Math.round(base * (0.7 + ((i * 37) % 10) / 15));
    const clicks = Math.round(imp * 0.031);
    const spend = +(imp * 0.08).toFixed(2);
    byDay[k] = { imp, clicks, results: clicks, spend };
    tot.imp += imp; tot.clicks += clicks; tot.results += clicks; tot.spend += spend;
  }
  return { ...tot, spend: +tot.spend.toFixed(2), byDay };
}

export function seedAds(owner: string): AdsState {
  const start = dayKey(new Date(Date.now() - 10 * 86400000));
  const end = dayKey(new Date(Date.now() + 30 * 86400000));
  const all = { ageMin: 13, ageMax: 65, provinces: [] as string[], games: [] as string[], interests: [] as string[] };
  return {
    wallet: 1500,
    invoices: [{ id: 'inv-seed', amount: 2000, date: start, method: 'M-Pesa', status: 'demo-pago' }],
    campaigns: [
      { id: 'cp-ana', owner, name: 'Lançamento Liga Pro', objective: 'inscricoes', status: 'ativa', budgetType: 'diario', budget: 300, start, end, createdAt: start },
      { id: 'cp-tech', owner: '@techmaputo', name: 'Gatilhos em promoção', objective: 'cliques', status: 'ativa', budgetType: 'total', budget: 5000, start, end, createdAt: start },
      { id: 'cp-movitel', owner: '@movitel', name: 'Pacote Gamer 4G', objective: 'visualizacoes', status: 'ativa', budgetType: 'diario', budget: 800, start, end, createdAt: start },
      { id: 'cp-nyx', owner: '@nyxff', name: 'Segue a Nyx', objective: 'seguidores', status: 'ativa', budgetType: 'diario', budget: 150, start, end, createdAt: start },
    ],
    adsets: [
      { id: 'as-ana', campaignId: 'cp-ana', name: 'Free Fire · Sul', ...all, ageMin: 16, ageMax: 35, provinces: ['Maputo Cidade', 'Maputo Província', 'Gaza'], games: ['Free Fire'], placements: ['feed', 'clipes'], bid: 40, status: 'ativo' },
      { id: 'as-tech', campaignId: 'cp-tech', name: 'Todo o país', ...all, placements: ['feed', 'clipes'], bid: 6, status: 'ativo' },
      { id: 'as-movitel', campaignId: 'cp-movitel', name: 'Jovens 18+', ...all, ageMin: 18, placements: ['feed', 'clipes'], bid: 90, status: 'ativo' },
      { id: 'as-nyx', campaignId: 'cp-nyx', name: 'Fãs de Free Fire', ...all, games: ['Free Fire'], placements: ['clipes', 'feed'], bid: 8, status: 'ativo' },
    ],
    ads: [
      { id: 'ad-ana', adSetId: 'as-ana', campaignId: 'cp-ana', name: 'Liga Pro v1', format: 'imagem', emoji: '🏆', gradient: GRADIENTS[1], headline: 'Liga Pro Moçambique', text: 'Inscreve a tua squad. Prémio de 60 000 MZN!', cta: 'Inscrever', url: '/torneios/t2', review: 'aprovado', status: 'ativo' },
      { id: 'ad-tech', adSetId: 'as-tech', campaignId: 'cp-tech', name: 'Gatilhos', format: 'imagem', emoji: '🎮', gradient: GRADIENTS[4], headline: 'Gatilhos -20% · TechMaputo', text: 'Mira mais rápida no Free Fire e PUBG. Entrega em Maputo.', cta: 'Comprar', url: '/loja', review: 'aprovado', status: 'ativo' },
      { id: 'ad-movitel', adSetId: 'as-movitel', campaignId: 'cp-movitel', name: 'Pacote Gamer', format: 'clipe', emoji: '📶', gradient: GRADIENTS[3], headline: 'Pacote Gamer 4G', text: 'Joga sem lag. Dados para jogos com desconto.', cta: 'Ver mais', url: '/planos', review: 'aprovado', status: 'ativo' },
      { id: 'ad-nyx', adSetId: 'as-nyx', campaignId: 'cp-nyx', name: 'Nyx', format: 'clipe', emoji: '🦊', gradient: GRADIENTS[0], headline: 'Nyx Matola · Lenda', text: 'Lives todas as noites às 20h. Segue para não perder!', cta: 'Seguir', url: '/idolo/nyx', review: 'aprovado', status: 'ativo' },
      { id: 'ad-pend', adSetId: 'as-tech', campaignId: 'cp-tech', name: 'Auscultadores', format: 'imagem', emoji: '🎧', gradient: GRADIENTS[2], headline: 'Auscultadores RGB', text: 'Ouve os passos do inimigo. Diamantes grátis!!!', cta: 'Comprar', url: '/loja', review: 'pendente', status: 'ativo' },
    ],
    stats: { 'ad-ana': seedDays(420), 'ad-tech': seedDays(900), 'ad-movitel': seedDays(1600), 'ad-nyx': seedDays(380) },
  };
}
