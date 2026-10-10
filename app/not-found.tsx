'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useState } from 'react';

// "404 inteligente": no GitHub Pages, conteúdos criados depois do build (ex.: /clipe/<uuid>/) não têm HTML próprio.
// O servidor devolve esta página e ela abre o ecrã certo no navegador a partir do endereço.
const views = {
  clipe: dynamic(() => import('./clipe/[id]/ClipDetail'), { ssr: false }),
  lives: dynamic(() => import('./lives/[id]/LiveRoom'), { ssr: false }),
  torneios: dynamic(() => import('./torneios/[id]/TournamentDetail'), { ssr: false }),
  idolo: dynamic(() => import('./idolo/[id]/IdolProfile'), { ssr: false }),
};

export default function NotFound() {
  const [m, setM] = useState<{ kind: keyof typeof views; id: string } | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
    const path = window.location.pathname.replace(base, '');
    const r = path.match(/^\/(clipe|lives|torneios|idolo)\/([^/]+)\/?$/);
    if (r) setM({ kind: r[1] as keyof typeof views, id: decodeURIComponent(r[2]) });
    setChecked(true);
  }, []);
  if (m) { const V = views[m.kind]; return <V id={m.id} />; }
  if (!checked) return <main className="min-h-[70vh]" />;
  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-6xl">👾</p><p className="text-lg font-bold">Página não encontrada</p>
      <Link href="/" className="btn">Voltar ao Início</Link>
    </main>
  );
}
