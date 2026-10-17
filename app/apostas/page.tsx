'use client';

import dynamic from 'next/dynamic';
import { Page } from '@/components/ui';

const BetsArea = dynamic(() => import('@/components/bets/Bets'), {
  ssr: false,
  loading: () => <div className="space-y-3">{[0, 1, 2].map((k) => <div key={k} className="h-28 animate-pulse rounded-xl bg-[#232326]" />)}</div>,
});

export default function ApostasPage() {
  return (
    <Page>
      <BetsArea theme="tx" />
    </Page>
  );
}