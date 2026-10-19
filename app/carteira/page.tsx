'use client';

import dynamic from 'next/dynamic';
import { Page } from '@/components/ui';
import { Skel } from '@/components/comp/Kit';

const WalletArea = dynamic(() => import('@/components/comp/Wallet'), { ssr: false, loading: Skel });

export default function CarteiraPage() {
  return <Page title="A minha carteira"><WalletArea /></Page>;
}
