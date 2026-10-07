'use client';

import { useCallback, useEffect, useState } from 'react';
import { IS_DEMO } from '@/lib/config';
import { Tabs } from '@/components/ui';
import { useAdmin, Badge } from './shared';
import { DEFAULT_RULES, MonRules } from '@/lib/monetization';

const sb = () => import('@/lib/supabase').then((m) => m.sb());
type Flag = { id: string; user: string; userId?: string; kind: string; rules: string[]; score: number; amount?: number; status: string; at: string; ref?: string };
type Kyc = { id: string; user: string; level: number; kind: string; status: string; at: string; doc?: string };
type App = { id: string; user: string; followers: number; hours: number; category?: string; pitch?: string; status: string; at: string };

const DEMO_FLAGS: Flag[] = [
  { id: 'rf1', user: '@mario_ff', kind: 'levantamento', rules: ['numero_novo_72h', 'dispositivo_novo_24h', 'valor_anomalo'], score: 75, amount: 18000, status: 'aberto', at: new Date().toISOString() },
  { id: 'rf2', user: '@freediamonds99', kind: 'conta', rules: ['pin_brute_force'], score: 60, status: 'aberto', at: new Date(Date.now() - 3600000).toISOString() },
  { id: 'rf3', user: '@kiara', kind: 'pagamento', rules: ['velocidade_10min'], score: 30, amount: 2400, status: 'aberto', at: new Date(Date.now() - 7200000).toISOString() },
];
const RULE_LABEL: Record<string, string> = {
  velocidade_10min: 'Muitas transações em 10 min', levantamentos_dia: '3+ levantamentos hoje', numero_novo_72h: 'Número adicionado há < 72 h',
  dispositivo_novo_24h: 'Login de dispositivo novo < 24 h', valor_anomalo: 'Valor > 3× a média', primeira_transacao_alta: '1.ª transação alta',
  kyc_baixo_valor_alto: 'KYC baixo para o valor', pin_brute_force: '5 PINs errados', valor_webhook_diferente: 'Valor do operador ≠ pedido',
};

export function RiskQueue() {
  const { act } = useAdmin();
  const [flags, setFlags] = useState<Flag[]>(IS_DEMO ? DEMO_FLAGS : []);
  const [filter, setFilter] = useState<'aberto' | 'todos'>('aberto');
  const load = useCallback(async () => {
    if (IS_DEMO) return;
    const c = await sb();
    const { data } = await c.from('risk_flags').select('*').order('created_at', { ascending: false }).limit(300);
    setFlags((data ?? []).map((r) => ({ id: r.id, user: '@' + (r.user_handle ?? '?'), userId: r.user_id, kind: r.kind, rules: r.rules ?? [], score: r.score, amount: r.amount_mzn ?? undefined, status: r.status, at: r.created_at, ref: r.ref_id ?? undefined })));
  }, []);
  useEffect(() => { void load(); }, [load]);
  const decide = async (f: Flag, status: 'aprovado' | 'bloqueado', freeze = false) => {
    if (!IS_DEMO) {
      const c = await sb();
      await c.from('risk_flags').update({ status }).eq('id', f.id);
      if (f.kind === 'levantamento' && f.ref) await c.from('payouts').update({ status: status === 'aprovado' ? 'aprovado' : 'rejeitado' }).eq('id', f.ref);
      if (f.kind === 'pagamento' && f.ref && status === 'bloqueado') await c.from('payments').update({ status: 'falhou' }).eq('id', f.ref);
      if (freeze && f.userId) await c.rpc('admin_set_frozen', { p_user: f.userId, p_frozen: true });
      void load();
    } else setFlags((l) => l.map((x) => (x.id === f.id ? { ...x, status } : x)));
    act(`Risco: ${status}${freeze ? ' + conta congelada' : ''}`, `${f.user} · ${f.kind} ${f.amount ?? ''}`, status === 'aprovado' ? 'Aprovado' : freeze ? 'Bloqueado e conta congelada' : 'Bloqueado');
  };
  const list = flags.filter((f) => filter === 'todos' || f.status === 'aberto').sort((a, b) => b.score - a.score);
  return (
    <div className="space-y-2">
      <div className="flex gap-2 text-[11px]">{(['aberto', 'todos'] as const).map((x) => <button key={x} onClick={() => setFilter(x)} className={`rounded-full px-2 py-1 ${filter === x ? 'bg-neon' : 'bg-panel2'}`}>{x === 'aberto' ? 'Por rever' : 'Todos'}</button>)}</div>
      <p className="text-[11px] text-white/50">Regras: velocidade, anomalia de valor, número/dispositivo novos, KYC vs valor, força bruta de PIN. Pontuação ≥ 50 retém o levantamento até decisão.</p>
      {list.length === 0 && <p className="card text-center text-sm text-white/60">Sem alertas 🎉</p>}
      {list.map((f) => (
        <div key={f.id} className={`card !p-3 text-sm ${f.score >= 50 ? 'border-pink' : ''}`}>
          <div className="flex justify-between"><span className="font-semibold">{f.user} · {f.kind}{f.amount ? ` · ${f.amount.toLocaleString('pt-PT')} MZN` : ''}</span><Badge tone={f.score >= 50 ? 'red' : 'amber'}>risco {f.score}</Badge></div>
          <ul className="my-1 list-disc pl-5 text-[11px] text-white/70">{f.rules.map((r) => <li key={r}>{RULE_LABEL[r] ?? r}</li>)}</ul>
          <p className="text-[10px] text-white/40">{new Date(f.at).toLocaleString('pt-PT')} · {f.status}</p>
          {f.status === 'aberto' && (
            <div className="mt-2 grid grid-cols-3 gap-1.5 text-[11px]">
              <button className="btn !px-1 !py-1" onClick={() => void decide(f, 'aprovado')}>Aprovar</button>
              <button className="rounded-xl bg-red-600 py-1 font-semibold" onClick={() => void decide(f, 'bloqueado')}>Bloquear</button>
              <button className="rounded-xl border border-red-500 py-1 text-red-300" onClick={() => void decide(f, 'bloqueado', true)}>Bloquear + congelar</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function KycReview() {
  const { act } = useAdmin();
  const [list, setList] = useState<Kyc[]>(IS_DEMO ? [{ id: 'k1', user: '@nyxff', level: 2, kind: 'documento', status: 'pendente', at: new Date().toISOString() }] : []);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    if (IS_DEMO) return;
    const c = await sb();
    const { data } = await c.from('kyc_submissions').select('id,user_id,level,kind,status,created_at,doc_path').order('created_at', { ascending: false }).limit(200);
    const ids = Array.from(new Set((data ?? []).map((d) => d.user_id)));
    const { data: ps } = ids.length ? await c.from('profiles').select('id,handle').in('id', ids) : { data: [] };
    setList((data ?? []).map((r) => ({ id: r.id, user: '@' + (ps?.find((p) => p.id === r.user_id)?.handle ?? '?'), level: r.level, kind: r.kind, status: r.status, at: r.created_at, doc: r.doc_path ?? undefined })));
  }, []);
  useEffect(() => { void load(); }, [load]);
  const view = async (k: Kyc) => { if (!k.doc) return; const c = await sb(); const { data } = await c.storage.from('kyc-docs').createSignedUrl(k.doc, 300); if (data?.signedUrl) setUrls((u) => ({ ...u, [k.id]: data.signedUrl })); };
  const decide = async (k: Kyc, status: 'aprovado' | 'rejeitado') => {
    const note = status === 'rejeitado' ? window.prompt('Motivo da rejeição', 'Documento ilegível') ?? 'Documento ilegível' : null;
    if (!IS_DEMO) { const c = await sb(); await c.from('kyc_submissions').update({ status, note }).eq('id', k.id); void load(); } else setList((l) => l.map((x) => (x.id === k.id ? { ...x, status } : x)));
    act(`KYC ${status}`, `${k.user} nível ${k.level}`, `Verificação ${status}`);
  };
  return (
    <div className="space-y-2">
      {list.length === 0 && <p className="card text-center text-sm text-white/60">Sem pedidos de verificação.</p>}
      {list.map((k) => (
        <div key={k.id} className="card !p-3 text-sm">
          <div className="flex justify-between"><span className="font-semibold">{k.user} · nível {k.level} ({k.kind})</span><Badge tone={k.status === 'aprovado' ? 'green' : k.status === 'rejeitado' ? 'red' : 'amber'}>{k.status}</Badge></div>
          <p className="text-[10px] text-white/40">{new Date(k.at).toLocaleString('pt-PT')}</p>
          {k.doc && (urls[k.id] ? <img src={urls[k.id]} alt="Documento" className="mt-2 max-h-56 rounded-lg" /> : <button className="mt-1 text-xs text-neon2" onClick={() => void view(k)}>Ver documento (link temporário)</button>)}
          {k.status === 'pendente' && <div className="mt-2 flex gap-2 text-xs"><button className="btn flex-1 !py-1" onClick={() => void decide(k, 'aprovado')}>Aprovar</button><button className="flex-1 rounded-xl bg-red-600 py-1" onClick={() => void decide(k, 'rejeitado')}>Rejeitar</button></div>}
        </div>
      ))}
    </div>
  );
}

const MT = ['Candidaturas', 'Comissões'] as const;
export function Creators() {
  const { act, toast } = useAdmin();
  const [tab, setTab] = useState<(typeof MT)[number]>('Candidaturas');
  const [apps, setApps] = useState<App[]>(IS_DEMO ? [{ id: 'ca1', user: '@lua', followers: 64100, hours: 1250, category: 'Humor', pitch: 'Clipes diários de humor.', status: 'pendente', at: new Date().toISOString() }] : []);
  const [rules, setRules] = useState<MonRules>(DEFAULT_RULES);
  const load = useCallback(async () => {
    if (IS_DEMO) return;
    const c = await sb();
    const [{ data }, { data: ps }] = await Promise.all([
      c.from('creator_applications').select('*').order('created_at', { ascending: false }).limit(200),
      c.from('platform_settings').select('data').eq('id', 1).maybeSingle(),
    ]);
    const ids = Array.from(new Set((data ?? []).map((d) => d.user_id)));
    const { data: pr } = ids.length ? await c.from('profiles').select('id,handle').in('id', ids) : { data: [] };
    setApps((data ?? []).map((r) => ({ id: r.id, user: '@' + (pr?.find((p) => p.id === r.user_id)?.handle ?? '?'), followers: r.followers_at_apply, hours: Number(r.watch_hours), category: r.category ?? undefined, pitch: r.pitch ?? undefined, status: r.status, at: r.created_at })));
    setRules({ ...DEFAULT_RULES, ...((ps?.data as { monetization?: Partial<MonRules> })?.monetization ?? {}) });
  }, []);
  useEffect(() => { void load(); }, [load]);
  const decide = async (a: App, status: 'aprovado' | 'rejeitado') => {
    const note = status === 'rejeitado' ? window.prompt('Motivo', 'Requisitos em falta') ?? '' : null;
    if (!IS_DEMO) { const c = await sb(); await c.from('creator_applications').update({ status, note }).eq('id', a.id); void load(); } else setApps((l) => l.map((x) => (x.id === a.id ? { ...x, status } : x)));
    act(`Monetização: candidatura ${status}`, a.user, `Candidatura ${status}`);
  };
  const saveRules = async () => {
    if (!IS_DEMO) {
      const c = await sb();
      const { data } = await c.from('platform_settings').select('data').eq('id', 1).maybeSingle();
      const { error } = await c.from('platform_settings').update({ data: { ...(data?.data ?? {}), monetization: rules } }).eq('id', 1);
      if (error) { toast('Erro ao guardar: ' + error.message); return; }
    }
    act('Alterou comissões de monetização', JSON.stringify(rules), 'Regras guardadas');
  };
  return (
    <div>
      <Tabs tabs={MT} value={tab} onChange={setTab} />
      {tab === 'Candidaturas' && (
        <div className="space-y-2">
          {apps.length === 0 && <p className="card text-center text-sm text-white/60">Sem candidaturas.</p>}
          {apps.map((a) => (
            <div key={a.id} className="card !p-3 text-sm">
              <div className="flex justify-between"><span className="font-semibold">{a.user} · {a.category}</span><Badge tone={a.status === 'aprovado' ? 'green' : a.status === 'rejeitado' ? 'red' : 'amber'}>{a.status}</Badge></div>
              <p className="text-[11px] text-white/60">{a.followers.toLocaleString('pt-PT')} seguidores · {a.hours} h vistas · {new Date(a.at).toLocaleDateString('pt-PT')}</p>
              {a.pitch && <p className="mt-1 text-xs text-white/80">“{a.pitch}”</p>}
              {a.status === 'pendente' && <div className="mt-2 flex gap-2 text-xs"><button className="btn flex-1 !py-1" onClick={() => void decide(a, 'aprovado')}>Aprovar</button><button className="flex-1 rounded-xl bg-red-600 py-1" onClick={() => void decide(a, 'rejeitado')}>Rejeitar</button></div>}
            </div>
          ))}
        </div>
      )}
      {tab === 'Comissões' && (
        <div className="card space-y-2 text-sm">
          {([['minFollowers', 'Seguidores mínimos'], ['minWatchHours', 'Horas vistas mínimas (12 meses)'], ['minAge', 'Idade mínima'], ['coinValueMzn', 'Valor de 1 moeda (MZN)'], ['giftCreatorPct', '% do criador em presentes'], ['subCreatorPct', '% do criador em membros'], ['adsCreatorPct', '% da receita de anúncios para criadores'], ['tournamentFeePct', 'Comissão em inscrições de torneios (%)'], ['minPayoutMzn', 'Levantamento mínimo (MZN)']] as const).map(([k, l]) => (
            <label key={k} className="flex items-center justify-between gap-2"><span className="text-xs">{l}</span><input type="number" step="any" className="input w-24" value={rules[k]} onChange={(e) => setRules({ ...rules, [k]: Number(e.target.value) })} /></label>
          ))}
          <button className="btn w-full" onClick={() => void saveRules()}>Guardar</button>
          <p className="text-[11px] text-white/50">Aplica-se a novos movimentos. Levantamentos pendentes estão em “Pagamentos e comissões”.</p>
        </div>
      )}
    </div>
  );
}
