'use client';

import Link from 'next/link';
import { Page } from '@/components/ui';
import { useStore } from '@/lib/store';
import { LegalFooter } from '@/components/LegalFooter';
import { Icon, IconName } from '@/components/Icons';

const ITEMS: [string, IconName, string][] = [
  ['/jogos', 'gamepad', 'Jogos & Torneios'], ['/torneios', 'trophy', 'Torneios'], ['/apostas', 'chart', 'Apostas'], ['/marketplace', 'star', 'Marketplace'],
  ['/perfil', 'user', 'Perfil'], ['/notificacoes', 'bell', 'Notificações'], ['/definicoes', 'settings', 'Definições'], ['/seguranca', 'shield', 'Segurança'],
  ['/bem-estar', 'heart', 'Jogo responsável'], ['/baixar', 'play', 'Baixar o app'], ['/legal', 'bookmark', 'Legal'],
];

export default function MaisPage() {
  const { s } = useStore();
  const items: [string, IconName, string][] = s.user.role === 'admin' ? [...ITEMS, ['/admin', 'shield', 'Admin']] : ITEMS;
  return (
    <Page title="Mais">
      <ul className="card divide-y divide-line !p-0">
        {items.map(([h, i, l]) => (
          <li key={h}>
            <Link href={h} className="flex min-h-[52px] items-center gap-3 px-4 text-[15px]">
              <span className="text-white/70"><Icon name={i} size={20} /></span>
              <span className="flex-1">{l}</span>
              <span className="text-white/40" aria-hidden>›</span>
            </Link>
          </li>
        ))}
      </ul>
      <LegalFooter />
    </Page>
  );
}
