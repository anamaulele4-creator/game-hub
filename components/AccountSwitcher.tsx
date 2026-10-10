'use client';

import { useEffect, useState } from 'react';
import { Sheet, AvatarFace } from '@/components/ui';
import { useStore } from '@/lib/store';
import { IS_DEMO } from '@/lib/config';
import { MAX_ACCOUNTS, type SavedAccount, addAccount, emailHint, listAccounts, removeAccount, signOutHere, switchTo } from '@/lib/accounts';

function useAccounts() {
  const [l, setL] = useState<SavedAccount[]>([]);
  useEffect(() => {
    const r = () => setL(listAccounts());
    r();
    window.addEventListener('poipak:accounts', r);
    window.addEventListener('storage', r);
    return () => { window.removeEventListener('poipak:accounts', r); window.removeEventListener('storage', r); };
  }, []);
  return l;
}

/** Linhas da secção "Conta" (fim do menu ☰ do perfil e das Definições). */
export function AccountRows({ onSwitch, onSignOut }: { onSwitch: () => void; onSignOut: () => void }) {
  const { s } = useStore();
  if (!s.account.loggedIn) return null;
  const row = 'flex min-h-[48px] w-full items-center gap-3 px-3 text-left';
  return (
    <>
      <p className="mb-2 mt-5 px-1 text-xs font-semibold uppercase tracking-wide text-white/45">Conta</p>
      <ul className="divide-y divide-line overflow-hidden rounded-xl bg-panel2">
        <li><button type="button" className={row} onClick={onSwitch}><span className="w-6 text-center text-lg">🔄</span><span className="flex-1 text-sm">Mudar de conta</span><span className="text-white/30">›</span></button></li>
        <li><button type="button" className={row} onClick={onSignOut}><span className="w-6 text-center text-lg">🚪</span><span className="flex-1 text-sm text-red-400">Sair da conta</span></button></li>
      </ul>
    </>
  );
}

/** Folhas controladas: seletor de contas e confirmação de saída. */
export function AccountSheets({ sheet, onClose }: { sheet: '' | 'switch' | 'out'; onClose: () => void }) {
  return (
    <>
      <SwitcherSheet open={sheet === 'switch'} onClose={onClose} />
      <SignOutSheet open={sheet === 'out'} onClose={onClose} />
    </>
  );
}

function SwitcherSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { s, set, toast } = useStore();
  const all = useAccounts();
  const [busy, setBusy] = useState('');
  const [manage, setManage] = useState(false);
  const curHandle = s.user.handle;
  // Conta atual = a mais recente com o mesmo @ (a lista é atualizada quando a sessão carrega)
  const current = all.find((a) => (curHandle && a.handle === curHandle)) ?? all[0];
  const list = all.length ? all : [{ id: 'me', name: s.user.name, handle: s.user.handle, avatar: s.user.avatar, email: s.account.email, provider: s.account.method, lastUsed: 0 } as SavedAccount];
  const curId = current?.id ?? 'me';

  const pick = async (a: SavedAccount) => {
    if (a.id === curId) { onClose(); return; }
    setBusy(a.id);
    if (IS_DEMO) set((p) => ({ ...p, account: { ...p.account, loggedIn: false } }));
    const r = await switchTo(a.id).catch(() => ({ ok: false, error: 'Não foi possível mudar de conta.' }));
    if (!r.ok) { setBusy(''); toast(r.error || 'Não foi possível mudar de conta.'); }
  };

  return (
    <Sheet open={open} onClose={() => { setManage(false); onClose(); }} title="Mudar de conta">
      <ul className="space-y-1">
        {list.map((a) => {
          const isCur = a.id === curId;
          return (
            <li key={a.id} className="flex items-center gap-2">
              <button type="button" disabled={!!busy || manage} onClick={() => pick(a)} className="flex min-h-[56px] flex-1 items-center gap-3 rounded-xl px-2 text-left active:bg-panel2 disabled:opacity-100">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-panel2 text-xl"><AvatarFace a={a.avatar || '🙂'} name={a.name} fill /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{a.handle || a.name}</span>
                  <span className="block truncate text-xs text-white/50">{a.provider === 'google' ? 'Google · ' : ''}{emailHint(a.email) || a.name}{!isCur && !a.refreshToken && !IS_DEMO ? ' · precisa de entrar' : ''}</span>
                </span>
                {busy === a.id ? <span className="text-xs text-white/50">A mudar…</span>
                  : isCur ? <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neon text-xs" aria-label="Conta atual">✓</span>
                  : <span className="h-6 w-6 rounded-full border border-white/25" aria-hidden />}
              </button>
              {manage && !isCur && (
                <button type="button" className="min-h-[44px] rounded-lg px-3 text-xs text-red-400" onClick={() => { removeAccount(a.id); toast('Conta removida deste dispositivo'); }}>Remover</button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-3 border-t border-line pt-3">
        {all.length < MAX_ACCOUNTS ? (
          <button type="button" disabled={!!busy} onClick={async () => { setBusy('add'); if (IS_DEMO) set((p) => ({ ...p, account: { ...p.account, loggedIn: false } })); await addAccount(); }} className="flex min-h-[48px] w-full items-center gap-3 rounded-xl px-2 text-left text-sm active:bg-panel2">
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-dashed border-white/30 text-lg">➕</span>
            <span className="flex-1">{busy === 'add' ? 'A abrir…' : 'Adicionar conta'}</span>
          </button>
        ) : <p className="px-2 py-2 text-xs text-white/50">Máximo de {MAX_ACCOUNTS} contas neste dispositivo. Remove uma para adicionar outra.</p>}
        {list.length > 1 && (
          <button type="button" onClick={() => setManage((m) => !m)} className="mt-1 min-h-[44px] w-full rounded-xl text-sm text-white/60">{manage ? 'Concluído' : 'Remover deste dispositivo'}</button>
        )}
      </div>
      <p className="mt-3 text-center text-[11px] leading-relaxed text-white/40">As contas ficam guardadas só neste dispositivo. Mudar de conta não termina a sessão das outras.</p>
    </Sheet>
  );
}

function SignOutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { s, set } = useStore();
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} onClose={onClose} title="Sair da conta">
      <div className="space-y-4 text-sm">
        <p className="text-center text-base">Tens a certeza que queres sair?</p>
        <p className="text-center text-xs text-white/55">Sais de <b className="text-white/80">{s.user.handle || s.user.name}</b> neste dispositivo. Os teus dados ficam guardados na conta.</p>
        <label className="flex min-h-[44px] items-center gap-3 rounded-xl bg-panel2 px-3 text-xs">
          <input type="checkbox" className="h-5 w-5" checked={remember} onChange={() => setRemember((r) => !r)} />
          Lembrar esta conta neste dispositivo
        </label>
        <button type="button" disabled={busy} className="min-h-[48px] w-full rounded-xl border border-red-400/40 font-semibold text-red-400 disabled:opacity-50" onClick={async () => {
          setBusy(true);
          if (IS_DEMO) set((p) => ({ ...p, account: { ...p.account, loggedIn: false } }));
          await signOutHere(remember);
        }}>{busy ? 'A sair…' : 'Sair'}</button>
        <button type="button" className="min-h-[48px] w-full rounded-xl bg-panel2" onClick={onClose}>Cancelar</button>
      </div>
    </Sheet>
  );
}
