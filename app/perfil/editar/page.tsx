'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { GAMES } from '@/lib/config';
import { useStore } from '@/lib/store';
import { AvatarFace } from '@/components/ui';
import { AvatarEditor } from '@/components/AvatarEditor';
import { ProfileTopBar } from '@/components/Social';
import { isGame, joinBio, normalizeLink, splitBio } from '@/lib/social';
import { moderate, recordModeration } from '@/lib/poipakAI';

export default function EditarPerfil() {
  const { s, set, toast, ready } = useStore();
  const router = useRouter();
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');
  const [link, setLink] = useState('');
  const [games, setGames] = useState<string[]>([]);
  const [photo, setPhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!ready) return;
    const b = splitBio(s.user.bio);
    setName(s.user.name); setHandle(s.user.handle.replace(/^@/, '')); setBio(b.text); setLink(b.link);
    setGames(s.account.interests.filter(isGame));
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setErr('');
    const n = name.trim();
    if (n.length < 2) { setErr('O nome precisa de pelo menos 2 letras.'); return; }
    const m = moderate(`${n} ${bio}`);
    if (m.level !== 'ok') recordModeration(m, 'perfil', `${n} ${bio}`);
    if (m.level === 'block') { setErr(`🛡️ ${m.tip}`); return; }
    setBusy(true);
    const sm = await import('@/lib/social');
    const h = handle.trim().replace(/^@/, '').toLowerCase();
    let newHandle = s.user.handle;
    if (h && '@' + h !== s.user.handle) {
      const r = await sm.setHandle(h);
      if (!r.ok) { setBusy(false); setErr(r.error ?? 'Não foi possível mudar o @username.'); return; }
      newHandle = '@' + h;
    }
    const others = s.account.interests.filter((x) => !isGame(x));
    set((p) => ({ ...p, user: { ...p.user, name: n.slice(0, 40), handle: newHandle, bio: joinBio(bio, normalizeLink(link)) }, account: { ...p.account, interests: [...games, ...others] } }));
    await sm.setMainGame(games[0] ?? '');
    setBusy(false);
    toast('Perfil atualizado ✓');
    router.push('/perfil');
  };

  const field = 'mb-4 block';
  const lab = 'mb-1 block text-[13px] font-semibold text-white/70';
  return (
    <>
      <ProfileTopBar handle="Editar perfil" back="/perfil" right={<button type="button" onClick={() => void save()} disabled={busy} className="min-h-[44px] px-3 text-[15px] font-bold text-neon2 disabled:opacity-40">{busy ? 'A guardar…' : 'Guardar'}</button>} />
      <main className="px-4 pb-28 pt-5">
        <div className="mb-6 flex flex-col items-center gap-2">
          <button type="button" onClick={() => setPhoto(true)} className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-panel2 text-5xl" aria-label="Mudar foto de perfil"><AvatarFace a={s.user.avatar} name={s.user.name} fill /></button>
          <button type="button" onClick={() => setPhoto(true)} className="min-h-[44px] text-sm font-semibold text-neon2">Mudar foto</button>
        </div>

        <label className={field}><span className={lab}>Nome</span>
          <input className="input w-full" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>

        <label className={field}><span className={lab}>@username</span>
          <div className="flex items-center rounded-xl border border-line bg-panel2 pl-3.5 focus-within:border-neon"><span className="text-white/50">@</span>
            <input className="min-h-[44px] flex-1 bg-transparent px-1 py-2.5 text-base outline-none" value={handle} maxLength={30} onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ''))} autoCapitalize="none" autoCorrect="off" /></div>
          <span className="mt-1 block text-xs text-white/45">3 a 30 caracteres: letras minúsculas, números, _ ou .</span></label>

        <label className={field}><span className={lab}>Bio</span>
          <textarea className="input min-h-[96px] w-full resize-none" value={bio} maxLength={220} onChange={(e) => setBio(e.target.value)} placeholder="Conta quem és: jogos, equipa, horários das lives…" />
          <span className="mt-1 block text-right text-xs text-white/40">{bio.length}/220</span></label>

        <label className={field}><span className={lab}>Link</span>
          <input className="input w-full" value={link} inputMode="url" maxLength={70} onChange={(e) => setLink(e.target.value.trim())} placeholder="youtube.com/@ocanal" autoCapitalize="none" /></label>

        <div className={field}><span className={lab}>Jogos favoritos</span>
          <div className="flex flex-wrap gap-2">
            {GAMES.map((g) => { const on = games.includes(g); return (
              <button key={g} type="button" aria-pressed={on} onClick={() => setGames((l) => (on ? l.filter((x) => x !== g) : [...l, g].slice(0, 4)))}
                className={`min-h-[44px] rounded-full border px-3.5 text-sm ${on ? 'border-neon bg-neon/20 text-white' : 'border-line bg-panel2 text-white/70'}`}>{on ? '✓ ' : ''}{g}</button>
            ); })}
          </div>
          <span className="mt-1 block text-xs text-white/45">Até 4. O primeiro aparece como jogo principal.</span></div>

        {err && <p className="mb-3 rounded-lg bg-pink/15 p-2 text-center text-sm text-pink">{err}</p>}
        <button type="button" onClick={() => void save()} disabled={busy} className="btn w-full">{busy ? 'A guardar…' : 'Guardar alterações'}</button>
      </main>
      <AvatarEditor open={photo} onClose={() => setPhoto(false)} />
    </>
  );
}
