'use client';

import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Page } from '@/components/ui';
import { Skel } from '@/components/comp/Kit';

// Página de equipa por parâmetro (?id=…): o site é estático (GitHub Pages), equipas novas não têm HTML próprio.
const TeamDetail = dynamic(() => import('@/components/comp/Teams').then((m) => m.TeamDetail), { ssr: false, loading: Skel });

function Inner() {
  const id = useSearchParams().get('id') ?? '';
  return id ? <TeamDetail key={id} id={id} /> : <p className="card text-center text-sm">Equipa não indicada.</p>;
}

export default function EquipaPage() {
  return <Page back="/equipas"><Suspense fallback={<Skel />}><Inner /></Suspense></Page>;
}
