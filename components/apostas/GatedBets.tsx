'use client';

// Interruptor global (app_settings.apostas_enabled, desligado por omissão): enquanto estiver desligado, nenhuma
// área de apostas aparece — nem as Apostas v2 nem as clássicas (TXAP Pontos). O servidor também recusa.
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { getAppSetting } from '@/lib/appSettings';
import { apostasV2Api } from '@/lib/apostasV2Api';
import { IS_DEMO } from '@/lib/config';
import { ApostasDesativadas } from './ApostasV2';
import type { BetGame } from '@/lib/bets';

const Sk = () => <div className="space-y-3">{[0, 1].map((k) => <div key={k} className="h-28 animate-pulse rounded-xl bg-[#232326]" />)}</div>;
const BetsArea = dynamic(() => import('@/components/bets/Bets'), { ssr: false, loading: Sk });

export function useApostasEnabled(): { enabled: boolean; installed: boolean } | null {
  const [st, setSt] = useState<{ enabled: boolean; installed: boolean } | null>(null);
  useEffect(() => {
    if (IS_DEMO) { void apostasV2Api.me().then((m) => setSt({ enabled: m.enabled, installed: true })); return; }
    void getAppSetting<boolean>('apostas_enabled').then((r) => setSt({ enabled: r.value === true, installed: r.installed }));
  }, []);
  return st;
}

/** Área clássica (TXAP Pontos) só com o interruptor ligado. */
export default function GatedBets({ game, theme = 'tx' }: { game?: BetGame; theme?: 'tx' | 'tz' }) {
  const st = useApostasEnabled();
  if (!st) return <Sk />;
  if (!st.enabled) return <ApostasDesativadas installed={st.installed} />;
  return <BetsArea game={game} theme={theme} />;
}
