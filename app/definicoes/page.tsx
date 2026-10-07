'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Page } from '@/components/ui';

const AVATARS = ['🦄', '🦊', '🐉', '🌙', '⚡', '🎮', '👾', '🦋'];

export default function DefinicoesPage() {
  const { s, set, reset, toast } = useStore();
  const [name, setName] = useState(s.user.name);
  const [prefs, setPrefs] = useState({ lives: true, social: true, torneios: true, email: false, autoplay: true, dataSaver: false });
  const toggle = (k: keyof typeof prefs) => setPrefs((p) => ({ ...p, [k]: !p[k] }));
  return (
    <Page title="Definições" back="/perfil">
      <div className="card mb-3 space-y-3">
        <p className="font-semibold">Conta</p>
        <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex flex-wrap gap-2">{AVATARS.map((a) => <button key={a} onClick={() => set((p) => ({ ...p, user: { ...p.user, avatar: a } }))} className={`rounded-full p-2 text-2xl ${s.user.avatar === a ? 'bg-neon' : 'bg-panel2'}`}>{a}</button>)}</div>
        <button className="btn w-full" onClick={() => { set((p) => ({ ...p, user: { ...p.user, name } })); toast('Guardado'); }}>Guardar</button>
      </div>
      <div className="card mb-3 space-y-3">
        <p className="font-semibold">Notificações e reprodução</p>
        {([['lives', 'Ídolos em direto'], ['social', 'Comentários e respostas'], ['torneios', 'Torneios'], ['email', 'Resumo por email'], ['autoplay', 'Reprodução automática de clipes'], ['dataSaver', 'Poupança de dados móveis']] as const).map(([k, l]) => (
          <label key={k} className="flex items-center justify-between text-sm"><span>{l}</span><input type="checkbox" className="h-5 w-5 accent-fuchsia-500" checked={prefs[k]} onChange={() => toggle(k)} /></label>
        ))}
        <Link href="/bem-estar" className="block text-sm text-neon2">🌙 Silêncio noturno e limites → Bem-estar</Link>
      </div>
      <div className="card mb-3 space-y-2 text-sm">
        <p className="font-semibold">Privacidade e segurança</p>
        <p className="text-white/70">Perfil público · Mensagens apenas de quem segues · Denúncias revistas em 24 h.</p>
        <p className="text-white/70">Idade mínima: 13 anos. Compras de menores exigem autorização de encarregado (versão real).</p>
      </div>
      <div className="card space-y-2 text-sm">
        <p className="font-semibold">Demonstração</p>
        <p className="text-white/70">Todos os dados ficam guardados apenas neste navegador (localStorage). Nenhum pagamento é real.</p>
        <button className="btn-ghost w-full" onClick={reset}>Repor dados de demonstração</button>
      </div>
    </Page>
  );
}
