'use client';

// Inscrição num torneio em 3 passos: dados do jogador → Vincular Discord → confirmação.
// Inscrições pagas ficam desligadas até haver pagamentos M-Pesa/e-Mola.
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { IS_DEMO } from '@/lib/config';
import { Tournament, mzn } from '@/lib/data';
import { GAMES_CFG, PAY_SOON, fmtWhen, gameKeyOf } from '@/lib/jogos';
import { EntryForm, EntryField, REG_ERROR, discordRule, discordStepOk, isTeamMode, validDiscordUsername, validateEntry } from '@/lib/registration';
import { entriesApi } from '@/lib/entriesApi';
import { uploadPhoto } from '@/lib/media';
import { TeamBadge } from './TeamBadge';
import { BxSheet } from './BxSheet';

type Step = 'dados' | 'discord' | 'feito';

export function RegistrationSheet({ t, onClose }: { t: Tournament | null; onClose: () => void }) {
  const { s, set, toast, pushNotif } = useStore();
  const [step, setStep] = useState<Step>('dados');
  const [f, setF] = useState<EntryForm>({ playerName: '', gameId: '', team: '', contact: '' });
  const [touched, setTouched] = useState(false);
  const [du, setDu] = useState('');
  const [joined, setJoined] = useState(false);
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logo, setLogo] = useState('');
  const [logoBusy, setLogoBusy] = useState(false);

  useEffect(() => {
    if (!t) return;
    setStep('dados'); setTouched(false); setDu(''); setJoined(false); setOpened(false); setLogo('');
    setF({ playerName: s.user.name && s.user.name !== 'Visitante' ? s.user.name : '', gameId: '', team: '', contact: s.account.phone || s.account.email || '' });
  }, [t?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!t) return null;
  const key = gameKeyOf(t.game);
  const g = GAMES_CFG[key];
  const rule = discordRule(t, s.admin.settings.discordInvite);
  const errs = validateEntry(f, t);
  const paid = t.fee > 0;
  const team = isTeamMode(t.mode);
  const needLogin = !IS_DEMO && !s.account.loggedIn;

  const next = () => {
    setTouched(true);
    if (Object.keys(errs).length) return;
    setStep(rule.invite || rule.required ? 'discord' : 'feito');
    if (!rule.invite && !rule.required) void submit();
  };
  async function submit() {
    setBusy(true);
    const r = await entriesApi.register(t!.id, f, { username: du, joined }, logo).catch((e) => ({ ok: false as const, code: (e as Error).message }));
    setBusy(false);
    if (!r.ok) { toast(REG_ERROR[r.code] ?? r.code); if (r.code !== 'ALREADY') setStep('dados'); return; }
    set((p) => ({
      ...p,
      entries: p.entries.includes(t!.id) ? p.entries : [...p.entries, t!.id],
      admin: { ...p.admin, tournaments: p.admin.tournaments.map((x) => (x.id === t!.id ? { ...x, filled: x.filled + 1 } : x)) },
    }));
    pushNotif({ type: 'torneio', text: `Inscrição confirmada: ${t!.name}`, href: `/torneio/?id=${t!.id}` });
    setStep('feito');
  }

  const field = (k: EntryField, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block text-[13px] font-semibold">{label}
      <input className={`bx-input mt-1 ${touched && errs[k] ? '!border-red-500' : ''}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} />
      {touched && errs[k] && <span className="mt-1 block text-[12px] font-normal text-red-300">{errs[k]}</span>}
    </label>
  );

  const steps: [Step, string][] = [['dados', 'Dados'], ['discord', 'Discord'], ['feito', 'Confirmação']];
  return (
    <BxSheet open onClose={onClose} title={`Inscrição · ${t.name}`}>
      <ol className="mb-4 grid grid-cols-3 gap-1 text-center text-[11.5px]" aria-label="Passos">
        {steps.map(([k, l], i) => {
          const done = steps.findIndex(([x]) => x === step) >= i;
          return <li key={k} className={`rounded-full py-1.5 font-semibold ${done ? 'bg-[var(--bx-acc)] text-[var(--bx-on)]' : 'bg-[var(--bx-card2)] text-white/60'}`} aria-current={step === k ? 'step' : undefined}>{i + 1}. {l}</li>;
        })}
      </ol>

      {paid ? (
        <>
          <p className="bx-muted text-sm">{t.game} · {t.mode} · {fmtWhen(t.date)} · entrada {mzn(t.fee)}</p>
          <p role="status" className="mt-3 rounded-xl border border-[#FF6B1A]/50 bg-[#FF6B1A]/10 p-3 text-sm font-semibold text-[#FFB38A]">{PAY_SOON} – Nada foi cobrado</p>
        </>
      ) : needLogin ? (
        <p className="text-sm">Entra na tua conta para te inscreveres.</p>
      ) : step === 'dados' ? (
        <div className="space-y-3">
          <p className="bx-muted text-[13px]">{t.game} · {t.mode} · {fmtWhen(t.date)} · {t.filled}/{t.slots} vagas · inscrição grátis</p>
          {field('playerName', 'Nome de jogador', { maxLength: 40, autoComplete: 'nickname' })}
          {field('gameId', g.idLabel, { maxLength: 60, placeholder: g.idPlaceholder, inputMode: key === 'ff' ? 'numeric' : 'text', autoComplete: 'off' })}
          {team && field('team', 'Nome da equipa', { maxLength: 40 })}
          {team && (
            <div className="flex items-center gap-3">
              <TeamBadge name={f.team || f.playerName || 'Equipa'} logo={logo} size={52} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold">Logo/foto da equipa <span className="bx-muted font-normal">(opcional)</span></p>
                <div className="mt-1 flex gap-2">
                  <label className="bx-ghost cursor-pointer !min-h-[44px] !px-3 !text-[13px]">
                    {logoBusy ? 'A enviar…' : logo ? 'Trocar' : 'Escolher imagem'}
                    <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={logoBusy} onChange={async (e) => {
                      const file = e.target.files?.[0]; e.target.value = '';
                      if (!file) return;
                      setLogoBusy(true);
                      try { setLogo(await uploadPhoto(file, `teams/${IS_DEMO ? 'demo' : s.account.loggedIn ? await myId() : 'anon'}`, { square: true })); }
                      catch (err) { toast((err as Error).message); }
                      finally { setLogoBusy(false); }
                    }} />
                  </label>
                  {logo && <button type="button" className="bx-ghost !min-h-[44px] !px-3 !text-[13px]" onClick={() => setLogo('')}>Remover</button>}
                </div>
              </div>
            </div>
          )}
          {field('contact', 'Contacto (telemóvel ou email)', { maxLength: 80, autoComplete: 'tel' })}
          {rule.missing && <p role="status" className="rounded-xl border border-[#F59E0B]/50 bg-[#F59E0B]/10 p-3 text-[13px] text-[#FCD34D]">{REG_ERROR.DISCORD_MISSING}</p>}
          <button type="button" className="bx-btn w-full" disabled={rule.missing || logoBusy} onClick={next}>Continuar</button>
        </div>
      ) : step === 'discord' ? (
        <div className="space-y-3">
          <h4 className="text-base font-bold">Vincular Discord</h4>
          {rule.missing ? (
            <p role="status" className="rounded-xl border border-[#F59E0B]/50 bg-[#F59E0B]/10 p-3 text-[13px] text-[#FCD34D]">{REG_ERROR.DISCORD_MISSING}</p>
          ) : !rule.invite ? (
            <p className="bx-muted text-[13px]">Este torneio ainda não tem grupo do Discord. Podes continuar.</p>
          ) : (
            <>
              <p className="bx-muted text-[13px]">A organização usa o Discord para chamadas, horários e salas. {rule.required ? 'Este passo é obrigatório.' : 'Recomendado.'}</p>
              <a href={rule.invite} target="_blank" rel="noopener noreferrer" onClick={() => setOpened(true)} className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[#5865F2] px-4 text-[15px] font-bold text-white">
                <DiscordIcon /> Entrar no grupo do Discord
              </a>
              <label className="block text-[13px] font-semibold">O teu username do Discord
                <input className={`bx-input mt-1 ${du && !validDiscordUsername(du) ? '!border-red-500' : ''}`} value={du} maxLength={37} autoComplete="off" autoCapitalize="none" placeholder="ex.: mambas_ff" onChange={(e) => setDu(e.target.value)} />
                {du && !validDiscordUsername(du) && <span className="mt-1 block text-[12px] font-normal text-red-300">Usa o username (minúsculas, números, _ e .), sem espaços.</span>}
              </label>
              <label className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border border-[var(--bx-line)] p-3 text-sm">
                <input type="checkbox" className="h-5 w-5 shrink-0" checked={joined} onChange={(e) => setJoined(e.target.checked)} />
                Já entrei no grupo
              </label>
              {!opened && !joined && <p className="bx-dim text-[12px]">Abre o convite primeiro e volta a esta página.</p>}
            </>
          )}
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <button type="button" className="bx-ghost" onClick={() => setStep('dados')}>Voltar</button>
            <button type="button" className="bx-btn" disabled={busy || !discordStepOk(rule, du, joined)} onClick={submit}>{busy ? 'A inscrever…' : 'Continuar inscrição'}</button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-center">
          {busy ? <p className="bx-muted text-sm">A inscrever…</p> : (
            <>
              
              <p className="text-lg font-bold">Inscrição confirmada</p>
              <p className="bx-muted text-sm">{f.playerName}{team && f.team ? ` · ${f.team}` : ''} · {t.name}</p>
              <p className="bx-muted text-[13px]">Vês a inscrição e o estado em Perfil › As minhas inscrições.</p>
              <button type="button" className="bx-btn w-full" onClick={onClose}>Fechar</button>
            </>
          )}
        </div>
      )}
    </BxSheet>
  );
}

async function myId(): Promise<string> {
  const { sb } = await import('@/lib/supabase');
  const { data } = await (await sb()).auth.getSession();
  return data.session?.user.id ?? 'anon';
}

function DiscordIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.4 18.4 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1a19.9 19.9 0 0 0 6 3l1.3-2a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2a19.8 19.8 0 0 0 6-3c.5-5.2-.9-9.7-3.6-13.7ZM8 15.4c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.6 8 10.6s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>;
}
