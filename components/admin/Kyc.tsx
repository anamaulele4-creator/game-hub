'use client';

// Admin › KYC — fila ÚNICA de todas as verificações de identidade e documentos (todas as origens):
// pedidos do perfil, vendedores (contas/diamantes), afiliados/moderadores, levantamentos, criadores,
// níveis KYC antigos e KYC das apostas. Só admin ou quem tem KYC_REVIEW (verificado de novo no servidor).
// Documentos abrem com links temporários (2 min). Cada decisão exige motivo, notifica o utilizador e vai para a auditoria.
import { useCallback, useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import {
  ACTION_LABEL, DOC_LABEL, DOC_TYPES, KYC_ERR, KycAction, PURPOSES, PURPOSE_LABEL, SIDE_LABEL, STATUSES, STATUS_LABEL, STATUS_TONE, actionsFor, needsReason, validReason,
} from '@/lib/kyc';
import { KycDetail, KycFile, KycFilters, KycQueueItem, kycApi } from '@/lib/kycApi';
import { Badge } from './shared';

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const SOURCE: Record<string, string> = { perfil: 'Perfil', vendedor: 'Marketplace', kyc_nivel: 'Níveis (Segurança)', migrado_vendedor: 'Vendedor (antigo)', migrado_kyc: 'Nível KYC (antigo)', apostas: 'Apostas (MT)' };

export default function KycAdmin() {
  const { toast } = useStore();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [f, setF] = useState<KycFilters>({ status: 'pendente' });
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ items: KycQueueItem[]; counts: Record<string, number> } | null>(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState<KycQueueItem | null>(null);
  useEffect(() => { void kycApi.canReview().then(setAllowed); }, []);
  const load = useCallback(async () => {
    setData(null); setErr('');
    const r = await kycApi.queue(f);
    if ('ok' in r) { setErr(KYC_ERR[r.code] ?? r.code); setData({ items: [], counts: {} }); } else setData(r);
  }, [f]);
  useEffect(() => { if (allowed) void load(); }, [allowed, load]);

  if (allowed === null) return <div className="card h-20 animate-pulse" />;
  if (!allowed) return <p className="card text-center text-sm">Sem acesso: precisas de ser admin ou ter a permissão KYC_REVIEW.</p>;
  if (sel) return <Detail item={sel} onBack={() => { setSel(null); void load(); }} toast={toast} />;

  const total = Object.values(data?.counts ?? {}).reduce((a, b) => a + b, 0);
  return (
    <div className="space-y-3">
      <p className="text-xs text-white/55">Fila única de verificações de identidade e documentos de todos os utilizadores. Decide aqui: as outras áreas (marketplace, afiliados, segurança) usam este estado.</p>
      <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 text-xs">
        <Chip on={!f.status} onClick={() => setF({ ...f, status: '' })}>Todos{total ? ` · ${total}` : ''}</Chip>
        {STATUSES.map((s) => <Chip key={s} on={f.status === s} onClick={() => setF({ ...f, status: s })}>{STATUS_LABEL[s]}{data?.counts?.[s] ? ` · ${data.counts[s]}` : ''}</Chip>)}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <select aria-label="Finalidade" className="input !min-h-[44px]" value={f.purpose ?? ''} onChange={(e) => setF({ ...f, purpose: e.target.value })}>
          <option value="">Todas as finalidades</option>{PURPOSES.map((p) => <option key={p} value={p}>{PURPOSE_LABEL[p]}</option>)}
        </select>
        <select aria-label="Tipo de documento" className="input !min-h-[44px]" value={f.docType ?? ''} onChange={(e) => setF({ ...f, docType: e.target.value })}>
          <option value="">Todos os documentos</option>{DOC_TYPES.map((t) => <option key={t} value={t}>{DOC_LABEL[t]}</option>)}
        </select>
        <label className="flex flex-col">De<input type="date" className="input !min-h-[44px]" value={f.from ?? ''} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label className="flex flex-col">Até<input type="date" className="input !min-h-[44px]" value={f.to ?? ''} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setF({ ...f, q }); }}>
        <input className="input flex-1 !min-h-[44px]" placeholder="Procurar utilizador (@handle, nome ou id)" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="btn !px-4">Procurar</button>
      </form>
      {err && <p className="rounded-lg bg-pink/20 p-2 text-xs">{err}</p>}
      {!data ? <div className="card h-20 animate-pulse" /> : data.items.length === 0 ? <p className="card text-center text-sm text-white/60">Sem pedidos com estes filtros.</p> : (
        <ul className="space-y-2">
          {data.items.map((it) => (
            <li key={it.id}>
              <button type="button" className="card flex w-full min-h-[56px] items-center gap-2 !p-3 text-left text-sm" onClick={() => setSel(it)}>
                <span className="min-w-0 flex-1">
                  <b className="block truncate">{it.name || it.handle} <span className="font-normal text-white/55">{it.handle}</span></b>
                  <span className="block truncate text-xs text-white/55">{PURPOSE_LABEL[it.purpose] ?? it.purpose} · {DOC_LABEL[it.docType as keyof typeof DOC_LABEL] ?? it.docType.toUpperCase()} · {it.kind === 'apostas' ? 'dados (sem ficheiros)' : `${it.files} ficheiro(s)`} · {SOURCE[it.source] ?? it.source}</span>
                  <span className="block text-[11px] text-white/40">{fmt(it.submittedAt)}</span>
                </span>
                <Badge tone={STATUS_TONE[it.status]}>{STATUS_LABEL[it.status]}</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Staff toast={toast} />
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`min-h-[40px] shrink-0 rounded-full px-3 ${on ? 'bg-neon font-semibold text-ink' : 'bg-panel2 text-white/70'}`}>{children}</button>;
}

function FileView({ f }: { f: KycFile }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const pdf = /\.pdf$/i.test(f.path) || f.path.startsWith('data:application/pdf');
  const label = `${DOC_LABEL[f.docType] ?? f.docType}${f.side !== 'unico' ? ' · ' + SIDE_LABEL[f.side] : ''}`;
  return (
    <figure className="overflow-hidden rounded-lg border border-line bg-black/30">
      {url === undefined ? (
        <button type="button" className="flex aspect-[4/3] w-full items-center justify-center text-xs text-neon2" onClick={async () => setUrl(await kycApi.signedUrl(f))}>Ver (link de 2 min)</button>
      ) : url === null ? <p className="flex aspect-[4/3] items-center justify-center p-2 text-center text-xs text-white/60">Ficheiro indisponível (apagado ou sem acesso)</p>
        : pdf ? <a href={url} target="_blank" rel="noreferrer noopener" className="flex aspect-[4/3] items-center justify-center text-sm font-semibold text-neon2 underline">Abrir PDF</a>
          : <a href={url} target="_blank" rel="noreferrer noopener"><img src={url} alt={label} className="aspect-[4/3] w-full object-contain" referrerPolicy="no-referrer" /></a>}
      <figcaption className="px-2 py-1 text-[11px] text-white/60">{label} · {fmt(f.at)}</figcaption>
    </figure>
  );
}

function Detail({ item, onBack, toast }: { item: KycQueueItem; onBack: () => void; toast: (m: string) => void }) {
  const { s } = useStore();
  const [d, setD] = useState<KycDetail | null | undefined>(undefined);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    if (item.kind === 'apostas') { setD(null); return; }
    const r = await kycApi.detail(item.id);
    if ('ok' in r) { setErr(KYC_ERR[r.code] ?? r.code); setD(null); } else setD(r);
  }, [item]);
  useEffect(() => { void load(); }, [load]);

  const decide = async (a: KycAction) => {
    setErr('');
    if (!validReason(a, reason)) { setErr(KYC_ERR.REASON); return; }
    if (a === 'recusado' && !window.confirm('Recusar esta verificação? O utilizador vê o motivo.')) return;
    setBusy(true);
    const r = item.kind === 'apostas'
      ? await (await import('@/lib/betsApi')).betsApi.kycReview(item.userId, a === 'aprovado' ? 'aprovado' : 'recusado', reason.trim())
      : await kycApi.review(item.id, a, reason);
    setBusy(false);
    if (r.ok) { toast(`${ACTION_LABEL[a]}: feito. O utilizador foi notificado.`); setReason(''); if (item.kind === 'apostas') onBack(); else void load(); }
    else setErr(KYC_ERR[(r as { code: string }).code] ?? (r as { code: string }).code);
  };

  const status = d?.request.status ?? item.status;
  const acts: KycAction[] = item.kind === 'apostas' ? (status === 'pendente' && s.user.role === 'admin' ? ['recusado', 'aprovado'] : []) : actionsFor(status);
  return (
    <div className="space-y-3 text-sm">
      <button type="button" className="btn-ghost !min-h-[44px] !px-3 text-sm" onClick={onBack}>‹ Voltar à fila</button>
      <section className="card space-y-1 !p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0"><b className="block truncate text-base">{item.name || item.handle}</b><span className="text-xs text-white/55">{item.handle} · {SOURCE[item.source] ?? item.source}</span></p>
          <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
        </div>
        <p className="text-xs">Finalidade: <b>{PURPOSE_LABEL[item.purpose] ?? item.purpose}</b> · enviado {fmt(item.submittedAt)}</p>
        {d && <p className="text-xs text-white/60">Nível de limites: {d.level} · identidade {d.verified.identidade ? '✓' : '—'} · vendedor {d.verified.vendedor ? '✓' : '—'}{d.request.reviewer ? ` · último revisor ${d.request.reviewer}` : ''}</p>}
        {(d?.request.note || item.note) && <p className="rounded-lg bg-white/5 p-2 text-xs">Nota do utilizador: {d?.request.note || item.note}</p>}
        {(d?.request.reason || item.reason) && <p className="text-xs text-white/70">Último motivo: {d?.request.reason || item.reason}</p>}
      </section>

      {item.kind === 'apostas' ? (
        <p className="card !p-3 text-xs text-white/70">Pedido KYC das apostas em MT: dados de identificação sem ficheiros (vê os detalhes em Apostas). {s.user.role === 'admin' ? 'Podes decidir aqui; usa a mesma função das apostas.' : 'Só o admin decide este tipo.'}</p>
      ) : d === undefined ? <div className="card h-40 animate-pulse" /> : d && (
        <>
          <section>
            <p className="mb-2 font-semibold">Documentos ({d.files.length})</p>
            {d.files.length === 0 ? <p className="card !p-3 text-xs text-white/60">Sem ficheiros (ex.: verificação de telemóvel).</p> : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{d.files.map((x) => <FileView key={x.id} f={x} />)}</div>
            )}
          </section>
        </>
      )}

      {acts.length > 0 && (
        <section className="card space-y-2 !p-3">
          <p className="font-semibold">Decisão</p>
          <textarea className="input min-h-[80px] w-full" maxLength={500} placeholder="Motivo (obrigatório para aprovar, recusar ou pedir documentos — o utilizador vê)" value={reason} onChange={(e) => setReason(e.target.value)} />
          {err && <p className="text-xs text-pink">{err}</p>}
          <div className="grid grid-cols-2 gap-2">
            {acts.map((a) => (
              <button key={a} type="button" disabled={busy || (needsReason(a) && reason.trim().length < 5)}
                className={`min-h-[48px] rounded-xl px-2 font-semibold disabled:opacity-50 ${a === 'aprovado' ? 'bg-lime text-black' : a === 'recusado' ? 'bg-red-600' : 'bg-panel2'}`}
                onClick={() => void decide(a)}>{ACTION_LABEL[a]}</button>
            ))}
          </div>
        </section>
      )}
      {!acts.length && err && <p className="text-xs text-pink">{err}</p>}

      {d && (
        <section className="card space-y-2 !p-3">
          <p className="font-semibold">Histórico do utilizador</p>
          <ul className="space-y-1 text-xs">{d.history.map((h) => (
            <li key={h.id} className={`flex justify-between gap-2 ${h.id === d.request.id ? 'font-semibold' : ''}`}><span>{PURPOSE_LABEL[h.purpose]} · {fmt(h.submittedAt)}{h.reason ? <span className="block font-normal text-white/50">{h.reason}</span> : null}</span><span>{STATUS_LABEL[h.status]}</span></li>
          ))}</ul>
          {d.betKyc && <p className="text-xs text-white/60">KYC das apostas: {d.betKyc.status} ({d.betKyc.idType})</p>}
          <ol className="space-y-1 border-l border-line pl-3 text-xs">
            {d.events.map((e, i) => <li key={i}><b>{e.action.replace('decisao:', '')}</b>{e.to ? ` → ${STATUS_LABEL[e.to as keyof typeof STATUS_LABEL] ?? e.to}` : ''} <span className="text-white/45">{fmt(e.at)}{e.actor ? ` · @${e.actor}` : ''}</span>{e.reason ? <span className="block text-white/60">{e.reason}</span> : null}</li>)}
          </ol>
        </section>
      )}
    </div>
  );
}

/** Revisores com KYC_REVIEW (só o admin gere). */
function Staff({ toast }: { toast: (m: string) => void }) {
  const { s } = useStore();
  const [list, setList] = useState<{ userId: string; handle: string; grantedAt: string }[]>([]);
  const [h, setH] = useState('');
  const load = useCallback(async () => setList(await kycApi.staff()), []);
  useEffect(() => { if (s.user.role === 'admin') void load(); }, [s.user.role, load]);
  if (s.user.role !== 'admin') return null;
  const run = async (handle: string, grant: boolean) => { const r = await kycApi.grant(handle, grant); if (r.ok) { toast(grant ? 'Permissão KYC_REVIEW dada.' : 'Permissão retirada.'); setH(''); void load(); } else toast(KYC_ERR[r.code] ?? r.code); };
  return (
    <section className="card space-y-2 !p-3 text-sm">
      <p className="font-semibold">Revisores (KYC_REVIEW)</p>
      <p className="text-xs text-white/55">Admins revêem sempre. Dá a permissão a quem faz só verificações; essa pessoa usa a página /admin/kyc.</p>
      {list.map((x) => <div key={x.userId} className="flex min-h-[44px] items-center justify-between text-xs"><span>{x.handle} · desde {fmt(x.grantedAt)}</span><button type="button" className="min-h-[40px] px-2 text-pink" onClick={() => void run(x.handle, false)}>Retirar</button></div>)}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (h.trim()) void run(h, true); }}>
        <input className="input flex-1 !min-h-[44px]" placeholder="@handle" value={h} onChange={(e) => setH(e.target.value)} />
        <button type="submit" className="btn !px-4">Dar</button>
      </form>
    </section>
  );
}
