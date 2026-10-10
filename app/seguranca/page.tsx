'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Page, Sheet } from '@/components/ui';
import { useStore } from '@/lib/store';
import { IS_DEMO } from '@/lib/config';
import type { Device, KycLimit, KycSub, LoginEv, SecEvent, SecStatus, WlEntry } from '@/lib/security';

const sec = () => import('@/lib/security');
const fmtD = (iso?: string) => (iso ? new Date(iso).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const mask = (n: string) => `+${n.slice(0, 3)} ${n.slice(3, 5)} ••• ${n.slice(-2)}`;

export default function Seguranca() {
  const { s, ready, toast } = useStore();
  const [st, setSt] = useState<SecStatus | null | undefined>(undefined);
  const [wl, setWl] = useState<WlEntry[]>([]);
  const [devs, setDevs] = useState<Device[]>([]);
  const [logins, setLogins] = useState<LoginEv[]>([]);
  const [evs, setEvs] = useState<SecEvent[]>([]);
  const [lims, setLims] = useState<KycLimit[]>([]);
  const [subs, setSubs] = useState<KycSub[]>([]);
  const [sheet, setSheet] = useState<null | 'pin' | 'totp' | 'anti' | 'wl' | 'freeze' | 'kyc'>(null);
  const [f, setF] = useState({ pin: '', pin2: '', old: '', anti: '', method: 'M-Pesa' as 'M-Pesa' | 'e-Mola', msisdn: '', label: '', code: '', kycLevel: 1 });
  const [totp, setTotp] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const m = await sec();
    const s1 = await m.status();
    setSt(s1);
    if (!s1) return;
    const [a, b, c, d, e, g] = await Promise.all([m.whitelist(), m.devices(), m.loginHistory(), m.events(), m.kycLimits(), m.kycSubs()]);
    setWl(a); setDevs(b); setLogins(c); setEvs(d); setLims(e); setSubs(g);
  }, []);
  useEffect(() => { if (ready) void load(); }, [ready, s.account.loggedIn, load]);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => {
    setBusy(true); setErr('');
    const r = await fn();
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? 'Erro'); return; }
    toast(ok); setSheet(null); setF((x) => ({ ...x, pin: '', pin2: '', old: '', code: '', msisdn: '', label: '' })); void load();
  };

  if (st === null) return <Page title="Segurança" back="/definicoes"><div className="card mt-6 space-y-3 text-center"><p className="text-4xl">🔐</p><p className="text-sm">Entra na tua conta para gerir a segurança.</p><Link href="/entrar" className="btn w-full">Entrar</Link></div></Page>;
  if (!st) return <Page title="Segurança" back="/definicoes"><div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="card h-20 animate-pulse" />)}</div></Page>;

  const has2fa = st.totp.some((x) => x.status === 'verified');
  const score = (st.pinSet ? 25 : 0) + (has2fa ? 30 : st.codeFallback ? 10 : 0) + (st.antiPhishing ? 15 : 0) + (wl.length ? 10 : 0) + Math.min(st.kycLevel, 2) * 10;
  const lock = st.withdrawalsLockedUntil && st.withdrawalsLockedUntil > new Date().toISOString() ? st.withdrawalsLockedUntil : '';
  const level = lims.find((l) => l.level === st.kycLevel);

  const Row = ({ icon, title, desc, ok, action, onClick }: { icon: string; title: string; desc: string; ok: boolean; action: string; onClick: () => void }) => (
    <div className="flex items-center gap-3 border-b border-line py-3 last:border-0">
      <span className="text-2xl">{icon}</span>
      <div className="flex-1"><p className="text-sm font-semibold">{title} {ok ? <span className="text-lime">✓</span> : <span className="text-neon">!</span>}</p><p className="text-xs text-white/50">{desc}</p></div>
      <button className={ok ? 'btn-ghost !px-3 !py-1 text-xs' : 'btn !px-3 !py-1 text-xs'} onClick={onClick}>{action}</button>
    </div>
  );

  return (
    <Page title="Centro de segurança" back="/definicoes">
      <div className="card mb-3">
        <div className="flex items-center justify-between"><p className="font-semibold">Nível de segurança</p><p className={`text-lg font-black ${score >= 70 ? 'text-lime' : score >= 40 ? 'text-neon' : 'text-pink'}`}>{score}/100</p></div>
        <div className="mt-2 h-2 rounded bg-panel2"><div className={`h-2 rounded ${score >= 70 ? 'bg-lime' : score >= 40 ? 'bg-neon' : 'bg-pink'}`} style={{ width: `${score}%` }} /></div>
        {st.frozen && <p className="mt-2 rounded-lg bg-pink/20 p-2 text-xs">❄️ Conta congelada desde {fmtD(undefined)}. Pagamentos e levantamentos bloqueados. Contacta o suporte para reativar.</p>}
        {lock && <p className="mt-2 rounded-lg bg-neon/15 p-2 text-xs text-neon2">⏳ Levantamentos bloqueados por segurança até {fmtD(lock)} (alteração recente de PIN, palavra-passe, 2FA ou número).</p>}
        {st.antiPhishing && <p className="mt-2 rounded-lg bg-lime/10 p-2 text-xs text-lime">🛡️ Código anti-phishing: <b>{st.antiPhishing}</b> — aparece em todos os emails e avisos oficiais. Sem ele, é falso.</p>}
      </div>

      <div className="card mb-3">
        <p className="mb-1 font-semibold">Proteção da conta</p>
        <Row icon="📱" title="2FA — app autenticadora" desc={has2fa ? 'Ativo (Google Authenticator, Authy…). Pedido no login e nos pagamentos.' : 'Recomendado: códigos de 6 dígitos que mudam a cada 30 s.'} ok={has2fa} action={has2fa ? 'Gerir' : 'Ativar'} onClick={async () => { setErr(''); setSheet('totp'); if (!has2fa) { const r = await (await sec()).enrollTotp(); if (r.ok) setTotp(r.data!); else setErr(r.error!); } }} />
        <Row icon="✉️" title="Código por email/SMS (alternativa)" desc={`Se não tiveres a app: código para ${st.email ?? st.phone ?? 'o teu contacto'} em ações sensíveis.`} ok={st.codeFallback} action={st.codeFallback ? 'Desligar' : 'Ligar'} onClick={() => void run(async () => (await sec()).setPrefs({ codeFallback: !st.codeFallback }), 'Preferência guardada')} />
        <Row icon="🔢" title="PIN de transação" desc="6 dígitos, pedido em todos os pagamentos e levantamentos. 5 erros = bloqueio 30 min." ok={st.pinSet} action={st.pinSet ? 'Alterar' : 'Criar'} onClick={() => { setErr(''); setSheet('pin'); }} />
        <Row icon="🛡️" title="Código anti-phishing" desc="Uma palavra tua que mostramos nas mensagens oficiais." ok={!!st.antiPhishing} action={st.antiPhishing ? 'Alterar' : 'Definir'} onClick={() => { setErr(''); setSheet('anti'); }} />
        <Row icon="🔔" title="Alertas de novo dispositivo" desc="Aviso quando alguém entra na tua conta noutro aparelho." ok={st.newDeviceAlerts} action={st.newDeviceAlerts ? 'Desligar' : 'Ligar'} onClick={() => void run(async () => (await sec()).setPrefs({ newDeviceAlerts: !st.newDeviceAlerts }), 'Preferência guardada')} />
        <Link href="/recuperar" className="mt-2 block text-xs text-neon2">🔑 Alterar palavra-passe (bloqueia levantamentos 24 h)</Link>
      </div>

      <div className="card mb-3">
        <div className="flex items-center justify-between"><p className="font-semibold">Números de levantamento (lista branca)</p><button className="btn !px-3 !py-1 text-xs" onClick={() => { setErr(''); setSheet('wl'); }}>+ Adicionar</button></div>
        <p className="mb-2 text-xs text-white/50">Só podes levantar para estes números. Um número novo fica ativo 24 h depois de adicionado.</p>
        {wl.length === 0 && <p className="text-xs text-white/50">Ainda sem números.</p>}
        {wl.map((w) => {
          const active = w.activeAfter <= new Date().toISOString();
          return (
            <div key={w.id} className="flex items-center justify-between border-b border-line py-2 text-sm last:border-0">
              <span>{w.method === 'M-Pesa' ? '📱' : '💳'} {w.method} · {mask(w.msisdn)} {w.label && <span className="text-white/50">· {w.label}</span>}<span className={`block text-xs ${active ? 'text-lime' : 'text-neon'}`}>{active ? 'Ativo' : `Ativo a partir de ${fmtD(w.activeAfter)}`}</span></span>
              <button className="text-xs text-pink" onClick={() => { if (confirm('Remover este número?')) void run(async () => (await sec()).removeWhitelist(w.id), 'Número removido'); }}>Remover</button>
            </div>
          );
        })}
        {IS_DEMO && (wl.length > 0 || lock) && <button className="mt-2 text-xs text-white/40 underline" onClick={async () => { (await sec()).demoSkipLocks(); void load(); }}>Demo: saltar a espera de 24 h</button>}
      </div>

      <div className="card mb-3">
        <p className="font-semibold">Verificação de identidade (KYC)</p>
        <p className="mb-2 text-xs text-white/50">O teu nível define os limites diários. Nível atual: <b className="text-white">{st.kycLevel} · {level?.label}</b></p>
        <div className="space-y-1">
          {lims.map((l) => {
            const pend = subs.find((x) => x.level === l.level && x.status === 'pendente');
            return (
              <div key={l.level} className={`flex items-center gap-2 rounded-lg p-2 text-xs ${l.level <= st.kycLevel ? 'bg-lime/10' : 'bg-panel2'}`}>
                <span className="w-5 font-bold">{l.level}</span>
                <span className="flex-1">{l.label}<span className="block text-white/50">Levantar {l.withdraw.toLocaleString('pt-PT')} MZN/dia · Comprar {l.purchase.toLocaleString('pt-PT')} MZN/dia</span></span>
                {l.level <= st.kycLevel ? <span className="text-lime">✓</span> : pend ? <span className="text-neon">Em revisão</span> : l.level === st.kycLevel + 1 ? <button className="btn !px-2 !py-0.5 text-xs" onClick={() => { setErr(''); setF((x) => ({ ...x, kycLevel: l.level })); setSheet('kyc'); }}>Verificar</button> : null}
              </div>
            );
          })}
        </div>
        {subs.filter((x) => x.status === 'rejeitado').slice(0, 1).map((x) => <p key={x.id} className="mt-2 text-xs text-pink">Último pedido rejeitado: {x.note ?? 'documento ilegível'}</p>)}
      </div>

      <div className="card mb-3">
        <div className="flex items-center justify-between"><p className="font-semibold">Dispositivos e sessões</p><button className="btn-ghost !px-3 !py-1 text-xs" onClick={() => void run(async () => (await sec()).signOutOthers(), 'Sessões noutros dispositivos terminadas')}>Sair dos outros</button></div>
        {devs.map((d) => (
          <div key={d.id} className="flex items-center justify-between border-b border-line py-2 text-xs last:border-0">
            <span>💻 {d.label} {d.current && <span className="text-lime">(este)</span>}<span className="block text-white/50">Último acesso {fmtD(d.lastSeen)}{d.ip ? ` · IP ${d.ip}` : ''}</span></span>
            {!d.current && <button className="text-pink" onClick={() => void run(async () => (await sec()).removeDevice(d.id), 'Dispositivo removido')}>Remover</button>}
          </div>
        ))}
      </div>

      <div className="card mb-3">
        <p className="mb-1 font-semibold">Histórico de inícios de sessão</p>
        {logins.length === 0 && <p className="text-xs text-white/50">Sem registos.</p>}
        {logins.slice(0, 10).map((l, i) => <p key={i} className="border-b border-line py-1.5 text-xs last:border-0">{fmtD(l.at)} · {l.device}{l.ip ? ` · ${l.ip}` : ''} {l.newDevice && <span className="text-neon">· novo dispositivo</span>}</p>)}
      </div>

      <div className="card mb-3">
        <p className="mb-1 font-semibold">Registo de segurança</p>
        {evs.length === 0 && <p className="text-xs text-white/50">Sem eventos.</p>}
        {evs.slice(0, 15).map((e, i) => <p key={i} className="border-b border-line py-1.5 text-xs last:border-0">{fmtD(e.at)} · <b>{e.event}</b>{e.detail ? ` · ${e.detail}` : ''}{e.ip ? ` · ${e.ip}` : ''}</p>)}
      </div>

      <div className="card mb-3 border-red-500/40">
        <p className="font-semibold text-red-300">❄️ Congelar conta</p>
        <p className="mb-2 text-xs text-white/60">Se suspeitas que alguém entrou na tua conta: bloqueia pagamentos e levantamentos, pausa os teus anúncios e termina todas as sessões. Para reativar, contacta o suporte.</p>
        <button className="w-full rounded-xl bg-red-600 py-2 text-sm font-semibold disabled:opacity-40" disabled={st.frozen} onClick={() => { setErr(''); setSheet('freeze'); }}>{st.frozen ? 'Conta congelada' : 'Congelar a minha conta'}</button>
      </div>
      <p className="mb-6 text-center text-xs text-white/40">O TXAPILOG nunca te pede o PIN, palavra-passe ou códigos por mensagem, chamada ou WhatsApp.</p>

      <Sheet open={sheet === 'pin'} onClose={() => setSheet(null)} title={st.pinSet ? 'Alterar PIN' : 'Criar PIN de transação'}>
        <div className="space-y-2">
          {st.pinSet && <input className="input w-full text-center font-mono tracking-[0.5em]" type="password" inputMode="numeric" maxLength={6} placeholder="PIN atual" value={f.old} onChange={(e) => setF({ ...f, old: e.target.value.replace(/\D/g, '') })} />}
          <input className="input w-full text-center font-mono tracking-[0.5em]" type="password" inputMode="numeric" maxLength={6} placeholder="Novo PIN" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} />
          <input className="input w-full text-center font-mono tracking-[0.5em]" type="password" inputMode="numeric" maxLength={6} placeholder="Repetir" value={f.pin2} onChange={(e) => setF({ ...f, pin2: e.target.value.replace(/\D/g, '') })} />
          {st.pinSet && <p className="text-xs text-neon2">Alterar o PIN bloqueia levantamentos durante 24 h.{!IS_DEMO && ' Exige 2FA ou login recente por código.'}</p>}
          {err && <p className="text-xs text-pink">{err}</p>}
          <button className="btn w-full" disabled={busy || f.pin.length !== 6 || f.pin !== f.pin2} onClick={() => void run(async () => (await sec()).setPin(f.pin, st.pinSet ? f.old : undefined), 'PIN guardado 🔢')}>Guardar PIN</button>
        </div>
      </Sheet>

      <Sheet open={sheet === 'totp'} onClose={() => { setSheet(null); setTotp(null); }} title="2FA — app autenticadora">
        {has2fa ? (
          <div className="space-y-2 text-sm">
            <p>O 2FA está ativo. Remover reduz a segurança e bloqueia levantamentos 24 h.</p>
            {err && <p className="text-xs text-pink">{err}</p>}
            <button className="w-full rounded-xl bg-red-600 py-2 font-semibold" onClick={() => void run(async () => (await sec()).unenrollTotp(st.totp.find((x) => x.status === 'verified')!.id), '2FA removido')}>Remover 2FA</button>
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <ol className="list-decimal space-y-1 pl-5 text-xs text-white/70"><li>Instala Google Authenticator, Microsoft Authenticator ou Authy.</li><li>Lê o código QR ou escreve a chave.</li><li>Escreve o código de 6 dígitos que aparece.</li></ol>
            {totp?.qr ? <img src={totp.qr} alt="Código QR 2FA" className="mx-auto h-44 w-44 rounded-xl bg-white p-2" /> : IS_DEMO ? <p className="rounded-lg bg-neon/10 p-2 text-center text-xs text-neon2">Demo: sem QR real — escreve quaisquer 6 dígitos.</p> : <div className="card h-44 animate-pulse" />}
            {totp?.secret && <p className="break-all rounded-lg bg-panel2 p-2 text-center font-mono text-xs">{totp.secret}</p>}
            <input className="input w-full text-center font-mono text-xl tracking-[0.5em]" inputMode="numeric" maxLength={6} placeholder="000000" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.replace(/\D/g, '') })} />
            {err && <p className="text-xs text-pink">{err}</p>}
            <button className="btn w-full" disabled={busy || f.code.length !== 6 || !totp} onClick={() => void run(async () => (await sec()).verifyTotp(totp!.factorId, f.code), '2FA ativado 📱')}>Ativar</button>
          </div>
        )}
      </Sheet>

      <Sheet open={sheet === 'anti'} onClose={() => setSheet(null)} title="Código anti-phishing">
        <div className="space-y-2 text-sm">
          <p className="text-xs text-white/60">Escolhe uma palavra só tua (ex.: LeaoMatola7). Vai aparecer nos emails e avisos oficiais do TXAPILOG. Se uma mensagem não tiver este código, não é nossa.</p>
          <input className="input w-full" maxLength={20} placeholder="4 a 20 caracteres" value={f.anti} onChange={(e) => setF({ ...f, anti: e.target.value })} />
          {err && <p className="text-xs text-pink">{err}</p>}
          <button className="btn w-full" disabled={busy || f.anti.length < 4} onClick={() => void run(async () => (await sec()).setAntiPhishing(f.anti), 'Código guardado 🛡️')}>Guardar</button>
        </div>
      </Sheet>

      <Sheet open={sheet === 'wl'} onClose={() => setSheet(null)} title="Adicionar número de levantamento">
        <div className="space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-2">{(['M-Pesa', 'e-Mola'] as const).map((m) => <button key={m} onClick={() => setF({ ...f, method: m })} className={`rounded-xl border p-2 ${f.method === m ? 'border-neon bg-neon/20' : 'border-line'}`}>{m}</button>)}</div>
          <input className="input w-full" inputMode="tel" placeholder={f.method === 'M-Pesa' ? '84 / 85 …' : '86 / 87 …'} value={f.msisdn} onChange={(e) => setF({ ...f, msisdn: e.target.value })} />
          <input className="input w-full" placeholder="Nome (ex.: O meu M-Pesa)" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
          <p className="text-xs text-neon2">Por segurança, o número só fica ativo daqui a 24 h e os levantamentos ficam bloqueados nesse período.</p>
          {err && <p className="text-xs text-pink">{err}</p>}
          <button className="btn w-full" disabled={busy} onClick={() => void run(async () => (await sec()).addWhitelist(f.method, f.msisdn, f.label), 'Número adicionado (ativo em 24 h)')}>Adicionar</button>
        </div>
      </Sheet>

      <Sheet open={sheet === 'kyc'} onClose={() => setSheet(null)} title={`Verificação nível ${f.kycLevel}`}>
        <div className="space-y-2 text-sm">
          {f.kycLevel === 1 && <p className="text-xs text-white/60">Confirma o teu número de telemóvel (código SMS). Sem fornecedor de SMS ativo, o pedido é revisto manualmente.</p>}
          {f.kycLevel === 2 && <p className="text-xs text-white/60">Carrega uma foto nítida do BI, passaporte ou DIRE (frente). Guardado em armazenamento privado, só a equipa de verificação vê.</p>}
          {f.kycLevel === 3 && <p className="text-xs text-white/60">Carrega uma selfie a segurar o documento ao lado do rosto.</p>}
          {f.kycLevel > 1 && <input type="file" accept="image/*" capture={f.kycLevel === 3 ? 'user' : undefined} className="input w-full text-xs" onChange={(e) => (window as unknown as { _kyc?: File })._kyc = e.target.files?.[0]} />}
          {err && <p className="text-xs text-pink">{err}</p>}
          <button className="btn w-full" disabled={busy} onClick={() => void run(async () => (await sec()).submitKyc(f.kycLevel, f.kycLevel === 1 ? 'telefone' : f.kycLevel === 2 ? 'documento' : 'selfie', (window as unknown as { _kyc?: File })._kyc), 'Pedido enviado. Revisão em até 48 h.')}>Enviar para verificação</button>
          <p className="text-xs text-white/40">Dados tratados segundo a Política de Privacidade; documentos apagados 30 dias após a decisão, exceto se a lei exigir.</p>
        </div>
      </Sheet>

      <Sheet open={sheet === 'freeze'} onClose={() => setSheet(null)} title="Congelar conta?">
        <div className="space-y-2 text-sm">
          <p>Vais bloquear pagamentos e levantamentos, pausar anúncios e terminar sessão em <b>todos</b> os dispositivos.</p>
          {err && <p className="text-xs text-pink">{err}</p>}
          <button className="w-full rounded-xl bg-red-600 py-2 font-semibold" disabled={busy} onClick={() => void run(async () => (await sec()).freeze(), 'Conta congelada ❄️')}>Sim, congelar agora</button>
        </div>
      </Sheet>
    </Page>
  );
}
