'use client';

import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Page } from '@/components/ui';
import { Skel } from '@/components/comp/Kit';

// Perfil público: /jogador?u=<handle>
const PublicProfile = dynamic(() => import('@/components/comp/Profile'), { ssr: false, loading: Skel });

function Inner() {
  const u = useSearchParams().get('u') ?? '';
  return u ? <PublicProfile key={u} handle={u} /> : <p className="card text-center text-sm">Jogador não indicado.</p>;
}

export default function JogadorPage() {
  return <Page><Suspense fallback={<Skel />}><Inner /></Suspense></Page>;
}
