'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { IS_DEMO } from '@/lib/config';
import { AI_DEFAULTS, useStore } from '@/lib/store';
import { Page } from '@/components/ui';
import { ask, clearRemote, health, loadRemote, stripEmoji, type CoachLimit, type CoachMsg } from '@/lib/coach';

const WEAPONS = ['M1887', 'AWM', 'MP40', 'M4A1', 'SCAR', 'Groza'];
const QUICK: [string, string][] = [
  ['Plano de treino', 'Faz-me um plano de treino de 7 dias para subir de rank no Free Fire, com 45 minutos por dia.'],
  ['Sensibilidade', 'Qual é a melhor sensibilidade e HUD para Free Fire num telemóvel modesto? Explica como afinar.'],
  ['Rotações', 'Como faço boas rotações e leio a zona para chegar ao top 3?'],
  ['eFootball', 'Dá-me dicas para defender melhor e marcar mais golos no eFootball.'],
  ['Jogar sem cansar', 'Como posso jogar muitas horas sem ficar cansado nem em tilt?'],
];
const WELCOME: CoachMsg = { id: 'welcome', role: 'assistant', at: '', text: 'Olá! Sou o teu Coach IA. Pergunta-me sobre armas, sensibilidade, rotações, planos de treino ou eFootball. Escolhe uma sugestão abaixo ou escreve a tua pergunta.' };

const today = () => new Date().toISOString().slice(0, 10);
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

/** Markdown mínimo: **negrito** e listas com * ou - → • */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => {
        const l = line.replace(/^\s*[*-]\s+/, '• ').replace(/^#+\s*/, '');
        const parts = l.split(/\*\*(.+?)\*\*/g);
        return <Fragment key={i}>{i > 0 && <br />}{parts.map((p, j) => (j % 2 ? <b key={j}>{p}</b> : <Fragment key={j}>{p}</Fragment>))}</Fragment>;
      })}
    </>
  );
}

export default function CoachPage() {
  const { s, feature, ready } = useStore();
  const handle = s.user.handle || 'anon';
  const KEY = `poipak-coach-v1:${handle}`;
  const CKEY = `poipak-coach-count:${handle}:${today()}`;
  const ai = { ...AI_DEFAULTS, ...(s.admin.settings.ai ?? {}) };
  const paid = s.plans.includes('coach') || s.user.role === 'admin';
  const freeDaily = ai.freeDaily;

  const [msgs, setMsgs] = useState<CoachMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [aiState, setAiState] = useState<'checking' | 'live' | 'off'>(IS_DEMO ? 'off' : 'checking');
  const [limit, setLimit] = useState<CoachLimit | null>(null);
  const [localCount, setLocalCount] = useState(0);
  const [pickWeapon, setPickWeapon] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  // Histórico local (+ remoto se o local estiver vazio)
  useEffect(() => {
    if (!ready || loaded.current) return;
    loaded.current = true;
    let local: CoachMsg[] = [];
    try { local = JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch {}
    try { setLocalCount(Number(localStorage.getItem(CKEY) ?? 0)); } catch {}
    setMsgs(local);
    if (!local.length && s.account.loggedIn) void loadRemote().then((r) => { if (r.length) setMsgs((m) => (m.length ? m : r.map((x) => ({ ...x, text: stripEmoji(x.text) })))); });
  }, [ready, KEY, CKEY, s.account.loggedIn]);
  useEffect(() => { if (loaded.current) try { localStorage.setItem(KEY, JSON.stringify(msgs.slice(-60))); } catch {} }, [msgs, KEY]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, busy]);

  // Rede + estado da IA
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true); const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  useEffect(() => {
    if (IS_DEMO) return;
    if (ai.enabled === false) { setAiState('off'); return; }
    let alive = true;
    void health().then((h) => { if (alive) setAiState(h.reachable && h.configured && h.enabled ? 'live' : 'off'); });
    return () => { alive = false; };
  }, [ai.enabled, online]);

  const freeLeft = limit ? limit.remaining : Math.max(0, freeDaily - localCount);
  const outOfFree = !paid && freeLeft <= 0;

  const send = useCallback(async (text: string, replaceId?: string) => {
    const q = text.trim().slice(0, 1500);
    if (!q || busy) return;
    setBusy(true); setPickWeapon(false);
    let base = msgs;
    if (replaceId) base = msgs.filter((m) => m.id !== replaceId);
    else { const um: CoachMsg = { id: uid(), role: 'user', text: q, at: new Date().toISOString() }; base = [...msgs, um]; setInput(''); }
    setMsgs(base);
    const history = base.filter((m) => m.id !== 'welcome').map((m) => ({ role: m.role, content: m.text }));
    // Sem IA disponível ou limite grátis acabado → regras de imediato (resposta garantida)
    const skipAI = IS_DEMO || ai.enabled === false || outOfFree;
    const r = skipAI
      ? await Promise.all([import('@/lib/coachRules'), import('@/lib/poipakAI')]).then(([m, p]) => ({ text: (p.helpAnswer(q) ?? m.ruleAnswer(q)) + (outOfFree ? `\n\n— Usaste as ${freeDaily} mensagens grátis com IA de hoje. Ativa o plano Coach IA para mais. (resposta automática)` : ''), fallback: true, reason: outOfFree ? 'limit' : 'local', networkError: false, limit: undefined, model: undefined }))
      : await ask(history);
    if (!r.fallback) {
      setAiState('live');
      const n = localCount + 1; setLocalCount(n); try { localStorage.setItem(CKEY, String(n)); } catch {}
    } else if (r.reason === 'not_configured' || r.reason === 'disabled') setAiState('off');
    if (r.limit) setLimit(r.limit);
    setMsgs((m) => [...m, { id: uid(), role: 'assistant', text: stripEmoji(r.text), at: new Date().toISOString(), fallback: r.fallback, reason: r.reason, failed: false }]); // sem IA → resposta da TXAPILOG IA, sem mostrar erro
    setBusy(false);
  }, [busy, msgs, ai.enabled, outOfFree, freeDaily, localCount, CKEY]);

  const retry = (assistantId: string) => {
    const i = msgs.findIndex((m) => m.id === assistantId);
    const prev = [...msgs.slice(0, i)].reverse().find((m) => m.role === 'user');
    if (prev) void send(prev.text, assistantId);
  };
  const clear = () => {
    if (!window.confirm('Apagar toda a conversa com o Coach IA?')) return;
    setMsgs([]); try { localStorage.removeItem(KEY); } catch {}
    void clearRemote();
  };

  if (ready && !feature('coach')) {
    return <Page title="Coach IA" back="/mais"><p className="card text-center text-sm">O Coach IA está temporariamente indisponível. Volta mais tarde!</p></Page>;
  }

  const shown = msgs.length ? msgs : [WELCOME];
  return (
    <Page title="Coach IA" back="/mais">
      {IS_DEMO && <p className="mb-3 rounded-lg border border-neon/40 bg-neon/10 p-2 text-center text-xs text-neon2">Demonstração: respostas automáticas, sem IA real ligada.</p>}
      {!IS_DEMO && aiState === 'off' && <p className="mb-3 rounded-lg border border-neon/40 bg-neon/10 p-2 text-center text-xs text-neon2">A IA está em manutenção — vais receber respostas automáticas do Coach entretanto.</p>}
      {!online && <p className="mb-3 rounded-lg bg-pink/20 p-2 text-center text-xs">Sem ligação à internet. O Coach responde com dicas automáticas até voltares a estar online.</p>}
      {!IS_DEMO && !s.account.loggedIn && <Link href="/entrar" className="mb-3 block rounded-lg bg-panel2 p-2 text-center text-xs">Entra na tua conta para usar a IA · por agora recebes respostas automáticas</Link>}

      <div className="mb-3 flex items-center justify-between text-xs text-white/60">
        <span>{aiState === 'live' ? 'IA ligada' : aiState === 'checking' ? 'A ligar…' : 'Modo automático'}{paid ? ' · plano Coach IA' : ` · ${freeLeft}/${limit?.perDay ?? freeDaily} mensagens com IA hoje`}</span>
        {msgs.length > 0 && <button onClick={clear} className="text-white/50 underline">Limpar</button>}
      </div>
      {!paid && <Link href="/planos" className="card mb-3 block text-center text-xs">{outOfFree ? 'Acabaram as mensagens grátis de hoje.' : 'Queres mais?'} Ativa o plano <b>Coach IA</b> para {ai.paidDaily} mensagens/dia · ver planos</Link>}

      <div className="space-y-2 pb-40" aria-live="polite">
        {shown.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${m.role === 'user' ? 'rounded-br-sm bg-neon text-white' : 'rounded-bl-sm bg-panel2 text-white/90'}`}>
              <Rich text={m.text} />
              {m.role === 'assistant' && m.fallback && m.id !== 'welcome' && <p className="mt-1 text-[11px] text-white/40">TXAPILOG IA · resposta própria</p>}
              {m.failed && <button onClick={() => retry(m.id)} disabled={busy || !online} className="mt-1 rounded-full bg-white/10 px-2 py-0.5 text-xs disabled:opacity-40">↻ Tentar com IA outra vez</button>}
            </div>
          </div>
        ))}
        {busy && <div className="flex justify-start"><div className="rounded-2xl rounded-bl-sm bg-panel2 px-3 py-2 text-sm text-white/60"><span className="animate-pulse">O Coach está a pensar…</span></div></div>}
        <div ref={endRef} />
      </div>

      <div className="dock-x dock-b fixed z-20 border-t border-line bg-bg/95 px-3 pb-2 pt-2 backdrop-blur">
        {pickWeapon ? (
          <div className="no-scrollbar mb-2 flex gap-2 overflow-x-auto">
            {WEAPONS.map((w) => <button key={w} disabled={busy} onClick={() => void send(`Analisa a minha arma principal, a ${w}: quando usar, como controlar o recuo e com que arma combinar?`)} className="shrink-0 rounded-full bg-panel2 px-3 py-1 text-xs">{w}</button>)}
            <button onClick={() => setPickWeapon(false)} className="shrink-0 rounded-full px-2 py-1 text-xs text-white/50">✕</button>
          </div>
        ) : (
          <div className="no-scrollbar mb-2 flex gap-2 overflow-x-auto">
            <button disabled={busy} onClick={() => setPickWeapon(true)} className="shrink-0 rounded-full bg-panel2 px-3 py-1 text-xs">Analisar arma</button>
            {QUICK.map(([l, p]) => <button key={l} disabled={busy} onClick={() => void send(p)} className="shrink-0 rounded-full bg-panel2 px-3 py-1 text-xs">{l}</button>)}
          </div>
        )}
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
          <textarea
            value={input} onChange={(e) => setInput(e.target.value)} rows={1} maxLength={1500} placeholder="Pergunta ao Coach…"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }}
            className="input max-h-28 min-h-[40px] flex-1 resize-none text-sm"
          />
          <button type="submit" disabled={busy || !input.trim()} className="btn shrink-0 px-4 disabled:opacity-40">{busy ? '…' : 'Enviar'}</button>
        </form>
        <p className="mt-1 text-center text-[11px] text-white/40">O Coach pode errar. Sem cheats nem hacks · joga com pausas</p>
      </div>
    </Page>
  );
}
