'use client';

import dynamic from 'next/dynamic';
import { Page } from '@/components/ui';

// Apostas com TXAP Pontos (sem dinheiro real). O componente é carregado à parte para não pesar no resto da app.
const BetsArea = dynamic(() => import('@/components/bets/Bets'), {
  ssr: false,
  loading: () => <div className="space-y-3">{[0, 1, 2].map((k) => <div key={k} className="card h-28 animate-pulse" />)}</div>,
});

export default function ApostasPage() {
  return (
    <Page title="Apostas" back="/explorar">
      <BetsArea theme="tx" />
    </Page>
  );
}
