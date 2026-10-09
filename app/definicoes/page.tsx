'use client';

import Link from 'next/link';
import { useState } from 'react';
import { IDOLS } from '@/lib/data';
import { useStore } from '@/lib/store';
import { deleteAccount, sendOtp, verifyOtp } from '@/lib/auth';
import { PUSH_CATEGORIES, enablePush, localPush, permission } from '@/lib/push';
import { AvatarEditor } from '@/components/AvatarEditor';
import { Page, Sheet, AvatarFace } from '@/components/ui';
import { InstallButton } from '@/components/Install';
import { DemoCode, Err, OtpInput } from '@/components/AuthBits';
import { LegalFooter } from '@/components/LegalFooter';
import { POLICY_LINKS } from '@/lib/policies';
import { IS_DEMO } from '@/lib/config';
import { AccountRows, AccountSheets } from '@/components/AccountSwitcher';

const AVATARS = ['🦄', '🦊', '🐉', '🌙', '⚡', '🎮', '👾', '🦋'];

function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label?: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={onChange} className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? 'bg-neon' : 'bg-white/20'}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

export default function DefinicoesPage() {
  const { s, set, reset, toast, toggleBlock } = useStore();
  const [name, setName] = useState(s.user.name);
  const [photo, setPhoto] = useState(false);
  const [prefs, setPrefs] = useState({ autoplay: true, dataSaver: false });
  const [del, setDel] = useState<{ open: boolean; step: 'confirmar' | 'codigo' | 'feito'; ok: boolean; reason: string; code?: string; err?: string }>({ open: false, step: 'confirmar', ok: false, reason: '' });
  const [acc, setAcc] = useState<'' | 'switch' | 'out'>('');
  const perm = permission();
  const contact = s.account.method === 'phone' ? s.account.phone : s.account.email;
  const ch = s.account.method === 'phone' ? 'phone' : 'email';

  const setPref = (cat: string, k: 'inApp' | 'push') => set((p) => ({ ...p, notifPrefs: { ...p.notifPrefs, [cat]: { ...p.notifPrefs[cat as keyof typeof p.notifPrefs], [k]: !p.notifPrefs[cat as keyof typeof p.notifPrefs][k] } } }));

  return (
    <Page title="Definições" back="/perfil">
      <div className="card mb-3 space-y-3">
        <p className="font-semibold">Conta</p>
        <div className="rounded-xl bg-panel2 p-3 text-xs text-white/70">
          {s.account.loggedIn ? <>Sessão iniciada {s.account.method === 'demo' ? '(conta de demonstração · admin)' : `com ${s.account.method === 'email' ? 'email' : 'telemóvel'}`}: <b className="text-white">{contact || s.user.handle}</b></> : 'Sem sessão iniciada.'}
          <div className="mt-2 flex gap-2">
            {!s.account.loggedIn && <><Link href="/entrar" className="btn-ghost flex-1 !py-1 text-xs">Entrar</Link>
            <Link href="/registar" className="btn-ghost flex-1 !py-1 text-xs">Criar conta</Link></>}
          </div>
        </div>
        <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome" />
        <button type="button" onClick={() => setPhoto(true)} className="flex w-full items-center gap-3 rounded-xl bg-panel2 p-3 text-left">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-panel text-2xl"><AvatarFace a={s.user.avatar} name={s.user.name} fill /></span>
          <span className="flex-1 text-sm"><b className="block text-base">Foto de perfil</b><span className="text-white/60">Escolher, fotografar ou remover</span></span>
          <span className="text-white/50">›</span>
        </button>
        <AvatarEditor open={photo} onClose={() => setPhoto(false)} />
        <p className="text-xs text-white/60">Ou usa um emoji:</p>
        <div className="flex flex-wrap gap-2">{AVATARS.map((a) => <button key={a} onClick={() => set((p) => ({ ...p, user: { ...p.user, avatar: a } }))} className={`rounded-full p-2 text-2xl ${s.user.avatar === a ? 'bg-neon' : 'bg-panel2'}`}>{a}</button>)}</div>
        <button className="btn w-full" onClick={() => { set((p) => ({ ...p, user: { ...p.user, name } })); toast('Guardado'); }}>Guardar</button>
        <Link href="/seguranca" className="block text-xs text-neon2">🔐 Centro de segurança (2FA, PIN, dispositivos, congelar conta)</Link>
        <Link href="/recuperar" className="block text-xs text-neon2">🔑 Alterar palavra-passe / recuperar acesso</Link>
      </div>

      <div className="card mb-3 space-y-3">
        <div className="flex items-center justify-between"><p className="font-semibold">Notificações</p><Link href="/notificacoes" className="text-xs text-neon2">Centro ›</Link></div>
        <div className="rounded-xl bg-panel2 p-3 text-xs">
          <p className="mb-2">Push no dispositivo: <b>{perm === 'granted' && s.pushEnabled ? 'ativas ✅' : perm === 'denied' ? 'bloqueadas no navegador' : perm === 'unsupported' ? 'não suportadas aqui' : 'desativadas'}</b></p>
          <div className="flex gap-2">
            {!(perm === 'granted' && s.pushEnabled) ? (
              <button className="btn flex-1 !py-1.5 text-xs" onClick={async () => {
                const r = await enablePush(PUSH_CATEGORIES.filter((c) => s.notifPrefs[c.id].push).map((c) => c.id));
                if (r.ok) set((p) => ({ ...p, pushEnabled: true }));
                toast(r.msg);
              }}>🔔 Ativar notificações push</button>
            ) : (
              <>
                <button className="btn-ghost flex-1 !py-1.5 text-xs" onClick={async () => { const ok = await localPush({ title: 'TXAPILOG', body: 'Teste: as notificações estão a funcionar 🎮', category: 'sistema', url: '/notificacoes' }); toast(ok ? 'Notificação de teste enviada' : 'Não foi possível mostrar'); }}>Enviar teste</button>
                <button className="btn-ghost flex-1 !py-1.5 text-xs" onClick={() => { set((p) => ({ ...p, pushEnabled: false })); toast('Push desativadas nesta conta'); }}>Desativar</button>
              </>
            )}
          </div>
        </div>
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-2 text-sm">
          <span className="text-xs text-white/50">Categoria</span><span className="text-xs text-white/50">Na app</span><span className="text-xs text-white/50">Push</span>
          {PUSH_CATEGORIES.map((c) => (
            <div key={c.id} className="contents">
              <span>{c.label}<span className="block text-xs text-white/50">{c.desc}</span></span>
              <Toggle on={s.notifPrefs[c.id].inApp} onChange={() => setPref(c.id, 'inApp')} label={`${c.label} na app`} />
              <Toggle on={s.notifPrefs[c.id].push} onChange={() => setPref(c.id, 'push')} label={`${c.label} push`} />
            </div>
          ))}
        </div>
        <Link href="/bem-estar" className="block text-sm text-neon2">🌙 Silêncio noturno e limites → Bem-estar</Link>
      </div>

      <div className="card mb-3 space-y-3">
        <p className="font-semibold">Reprodução</p>
        {([['autoplay', 'Reprodução automática de clipes'], ['dataSaver', 'Poupança de dados móveis']] as const).map(([k, l]) => (
          <div key={k} className="flex items-center justify-between text-sm"><span>{l}</span><Toggle on={prefs[k]} onChange={() => setPrefs((p) => ({ ...p, [k]: !p[k] }))} label={l} /></div>
        ))}
      </div>

      <div id="privacidade" className="card mb-3 space-y-3 text-sm">
        <p className="font-semibold">Privacidade e segurança</p>
        <div className="flex items-center justify-between"><span>Anúncios personalizados<span className="block text-xs text-white/50">Idade, província e jogos. Desligado = anúncios genéricos.</span></span><Toggle on={s.consent.personalizedAds} onChange={() => set((p) => ({ ...p, consent: { ...p.consent, personalizedAds: !p.consent.personalizedAds } }))} label="Anúncios personalizados" /></div>
        <div className="flex items-center justify-between"><span>Estatísticas anónimas</span><Toggle on={s.consent.analytics} onChange={() => set((p) => ({ ...p, consent: { ...p.consent, analytics: !p.consent.analytics } }))} label="Estatísticas" /></div>
        <p className="text-xs text-white/50">Idade mínima: 13 anos. Menores: mensagens só de quem seguem e compras com autorização do encarregado.</p>
        <div>
          <p className="mb-1 text-xs text-white/60">Utilizadores bloqueados ({s.blocked.length})</p>
          {s.blocked.length === 0 ? <p className="text-xs text-white/40">Ninguém bloqueado. Usa ⋯ › Bloquear em qualquer perfil, clipe ou comentário.</p> : (
            <div className="space-y-1">{s.blocked.map((b) => { const i = IDOLS.find((x) => x.id === b); return <div key={b} className="flex items-center justify-between rounded-lg bg-panel2 px-3 py-1.5 text-xs"><span>{i ? <><AvatarFace a={i.avatar} name={i.name} /> {i.name}</> : b}</span><button className="text-neon2" onClick={() => toggleBlock(b, i?.name ?? b)}>Desbloquear</button></div>; })}</div>
          )}
        </div>
        <div>
          <p className="mb-1 text-xs text-white/60">As minhas denúncias ({s.myReports.length})</p>
          {s.myReports.slice(0, 5).map((r) => <p key={r.id} className="text-xs text-white/50">• {r.kind}: {r.label} — {r.reason} · <b>{r.status}</b></p>)}
        </div>
        <button className="btn-ghost w-full text-xs" onClick={() => { const blob = new Blob([JSON.stringify({ user: s.user, account: { ...s.account }, consent: s.consent, following: s.following, comments: s.comments, purchases: s.purchases, myReports: s.myReports }, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'gamehub-os-meus-dados.json'; a.click(); }}>⬇️ Exportar os meus dados</button>
      </div>

      <div className="card mb-3 space-y-2 text-sm">
        <p className="font-semibold">Instalar no dispositivo</p>
        <InstallButton />
        <Link href="/baixar" className="block text-center text-xs text-neon2">Mais opções (Android, iPhone, Play Store)</Link>
      </div>

      <div className="card mb-3 space-y-1 text-sm">
        <p className="mb-1 font-semibold">Legal e políticas</p>
        {POLICY_LINKS.map((l) => <Link key={l.href} href={l.href} className="flex justify-between py-1 text-white/80"><span>{l.emoji} {l.label}</span><span className="text-white/30">›</span></Link>)}
      </div>

      <div id="eliminar" className="card mb-3 space-y-2 border-red-500/40 text-sm">
        <p className="font-semibold text-red-300">Eliminar conta</p>
        <p className="text-xs text-white/60">Apaga a tua conta e dados (clipes, comentários, seguidores, progresso). Registos de pagamento são guardados pelo prazo legal. <Link href="/eliminar-conta" className="underline">Detalhes</Link></p>
        <button className="w-full rounded-xl bg-red-600 py-2 font-semibold" onClick={() => setDel({ open: true, step: 'confirmar', ok: false, reason: '' })}>Eliminar a minha conta</button>
      </div>

      {IS_DEMO && <div className="card space-y-2 text-sm">
        <p className="font-semibold">Demonstração</p>
        <p className="text-white/70">Todos os dados ficam guardados apenas neste navegador (localStorage). Nenhum pagamento é real.</p>
        <button className="btn-ghost w-full" onClick={reset}>Repor dados de demonstração</button>
      </div>}

      <div className="mb-3">
        <AccountRows onSwitch={() => setAcc('switch')} onSignOut={() => setAcc('out')} />
      </div>
      <AccountSheets sheet={acc} onClose={() => setAcc('')} />

      <LegalFooter />

      <Sheet open={del.open} onClose={() => setDel({ ...del, open: false })} title="Eliminar conta">
        {del.step === 'confirmar' && (
          <div className="space-y-3 text-sm">
            <p>Esta ação é <b>permanente</b>. Perdes o perfil, clipes, XP, moedas por usar e assinaturas ativas (cancela-as primeiro).</p>
            <select className="input w-full" value={del.reason} onChange={(e) => setDel({ ...del, reason: e.target.value })}>
              <option value="">Motivo (opcional)</option>
              {['Passo demasiado tempo na app', 'Preocupações de privacidade', 'Não uso', 'Tenho outra conta', 'Outro'].map((o) => <option key={o}>{o}</option>)}
            </select>
            <label className="flex gap-2 text-xs"><input type="checkbox" checked={del.ok} onChange={() => setDel({ ...del, ok: !del.ok })} />Compreendo que a conta e os dados serão eliminados.</label>
            <button className="w-full rounded-xl bg-red-600 py-2 font-semibold disabled:opacity-40" disabled={!del.ok} onClick={async () => {
              const r = await sendOtp(ch, contact || 'demo@poipak.mz');
              if (!r.ok) return setDel({ ...del, err: r.error });
              setDel({ ...del, step: 'codigo', code: r.demoCode, err: undefined });
            }}>Enviar código de confirmação</button>
          </div>
        )}
        {del.step === 'codigo' && (
          <div className="space-y-3 text-sm">
            <p>Introduz o código enviado para <b>{contact || 'o teu contacto'}</b>.</p>
            <DemoCode code={del.code} />
            <OtpInput onSubmit={async (code) => {
              const v = await verifyOtp(ch, contact || 'demo@poipak.mz', code);
              if (!v.ok) return setDel({ ...del, err: v.error });
              const r = await deleteAccount(del.reason);
              if (!r.ok) return setDel({ ...del, err: r.error });
              setDel({ ...del, step: 'feito', err: undefined });
            }} />
            <Err msg={del.err} />
          </div>
        )}
        {del.step === 'feito' && (
          <div className="space-y-3 text-center text-sm">
            <p className="text-4xl">👋</p>
            <p>Conta eliminada. Os dados restantes são apagados em até 30 dias.</p>
            {IS_DEMO && <p className="text-xs text-white/50">Demo: os dados deste navegador vão ser repostos.</p>}
            <button className="btn w-full" onClick={() => { reset(); setDel({ open: false, step: 'confirmar', ok: false, reason: '' }); }}>Concluir</button>
          </div>
        )}
      </Sheet>
    </Page>
  );
}
