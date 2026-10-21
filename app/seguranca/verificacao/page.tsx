'use client';

// Verificação de identidade e documentos (KYC unificado) — para TODOS os utilizadores.
// ?f=vendedor|afiliado|levantamento|criador|identidade abre já com essa finalidade.
import { useEffect, useState } from 'react';
import { Page } from '@/components/ui';
import { VerificationCenter } from '@/components/kyc/VerificationCenter';
import { PURPOSES, PURPOSE_LABEL, type KycPurpose } from '@/lib/kyc';

export default function Verificacao() {
  const [purpose, setPurpose] = useState<KycPurpose | undefined | null>(null);
  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get('f');
    setPurpose(PURPOSES.includes(f as KycPurpose) ? (f as KycPurpose) : undefined);
  }, []);
  return (
    <Page title="Verificação de identidade" back="/seguranca">
      <p className="mb-3 text-sm text-white/70">Um só sítio para verificar a tua identidade e enviar documentos — para vender contas e diamantes, afiliados e moderadores, levantamentos e criadores.</p>
      {purpose && (
        <p className="mb-3 rounded-lg bg-panel2 p-2 text-xs">Finalidade: <b>{PURPOSE_LABEL[purpose]}</b> · <a href="?" className="underline" onClick={(e) => { e.preventDefault(); window.history.replaceState(null, '', window.location.pathname); setPurpose(undefined); }}>ver todas</a></p>
      )}
      {purpose === null ? <div className="card h-24 animate-pulse" /> : <VerificationCenter key={purpose ?? 'all'} purpose={purpose} />}
    </Page>
  );
}
