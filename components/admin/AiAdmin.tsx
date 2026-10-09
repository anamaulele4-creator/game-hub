'use client';

import { useEffect, useState } from 'react';
import { AI_DEFAULTS } from '@/lib/store';
import { health, usageStats, type CoachHealth } from '@/lib/coach';
import { IS_DEMO } from '@/lib/config';
import { useAdmin, Badge } from './shared';

export default function AiAdmin() {
  const { a, upd, act } = useAdmin();
  const st = a.settings;
  const ai = { ...AI_DEFAULTS, ...(st.ai ?? {}) };
  const [stats, setStats] = useState<Record<string, unknown> | null | undefined>(undefined);
  const [h, setH] = useState<CoachHealth | null>(null);
  const save = (patch: Partial<typeof ai>, action: string, target: string) => { upd({ settings: { ...st, ai: { ...ai, ...patch } } }); act(action, target); };
  const refresh = () => { setStats(undefined); void usageStats().then(setStats); void health().then(setH); };
  useEffect(refresh, []); // eslint-disable-line react-hooks/exhaustive-deps

  const num = (k: string) => Number((stats as Record<string, number> | null)?.[k] ?? 0);
  const byModel = (stats?.by_model ?? {}) as Record<string, number>;
  const status = IS_DEMO ? ['demo', 'amber'] : !h ? ['a verificar', 'gray'] : !h.reachable ? ['função não publicada', 'red'] : !h.configured ? ['sem chave de IA', 'red'] : !ai.enabled ? ['desligada', 'amber'] : ['ativa', 'green'];

  return (
    <div className="space-y-3 text-sm">
      <div className="card space-y-2">
        <div className="flex items-center justify-between">
          <p className="font-semibold">Coach IA</p>
          <input type="checkbox" className="h-5 w-5 accent-neon" checked={ai.enabled} onChange={() => save({ enabled: !ai.enabled }, ai.enabled ? 'Desligou IA do Coach' : 'Ligou IA do Coach', 'coach-ai')} />
        </div>
        <p className="text-xs text-white/60">Estado: <Badge tone={status[1] as 'gray' | 'green' | 'red' | 'amber'}>{status[0]}</Badge></p>
        <p className="text-xs text-white/50">Desligada = os utilizadores recebem só respostas automáticas (sem custos de IA). A página Coach IA continua visível; para a esconder use Definições › Funcionalidades.</p>
        {h && h.reachable && !h.configured && <p className="text-xs text-neon2">Falta a chave: <code>supabase secrets set GEMINI_API_KEY=...</code> (grátis em aistudio.google.com/apikey).</p>}
        {h && !h.reachable && !IS_DEMO && <p className="text-xs text-neon2">Publique a função: <code>supabase functions deploy coach-ai --no-verify-jwt</code>.</p>}
      </div>

      <div className="card space-y-2">
        <p className="font-semibold">Limites por utilizador</p>
        {([['freeDaily', 'Grátis · mensagens por dia', 0, 50], ['paidDaily', 'Plano Coach IA · por dia', 1, 1000], ['paidHourly', 'Plano Coach IA · por hora', 1, 200]] as const).map(([k, l, min, max]) => (
          <label key={k} className="flex items-center justify-between gap-2">
            <span className="text-xs">{l}</span>
            <input type="number" min={min} max={max} className="input w-20 text-right text-xs" value={ai[k]}
              onChange={(e) => { const v = Math.max(min, Math.min(max, Math.round(Number(e.target.value) || 0))); upd({ settings: { ...st, ai: { ...ai, [k]: v } } }); }}
              onBlur={() => act('Limite IA', `${l}: ${ai[k]}`)} />
          </label>
        ))}
        <p className="text-xs text-white/50">Janela móvel de 24 h. Tecto de segurança: 60 pedidos/hora por conta.</p>
      </div>

      <div className="card space-y-2">
        <div className="flex items-center justify-between"><p className="font-semibold">Utilização</p><button onClick={refresh} className="text-xs text-white/50 underline">Atualizar</button></div>
        {stats === undefined ? <div className="skeleton h-16 rounded-ctl" /> : stats === null ? (
          <p className="text-xs text-white/60">Sem dados. Corra <code>supabase/ai.sql</code> no SQL Editor.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              {([['Pedidos 24 h', num('today')], ['Com IA', num('today_ai')], ['Automáticas', num('today_fallback')], ['Utilizadores 24 h', num('users_today')], ['7 dias', num('week')], ['Total', num('total')]] as const).map(([l, v]) => (
                <div key={l} className="rounded-xl bg-panel2 p-2"><p className="text-base font-bold">{v.toLocaleString('pt-PT')}</p><p className="text-[11px] text-white/50">{l}</p></div>
              ))}
            </div>
            <p className="text-xs text-white/50">Tempo médio de resposta (7 dias): {(num('avg_latency_ms') / 1000).toFixed(1)} s</p>
            {Object.keys(byModel).length > 0 && <div className="space-y-1">{Object.entries(byModel).sort((x, y) => y[1] - x[1]).map(([m, n]) => <p key={m} className="flex justify-between text-xs"><span className="text-white/70">{m}</span><span>{n}</span></p>)}</div>}
          </>
        )}
      </div>
    </div>
  );
}
