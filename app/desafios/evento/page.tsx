'use client';

import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Page } from '@/components/ui';
import { Skel } from '@/components/comp/Kit';

// Página pública do evento: /desafios/evento?id=<uuid> (equipas, jogo, data, estado, regras, estatísticas, resultado, previsões grátis).
const EventPage = dynamic(() => import('@/components/comp/Challenges').then((m) => m.EventPage), { ssr: false, loading: Skel });

function Inner() {
  const id = useSearchParams().get('id') ?? '';
  return id ? <EventPage key={id} id={id} /> : <p className="card text-center text-sm">Desafio não indicado.</p>;
}

export default function EventoPage() {
  return <Page back="/desafios"><Suspense fallback={<Skel />}><Inner /></Suspense></Page>;
}
