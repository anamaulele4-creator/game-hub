'use client';

import dynamic from 'next/dynamic';
import { Page } from '@/components/ui';

const Sk = () => <div className="space-y-3">{[0, 1, 2].map((k) => <div key={k} className="h-28 animate-pulse rounded-xl bg-[#232326]" />)}</div>;
const BetsArea = dynamic(() => import('@/components/bets/Bets'), { ssr: false, loading: Sk });

// /apostas: só dinheiro real (MT). Controlado pelo interruptor de Admin › Apostas › Dinheiro real (desligado por omissão).
// Desligado → "Apostas em dinheiro real disponíveis em breve." (sem alternativa de teste).
export default function ApostasPage() {
  return (
    <Page>
      <BetsArea theme="tx" />
    </Page>
  );
}
