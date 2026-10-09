'use client';

import { ACHIEVEMENTS } from '@/lib/data';
import { useStore } from '@/lib/store';
import { Page } from '@/components/ui';

export default function ConquistasPage() {
  const { s } = useStore();
  return (
    <Page title={`Conquistas ${s.achievements.length}/${ACHIEVEMENTS.length}`} back="/perfil">
      <div className="grid grid-cols-2 gap-3">
        {ACHIEVEMENTS.map((a) => {
          const got = s.achievements.includes(a.id);
          return (
            <div key={a.id} className={`card text-center ${got ? 'border-neon' : 'opacity-50 grayscale'}`}>
              <p className="text-4xl">{got ? a.emoji : '🔒'}</p>
              <p className="mt-1 text-sm font-semibold">{a.name}</p>
              <p className="text-xs text-white/60">{a.desc}</p>
              <p className="mt-1 text-xs text-neon">+{a.xp} XP</p>
            </div>
          );
        })}
      </div>
    </Page>
  );
}
