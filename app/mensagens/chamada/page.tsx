'use client';

// Ecrã de chamada (voz/vídeo, 1:1 e grupo até ~8) com LiveKit. livekit-client só é carregado aqui.
// ?c=<conversa>&v=1 (vídeo) &in=1 (chamada recebida e atendida)
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Room, Track as LkTrack } from 'livekit-client';
import { Avatar } from '@/components/ui';
import { IS_DEMO } from '@/lib/config';
import { useStore } from '@/lib/store';
import type { Chat, ChatMsg } from '@/lib/chat';

type Phase = 'checking' | 'off' | 'ringing' | 'connecting' | 'in' | 'ended';
interface Tile { id: string; name: string; avatar: string; local: boolean; video?: LkTrack | MediaStream | null; camOn: boolean; micOn: boolean; speaking: boolean }

function VideoEl({ src, mirror }: { src: LkTrack | MediaStream; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (src instanceof MediaStream) { el.srcObject = src; void el.play().catch(() => {}); return () => { el.srcObject = null; }; }
    src.attach(el);
    return () => { try { src.detach(el); } catch {} };
  }, [src]);
  return <video ref={ref} autoPlay playsInline muted className={`h-full w-full object-cover ${mirror ? '-scale-x-100' : ''}`} />;
}

function TileView({ t, big }: { t: Tile; big?: boolean }) {
  return (
    <div className={`relative flex items-center justify-center overflow-hidden rounded-2xl bg-[#1b1f24] ${t.speaking ? 'ring-2 ring-lime' : ''} ${big ? 'h-full w-full rounded-none' : 'aspect-[3/4] w-full'}`}>
      {t.video && t.camOn ? <VideoEl src={t.video} mirror={t.local} /> : <Avatar a={t.avatar} name={t.name} size={big ? 128 : 72} />}
      <span className="absolute bottom-2 left-2 rounded-full bg-black/55 px-2 py-0.5 text-xs">{t.local ? 'Tu' : t.name.split(' ')[0]}{!t.micOn && ' 🔇'}</span>
    </div>
  );
}

function Call() {
  const params = useSearchParams();
  const router = useRouter();
  const { s, ready } = useStore();
  const cid = params.get('c') ?? '';
  const incoming = params.get('in') === '1';
  const [video] = useState(params.get('v') === '1');
  const [phase, setPhase] = useState<Phase>('checking');
  const [msg, setMsg] = useState('');
  const [chat, setChat] = useState<Chat | null>(null);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(video);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [speaker, setSpeaker] = useState(video);
  const [secs, setSecs] = useState(0);
  const room = useRef<Room | null>(null);
  const audioBox = useRef<HTMLDivElement>(null);
  const demoStream = useRef<MediaStream | null>(null);
  const started = useRef(0);
  const callMsg = useRef<ChatMsg | null>(null);
  const meRef = useRef('');
  const stopTone = useRef<() => void>(() => {});
  const stopRing = useRef<() => void>(() => {});
  const ended = useRef(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const others = (chat?.members ?? []).filter((m) => m.id !== meRef.current);
  const title = chat?.title ?? '';

  // Volume do "altifalante"
  useEffect(() => { audioBox.current?.querySelectorAll('audio').forEach((a) => { a.volume = speaker ? 1 : 0.45; }); }, [speaker, tiles.length]);
  useEffect(() => { if (phase !== 'in') return; const iv = setInterval(() => setSecs(Math.round((Date.now() - started.current) / 1000)), 1000); return () => clearInterval(iv); }, [phase]);

  const sync = useCallback(async () => {
    const r = room.current; if (!r) return;
    const lk = await import('livekit-client');
    const mk = (p: import('livekit-client').Participant, local: boolean): Tile => {
      const camPub = p.getTrackPublication(lk.Track.Source.Camera);
      const micPub = p.getTrackPublication(lk.Track.Source.Microphone);
      const m = (chat?.members ?? []).find((x) => x.id === p.identity);
      return { id: p.identity, name: p.name || m?.name || 'Participante', avatar: m?.avatar || '🙂', local, video: camPub?.track ?? null, camOn: !!camPub?.track && !camPub.isMuted, micOn: !!micPub && !micPub.isMuted, speaking: p.isSpeaking };
    };
    setTiles([mk(r.localParticipant, true), ...Array.from(r.remoteParticipants.values()).slice(0, 7).map((p) => mk(p, false))]);
  }, [chat?.members]);

  const finish = useCallback(async (status?: 'perdida' | 'recusada', note = 'Chamada terminada') => {
    if (ended.current) return;
    ended.current = true;
    stopTone.current(); stopRing.current();
    if (timeout.current) clearTimeout(timeout.current);
    const dur = started.current ? Math.round((Date.now() - started.current) / 1000) : 0;
    try { await room.current?.disconnect(); } catch {}
    room.current = null;
    demoStream.current?.getTracks().forEach((t) => t.stop());
    setPhase('ended'); setMsg(note);
    const lib = await import('@/lib/chat');
    const calls = await import('@/lib/calls');
    if (callMsg.current && !IS_DEMO) {
      await lib.updateCall(callMsg.current, { video, status: status ?? (started.current ? 'atendida' : 'perdida'), dur }).catch(() => ({}));
    }
    if (!incoming && chat && !started.current) void calls.ringUsers(others.map((m) => m.id), 'hangup', { conv: cid, from: meRef.current, name: s.user.name, avatar: s.user.avatar, video, at: Date.now() });
    if (IS_DEMO && chat) await lib.send(cid, { kind: 'chamada', meta: { call: { video, status: 'atendida', dur: Math.max(dur, 1) } } });
    setTimeout(() => router.replace(`/mensagens/chat?c=${encodeURIComponent(cid)}`), 1300);
  }, [video, incoming, chat, others, cid, s.user.name, s.user.avatar, router]);

  // Arranque
  useEffect(() => {
    if (!ready || !cid) return;
    let cancelled = false;
    (async () => {
      const lib = await import('@/lib/chat');
      const calls = await import('@/lib/calls');
      const [c, me, ok] = await Promise.all([lib.getChat(cid), lib.myId(), calls.callsAvailable()]);
      if (cancelled) return;
      meRef.current = me;
      if (!c) { setPhase('off'); setMsg('Conversa não encontrada.'); return; }
      setChat(c);
      if (!ok) { setPhase('off'); setMsg(calls.CALLS_OFF_MSG); return; }

      if (IS_DEMO) {
        // Demonstração: câmara local + participantes simulados
        if (video) { try { demoStream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false }); } catch {} }
        const meTile: Tile = { id: me, name: s.user.name, avatar: s.user.avatar, local: true, video: demoStream.current, camOn: !!demoStream.current, micOn: true, speaking: false };
        setTiles([meTile]);
        setPhase(incoming ? 'connecting' : 'ringing');
        if (!incoming) stopTone.current = calls.ringtone('out');
        setTimeout(() => {
          if (cancelled || ended.current) return;
          stopTone.current();
          started.current = Date.now(); setPhase('in');
          const rem = c.members.filter((m) => m.id !== me).slice(0, 7).map((m, i) => ({ id: m.id, name: m.name, avatar: m.avatar, local: false, video: null, camOn: false, micOn: i !== 1, speaking: i === 0 }));
          setTiles([meTile, ...rem]);
        }, 2200);
        return;
      }

      setPhase(incoming ? 'connecting' : 'ringing');
      const tk = await calls.getCallToken(cid);
      if (cancelled) return;
      if (!tk.token || !tk.url) { setPhase('off'); setMsg(tk.error ?? calls.CALLS_OFF_MSG); return; }
      const lk = await import('livekit-client');
      const r = new lk.Room({ adaptiveStream: true, dynacast: true, videoCaptureDefaults: { resolution: lk.VideoPresets.h540.resolution, facingMode: 'user' }, audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      room.current = r;
      const onJoin = () => { if (!started.current) { started.current = Date.now(); stopTone.current(); if (timeout.current) clearTimeout(timeout.current); setPhase('in'); } void sync(); };
      r.on(lk.RoomEvent.ParticipantConnected, onJoin)
        .on(lk.RoomEvent.ParticipantDisconnected, () => { void sync(); if (r.remoteParticipants.size === 0 && started.current && c.kind !== 'grupo') void finish(); })
        .on(lk.RoomEvent.TrackSubscribed, (track) => { if (track.kind === lk.Track.Kind.Audio) { const el = track.attach(); el.volume = speaker ? 1 : 0.45; audioBox.current?.appendChild(el); } void sync(); })
        .on(lk.RoomEvent.TrackUnsubscribed, (track) => { track.detach().forEach((el) => el.remove()); void sync(); })
        .on(lk.RoomEvent.TrackMuted, () => void sync()).on(lk.RoomEvent.TrackUnmuted, () => void sync())
        .on(lk.RoomEvent.LocalTrackPublished, () => void sync()).on(lk.RoomEvent.ActiveSpeakersChanged, () => void sync())
        .on(lk.RoomEvent.Disconnected, () => { if (!ended.current) void finish(undefined, 'Ligação perdida'); });
      try {
        await r.connect(tk.url, tk.token);
        await r.localParticipant.setMicrophoneEnabled(true).catch(() => setMic(false));
        if (video) await r.localParticipant.setCameraEnabled(true, { facingMode: 'user' }).catch(() => setCam(false));
        await r.startAudio().catch(() => {});
      } catch (e) {
        setPhase('off'); setMsg('Não foi possível ligar: ' + ((e as Error)?.message || 'verifica a internet.')); return;
      }
      void sync();
      if (r.remoteParticipants.size > 0) onJoin();
      if (!incoming) {
        stopTone.current = calls.ringtone('out');
        const sent = await lib.send(cid, { kind: 'chamada', meta: { call: { video, status: 'a chamar' } } });
        if (sent.msg) callMsg.current = sent.msg;
        const ids = c.members.filter((m) => m.id !== me).map((m) => m.id);
        void calls.ringUsers(ids, 'ring', { conv: cid, from: me, name: s.user.name, avatar: s.user.avatar, video, group: c.kind === 'grupo' ? c.title : undefined, msg: sent.msg?.id, at: Date.now() });
        stopRing.current = calls.listenRing(me, (ev, p) => { if (p.conv === cid && ev === 'decline' && c.kind !== 'grupo' && !started.current) void finish('recusada', 'Chamada recusada'); });
        timeout.current = setTimeout(() => { if (!started.current) void finish('perdida', 'Sem resposta'); }, calls.RING_TIMEOUT_MS);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, cid]);

  // Sair da página termina a chamada
  useEffect(() => () => { stopTone.current(); stopRing.current(); try { void room.current?.disconnect(); } catch {} demoStream.current?.getTracks().forEach((t) => t.stop()); }, []);

  const toggleMic = async () => {
    const n = !mic; setMic(n);
    if (room.current) await room.current.localParticipant.setMicrophoneEnabled(n).catch(() => {});
    setTiles((t) => t.map((x) => (x.local ? { ...x, micOn: n } : x)));
  };
  const toggleCam = async () => {
    const n = !cam; setCam(n);
    if (room.current) { await room.current.localParticipant.setCameraEnabled(n, { facingMode: facing }).catch(() => setCam(false)); void sync(); return; }
    if (IS_DEMO) {
      if (!n) { demoStream.current?.getTracks().forEach((t) => t.stop()); demoStream.current = null; }
      else { try { demoStream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false }); } catch {} }
      setTiles((t) => t.map((x) => (x.local ? { ...x, video: demoStream.current, camOn: !!demoStream.current } : x)));
    }
  };
  const flip = async () => {
    const f = facing === 'user' ? 'environment' : 'user'; setFacing(f);
    if (room.current) {
      const lk = await import('livekit-client');
      const tr = room.current.localParticipant.getTrackPublication(lk.Track.Source.Camera)?.track as import('livekit-client').LocalVideoTrack | undefined;
      await tr?.restartTrack({ facingMode: f }).catch(() => {});
      void sync();
    } else if (IS_DEMO && demoStream.current) {
      demoStream.current.getTracks().forEach((t) => t.stop());
      try { demoStream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: f }, audio: false }); } catch { demoStream.current = null; }
      setTiles((t) => t.map((x) => (x.local ? { ...x, video: demoStream.current, camOn: !!demoStream.current } : x)));
    }
  };

  const status = phase === 'checking' ? 'A preparar…' : phase === 'ringing' ? 'A chamar…' : phase === 'connecting' ? 'A ligar…' : phase === 'in' ? `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}` : phase === 'ended' ? msg : '';
  const remote = tiles.filter((t) => !t.local);
  const local = tiles.find((t) => t.local);
  const grid = remote.length > 1;

  if (phase === 'off') return (
    <div className="flex min-h-[100vh] flex-col items-center justify-center gap-4 bg-[#0d1013] px-6 text-center">
      <p className="text-5xl">📞</p>
      <p className="text-lg font-semibold">{msg}</p>
      <p className="text-sm text-white/55">Enquanto isso, envia uma mensagem de voz 🎤</p>
      <button className="btn w-full max-w-xs" onClick={() => router.replace(cid ? `/mensagens/chat?c=${encodeURIComponent(cid)}` : '/mensagens')}>Voltar à conversa</button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[80] mx-auto flex max-w-md flex-col bg-[#0d1013]">
      <div ref={audioBox} className="hidden" />
      {/* Área principal */}
      <div className="relative flex-1 overflow-hidden">
        {phase === 'in' && video && !grid && remote[0] ? (
          <TileView t={remote[0]} big />
        ) : phase === 'in' && grid ? (
          <div className={`grid h-full content-center gap-2 p-2 pt-24 ${tiles.length > 4 ? 'grid-cols-3' : 'grid-cols-2'}`}>{tiles.map((t) => <TileView key={t.id} t={t} />)}</div>
        ) : video && local?.video && local.camOn && phase !== 'in' ? (
          <div className="absolute inset-0 opacity-60"><VideoEl src={local.video} mirror /></div>
        ) : null}
        {(!grid || phase !== 'in') && !(phase === 'in' && video && remote[0]?.camOn) && (
          <div className="absolute inset-x-0 top-24 flex flex-col items-center gap-3 text-center">
            <Avatar a={chat?.photo} name={title} size={128} className={phase === 'ringing' ? 'animate-pulseGlow' : ''} />
          </div>
        )}
        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent px-4 pb-8 pt-[calc(1rem+env(safe-area-inset-top))] text-center">
          <p className="text-xs text-white/60">🔒 {video ? 'Chamada de vídeo' : 'Chamada de voz'} POIPAK{IS_DEMO ? ' · demonstração' : ''}</p>
          <p className="mt-1 truncate text-2xl font-bold">{title || '…'}</p>
          <p className="text-sm text-white/75">{status}{chat?.kind === 'grupo' && phase === 'in' ? ` · ${tiles.length} na chamada` : ''}</p>
        </div>
        {phase === 'in' && video && !grid && local && (
          <div className="absolute bottom-4 right-3 h-40 w-28 overflow-hidden rounded-xl border border-white/20 shadow-lg"><TileView t={local} big /></div>
        )}
      </div>
      {/* Controlos */}
      <div className="flex items-center justify-around gap-2 bg-[#15191d] px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4">
        <Ctl on={speaker} icon={speaker ? '🔊' : '🔈'} label="Altifalante" onClick={() => setSpeaker((x) => !x)} />
        {video && <Ctl on={cam} icon={cam ? '📷' : '🚫'} label={cam ? 'Câmara' : 'Câmara off'} onClick={() => void toggleCam()} />}
        {video && <Ctl on icon="🔄" label="Virar" onClick={() => void flip()} disabled={!cam} />}
        <Ctl on={mic} icon={mic ? '🎙️' : '🔇'} label={mic ? 'Microfone' : 'Sem som'} onClick={() => void toggleMic()} />
        <button onClick={() => void finish()} disabled={phase === 'ended'} className="flex flex-col items-center gap-1 text-[11px] text-white/80" aria-label="Terminar chamada">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-2xl">✆</span>Terminar
        </button>
      </div>
    </div>
  );
}

function Ctl({ on, icon, label, onClick, disabled }: { on: boolean; icon: string; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-pressed={on} aria-label={label} className="flex flex-col items-center gap-1 text-[11px] text-white/80 disabled:opacity-40">
      <span className={`flex h-14 w-14 items-center justify-center rounded-full text-2xl ${on ? 'bg-white/15' : 'bg-white text-black'}`}>{icon}</span>{label}
    </button>
  );
}

export default function ChamadaPage() {
  return <Suspense fallback={<div className="min-h-[100vh] bg-[#0d1013]" />}><Call /></Suspense>;
}
