'use client';

// Perfil TXAPZONE: conta, carteira, torneios inscritos e atalhos (sem rede social).
import Link from 'next/link';
import { useState } from 'react';
import { mzn } from '@/lib/data';
import { GAMES } from '@/lib/config';
import { useStore } from '@/lib/store';
import { GAMES_CFG, fmtWhen, gameKeyOf, mtOrTba } from '@/lib/jogos';
import { AvatarFace } from '@/components/ui';
import { AccountRows, AccountSheets } from '@/components/AccountSwitcher';
import { InstallMenuRow } from '@/components/Install';
import { GameCover } from '@/components/GameArt';
import { Icon, IconName } from '@/components/icons';
import { PaySoon, TzSheet, TzShell, TzSkeleton, walletMZN } from '@/components/jogos/Kit';

const MENU: [string, IconName, string][] = [
  ['/notificacoes', 'bell', 'Notificações'],
  ['/checkout', 'cart', 'Carrinho'],
  ['/definicoes', 'settings', 'Definições e privacidade'],
  ['/seguranca', 'lock', 'Segurança da conta'],
  ['/coach-ia', 'bot', 'Coach IA'],
  ['/escola', 'cap', 'Escola Free Fire'],
  ['/mais', 'menu', 'Tudo na TXAPZONE'],
];

export default function PerfilPage() {
  const { s, ready } = useStore();
  const [buys, setBuys] = useState(false);
  const [wallet, setWallet] = useState(false);
  const [acc, setAcc] = useState<'' | 'switch' | 'out'>('');
  const name = s.user.name && s.user.name !== 'Visitante' ? s.user.name : s.account?.email || 'Jogador';
  const games = s.account.interests.filter((g) => (GAMES as readonly string[]).includes(g)).slice(0, 4);
  const mine = s.admin.tournaments.filter((t) => s.entries.includes(t.id)).sort((a, b) => a.date.localeCompare(b.date));
  const bal = walletMZN();
  const row = 'flex min-h-[52px] w-full items-center gap-3 px-4 text-left transition-colors hover:bg-[#1D1F28]';

  return (
    <TzShell>
      <main className="tz-wrap pb-16 pt-5">
        <div className="mx-auto max-w-3xl">
          {!ready ? <TzSkeleton className="h-[180px]" /> : (
            <section className="tz-card relative overflow-hidden p-5 sm:p-6" aria-label="O meu perfil">
              <span className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(120%_100%_at_0%_0%,rgba(255,107,26,.18),transparent_70%)]" aria-hidden />
              <div className="relative flex items-center gap-4">
                <span className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand text-[26px] text-white ring-2 ring-[#FFC107] sm:h-24 sm:w-24 sm:text-[30px]">
                  <AvatarFace a={s.user.avatar} name={name} fill />
                </span>
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-[22px] font-extrabold leading-tight sm:text-[26px]">{name}</h1>
                  {s.user.handle && <p className="tz-muted truncate text-sm">@{s.user.handle.replace(/^@/, '')}</p>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.user.role === 'admin' && <span className="tz-tag bg-[#FFC107] text-[#0E0F13]">Admin</span>}
                    {games.map((g) => <span key={g} className="tz-tag border border-[#FFFFFF1F] bg-[#0E0F13] text-[#ECEEF3]">{g}</span>)}
                  </div>
                </div>
              </div>
              {s.user.bio && <p className="relative mt-4 text-sm text-[#ECEEF3]">{s.user.bio}</p>}
              <div className="relative mt-5 grid grid-cols-3 gap-2">
                <button type="button" onClick={() => setWallet(true)} className="flex min-h-[64px] flex-col items-center justify-center rounded-xl border border-[#FFFFFF1F] bg-[#0E0F13] px-2 transition-colors hover:border-[#FFFFFF33]">
                  <span className="text-[17px] font-bold tabular-nums">{bal.toLocaleString('pt-PT')} MT</span><span className="tz-dim text-[11.5px]">Carteira</span>
                </button>
                <a href="#meus-torneios" className="flex min-h-[64px] flex-col items-center justify-center rounded-xl border border-[#FFFFFF1F] bg-[#0E0F13] px-2 transition-colors hover:border-[#FFFFFF33]">
                  <span className="text-[17px] font-bold tabular-nums">{mine.length}</span><span className="tz-dim text-[11.5px]">Torneios</span>
                </a>
                <button type="button" onClick={() => setBuys(true)} className="flex min-h-[64px] flex-col items-center justify-center rounded-xl border border-[#FFFFFF1F] bg-[#0E0F13] px-2 transition-colors hover:border-[#FFFFFF33]">
                  <span className="text-[17px] font-bold tabular-nums">{s.purchases.length}</span><span className="tz-dim text-[11.5px]">Compras</span>
                </button>
              </div>
              <div className="relative mt-4 flex gap-2">
                <Link href="/perfil/editar" className="tz-btn flex-1">Editar perfil</Link>
                <Link href="/definicoes" className="tz-btn-dark flex-1 !min-h-[40px]">Definições</Link>
              </div>
            </section>
          )}

          <section id="meus-torneios" className="mt-7 scroll-mt-20">
            <div className="mb-3 flex items-end justify-between gap-3">
              <h2 className="tz-h2">Os meus torneios</h2>
              <Link href="/torneios" className="tz-link text-sm font-semibold hover:underline">Ver todos</Link>
            </div>
            {mine.length === 0 ? (
              <div className="tz-card flex flex-col items-center gap-2 p-6 text-center">
                <Icon name="trophy" size={34} className="text-[#FFC107]" />
                <p className="text-[15px] font-semibold">Ainda não te inscreveste em nenhum torneio</p>
                <p className="tz-muted max-w-sm text-sm">Escolhe um jogo e inscreve-te. As tuas inscrições aparecem aqui.</p>
                <Link href="/torneios" className="tz-btn-outline mt-1">Procurar torneios</Link>
              </div>
            ) : (
              <div className="space-y-2.5">
                {mine.map((t) => {
                  const k = gameKeyOf(t.game);
                  return (
                    <Link key={t.id} href={`/torneios/${t.id}/`} className="tz-card flex items-center gap-3 p-3 transition-colors hover:border-[#FFFFFF33]">
                      <span className="relative h-12 w-20 shrink-0 overflow-hidden rounded-lg"><GameCover game={k} sizes="80px" shade={false} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold">{t.name}</span>
                        <span className="tz-muted block truncate text-[13px]">{GAMES_CFG[k].short} · {fmtWhen(t.date)} · Prémio {mtOrTba(t.prize)}</span>
                      </span>
                      <span className="tz-dim text-xl" aria-hidden>›</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          <section className="mt-7">
            <h2 className="tz-h2 mb-3">Menu</h2>
            <ul className="divide-y divide-[#FFFFFF1F] overflow-hidden rounded-xl border border-[#FFFFFF1F] bg-[#16181F]">
              <li><button type="button" onClick={() => setWallet(true)} className={row}><Icon name="wallet" size={21} className="text-[#FFFFFFB8]" /><span className="flex-1 text-sm">Carteira</span><span className="text-sm font-semibold tabular-nums">{bal.toLocaleString('pt-PT')} MT</span></button></li>
              <li><button type="button" onClick={() => setBuys(true)} className={row}><Icon name="receipt" size={21} className="text-[#FFFFFFB8]" /><span className="flex-1 text-sm">Compras e recargas</span><span className="tz-dim">›</span></button></li>
              {MENU.map(([h, e, l]) => <li key={h}><Link href={h} className={row}><Icon name={e} size={21} className="text-[#FFFFFFB8]" /><span className="flex-1 text-sm">{l}</span><span className="tz-dim">›</span></Link></li>)}
              {s.user.role === 'admin' && <li><Link href="/admin" className={row}><Icon name="tool" size={21} className="text-[#FFFFFFB8]" /><span className="flex-1 text-sm">Painel de administração</span><span className="tz-dim">›</span></Link></li>}
              <InstallMenuRow />
            </ul>
            <AccountRows onSwitch={() => setAcc('switch')} onSignOut={() => setAcc('out')} />
          </section>
        </div>
      </main>

      <AccountSheets sheet={acc} onClose={() => setAcc('')} />
      <TzSheet open={wallet} onClose={() => setWallet(false)} title="Carteira">
        <p className="text-3xl font-bold tabular-nums">{bal.toLocaleString('pt-PT')} MT</p>
        <p className="tz-muted mt-2 text-sm">A carteira em meticais abre com os pagamentos M-Pesa/e-Mola. Até lá não é possível carregar nem levantar saldo.</p>
        <PaySoon className="mt-3" />
      </TzSheet>
      <Purchases open={buys} onClose={() => setBuys(false)} />
    </TzShell>
  );
}

function Purchases({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { s, set, toast } = useStore();
  return (
    <TzSheet open={open} onClose={onClose} title="Compras e recargas">
      <div className="space-y-2">
        {s.purchases.length === 0 && <p className="tz-muted text-sm">Nenhuma compra ainda.</p>}
        {s.purchases.map((p) => (
          <div key={p.id} className="tz-card flex items-center justify-between gap-2 p-3 text-sm">
            <div className="min-w-0"><p className="truncate">{p.item}</p><p className="tz-dim text-xs">{p.date} · {p.method}{p.status === 'cancelado' ? ' · cancelado' : ''}</p></div>
            <div className="text-right"><p className="font-semibold">{mzn(p.total)}</p>
              {p.status !== 'cancelado' && <button className="text-xs text-[#FFD54F] underline" onClick={() => { set((x) => ({ ...x, purchases: x.purchases.map((y) => (y.id === p.id ? { ...y, status: 'cancelado' } : y)) })); toast('Compra cancelada'); }}>Cancelar</button>}
            </div>
          </div>
        ))}
      </div>
    </TzSheet>
  );
}
