'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Secção removida: leva para o Início sem deixar o endereço antigo no histórico. */
export function RedirectHome() {
  const router = useRouter();
  useEffect(() => { router.replace('/'); }, [router]);
  return <main className="min-h-[70vh]" aria-busy="true" />;
}
