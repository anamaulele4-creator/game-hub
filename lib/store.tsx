'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  ACHIEVEMENTS, ADMIN_USERS, ADS, MISSIONS, MissionAction, Notif, PAYMENTS, PRODUCTS, Product,
  Reaction, SEED_COMMENTS, SEED_NOTIFS, TOURNAMENTS, Tournament, CLIPS,
} from './data';

const KEY = 'gamehub-demo-v1';

export interface Reply { id: string; author: string; avatar: string; text: string }
export interface Comment { id: string; author: string; avatar: string; text: string; likes: number; replies: Reply[] }
export interface Purchase { id: string; item: string; total: number; method: string; date: string; status: 'demo-pago' | 'cancelado' }
export interface Challenge { id: string; to: string; game: string; stake: string; status: 'enviado' | 'aceite' | 'recebido' | 'recusado' }
export interface Saved { kind: 'clipe' | 'post' | 'torneio' | 'aula' | 'produto' | 'evento'; id: string }

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
  admin: {
    users: typeof ADMIN_USERS;
    tournaments: Tournament[];
    products: Product[];
    ads: typeof ADS;
    payments: typeof PAYMENTS;
    hiddenClips: string[];
    planPrices: Record<string, number>;
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

export function initialState(): State {
  return {
    user: { name: 'Ana Maulele', handle: '@ana', avatar: '🦄', role: 'admin', bio: 'Fundadora do GAME HUB 💜 Free Fire & eFootball' },
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
    admin: {
      users: ADMIN_USERS,
      tournaments: TOURNAMENTS,
      products: PRODUCTS,
      ads: ADS,
      payments: PAYMENTS,
      hiddenClips: [],
      planPrices: { premium: 149, criador: 349, equipas: 599, verificacao: 499, coach: 199 },
    },
  };
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
  pushNotif: (n: Omit<Notif, 'id' | 'read' | 'time'>) => void;
  reset: () => void;
  wellbeingAlert: string | null;
  dismissAlert: () => void;
  nightNow: boolean;
}

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

  // Carregar do localStorage + sequência diária
  useEffect(() => {
    let st = initialState();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) st = { ...st, ...JSON.parse(raw) };
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
    if (ready) try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
  }, [s, ready]);

  const set = useCallback((fn: (s: State) => State) => setS((p) => fn(p)), []);

  const toast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

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

  const toggleFollow = useCallback((idolId: string) => setS((p) => {
    const f = p.following.includes(idolId);
    let n: State = { ...p, following: f ? p.following.filter((x) => x !== idolId) : [...p.following, idolId] };
    if (!f) {
      n = trackIn(n, 'follow');
      n = unlockIn(n, 'a2');
      setTimeout(() => toast('A seguir! Vais receber notificações das lives 🔔'), 10);
    }
    return n;
  }), []); // eslint-disable-line

  const toggleLike = useCallback((id: string) => setS((p) => {
    const l = p.liked.includes(id);
    if (l) return { ...p, liked: p.liked.filter((x) => x !== id) };
    let n: State = { ...p, liked: [...p.liked, id], stats: { ...p.stats, likes: p.stats.likes + 1 } };
    n = trackIn(n, 'like');
    if (n.stats.likes >= 10) n = unlockIn(n, 'a3');
    return n;
  }), []); // eslint-disable-line

  const react = useCallback((id: string, r: Reaction) => setS((p) => {
    const cur = p.reactions[id];
    const reactions = { ...p.reactions };
    if (cur === r) delete reactions[id]; else reactions[id] = r;
    return { ...p, reactions };
  }), []);

  const isSaved = useCallback((it: Saved) => s.saved.some((x) => x.kind === it.kind && x.id === it.id), [s.saved]);

  const toggleSave = useCallback((it: Saved) => setS((p) => {
    const has = p.saved.some((x) => x.kind === it.kind && x.id === it.id);
    let n: State = { ...p, saved: has ? p.saved.filter((x) => !(x.kind === it.kind && x.id === it.id)) : [it, ...p.saved] };
    setTimeout(() => toast(has ? 'Removido dos Guardados' : 'Guardado 🔖'), 10);
    if (n.saved.length >= 5) n = unlockIn(n, 'a6');
    return n;
  }), []); // eslint-disable-line

  const addComment = useCallback((target: string, text: string, replyTo?: string) => setS((p) => {
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
  }), []); // eslint-disable-line

  const share = useCallback((target: string) => setS((p) => {
    let n: State = { ...p, stats: { ...p.stats, shares: p.stats.shares + 1 } };
    n = trackIn(n, 'share');
    if (n.stats.shares >= 3) n = unlockIn(n, 'a5');
    void target;
    return n;
  }), []); // eslint-disable-line

  const pushNotif = useCallback((n: Omit<Notif, 'id' | 'read' | 'time'>) => setS((p) => ({
    ...p, notifs: [{ ...n, id: 'n' + Date.now(), read: false, time: 'agora' }, ...p.notifs],
  })), []);

  const reset = useCallback(() => {
    localStorage.removeItem(KEY);
    setS(initialState());
    toast('Demo reposta com os dados iniciais');
  }, [toast]);

  void CLIPS;

  return (
    <C.Provider value={{
      s, ready, set, toast, toastMsg, addXp, track, unlock, toggleFollow, toggleLike, react, toggleSave, isSaved,
      addComment, share, pushNotif, reset, wellbeingAlert, dismissAlert: () => setAlert(null), nightNow,
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
