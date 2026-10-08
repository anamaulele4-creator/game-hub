'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Clip, GRADIENTS, upsertClips } from '@/lib/data';
import { IS_DEMO } from '@/lib/config';
import { useStore } from '@/lib/store';
import { Page } from '@/components/ui';

type Kind = 'video' | 'photo' | 'text';
const KINDS: { k: Kind; label: string; icon: string }[] = [
  { k: 'video', label: 'Vídeo/Clipe', icon: '🎬' },
  { k: 'photo', label: 'Foto', icon: '📷' },
  { k: 'text', label: 'Texto/Momento', icon: '💭' },
];
const GAMES = ['Free Fire', 'eFootball', 'PUBG Mobile', 'Call of Duty Mobile', 'Mobile Legends', 'FIFA / FC Mobile', 'Geral'];
const MAX_MB = 50;
const MAX_SEC = 180;

const parseTags = (s: string) => Array.from(new Set(s.split(/[\s,]+/).map((t) => t.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '').toLowerCase()).filter(Boolean))).slice(0, 10);

export default function PublicarPage() {
  const router = useRouter();
  const { s, toast } = useStore();
  const [kind, setKind] = useState<Kind>('video');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [probe, setProbe] = useState<{ duration: number | null; thumb: Blob | null } | null>(null);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [game, setGame] = useState(GAMES[0]);
  const [tags, setTags] = useState('');
  const [vis, setVis] = useState<'public' | 'followers'>('public');
  const [q, setQ] = useState<{ limit: number; used: number; rules: boolean; active: boolean } | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);
  const [stage, setStage] = useState('');
  const [err, setErr] = useState('');
  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (IS_DEMO) { setQ({ limit: 10, used: 0, rules: true, active: true }); return; }
    void import('@/lib/clips').then((m) => m.quota()).then(setQ).catch(() => {});
  }, []);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const switchKind = (k: Kind) => { if (busy) return; setKind(k); setFile(null); setPreview(null); setProbe(null); setErr(''); };

  const onPick = async (f: File | undefined) => {
    setErr('');
    if (!f) return;
    if (f.size > MAX_MB * 1024 * 1024) { setErr(`Ficheiro grande demais: máximo ${MAX_MB} MB.`); return; }
    if (kind === 'video') {
      if (!f.type.startsWith('video/')) { setErr('Escolhe um ficheiro de vídeo.'); return; }
      const m = await import('@/lib/clips');
      const p = await m.probeVideo(f);
      if (p.duration && p.duration > MAX_SEC) { URL.revokeObjectURL(p.url); setErr(`O vídeo tem ${Math.round(p.duration)} s. O máximo é ${MAX_SEC / 60} minutos.`); return; }
      setProbe({ duration: p.duration, thumb: p.thumb }); setPreview(p.url);
    } else {
      if (!f.type.startsWith('image/')) { setErr('Escolhe uma imagem.'); return; }
      setPreview(URL.createObjectURL(f));
    }
    setFile(f);
  };

  const left = q ? Math.max(0, q.limit - q.used) : null;
  const needRules = !!q && !q.rules;
  const ready = (kind === 'text' ? title.trim().length > 0 : !!file && (kind === 'photo' || title.trim().length > 0))
    && (!needRules || agree) && left !== 0 && q?.active !== false && !busy;

  const publish = async () => {
    if (!ready) return;
    setBusy(true); setErr(''); setProg(0); setStage('A preparar…');
    const base = { title: title.trim() || (kind === 'photo' ? '📷' : ''), description: desc.trim(), game, tags: parseTags(tags), visibility: vis };
    try {
      if (IS_DEMO) {
        for (let i = 1; i <= 10; i++) { await new Promise((r) => setTimeout(r, 120)); setProg(i / 10); }
        const c: Clip = { id: 'me' + Date.now(), idolId: 'me', title: base.title, game, gradient: GRADIENTS[0], emoji: kind === 'text' ? '💭' : kind === 'photo' ? '📷' : '🎬', likes: 0, comments: 0, shares: 0, views: 0, tags: base.tags, description: base.description, kind, image: kind === 'photo' ? preview ?? undefined : undefined, video: kind === 'video' ? preview ?? undefined : undefined, visibility: vis };
        upsertClips([c]);
      } else {
        const m = await import('@/lib/clips');
        if (needRules) await m.acceptRules();
        const onP = (p: number, st: string) => { setProg(p); setStage(st); };
        const job = kind === 'video'
          ? m.publishClip({ ...base, file: file!, thumb: probe?.thumb ?? null, duration: probe?.duration ?? null }, onP)
          : m.publishPost({ ...base, kind, file }, onP);
        cancelRef.current = job.cancel;
        await job.promise;
      }
      toast(kind === 'video' ? 'Clipe publicado 🎉' : kind === 'photo' ? 'Foto publicada 🎉' : 'Momento publicado 🎉');
      router.push('/clipes');
    } catch (e) {
      const msg = (e as Error).message;
      setErr(msg === 'cancelado' ? 'Envio cancelado.' : msg);
    } finally {
      cancelRef.current = null; setBusy(false);
    }
  };

  return (
    <Page title="Publicar" back="/clipes">
      <p className="mb-3 text-sm text-white/70">Partilha as tuas jogadas, fotos e momentos. Qualquer pessoa pode ser criadora no Social POIPAK ✨</p>

      <div className="mb-4 grid grid-cols-3 gap-2">
        {KINDS.map((x) => (
          <button key={x.k} onClick={() => switchKind(x.k)} disabled={busy}
            className={`flex flex-col items-center gap-1 rounded-2xl border p-3 text-xs font-semibold ${kind === x.k ? 'border-neon bg-neon/20 text-white shadow-neon' : 'border-line bg-panel2 text-white/70'}`}>
            <span className="text-2xl">{x.icon}</span>{x.label}
          </button>
        ))}
      </div>

      {kind !== 'text' && (
        <div className="card mb-4">
          {preview ? (
            <div className="mb-3 flex justify-center overflow-hidden rounded-xl bg-black">
              {kind === 'video'
                ? <video src={preview} className="max-h-72" controls playsInline />
                // eslint-disable-next-line @next/next/no-img-element
                : <img src={preview} alt="Pré-visualização" className="max-h-72 object-contain" />}
            </div>
          ) : (
            <p className="mb-3 text-center text-4xl">{kind === 'video' ? '🎬' : '📷'}</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className={`btn-ghost cursor-pointer ${busy ? 'pointer-events-none opacity-50' : ''}`}>
              🖼️ Galeria
              <input type="file" className="hidden" accept={kind === 'video' ? 'video/*' : 'image/*'} onChange={(e) => { void onPick(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            <label className={`btn-ghost cursor-pointer ${busy ? 'pointer-events-none opacity-50' : ''}`}>
              {kind === 'video' ? '🎥 Gravar' : '📸 Câmara'}
              <input type="file" className="hidden" accept={kind === 'video' ? 'video/*' : 'image/*'} capture="environment" onChange={(e) => { void onPick(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          </div>
          <p className="mt-2 text-[11px] text-white/50">
            {kind === 'video' ? `Máximo ${MAX_MB} MB e ${MAX_SEC / 60} minutos.` : `Máximo ${MAX_MB} MB. A foto é reduzida para poupar dados.`}
            {file && ` · ${file.name} (${(file.size / 1048576).toFixed(1)} MB)`}
          </p>
        </div>
      )}

      <div className="space-y-3">
        <label className="block text-xs text-white/70">
          {kind === 'text' ? 'O teu momento' : kind === 'photo' ? 'Legenda' : 'Título'}
          {kind === 'text'
            ? <textarea className="input mt-1 w-full" rows={3} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="O que estás a jogar ou a sentir?" />
            : <input className="input mt-1 w-full" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'photo' ? 'Escreve uma legenda' : 'Ex.: Booyah com 12 kills 🔥'} />}
          <span className="float-right text-[10px] text-white/40">{title.length}/120</span>
        </label>
        <label className="block text-xs text-white/70">
          Descrição (opcional)
          <textarea className="input mt-1 w-full" rows={2} maxLength={1000} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Conta mais detalhes…" />
        </label>
        <label className="block text-xs text-white/70">
          Jogo
          <select className="input mt-1 w-full" value={game} onChange={(e) => setGame(e.target.value)}>
            {GAMES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <label className="block text-xs text-white/70">
          Hashtags
          <input className="input mt-1 w-full" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="#freefire #moçambique" />
        </label>
        <div className="text-xs text-white/70">
          Quem pode ver
          <div className="mt-1 grid grid-cols-2 gap-2">
            <button onClick={() => setVis('public')} className={`rounded-xl border p-2 text-sm ${vis === 'public' ? 'border-neon bg-neon/20' : 'border-line bg-panel2 text-white/70'}`}>🌍 Público</button>
            <button onClick={() => setVis('followers')} className={`rounded-xl border p-2 text-sm ${vis === 'followers' ? 'border-neon bg-neon/20' : 'border-line bg-panel2 text-white/70'}`}>👥 Só seguidores</button>
          </div>
        </div>

        {needRules && (
          <label className="flex items-start gap-2 rounded-xl bg-panel2 p-3 text-xs">
            <input type="checkbox" className="mt-0.5" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>Li e aceito as <Link href="/diretrizes" className="text-neon2 underline">Diretrizes da Comunidade</Link>: nada de violência real, nudez, ódio, burlas ou conteúdo de outras pessoas sem autorização.</span>
          </label>
        )}

        {q && (
          <p className="text-xs text-white/60">
            {q.active === false ? '⛔ A tua conta não pode publicar agora.' : left === 0 ? '⏳ Atingiste o limite de hoje. Volta amanhã.' : `📤 Restam ${left} de ${q.limit} publicações hoje.`}
          </p>
        )}

        {busy && (
          <div>
            <div className="mb-1 flex justify-between text-[11px] text-white/70"><span>{stage}</span><span>{Math.round(prog * 100)}%</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-panel2"><div className="h-2 rounded-full bg-gradient-to-r from-neon to-neon2 transition-all" style={{ width: `${Math.round(prog * 100)}%` }} /></div>
          </div>
        )}
        {err && <p className="rounded-xl bg-red-500/15 p-2 text-xs text-red-300">{err}</p>}

        <div className="flex gap-2 pb-6">
          {busy
            ? <button className="btn-ghost flex-1" onClick={() => cancelRef.current?.()}>✖ Cancelar envio</button>
            : <button className="btn flex-1 disabled:opacity-40" disabled={!ready} onClick={publish}>Publicar</button>}
        </div>
        {!s.account.loggedIn && !IS_DEMO && <p className="text-xs text-white/60">Entra na tua conta para publicar.</p>}
      </div>
    </Page>
  );
}
