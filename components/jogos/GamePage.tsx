'use client';

// Página de cada jogo na área TXAPZONE — cópia fiel do protótipo Claude (6 separadores).
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { Tournament } from '@/lib/data';
import {
  GAMES_CFG, GameCfg, GameKey, HISTORY_EXAMPLE, MARKET_CATS, MarketCat, TBA, fmtMzPhone, fmtWhen, gameExampleFlyers, gameKeyOf, isGameKey, mtOrTba, normalizeMzPhone, validPlayerId,
} from '@/lib/jogos';
import { GameArt } from '@/components/GameArt';
import { Photo } from '@/components/Photo';
import { RegistrationSheet } from '@/components/RegistrationSheet';
import { ListingCard, listingHref, useMarketCfg } from '@/components/market/Kit';
import { Listing, marketApi } from '@/lib/marketApi';
import { artAt } from '@/lib/gameArt';
import { Carousel, ExampleTag, GameIcon, PaySoon, Slide, SummaryRow, TzSheet as Sheet, TzShell, tzScrollTop } from './Kit';

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
  const setTab = (t: Tab) => {
    setTabState(t);
    try { history.replaceState(null, '', '#' + SLUG[t]); } catch {}
    tzScrollTop();
  };

  const tours = useMemo(() => s.admin.tournaments.filter((t) => gameKeyOf(t.game) === key).sort((a, b) => a.date.localeCompare(b.date)), [s.admin.tournaments, key]);
  const wa = (s.admin.settings.gameLinks ?? {})[key];
  const waOk = !!wa && /^https:\/\/chat\.whatsapp\.com\//.test(wa);
  const exampleJoin = () => toast('Torneio de exemplo: as inscrições abrem quando a equipa o publicar.');

  return (
    <TzShell>
      <main className="tz-wrap pb-16 pt-4">
        <Link href="/jogos" className="tz-muted inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium hover:text-white">
          <span className="text-lg leading-none" aria-hidden>‹</span> Voltar às categorias
        </Link>
        <div className="relative mt-2 overflow-hidden rounded-2xl border border-[#2A2A2F]">
          <div className="relative h-[132px] sm:h-[180px]"><GameArt id={artAt(g.key, 0)} shade="full" priority sizes="(min-width: 1120px) 1120px, 100vw" /></div>
          <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end gap-3 p-4">
          <GameIcon g={g} size={48} />
          <div className="min-w-[150px] flex-1">
            <h1 className="truncate text-[24px] font-extrabold leading-tight tracking-tight [text-shadow:0_2px_10px_rgba(0,0,0,.6)] sm:text-[30px]">{g.name}</h1>
            <p className="truncate text-[13px] text-[#D4D4D8]">Servidor {g.name}</p>
          </div>
          {waOk ? (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full bg-[#25D366] px-4 text-[13px] font-semibold text-[#052E16]">
              <WaIcon /> Grupo do WhatsApp
            </a>
          ) : (
            <button type="button" onClick={() => toast('O link do Grupo do WhatsApp será anunciado em breve.')} className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full bg-[#25D366] px-4 text-[13px] font-semibold text-[#052E16]">
              <WaIcon /> Grupo do WhatsApp
            </button>
          )}
          </div>
        </div>

        <nav className="tz-noscroll sticky top-[60px] z-20 -mx-4 mt-4 flex overflow-x-auto border-b border-[#2A2A2F] bg-[#0E0E10] px-2 md:mx-0 md:px-0" role="tablist" aria-label={`Secções de ${g.name}`}>
          {TABS.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`relative min-h-[46px] shrink-0 px-3.5 text-sm font-medium transition-colors ${tab === t ? 'text-white' : 'text-[#A1A1AA] hover:text-white'}`}>
              {t}
              {tab === t && <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-[#FF6B1A]" />}
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
      <RegistrationSheet t={join} onClose={() => setJoin(null)} />
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
  const tag = { tag: 'TORNEIO', tagBg: '#FF6B1A', tagFg: '#FFFFFF' };
  const slides: Slide[] = open.length
    ? open.map((t, k) => ({ key: t.id, ...tag, title: t.name, sub: `${t.mode} · ${fmtWhen(t.date)} · Prémio ${mtOrTba(t.prize)}`, cta: 'Inscrever', onCta: () => onJoin(t), art: artAt(g.key, k), photo: t.cover }))
    : gameExampleFlyers(g.key).map((f, k) => ({ key: 'ex' + k, ...tag, title: f.title, sub: f.sub, cta: 'Inscrever', onCta: onExample, example: true, art: artAt(g.key, k) }));
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
          <button key={t} type="button" onClick={() => setTab(to)} className="tz-card tz-tile flex min-h-[92px] flex-col items-start gap-1 p-4 text-left">
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
      {!ready ? <div className="space-y-3">{[0, 1].map((k) => <span key={k} className="tz-skel block h-[88px] rounded-xl" />)}</div>
        : examples.length ? (
          <div className="space-y-3">
            <ExampleTag />
            {examples.map((f, k) => (
              <div key={f.title} className="tz-card flex items-center gap-3 p-3">
                <span className="tz-cover relative block h-16 w-16 shrink-0 sm:h-20 sm:w-28"><GameArt id={artAt(g.key, k)} shade="none" sizes="112px" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold">{f.title}</p>
                  <p className="tz-muted text-[13px] leading-snug">{f.sub}</p>
                </div>
                <button type="button" className="tz-btn shrink-0" onClick={onExample}>Inscrever</button>
              </div>
            ))}
          </div>
        )
        : list.length === 0 ? <p className="tz-card tz-muted p-5 text-center text-sm">{st === 'a decorrer' ? 'Nenhum torneio a decorrer.' : 'Ainda não há torneios terminados.'}</p>
        : (
          <div className="space-y-3">
            {list.map((t, k) => {
              const joined = s.entries.includes(t.id);
              const full = t.filled >= t.slots;
              return (
                <div key={t.id} className="tz-card flex items-center gap-3 p-3">
                  <span className="tz-cover relative block h-16 w-16 shrink-0 sm:h-20 sm:w-28"><Photo src={t.cover} fallback={artAt(g.key, k)} alt={t.name} sizes="112px" /></span>
                  <Link href={`/torneio/?id=${t.id}`} className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold">{t.name}</p>
                    <p className="tz-muted truncate text-[13px]">{t.mode} · {fmtWhen(t.date)} · Prémio <span className="font-semibold text-[#FF6B1A]">{mtOrTba(t.prize)}</span></p>
                    <p className="tz-dim mt-0.5 text-xs">Entrada {t.fee > 0 ? `${t.fee.toLocaleString('pt-PT')} MT` : 'Grátis'} · <span className="tabular-nums">{t.filled}/{t.slots}</span> vagas</p>
                  </Link>
                  {t.status === 'aberto' ? (
                    joined ? <span className="shrink-0 rounded-lg bg-[#22C55E]/15 px-2.5 py-1.5 text-xs font-semibold text-[#4ADE80]">✓ Inscrito</span>
                      : full ? <span className="tz-muted shrink-0 text-xs">Esgotado</span>
                      : <button type="button" className="tz-btn shrink-0" onClick={() => onJoin(t)}>Inscrever</button>
                  ) : <Link href={`/torneio/?id=${t.id}`} className="tz-btn-dark shrink-0">Ver</Link>}
                </div>
              );
            })}
          </div>
        )}
    </>
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
    : mine.map((t) => ({ id: t.id, name: t.name, date: fmtWhen(t.date), pos: t.status === 'aberto' ? 'Por jogar' : TBA, href: `/torneio/?id=${t.id}` }));
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
            <p className={`mt-1 font-bold tabular-nums ${v === TBA ? 'text-base text-[#D4D4D8]' : 'text-2xl'}`}>{ready ? v : '…'}</p>
          </div>
        ))}
      </div>
      {!ready ? <span className="tz-card block h-40 animate-pulse" /> : (
        <div className="tz-card -mx-1 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead><tr className="border-b border-[#2A2A2F] text-[11px] uppercase tracking-wider text-[#A1A1AA]">
              <th className="px-4 py-3 font-semibold">Torneio</th><th className="px-3 py-3 font-semibold">Data</th><th className="px-3 py-3 font-semibold">Posição</th><th className="px-3 py-3 font-semibold">{g.statCol}</th><th className="px-4 py-3 font-semibold">Ganho</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-[#222226] last:border-0">
                  <td className="px-4 py-3 font-medium">{r.href ? <Link href={r.href} className="hover:underline">{r.name}</Link> : r.name}</td>
                  <td className="tz-muted px-3 py-3">{r.date}</td>
                  <td className="px-3 py-3 text-[#D4D4D8]">{r.pos}</td>
                  <td className="px-3 py-3 text-[#D4D4D8]">{TBA}</td>
                  <td className="px-4 py-3 text-[#D4D4D8]">{TBA}</td>
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
                  className={`flex min-h-[84px] flex-col items-center justify-center rounded-xl border-2 bg-[#18181B] p-2 transition-colors ${pack === p ? 'border-[#FF6B1A]' : 'border-[#2A2A2F] hover:border-[#3F3F46]'}`}>
                  <span className="text-lg font-bold tabular-nums">{p.toLocaleString('pt-PT')}</span>
                  <span className="tz-muted text-[11px]">{g.currencyOne}</span>
                  <span className="mt-1 text-[12px] font-semibold text-[#FF6B1A]">{TBA}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold">3. Pagamento</p>
            <div className="mt-2 grid grid-cols-2 gap-1 rounded-xl border border-[#2A2A2F] bg-[#18181B] p-1" role="radiogroup" aria-label="Método de pagamento">
              {(['M-Pesa', 'e-Mola'] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)} className={`min-h-[40px] rounded-lg text-sm font-semibold transition-colors ${method === m ? 'bg-[#FF6B1A] text-white' : 'text-[#A1A1AA] hover:text-white'}`}>{m}</button>
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

/* ---------------- Apostas (TXAP Pontos, sem dinheiro real) ---------------- */
const BetsArea = dynamic(() => import('@/components/bets/Bets'), { ssr: false, loading: () => <div className="space-y-3">{[0, 1].map((k) => <span key={k} className="tz-skel block h-[120px] rounded-xl" />)}</div> });
function Apostas({ g }: { g: GameCfg }) {
  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="tz-h2 min-w-0 flex-1 truncate">Apostas em {g.name}</h2>
        <Link href="/apostas" className="tz-btn-outline shrink-0">Todas as apostas</Link>
      </div>
      <BetsArea game={g.key} theme="tz" />
    </>
  );
}

/* ---------------- Marketplace ---------------- */
function Marketplace({ g }: { g: GameCfg }) {
  const { rates } = useMarketCfg();
  const [list, setList] = useState<Listing[] | null>(null);
  useEffect(() => { marketApi.listings({ category: g.key, limit: 20 }).then(setList).catch(() => setList([])); }, [g.key]);
  return (
    <div className="bx">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="tz-h2 min-w-0 truncate">Marketplace {g.name}</h2>
        <Link href="/marketplace/anunciar" className="tz-btn-outline shrink-0">Anunciar</Link>
      </div>
      {!list ? <div className="grid grid-cols-2 gap-3">{[0, 1].map((k) => <span key={k} className="tz-skel block aspect-[3/4] rounded-xl" />)}</div>
        : list.length === 0 ? <p className="tz-card tz-muted p-5 text-center text-sm">Ainda não há anúncios de {g.name}. <Link href="/marketplace/anunciar" className="tz-accent font-semibold">Anuncia o primeiro</Link>.</p>
        : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{list.map((l) => <ListingCard key={l.id} l={l} rates={rates} href={listingHref(l.id)} />)}</div>}
      <Link href={`/marketplace/?c=${g.key}`} className="tz-btn-dark mt-4 w-full">Ver tudo no Marketplace</Link>
    </div>
  );
}
