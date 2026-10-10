'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AUTHORS, CLIPS, Clip, IDOLS, LIVES, POSTS } from '@/lib/data';
import { IS_DEMO } from '@/lib/config';
import { useStore } from '@/lib/store';
import { CheckoutSheet } from '@/components/LazyCheckout';
import { ProfileSkeleton, ProfileTopBar, ProfileView } from '@/components/Social';
import { MoreMenu } from '@/components/Moderation';
import { fromIdol, type ProfileInfo } from '@/lib/social';

/** Perfil público (criadores e qualquer utilizador). Em modo real, perfis fora do catálogo são lidos do Supabase. */
export default function IdolProfile({ id }: { id: string }) {
  const local = IDOLS.find((x) => x.id === id) ?? AUTHORS.find((x) => x.id === id);
  const [p, setP] = useState<ProfileInfo | null | undefined>(local ? fromIdol(local) : undefined);
  const router = useRouter();
  useEffect(() => {
    let alive = true;
    void import('@/lib/social').then((m) => m.fetchProfile(id)).then((r) => { if (alive) setP((old) => r ?? old ?? null); });
    if (!IS_DEMO) void import('@/lib/dm').then((m) => m.myId()).then((me) => { if (alive && me && me === id) router.replace('/perfil'); });
    return () => { alive = false; };
  }, [id, router]);

  if (p === undefined) return <><ProfileTopBar handle="" back="/" /><ProfileSkeleton /></>;
  if (p === null) return (
    <><ProfileTopBar handle="Perfil" back="/" />
      <div className="flex flex-col items-center gap-2 px-6 py-16 text-center"><p className="text-4xl">🔎</p><p className="font-bold">Perfil não encontrado</p><p className="text-sm text-white/60">Esta conta pode ter sido removida ou o link está errado.</p><Link href="/explorar" className="btn mt-2">Explorar</Link></div>
    </>
  );
  return <Inner p={p} />;
}

function Inner({ p }: { p: ProfileInfo }) {
  const { toast } = useStore();
  const [member, setMember] = useState(false);
  const [fetched, setFetched] = useState<Clip[] | null>(IS_DEMO ? [] : null);
  const { s } = useStore();
  useEffect(() => {
    if (IS_DEMO) return;
    let alive = true;
    void import('@/lib/clips').then((m) => m.authorClips(p.id)).then((l) => { if (alive) setFetched(l); }).catch(() => { if (alive) setFetched([]); });
    return () => { alive = false; };
  }, [p.id]);
  const clips = fetched === null ? null : [...fetched, ...CLIPS.filter((c) => c.idolId === p.id && !fetched.some((f) => f.id === c.id))].filter((c) => !s.admin.hiddenClips.includes(c.id));
  const posts = POSTS.filter((x) => x.idolId === p.id && !s.admin.removed.includes(x.id));
  const lives = LIVES.filter((l) => l.idolId === p.id && (s.admin.liveStatus[l.id] ?? l.status ?? 'ao vivo') === 'ao vivo');

  return (
    <>
      <ProfileTopBar handle={p.handle} verified={p.verified} back="/" right={<MoreMenu kind="utilizador" target={p.handle} label={p.name} owner={p.id} ownerLabel={p.name} className="flex h-11 w-11 items-center justify-center !text-xl" />} />
      <ProfileView p={p} own={false} clips={clips} posts={posts} lives={lives} onMember={() => setMember(true)} />
      {member && <CheckoutSheet open={member} onClose={() => setMember(false)} title={`Membro de ${p.name}`} lines={[{ label: `Subscrição mensal · ${p.name}`, amount: 99 }]} recurring="mensal, cancela quando quiseres" onPaid={() => toast(`👑 Agora és membro de ${p.name}!`)} />}
    </>
  );
}
