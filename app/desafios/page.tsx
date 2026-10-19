'use client';

import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Page } from '@/components/ui';
import { Skel } from '@/components/comp/Kit';

const ChallengesArea = dynamic(() => import('@/components/comp/Challenges'), { ssr: false, loading: Skel });

function Inner() {
  const q = useSearchParams();
  return <ChallengesArea initial={{ f: q.get('f'), criar: q.get('criar') === '1', equipa: q.get('equipa'), adversario: q.get('adversario') }} />;
}

export default function DesafiosPage() {
  return <Page><Suspense fallback={<Skel />}><Inner /></Suspense></Page>;
}
