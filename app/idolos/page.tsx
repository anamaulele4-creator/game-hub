'use client';

import Link from 'next/link';
import { useState } from 'react';
import { IDOLS, divisionFor, fmt, DIVISIONS } from '@/lib/data';
import { useStore } from '@/lib/store';
import { FollowButton, Page, Tabs, Verified } from '@/components/ui';

const F = ['Todos', 'Free Fire', 'eFootball', 'PUBG Mobile', 'Call of Duty Mobile', 'A seguir'] as const;
type Fl = (typeof F)[number];

export default function IdolosPage() {
  const { s } = useStore();
  const [f, setF] = useState<Fl>('Todos');
  const list = IDOLS.filter((i) => f === 'Todos' || (f === 'A seguir' ? s.following.includes(i.id) : i.game === f));
  return (
    <Page title="Ídolos" back="/">
      <Tabs tabs={F} value={f} onChange={setF} />
      <div className="space-y-3">
        {list.map((i) => {
          const d = DIVISIONS.find((x) => x.name === i.division) ?? divisionFor(0);
          return (
            <Link key={i.id} href={`/idolo/${i.id}`} className="card flex items-center gap-3 !p-3">
              <span className="flex h-14 w-14 items-center justify-center rounded-full border-2 text-3xl" style={{ borderColor: i.color }}>{i.avatar}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{i.name}{i.verified && <Verified />}</p>
                <p className="text-xs text-white/60">{i.game} · {fmt(i.followers)} seguidores</p>
                <p className="text-xs" style={{ color: d.color }}>{d.emoji} {i.division} · #{i.rank} no ranking</p>
              </div>
              <FollowButton idolId={i.id} small />
            </Link>
          );
        })}
      </div>
    </Page>
  );
}
