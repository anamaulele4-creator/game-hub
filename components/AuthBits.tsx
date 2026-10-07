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
    <div className="rounded-xl border border-amber-400/50 bg-amber-400/10 p-3 text-center">
      <p className="text-[11px] text-amber-200">Modo demonstração: nenhum email/SMS foi enviado. O teu código é:</p>
      <p className="mt-1 font-mono text-2xl font-bold tracking-[0.4em] text-amber-300">{code}</p>
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
