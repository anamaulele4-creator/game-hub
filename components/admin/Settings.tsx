'use client';

import { useState } from 'react';
import { FEATURES } from '@/lib/store';
import { POLICIES, policyToText } from '@/lib/policies';
import { useAdmin } from './shared';
import { IS_DEMO } from '@/lib/config';

export function PlatformSettingsPanel() {
  const { a, upd, act } = useAdmin();
  const st = a.settings;
  const save = (patch: Partial<typeof st>, action: string, target: string) => { upd({ settings: { ...st, ...patch } }); act(action, target); };
  return (
    <div className="space-y-3 text-sm">
      <div className="card space-y-2">
        <div className="flex items-center justify-between"><p className="font-semibold">🛠️ Modo manutenção</p><input type="checkbox" className="h-5 w-5 accent-neon" checked={st.maintenance} onChange={() => save({ maintenance: !st.maintenance }, st.maintenance ? 'Desligou manutenção' : 'Ligou manutenção', 'plataforma')} /></div>
        <textarea className="input w-full text-xs" value={st.maintenanceMsg} onChange={(e) => upd({ settings: { ...st, maintenanceMsg: e.target.value } })} />
        <p className="text-xs text-white/50">Utilizadores veem um ecrã de manutenção; administradores continuam a usar a app. Páginas legais ficam sempre acessíveis.</p>
      </div>
      <div className="card space-y-2">
        <div className="flex items-center justify-between"><p className="font-semibold">📢 Faixa de anúncio global</p><input type="checkbox" className="h-5 w-5 accent-neon" checked={st.banner.on} onChange={() => save({ banner: { ...st.banner, on: !st.banner.on } }, 'Faixa global', String(!st.banner.on))} /></div>
        <input className="input w-full text-xs" value={st.banner.text} onChange={(e) => upd({ settings: { ...st, banner: { ...st.banner, text: e.target.value } } })} />
        <div className="flex gap-2 text-xs">{(['info', 'aviso', 'promo'] as const).map((t) => <button key={t} onClick={() => save({ banner: { ...st.banner, tone: t } }, 'Tom da faixa', t)} className={`flex-1 rounded-xl border py-1 ${st.banner.tone === t ? 'border-neon bg-neon/20' : 'border-line'}`}>{t}</button>)}</div>
      </div>
      <div className="card space-y-2">
        <p className="font-semibold">🔀 Funcionalidades</p>
        {FEATURES.map(([k, l]) => (
          <label key={k} className="flex items-center justify-between"><span>{l}</span><input type="checkbox" className="h-5 w-5 accent-neon" checked={st.features[k] !== false} onChange={() => save({ features: { ...st.features, [k]: !(st.features[k] !== false) } }, `${st.features[k] !== false ? 'Desligou' : 'Ligou'} funcionalidade`, l)} /></label>
        ))}
        <label className="flex items-center justify-between border-t border-line pt-2"><span>Novos registos abertos</span><input type="checkbox" className="h-5 w-5 accent-neon" checked={st.signupsOpen} onChange={() => save({ signupsOpen: !st.signupsOpen }, 'Registos', String(!st.signupsOpen))} /></label>
      </div>
    </div>
  );
}

export function Policies() {
  const { a, upd, act } = useAdmin();
  const [slug, setSlug] = useState(POLICIES[0].slug);
  const p = POLICIES.find((x) => x.slug === slug)!;
  const [text, setText] = useState(a.policies[slug] ?? policyToText(p));
  const pick = (s: string) => { setSlug(s); const np = POLICIES.find((x) => x.slug === s)!; setText(a.policies[s] ?? policyToText(np)); };
  return (
    <div className="space-y-2">
      <select className="input w-full" value={slug} onChange={(e) => pick(e.target.value)}>{POLICIES.map((x) => <option key={x.slug} value={x.slug}>{x.emoji} {x.title}{a.policies[x.slug] ? ' (editada)' : ''}</option>)}</select>
      <p className="text-xs text-white/50">Formato: “## Título” para secções e linha em branco entre parágrafos. Publicado em /{slug}/</p>
      <textarea className="input min-h-[50vh] w-full font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex gap-2">
        <button className="btn flex-1" onClick={() => { upd({ policies: { ...a.policies, [slug]: text } }); act('Editou política', p.title, 'Política publicada'); }}>Publicar</button>
        <button className="btn-ghost flex-1" onClick={() => { const n = { ...a.policies }; delete n[slug]; upd({ policies: n }); setText(policyToText(p)); act('Repôs política original', p.title, 'Versão original reposta'); }}>Repor original</button>
      </div>
      {IS_DEMO && <p className="text-xs text-neon2">Demo: edições ficam só neste navegador. O texto público (Google Play) é o original até haver Supabase (tabela public.policies) ou um novo deploy.</p>}
    </div>
  );
}

export function Audit() {
  const { a } = useAdmin();
  const [q, setQ] = useState('');
  const list = a.audit.filter((x) => (x.action + x.target + x.actor).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-2">
      <input className="input w-full" placeholder="Filtrar ações" value={q} onChange={(e) => setQ(e.target.value)} />
      <p className="text-xs text-white/50">{list.length} registos · imutável na versão real (tabela audit_log só com INSERT).</p>
      {list.map((x) => (
        <div key={x.id} className="card !p-2 text-xs">
          <p><b>{x.action}</b> · {x.target}</p>
          <p className="text-white/50">{x.at} · {x.actor}</p>
        </div>
      ))}
    </div>
  );
}
