'use client';

import dynamic from 'next/dynamic';
import { Page } from '@/components/ui';
import { Skel } from '@/components/comp/Kit';

// Ranking de equipas (Elo calculado no servidor a partir de desafios concluídos).
const TeamsArea = dynamic(() => import('@/components/comp/Teams'), { ssr: false, loading: Skel });

export default function RankingPage() {
  return <Page><TeamsArea rankingOnly /></Page>;
}
