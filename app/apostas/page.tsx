'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { Page } from '@/components/ui';
import { useApostasEnabled } from '@/components/apostas/GatedBets';
import { ApostasDesativadas } from '@/components/apostas/ApostasV2';

const Sk = () => <div className="space-y-3">{[0, 1, 2].map((k) => <div key={k} className="h-28 animate-pulse rounded-xl bg-[#232326]" />)}</div>;
// v3 (confrontos) — se o SQL v3 ainda não estiver instalado, mostra automaticamente as Apostas v2.
const ApostasHub = dynamic(() => import('@/components/apostas/ApostasV3'), { ssr: false, loading: Sk });
const BetsArea = dynamic(() => import('@/components/bets/Bets'), { ssr: false, loading: Sk });

// /apostas: controlado pelo interruptor global de Admin › Apostas (desligado por omissão).
export default function ApostasPage() {
  const st = useApostasEnabled();
  const [mode, setMode] = useState<'v2' | 'classicas'>('v2');
  return (
    <Page>
      {!st ? <Sk /> : !st.enabled ? <ApostasDesativadas installed={st.installed} /> : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-1 rounded-2xl border border-white/10 p-1" role="radiogroup" aria-label="Tipo de apostas">
            {([['v2', 'Confrontos'], ['classicas', 'TXAP Pontos (múltiplas)']] as const).map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)} className={`min-h-[44px] rounded-xl text-[14px] font-bold ${mode === k ? 'bg-[#FFC20E] text-[#0B1B4D]' : 'text-white/75'}`}>{l}</button>
            ))}
          </div>
          {mode === 'v2' ? <ApostasHub /> : <BetsArea theme="tx" />}
        </>
      )}
    </Page>
  );
}
