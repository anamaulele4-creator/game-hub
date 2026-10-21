'use client';

// Verificação de vendedor (contas e diamantes) — usa o KYC UNIFICADO (o mesmo formulário de /seguranca/verificacao,
// finalidade "vendedor": documento com foto + selfie). A decisão é tomada na fila única Admin › KYC.
import Link from 'next/link';
import { VerificationCenter } from '@/components/kyc/VerificationCenter';
import { Verification, affApi } from '@/lib/affiliatesApi';

export function SellerVerification({ v, onChange }: { v: Verification; onChange: (v: Verification) => void }) {
  if (v.status === 'aprovado') return <p className="bx-card p-3 text-[13px] text-[#86EFAC]">✓ Vendedor verificado: podes vender contas e diamantes.</p>;
  return (
    <section className="bx-card space-y-3 p-4 text-[13.5px]" aria-label="Verificação de vendedor">
      <p className="font-bold">Verificação de vendedor</p>
      <p className="bx-muted">Para vender <b>contas</b> e <b>diamantes/moedas</b> precisamos de confirmar quem és: documento de identificação (BI, passaporte, carta de condução ou DIRE) e uma selfie. Protege compradores contra burlas.</p>
      <VerificationCenter purpose="vendedor" compact onChange={() => { void affApi.myVerification().then(onChange); }} />
      <Link href="/seguranca/verificacao" className="bx-acc block text-[12.5px] font-semibold underline">Ver todas as minhas verificações</Link>
    </section>
  );
}
