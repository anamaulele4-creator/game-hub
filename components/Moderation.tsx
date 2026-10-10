'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ReportKind, useStore } from '@/lib/store';
import { Sheet } from './ui';

export const REPORT_REASONS = [
  'Segurança de menores', 'Assédio ou bullying', 'Discurso de ódio', 'Conteúdo sexual ou nudez', 'Violência ou automutilação',
  'Burla / diamantes grátis', 'Spam ou enganoso', 'Batota / hacks', 'Direitos de autor', 'Outro',
];

/** Botão ⋯ com Denunciar / Bloquear. `owner` é o id do autor (idolId ou nome) para bloquear. */
export function MoreMenu({ kind, target, label, owner, ownerLabel, className = '' }: { kind: ReportKind; target: string; label: string; owner?: string; ownerLabel?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'menu' | 'report' | 'done'>('menu');
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const { report, toggleBlock, isBlocked } = useStore();
  const close = () => { setOpen(false); setStep('menu'); setReason(''); setDetails(''); };
  const blocked = owner ? isBlocked(owner) : false;
  return (
    <>
      <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }} className={`rounded-full px-2 text-lg text-white/70 ${className}`} aria-label="Mais opções">⋯</button>
      <div onClick={(e) => e.stopPropagation()}>
        <Sheet open={open} onClose={close} title={step === 'report' ? 'Denunciar' : step === 'done' ? 'Obrigado' : 'Opções'}>
          {step === 'menu' && (
            <div className="space-y-2">
              <button className="flex w-full items-center gap-3 rounded-xl bg-panel2 p-3 text-left" onClick={() => setStep('report')}>🚩 <span className="flex-1">Denunciar {kind}</span></button>
              {owner && (
                <button className="flex w-full items-center gap-3 rounded-xl bg-panel2 p-3 text-left" onClick={() => { toggleBlock(owner, ownerLabel); close(); }}>
                  🚫 <span className="flex-1">{blocked ? 'Desbloquear' : 'Bloquear'} {ownerLabel ?? 'utilizador'}</span>
                </button>
              )}
              <Link href="/diretrizes" onClick={close} className="flex w-full items-center gap-3 rounded-xl bg-panel2 p-3 text-left">📘 <span className="flex-1">Diretrizes da Comunidade</span></Link>
            </div>
          )}
          {step === 'report' && (
            <div className="space-y-2">
              <p className="text-xs text-white/60">Porque estás a denunciar “{label}”? A denúncia é anónima para o autor.</p>
              <div className="grid grid-cols-2 gap-2">
                {REPORT_REASONS.map((r) => <button key={r} onClick={() => setReason(r)} className={`rounded-xl border p-2 text-left text-xs ${reason === r ? 'border-neon bg-neon/20' : 'border-line bg-panel2'}`}>{r}</button>)}
              </div>
              <textarea className="input min-h-16 w-full" placeholder="Detalhes (opcional)" value={details} onChange={(e) => setDetails(e.target.value)} />
              {reason === 'Segurança de menores' && <p className="rounded-lg bg-pink/20 p-2 text-xs">Prioridade máxima. Em perigo imediato liga 119 (polícia) ou 116 (Linha Fala Criança). <Link href="/seguranca-infantil" className="underline">Normas de segurança infantil</Link></p>}
              <button className="btn w-full" disabled={!reason} onClick={() => { report(kind, target, label, details ? `${reason}: ${details}` : reason); setStep('done'); }}>Enviar denúncia</button>
            </div>
          )}
          {step === 'done' && (
            <div className="space-y-3 text-center">
              <p className="text-4xl">🛡️</p>
              <p className="text-sm">Recebemos a tua denúncia e revemos em até 24 h.</p>
              {owner && !blocked && <button className="btn-ghost w-full" onClick={() => { toggleBlock(owner, ownerLabel); close(); }}>Bloquear também {ownerLabel ?? 'o autor'}</button>}
              <button className="btn w-full" onClick={close}>Fechar</button>
            </div>
          )}
        </Sheet>
      </div>
    </>
  );
}
