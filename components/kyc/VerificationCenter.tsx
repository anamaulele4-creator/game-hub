'use client';

// Centro de verificação (KYC unificado): o MESMO formulário e histórico em todo o lado
// (/seguranca/verificacao, marketplace, afiliados…). Documentos vão para o bucket PRIVADO "verificacoes";
// só o dono e a equipa de verificação os veem, sempre com links temporários.
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import {
  DOC_LABEL, DOC_TYPES, KYC_ERR, KycDocType, KycPurpose, KycSide, PURPOSES, PURPOSE_HINT, PURPOSE_LABEL, SIDE_LABEL, STATUS_USER,
  TWO_SIDED, isOpen, missingDocs, needsSelfie,
} from '@/lib/kyc';
import { KycMe, KycRequest, NewFile, kycApi } from '@/lib/kycApi';

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const TONE: Record<string, string> = { pendente: 'bg-neon/20 text-neon', em_analise: 'bg-neon2/20 text-neon2', aprovado: 'bg-lime/20 text-lime', recusado: 'bg-red-600/30 text-red-200', mais_documentos: 'bg-white/15 text-white' };
const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

export function VerificationCenter({ purpose: preset, compact, onChange }: { purpose?: KycPurpose; compact?: boolean; onChange?: (me: KycMe | null) => void }) {
  const [me, setMe] = useState<KycMe | null | undefined>(undefined);
  const cb = useRef(onChange); cb.current = onChange;
  const load = useCallback(async () => { const m = await kycApi.me(); setMe(m); cb.current?.(m); }, []);
  useEffect(() => { void load(); }, [load]);

  if (me === undefined) return <div className="card h-24 animate-pulse" />;
  if (me === null) return <p className="card text-sm">Entra na tua conta para verificar a identidade. <Link href="/entrar" className="font-semibold text-neon2">Entrar</Link></p>;

  const shown = preset ? me.requests.filter((r) => r.purpose === preset || (needsSelfie(preset) && needsSelfie(r.purpose))) : me.requests;
  const waiting = shown.filter((r) => r.status === 'mais_documentos');
  const open = preset ? shown.find((r) => r.purpose === preset && isOpen(r.status)) : undefined;
  const done = preset ? me.verified[preset] : false;

  return (
    <div className="space-y-3">
      {!compact && (
        <section className="card !p-3">
          <p className="mb-2 text-sm font-semibold">O teu estado</p>
          <div className="flex flex-wrap gap-1.5">
            {PURPOSES.map((p) => <span key={p} className={`rounded-full px-2.5 py-1 text-xs ${me.verified[p] ? 'bg-lime/20 text-lime' : 'bg-panel2 text-white/60'}`}>{me.verified[p] ? '✓ ' : ''}{PURPOSE_LABEL[p]}</span>)}
          </div>
          <p className="mt-2 text-xs text-white/50">Nível de limites: <b className="text-white">{me.level}</b>. <Link href="/seguranca" className="underline">Ver limites</Link></p>
        </section>
      )}

      {done && preset && <p className="card !p-3 text-sm text-lime">✓ Verificado: {PURPOSE_LABEL[preset]}.</p>}
      {waiting.map((r) => <MoreDocs key={r.id} r={r} onDone={load} />)}
      {open && open.status !== 'mais_documentos' && <p className="card !p-3 text-sm">Recebemos o teu pedido ({PURPOSE_LABEL[open.purpose]}). Estado: <b>{STATUS_USER[open.status]}</b>. Recebes uma notificação com a decisão.</p>}
      {!done && !open && <NewRequest preset={preset} onDone={load} />}

      {shown.length > 0 && (
        <section className="space-y-2">
          <h3 className="sec-title">Histórico de verificações</h3>
          {shown.map((r) => <RequestCard key={r.id} r={r} />)}
        </section>
      )}
      <p className="text-xs text-white/45">Os documentos ficam em armazenamento privado e são usados só para verificação e prevenção de fraude. Ver a <Link href="/privacidade" className="underline">Política de Privacidade</Link>.</p>
    </div>
  );
}

/** Lista de ficheiros a enviar: tipo de documento + frente/verso. */
function DocPicker({ files, setFiles, defaultType }: { files: NewFile[]; setFiles: (f: NewFile[]) => void; defaultType: KycDocType }) {
  const [type, setType] = useState<KycDocType>(defaultType);
  const sides: KycSide[] = TWO_SIDED.includes(type) ? ['frente', 'verso'] : ['unico'];
  const add = (file: File | undefined, side: KycSide) => { if (file) setFiles([...files.filter((x) => !(x.docType === type && x.side === side)), { file, docType: type, side }]); };
  return (
    <div className="space-y-2">
      <label className="block text-xs font-semibold">Tipo de documento
        <select className="input mt-1 w-full !min-h-[44px]" value={type} onChange={(e) => setType(e.target.value as KycDocType)}>
          {DOC_TYPES.map((t) => <option key={t} value={t}>{DOC_LABEL[t]}</option>)}
        </select>
      </label>
      <div className={`grid gap-2 ${sides.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {sides.map((s) => (
          <label key={s} className="flex min-h-[64px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-line bg-panel2 p-2 text-center text-xs">
            <span className="font-semibold">{sides.length > 1 ? SIDE_LABEL[s] : type.startsWith('selfie') ? 'Tirar / escolher selfie' : 'Escolher ficheiro'}</span>
            <span className="text-white/50">JPG, PNG, WebP ou PDF</span>
            <input type="file" accept={ACCEPT} capture={type.startsWith('selfie') ? 'user' : undefined} className="sr-only" onChange={(e) => { add(e.target.files?.[0], s); e.target.value = ''; }} />
          </label>
        ))}
      </div>
      {files.length > 0 && (
        <ul className="divide-y divide-line rounded-xl bg-panel2 text-xs">
          {files.map((f, i) => (
            <li key={i} className="flex min-h-[44px] items-center gap-2 px-3">
              <span className="min-w-0 flex-1 truncate"><b>{DOC_LABEL[f.docType]}</b>{f.side !== 'unico' ? ` · ${SIDE_LABEL[f.side]}` : ''} <span className="text-white/50">{f.file.name}</span></span>
              <button type="button" className="min-h-[40px] px-2 text-pink" onClick={() => setFiles(files.filter((_, j) => j !== i))}>Remover</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewRequest({ preset, onDone }: { preset?: KycPurpose; onDone: () => void }) {
  const { toast } = useStore();
  const [purpose, setPurpose] = useState<KycPurpose>(preset ?? 'identidade');
  const [files, setFiles] = useState<NewFile[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const miss = missingDocs(purpose, files.map((f) => f.docType));
  const send = async () => {
    setErr('');
    if (miss) { setErr(KYC_ERR[miss]); return; }
    setBusy(true); const r = await kycApi.submit(purpose, files, note.trim()); setBusy(false);
    if (r.ok) { toast('Documentos enviados para análise.'); setFiles([]); setNote(''); onDone(); } else setErr(KYC_ERR[r.code] ?? r.code);
  };
  return (
    <section className="card space-y-3 !p-3 text-sm" aria-label="Pedir verificação">
      <p className="font-semibold">Pedir verificação</p>
      {!preset && (
        <label className="block text-xs font-semibold">Para quê?
          <select className="input mt-1 w-full !min-h-[44px]" value={purpose} onChange={(e) => setPurpose(e.target.value as KycPurpose)}>
            {PURPOSES.map((p) => <option key={p} value={p}>{PURPOSE_LABEL[p]}</option>)}
          </select>
        </label>
      )}
      <p className="text-xs text-white/60">{PURPOSE_HINT[purpose]}</p>
      <DocPicker files={files} setFiles={setFiles} defaultType="bi" />
      <input className="input w-full" placeholder="Nota para a equipa (opcional)" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      {err && <p className="text-xs text-pink">{err}</p>}
      {!err && miss && files.length > 0 && <p className="text-xs text-neon">{KYC_ERR[miss]}</p>}
      <button type="button" className="btn w-full !min-h-[48px]" disabled={busy || files.length === 0} onClick={() => void send()}>{busy ? 'A enviar…' : 'Enviar para verificação'}</button>
    </section>
  );
}

function MoreDocs({ r, onDone }: { r: KycRequest; onDone: () => void }) {
  const { toast } = useStore();
  const [files, setFiles] = useState<NewFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <section className="card space-y-2 border border-neon/40 !p-3 text-sm">
      <p className="font-semibold">Faltam documentos · {PURPOSE_LABEL[r.purpose]}</p>
      <p className="rounded-lg bg-white/10 p-2 text-xs">Pedido da equipa: {r.reason || '—'}</p>
      <DocPicker files={files} setFiles={setFiles} defaultType="comprovativo_morada" />
      {err && <p className="text-xs text-pink">{err}</p>}
      <button type="button" className="btn w-full !min-h-[48px]" disabled={busy || files.length === 0} onClick={async () => {
        setBusy(true); setErr(''); const x = await kycApi.addFiles(r.id, files); setBusy(false);
        if (x.ok) { toast('Documentos enviados.'); setFiles([]); onDone(); } else setErr(KYC_ERR[x.code] ?? x.code);
      }}>{busy ? 'A enviar…' : 'Enviar documentos em falta'}</button>
    </section>
  );
}

function RequestCard({ r }: { r: KycRequest }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card !p-3 text-sm">
      <button type="button" className="flex w-full min-h-[44px] items-center gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="min-w-0 flex-1"><b className="block">{PURPOSE_LABEL[r.purpose]}</b><span className="block text-xs text-white/50">{fmt(r.submittedAt)} · {r.files.length} ficheiro(s)</span></span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${TONE[r.status]}`}>{STATUS_USER[r.status]}</span>
      </button>
      {r.reason && r.status !== 'pendente' && <p className="mt-1 text-xs text-white/70">Motivo: {r.reason}</p>}
      {open && (
        <div className="mt-2 space-y-2 border-t border-line pt-2 text-xs">
          <ul className="space-y-1">{r.files.map((f) => <li key={f.id} className="flex justify-between gap-2"><span>{DOC_LABEL[f.docType] ?? f.docType}{f.side !== 'unico' ? ` · ${SIDE_LABEL[f.side]}` : ''}</span><span className="text-white/45">{fmt(f.at)}</span></li>)}</ul>
          <ol className="space-y-1 border-l border-line pl-3">
            {r.events.map((e, i) => <li key={i}><b>{e.to ? STATUS_USER[e.to as keyof typeof STATUS_USER] ?? e.to : e.action}</b> <span className="text-white/45">{fmt(e.at)}</span>{e.reason ? <span className="block text-white/60">{e.reason}</span> : null}</li>)}
          </ol>
        </div>
      )}
    </div>
  );
}
