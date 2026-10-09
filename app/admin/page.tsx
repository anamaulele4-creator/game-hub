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
  Moderação: dynamic(() => import('@/components/admin/Moderation'), { ssr: false, loading: L }),
  Torneios: dynamic(() => import('@/components/admin/Operations').then((m) => m.Tournaments), { ssr: false, loading: L }),
  Lives: dynamic(() => import('@/components/admin/Operations').then((m) => m.Lives), { ssr: false, loading: L }),
  'Loja e encomendas': dynamic(() => import('@/components/admin/Operations').then((m) => m.Shop), { ssr: false, loading: L }),
  'Eventos e bilhetes': dynamic(() => import('@/components/admin/Operations').then((m) => m.Events), { ssr: false, loading: L }),
  'Planos e preços': dynamic(() => import('@/components/admin/Money').then((m) => m.Plans), { ssr: false, loading: L }),
  'Moedas e presentes': dynamic(() => import('@/components/admin/Money').then((m) => m.Coins), { ssr: false, loading: L }),
  'Pagamentos e comissões': dynamic(() => import('@/components/admin/Money').then((m) => m.Payouts), { ssr: false, loading: L }),
  'Risco & Fraude': dynamic(() => import('@/components/admin/Risk').then((m) => m.RiskQueue), { ssr: false, loading: L }),
  KYC: dynamic(() => import('@/components/admin/Risk').then((m) => m.KycReview), { ssr: false, loading: L }),
  Monetização: dynamic(() => import('@/components/admin/Risk').then((m) => m.Creators), { ssr: false, loading: L }),
  Notificações: dynamic(() => import('@/components/admin/Broadcast'), { ssr: false, loading: L }),
  Anúncios: dynamic(() => import('@/components/admin/AdsAdmin'), { ssr: false, loading: L }),
  IA: dynamic(() => import('@/components/admin/AiAdmin'), { ssr: false, loading: L }),
  'TXAPILOG IA': dynamic(() => import('@/components/admin/PoipakAdmin'), { ssr: false, loading: L }),
  'IA do sistema': dynamic(() => import('@/components/admin/SystemAdmin'), { ssr: false, loading: L }),
  Definições: dynamic(() => import('@/components/admin/Settings').then((m) => m.PlatformSettingsPanel), { ssr: false, loading: L }),
  Políticas: dynamic(() => import('@/components/admin/Settings').then((m) => m.Policies), { ssr: false, loading: L }),
  Auditoria: dynamic(() => import('@/components/admin/Settings').then((m) => m.Audit), { ssr: false, loading: L }),
} as const;
type Key = keyof typeof SECTIONS;
const ICONS: Record<Key, string> = {
  Painel: '📊', Utilizadores: '👥', Moderação: '🛡️', Torneios: '🏆', Lives: '📡', 'Loja e encomendas': '🛍️', 'Eventos e bilhetes': '🎟️',
  'Planos e preços': '👑', 'Moedas e presentes': '🪙', 'Pagamentos e comissões': '💸', 'Risco & Fraude': '🚨', KYC: '🪪', Monetização: '💰', Notificações: '📣', Anúncios: '📢', IA: '🤖', 'TXAPILOG IA': '🩺', 'IA do sistema': '🛠️', Definições: '⚙️', Políticas: '📜', Auditoria: '🧾',
};

export default function AdminPage() {
  const { s, ready, syncError } = useStore();
  const [k, setK] = useState<Key>('Painel');
  const C = SECTIONS[k];
  const openReports = s.admin.reports.filter((r) => r.status === 'aberta').length;
  const pendingAds = s.adsMgr.ads.filter((a) => a.review === 'pendente').length;
  if (ready && s.user.role !== 'admin') return <Page title="Admin"><p className="card text-center">Sem acesso.</p></Page>;
  return (
    <Page title="Painel Admin" back="/perfil">
      {!IS_DEMO && syncError && <p className="mb-3 rounded-lg bg-pink/20 p-2 text-xs">⚠️ Base de dados: {syncError}. Se acabaste de criar o projeto, corre supabase/schema.sql no SQL Editor.</p>}
      {IS_DEMO && <p className="mb-3 rounded-lg border border-neon/40 bg-neon/10 p-2 text-center text-xs text-neon2">Modo demo: dados simulados, alterações guardadas só neste navegador. Todas as ações ficam no registo de auditoria.</p>}
      <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
        {(Object.keys(SECTIONS) as Key[]).map((x) => {
          const badge = x === 'Moderação' ? openReports : x === 'Anúncios' ? pendingAds : 0;
          return (
            <button key={x} onClick={() => setK(x)} className={`relative shrink-0 rounded-full px-3 py-1.5 text-sm ${k === x ? 'bg-neon text-white' : 'bg-panel2 text-white/70'}`}>
              {ICONS[x]} {x}{badge > 0 && <span className="ml-1 rounded-full bg-pink px-1.5 text-[11px] font-bold">{badge}</span>}
            </button>
          );
        })}
      </div>
      <C />
    </Page>
  );
}
