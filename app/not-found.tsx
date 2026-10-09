'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';

// "404 inteligente": no GitHub Pages, torneios criados depois do build (/torneios/<uuid>/) não têm HTML próprio.
// O servidor devolve esta página e ela abre o ecrã certo no navegador a partir do endereço.
const TournamentDetail = dynamic(() => import('./torneios/[id]/TournamentDetail'), { ssr: false });
// Secções da antiga rede social (removidas): quem chega por um link antigo vê um aviso e volta ao Início.
const LEGACY = /^\/(clipes?|publicar|camera|explorar|idolos?|mensagens|canais|guardados|desafios|lives|poipak-ia|pesquisa|videos|monetizacao|bem-estar|conquistas|missoes|ranking|eventos|planos|anuncios)(\/|$)/;

export default function NotFound() {
  const [id, setId] = useState<string | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
    const path = window.location.pathname.replace(base, '');
    const r = path.match(/^\/torneios\/([^/]+)\/?$/);
    if (r) setId(decodeURIComponent(r[1]));
    else if (LEGACY.test(path)) setLegacy(true);
    setChecked(true);
  }, []);
  if (id) return <TournamentDetail id={id} />;
  if (!checked) return <main className="min-h-[70vh]" />;
  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <Icon name={legacy ? 'gamepad' : 'search'} size={52} strokeWidth={1.5} className="text-[#FFC107]" />
      <p className="text-lg font-bold">{legacy ? 'Esta secção já não existe' : 'Página não encontrada'}</p>
      {legacy && <p className="max-w-sm text-sm text-white/70">A TXAPZONE agora é só jogos: torneios, recargas e marketplace.</p>}
      <Link href="/" className="btn">Voltar ao Início</Link>
    </main>
  );
}
