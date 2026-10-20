'use client';

// Verificação de vendedor (contas e diamantes): foto do documento + selfie → análise pelo admin.
// As fotos vão para um armazenamento PRIVADO (bucket "verificacoes"); só a equipa as vê, com links temporários.
import Link from 'next/link';
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { AFF_ERR, VERIF_LABEL } from '@/lib/affiliates';
import { Verification, affApi } from '@/lib/affiliatesApi';

export function SellerVerification({ v, onChange }: { v: Verification; onChange: (v: Verification) => void }) {
  const { toast } = useStore();
  const [doc, setDoc] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  if (v.status === 'aprovado') return <p className="bx-card p-3 text-[13px] text-[#86EFAC]">✓ Vendedor verificado: podes vender contas e diamantes.</p>;
  const canSend = v.status !== 'pendente';
  return (
    <section className="bx-card space-y-3 p-4 text-[13.5px]" aria-label="Verificação de vendedor">
      <div className="flex items-center justify-between gap-2">
        <p className="font-bold">Verificação de vendedor</p>
        <span className="bx-tag bg-white/15 text-white">{VERIF_LABEL[v.status]}</span>
      </div>
      <p className="bx-muted">Para vender <b>contas</b> e <b>diamantes/moedas</b> precisamos de confirmar quem és: uma foto do documento de identificação (BI, passaporte ou carta de condução) e uma selfie tua. Protege compradores contra burlas.</p>
      {v.status === 'pendente' && <p className="rounded-xl bg-white/10 p-2">Recebemos os teus documentos. A equipa vai analisar — recebes uma notificação com a decisão.</p>}
      {v.status === 'rejeitado' && <p className="rounded-xl bg-[#7F1D1D]/50 p-2">Recusada{v.reason ? `: ${v.reason}` : ''}. Podes enviar novas fotos.</p>}
      {canSend && (
        <>
          <label className="block font-semibold">Foto do documento
            <input type="file" accept="image/jpeg,image/png,image/webp" className="bx-input mt-1 !py-2" onChange={(e) => setDoc(e.target.files?.[0] ?? null)} />
          </label>
          <label className="block font-semibold">Selfie (o teu rosto, bem iluminado)
            <input type="file" accept="image/jpeg,image/png,image/webp" capture="user" className="bx-input mt-1 !py-2" onChange={(e) => setSelfie(e.target.files?.[0] ?? null)} />
          </label>
          <p className="bx-dim text-[12px]">As fotos são reduzidas no teu telemóvel, guardadas em armazenamento privado e usadas só para verificação e prevenção de fraude. Ver a <Link href="/privacidade" className="underline">Política de Privacidade</Link>.</p>
          <button type="button" className="bx-btn w-full" disabled={busy || !doc || !selfie} onClick={async () => {
            setBusy(true); const r = await affApi.submitVerification(doc!, selfie!); setBusy(false);
            if (r.ok) { toast('Documentos enviados para análise.'); onChange(await affApi.myVerification()); } else toast(AFF_ERR[r.code] ?? r.code);
          }}>{busy ? 'A enviar…' : 'Enviar para verificação'}</button>
        </>
      )}
    </section>
  );
}
