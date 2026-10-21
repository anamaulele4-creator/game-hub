'use client';

// Fila única de KYC para revisores com a permissão KYC_REVIEW (que não são admin). O admin usa Admin › KYC.
// O acesso é verificado de novo no servidor em cada chamada (kyc__can_review).
import dynamic from 'next/dynamic';
import { Page } from '@/components/ui';

const KycAdmin = dynamic(() => import('@/components/admin/Kyc'), { ssr: false, loading: () => <div className="card h-20 animate-pulse" /> });

export default function KycReviewPage() {
  return <Page title="Verificações (KYC)" back="/perfil"><KycAdmin /></Page>;
}
