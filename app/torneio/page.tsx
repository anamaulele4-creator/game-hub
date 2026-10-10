'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import TournamentDetail from '../torneios/[id]/TournamentDetail';

// Torneios criados depois do build não têm HTML próprio no GitHub Pages.
// Abri-los por /torneio/?id=<id> mantém a navegação dentro da app, sem recarregar a página.
function Inner() {
  const id = useSearchParams().get('id') ?? '';
  if (!id) return <main className="min-h-[70vh]" />;
  return <TournamentDetail key={id} id={id} />;
}

export default function Page() {
  return <Suspense fallback={<main className="min-h-[70vh]" />}><Inner /></Suspense>;
}
