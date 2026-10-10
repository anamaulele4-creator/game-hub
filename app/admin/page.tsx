'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Page } from '@/components/ui';
import { IS_DEMO } from '@/lib/config';

// Cada secção do painel é um ficheiro JS separado, descarregado só quando é aberta.
const L = () => <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="card h-20 animate-pulse" />)}</div>;
const SECTIONS = {
  Painel: dynamic(() => import('@/components/admin/Dashboard'), { ssr: false, loading: L }),
  Utilizadores: dynamic(() => import('@/components/admin/Users'), { ssr: false, loading: L }),
  Torneios: dynamic(() => import('@/components/admin/Tournaments'), { ssr: false, loading: L }),
  Apostas: dynamic(() => import('@/components/admin/BetsAdmin'), { ssr: false, loading: L }),
  Marketplace: dynamic(() => import('@/components/admin/MarketAdmin'), { ssr: false, loading: L }),
  'Risco & Fraude': dynamic(() => import('@/components/admin/Risk').then((m) => m.RiskQueue), { ssr: false, loading: L }),
  KYC: dynamic(() => import('@/components/admin/Risk').then((m) => m.KycReview), { ssr: false, loading: L }),
  Notificações: dynamic(() => import('@/components/admin/Broadcast'), { ssr: false, loading: L }),
  Definições: dynamic(() => import('@/components/admin/Settings').then((m) => m.PlatformSettingsPanel), { ssr: false, loading: L }),
  Políticas: dynamic(() => import('@/components/admin/Settings').then((m) => m.Policies), { ssr: false, loading: L }),
  Auditoria: dynamic(() => import('@/components/admin/Settings').then((m) => m.Audit), { ssr: false, loading: L }),
} as const;
type Key = keyof typeof SECTIONS;

export default function AdminPage() {
  const { s, ready, syncError } = useStore();
  const [k, setK] = useState<Key>('Painel');
  const C = SECTIONS[k];
  if (ready && s.user.role !== 'admin') return <Page title="Admin"><p className="card text-center">Sem acesso.</p></Page>;
  return (
    <Page title="Painel Admin" back="/perfil">
      {!IS_DEMO && syncError && <p className="mb-3 rounded-lg bg-pink/20 p-2 text-xs">Base de dados: {syncError}. Se acabaste de criar o projeto, corre supabase/schema.sql no SQL Editor.</p>}
      {IS_DEMO && <p className="mb-3 rounded-lg border border-neon/40 bg-neon/10 p-2 text-center text-xs text-neon2">Modo demo: dados simulados, alterações guardadas só neste navegador. Todas as ações ficam no registo de auditoria.</p>}
      <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
        {(Object.keys(SECTIONS) as Key[]).map((x) => (
          <button key={x} type="button" onClick={() => setK(x)} className={`min-h-[44px] shrink-0 rounded-full px-3.5 text-sm ${k === x ? 'bg-neon font-semibold text-ink' : 'bg-panel2 text-white/70'}`}>
            {x}
          </button>
        ))}
      </div>
      <C />
    </Page>
  );
}
