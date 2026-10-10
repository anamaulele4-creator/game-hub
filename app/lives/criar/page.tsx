'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { GAMES } from '@/lib/feed';
import { IS_DEMO } from '@/lib/config';
import { useStore } from '@/lib/store';
import { Page } from '@/components/ui';
import { CameraView } from '@/components/CameraView';
import { AI_NAME, moderate, recordModeration, rememberPost } from '@/lib/poipakAI';
import { PLATFORM_ICON, PLATFORM_NAME, Platform, createLive, parseStream } from '@/lib/lives';
import { POIPAK_OFF_MSG, poipakLiveAvailable } from '@/lib/livekit';

const WHERE: { p: Platform; label: string; hint: string }[] = [
  { p: 'poipak', label: 'TXAPILOG (câmara da app)', hint: 'Transmite daqui, com filtros' },
  { p: 'tiktok', label: 'TikTok', hint: 'TikTok Live' },
  { p: 'youtube', label: 'YouTube', hint: 'YouTube Live' },
  { p: 'facebook', label: 'Facebook', hint: 'Facebook Live' },
  { p: 'twitch', label: 'Twitch', hint: 'Opcional' },
];
const PLACEHOLDER: Record<Platform, string> = { poipak: '', tiktok: 'https://www.tiktok.com/@nome/live', youtube: 'https://youtube.com/live/…', facebook: 'https://www.facebook.com/nome/videos/…', twitch: 'https://twitch.tv/nome' };

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const pad = (n: number) => String(n).padStart(2, '0');
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export default function CriarLivePage() {
  const router = useRouter();
  const { s, toast } = useStore();
  const [title, setTitle] = useState('');
  const [game, setGame] = useState(GAMES[0]);
  const [url, setUrl] = useState('');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [minAt, setMinAt] = useState('');
  const [cam, setCam] = useState(false);
  const [where, setWhere] = useState<Platform>('tiktok');
  const [pkOn, setPkOn] = useState<boolean | null>(null);
  useEffect(() => { if (IS_DEMO) { setPkOn(false); return; } void poipakLiveAvailable().then(setPkOn).catch(() => setPkOn(false)); }, []);

  useEffect(() => {
    const d = new Date(Date.now() + 60 * 60_000); d.setMinutes(0, 0, 0);
    setAt(localInput(d)); setMinAt(localInput(new Date()));
  }, []);

  const isPk = where === 'poipak';
  const stream = isPk ? null : parseStream(url);
  const wrongPlatform = !!stream && stream.platform !== where;
  const mod = title.trim() ? moderate(title) : null;
  const atOk = when === 'now' || (!!at && new Date(at).getTime() > Date.now() - 60_000);
  const linkOk = isPk ? pkOn === true : !!stream && !wrongPlatform;
  const ready = title.trim().length >= 3 && linkOk && atOk && !busy && mod?.level !== 'block';
  const loggedIn = IS_DEMO || s.account.loggedIn;

  const submit = async () => {
    setErr('');
    if (!title.trim() || title.trim().length < 3) { setErr('Escreve um título com pelo menos 3 letras.'); return; }
    if (isPk && !pkOn) { setErr(POIPAK_OFF_MSG); return; }
    if (!isPk && (!stream || wrongPlatform)) { setErr(`Cola o link da tua live do ${PLATFORM_NAME[where]}.`); return; }
    if (!atOk) { setErr('Escolhe uma data e hora no futuro.'); return; }
    const m = moderate(title, { checkRepeat: false });
    if (m.level === 'block') { recordModeration(m, 'criar live', title); setErr(`${m.tip} (${m.reasons.join(', ')})`); return; }
    if (m.level === 'warn') recordModeration(m, 'criar live', title);
    setBusy(true);
    try {
      if (IS_DEMO) {
        toast('Modo demonstração: a live não foi guardada.');
        router.push('/lives');
        return;
      }
      const r = await createLive({ title, game, streamUrl: url, when, at, poipak: isPk });
      if (!r.id) { setErr(r.error ?? 'Não foi possível criar a live.'); return; }
      rememberPost(title);
      toast(when === 'now' ? (isPk ? 'Live criada 🔴 Carrega em "Começar transmissão".' : 'Live criada 🔴 Os teus seguidores já a podem ver.') : 'Live agendada 📅');
      // Páginas novas (UUID) abrem pela página 404 inteligente: navegação completa
      window.location.assign(`${BASE}/lives/${encodeURIComponent(r.id)}/`);
    } catch {
      setErr('Não foi possível criar a live agora. Tenta outra vez.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="Criar live" back="/lives">
      <div className="card mb-4">
        <p className="mb-2 font-semibold">Onde vais transmitir?</p>
        <div className="grid grid-cols-2 gap-2">
          {WHERE.map((w) => (
            <button key={w.p} type="button" onClick={() => { setWhere(w.p); setErr(''); }} aria-pressed={where === w.p}
              className={`flex min-h-[4rem] flex-col items-start justify-center rounded-2xl border px-3 py-2 text-left ${w.p === 'poipak' ? 'col-span-2' : ''} ${where === w.p ? 'border-neon bg-neon/20' : 'border-line bg-panel2 text-white/80'}`}>
              <span className="text-base font-bold">{PLATFORM_ICON[w.p]} {w.label}</span>
              <span className="text-xs text-white/60">{w.hint}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-sm leading-relaxed text-white/70">
          {isPk ? 'Transmites daqui com a câmara do telemóvel e os filtros TXAPILOG. Os fãs veem e falam contigo no chat, dentro do TXAPILOG.'
            : `Começa a live na app do ${PLATFORM_NAME[where]}, copia o link e cola-o aqui. Os fãs veem-na dentro do TXAPILOG${where === 'tiktok' ? ' (o TikTok não deixa mostrar a live noutro site: os fãs veem um cartão com "Abrir no TikTok" e o chat do TXAPILOG)' : ''}.`}
        </p>
        {isPk && pkOn === false && <p className="mt-2 rounded-xl bg-neon/10 p-3 text-sm text-neon3">{POIPAK_OFF_MSG}</p>}
        {isPk && pkOn === null && <p className="mt-2 text-sm text-white/50">A verificar…</p>}
      </div>

      {isPk && (
        <div className="card mb-4">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">📷 Pré-visualização</p>
            <button type="button" className="btn-ghost min-h-[2.75rem] px-4 text-sm" onClick={() => setCam((v) => !v)}>{cam ? 'Fechar câmara' : 'Abrir câmara'}</button>
          </div>
          {cam && <CameraView audio={false} compact className="mt-3 h-[60vh] rounded-xl" />}
          <p className="mt-2 text-sm leading-relaxed text-white/65">Escolhe o filtro aqui ou já na página da live. A transmissão começa quando carregares em “Começar transmissão”.</p>
        </div>
      )}

      {!loggedIn ? (
        <div className="card text-center">
          <p className="text-base">Entra na tua conta para criar uma live.</p>
          <Link href="/entrar" className="btn mt-3 inline-block">Entrar</Link>
        </div>
      ) : (
        <div className="space-y-4">
          <label className="block text-sm text-white/80">
            Título da live
            <input className="input mt-1 w-full text-base" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Ranqueada com seguidores 🔥" />
            <span className="float-right text-xs text-white/40">{title.length}/120</span>
          </label>

          <label className="block text-sm text-white/80">
            Jogo
            <select className="input mt-1 w-full text-base" value={game} onChange={(e) => setGame(e.target.value)}>
              {GAMES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>

          {!isPk && (<>
          <label className="block text-sm text-white/80">
            Link da live no {PLATFORM_NAME[where]}
            <input className="input mt-1 w-full text-base" inputMode="url" autoCapitalize="off" autoCorrect="off" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={PLACEHOLDER[where]} />
          </label>
          {url.trim() && !stream && <p className="-mt-2 text-sm text-red-300">Link não reconhecido. Cola o link da tua live do {PLATFORM_NAME[where]}.</p>}
          {wrongPlatform && <p className="-mt-2 text-sm text-red-300">Este link é do {PLATFORM_NAME[stream!.platform]}. Escolhe {PLATFORM_NAME[stream!.platform]} em cima ou cola um link do {PLATFORM_NAME[where]}.</p>}
          {stream && !wrongPlatform && <p className="-mt-2 text-sm text-neon2">{PLATFORM_ICON[stream.platform]} Link do {PLATFORM_NAME[stream.platform]} reconhecido ✓</p>}
          </>)}

          <div className="text-sm text-white/80">
            Quando
            <div className="mt-1 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setWhen('now')} className={`min-h-[3.25rem] rounded-2xl border p-3 text-base font-semibold ${when === 'now' ? 'border-neon bg-neon/20' : 'border-line bg-panel2 text-white/75'}`}>🔴 Agora</button>
              <button type="button" onClick={() => setWhen('later')} className={`min-h-[3.25rem] rounded-2xl border p-3 text-base font-semibold ${when === 'later' ? 'border-neon bg-neon/20' : 'border-line bg-panel2 text-white/75'}`}>📅 Agendar</button>
            </div>
          </div>
          {when === 'later' && (
            <label className="block text-sm text-white/80">
              Data e hora
              <input type="datetime-local" className="input mt-1 w-full text-base" min={minAt} value={at} onChange={(e) => setAt(e.target.value)} />
              {!atOk && <span className="mt-1 block text-sm text-red-300">Escolhe uma data e hora no futuro.</span>}
            </label>
          )}

          {mod && mod.level !== 'ok' && (
            <div className={`rounded-xl p-3 text-sm ${mod.level === 'block' ? 'bg-red-500/10 text-red-200' : 'bg-neon/10 text-neon3'}`}>
              <p className="font-semibold">🛡️ {AI_NAME}: {mod.level === 'block' ? 'este título não pode ser usado' : 'sugestão'}</p>
              <p className="mt-0.5 text-xs opacity-90">{mod.tip} ({mod.reasons.join(', ')})</p>
            </div>
          )}
          {err && <p className="rounded-xl bg-red-500/15 p-3 text-sm text-red-300">{err}</p>}

          <button className="btn min-h-[3.25rem] w-full text-base disabled:opacity-40" disabled={!ready} onClick={submit}>
            {busy ? 'A criar…' : when === 'now' ? '🔴 Começar live' : '📅 Agendar live'}
          </button>
          <p className="pb-6 text-center text-xs text-white/50">Segue as <Link href="/diretrizes" className="underline">Diretrizes da Comunidade</Link> durante a live.</p>
        </div>
      )}
    </Page>
  );
}
