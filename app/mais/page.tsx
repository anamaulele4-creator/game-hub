'use client';

import Link from 'next/link';
import { Logo, Page } from '@/components/ui';

const ITEMS = [
  ['/idolos', '💜', 'Ídolos'], ['/escola', '🎓', 'Escola Free Fire'], ['/canais', '💬', 'Canais'], ['/loja', '🛍️', 'Loja'],
  ['/eventos', '🎟️', 'Eventos'], ['/planos', '👑', 'Planos'], ['/coach-ia', '🤖', 'Coach IA'], ['/missoes', '🎯', 'Missões'],
  ['/conquistas', '🏅', 'Conquistas'], ['/ranking', '📊', 'Ranking'], ['/desafios', '⚔️', 'Desafios'], ['/guardados', '🔖', 'Guardados'],
  ['/bem-estar', '🧘', 'Bem-estar'], ['/notificacoes', '🔔', 'Notificações'], ['/pesquisa', '🔍', 'Pesquisar'], ['/definicoes', '⚙️', 'Definições'],
  ['/admin', '🛠️', 'Admin'], ['/checkout', '🛒', 'Carrinho'],
];

export default function MaisPage() {
  return (
    <Page title="Mais">
      <div className="grid grid-cols-3 gap-3">
        {ITEMS.map(([h, e, l]) => <Link key={h} href={h} className="card flex flex-col items-center gap-1 !p-3 text-center text-xs"><span className="text-3xl">{e}</span>{l}</Link>)}
      </div>
      <div className="mt-8 flex flex-col items-center gap-2 text-center text-[11px] text-white/40"><Logo size={40} /><p>GAME HUB · versão de teste · feito em Moçambique 🇲🇿</p></div>
    </Page>
  );
}
