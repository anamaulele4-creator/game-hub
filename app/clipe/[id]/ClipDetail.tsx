'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useClipSound } from '@/lib/sound';
import { isLong, videoHref } from '@/lib/feed';
import { CLIPS, idol } from '@/lib/data';
import { ClipSlide } from '@/components/ClipSlide';
import { ClipThumb, Page, Section } from '@/components/ui';

function Missing({ what, back }: { what: string; back: string }) {
  return <Page title={what} back={back}><div className="card mt-6 text-center"><p className="text-4xl">🔎</p><p className="mt-2 text-sm text-white/70">{what} não encontrado ou ainda a carregar.</p></div></Page>;
}
export default function ClipDetail({ id }: { id: string }) {
  const c = CLIPS.find((x) => x.id === id);
  if (!c) return <Missing what="Clipe" back="/clipes" />;
  if (isLong(c)) return <ToVideo id={c.id} />;
  return <Inner c={c} />;
}

/** Vídeos longos abrem na página horizontal (estilo YouTube). */
function ToVideo({ id }: { id: string }) {
  const router = useRouter();
  useEffect(() => { router.replace(videoHref(id)); }, [id, router]);
  return <Page title="Vídeo" back="/videos"><div className="skeleton -mx-4 -mt-4 aspect-video" /></Page>;
}

function Inner({ c }: { c: (typeof CLIPS)[number] }) {
  const [muted, setMuted] = useClipSound();
  const more = CLIPS.filter((x) => x.id !== c.id && !isLong(x) && (x.idolId === c.idolId || x.game === c.game));
  return (
    <Page title={c.title} back="/clipes">
      <div className="-mx-4 -mt-4 mb-4">
        <ClipSlide c={c} muted={muted} setMuted={setMuted} height="h-[75vh]" />
      </div>
      <Section title={`Mais de ${idol(c.idolId).name} e ${c.game}`}>
        <div className="grid grid-cols-3 gap-2">{more.map((x) => <ClipThumb key={x.id} id={x.id} />)}</div>
      </Section>
    </Page>
  );
}
