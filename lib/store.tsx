'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  ACHIEVEMENTS, ADMIN_USERS, ADS, MISSIONS, MissionAction, Notif, PAYMENTS, PRODUCTS, Product,
  Reaction, SEED_COMMENTS, SEED_NOTIFS, TOURNAMENTS, Tournament, CLIPS, EVENTS, GIFTS, COIN_PACKS, COMMISSIONS, LIVES,
} from './data';
import { AdPricing, AdsState, DEFAULT_PRICING, Placement, ViewerCtx, Win, dayKey, recordEvent, runAuction, seedAds } from './ads';
import { PushCategory, localPush } from './push';
import { ageFrom } from './age';
import { ADMIN_SEED } from './adminSeed';
import { sb } from './supabase';
import type { Ctx as SyncCtx } from './sync';
// O motor de sincronização só é descarregado em modo real.
const syncMod = () => import('./sync');
import { IS_DEMO } from './config';

const KEY = 'gamehub-demo-v1';
const GUEST_KEY = 'gamehub-real-guest';

export interface Reply { id: string; author: string; avatar: string; text: string }
export interface Comment { id: string; author: string; avatar: string; text: string; likes: number; replies: Reply[] }
export interface Purchase { id: string; item: string; total: number; method: string; date: string; status: 'demo-pago' | 'cancelado' }
export interface Challenge { id: string; to: string; game: string; stake: string; status: 'enviado' | 'aceite' | 'recebido' | 'recusado' }
export interface Saved { kind: 'clipe' | 'post' | 'torneio' | 'aula' | 'produto' | 'evento'; id: string }

export type ReportKind = 'clipe' | 'comentário' | 'post' | 'live' | 'utilizador' | 'anúncio' | 'mensagem';
export interface Report { id: string; kind: ReportKind; target: string; label: string; reason: string; by: string; date: string; status: 'aberta' | 'removido' | 'rejeitada' }
export interface AuditEntry { id: string; at: string; actor: string; action: string; target: string }
export interface Broadcast { id: string; title: string; body: string; segment: string; url: string; category: PushCategory; schedule: string; status: 'agendada' | 'enviada'; reach: number }
export interface Order { id: string; user: string; items: string; total: number; status: 'pendente' | 'enviado' | 'entregue' | 'cancelado' | 'reembolsado'; date: string }
export interface Payout { id: string; creator: string; amount: number; method: string; status: 'pendente' | 'aprovado' | 'pago' | 'rejeitado'; date: string }
export interface PlatformSettings {
  maintenance: boolean; maintenanceMsg: string;
  banner: { on: boolean; text: string; tone: 'info' | 'aviso' | 'promo' };
  features: Record<string, boolean>;
  signupsOpen: boolean;
  /** Coach IA (Edge Function coach-ai). Omissão: ligado, 5 mensagens/dia grátis, 20/h e 100/dia no plano Coach IA. */
  ai?: { enabled: boolean; freeDaily: number; paidHourly: number; paidDaily: number };
}
export const AI_DEFAULTS = { enabled: true, freeDaily: 5, paidHourly: 20, paidDaily: 100 };
export const FEATURES: [string, string][] = [
  ['lives', 'Lives'], ['torneios', 'Torneios'], ['loja', 'Loja / marketplace'], ['eventos', 'Eventos'], ['canais', 'Canais'],
  ['desafios', 'Desafios'], ['coach', 'Coach IA'], ['anuncios', 'Anúncios (self-serve)'], ['presentes', 'Presentes nas lives'], ['comentarios', 'Comentários'],
];
export interface NotifPref { inApp: boolean; push: boolean }

export interface State {
  user: { name: string; handle: string; avatar: string; role: 'admin' | 'user'; bio: string };
  xp: number;
  coins: number;
  streak: number;
  lastDay: string;
  following: string[];
  liked: string[];
  saved: Saved[];
  reactions: Record<string, Reaction>;
  comments: Record<string, Comment[]>;
  stats: { likes: number; comments: number; shares: number; watched: number };
  missions: { date: string; progress: Partial<Record<MissionAction, number>>; claimed: string[] };
  achievements: string[];
  screen: Record<string, number>; // data -> segundos
  wellbeing: { limitOn: boolean; limitMin: number; breakOn: boolean; breakEvery: number; nightOn: boolean; nightStart: string; nightEnd: string };
  notifs: Notif[];
  purchases: Purchase[];
  tickets: { id: string; eventId: string; tier: 'Normal' | 'VIP'; qty: number }[];
  entries: string[];
  plans: string[];
  challenges: Challenge[];
  lessonsDone: string[];
  cart: string[];
  account: { loggedIn: boolean; method: 'demo' | 'email' | 'phone'; email: string; phone: string; birth: string; province: string; interests: string[] };
  consent: { done: boolean; date: string; terms: boolean; privacy: boolean; personalizedAds: boolean; analytics: boolean };
  blocked: string[];
  myReports: Report[];
  notifPrefs: Record<PushCategory, NotifPref>;
  pushEnabled: boolean;
  installDismissed: boolean;
  adsMgr: AdsState;
  adSeen: { day: string; counts: Record<string, number> };
  admin: {
    users: typeof ADMIN_USERS;
    tournaments: Tournament[];
    products: Product[];
    ads: typeof ADS;
    payments: typeof PAYMENTS;
    hiddenClips: string[];
    planPrices: Record<string, number>;
    reports: Report[];
    removed: string[];
    audit: AuditEntry[];
    settings: PlatformSettings;
    policies: Record<string, string>;
    broadcasts: Broadcast[];
    orders: Order[];
    events: typeof EVENTS;
    liveStatus: Record<string, 'ao vivo' | 'terminada' | 'suspensa'>;
    gifts: typeof GIFTS;
    coinPacks: typeof COIN_PACKS;
    commissions: typeof COMMISSIONS;
    payouts: Payout[];
    adPricing: AdPricing;
  };
}

function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function dayDiff(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

function seedScreen(): Record<string, number> {
  const out: Record<string, number> = {};
  const mins = [52, 75, 38, 96, 61, 44];
  for (let i = 6; i >= 1; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    out[k] = mins[6 - i] * 60;
  }
  return out;
}

function demoState(): State {
  return {
    user: { name: 'Ana Maulele', handle: '@ana', avatar: '🦄', role: 'admin', bio: 'Fundadora do Social POIPAK 💜 Free Fire & eFootball' },
    xp: 2380,
    coins: 250,
    streak: 2,
    lastDay: '',
    following: ['nyx', 'lua'],
    liked: [],
    saved: [{ kind: 'clipe', id: 'c4' }, { kind: 'aula', id: 's3' }],
    reactions: {},
    comments: JSON.parse(JSON.stringify(SEED_COMMENTS)),
    stats: { likes: 4, comments: 1, shares: 0, watched: 0 },
    missions: { date: today(), progress: {}, claimed: [] },
    achievements: ['a1', 'a2'],
    screen: seedScreen(),
    wellbeing: { limitOn: false, limitMin: 90, breakOn: true, breakEvery: 45, nightOn: true, nightStart: '23:00', nightEnd: '07:00' },
    notifs: SEED_NOTIFS,
    purchases: [],
    tickets: [],
    entries: [],
    plans: [],
    challenges: [{ id: 'ch-seed', to: 'Mário_FF', game: 'Free Fire 1v1', stake: 'Por diversão', status: 'recebido' }],
    lessonsDone: [],
    cart: [],
    account: { loggedIn: true, method: 'demo', email: 'anamaulele4@gmail.com', phone: '', birth: '2000-01-01', province: 'Maputo Cidade', interests: ['Torneios', 'Clipes'] },
    consent: { done: false, date: '', terms: false, privacy: false, personalizedAds: false, analytics: false },
    blocked: [],
    myReports: [],
    notifPrefs: { live: { inApp: true, push: true }, social: { inApp: true, push: true }, torneio: { inApp: true, push: true }, compra: { inApp: true, push: true }, sistema: { inApp: true, push: true }, anuncios: { inApp: true, push: false } },
    pushEnabled: false,
    installDismissed: false,
    adsMgr: seedAds('@ana'),
    adSeen: { day: '', counts: {} },
    admin: {
      users: ADMIN_USERS,
      tournaments: TOURNAMENTS,
      products: PRODUCTS,
      ads: ADS,
      payments: PAYMENTS,
      hiddenClips: [],
      planPrices: { premium: 149, criador: 349, equipas: 599, verificacao: 499, coach: 199 },
      ...ADMIN_SEED,
      events: EVENTS,
      liveStatus: Object.fromEntries(LIVES.map((l) => [l.id, 'ao vivo' as const])),
      gifts: GIFTS,
      coinPacks: COIN_PACKS,
      commissions: COMMISSIONS,
      adPricing: DEFAULT_PRICING,
    },
  };
}

/** MODO REAL: estado inicial sem dados falsos. Tudo vem do Supabase depois de carregar. */
export function emptyState(): State {
  const d = demoState();
  return {
    ...d,
    user: { name: 'Visitante', handle: '', avatar: '🙂', role: 'user', bio: '' },
    xp: 0, coins: 0, streak: 0, following: [], liked: [], saved: [], reactions: {}, comments: {}, stats: { likes: 0, comments: 0, shares: 0, watched: 0 },
    achievements: [], screen: {}, notifs: [], purchases: [], tickets: [], entries: [], plans: [], challenges: [], lessonsDone: [], cart: [],
    account: { loggedIn: false, method: 'email', email: '', phone: '', birth: '', province: 'Maputo Cidade', interests: [] },
    adsMgr: { campaigns: [], adsets: [], ads: [], stats: {}, wallet: 0, invoices: [] },
    admin: {
      ...d.admin, users: [], tournaments: [], products: [], ads: [], payments: [], hiddenClips: [], reports: [], removed: [], audit: [], policies: {},
      broadcasts: [], orders: [], events: [], liveStatus: {}, payouts: [],
    },
  };
}

export function initialState(): State {
  return IS_DEMO ? demoState() : emptyState();
}

interface Ctx {
  s: State;
  ready: boolean;
  set: (fn: (s: State) => State) => void;
  toast: (msg: string) => void;
  toastMsg: string | null;
  addXp: (n: number, reason?: string) => void;
  track: (a: MissionAction) => void;
  unlock: (id: string) => void;
  toggleFollow: (idolId: string) => void;
  toggleLike: (id: string) => void;
  react: (id: string, r: Reaction) => void;
  toggleSave: (item: Saved) => void;
  isSaved: (item: Saved) => boolean;
  addComment: (target: string, text: string, replyTo?: string) => void;
  share: (target: string) => void;
  pushNotif: (n: Omit<Notif, 'id' | 'read' | 'time'> & { category?: PushCategory }) => void;
  reset: () => void;
  wellbeingAlert: string | null;
  dismissAlert: () => void;
  nightNow: boolean;
  audit: (action: string, target: string) => void;
  report: (kind: ReportKind, target: string, label: string, reason: string) => void;
  toggleBlock: (id: string, label?: string) => void;
  isBlocked: (id: string) => boolean;
  serveAd: (placement: Placement) => Win | null;
  adEvent: (win: Win, kind: 'imp' | 'click') => void;
  viewer: ViewerCtx;
  feature: (k: string) => boolean;
  syncError: string | null;
}

const IDOL_GAME: Record<string, string> = { nyx: 'Free Fire', kaze: 'Free Fire', zuri: 'eFootball', tembo: 'PUBG Mobile', lua: 'Free Fire', rocha: 'Call of Duty Mobile' };

const C = createContext<Ctx | null>(null);

function inNight(start: string, end: string) {
  const now = new Date();
  const m = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const a = sh * 60 + sm;
  const b = eh * 60 + em;
  return a <= b ? m >= a && m < b : m >= a || m < b;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState<State>(initialState);
  const [ready, setReady] = useState(false);
  const [toastMsg, setToast] = useState<string | null>(null);
  const [wellbeingAlert, setAlert] = useState<string | null>(null);
  const [nightNow, setNight] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionSec = useRef(0);
  const limitWarned = useRef(false);

  // MODO REAL: sessão Supabase + carregamento das tabelas + sincronização das alterações
  const realCtx = useRef<SyncCtx | null>(null);
  const loadingReal = useRef(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const loadReal = useCallback(async () => {
    loadingReal.current = true;
    try {
      const c = await sb();
      // Regresso do Google / links de email (#access_token ou ?code=)
      const red = await import('./auth').then((m) => m.consumeAuthRedirect()).catch(() => ({} as { error?: string; next?: string; signedIn?: boolean }));
      if (red.error) setTimeout(() => toastRef.current?.(red.error!), 300);
      if (red.signedIn && red.next) { window.location.replace((process.env.NEXT_PUBLIC_BASE_PATH ?? '') + red.next); return; }
      const { data } = await c.auth.getSession();
      const uid = data.session?.user.id ?? '';
      let handle = '', role = 'user';
      if (uid) {
        const { data: me } = await c.from('profiles').select('handle,role').eq('id', uid).maybeSingle();
        handle = me ? '@' + me.handle : '';
        role = me?.role ?? 'user';
      }
      const ctx: SyncCtx = { uid, handle, isAdmin: role === 'admin', isMod: role === 'admin' || role === 'moderator' };
      realCtx.current = ctx;
      let base = emptyState();
      try { const g = JSON.parse(localStorage.getItem(GUEST_KEY) || '{}'); base = { ...base, consent: { ...base.consent, ...(g.consent ?? {}) }, installDismissed: !!g.installDismissed }; } catch {}
      if (uid) base = { ...base, account: { ...base.account, loggedIn: true, email: data.session?.user.email ?? '', phone: data.session?.user.phone ?? '' } };
      const { state, errors } = await (await syncMod()).loadAll(c, base, ctx);
      if (errors.length) { console.warn('[Social POIPAK] Supabase:', errors); setSyncError(errors[0]); }
      setS(state);
      if (uid) void import('./security').then((m) => m.logLogin());
    } catch (e) {
      console.warn('[Social POIPAK] Falha ao ligar ao Supabase', e);
      setSyncError(String((e as Error).message));
    } finally {
      loadingReal.current = false;
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (IS_DEMO) return;
    void loadReal();
    let unsub: (() => void) | undefined;
    void sb().then((c) => {
      const { data } = c.auth.onAuthStateChange((ev) => {
        if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT' || ev === 'USER_UPDATED') { void syncMod().then((m) => m.resetSnapshot()); void loadReal(); }
      });
      unsub = () => data.subscription.unsubscribe();
    }).catch(() => {});
    // POIPAK IA: quando a ligação ao servidor volta, recarrega os dados (leituras que falharam)
    const again = () => { if (!loadingReal.current) void loadReal(); };
    window.addEventListener('poipak:reconnected', again);
    return () => { unsub?.(); window.removeEventListener('poipak:reconnected', again); };
  }, [loadReal]);

  useEffect(() => {
    if (IS_DEMO || !ready || loadingReal.current || !realCtx.current) return;
    try { localStorage.setItem(GUEST_KEY, JSON.stringify({ consent: s.consent, installDismissed: s.installDismissed })); } catch {}
    const t = setTimeout(async () => {
      const ctx = realCtx.current;
      if (!ctx || loadingReal.current) return;
      try {
        const c = await sb();
        const errs = await (await syncMod()).syncDiff(c, s, ctx);
        if (errs.length) { console.warn('[Social POIPAK] sync:', errs); if (ctx.uid) toastRef.current?.('Não foi possível guardar algumas alterações. Verifica a ligação.'); }
      } catch {}
    }, 700);
    return () => clearTimeout(t);
  }, [s, ready]);

  // MODO DEMO: carregar do localStorage + sequência diária
  useEffect(() => {
    if (!IS_DEMO) return;
    let st = initialState();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        const base = initialState();
        st = { ...base, ...saved, admin: { ...base.admin, ...(saved.admin ?? {}), settings: { ...base.admin.settings, ...(saved.admin?.settings ?? {}) } }, notifPrefs: { ...base.notifPrefs, ...(saved.notifPrefs ?? {}) }, account: { ...base.account, ...(saved.account ?? {}) }, consent: { ...base.consent, ...(saved.consent ?? {}) } };
      }
    } catch {}
    const t = today();
    if (st.lastDay !== t) {
      const diff = st.lastDay ? dayDiff(st.lastDay, t) : 1;
      st.streak = diff === 1 ? st.streak + 1 : diff > 1 ? 1 : st.streak;
      st.lastDay = t;
      st.xp += 20;
    }
    if (st.missions.date !== t) st.missions = { date: t, progress: {}, claimed: [] };
    if (st.streak >= 3 && !st.achievements.includes('a7')) st.achievements = [...st.achievements, 'a7'];
    if (st.streak >= 7 && !st.achievements.includes('a8')) st.achievements = [...st.achievements, 'a8'];
    setS(st);
    setReady(true);
  }, []);

  useEffect(() => {
    if (IS_DEMO && ready) try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
  }, [s, ready]);

  const set = useCallback((fn: (s: State) => State) => setS((p) => fn(p)), []);

  const toastRef = useRef<((m: string) => void) | null>(null);
  const sRef = useRef(s);
  sRef.current = s;
  /** Modo real: ações sociais exigem sessão iniciada. */
  const needAuth = () => { if (!IS_DEMO && !sRef.current.account.loggedIn) { toastRef.current?.('Entra na tua conta para continuar 🔑'); return true; } return false; };
  const toast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);
  toastRef.current = toast;

  // Tempo de ecrã + lembretes de pausa + limite diário + silêncio noturno
  useEffect(() => {
    if (!ready) return;
    const iv = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      sessionSec.current += 10;
      setS((p) => {
        const t = today();
        const secs = (p.screen[t] ?? 0) + 10;
        const w = p.wellbeing;
        if (w.breakOn && sessionSec.current > 0 && sessionSec.current % (w.breakEvery * 60) === 0) {
          setAlert(`Já estás a jogar há ${w.breakEvery} minutos. Que tal uma pausa de 5 minutos? 💧`);
        }
        if (w.limitOn && secs >= w.limitMin * 60 && !limitWarned.current) {
          limitWarned.current = true;
          setAlert(`Atingiste o teu limite diário de ${w.limitMin} minutos. Amanhã há mais! 🌙`);
        }
        return { ...p, screen: { ...p.screen, [t]: secs } };
      });
      setNight(s.wellbeing.nightOn && inNight(s.wellbeing.nightStart, s.wellbeing.nightEnd));
    }, 10000);
    setNight(s.wellbeing.nightOn && inNight(s.wellbeing.nightStart, s.wellbeing.nightEnd));
    return () => clearInterval(iv);
  }, [ready, s.wellbeing.nightOn, s.wellbeing.nightStart, s.wellbeing.nightEnd]);

  const unlockIn = (p: State, id: string): State => {
    if (p.achievements.includes(id)) return p;
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return p;
    setTimeout(() => toast(`🏅 Conquista desbloqueada: ${a.name} (+${a.xp} XP)`), 50);
    return { ...p, achievements: [...p.achievements, id], xp: p.xp + a.xp };
  };

  const unlock = useCallback((id: string) => setS((p) => unlockIn(p, id)), []); // eslint-disable-line

  const addXp = useCallback((n: number, reason?: string) => {
    setS((p) => ({ ...p, xp: p.xp + n }));
    if (reason) toast(`+${n} XP · ${reason}`);
  }, [toast]);

  const trackIn = (p: State, a: MissionAction): State => {
    const t = today();
    let m = p.missions.date === t ? p.missions : { date: t, progress: {}, claimed: [] };
    m = { ...m, progress: { ...m.progress, [a]: (m.progress[a] ?? 0) + 1 } };
    let next = { ...p, missions: m };
    for (const mi of MISSIONS) {
      if (mi.action === a && (m.progress[a] ?? 0) >= mi.goal && !m.claimed.includes(mi.id)) {
        next = { ...next, xp: next.xp + mi.xp, missions: { ...next.missions, claimed: [...next.missions.claimed, mi.id] } };
        setTimeout(() => toast(`✅ Missão "${mi.name}" concluída! +${mi.xp} XP`), 30);
      }
    }
    if (next.missions.claimed.length >= MISSIONS.length) next = unlockIn(next, 'a13');
    return next;
  };

  const track = useCallback((a: MissionAction) => setS((p) => {
    let n = trackIn(p, a);
    if (a === 'watch') n = { ...n, stats: { ...n.stats, watched: n.stats.watched + 1 } };
    return n;
  }), []); // eslint-disable-line

  const toggleFollow = useCallback((idolId: string) => { if (needAuth()) return; setS((p) => {
    const f = p.following.includes(idolId);
    let n: State = { ...p, following: f ? p.following.filter((x) => x !== idolId) : [...p.following, idolId] };
    if (!f) {
      n = trackIn(n, 'follow');
      n = unlockIn(n, 'a2');
      setTimeout(() => toast('A seguir! Vais receber notificações das lives 🔔'), 10);
    }
    return n;
  }); }, []); // eslint-disable-line

  const toggleLike = useCallback((id: string) => { if (needAuth()) return; setS((p) => {
    const l = p.liked.includes(id);
    if (l) return { ...p, liked: p.liked.filter((x) => x !== id) };
    let n: State = { ...p, liked: [...p.liked, id], stats: { ...p.stats, likes: p.stats.likes + 1 } };
    n = trackIn(n, 'like');
    if (n.stats.likes >= 10) n = unlockIn(n, 'a3');
    return n;
  }); }, []); // eslint-disable-line

  const react = useCallback((id: string, r: Reaction) => setS((p) => {
    const cur = p.reactions[id];
    const reactions = { ...p.reactions };
    if (cur === r) delete reactions[id]; else reactions[id] = r;
    return { ...p, reactions };
  }), []);

  const isSaved = useCallback((it: Saved) => s.saved.some((x) => x.kind === it.kind && x.id === it.id), [s.saved]);

  const toggleSave = useCallback((it: Saved) => { if (needAuth()) return; setS((p) => {
    const has = p.saved.some((x) => x.kind === it.kind && x.id === it.id);
    let n: State = { ...p, saved: has ? p.saved.filter((x) => !(x.kind === it.kind && x.id === it.id)) : [it, ...p.saved] };
    setTimeout(() => toast(has ? 'Removido dos Guardados' : 'Guardado 🔖'), 10);
    if (n.saved.length >= 5) n = unlockIn(n, 'a6');
    return n;
  }); }, []); // eslint-disable-line

  const addComment = useCallback((target: string, text: string, replyTo?: string) => { if (needAuth()) return; setS((p) => {
    const list = [...(p.comments[target] ?? [])];
    const me = { author: p.user.name, avatar: p.user.avatar, text };
    if (replyTo) {
      const i = list.findIndex((c) => c.id === replyTo);
      if (i >= 0) list[i] = { ...list[i], replies: [...list[i].replies, { id: 'r' + Date.now(), ...me }] };
    } else {
      list.unshift({ id: 'cm' + Date.now(), ...me, likes: 0, replies: [] });
    }
    let n: State = { ...p, comments: { ...p.comments, [target]: list }, stats: { ...p.stats, comments: p.stats.comments + 1 } };
    n = trackIn(n, 'comment');
    if (n.stats.comments >= 5) n = unlockIn(n, 'a4');
    return n;
  }); }, []); // eslint-disable-line

  const share = useCallback((target: string) => { if (!IS_DEMO) void import('./clips').then((m) => m.recordShare(target)); setS((p) => {
    let n: State = { ...p, stats: { ...p.stats, shares: p.stats.shares + 1 } };
    n = trackIn(n, 'share');
    if (n.stats.shares >= 3) n = unlockIn(n, 'a5');
    return n;
  }); }, []); // eslint-disable-line

  const pushNotif = useCallback((n: Omit<Notif, 'id' | 'read' | 'time'> & { category?: PushCategory }) => setS((p) => {
    const cat: PushCategory = n.category ?? n.type;
    const pref = p.notifPrefs[cat] ?? { inApp: true, push: true };
    const night = p.wellbeing.nightOn && inNight(p.wellbeing.nightStart, p.wellbeing.nightEnd);
    if (p.pushEnabled && pref.push && !night) void localPush({ title: 'Social POIPAK', body: n.text, category: cat, url: n.href });
    if (!pref.inApp) return p;
    return { ...p, notifs: [{ type: n.type, text: n.text, href: n.href, id: 'n' + Date.now() + Math.random().toString(36).slice(2, 5), read: false, time: 'agora', at: new Date().toISOString() }, ...p.notifs] };
  }), []);

  const audit = useCallback((action: string, target: string) => setS((p) => ({
    ...p, admin: { ...p.admin, audit: [{ id: 'au' + Date.now() + Math.random().toString(36).slice(2, 5), at: new Date().toLocaleString('pt-PT'), actor: p.user.handle, action, target }, ...p.admin.audit].slice(0, 300) },
  })), []);

  const report = useCallback((kind: ReportKind, target: string, label: string, reason: string) => {
    if (needAuth()) return;
    setS((p) => {
      const r: Report = { id: 'rp' + Date.now(), kind, target, label, reason, by: p.user.handle, date: new Date().toLocaleString('pt-PT'), status: 'aberta' };
      return { ...p, myReports: [r, ...p.myReports], admin: { ...p.admin, reports: [r, ...p.admin.reports] } };
    });
    toast('Denúncia enviada. A equipa revê em até 24 h. Obrigado 🛡️');
  }, [toast]);

  const toggleBlock = useCallback((id: string, label?: string) => {
    if (needAuth()) return;
    setS((p) => {
      const has = p.blocked.includes(id);
      setTimeout(() => toast(has ? `${label ?? 'Utilizador'} desbloqueado` : `${label ?? 'Utilizador'} bloqueado. Não verás mais o seu conteúdo.`), 10);
      return { ...p, blocked: has ? p.blocked.filter((x) => x !== id) : [...p.blocked, id], following: has ? p.following : p.following.filter((x) => x !== id) };
    });
  }, [toast]);
  const isBlocked = useCallback((id: string) => s.blocked.includes(id), [s.blocked]);

  const viewer: ViewerCtx = {
    age: ageFrom(s.account.birth) || 18,
    province: s.account.province,
    games: Array.from(new Set(s.following.map((f) => IDOL_GAME[f]).filter(Boolean))),
    interests: s.account.interests,
    premium: s.plans.includes('premium'),
  };

  const serveAd = useCallback((placement: Placement) => {
    if (s.admin.settings.features.anuncios === false) return null;
    const day = dayKey();
    const seen = s.adSeen.day === day ? s.adSeen.counts : {};
    return runAuction(s.adsMgr, placement, viewer, s.admin.adPricing, seen, day);
  }, [s.adsMgr, s.adSeen, s.admin.adPricing, s.admin.settings.features.anuncios, viewer.age, viewer.province, viewer.premium, viewer.games.join(), viewer.interests.join()]); // eslint-disable-line

  const adEvent = useCallback((win: Win, kind: 'imp' | 'click') => {
    if (!IS_DEMO) void sb().then((c) => c.rpc('record_ad_event', { p_ad: win.ad.id, p_kind: kind, p_price: win.price })).catch(() => {});
    setS((p) => {
      const day = dayKey();
      const { st, stopped } = recordEvent(p.adsMgr, win, kind, p.user.handle, day);
      let n: State = { ...p, adsMgr: st };
      if (kind === 'imp') {
        const counts = p.adSeen.day === day ? p.adSeen.counts : {};
        n.adSeen = { day, counts: { ...counts, [win.ad.id]: (counts[win.ad.id] ?? 0) + 1 } };
      }
      for (const c of stopped.filter((x) => x.owner === p.user.handle)) {
        n = { ...n, notifs: [{ id: 'n' + Date.now() + c.id, type: 'sistema', text: `📢 Campanha "${c.name}" pausada automaticamente: ${c.status}.`, time: 'agora', href: '/anuncios', read: false }, ...n.notifs] };
      }
      return n;
    });
  }, []);

  const feature = useCallback((k: string) => s.admin.settings.features[k] !== false, [s.admin.settings.features]);

  const reset = useCallback(() => {
    if (!IS_DEMO) { void sb().then((c) => c.auth.signOut()); setS(emptyState()); return; }
    localStorage.removeItem(KEY);
    setS(initialState());
    toast('Demo reposta com os dados iniciais');
  }, [toast]);

  void CLIPS;

  return (
    <C.Provider value={{
      s, ready, set, toast, toastMsg, addXp, track, unlock, toggleFollow, toggleLike, react, toggleSave, isSaved,
      addComment, share, pushNotif, reset, wellbeingAlert, dismissAlert: () => setAlert(null), nightNow,
      audit, report, toggleBlock, isBlocked, serveAd, adEvent, viewer, feature, syncError,
    }}>
      {children}
    </C.Provider>
  );
}

export function useStore() {
  const c = useContext(C);
  if (!c) throw new Error('useStore fora do StoreProvider');
  return c;
}

export { today };
