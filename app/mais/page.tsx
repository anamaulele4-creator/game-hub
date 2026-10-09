'use client';

import Link from 'next/link';
import { Logo, Page } from '@/components/ui';
import { useStore } from '@/lib/store';
import { LegalFooter } from '@/components/LegalFooter';

const ITEMS: [string, string, string, string?][] = [
  ['/jogos', '🎮', 'Jogos & Torneios'], ['/idolos', '💜', 'Ídolos'], ['/escola', '🎓', 'Escola Free Fire'], ['/canais', '💬', 'Canais', 'canais'], ['/loja', '🛍️', 'Loja', 'loja'],
  ['/eventos', '🎟️', 'Eventos', 'eventos'], ['/planos', '👑', 'Planos'], ['/coach-ia', '🤖', 'Coach IA', 'coach'], ['/missoes', '🎯', 'Missões'],
  ['/conquistas', '🏅', 'Conquistas'], ['/ranking', '📊', 'Ranking'], ['/desafios', '⚔️', 'Desafios', 'desafios'], ['/guardados', '🔖', 'Guardados'],
  ['/anuncios', '📢', 'Anunciar', 'anuncios'], ['/bem-estar', '🧘', 'Bem-estar'], ['/poipak-ia', '🩺', 'TXAPILOG IA'], ['/notificacoes', '🔔', 'Notificações'], ['/mensagens', '💬', 'Mensagens'], ['/seguranca', '🔐', 'Segurança'], ['/pesquisa', '🔍', 'Pesquisar'],
  ['/definicoes', '⚙️', 'Definições'], ['/baixar', '📲', 'Baixar o app'], ['/monetizacao', '💰', 'Monetização'], ['/entrar', '🔑', 'Entrar / Registar'], ['/legal', '📜', 'Legal'],
  ['/admin', '🛠️', 'Admin'], ['/core', '🧠', 'AI CORE'], ['/checkout', '🛒', 'Carrinho'],
];

export default function MaisPage() {
  const { s, feature } = useStore();
  const items = ITEMS.filter(([h, , , f]) => (!f || feature(f)) && ((h !== '/admin' && h !== '/core') || s.user.role === 'admin'));
  return (
    <Page title="Mais">
      <div className="grid grid-cols-3 gap-3">
        {items.map(([h, e, l]) => <Link key={h} href={h} className="card flex flex-col items-center gap-1 !p-3 text-center text-xs"><span className="text-3xl">{e}</span>{l}</Link>)}
      </div>
      <div className="mt-8 flex flex-col items-center gap-2 text-center text-xs text-white/40"><Logo size={40} /><p>TXAPILOG · feito em Moçambique 🇲🇿</p></div>
      <LegalFooter />
    </Page>
  );
}
