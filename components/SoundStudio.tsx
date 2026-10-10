'use client';

// Publicar › Som: deteta "Sem som / Som baixo / Som bom", sobe o volume automaticamente (sem recodificar),
// TXAPILOG IA sugere música livre quando não há som e pesquisa de música (Openverse, CC0/CC BY) a qualquer momento.
import { RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClipMedia, MusicRef } from '@/lib/media';
import { fmtDur } from '@/lib/media';
import type { SoundResult, VisualResult } from '@/lib/soundCheck';
import type { Track } from '@/lib/music';
import { useClipAudio } from './ClipAudio';

type Kind = 'video' | 'long' | 'photo' | 'meme' | 'text';
const SRC: Record<string, string> = { jamendo: 'Jamendo', freesound: 'Freesound', ccmixter: 'ccMixter', wikimedia_audio: 'Wikimedia' };

export function SoundStudio({ kind, file, previewUrl, duration, game, caption, tags, videoRef, onChange, disabled }: {
  kind: Kind; file: File | null; previewUrl: string | null; duration: number | null; game: string; caption: string; tags: string[];
  videoRef: RefObject<HTMLVideoElement | null>; onChange: (m: ClipMedia | undefined) => void; disabled?: boolean;
}) {
  const isVideo = (kind === 'video' || kind === 'long') && !!file;
  const [an, setAn] = useState<{ st: 'idle' | 'run' | 'done' | 'err'; p: number; r?: SoundResult }>({ st: 'idle', p: 0 });
  const [visual, setVisual] = useState<VisualResult | null>(null);
  const [autoGain, setAutoGain] = useState(true);
  const [sug, setSug] = useState<{ st: 'idle' | 'run' | 'done' | 'err'; list: Track[]; err?: string; why?: string }>({ st: 'idle', list: [] });
  const [showSearch, setShowSearch] = useState(false);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<{ st: 'idle' | 'run' | 'done' | 'err'; list: Track[]; err?: string }>({ st: 'idle', list: [] });
  const [music, setMusic] = useState<MusicRef | null>(null);
  const [origVol, setOrigVol] = useState(100);
  const [playing, setPlaying] = useState<string | null>(null);
  const pv = useRef<HTMLAudioElement | null>(null);

  // ---- 1) Análise do som (e brilho/movimento) quando há um vídeo novo
  useEffect(() => {
    setAn({ st: 'idle', p: 0 }); setVisual(null); setSug({ st: 'idle', list: [] }); setAutoGain(true);
    if (!isVideo || !file) return;
    let alive = true;
    setAn({ st: 'run', p: 0 });
    void (async () => {
      try {
        const m = await import('@/lib/soundCheck');
        const r = await m.analyseSound(file, (p) => { if (alive) setAn((a) => (a.st === 'run' ? { ...a, p } : a)); });
        if (!alive) return;
        setAn({ st: 'done', p: 1, r });
        if (previewUrl) { const v = await m.analyseVisual(previewUrl, duration); if (alive) setVisual(v); }
      } catch {
        if (alive) setAn({ st: 'err', p: 0 });
      }
    })();
    return () => { alive = false; };
  }, [file, isVideo]); // eslint-disable-line react-hooks/exhaustive-deps

  const r = an.r;
  const needMusic = !!r && (r.state === 'none' || (r.state === 'low' && !r.canRaise));

  // ---- 2) TXAPILOG IA: sugestões
  const suggest = useCallback(async () => {
    setSug({ st: 'run', list: [] });
    try {
      const sc = await import('@/lib/soundCheck');
      const mood = sc.moodFor({ game, caption, tags, visual, kind });
      const mu = await import('@/lib/music');
      const list = await mu.suggestMusic(mood.queries, duration);
      setSug({ st: 'done', list, why: `${mood.label} · porque ${mood.why}` });
    } catch (e) {
      setSug({ st: 'err', list: [], err: (e as Error).message || 'Não foi possível sugerir música agora.' });
    }
  }, [game, caption, tags, visual, kind, duration]);

  // Sugere sozinho quando o vídeo não tem som (ou não dá para subir), depois de ler brilho/movimento
  const autoAsked = useRef<string | null>(null);
  useEffect(() => {
    if (!needMusic || !previewUrl || autoAsked.current === previewUrl) return;
    const t = setTimeout(() => { autoAsked.current = previewUrl; void suggest(); }, visual ? 0 : 1500);
    return () => clearTimeout(t);
  }, [needMusic, previewUrl, visual, suggest]);

  // ---- 3) Pesquisa
  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!q.trim()) return;
    setRes({ st: 'run', list: [] });
    try { const mu = await import('@/lib/music'); setRes({ st: 'done', list: await mu.searchMusic(q) }); }
    catch (err) { setRes({ st: 'err', list: [], err: (err as Error).message || 'A pesquisa falhou.' }); }
  };

  // ---- Pré-escuta de faixas da lista
  const stopPv = () => { try { pv.current?.pause(); } catch {} setPlaying(null); };
  const togglePv = (t: Track) => {
    if (playing === t.id) { stopPv(); return; }
    try {
      if (!pv.current) pv.current = new Audio();
      const a = pv.current;
      a.src = t.url; a.volume = 0.8; a.currentTime = 0;
      a.onended = () => setPlaying(null);
      a.onerror = () => setPlaying(null);
      const p = a.play(); if (p) p.catch(() => setPlaying(null));
      setPlaying(t.id);
    } catch { setPlaying(null); }
  };
  useEffect(() => () => { try { pv.current?.pause(); if (pv.current) pv.current.src = ''; } catch {} }, []);

  const use = (t: Track) => {
    stopPv();
    setMusic({ ...t, start: 0, vol: needMusic || !isVideo ? 0.9 : 0.6 });
    if (isVideo && r && r.state !== 'none') setOrigVol((v) => (v === 100 ? 70 : v));
    setShowSearch(false);
  };

  // ---- Resultado guardado com a publicação
  const media: ClipMedia | undefined = useMemo(() => {
    const m: ClipMedia = { v: 1 };
    if (r) m.sound = r.state;
    if (r && r.state === 'low' && autoGain && r.gain > 1.05) m.gain = r.gain;
    if (music) {
      m.music = music;
      if (isVideo && r?.state !== 'none' && origVol < 100) m.orig = origVol / 100;
    }
    return m.gain || m.music || m.orig != null ? m : undefined;
  }, [r, autoGain, music, origVol, isVideo]);
  useEffect(() => { onChange(media); }, [media, onChange]);

  // Pré-visualização no leitor do Publicar: mistura e ganho reais
  useClipAudio(isVideo ? videoRef : null, media, { active: true, muted: false, near: true, videoKey: previewUrl ?? '' });
  const [demoOn, setDemoOn] = useState(false);
  useClipAudio(null, !isVideo ? media : undefined, { active: demoOn, muted: false, near: !isVideo && !!music, videoKey: 'x' });

  // Deixa de tocar ao trocar de tipo
  useEffect(() => { setDemoOn(false); }, [kind, music?.id]);

  const maxStart = music?.dur ? Math.max(0, Math.floor(music.dur - Math.min(music.dur, duration ?? 15))) : 0;

  const TrackRow = ({ t }: { t: Track }) => (
    <li className="flex items-center gap-2 rounded-xl bg-panel2 p-2">
      <button type="button" onClick={() => togglePv(t)} aria-label={playing === t.id ? `Parar ${t.title}` : `Ouvir ${t.title}`}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-base">{playing === t.id ? '⏸' : '▶'}</button>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{t.title}</span>
        <span className="block truncate text-[11px] text-white/55">{t.artist}{t.dur ? ` · ${fmtDur(t.dur)}` : ''} · {t.license} · {SRC[t.source] ?? t.source}</span>
      </span>
      <button type="button" onClick={() => use(t)} disabled={disabled} className={`shrink-0 rounded-lg px-3 py-2 text-xs font-bold ${music?.id === t.id ? 'bg-neon2/30 text-white' : 'bg-neon text-white'}`}>{music?.id === t.id ? '✓ Em uso' : 'Usar'}</button>
    </li>
  );

  return (
    <div className="card mb-4 space-y-3" aria-label="Som e música">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-sm font-semibold">🎧 Som e música</p>
        {isVideo && an.st === 'run' && <span className="chip">A analisar… {Math.round(an.p * 100)}%</span>}
        {r && (
          <span data-testid="sound-badge" className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${r.state === 'good' ? 'bg-neon/15 text-neon2' : r.state === 'low' ? 'bg-neon/15 text-neon3' : 'bg-white/10 text-white/80'}`}>
            {r.state === 'good' ? '🔊 Som bom' : r.state === 'low' ? '🔉 Som baixo' : '🔇 Sem som'}
          </span>
        )}
      </div>

      {isVideo && an.st === 'run' && (
        <div className="h-1.5 overflow-hidden rounded-full bg-panel2"><div className="h-1.5 rounded-full bg-neon2 transition-all" style={{ width: `${Math.round(an.p * 100)}%` }} /></div>
      )}
      {isVideo && an.st === 'err' && <p className="rounded-xl bg-white/5 p-2 text-xs text-white/70">Não foi possível analisar o som — podes publicar na mesma.</p>}

      {r?.state === 'low' && (
        r.canRaise ? (
          <label className="flex items-start gap-2 rounded-xl bg-neon/10 p-2.5 text-xs text-neon3">
            <input type="checkbox" className="mt-0.5" checked={autoGain} onChange={(e) => setAutoGain(e.target.checked)} disabled={disabled} />
            <span>Aumentar o som automaticamente <b>(+{Math.round(20 * Math.log10(r.gain))} dB)</b>. O vídeo não é alterado: o volume sobe ao tocar no feed.</span>
          </label>
        ) : <p className="rounded-xl bg-neon/10 p-2.5 text-xs text-neon3">O som está baixo e já tem picos altos, por isso não dá para subir mais sem distorcer. Experimenta juntar música.</p>
      )}
      {r?.state === 'good' && <p className="text-xs text-white/55">O som está bom. Se quiseres, junta música e ajusta a mistura.</p>}

      {(needMusic || (!isVideo && sug.st !== 'idle') || (isVideo && r && !needMusic && sug.st !== 'idle')) && (
        <div data-testid="music-suggestions">
          <p className="mb-1 text-xs font-semibold text-white/80">✨ TXAPILOG IA sugere{needMusic ? ' (o vídeo não tem som)' : ''}</p>
          {sug.why && <p className="mb-2 text-[11px] text-white/50">{sug.why}</p>}
          {sug.st === 'run' && <ul className="space-y-2">{[0, 1, 2].map((k) => <li key={k} className="skeleton h-14 rounded-xl" />)}</ul>}
          {sug.st === 'err' && <p className="text-xs text-red-300">{sug.err} <button type="button" className="underline" onClick={() => void suggest()}>Tentar outra vez</button></p>}
          {sug.st === 'done' && (sug.list.length ? <ul className="space-y-2">{sug.list.map((t) => <TrackRow key={t.id} t={t} />)}</ul> : <p className="text-xs text-white/60">Sem sugestões agora. Usa a pesquisa.</p>)}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {sug.st === 'idle' && (!isVideo || (r && !needMusic) || an.st === 'err') && (
          <button type="button" className="btn-ghost text-sm" onClick={() => void suggest()} disabled={disabled}>✨ Sugerir música</button>
        )}
        <button type="button" className={`btn-ghost text-sm ${sug.st === 'idle' && (!isVideo || (r && !needMusic) || an.st === 'err') ? '' : 'col-span-2'}`} onClick={() => setShowSearch((s) => !s)} disabled={disabled} aria-expanded={showSearch}>🔎 Pesquisar música</button>
      </div>

      {showSearch && (
        <div>
          <form onSubmit={search} className="flex gap-2">
            <input className="input min-w-0 flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex.: epic, lofi, hip hop, afrobeat" enterKeyHint="search" aria-label="Pesquisar música" />
            <button type="submit" className="btn shrink-0 px-4" disabled={res.st === 'run'}>{res.st === 'run' ? '…' : 'Procurar'}</button>
          </form>
          {res.st === 'err' && <p className="mt-2 text-xs text-red-300">{res.err}</p>}
          {res.st === 'done' && !res.list.length && <p className="mt-2 text-xs text-white/60">Nada encontrado. Experimenta palavras em inglês (ex.: “chill”, “epic”).</p>}
          {res.list.length > 0 && <ul className="mt-2 max-h-80 space-y-2 overflow-y-auto">{res.list.map((t) => <TrackRow key={t.id} t={t} />)}</ul>}
          <p className="mt-2 text-[11px] text-white/45">Música livre do catálogo Openverse (Jamendo, Freesound…): só licenças CC0, domínio público e CC BY, que permitem uso com vídeo. Nada é copiado do TikTok, Instagram ou YouTube.</p>
        </div>
      )}

      {music && (
        <div className="space-y-2 rounded-xl border border-line bg-panel2 p-3" data-testid="music-chosen">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">🎵 {music.title} · {music.artist}</span>
            <button type="button" className="text-xs text-pink underline" onClick={() => { setMusic(null); setOrigVol(100); setDemoOn(false); }}>Remover</button>
          </div>
          <p className="text-[11px] text-white/50">{music.attribution}</p>
          {!isVideo && (
            <button type="button" className="btn-ghost w-full text-sm" onClick={() => setDemoOn((d) => !d)}>{demoOn ? '⏸ Parar' : '▶ Ouvir o trecho'}</button>
          )}
          {maxStart > 0 && (
            <label className="block text-xs text-white/70">
              Começar a música em <b>{fmtDur(music.start)}</b>
              <input type="range" min={0} max={maxStart} step={1} value={Math.min(music.start, maxStart)} className="mt-1 w-full"
                onChange={(e) => setMusic((m) => (m ? { ...m, start: Number(e.target.value) } : m))} aria-label="Início da música" />
            </label>
          )}
          <label className="block text-xs text-white/70">
            Música: {Math.round(music.vol * 100)}%
            <input type="range" min={0} max={100} value={Math.round(music.vol * 100)} className="mt-1 w-full" onChange={(e) => setMusic((m) => (m ? { ...m, vol: Number(e.target.value) / 100 } : m))} aria-label="Volume da música" />
          </label>
          {isVideo && r?.state !== 'none' && (
            <label className="block text-xs text-white/70">
              Som original: {origVol}%
              <input type="range" min={0} max={100} value={origVol} className="mt-1 w-full" onChange={(e) => setOrigVol(Number(e.target.value))} aria-label="Volume do som original" />
            </label>
          )}
          {isVideo && <p className="text-[11px] text-white/45">Carrega ▶ no vídeo acima para ouvir a mistura.</p>}
        </div>
      )}
    </div>
  );
}
