'use client';

import Link from 'next/link';
import { Page, TzLogo } from '@/components/ui';
import { Icon, IconName } from '@/components/icons';
import { useStore } from '@/lib/store';
import { LegalFooter } from '@/components/LegalFooter';

const ITEMS: [string, IconName, string, string?][] = [
  ['/', 'home', 'Início'], ['/torneios', 'trophy', 'Torneios'], ['/recargas', 'bolt', 'Recargas'], ['/marketplace', 'shop', 'Marketplace'],
  ['/loja', 'store', 'Loja', 'loja'], ['/checkout', 'cart', 'Carrinho'], ['/notificacoes', 'bell', 'Notificações'], ['/perfil', 'user', 'Perfil'],
  ['/coach-ia', 'bot', 'Coach IA', 'coach'], ['/escola', 'cap', 'Escola Free Fire'], ['/seguranca', 'lock', 'Segurança'], ['/definicoes', 'settings', 'Definições'],
  ['/baixar', 'download', 'Baixar o app'], ['/legal', 'doc', 'Legal'], ['/admin', 'tool', 'Admin'], ['/core', 'cpu', 'AI CORE'],
];

export default function MaisPage() {
  const { s, feature } = useStore();
  const items = ITEMS.filter(([h, , , f]) => (!f || feature(f)) && ((h !== '/admin' && h !== '/core') || s.user.role === 'admin'));
  return (
    <Page title="Mais">
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {items.map(([h, e, l]) => <Link key={h} href={h} className="card card-hover flex flex-col items-center gap-1 !p-3 text-center text-xs"><Icon name={e} size={28} className="text-[#FFC107]" />{l}</Link>)}
      </div>
      <div className="mt-8 flex flex-col items-center gap-2 text-center text-xs text-white/40"><TzLogo /><p>TXAPZONE by TXAPILOG · feito em Moçambique</p></div>
      <LegalFooter />
    </Page>
  );
}
