'use client';

// Sobre a POIPAK IA: versão, plano, capacidades, estado e assistente de ajuda (100% local, grátis).
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AI_CAPABILITIES, AI_FUTURE, AI_LABEL, AI_NAME, aiStats, checkHealth, helpAnswer, type Health } from '@/lib/poipakAI';
import { Page } from '@/components/ui';

const SUGGEST = ['Como publico um meme?', 'Porque o vídeo não tem som?', 'Qual é o limite de tamanho?', 'Como entro com o Google?', 'Como torno a publicação privada?'];

export default function PoipakIAPage() {
  const [h, setH] = useState<Health | null>(null);
  const [q, setQ] = useState('');
  const [chat, setChat] = useState<{ q: string; a: string }[]>([]);
  useEffect(() => { setH(aiStats().lastHealth ?? null); }, []);
  const askIt = async (text: string) => {
    const t = text.trim(); if (!t) return;
    const a = helpAnswer(t) ?? (await import('@/lib/coachRules')).ruleAnswer(t);
    setChat((c) => [...c, { q: t, a }]); setQ('');
  };
  return (
    <Page title={AI_NAME} back="/bem-estar">
      <div className="card mb-4 text-center">
        <p className="text-4xl">🩺</p>
        <p className="mt-1 text-lg font-bold">{AI_NAME}</p>
        <p className="text-sm text-white/70">{AI_LABEL}</p>
        <p className="mt-2 text-sm text-white/70">A inteligência própria do Social POIPAK. Funciona no teu telemóvel, mesmo sem internet, sem custos e sem depender de serviços pagos.</p>
      </div>

      <h2 className="mb-2 text-base font-bold">O que faz (grátis)</h2>
      <div className="mb-5 space-y-2">
        {AI_CAPABILITIES.map((c) => <div key={c.title} className="card flex gap-3 !p-4"><span className="text-2xl">{c.icon}</span><div><p className="font-semibold">{c.title}</p><p className="text-sm text-white/70">{c.desc}</p></div></div>)}
      </div>

      <h2 className="mb-2 text-base font-bold">💬 Pergunta à {AI_NAME}</h2>
      <div className="card mb-5 space-y-3">
        {chat.map((m, k) => (
          <div key={k} className="space-y-1">
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-neon px-3 py-2 text-sm">{m.q}</p>
            <p className="w-fit max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-panel2 px-3 py-2 text-sm">{m.a}</p>
          </div>
        ))}
        {!chat.length && <div className="flex flex-wrap gap-2">{SUGGEST.map((x) => <button key={x} onClick={() => void askIt(x)} className="rounded-full bg-panel2 px-3 py-1.5 text-sm text-white/80">{x}</button>)}</div>}
        <div className="flex gap-2">
          <input className="input flex-1" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void askIt(q); }} placeholder="Escreve a tua dúvida…" />
          <button className="btn" onClick={() => void askIt(q)} disabled={!q.trim()}>Enviar</button>
        </div>
        <p className="text-xs text-white/50">Para dicas de jogo usa o <Link href="/coach-ia" className="text-neon2">Coach IA</Link>.</p>
      </div>

      <h2 className="mb-2 text-base font-bold">Estado</h2>
      <div className="card mb-5 space-y-1 text-sm">
        {h ? (
          <>
            <p>Servidor: <b>{h.server}</b>{h.ms ? ` (${h.ms} ms)` : ''} · Sessão: <b>{h.session}</b></p>
            <p>Armazenamento: <b>{h.storage ? 'ok' : 'indisponível'}</b> · App: <b>{h.sw}</b>{h.safeMode ? ' · 🩺 modo seguro' : ''}</p>
            <p className="text-xs text-white/50">Última verificação: {new Date(h.at).toLocaleTimeString('pt-PT')}</p>
          </>
        ) : <p className="text-white/60">Ainda sem verificação nesta sessão.</p>}
        <button className="btn-ghost mt-2 w-full" onClick={async () => setH(await checkHealth())}>🩺 Verificar agora</button>
      </div>

      <h2 className="mb-2 text-base font-bold">Plano futuro (em breve)</h2>
      <div className="card mb-6 text-sm">
        <ul className="list-disc space-y-1 pl-5 text-white/75">{AI_FUTURE.map((x) => <li key={x}>{x}</li>)}</ul>
        <p className="mt-3 text-xs text-white/50">Ainda não está à venda e nada é cobrado. O {AI_PLAN_TEXT} continua sempre disponível.</p>
      </div>
    </Page>
  );
}
const AI_PLAN_TEXT = 'Plano Grátis';
