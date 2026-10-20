'use client';

import dynamic from 'next/dynamic';
import { Page } from '@/components/ui';
import { Skel } from '@/components/comp/Kit';

const AffiliatePanel = dynamic(() => import('@/components/affiliates/Panel'), { ssr: false, loading: Skel });

export default function AfiliadosPage() {
  return <Page title="Painel de afiliado" back="/perfil"><AffiliatePanel /></Page>;
}
