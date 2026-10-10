'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { IS_DEMO } from '@/lib/config';
import { Avatar, Page } from '@/components/ui';
import { AccountRows, AccountSheets } from '@/components/AccountSwitcher';
import { Photo } from '@/components/Photo';
import { GAME_ART } from '@/lib/gameArt';
import { fmtWhen, gameKeyOf } from '@/lib/jogos';
import { fmtMt, fmtPts } from '@/lib/bets';
import { BetsView, betsApi } from '@/lib/betsApi';
import { entriesApi } from '@/lib/entriesApi';
import type { Entry } from '@/lib/registration';

const ENTRY_LABEL = { confirmada: 'Confirmada', pendente: 'Pendente', cancelada: 'Cancelada' } as const;
const KYC_LABEL = { pendente: 'Em análise', aprovado: 'Verificada', recusado: 'Recusada' } as const;

export default function Perfil() {
  const { s, ready } = useStore();
  const [acc, setAcc] = useState<'' | 'switch' | 'out'>('');
  const [bets, setBets] = useState<BetsView | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const signedIn = IS_DEMO || s.account.loggedIn;

  useEffect(() => {
    if (!ready || !signedIn) return;
    betsApi.load().then(setBets).catch(() => {});
    entriesApi.mine().then(setEntries).catch(() => setEntries([]));
  }, [ready, signedIn]);

  if (!signedIn) {
    return (
      <Page title="Perfil">
        <div className="card mt-4 space-y-3 text-center">
          <p className="text-sm text-white/75">Entra para ver as tuas inscrições, apostas e histórico.</p>
          <Link href="/entrar" className="btn w-full">Entrar</Link>
          <Link href="/registar" className="btn-ghost w-full">Criar conta</Link>
        </div>
      </Page>
    );
  }

  const me = bets?.me;
  const contact = s.account.email || s.account.phone;
  const tournaments = s.admin.tournaments;
  return (
    <Page title="Perfil">
      <section className="card mb-4 flex items-center gap-3">
        <Avatar a={s.user.avatar} name={s.user.name} size={56} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold">{s.user.name}</p>
          <p className="truncate text-sm text-white/60">{s.user.handle}{contact ? ` · ${contact}` : ''}</p>
        </div>
        <Link href="/definicoes" className="btn-ghost shrink-0 !px-3 text-sm">Conta</Link>
      </section>

      <section className="mb-4 grid grid-cols-2 gap-2.5">
        <Link href="/apostas" className="card !p-3.5">
          <span className="block text-xs text-white/60">TXAP Pontos</span>
          <span className="stat-num block text-xl text-neon2">{me ? fmtPts(me.balance) : '—'}</span>
        </Link>
        <Link href="/apostas#carteira" className="card !p-3.5">
          <span className="block text-xs text-white/60">Identidade (KYC)</span>
          <span className="block text-base font-bold">{me?.kyc ? KYC_LABEL[me.kyc.status] : 'Não enviada'}</span>
          {me && me.balanceMt > 0 && <span className="block text-xs text-white/60">Saldo {fmtMt(me.balanceMt)}</span>}
        </Link>
      </section>

      <section className="mb-4">
        <h2 className="sec-title mb-2">As minhas inscrições</h2>
        {!entries ? <div className="card h-20 animate-pulse" /> : entries.length === 0 ? (
          <p className="card text-sm text-white/70">Ainda não te inscreveste em nenhum torneio. <Link href="/torneios" className="font-semibold text-neon2">Ver torneios</Link></p>
        ) : (
          <ul className="space-y-2">
            {entries.map((e) => {
              const t = tournaments.find((x) => x.id === e.tournamentId);
              return (
                <li key={e.tournamentId}>
                  <Link href={`/torneio/?id=${e.tournamentId}`} className="card flex items-center gap-3 !p-3">
                    <span className="relative block h-12 w-16 shrink-0 overflow-hidden rounded-lg"><Photo src={t?.cover} fallback={GAME_ART[gameKeyOf(t?.game ?? '')]} alt="" sizes="64px" /></span>
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-sm">{t?.name ?? 'Torneio'}</b>
                      <span className="block truncate text-xs text-white/60">{e.playerName}{e.team ? ` · ${e.team}` : ''}{t ? ` · ${fmtWhen(t.date)}` : ''}</span>
                      {e.discordUsername && <span className="block text-xs text-white/60">Discord {e.discordUsername}{e.discordVerified ? ' · verificado' : ''}</span>}
                    </span>
                    <span className={`shrink-0 text-xs font-semibold ${e.status === 'confirmada' ? 'text-lime' : e.status === 'cancelada' ? 'text-pink' : 'text-neon2'}`}>{ENTRY_LABEL[e.status]}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mb-4">
        <h2 className="sec-title mb-2">Histórico</h2>
        <div className="card divide-y divide-line !p-0">
          <Row href="/apostas#minhas" label="As minhas apostas" sub={me ? `${bets?.myBets.length ?? 0} aposta(s)` : undefined} />
          <Row href="/marketplace/pedidos" label="Compras e vendas no marketplace" />
          <Row href="/notificacoes" label="Notificações" />
        </div>
      </section>

      <section className="mb-4">
        <div className="card divide-y divide-line !p-0">
          <Row href="/definicoes" label="Definições" />
          {s.user.role === 'admin' && <Row href="/admin" label="Painel Admin" />}
        </div>
      </section>

      <div className="mb-3"><AccountRows onSwitch={() => setAcc('switch')} onSignOut={() => setAcc('out')} /></div>
      <AccountSheets sheet={acc} onClose={() => setAcc('')} />
    </Page>
  );
}

function Row({ href, label, sub }: { href: string; label: string; sub?: string }) {
  return (
    <Link href={href} className="flex min-h-[52px] items-center gap-3 px-4 py-2.5">
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{label}</span>{sub && <span className="block text-xs text-white/55">{sub}</span>}</span>
      <span className="text-white/40" aria-hidden>›</span>
    </Link>
  );
}
