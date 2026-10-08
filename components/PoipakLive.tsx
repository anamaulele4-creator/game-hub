'use client';

// Lives com a câmara da app (LiveKit). livekit-client é importado dinamicamente (só nas páginas de live).
import { useEffect, useRef, useState } from 'react';
import type { Room } from 'livekit-client';
import { CamApi, CameraView } from './CameraView';
import { POIPAK_OFF_MSG, getLiveToken, loadLiveKit } from '@/lib/livekit';

function Off({ text }: { text: string }) {
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-panel2 p-6 text-center">
      <p className="text-4xl">📷</p>
      <p className="text-base leading-relaxed text-white/80">{text}</p>
    </div>
  );
}

/** Anfitrião: câmara + filtros; publica o canvas filtrado e o microfone. */
export function PoipakHost({ liveId }: { liveId: string }) {
  const api = useRef<CamApi | null>(null);
  const room = useRef<Room | null>(null);
  const canvasTracks = useRef<MediaStreamTrack[]>([]);
  const [state, setState] = useState<'idle' | 'connecting' | 'live' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const [viewers, setViewers] = useState(0);

  const cleanup = () => {
    try { void room.current?.disconnect(); } catch {}
    room.current = null;
    canvasTracks.current.forEach((t) => { try { t.stop(); } catch {} });
    canvasTracks.current = [];
  };
  useEffect(() => () => cleanup(), []);

  const start = async () => {
    setMsg(''); setState('connecting');
    try {
      const c = api.current?.canvas;
      if (!c || !c.width || typeof c.captureStream !== 'function') throw new Error('A câmara ainda não está pronta ou este navegador não consegue transmitir.');
      const t = await getLiveToken(liveId);
      if (!t.token) { setState('error'); setMsg(t.off ? POIPAK_OFF_MSG : (t.error ?? POIPAK_OFF_MSG)); return; }
      const lk = await loadLiveKit();
      const r = new lk.Room({ adaptiveStream: true, dynacast: true });
      room.current = r;
      const count = () => setViewers(r.remoteParticipants.size);
      r.on(lk.RoomEvent.ParticipantConnected, count).on(lk.RoomEvent.ParticipantDisconnected, count)
        .on(lk.RoomEvent.Disconnected, () => { setState((s) => (s === 'live' ? 'idle' : s)); });
      await r.connect(t.token.url, t.token.token);
      const vs = c.captureStream(30);
      const vt = vs.getVideoTracks()[0];
      canvasTracks.current = [vt];
      await r.localParticipant.publishTrack(vt, { source: lk.Track.Source.Camera, name: 'camera-poipak', simulcast: true, videoEncoding: { maxBitrate: 1_200_000, maxFramerate: 30 } });
      const mic = (api.current?.audio ?? []).find((x) => x.readyState === 'live');
      if (mic) await r.localParticipant.publishTrack(mic, { source: lk.Track.Source.Microphone, name: 'mic' });
      count(); setState('live');
      if (!mic) setMsg('Sem microfone: a live vai sem som. Verifica a permissão do microfone.');
    } catch (e) {
      cleanup(); setState('error');
      setMsg((e as Error)?.message || 'Não foi possível começar a transmissão. Tenta outra vez.');
    }
  };
  const stop = () => { cleanup(); setState('idle'); };

  return (
    <div className="relative">
      <CameraView apiRef={api} audio compact className="h-[62vh]" locked={state === 'live' || state === 'connecting'} />
      <div className="flex flex-col gap-2 border-b border-line p-3">
        {state === 'live' ? (
          <>
            <p className="text-center text-sm text-emerald-300">● A transmitir · 👁 {viewers} a ver</p>
            <button type="button" onClick={stop} className="btn-ghost min-h-[3rem] text-base">⏸ Pausar transmissão</button>
          </>
        ) : (
          <button type="button" disabled={state === 'connecting'} onClick={start} className="btn min-h-[3.25rem] text-base disabled:opacity-50">{state === 'connecting' ? 'A ligar…' : '🔴 Começar transmissão'}</button>
        )}
        {msg && <p className="rounded-xl bg-amber-400/10 p-3 text-sm text-amber-100">{msg}</p>}
      </div>
    </div>
  );
}

/** Espectador: só vê e ouve (token subscribe-only). */
export function PoipakViewer({ liveId }: { liveId: string }) {
  const box = useRef<HTMLDivElement>(null);
  const room = useRef<Room | null>(null);
  const [state, setState] = useState<'loading' | 'waiting' | 'playing' | 'off' | 'error'>('loading');
  const [msg, setMsg] = useState('');
  const [needAudio, setNeedAudio] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const t = await getLiveToken(liveId);
        if (!alive) return;
        if (!t.token) { setState(t.off ? 'off' : 'error'); setMsg(t.off ? POIPAK_OFF_MSG : (t.error ?? POIPAK_OFF_MSG)); return; }
        const lk = await loadLiveKit();
        if (!alive) return;
        const r = new lk.Room({ adaptiveStream: true, dynacast: true });
        room.current = r;
        const refresh = () => {
          const has = Array.from(r.remoteParticipants.values()).some((p) => Array.from(p.trackPublications.values()).some((pub) => pub.kind === lk.Track.Kind.Video && pub.isSubscribed));
          setState(has ? 'playing' : 'waiting');
        };
        r.on(lk.RoomEvent.TrackSubscribed, (track) => {
          try {
            const el = track.attach();
            el.setAttribute('playsinline', 'true');
            if (track.kind === lk.Track.Kind.Video) { el.className = 'h-full w-full object-contain'; box.current?.replaceChildren(el); }
            else { el.style.display = 'none'; document.body.appendChild(el); }
          } catch {}
          setNeedAudio(!r.canPlaybackAudio);
          refresh();
        })
          .on(lk.RoomEvent.TrackUnsubscribed, (track) => { try { track.detach().forEach((el) => el.remove()); } catch {} refresh(); })
          .on(lk.RoomEvent.AudioPlaybackStatusChanged, () => setNeedAudio(!r.canPlaybackAudio))
          .on(lk.RoomEvent.ParticipantDisconnected, refresh)
          .on(lk.RoomEvent.Disconnected, () => { if (alive) setState('waiting'); });
        await r.connect(t.token.url, t.token.token, { autoSubscribe: true });
        if (alive) refresh();
      } catch (e) {
        if (alive) { setState('error'); setMsg('Não foi possível abrir a live agora. ' + ((e as Error)?.message ?? '')); }
      }
    })();
    return () => {
      alive = false;
      try {
        room.current?.remoteParticipants.forEach((p) => p.trackPublications.forEach((pub) => { try { pub.track?.detach().forEach((el) => el.remove()); } catch {} }));
        void room.current?.disconnect();
      } catch {}
      room.current = null;
    };
  }, [liveId]);

  if (state === 'off' || state === 'error') return <Off text={msg || POIPAK_OFF_MSG} />;
  return (
    <div className="relative aspect-[9/16] max-h-[70vh] w-full bg-black">
      <div ref={box} className="absolute inset-0" />
      {state !== 'playing' && (
        <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-base text-white/75">
          {state === 'loading' ? 'A ligar à live…' : 'À espera do anfitrião começar a transmitir…'}
        </p>
      )}
      {needAudio && (
        <button type="button" onClick={() => { void room.current?.startAudio().then(() => setNeedAudio(false)).catch(() => {}); }} className="absolute bottom-4 left-1/2 min-h-[3rem] -translate-x-1/2 rounded-full bg-white px-5 text-base font-semibold text-black">🔊 Ativar som</button>
      )}
    </div>
  );
}
