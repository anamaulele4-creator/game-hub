'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { CLIPS, Clip, Live, Post, fmt } from '@/lib/data';
import { clipType, fmtDuration } from '@/lib/feed';
import { useStore } from '@/lib/store';
import type { Person, ProfileInfo } from '@/lib/social';
import { Avatar, AvatarFace, ClipThumb, Sheet, ShareSheet, Verified } from './ui';
import { MoreMenu } from './Moderation';

/** Botão "Seguir" / "A seguir" (largura total do espaço que recebe). */
export function FollowToggle({ id, className = '' }: { id: string; className?: string }) {
  const { s, toggleFollow } = useStore();
  const f = s.following.includes(id);
  return (
    <button type="button" onClick={() => toggleFollow(id)} aria-pressed={f}
      className={`min-h-[44px] rounded-xl px-4 text-[15px] font-semibold transition-colors ${f ? 'border border-line bg-panel2 text-white/90' : 'bg-neon text-white'} ${className}`}>
      {f ? 'A seguir' : 'Seguir'}
    </button>
  );
}

/** "Mensagem": só depois de seguir. Abre/cria a conversa 1:1 em /mensagens/chat. */
export function MessageButton({ id, className = '' }: { id: string; className?: string }) {
  const { s, toast } = useStore();
  const router = useRouter();
  const f = s.following.includes(id);
  return (
    <button type="button" aria-disabled={!f}
      onClick={() => { if (!f) { toast('Segue esta pessoa para enviar mensagem'); return; } router.push(`/mensagens/chat?u=${encodeURIComponent(id)}`); }}
      className={`min-h-[44px] rounded-xl border border-line bg-panel2 px-4 text-[15px] font-semibold ${f ? 'text-white/90' : 'text-white/45'} ${className}`}>
      Mensagem
    </button>
  );
}

/** Lista de pessoas (seguidores, a seguir, nova mensagem). */
export function PeopleList({ people, loading, empty, onPick }: { people: Person[]; loading?: boolean; empty: string; onPick?: (p: Person) => void }) {
  if (loading) return <div className="space-y-3">{[0, 1, 2, 3].map((k) => <div key={k} className="flex items-center gap-3"><span className="skeleton h-11 w-11 rounded-full" /><span className="skeleton h-4 flex-1 rounded" /></div>)}</div>;
  if (!people.length) return <p className="py-6 text-center text-sm text-white/60">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {people.map((p) => {
        const inner = (<><Avatar a={p.avatar} name={p.name} size={44} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{p.name}{p.verified && <Verified />}</span><span className="block truncate text-xs text-white/50">{p.handle}</span></span><span className="text-white/30">›</span></>);
        return (
          <li key={p.id}>
            {onPick
              ? <button type="button" onClick={() => onPick(p)} className="flex min-h-[56px] w-full items-center gap-3 py-2 text-left">{inner}</button>
              : <Link href={`/idolo/${p.id}`} className="flex min-h-[56px] items-center gap-3 py-2">{inner}</Link>}
          </li>
        );
      })}
    </ul>
  );
}

function FollowSheet({ open, onClose, id, kind }: { open: boolean; onClose: () => void; id: string; kind: 'seguidores' | 'a-seguir' }) {
  const { s } = useStore();
  const [list, setList] = useState<Person[] | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setList(null);
    void import('@/lib/social').then((m) => m.followList(id, kind, s.following)).then((l) => { if (alive) setList(l); });
    return () => { alive = false; };
  }, [open, id, kind, s.following]);
  return (
    <Sheet open={open} onClose={onClose} title={kind === 'seguidores' ? 'Seguidores' : 'A seguir'}>
      <PeopleList people={list ?? []} loading={list === null} empty={kind === 'seguidores' ? 'Ainda sem seguidores.' : 'Ainda não segue ninguém.'} />
    </Sheet>
  );
}

/** Texto com links clicáveis (bio). */
function Linkify({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+|www\.[^\s]+)/g);
  return <>{parts.map((p, k) => (/^(https?:\/\/|www\.)/.test(p)
    ? <a key={k} href={p.startsWith('http') ? p : 'https://' + p} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-neon2">{p.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a>
    : <React.Fragment key={k}>{p}</React.Fragment>))}</>;
}

/** Quadrado da grelha (3 colunas). Leve: só imagens/miniaturas, nunca carrega vídeo. */
function GridTile({ c }: { c: Clip }) {
  const t = clipType(c);
  const img = c.thumb || c.image;
  const [ok, setOk] = useState(false);
  const href = t === 'long' ? `/videos?v=${encodeURIComponent(c.id)}` : `/clipe/${c.id}`;
  return (
    <Link href={href} className={`relative block aspect-square overflow-hidden bg-gradient-to-br ${c.gradient}`} aria-label={c.title}>
      {img ? (
        <>
          {!ok && <span className="skeleton absolute inset-0" aria-hidden />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img} alt="" loading="lazy" decoding="async" onLoad={() => setOk(true)} className={`absolute inset-0 h-full w-full object-cover transition-opacity ${ok ? 'opacity-100' : 'opacity-0'}`} />
        </>
      ) : t === 'text' ? (
        <span className="absolute inset-0 flex items-center justify-center p-2 text-center text-[13px] font-semibold leading-tight line-clamp-5">{c.title}</span>
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-3xl opacity-80">{c.emoji}</span>
      )}
      {(t === 'video' || t === 'long') && <span className="absolute right-1.5 top-1.5 rounded bg-black/55 px-1 text-[11px] font-semibold" aria-label={t === 'long' ? 'Vídeo' : 'Clipe'}>{t === 'long' ? '📺' : '▶'}{c.duration ? ` ${fmtDuration(c.duration)}` : ''}</span>}
      {t === 'meme' && <span className="absolute right-1.5 top-1.5 rounded bg-black/55 px-1 text-[11px]">😂</span>}
    </Link>
  );
}

function PostTile({ p }: { p: Post }) {
  return <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-panel2 p-2 text-center text-[13px] leading-tight"><span className="line-clamp-5">{p.emoji} {p.text}</span></div>;
}

function Empty({ icon, title, hint, action }: { icon: string; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-white/30 text-2xl">{icon}</span>
      <p className="text-base font-bold">{title}</p>
      {hint && <p className="text-sm text-white/55">{hint}</p>}
      {action}
    </div>
  );
}

const TABS_ALL = [
  { k: 'grelha', icon: '▦', label: 'Grelha' },
  { k: 'clipes', icon: '🎬', label: 'Clipes' },
  { k: 'videos', icon: '📺', label: 'Vídeos' },
  { k: 'guardados', icon: '🔖', label: 'Guardados' },
] as const;
type TabK = (typeof TABS_ALL)[number]['k'];

export function ProfileSkeleton() {
  return (
    <div className="px-4 pt-4" aria-busy="true">
      <div className="flex items-center gap-5"><span className="skeleton h-[86px] w-[86px] rounded-full" /><div className="grid flex-1 grid-cols-3 gap-2">{[0, 1, 2].map((k) => <span key={k} className="skeleton h-10 rounded" />)}</div></div>
      <span className="skeleton mt-4 block h-4 w-40 rounded" /><span className="skeleton mt-2 block h-3 w-56 rounded" />
      <div className="mt-4 flex gap-2"><span className="skeleton h-11 flex-1 rounded-xl" /><span className="skeleton h-11 flex-1 rounded-xl" /></div>
      <div className="mt-6 grid grid-cols-3 gap-0.5">{Array.from({ length: 9 }).map((_, k) => <span key={k} className="skeleton aspect-square" />)}</div>
    </div>
  );
}

/** Barra superior do perfil (estilo Instagram): @username ao centro-esquerda, ações à direita. */
export function ProfileTopBar({ handle, verified, back, right }: { handle: string; verified?: boolean; back?: string; right?: React.ReactNode }) {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-1 border-b border-line bg-bg/95 px-2">
      {back !== undefined && <button type="button" onClick={() => (window.history.length > 1 ? router.back() : router.push(back || '/'))} className="flex h-11 w-11 items-center justify-center rounded-full text-2xl" aria-label="Voltar">‹</button>}
      <h1 className={`min-w-0 flex-1 truncate text-lg font-bold ${back === undefined ? 'pl-2' : ''}`}>{handle || 'Perfil'}{verified && <Verified />}</h1>
      {right}
    </header>
  );
}

/**
 * Perfil profissional (próprio ou público): cabeçalho com avatar e estatísticas, nome, bio, jogos,
 * botões, destaques e separadores com ícones (Grelha · Clipes · Vídeos · Guardados).
 */
export function ProfileView({ p, own, clips, posts, lives, onMember }: { p: ProfileInfo; own: boolean; clips: Clip[] | null; posts: Post[]; lives: Live[]; onMember?: () => void }) {
  const { s } = useStore();
  const [tab, setTab] = useState<TabK>('grelha');
  const [sheet, setSheet] = useState<null | 'seguidores' | 'a-seguir'>(null);
  const [share, setShare] = useState(false);
  const [counts, setCounts] = useState<{ followers: number; following: number } | null>(null);
  const following = s.following.includes(p.id);
  useEffect(() => {
    let alive = true;
    void import('@/lib/social').then((m) => m.followCounts(p.id)).then((c) => { if (alive && c) setCounts(c); });
    return () => { alive = false; };
  }, [p.id, following]);

  const list = clips ?? [];
  const grid = list.filter((c) => clipType(c) !== 'long');
  const shorts = list.filter((c) => clipType(c) === 'video');
  const longs = list.filter((c) => clipType(c) === 'long');
  const savedClips = own ? s.saved.filter((x) => x.kind === 'clipe').map((x) => CLIPS.find((c) => c.id === x.id)).filter(Boolean) as Clip[] : [];
  const nPosts = list.length + posts.length;
  const followers = counts ? counts.followers : p.followers + (!own && following ? 1 : 0);
  const followingN = counts ? counts.following : own ? s.following.length : (p.followingCount ?? 0);
  const live = lives.find((l) => (l.status ?? 'ao vivo') === 'ao vivo');
  const favs = [...list].sort((a, b) => b.likes - a.likes).slice(0, 1);
  const creator = p.role === 'creator' || p.role === 'admin' || p.verified;
  const { text: bio, link } = splitBioLocal(p.bio);
  const tabs = TABS_ALL.filter((t) => t.k !== 'guardados' || own);
  const path = `/idolo/${p.id}`;

  const stat = (n: number | string, l: string, on?: () => void) => (
    <button type="button" onClick={on} disabled={!on} className="flex min-h-[44px] flex-col items-center justify-center rounded-lg px-1">
      <span className="whitespace-nowrap text-[17px] font-bold leading-tight">{typeof n === 'number' ? compact(n) : n}</span>
      <span className="whitespace-nowrap text-[12px] text-white/65">{l}</span>
    </button>
  );

  return (
    <>
      <section className="px-4 pt-4">
        <div className="flex items-center gap-3">
          <Link href={live ? `/lives/${live.id}` : own ? '/perfil/editar' : path} aria-label={live ? 'Ver live' : 'Foto de perfil'}
            className={`relative shrink-0 rounded-full p-[3px] ${live ? 'bg-red-500' : 'bg-transparent'}`}>
            <span className="flex h-[86px] w-[86px] items-center justify-center overflow-hidden rounded-full border-2 border-bg bg-panel2 text-4xl"><AvatarFace a={p.avatar} name={p.name} fill /></span>
            {live && <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-red-600 px-1.5 text-[10px] font-bold leading-4">AO VIVO</span>}
          </Link>
          <div className="grid min-w-0 flex-1 grid-cols-3">
            {stat(nPosts, 'Publicações')}
            {stat(followers, 'Seguidores', () => setSheet('seguidores'))}
            {stat(followingN, 'A seguir', () => setSheet('a-seguir'))}
          </div>
        </div>

        <div className="mt-3">
          <p className="flex flex-wrap items-center gap-x-1.5 text-[15px] font-bold">{p.name}{p.verified && <Verified />}
            {creator && <span className="rounded-full bg-neon/15 px-2 py-0.5 text-[11px] font-semibold text-neon2">Criador</span>}
          </p>
          <p className="text-[13px] text-white/55">{p.handle}{p.team ? ` · ${p.team}` : ''}</p>
          {bio && <p className="mt-1.5 whitespace-pre-line break-words text-sm leading-snug text-white/90"><Linkify text={bio} /></p>}
          {link && <a href={link} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 block truncate text-sm font-medium text-neon2">🔗 {link.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a>}
          {!bio && own && <Link href="/perfil/editar" className="mt-1 block text-sm text-white/45">Adiciona uma bio…</Link>}
          {p.games.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">{p.games.map((g) => <span key={g} className="rounded-full border border-line bg-panel2 px-2.5 py-1 text-[12px] text-white/80">🎮 {g}</span>)}</div>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          {own ? (
            <>
              <Link href="/perfil/editar" className="flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-line bg-panel2 text-[15px] font-semibold">Editar perfil</Link>
              <button type="button" onClick={() => setShare(true)} className="min-h-[44px] flex-1 rounded-xl border border-line bg-panel2 text-[15px] font-semibold">Partilhar perfil</button>
            </>
          ) : s.blocked.includes(p.id) ? (
            <p className="flex-1 rounded-xl bg-panel2 p-3 text-center text-sm text-pink">🚫 Bloqueaste este utilizador</p>
          ) : (
            <>
              <FollowToggle id={p.id} className="flex-1" />
              <MessageButton id={p.id} className="flex-1" />
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-panel2">
                <MoreMenu kind="utilizador" target={p.handle} label={p.name} owner={p.id} ownerLabel={p.name} className="!px-0" />
              </span>
            </>
          )}
        </div>

        <div className="no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-3 pb-1">
          <Highlight href={live ? `/lives/${live.id}` : own ? '/lives/criar' : '/lives'} icon={live ? '🔴' : '📡'} label={live ? 'Ao vivo' : 'Lives'} />
          {favs[0] ? <Highlight href={`/clipe/${favs[0].id}`} icon="⭐" label="Favoritos" img={favs[0].thumb || favs[0].image} /> : <Highlight href={own ? '/publicar' : '/clipes'} icon="⭐" label="Favoritos" />}
          {own && <Highlight href="/guardados" icon="🔖" label="Guardados" />}
          {own && <Highlight href="/conquistas" icon="🏅" label="Conquistas" />}
          {!own && creator && onMember && <Highlight onClick={onMember} icon="👑" label="Membros" />}
        </div>
      </section>

      <div className="sticky top-14 z-20 mt-2 grid border-b border-line bg-bg" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0,1fr))` }} role="tablist">
        {tabs.map((t) => (
          <button key={t.k} role="tab" aria-selected={tab === t.k} aria-label={t.label} onClick={() => setTab(t.k)}
            className={`flex min-h-[46px] flex-col items-center justify-center border-b-2 text-[11px] ${tab === t.k ? 'border-white text-white' : 'border-transparent text-white/45'}`}>
            <span className="text-lg leading-6">{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      <div className="pb-28">
        {clips === null ? (
          <div className="grid grid-cols-3 gap-0.5">{Array.from({ length: 9 }).map((_, k) => <span key={k} className="skeleton aspect-square" />)}</div>
        ) : tab === 'grelha' ? (
          grid.length + posts.length === 0
            ? <Empty icon="📷" title="Ainda sem publicações" hint={own ? 'Partilha o teu primeiro clipe, meme ou foto.' : 'Quando publicar, vais ver aqui.'} action={own ? <Link href="/publicar" className="btn mt-2">Publicar</Link> : undefined} />
            : <div className="grid grid-cols-3 gap-0.5">{grid.map((c) => <GridTile key={c.id} c={c} />)}{posts.map((x) => <PostTile key={x.id} p={x} />)}</div>
        ) : tab === 'clipes' ? (
          shorts.length === 0 ? <Empty icon="🎬" title="Ainda sem clipes" hint={own ? 'Grava as tuas melhores jogadas.' : undefined} action={own ? <Link href="/publicar?tipo=video" className="btn mt-2">Publicar clipe</Link> : undefined} />
            : <div className="grid grid-cols-3 gap-0.5 p-0.5">{shorts.map((c) => <ClipThumb key={c.id} c={c} className="!rounded-none" />)}</div>
        ) : tab === 'videos' ? (
          longs.length === 0 ? <Empty icon="📺" title="Ainda sem vídeos" hint={own ? 'Publica vídeos longos ou links do YouTube.' : undefined} action={own ? <Link href="/publicar?tipo=long" className="btn mt-2">Publicar vídeo</Link> : undefined} />
            : <div className="grid grid-cols-2 gap-2 p-2">{longs.map((c) => <ClipThumb key={c.id} c={c} wide />)}</div>
        ) : (
          savedClips.length === 0 ? <Empty icon="🔖" title="Nada guardado" hint="Toca em 🔖 numa publicação para a guardar aqui. Só tu vês os teus guardados." action={<Link href="/guardados" className="mt-1 text-sm text-neon2">Ver todos os guardados</Link>} />
            : <div className="grid grid-cols-3 gap-0.5">{savedClips.map((c) => <GridTile key={c.id} c={c} />)}</div>
        )}
      </div>

      <FollowSheet open={sheet !== null} onClose={() => setSheet(null)} id={p.id} kind={sheet ?? 'seguidores'} />
      <ShareSheet open={share} onClose={() => setShare(false)} path={path} text={`Segue ${p.name} no Social POIPAK:`} target={p.id} />
    </>
  );
}

/** Números curtos para o cabeçalho do perfil: 184 mil, 1,2 M. */
function compact(n: number) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',').replace(',0', '') + ' M';
  if (n >= 1e4) return Math.round(n / 1000) + ' mil';
  return fmt(n);
}

function Highlight({ href, onClick, icon, label, img }: { href?: string; onClick?: () => void; icon: string; label: string; img?: string }) {
  const inner = (
    <>
      <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-line bg-panel2 p-[3px]">
        <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-panel text-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {img ? <img src={img} alt="" loading="lazy" className="h-full w-full object-cover" /> : icon}
        </span>
      </span>
      <span className="w-[72px] truncate text-center text-[12px] text-white/80">{label}</span>
    </>
  );
  const cls = 'flex w-[72px] shrink-0 flex-col items-center gap-1';
  return href ? <Link href={href} className={cls}>{inner}</Link> : <button type="button" onClick={onClick} className={cls}>{inner}</button>;
}

// cópia síncrona de splitBio (evita importar lib/social no primeiro carregamento)
function splitBioLocal(bio: string) {
  const re = /\n?🔗\s*(\S+)\s*$/;
  const m = (bio || '').match(re);
  return m ? { text: bio.replace(re, '').trim(), link: m[1] } : { text: (bio || '').trim(), link: '' };
}

