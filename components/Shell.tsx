'use client';
// Moldura da app TXAPZONE (navegação adaptativa, visual escuro + laranja):
//  • telemóvel (< 768 px): barra inferior com 5 separadores (Início, Torneios, Recargas, Marketplace, Perfil);
//  • tablet (768–1023 px): trilho lateral só com ícones;
//  • desktop (≥ 1024 px): menu lateral com nomes.
// As larguras vêm das variáveis --nav-w / --col-w em app/globals.css.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useStore } from '@/lib/store';
import { IS_DEMO } from '@/lib/config';
import { isAuthRoute } from '@/lib/routes';
import { Icon, IconName } from './icons';
import { AvatarFace, TzLogo } from './ui';
import { CountBadge, useUnread } from './Unread';

/* ---------------- Rotas ---------------- */
export const MAIN_NAV: { href: string; label: string; icon: IconName }[] = [
  { href: '/', label: 'Início', icon: 'home' },
  { href: '/torneios', label: 'Torneios', icon: 'trophy' },
  { href: '/recargas', label: 'Recargas', icon: 'bolt' },
  { href: '/marketplace', label: 'Marketplace', icon: 'shop' },
  { href: '/perfil', label: 'Perfil', icon: 'user' },
];
// Rotas que pertencem a cada separador (para marcar o separador ativo)
const GROUPS: Record<string, string[]> = {
  '/': ['/', '/jogos'],
  '/torneios': ['/torneios', '/core'],
  '/recargas': ['/recargas'],
  '/marketplace': ['/marketplace', '/loja', '/checkout'],
  '/perfil': ['/perfil', '/planos', '/definicoes', '/seguranca', '/notificacoes', '/mais', '/admin', '/coach-ia', '/escola', '/baixar', '/instalar'],
};

function usePath() {
  return usePathname() || '/';
}
const starts = (p: string, h: string) => (h === '/' ? p === '/' : p === h || p.startsWith(h + '/'));
export const isTabActive = (p: string, tab: string) => (GROUPS[tab] ?? [tab]).some((h) => starts(p, h));
function useChrome() {
  const p = usePath();
  const { s } = useStore();
  const hidden = isAuthRoute(p) || (!IS_DEMO && !s.account.loggedIn);
  return { p, hidden };
}

/* ---------------- Barra inferior (telemóvel) ---------------- */
export function BottomNav() {
  const { p, hidden } = useChrome();
  const { s } = useStore();
  if (hidden) return null;
  return (
    <nav aria-label="Navegação principal" className="bottom-nav fixed bottom-0 left-0 right-0 z-40 flex justify-around border-t border-[#FFFFFF0F] bg-[#0E0F13]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
      {MAIN_NAV.map((t) => {
        const active = isTabActive(p, t.href);
        return (
          <Link key={t.href} href={t.href} aria-label={t.label} aria-current={active ? 'page' : undefined} className="nav-tab flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1">
            {t.href === '/perfil' ? (
              <span className={`flex h-[26px] w-[26px] items-center justify-center overflow-hidden rounded-full bg-brand text-[10px] text-white ${active ? 'ring-2 ring-[#FFC107]' : 'ring-1 ring-[#FFFFFF33]'}`}><AvatarFace a={s.user.avatar} name={s.user.name} fill /></span>
            ) : (
              <Icon name={t.icon} size={24} strokeWidth={active ? 2.3 : 1.8} className={active ? 'text-[#FFC107]' : 'text-[#FFFFFFB8]'} />
            )}
            <span className={`text-[10.5px] leading-none ${active ? 'font-semibold text-[#FFC107]' : 'text-[#FFFFFFB8]'}`}>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/* ---------------- Menu lateral (tablet/desktop) ---------------- */
export function SideNav() {
  const { p, hidden } = useChrome();
  const { s } = useStore();
  const { notifs } = useUnread();
  if (hidden) return null;
  const item = (href: string, label: string, icon: React.ReactNode, active: boolean, n = 0) => (
    <Link key={href} href={href} aria-current={active ? 'page' : undefined} title={label}
      className={`side-link group relative flex min-h-[48px] items-center gap-3.5 rounded-[10px] px-3 transition-colors lg:px-3.5 ${active ? 'bg-[#16181F] text-white' : 'text-[#FFFFFFB8] hover:bg-[#16181F]/70 hover:text-white'}`}>
      <span className="relative flex h-7 w-7 items-center justify-center">{icon}<CountBadge n={n} /></span>
      <span className={`hidden truncate text-[15px] lg:block ${active ? 'font-semibold' : 'font-medium'}`}>{label}</span>
      {active && <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r bg-[#FFC107]" aria-hidden />}
    </Link>
  );
  const ic = (name: IconName, active: boolean) => <Icon name={name} size={24} strokeWidth={active ? 2.3 : 1.8} className={active ? 'text-[#FFC107]' : ''} />;
  return (
    <nav id="side-nav" aria-label="Navegação principal" className="fixed inset-y-0 left-0 z-40 hidden w-[var(--nav-w)] flex-col border-r border-[#FFFFFF0F] bg-[#0B0C10] px-2.5 pb-4 pt-4 md:flex lg:px-4">
      <Link href="/" className="mb-5 flex min-h-[48px] items-center justify-center lg:justify-start lg:px-2" aria-label="TXAPZONE — Início">
        <span className="lg:hidden"><TzLogo compact /></span>
        <span className="hidden lg:block"><TzLogo /></span>
      </Link>
      <div className="flex flex-1 flex-col gap-1 overflow-y-auto no-scrollbar">
        {MAIN_NAV.filter((n) => n.href !== '/perfil').map((n) => item(n.href, n.label, ic(n.icon, isTabActive(p, n.href)), isTabActive(p, n.href)))}
        {item('/notificacoes', 'Notificações', ic('bell', starts(p, '/notificacoes')), starts(p, '/notificacoes'), notifs)}
        {item('/perfil', 'Perfil', <span className={`flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-brand text-[11px] text-white ${starts(p, '/perfil') ? 'ring-2 ring-[#FFC107]' : 'ring-1 ring-[#FFFFFF33]'}`}><AvatarFace a={s.user.avatar} name={s.user.name} fill /></span>, starts(p, '/perfil'))}
      </div>
      <div className="mt-3 flex flex-col gap-1 border-t border-[#FFFFFF0F] pt-3">
        {item('/mais', 'Mais', ic('menu', starts(p, '/mais')), starts(p, '/mais'))}
        {item('/definicoes', 'Definições', ic('settings', starts(p, '/definicoes')), starts(p, '/definicoes'))}
      </div>
    </nav>
  );
}
