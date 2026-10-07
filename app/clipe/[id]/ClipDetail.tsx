'use client';

import { useState } from 'react';
import { CLIPS, idol } from '@/lib/data';
import { ClipSlide } from '@/components/ClipSlide';
import { ClipThumb, Page, Section } from '@/components/ui';

export default function ClipDetail({ id }: { id: string }) {
  const c = CLIPS.find((x) => x.id === id) ?? CLIPS[0];
  const [muted, setMuted] = useState(true);
  const more = CLIPS.filter((x) => x.id !== c.id && (x.idolId === c.idolId || x.game === c.game));
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
