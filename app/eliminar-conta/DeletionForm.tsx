'use client';

import Link from 'next/link';
import { useState } from 'react';
import { requestDeletionPublic } from '@/lib/auth';
import { CONTACT_EMAIL, IS_DEMO } from '@/lib/config';

export function DeletionForm() {
  const [f, setF] = useState({ contact: '', handle: '', reason: '', scope: 'Conta completa' });
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [err, setErr] = useState('');
  const submit = async () => {
    if (!f.contact.trim()) { setErr('Indica o email ou telemóvel da conta.'); return; }
    setState('sending');
    const r = await requestDeletionPublic(f.contact.trim(), f.handle.trim(), `${f.scope}${f.reason ? ' — ' + f.reason : ''}`);
    if (r.ok) setState('done'); else { setErr(r.error ?? 'Erro'); setState('error'); }
  };
  const mail = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Eliminar conta TXAPILOG')}&body=${encodeURIComponent(`Utilizador: ${f.handle}\nEmail/telemóvel: ${f.contact}\nPedido: ${f.scope}\n${f.reason}`)}`;
  if (state === 'done') return (
    <div className="card mt-4 text-center">
      <p className="text-4xl">✅</p>
      <p className="mt-2 font-semibold">Pedido recebido</p>
      <p className="mt-1 text-sm text-white/70">Vamos confirmar contigo pelo contacto indicado e concluir a eliminação em até 30 dias.{IS_DEMO ? ' (Demo: o pedido ficou guardado neste navegador; envia também o email abaixo.)' : ''}</p>
      <a href={mail} className="btn mt-3 w-full">Enviar também por email</a>
    </div>
  );
  return (
    <div id="pedido" className="card mt-4 space-y-2">
      <p className="font-semibold">Pedir eliminação (sem entrar na app)</p>
      <input className="input w-full" placeholder="Email ou telemóvel da conta *" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} />
      <input className="input w-full" placeholder="Nome de utilizador (ex.: @nyxff)" value={f.handle} onChange={(e) => setF({ ...f, handle: e.target.value })} />
      <select className="input w-full" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>
        {['Conta completa', 'Apenas os meus clipes e publicações', 'Apenas o histórico de atividade', 'Apenas comentários e mensagens'].map((o) => <option key={o}>{o}</option>)}
      </select>
      <textarea className="input min-h-20 w-full" placeholder="Motivo (opcional)" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      {err && <p className="text-xs text-pink">{err}</p>}
      <button className="btn w-full" disabled={state === 'sending'} onClick={submit}>{state === 'sending' ? 'A enviar…' : 'Enviar pedido de eliminação'}</button>
      <p className="text-center text-xs text-white/50">Ou envia email para <a className="underline" href={mail}>{CONTACT_EMAIL}</a>. Tens a app? <Link href="/definicoes#eliminar" className="text-neon2 underline">Eliminar na app</Link></p>
    </div>
  );
}
