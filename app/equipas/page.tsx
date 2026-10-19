'use client';

import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Page } from '@/components/ui';
import { Skel } from '@/components/comp/Kit';

const TeamsArea = dynamic(() => import('@/components/comp/Teams'), { ssr: false, loading: Skel });

function Inner() {
  const q = useSearchParams();
  return <TeamsArea initialCreate={q.get('criar') === '1'} />;
}

export default function EquipasPage() {
  return <Page><Suspense fallback={<Skel />}><Inner /></Suspense></Page>;
}
