'use client';

import { useState } from 'react';
import { Channel, isEmail, normalizePhone } from '@/lib/auth';
import { IS_DEMO } from '@/lib/config';

export function ChannelTabs({ value, onChange }: { value: Channel; onChange: (c: Channel) => void }) {
  return (
    <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl bg-panel2 p-1 text-sm">
      {(['email', 'phone'] as const).map((c) => (
        <button key={c} onClick={() => onChange(c)} className={`rounded-lg py-2 ${value === c ? 'bg-neon font-semibold' : 'text-white/60'}`}>{c === 'email' ? '✉️ Email (Gmail)' : '📱 Telemóvel'}</button>
      ))}
    </div>
  );
}

export function ContactInput({ channel, value, onChange }: { channel: Channel; value: string; onChange: (v: string) => void }) {
  return channel === 'email'
    ? <input className="input w-full" type="email" autoComplete="email" inputMode="email" placeholder="o-teu-email@gmail.com" value={value} onChange={(e) => onChange(e.target.value)} />
    : (
      <div className="flex gap-2">
        <span className="input shrink-0">🇲🇿 +258</span>
        <input className="input w-full" type="tel" autoComplete="tel" inputMode="tel" placeholder="84 123 4567" value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    );
}

/** Devolve o identificador normalizado ou mensagem de erro. */
export function checkContact(channel: Channel, v: string): { id?: string; error?: string } {
  if (channel === 'email') return isEmail(v) ? { id: v.trim().toLowerCase() } : { error: 'Email inválido.' };
  const p = normalizePhone(v);
  return p ? { id: p } : { error: 'Número inválido. Ex.: 84 123 4567' };
}

export function DemoCode({ code }: { code?: string }) {
  if (!IS_DEMO || !code) return null;
  return (
    <div className="rounded-xl border border-neon/50 bg-neon/10 p-3 text-center">
      <p className="text-xs text-neon2">Modo demonstração: nenhum email/SMS foi enviado. O teu código é:</p>
      <p className="mt-1 font-mono text-2xl font-bold tracking-[0.4em] text-neon">{code}</p>
    </div>
  );
}

export function OtpInput({ onSubmit, busy }: { onSubmit: (code: string) => void; busy?: boolean }) {
  const [code, setCode] = useState('');
  return (
    <div className="space-y-2">
      <input className="input w-full text-center font-mono text-2xl tracking-[0.5em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="••••••" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
      <button className="btn w-full" disabled={code.length !== 6 || busy} onClick={() => onSubmit(code)}>{busy ? 'A verificar…' : 'Confirmar código'}</button>
    </div>
  );
}

export function Err({ msg }: { msg?: string }) {
  return msg ? <p className="text-xs text-pink">{msg}</p> : null;
}

/** Logótipo "G" oficial do Google (4 cores). */
export function GoogleG({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
  );
}

/** Botão principal "Continuar com Google" (branco, estilo oficial). */
export function GoogleButton({ label = 'Continuar com Google', hint }: { label?: string; hint?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div>
      <button type="button" disabled={busy} onClick={async () => {
        setErr(''); setBusy(true);
        const next = new URLSearchParams(window.location.search).get('next') || undefined;
        const r = await (await import('@/lib/auth')).signInWithGoogle(next, hint).catch(() => ({ ok: false, error: 'Entrar com Google ainda não está ativo. Usa outra opção.' }));
        if (!r.ok) { setErr(r.error || 'Não foi possível abrir o Google.'); setBusy(false); }
      }}
        className="flex min-h-[48px] w-full items-center justify-center gap-3 rounded-xl border border-[#dadce0] bg-white px-4 py-3 text-base font-semibold text-[#3c4043] transition-colors hover:bg-[#f7f8f8] active:bg-[#eef0f1] disabled:opacity-60">
        <GoogleG />{busy ? 'A abrir o Google…' : label}
      </button>
      {err && <p className="mt-2 rounded-lg bg-panel2 p-2 text-center text-sm text-white/80">{err}</p>}
    </div>
  );
}

/** Secção recolhível "Outras opções". */
export function MoreOptions({ children, label = 'Outras opções (email ou telemóvel)', defaultOpen }: { children: React.ReactNode; label?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="mt-4">
      <div className="mb-3 flex items-center gap-3 text-sm text-white/50"><span className="h-px flex-1 bg-line" />ou<span className="h-px flex-1 bg-line" /></div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="btn-ghost w-full" aria-expanded={open}>{label} {open ? '▴' : '▾'}</button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}
