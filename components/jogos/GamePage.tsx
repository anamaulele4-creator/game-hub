'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { Tournament } from '@/lib/data';
import { ageFrom } from '@/lib/age';
import {
  GAMES_CFG, GameCfg, GameKey, MARKET_CATS, MarketCat, fmtMzPhone, fmtWhen, gameKeyOf, isGameKey, mtOrTba, normalizeMzPhone, validPlayerId,
} from '@/lib/jogos';
import { Carousel, ExampleTag, GameIcon, JogosHeader, PaySoon, Sheet, Slide, SummaryRow } from './Kit';

const TABS = ['Início', 'Torneios', 'Histórico', 'Recargas', 'Apostas', 'Marketplace'] as const;
type Tab = (typeof TABS)[number];
const SLUG: Record<Tab, string> = { Início: 'inicio', Torneios: 'torneios', Histórico: 'historico', Recargas: 'recargas', Apostas: 'apostas', Marketplace: 'marketplace' };

export default function GamePage({ game }: { game: GameKey }) {
  const key: GameKey = isGameKey(game) ? game : 'outros';
  const g = GAMES_CFG[key];
  const { s } = useStore();
  const [tab, setTabState] = useState<Tab>('Início');
  const [join, setJoin] = useState<Tournament | null>(null);

  // Separador por #hash (links diretos, ex.: /jogos/ff/#recargas)
  useEffect(() => {
    const h = window.location.hash.slice(1);
    const t = TABS.find((x) => SLUG[x] === h);
    if (t) setTabState(t);
  }, []);
  const setTab = (t: Tab) => {
    setTabState(t);
    try { history.replaceState(null, '', '#' + SLUG[t]); } catch {}
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const tours = useMemo(() => s.admin.tournaments.filter((t) => gameKeyOf(t.game) === key).sort((a, b) => a.date.localeCompare(b.date)), [s.admin.tournaments, key]);
  const wa = (s.admin.settings.gameLinks ?? {})[key];

  return (
    <>
      <JogosHeader />
      <main className="pb-28">
        <div className="flex items-center gap-3 px-4 pt-3">
          <Link href="/jogos" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-panel2 text-2xl leading-none" aria-label="Voltar às categorias">‹</Link>
          <GameIcon g={g} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-2xl font-bold uppercase leading-tight">{g.name}</h1>
            <p className="truncate text-xs text-white/60">Servidor {g.name}</p>
          </div>
          {wa && /^https:\/\/chat\.whatsapp\.com\//.test(wa) && (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="flex min-h-[40px] shrink-0 items-center gap-1 rounded-full bg-[#25D366] px-3 text-xs font-bold text-[#06301A]">💬 Grupo do WhatsApp</a>
          )}
        </div>

        <nav className="no-scrollbar sticky top-[61px] z-20 mt-3 flex overflow-x-auto border-b border-line bg-bg/95 px-2" role="tablist" aria-label={`Secções de ${g.name}`}>
          {TABS.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`relative min-h-[46px] shrink-0 px-3 text-sm font-semibold ${tab === t ? 'text-white' : 'text-white/55'}`}>
              {t}
              {tab === t && <span className="absolute inset-x-2 bottom-0 h-[3px] rounded-t bg-neon" />}
            </button>
          ))}
        </nav>

        <div className="px-4 pt-4" role="tabpanel">
          {tab === 'Início' && <Inicio g={g} tours={tours} onJoin={setJoin} setTab={setTab} />}
          {tab === 'Torneios' && <Torneios tours={tours} onJoin={setJoin} />}
          {tab === 'Histórico' && <Historico g={g} tours={tours} />}
          {tab === 'Recargas' && <Recargas g={g} />}
          {tab === 'Apostas' && <Apostas g={g} />}
          {tab === 'Marketplace' && <Marketplace g={g} />}
        </div>
      </main>
      <InscreverSheet t={join} onClose={() => setJoin(null)} />
    </>
  );
}

/* ---------------- Início ---------------- */
function Inicio({ g, tours, onJoin, setTab }: { g: GameCfg; tours: Tournament[]; onJoin: (t: Tournament) => void; setTab: (t: Tab) => void }) {
  const { ready } = useStore();
  const open = tours.filter((t) => t.status === 'aberto').slice(0, 3);
  const slides: Slide[] = open.length ? open.map((t) => ({
    key: t.id, tag: 'TORNEIO', tagCls: 'bg-neon text-ink', cover: g.cover, emoji: g.emoji, title: t.name,
    sub: `${t.mode} · ${fmtWhen(t.date)} · Prémio ${mtOrTba(t.prize)}`, cta: 'Inscrever', onCta: () => onJoin(t),
  })) : [{
    key: 'none', tag: 'TORNEIO', tagCls: 'bg-neon text-ink', cover: g.cover, emoji: g.emoji, title: ready ? 'A anunciar' : 'A carregar…',
    sub: ready ? `Ainda não há torneios de ${g.name} com inscrições abertas.` : 'A carregar torneios…', note: 'Entra no grupo e ativa as notificações para saberes primeiro.',
    cta: 'Ver torneios', onCta: () => setTab('Torneios'),
  }];
  const quick: [string, string, string, Tab][] = [
    ['💎', `Recarregar ${g.currency}`, 'M-Pesa ou e-Mola, directo na conta', 'Recargas'],
    ['🏆', 'Torneios', 'Inscrições abertas e a decorrer', 'Torneios'],
    ['🛍️', 'Marketplace', 'Guias, coaching, packs para lives', 'Marketplace'],
    ['📜', 'O meu histórico', 'Torneios, posições e ganhos', 'Histórico'],
  ];
  return (
    <>
      <Carousel slides={slides} label={`Torneios de ${g.name}`} />
      <div className="mt-5 grid grid-cols-2 gap-3">
        {quick.map(([e, t, d, to]) => (
          <button key={t} type="button" onClick={() => setTab(to)} className="hud-card flex min-h-[96px] flex-col items-start gap-1 p-3 text-left transition-transform active:scale-[.98] motion-reduce:transform-none">
            <span className="text-2xl" aria-hidden>{e}</span>
            <span className="text-sm font-bold leading-tight">{t}</span>
            <span className="text-[12px] leading-snug text-white/60">{d}</span>
          </button>
        ))}
      </div>
    </>
  );
}

/* ---------------- Torneios ---------------- */
const STATUS: [Tournament['status'], string][] = [['aberto', 'Inscrições abertas'], ['a decorrer', 'A decorrer'], ['terminado', 'Terminados']];

function Torneios({ tours, onJoin }: { tours: Tournament[]; onJoin: (t: Tournament) => void }) {
  const { s, ready } = useStore();
  const [st, setSt] = useState<Tournament['status']>('aberto');
  const list = tours.filter((t) => t.status === st);
  return (
    <>
      <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
        {STATUS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setSt(k)} aria-pressed={st === k} className={`min-h-[40px] shrink-0 rounded-full px-4 text-sm ${st === k ? 'bg-neon font-semibold text-ink' : 'bg-panel2 text-white/75'}`}>{l}</button>
        ))}
      </div>
      {!ready ? <div className="space-y-3">{[0, 1].map((k) => <span key={k} className="skeleton block h-24" />)}</div>
        : list.length === 0 ? <p className="card text-center text-sm text-white/60">{st === 'aberto' ? 'Sem inscrições abertas de momento. Novos torneios aparecem aqui.' : st === 'a decorrer' ? 'Nenhum torneio a decorrer.' : 'Ainda não há torneios terminados.'}</p>
        : (
          <div className="space-y-3">
            {list.map((t) => {
              const joined = s.entries.includes(t.id);
              const full = t.filled >= t.slots;
              return (
                <div key={t.id} className="card flex items-center gap-3 !p-3">
                  <Link href={`/torneios/${t.id}/`} className="min-w-0 flex-1">
                    <p className="truncate font-display text-lg font-bold leading-tight">{t.name}</p>
                    <p className="truncate text-xs text-white/60">{t.mode} · {fmtWhen(t.date)}</p>
                    <p className="mt-0.5 text-xs text-white/60">Entrada <b className="text-white">{t.fee > 0 ? `${t.fee.toLocaleString('pt-PT')} MT` : 'Grátis'}</b> · Prémio <b className="text-neon2">{mtOrTba(t.prize)}</b> · <span className="stat-num">{t.filled}/{t.slots}</span></p>
                  </Link>
                  {t.status === 'aberto' ? (
                    joined ? <span className="shrink-0 rounded-lg bg-lime/20 px-2 py-1 text-xs font-semibold text-lime">✓ Inscrito</span>
                      : full ? <span className="shrink-0 text-xs text-white/60">Esgotado</span>
                      : <button type="button" className="btn shrink-0 !min-h-[40px] !px-4 !text-sm" onClick={() => onJoin(t)}>Inscrever</button>
                  ) : <Link href={`/torneios/${t.id}/`} className="btn-ghost shrink-0 !min-h-[40px] !px-3 !text-sm">Ver</Link>}
                </div>
              );
            })}
          </div>
        )}
    </>
  );
}

function InscreverSheet({ t, onClose }: { t: Tournament | null; onClose: () => void }) {
  const { s, set, toast, pushNotif, unlock } = useStore();
  const [team, setTeam] = useState('');
  const [soon, setSoon] = useState(false);
  useEffect(() => { setSoon(false); setTeam(s.user.name && s.user.name !== 'Visitante' ? s.user.name : ''); }, [t?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!t) return null;
  const paid = t.fee > 0;
  const register = () => {
    set((p) => ({
      ...p,
      entries: p.entries.includes(t.id) ? p.entries : [...p.entries, t.id],
      admin: { ...p.admin, tournaments: p.admin.tournaments.map((x) => (x.id === t.id ? { ...x, filled: x.filled + 1 } : x)) },
    }));
    unlock('a9');
    pushNotif({ type: 'torneio', text: `Inscrição confirmada: ${t.name} (${team.trim()})`, href: `/torneios/${t.id}` });
    toast('Inscrição confirmada 🏆');
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title="Inscrição">
      <div className="card mb-3 !p-3">
        <SummaryRow k="Torneio" v={t.name} />
        <SummaryRow k="Jogo · modo" v={`${t.game} · ${t.mode}`} />
        <SummaryRow k="Data" v={fmtWhen(t.date)} />
        <SummaryRow k="Vagas" v={`${t.filled}/${t.slots}`} />
        <SummaryRow k="Prémio" v={mtOrTba(t.prize)} />
        <SummaryRow k="Entrada" v={paid ? `${t.fee.toLocaleString('pt-PT')} MT` : 'Grátis'} strong />
      </div>
      <label className="text-xs text-white/60" htmlFor="team">Nome da equipa / jogador</label>
      <input id="team" className="input mb-3 mt-1 w-full" value={team} maxLength={40} onChange={(e) => setTeam(e.target.value)} placeholder="Ex.: Mambas FF" />
      {soon ? <PaySoon /> : (
        <button type="button" className="btn w-full" disabled={team.trim().length < 2} onClick={() => (paid ? setSoon(true) : register())}>
          {paid ? `Pagar inscrição · ${t.fee.toLocaleString('pt-PT')} MT` : 'Confirmar inscrição grátis'}
        </button>
      )}
      <Link href={`/torneios/${t.id}/`} className="mt-3 block text-center text-sm text-neon2">Regras e detalhes do torneio</Link>
    </Sheet>
  );
}

/* ---------------- Histórico ---------------- */
function Historico({ g, tours }: { g: GameCfg; tours: Tournament[] }) {
  const { s, ready } = useStore();
  const mine = tours.filter((t) => s.entries.includes(t.id)).sort((a, b) => b.date.localeCompare(a.date));
  const played = mine.filter((t) => t.status !== 'aberto').length;
  const cards: [string, string][] = [['Torneios jogados', String(played)], ['Melhor posição', '—'], [g.statTotal, '—'], ['Ganhos', '—']];
  return (
    <>
      <h2 className="sec-title mb-3">O meu histórico em {g.name}</h2>
      <div className="mb-4 grid grid-cols-2 gap-2">
        {cards.map(([l, v]) => (
          <div key={l} className="hud-stat !min-h-[64px] p-2"><span className="stat-num text-2xl">{ready ? v : '…'}</span><span className="text-[11px] text-white/65">{l}</span></div>
        ))}
      </div>
      <p className="mb-3 text-xs text-white/50">Posição, {g.statCol.toLowerCase()} e ganhos aparecem quando o organizador validar os resultados. Nada é estimado.</p>
      {mine.length === 0 ? (
        <p className="card text-center text-sm text-white/60">{ready ? `Ainda não participaste em torneios de ${g.name}.` : 'A carregar…'}</p>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead><tr className="border-b border-line text-[11px] uppercase tracking-wider text-white/55">
              <th className="py-2 pr-2 font-semibold">Torneio</th><th className="py-2 pr-2 font-semibold">Data</th><th className="py-2 pr-2 font-semibold">Posição</th><th className="py-2 pr-2 font-semibold">{g.statCol}</th><th className="py-2 font-semibold">Ganho</th>
            </tr></thead>
            <tbody>
              {mine.map((t) => (
                <tr key={t.id} className="border-b border-line/50">
                  <td className="py-2.5 pr-2 font-semibold"><Link href={`/torneios/${t.id}/`}>{t.name}</Link></td>
                  <td className="py-2.5 pr-2 text-white/70">{fmtWhen(t.date)}</td>
                  <td className="py-2.5 pr-2">{t.status === 'aberto' ? <span className="text-xs text-white/55">Por jogar</span> : '—'}</td>
                  <td className="stat-num py-2.5 pr-2">—</td>
                  <td className="stat-num py-2.5">—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ---------------- Recargas ---------------- */
function Recargas({ g }: { g: GameCfg }) {
  const [id, setId] = useState('');
  const [pack, setPack] = useState(g.defaultPack);
  const [method, setMethod] = useState<'M-Pesa' | 'e-Mola'>('M-Pesa');
  const [phone, setPhone] = useState('');
  const [touched, setTouched] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [soon, setSoon] = useState(false);
  const idOk = validPlayerId(g.key, id);
  const tel = normalizeMzPhone(phone);
  const pay = () => { setTouched(true); if (idOk && tel) { setSoon(false); setSheet(true); } };
  return (
    <>
      <h2 className="sec-title mb-3">Recarregar {g.currency}</h2>
      <div className="grid gap-4 sm:grid-cols-[1fr_250px]">
        <div className="space-y-4">
          <div>
            <label htmlFor="pid" className="text-sm font-semibold">1. {g.idLabel}</label>
            <input id="pid" className={`input mt-1 w-full ${touched && !idOk ? '!border-red-400' : ''}`} value={id} onChange={(e) => setId(e.target.value)} placeholder={g.idPlaceholder}
              inputMode={g.key === 'ff' ? 'numeric' : 'text'} autoComplete="off" />
            <p className={`mt-1 text-xs ${touched && !idOk ? 'text-red-300' : 'text-white/55'}`}>{touched && !idOk ? (g.key === 'ff' ? 'O ID Free Fire tem só números (6 a 12).' : g.key === 'cr' ? 'Tag inválida. Ex.: #2PYQ8L0' : 'Indica a conta do jogo.') : g.idHelp}</p>
          </div>
          <div>
            <p className="text-sm font-semibold">2. Escolhe o pacote</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {g.packs.map((p) => (
                <button key={p} type="button" onClick={() => setPack(p)} aria-pressed={pack === p}
                  className={`flex min-h-[72px] flex-col items-center justify-center rounded-xl border-2 bg-panel p-2 ${pack === p ? 'border-neon bg-neon/10' : 'border-line'}`}>
                  <span className="stat-num text-xl">{p.toLocaleString('pt-PT')}</span>
                  <span className="text-[11px] text-white/60">{g.currencyOne}</span>
                  <span className="mt-0.5 text-[11px] text-neon2">Preço a anunciar</span>
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-white/45">Pacotes indicativos; confirmados com o parceiro oficial quando a revenda abrir.</p>
          </div>
          <div>
            <p className="text-sm font-semibold">3. Pagamento</p>
            <div className="mt-2 grid grid-cols-2 gap-1 rounded-xl bg-panel2 p-1" role="radiogroup" aria-label="Método de pagamento">
              {(['M-Pesa', 'e-Mola'] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)} className={`min-h-[40px] rounded-lg text-sm font-semibold ${method === m ? 'bg-neon text-ink' : 'text-white/70'}`}>{m}</button>
              ))}
            </div>
            <label htmlFor="tel" className="mt-3 block text-xs text-white/70">Número {method}</label>
            <input id="tel" type="tel" inputMode="tel" autoComplete="tel" className={`input mt-1 w-full ${touched && !tel ? '!border-red-400' : ''}`} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="84 / 85 / 86 / 87 ..." />
            {touched && !tel && <p className="mt-1 text-xs text-red-300">Número moçambicano inválido: começa por 84, 85, 86 ou 87 e tem 9 dígitos.</p>}
          </div>
        </div>
        <aside className="hud-card h-fit p-4">
          <p className="mb-2 font-display text-lg font-bold uppercase">Resumo</p>
          <SummaryRow k="Pacote" v={`${pack.toLocaleString('pt-PT')} ${g.currencyOne}`} />
          <SummaryRow k="Pagamento" v={method} />
          <SummaryRow k="Entrega" v="A anunciar" />
          <SummaryRow k="Total" v="A anunciar" strong />
          <button type="button" className="btn mt-3 w-full" onClick={pay}>Pagar com {method}</button>
          <p className="mt-2 text-center text-[11px] text-white/50">Revenda via parceiro oficial (a anunciar)</p>
        </aside>
      </div>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Confirmar recarga">
        <div className="card mb-3 !p-3">
          <SummaryRow k="Jogo" v={g.name} />
          <SummaryRow k="Conta" v={id.trim()} />
          <SummaryRow k="Pacote" v={`${pack.toLocaleString('pt-PT')} ${g.currencyOne}`} />
          <SummaryRow k="Pagamento" v={`${method} · ${tel ? fmtMzPhone(tel) : ''}`} />
          <SummaryRow k="Entrega" v="A anunciar" />
          <SummaryRow k="Total" v="A anunciar" strong />
        </div>
        {soon ? <PaySoon /> : <button type="button" className="btn w-full" onClick={() => setSoon(true)}>Confirmar e pagar com {method}</button>}
      </Sheet>
    </>
  );
}

/* ---------------- Apostas (desativadas) ---------------- */
function Apostas({ g }: { g: GameCfg }) {
  const { s } = useStore();
  const [gate, setGate] = useState(true);
  const age = s.account.birth ? ageFrom(s.account.birth) : 0;
  const minor = !!s.account.birth && age > 0 && age < 18;
  const matches: [string, string][] = [['Equipa A', 'Equipa B'], ['Equipa C', 'Equipa D'], ['Equipa E', 'Equipa F']];
  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="sec-title">Apostas em {g.name}</h2>
        <span className="rounded bg-[#7F1D1D] px-1.5 py-0.5 text-xs font-bold text-white">18+</span>
      </div>
      {gate ? (
        <div className="card">
          <p className="font-display text-xl font-bold uppercase">Só para maiores de 18 anos</p>
          <p className="mt-1 text-sm text-white/70">Para apostar tens de verificar a idade com o BI. Contas não verificadas não vêem as odds.</p>
          <p className="mt-2 text-xs text-white/50">Operação licenciada: licença IGJ ainda não emitida</p>
          {minor ? (
            <p className="mt-3 rounded-xl border border-red-400/50 bg-red-500/10 p-3 text-sm text-red-200">A tua conta indica menos de 18 anos. Esta secção não está disponível para ti.</p>
          ) : (
            <>
              <button type="button" className="btn mt-3 w-full" onClick={() => setGate(false)}>Verificar idade com BI</button>
              <p className="mt-2 text-xs text-white/50">A verificação com BI faz-se no <Link href="/seguranca" className="text-neon2 underline">Centro de Segurança</Link> e só será exigida quando as apostas abrirem.</p>
            </>
          )}
        </div>
      ) : (
        <>
          <div role="status" className="mb-4 rounded-xl border border-red-400/60 bg-[#7F1D1D]/40 p-3 text-sm font-semibold text-red-100">🚫 Apostas indisponíveis até licença do IGJ</div>
          <div className="grid gap-4 sm:grid-cols-[1fr_250px]">
            <div className="space-y-2">
              <ExampleTag />
              {matches.map(([a, b], k) => (
                <div key={a} className="card !p-3 opacity-80">
                  <p className="text-sm font-semibold">{a} vs {b}</p>
                  <p className="text-xs text-white/55">Exemplo {k + 1} · horário a anunciar</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button type="button" disabled className="min-h-[44px] rounded-lg border border-line bg-panel2 text-xs text-white/60 disabled:cursor-not-allowed">Vitória lado A <b className="text-neon2">—</b></button>
                    <button type="button" disabled className="min-h-[44px] rounded-lg border border-line bg-panel2 text-xs text-white/60 disabled:cursor-not-allowed">Vitória lado B <b className="text-neon2">—</b></button>
                  </div>
                </div>
              ))}
            </div>
            <aside className="hud-card h-fit p-4">
              <p className="mb-1 font-display text-lg font-bold uppercase">Boletim</p>
              <p className="text-sm text-white/60">Escolhe um resultado para começar.</p>
              <label htmlFor="stake" className="mt-3 block text-xs text-white/60">Valor a apostar (MT)</label>
              <input id="stake" type="number" disabled placeholder="0" className="input mt-1 w-full disabled:opacity-50" />
              <p className="mt-2 text-sm text-white/60">Retorno possível: —</p>
              <button type="button" disabled className="btn mt-3 w-full">Confirmar aposta</button>
              <p className="mt-2 text-center text-[11px] text-white/50">Limite diário: a definir · Jogo responsável</p>
            </aside>
          </div>
        </>
      )}
    </>
  );
}

/* ---------------- Marketplace ---------------- */
function Marketplace({ g }: { g: GameCfg }) {
  const [cat, setCat] = useState<'Todos' | MarketCat>('Todos');
  const [buy, setBuy] = useState<{ cat: MarketCat; title: string } | null>(null);
  const [sell, setSell] = useState(false);
  const [soon, setSoon] = useState(false);
  const list = g.market.filter((p) => cat === 'Todos' || p.cat === cat);
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="sec-title min-w-0 truncate">Marketplace {g.name}</h2>
        <button type="button" onClick={() => setSell(true)} className="shrink-0 rounded-xl border-2 border-neon px-3 py-1.5 text-xs font-bold text-neon2">Vender um produto</button>
      </div>
      <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
        {MARKET_CATS.map((c) => (
          <button key={c} type="button" onClick={() => setCat(c)} aria-pressed={cat === c} className={`min-h-[40px] shrink-0 rounded-full px-4 text-sm ${cat === c ? 'bg-neon font-semibold text-ink' : 'bg-panel2 text-white/75'}`}>{c}</button>
        ))}
      </div>
      <ExampleTag className="mb-3" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {list.map((p) => (
          <div key={p.title} className="flex flex-col overflow-hidden rounded-2xl border border-line bg-panel">
            <div className={`flex h-24 items-center justify-center bg-gradient-to-br ${g.cover} text-3xl`} aria-hidden>{p.cat === 'Guias' ? '📘' : p.cat === 'Coaching' ? '🎯' : p.cat === 'Design' ? '🎨' : '🎥'}</div>
            <div className="flex flex-1 flex-col p-2.5">
              <span className="w-fit rounded bg-neon/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-neon2">{p.cat}</span>
              <p className="mt-1 text-sm font-semibold leading-snug">{p.title}</p>
              <p className="text-[11px] text-white/50">por vendedor a anunciar</p>
              <p className="mt-auto pt-1 text-sm font-bold text-neon2">Preço a anunciar</p>
              <button type="button" onClick={() => { setSoon(false); setBuy(p); }} className="mt-2 min-h-[40px] rounded-lg bg-ink text-sm font-semibold text-white">Comprar</button>
            </div>
          </div>
        ))}
      </div>
      <Sheet open={!!buy} onClose={() => setBuy(null)} title="Resumo da compra">
        {buy && <>
          <div className="card mb-3 !p-3">
            <SummaryRow k="Produto" v={buy.title} />
            <SummaryRow k="Categoria" v={buy.cat} />
            <SummaryRow k="Vendedor" v="A anunciar" />
            <SummaryRow k="Total" v="A anunciar" strong />
          </div>
          <p className="mb-3 text-xs text-white/55">Produto de exemplo: ainda não há vendedores aprovados neste marketplace.</p>
          {soon ? <PaySoon /> : <button type="button" className="btn w-full" onClick={() => setSoon(true)}>Continuar para pagamento</button>}
        </>}
      </Sheet>
      <Sheet open={sell} onClose={() => setSell(false)} title="Vender no Marketplace">
        <p className="text-sm text-white/75">Em breve vais poder vender guias, coaching, packs para lives e design para a comunidade de {g.name}. Cada vendedor é verificado antes de publicar.</p>
        <p className="mt-3 text-sm text-white/75">Enquanto isso, ativa a monetização da tua conta para estares pronto quando abrir.</p>
        <Link href="/monetizacao" className="btn mt-4 w-full">Ver monetização</Link>
      </Sheet>
    </>
  );
}
