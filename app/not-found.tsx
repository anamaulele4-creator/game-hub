'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

// No GitHub Pages, torneios criados depois do build (/torneios/<id>/) não têm HTML próprio: esta página abre-os.
// Endereços de secções que já não existem voltam ao Início.
const TournamentDetail = dynamic(() => import('./torneios/[id]/TournamentDetail'), { ssr: false });
const REMOVED = /^\/(clipe|clipes|lives|idolo|idolos|mensagens|videos|explorar|publicar|camera|canais|loja|checkout|eventos|planos|missoes|conquistas|desafios|escola|ranking|pesquisa|guardados|anuncios|monetizacao|coach-ia|poipak-ia|core|perfil\/editar)(\/|$)/;

export default function NotFound() {
  const router = useRouter();
  const [id, setId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const path = window.location.pathname.replace(process.env.NEXT_PUBLIC_BASE_PATH ?? '', '');
    if (REMOVED.test(path)) { router.replace('/'); return; }
    const r = path.match(/^\/torneios\/([^/]+)\/?$/);
    if (r) setId(decodeURIComponent(r[1]));
    setChecked(true);
  }, [router]);
  if (id) return <TournamentDetail id={id} />;
  if (!checked) return <main className="min-h-[70vh]" />;
  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-lg font-bold">Página não encontrada</p>
      <Link href="/" className="btn">Voltar ao Início</Link>
    </main>
  );
}
