'use client';

// Página de cada jogo na área TXAPZONE — cópia fiel do protótipo Claude (6 separadores).
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { Tournament } from '@/lib/data';
import { ageFrom } from '@/lib/age';
import {
  BET_EXAMPLE, GAMES_CFG, GameCfg, GameKey, HISTORY_EXAMPLE, MARKET_CATS, MarketCat, TBA, fmtMzPhone, fmtWhen, gameExampleFlyers, gameKeyOf, isGameKey, mtOrTba, normalizeMzPhone, validPlayerId,
} from '@/lib/jogos';
import { Carousel, ExampleTag, GameIcon, PaySoon, Slide, SummaryRow, TzSheet as Sheet, TzShell, TzSkeleton, tzScrollTop } from './Kit';
import { GameCover, TournamentCover } from '@/components/GameArt';
import { Icon, IconName } from '@/components/icons';

const MARKET_ICON: Record<MarketCat, IconName> = { Guias: 'book', Coaching: 'target', 'Packs para lives': 'video', Design: 'palette' };

const TABS = ['Início', 'Torneios', 'Histórico', 'Recargas', 'Apostas', 'Marketplace'] as const;
type Tab = (typeof TABS)[number];
const SLUG: Record<Tab, string> = { Início: 'inicio', Torneios: 'torneios', Histórico: 'historico', Recargas: 'recargas', Apostas: 'apostas', Marketplace: 'marketplace' };

export default function GamePage({ game }: { game: GameKey }) {
  const key: GameKey = isGameKey(game) ? game : 'outros';
  const g = GAMES_CFG[key];
  const { s, toast } = useStore();
  const [tab, setTabState] = useState<Tab>('Início');
  const [join, setJoin] = useState<Tournament | null>(null);

  // Separador por #hash (links diretos, ex.: /jogos/ff/#recargas)
  useEffect(() => {
    const h = window.location.hash.slice(1);
    const t = TABS.find((x) => SLUG[x] === h);
    if (t) setTabState(t);
  }, []);
  // Mantém o separador ativo visível na barra (só desliza na horizontal, nunca mexe na página)
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    const el = nav?.querySelector<HTMLElement>(`[data-tab="${SLUG[tab]}"]`);
    if (!nav || !el) return;
    const l = el.offsetParent === nav ? el.offsetLeft : el.offsetLeft - nav.offsetLeft, r = l + el.offsetWidth;
    if (l < nav.scrollLeft) nav.scrollLeft = l - 8;
    else if (r > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = r - nav.clientWidth + 8;
  }, [tab]);
  const setTab = (t: Tab) => {
    setTabState(t);
    try { history.replaceState(null, '', '#' + SLUG[t]); } catch {}
    tzScrollTop();
  };

  const tours = useMemo(() => s.admin.tournaments.filter((t) => gameKeyOf(t.game) === key).sort((a, b) => a.date.localeCompare(b.date)), [s.admin.tournaments, key]);
  const openCount = tours.filter((t) => t.status === 'aberto').length;
  const wa = (s.admin.settings.gameLinks ?? {})[key];
  const waOk = !!wa && /^https:\/\/chat\.whatsapp\.com\//.test(wa);
  const exampleJoin = () => toast('Torneio de exemplo: as inscrições abrem quando a equipa o publicar.');

  return (
    <TzShell>
      <main className="tz-wrap pb-16 pt-4">
        <Link href="/" className="tz-muted inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium hover:text-white">
          <span className="text-lg leading-none" aria-hidden>‹</span> Voltar às categorias
        </Link>
        <section className="relative mt-2 overflow-hidden rounded-2xl border border-[#FFFFFF1F] bg-[#16181F]" aria-label={g.name}>
          <div className="relative aspect-[16/9] w-full sm:aspect-[16/6] lg:aspect-[16/5]">
            <GameCover game={key} priority sizes="(min-width: 1120px) 1088px, 100vw" shade={false} alt="" />
            <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0E0F13] via-[#0E0F13]/55 to-transparent" aria-hidden />
          </div>
          <div className="relative -mt-14 flex flex-wrap items-end gap-3 px-4 pb-4 sm:-mt-16 sm:px-6 sm:pb-5">
            <span className="rounded-2xl ring-4 ring-[#0E0F13]"><GameIcon g={g} size={64} /></span>
            <div className="min-w-[150px] flex-1">
              <h1 className="truncate text-[24px] font-extrabold leading-tight tracking-tight sm:text-[30px]">{g.name}</h1>
              <p className="tz-muted truncate text-[13px]">Servidor {g.name} · {openCount === 0 ? 'sem torneios abertos' : openCount === 1 ? '1 torneio aberto' : `${openCount} torneios abertos`}</p>
            </div>
            {waOk ? (
              <a href={wa} target="_blank" rel="noopener noreferrer" className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full bg-[#25D366] px-4 text-[13px] font-semibold text-[#052E16] transition-[filter] hover:brightness-110">
                <WaIcon /> Grupo do WhatsApp
              </a>
            ) : (
              <button type="button" onClick={() => toast('O link do Grupo do WhatsApp será anunciado em breve.')} className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full bg-[#25D366] px-4 text-[13px] font-semibold text-[#052E16] transition-[filter] hover:brightness-110">
                <WaIcon /> Grupo do WhatsApp
              </button>
            )}
          </div>
        </section>

        <nav ref={navRef} className="tz-noscroll sticky top-[60px] z-20 -mx-4 mt-4 flex overflow-x-auto border-b border-[#FFFFFF1F] bg-[#0E0F13]/95 px-2 backdrop-blur md:mx-0 md:px-0" role="tablist" aria-label={`Secções de ${g.name}`}>
          {TABS.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} data-tab={SLUG[t]}
              className={`relative min-h-[48px] shrink-0 px-3.5 text-sm font-medium transition-colors ${tab === t ? 'text-white' : 'text-[#FFFFFFB8] hover:text-white'}`}>
              {t}
              {tab === t && <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-[#FFC107]" />}
            </button>
          ))}
        </nav>

        <div className="pt-5" role="tabpanel" aria-label={tab}>
          {tab === 'Início' && <Inicio g={g} tours={tours} onJoin={setJoin} onExample={exampleJoin} setTab={setTab} />}
          {tab === 'Torneios' && <Torneios g={g} tours={tours} onJoin={setJoin} onExample={exampleJoin} />}
          {tab === 'Histórico' && <Historico g={g} tours={tours} />}
          {tab === 'Recargas' && <Recargas g={g} />}
          {tab === 'Apostas' && <Apostas g={g} />}
          {tab === 'Marketplace' && <Marketplace g={g} />}
        </div>
      </main>
      <InscreverSheet t={join} onClose={() => setJoin(null)} />
    </TzShell>
  );
}

function WaIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8 0-1.4.7-2 1-2.3.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.6-.1 1.1Z"/></svg>
  );
}

/* ---------------- Início ---------------- */
function Inicio({ g, tours, onJoin, onExample, setTab }: { g: GameCfg; tours: Tournament[]; onJoin: (t: Tournament) => void; onExample: () => void; setTab: (t: Tab) => void }) {
  const open = tours.filter((t) => t.status === 'aberto').slice(0, 3);
  const tag = { tag: 'TORNEIO', tagBg: '#FFC107', tagFg: '#0E0F13' };
  const slides: Slide[] = open.length
    ? open.map((t) => ({ key: t.id, ...tag, title: t.name, sub: `${t.mode} · ${fmtWhen(t.date)} · Prémio ${mtOrTba(t.prize)}`, cta: 'Inscrever', onCta: () => onJoin(t), game: g.key, cover: t.cover, gameName: t.game }))
    : gameExampleFlyers(g.key).map((f, k) => ({ key: 'ex' + k, ...tag, title: f.title, sub: f.sub, cta: 'Inscrever', onCta: onExample, example: true, game: g.key }));
  const quick: [string, string, Tab][] = [
    [`Recarregar ${g.currency}`, 'M-Pesa ou e-Mola, directo na conta', 'Recargas'],
    ['Torneios', 'Inscrições abertas e a decorrer', 'Torneios'],
    ['Marketplace', 'Guias, coaching, packs para lives', 'Marketplace'],
    ['O meu histórico', 'Torneios, posições e ganhos', 'Histórico'],
  ];
  return (
    <>
      <Carousel slides={slides} label={`Torneios de ${g.name}`} />
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {quick.map(([t, d, to]) => (
          <button key={t} type="button" onClick={() => setTab(to)} className="tz-card flex min-h-[92px] flex-col items-start gap-1 p-4 text-left transition-colors hover:border-[#FFFFFF33]">
            <span className="text-[15px] font-semibold leading-tight">{t}</span>
            <span className="tz-muted text-[12.5px] leading-snug">{d}</span>
          </button>
        ))}
      </div>
    </>
  );
}

/* ---------------- Torneios ---------------- */
const STATUS: [Tournament['status'], string][] = [['aberto', 'Inscrições abertas'], ['a decorrer', 'A decorrer'], ['terminado', 'Terminados']];

function Torneios({ g, tours, onJoin, onExample }: { g: GameCfg; tours: Tournament[]; onJoin: (t: Tournament) => void; onExample: () => void }) {
  const { s, ready } = useStore();
  const [st, setSt] = useState<Tournament['status']>('aberto');
  const list = tours.filter((t) => t.status === st);
  const examples = st === 'aberto' && ready && list.length === 0 ? gameExampleFlyers(g.key) : [];
  return (
    <>
      <div className="tz-noscroll -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
        {STATUS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setSt(k)} aria-pressed={st === k} className="tz-chip">{l}</button>
        ))}
      </div>
      {!ready ? <div className="space-y-3" role="status" aria-busy="true" aria-label="A carregar torneios">{[0, 1].map((k) => <TzSkeleton key={k} className="h-[84px]" />)}</div>
        : examples.length ? (
          <div className="space-y-3">
            <ExampleTag />
            {examples.map((f) => (
              <div key={f.title} className="tz-card flex items-center gap-3 p-3.5 sm:p-4">
                <span className="relative hidden h-14 w-24 shrink-0 overflow-hidden rounded-lg min-[400px]:block"><GameCover game={g.key} sizes="96px" shade={false} /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold">{f.title}</p>
                  <p className="tz-muted text-[13px] leading-snug">{f.sub}</p>
                </div>
                <button type="button" className="tz-btn shrink-0" onClick={onExample}>Inscrever</button>
              </div>
            ))}
          </div>
        )
        : list.length === 0 ? <div className="tz-card flex flex-col items-center gap-2 p-6 text-center">
            <GameIcon g={g} size={44} />
            <p className="text-[15px] font-semibold">{st === 'a decorrer' ? 'Nenhum torneio a decorrer' : 'Ainda não há torneios terminados'}</p>
            <p className="tz-muted max-w-sm text-sm">{st === 'a decorrer' ? 'Quando um torneio começar, acompanhas aqui os jogos e resultados.' : 'Os resultados validados pelo organizador aparecem aqui.'}</p>
            <button type="button" className="tz-btn-outline mt-1" onClick={() => setSt('aberto')}>Ver inscrições abertas</button>
          </div>
        : (
          <div className="space-y-3">
            {list.map((t) => {
              const joined = s.entries.includes(t.id);
              const full = t.filled >= t.slots;
              return (
                <div key={t.id} className="tz-card flex items-center gap-3 p-3.5 sm:p-4">
                  <span className="relative hidden h-14 w-24 shrink-0 overflow-hidden rounded-lg min-[400px]:block"><TournamentCover t={t} sizes="96px" shade={false} /></span>
                  <Link href={`/torneios/${t.id}/`} className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold">{t.name}</p>
                    <p className="tz-muted truncate text-[13px]">{t.mode} · {fmtWhen(t.date)} · Prémio <span className="font-semibold text-[#FFC107]">{mtOrTba(t.prize)}</span></p>
                    <p className="tz-dim mt-0.5 text-xs">Entrada {t.fee > 0 ? `${t.fee.toLocaleString('pt-PT')} MT` : 'Grátis'} · <span className="tabular-nums">{t.filled}/{t.slots}</span> vagas</p>
                  </Link>
                  {t.status === 'aberto' ? (
                    joined ? <span className="shrink-0 rounded-lg bg-[#22C55E]/15 px-2.5 py-1.5 text-xs font-semibold text-[#4ADE80]">✓ Inscrito</span>
                      : full ? <span className="tz-muted shrink-0 text-xs">Esgotado</span>
                      : <button type="button" className="tz-btn shrink-0" onClick={() => onJoin(t)}>Inscrever</button>
                  ) : <Link href={`/torneios/${t.id}/`} className="tz-btn-dark shrink-0">Ver</Link>}
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
    toast('Inscrição confirmada');
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title="Inscrição">
      <div className="tz-card mb-4 px-4 py-2">
        <SummaryRow k="Torneio" v={t.name} />
        <SummaryRow k="Jogo · modo" v={`${t.game} · ${t.mode}`} />
        <SummaryRow k="Data" v={fmtWhen(t.date)} />
        <SummaryRow k="Vagas" v={`${t.filled}/${t.slots}`} />
        <SummaryRow k="Prémio" v={mtOrTba(t.prize)} />
        <SummaryRow k="Entrada" v={paid ? `${t.fee.toLocaleString('pt-PT')} MT` : 'Grátis'} strong />
      </div>
      <label className="tz-muted text-xs" htmlFor="team">Nome da equipa / jogador</label>
      <input id="team" className="tz-input mb-4 mt-1" value={team} maxLength={40} onChange={(e) => setTeam(e.target.value)} placeholder="Ex.: Mambas FF" />
      {soon ? <PaySoon /> : (
        <button type="button" className="tz-btn w-full !min-h-[46px]" disabled={team.trim().length < 2} onClick={() => (paid ? setSoon(true) : register())}>
          {paid ? `Pagar inscrição · ${t.fee.toLocaleString('pt-PT')} MT` : 'Confirmar inscrição grátis'}
        </button>
      )}
      <Link href={`/torneios/${t.id}/`} className="tz-link mt-3 block text-center text-sm hover:underline">Regras e detalhes do torneio</Link>
    </Sheet>
  );
}

/* ---------------- Histórico ---------------- */
function Historico({ g, tours }: { g: GameCfg; tours: Tournament[] }) {
  const { s, ready } = useStore();
  const mine = tours.filter((t) => s.entries.includes(t.id)).sort((a, b) => b.date.localeCompare(a.date));
  const played = mine.filter((t) => t.status !== 'aberto').length;
  const example = ready && mine.length === 0;
  const cards: [string, string][] = [['Torneios jogados', example ? TBA : String(played)], ['Melhor posição', TBA], [g.statTotal, TBA], ['Ganhos', TBA]];
  const rows = example
    ? HISTORY_EXAMPLE.map((r) => ({ id: r.name, name: r.name, date: r.date, pos: TBA, href: '' }))
    : mine.map((t) => ({ id: t.id, name: t.name, date: fmtWhen(t.date), pos: t.status === 'aberto' ? 'Por jogar' : TBA, href: `/torneios/${t.id}/` }));
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="tz-h2">O meu histórico em {g.name}</h2>
        {example && <ExampleTag />}
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map(([l, v]) => (
          <div key={l} className="tz-card p-4">
            <p className="tz-muted text-[12.5px]">{l}</p>
            <p className={`mt-1 font-bold tabular-nums ${v === TBA ? 'text-base text-[#ECEEF3]' : 'text-2xl'}`}>{ready ? v : '…'}</p>
          </div>
        ))}
      </div>
      {!ready ? <TzSkeleton className="h-40" /> : (
        <div className="tz-card -mx-1 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead><tr className="border-b border-[#FFFFFF1F] text-[11px] uppercase tracking-wider text-[#FFFFFFB8]">
              <th className="px-4 py-3 font-semibold">Torneio</th><th className="px-3 py-3 font-semibold">Data</th><th className="px-3 py-3 font-semibold">Posição</th><th className="px-3 py-3 font-semibold">{g.statCol}</th><th className="px-4 py-3 font-semibold">Ganho</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-[#1D1F28] last:border-0">
                  <td className="px-4 py-3 font-medium">{r.href ? <Link href={r.href} className="hover:underline">{r.name}</Link> : r.name}</td>
                  <td className="tz-muted px-3 py-3">{r.date}</td>
                  <td className="px-3 py-3 text-[#ECEEF3]">{r.pos}</td>
                  <td className="px-3 py-3 text-[#ECEEF3]">{TBA}</td>
                  <td className="px-4 py-3 text-[#ECEEF3]">{TBA}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="tz-dim mt-3 text-xs">Posição, {g.statCol.toLowerCase()} e ganhos aparecem quando o organizador validar os resultados. Nada é estimado.</p>
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
      <h2 className="tz-h2 mb-4">Recarregar {g.currency}</h2>
      <div className="grid items-start gap-5 md:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          <div>
            <label htmlFor="pid" className="text-sm font-semibold">1. {g.idLabel}</label>
            <input id="pid" className={`tz-input mt-2 ${touched && !idOk ? '!border-red-500' : ''}`} value={id} onChange={(e) => setId(e.target.value)} placeholder={g.idPlaceholder}
              inputMode={g.key === 'ff' ? 'numeric' : 'text'} autoComplete="off" />
            <p className={`mt-1.5 text-xs ${touched && !idOk ? 'text-red-400' : 'tz-muted'}`}>{touched && !idOk ? (g.key === 'ff' ? 'O ID Free Fire tem só números (6 a 12).' : g.key === 'cr' ? 'Tag inválida. Ex.: #2PYQ8L0' : 'Indica a conta do jogo.') : g.idHelp}</p>
          </div>
          <div>
            <p className="text-sm font-semibold">2. Escolhe o pacote</p>
            <div className="mt-2 grid grid-cols-3 gap-2.5 sm:grid-cols-5">
              {g.packs.map((p) => (
                <button key={p} type="button" onClick={() => setPack(p)} aria-pressed={pack === p}
                  className={`flex min-h-[84px] flex-col items-center justify-center rounded-xl border-2 bg-[#16181F] p-2 transition-colors ${pack === p ? 'border-[#FFC107]' : 'border-[#FFFFFF1F] hover:border-[#FFFFFF33]'}`}>
                  <span className="text-lg font-bold tabular-nums">{p.toLocaleString('pt-PT')}</span>
                  <span className="tz-muted text-[11px]">{g.currencyOne}</span>
                  <span className="mt-1 text-[12px] font-semibold text-[#FFC107]">{TBA}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold">3. Pagamento</p>
            <div className="mt-2 grid grid-cols-2 gap-1 rounded-xl border border-[#FFFFFF1F] bg-[#16181F] p-1" role="radiogroup" aria-label="Método de pagamento">
              {(['M-Pesa', 'e-Mola'] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)} className={`min-h-[40px] rounded-lg text-sm font-semibold transition-colors ${method === m ? 'bg-[#FFC107] text-[#0E0F13]' : 'text-[#FFFFFFB8] hover:text-white'}`}>{m}</button>
              ))}
            </div>
            <label htmlFor="tel" className="mt-4 block text-sm font-semibold">Número {method}</label>
            <input id="tel" type="tel" inputMode="tel" autoComplete="tel" className={`tz-input mt-2 ${touched && !tel ? '!border-red-500' : ''}`} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="84 / 85 / 86 / 87 ..." />
            {touched && !tel && <p className="mt-1.5 text-xs text-red-400">Número moçambicano inválido: começa por 84, 85, 86 ou 87 e tem 9 dígitos.</p>}
          </div>
        </div>
        <aside className="tz-card p-5 md:sticky md:top-[124px]">
          <p className="mb-2 text-base font-bold">Resumo</p>
          <SummaryRow k="Pacote" v={`${pack.toLocaleString('pt-PT')} ${g.currencyOne}`} />
          <SummaryRow k="Pagamento" v={method} />
          <SummaryRow k="Entrega" v={TBA} />
          <SummaryRow k="Total" v={TBA} strong />
          <button type="button" className="tz-btn mt-4 w-full !min-h-[46px]" onClick={pay}>Pagar com {method}</button>
          <p className="tz-dim mt-3 text-center text-[11.5px]">Revenda via parceiro oficial · {TBA}</p>
        </aside>
      </div>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Confirmar recarga">
        <div className="tz-card mb-4 px-4 py-2">
          <SummaryRow k="Jogo" v={g.name} />
          <SummaryRow k="Conta" v={id.trim()} />
          <SummaryRow k="Pacote" v={`${pack.toLocaleString('pt-PT')} ${g.currencyOne}`} />
          <SummaryRow k="Pagamento" v={`${method} · ${tel ? fmtMzPhone(tel) : ''}`} />
          <SummaryRow k="Entrega" v={TBA} />
          <SummaryRow k="Total" v={TBA} strong />
        </div>
        {soon ? <PaySoon /> : <button type="button" className="tz-btn w-full !min-h-[46px]" onClick={() => setSoon(true)}>Confirmar e pagar com {method}</button>}
      </Sheet>
    </>
  );
}

/* ---------------- Apostas (desativadas: só leitura até licença do IGJ) ---------------- */
function Apostas({ g }: { g: GameCfg }) {
  const { s } = useStore();
  const [gate, setGate] = useState(true);
  const age = s.account.birth ? ageFrom(s.account.birth) : 0;
  const minor = !!s.account.birth && age > 0 && age < 18;
  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <h2 className="tz-h2">Apostas em {g.name}</h2>
        <span className="rounded-md bg-[#7F1D1D] px-2 py-0.5 text-xs font-bold text-white">18+</span>
      </div>
      {gate ? (
        <div className="tz-card max-w-xl p-5">
          <p className="text-lg font-bold">Só para maiores de 18 anos</p>
          <p className="tz-muted mt-1.5 text-sm">Para apostar tens de verificar a idade com o BI. Contas não verificadas não vêem as odds.</p>
          <p className="tz-dim mt-3 text-xs">Operação licenciada: licença IGJ ainda não emitida</p>
          {minor ? (
            <p className="mt-4 rounded-xl border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-200">A tua conta indica menos de 18 anos. Esta secção não está disponível para ti.</p>
          ) : (
            <button type="button" className="tz-btn mt-4" onClick={() => setGate(false)}>Verificar idade</button>
          )}
        </div>
      ) : (
        <>
          <div role="status" className="mb-4 rounded-xl border border-[#991B1B] bg-[#7F1D1D]/35 p-3 text-sm font-semibold text-red-100">Apostas indisponíveis até licença do IGJ</div>
          <div className="grid items-start gap-5 md:grid-cols-[1fr_300px]">
            <div className="space-y-3">
              <ExampleTag />
              {BET_EXAMPLE.map((m) => (
                <div key={m.a} className="tz-card p-4">
                  <p className="text-[15px] font-semibold">{m.a} vs {m.b}</p>
                  <p className="tz-muted text-[13px]">{m.when}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {['Vitória lado A', 'Vitória lado B'].map((l) => (
                      <button key={l} type="button" disabled className="flex min-h-[48px] flex-col items-start justify-center gap-0.5 rounded-lg border border-[#FFFFFF1F] bg-[#1D1F28] px-3 py-1.5 text-left text-[13px] text-[#ECEEF3] disabled:cursor-not-allowed sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                        <span>{l}</span><b className="whitespace-nowrap text-[#FFC107]">{TBA}</b>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <aside className="tz-card p-5 md:sticky md:top-[124px]">
              <p className="mb-1 text-base font-bold">Boletim</p>
              <p className="tz-muted text-sm">Escolhe um resultado para começar.</p>
              <label htmlFor="stake" className="mt-4 block text-xs font-medium text-[#ECEEF3]">Valor a apostar (MT)</label>
              <input id="stake" type="number" disabled placeholder="0" className="tz-input mt-1.5 disabled:opacity-50" />
              <p className="tz-muted mt-3 text-sm">Retorno possível: {TBA}</p>
              <button type="button" disabled className="tz-btn mt-4 w-full !min-h-[46px]">Confirmar aposta</button>
              <p className="tz-dim mt-3 text-center text-[11.5px]">Limite diário: {TBA} · Jogo responsável</p>
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
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="tz-h2 min-w-0 leading-tight">Marketplace {g.name}</h2>
        <button type="button" onClick={() => setSell(true)} className="tz-btn-outline shrink-0">Vender um produto</button>
      </div>
      <div className="tz-noscroll -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
        {MARKET_CATS.map((c) => (
          <button key={c} type="button" onClick={() => setCat(c)} aria-pressed={cat === c} className="tz-chip">{c}</button>
        ))}
      </div>
      <ExampleTag className="mb-3" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {list.map((p) => (
          <div key={p.title} className="tz-card flex flex-col p-2.5">
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg" aria-hidden>
              <GameCover game={g.key} sizes="(min-width: 1024px) 200px, 45vw" alt="" />
              <span className="absolute bottom-2 left-2 flex h-9 w-9 items-center justify-center rounded-lg bg-[#0E0F13]/80 text-[#FFC107] backdrop-blur"><Icon name={MARKET_ICON[p.cat]} size={20} /></span>
            </div>
            <div className="flex flex-1 flex-col px-0.5 pt-2.5">
              <span className="w-fit rounded-md bg-[#FFC107] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#0E0F13]">{p.cat}</span>
              <p className="mt-1.5 text-[13.5px] font-semibold leading-snug">{p.title}</p>
              <p className="tz-dim mt-0.5 text-[12px]">por vendedor a anunciar</p>
              <p className="mt-auto pt-2 text-sm font-bold text-[#FFC107]">{TBA}</p>
              <button type="button" onClick={() => { setSoon(false); setBuy(p); }} className="tz-btn-dark mt-2 w-full">Comprar</button>
            </div>
          </div>
        ))}
      </div>
      <Sheet open={!!buy} onClose={() => setBuy(null)} title="Resumo da compra">
        {buy && <>
          <div className="tz-card mb-3 px-4 py-2">
            <SummaryRow k="Produto" v={buy.title} />
            <SummaryRow k="Categoria" v={buy.cat} />
            <SummaryRow k="Vendedor" v={TBA} />
            <SummaryRow k="Total" v={TBA} strong />
          </div>
          <p className="tz-muted mb-4 text-xs">Produto de exemplo: ainda não há vendedores aprovados neste marketplace.</p>
          {soon ? <PaySoon /> : <button type="button" className="tz-btn w-full !min-h-[46px]" onClick={() => setSoon(true)}>Continuar para pagamento</button>}
        </>}
      </Sheet>
      <Sheet open={sell} onClose={() => setSell(false)} title="Vender no Marketplace">
        <p className="tz-muted text-sm">Em breve vais poder vender guias, coaching, packs para lives e design para a comunidade de {g.name}. Cada vendedor é verificado antes de publicar.</p>
        <p className="tz-muted mt-3 text-sm">Avisamos nas notificações quando as candidaturas de vendedores abrirem.</p>
      </Sheet>
    </>
  );
}
