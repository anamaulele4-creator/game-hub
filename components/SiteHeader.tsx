'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { IS_DEMO } from '@/lib/config';
import { isAuthRoute } from '@/lib/routes';
import { Icon } from '@/components/Icons';
import { BrandMark, BASE } from '@/components/ui';
import { openSearch } from '@/lib/search';
import { useCreatorPanel } from '@/lib/mkt3Api';
import { useWalletBalance } from '@/lib/useWalletBalance';

const MENU = [
  { href: '/', label: 'Início' },
  { href: '/jogos', label: 'Jogos' },
  { href: '/torneios', label: 'Torneios' },
  { href: '/desafios', label: 'Desafios' },
  { href: '/apostas', label: 'Apostas' },
  { href: '/marketplace', label: 'Marketplace' },
];
const isOn = (p: string, h: string) => (h === '/' ? p === '/' : p.startsWith(h));

export function SiteHeader() {
  const { s, ready } = useStore();
  const path = usePathname() || '/';
  const p = path.replace(BASE, '') || '/';
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const logged = mounted && (IS_DEMO || (ready && s.account.loggedIn));
  const unread = mounted && ready ? (s.notifs ?? []).filter((n) => !n.read).length : 0;
  const [dd, setDd] = useState(false);
  const [wd, setWd] = useState(false);
  const creator = useCreatorPanel();
  const balance = useWalletBalance(!!logged);
  useEffect(() => { setDd(false); setWd(false); }, [path]);
  if (isAuthRoute(path)) return null;

  return (
    <header className="bmx sticky top-0 z-50 bg-transparent pt-[env(safe-area-inset-top)] lg:fixed lg:inset-x-0">
      {/* Linha 1 */}
      <div className="flex h-12 items-center gap-3 px-3 lg:px-6">
        <Link href="/" aria-label="TXAPILOG — Início" className="flex shrink-0 items-center lg:pr-6">
          <span className="lg:hidden"><BrandMark height={26} /></span>
          <span className="hidden lg:block"><BrandMark height={28} /></span>
        </Link>

        <button type="button" onClick={openSearch} aria-label="Pesquisar"
          className="hidden h-9 w-[340px] items-center gap-2.5 rounded-[10px] bg-white/5 px-3.5 text-left text-[14px] text-white/55 hover:bg-white/10 lg:flex">
          <Icon name="search" size={20} /><span>Pesquisar</span>
        </button>

        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={openSearch} aria-label="Pesquisar" className="flex h-11 w-11 items-center justify-center rounded-xl text-white lg:hidden"><Icon name="search" /></button>

         

          {logged ? (
            <>
              {/* Saldo + Depositar / Levantar */}
              <div className="relative">
                <button type="button" onClick={() => setWd((v) => !v)} aria-haspopup="menu" aria-expanded={wd}
                  className="flex h-9 items-center gap-2 rounded-[10px] bg-white/5 px-3.5 text-[14px] font-bold text-white hover:bg-white/10">
                  <span>{balance === null ? '…' : `${balance.toLocaleString('pt-PT')} MT`}</span>
                  <span aria-hidden className="text-[10px]">▼</span>
                </button>
                {wd && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setWd(false)} aria-hidden />
                    <div role="menu" className="absolute right-0 top-11 z-50 w-48 overflow-hidden rounded-xl bg-[#141D4A] py-1 shadow-xl">
                      <Link role="menuitem" href="/carteira/?acao=depositar" onClick={() => setWd(false)} className="flex min-h-[44px] items-center px-4 hover:bg-white/10">Depositar</Link>
                      <Link role="menuitem" href="/carteira/?acao=levantar" onClick={() => setWd(false)} className="flex min-h-[44px] items-center px-4 hover:bg-white/10">Levantar</Link>
                    </div>
                  </>
                )}
              </div>

              {/* Perfil */}
              <div className="relative">
                <button type="button" onClick={() => setDd((v) => !v)} aria-haspopup="menu" aria-expanded={dd}
                  className="flex h-9 items-center gap-2 rounded-[10px] bg-white/5 px-3.5 text-[14px] font-bold text-white hover:bg-white/10">
                  <Icon name="user" size={20} /><span className="hidden sm:inline">Perfil</span><span aria-hidden className="text-[10px]">▼</span>
                </button>
                {dd && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setDd(false)} aria-hidden />
                    <div role="menu" className="absolute right-0 top-11 z-50 w-56 overflow-hidden rounded-xl bg-[#141D4A] py-1 shadow-xl">
                      <Link role="menuitem" href="/perfil/" onClick={() => setDd(false)} className="flex min-h-[44px] items-center gap-3 px-4 hover:bg-white/10"><Icon name="user" size={18} />O meu perfil</Link>
                      {creator && <Link role="menuitem" href="/marketplace/criador/" onClick={() => setDd(false)} className="flex min-h-[44px] items-center gap-3 px-4 font-bold text-[var(--bx-acc,#FFC20E)] hover:bg-white/10"><Icon name="star" size={18} />Painel do criador</Link>}
                      <Link role="menuitem" href="/notificacoes/" onClick={() => setDd(false)} className="flex min-h-[44px] items-center gap-3 px-4 hover:bg-white/10">
                        <Icon name="bell" size={18} /><span className="flex-1">Notificações</span>
                        {unread > 0 && <span className="min-w-[20px] rounded-full bg-[#22C55E] px-1.5 text-center text-[12px] font-bold leading-5 text-[#052e16]">{unread > 9 ? '9+' : unread}</span>}
                      </Link>
                      <Link role="menuitem" href="/definicoes/" onClick={() => setDd(false)} className="flex min-h-[44px] items-center gap-3 px-4 hover:bg-white/10"><Icon name="settings" size={18} />Definições</Link>
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <Link href="/registar" className="flex h-9 items-center rounded-[10px] bg-neon px-4 text-[14px] font-bold text-ink">Criar Conta</Link>
              <Link href="/entrar" className="flex h-9 items-center rounded-[10px] bg-white/5 px-4 text-[14px] font-bold text-white hover:bg-white/10">Entrar</Link>
            </>
          )}
        </div>
      </div>

      {/* Telemóvel: abas */}
      <nav aria-label="Secções" className="no-scrollbar flex gap-1 overflow-x-auto px-2 py-1.5 lg:hidden">
        {MENU.map((t) => (
          <Link key={t.href} href={t.href} aria-current={isOn(p, t.href) ? 'page' : undefined}
            className={`flex h-9 shrink-0 items-center rounded-lg px-3.5 text-sm font-semibold ${isOn(p, t.href) ? 'bg-white/10 text-white' : 'text-white/75'}`}>{t.label}</Link>
        ))}
      </nav>
    </header>
  );
}