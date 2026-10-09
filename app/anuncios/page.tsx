'use client';

import dynamic from 'next/dynamic';
import { Page } from '@/components/ui';

// Código do Gestor de Anúncios só é descarregado quando se abre esta página.
const AdsManager = dynamic(() => import('@/components/ads/AdsManager'), {
  ssr: false,
  loading: () => <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-24 rounded-card" />)}</div>,
});

export default function AnunciosPage() {
  return (
    <Page title="Gestor de Anúncios" back="/mais">
      <AdsManager />
    </Page>
  );
}
