// TXAPILOG AI CORE · cálculos determinísticos (sem IA, sem rede, sem dados inventados).
// Ficheiro AUTOSSUFICIENTE: é copiado tal e qual para supabase/functions/_shared/core-stats.ts
// (a Edge Function core-ai usa os mesmos cálculos). O teste tests/core-stats.test.mjs garante que são iguais.
// Regra de ouro: sem linhas → null → a interface mostra "indisponível". Nunca se estima o que não existe.

export type Validation = 'submetido' | 'verificado' | 'rejeitado';
export type Source = 'torneio_txapilog' | 'submetido_jogador' | 'provedor_autorizado';
export type CoreRole = 'admin' | 'moderador' | 'organizador' | 'jogador';
export type Confidence = 'alta' | 'media' | 'baixa' | 'indisponivel';

export interface CorePlayer { id: string; user_id: string | null; nickname: string; country: string; status: 'ativo' | 'suspenso'; created_at: string }
export interface CoreExternalId { id: string; player_id: string; game: 'free_fire'; external_id: string; region: string; status: 'pendente' | 'verificado' | 'rejeitado'; source: Source; created_at: string }
export interface CoreVerification { player_id: string; method: string; verified_at: string }
export interface CoreTeam { id: string; name: string; tag: string | null; kind: 'duo' | 'squad'; captain_player_id: string | null; created_at: string }
export interface CoreTeamMember { team_id: string; player_id: string; role: 'capitao' | 'membro' | 'suplente'; joined_at: string; left_at: string | null }
export interface CoreTournament { id: string; name: string; mode: 'solo' | 'duo' | 'squad'; region: string; status: 'rascunho' | 'inscricoes' | 'a_decorrer' | 'terminado' | 'cancelado'; starts_at: string | null; ends_at: string | null; organizer_id: string | null; created_at: string }
export interface CoreTournamentTeam { tournament_id: string; team_id: string }
export interface CoreMatch { id: string; tournament_id: string | null; round_label: string | null; map: string | null; mode: 'solo' | 'duo' | 'squad'; played_at: string; source: Source; validation_status: Validation }
export interface CoreParticipation {
  id: string; match_id: string; player_id: string; team_id: string | null;
  kills: number; damage: number | null; assists: number | null; placement: number | null; survived_seconds: number | null;
  source: Source; validation_status: Validation; rejection_reason?: string | null; created_at: string;
}
export interface CoreResult { id: string; match_id: string; team_id: string; placement: number; kills_total: number; points: number | null; source: Source; validation_status: Validation; rejection_reason?: string | null; created_at: string }

export interface CoreData {
  players: CorePlayer[]; externalIds: CoreExternalId[]; verifications: CoreVerification[];
  teams: CoreTeam[]; members: CoreTeamMember[]; tournaments: CoreTournament[]; tournamentTeams: CoreTournamentTeam[];
  matches: CoreMatch[]; participations: CoreParticipation[]; results: CoreResult[];
}

// ---------- Validação de entradas ----------
/** ID de jogador Free Fire: só dígitos, 6 a 13. */
export function isValidFreeFireId(v: string): boolean { return /^[0-9]{6,13}$/.test(String(v ?? '').trim()); }
export function normalizeNickname(n: string): string {
  return String(n ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
    .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't');
}
export interface ParticipationInput { kills: number; damage?: number | null; assists?: number | null; placement?: number | null; survived_seconds?: number | null }
/** Mesmos limites que os CHECK da base de dados. Devolve lista de erros (vazia = válido). */
export function validateParticipation(p: ParticipationInput): string[] {
  const e: string[] = [];
  const int = (v: unknown) => typeof v === 'number' && Number.isInteger(v);
  if (!int(p.kills) || p.kills < 0 || p.kills > 60) e.push('Abates: inteiro entre 0 e 60.');
  if (p.damage != null && (!int(p.damage) || p.damage < 0 || p.damage > 30000)) e.push('Dano: inteiro entre 0 e 30000.');
  if (p.assists != null && (!int(p.assists) || p.assists < 0 || p.assists > 60)) e.push('Assistências: inteiro entre 0 e 60.');
  if (p.placement != null && (!int(p.placement) || p.placement < 1 || p.placement > 60)) e.push('Posição: inteiro entre 1 e 60.');
  if (p.survived_seconds != null && (!int(p.survived_seconds) || p.survived_seconds < 0 || p.survived_seconds > 3600)) e.push('Tempo vivo: 0 a 3600 s.');
  return e;
}

// ---------- Estatísticas ----------
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const usable = (p: { validation_status: Validation }) => p.validation_status !== 'rejeitado';

export interface PlayerStats {
  matches: number; verified: number; unverified: number; rejected: number;
  kills: number | null; avgKills: number | null; maxKills: number | null;
  avgDamage: number | null; damageSamples: number;
  wins: number | null; winRate: number | null; placementSamples: number;
  avgPlacement: number | null; kd: number | null; top10Rate: number | null;
  lastPlayedAt: string | null;
}

/**
 * Estatísticas de um jogador a partir das participações REAIS.
 * onlyVerified = true → só linhas verificadas. Rejeitadas nunca contam.
 */
export function playerStats(parts: CoreParticipation[], matches: CoreMatch[] = [], onlyVerified = false): PlayerStats {
  const rejected = parts.filter((p) => p.validation_status === 'rejeitado').length;
  const rows = parts.filter((p) => (onlyVerified ? p.validation_status === 'verificado' : usable(p)));
  const n = rows.length;
  const verified = rows.filter((p) => p.validation_status === 'verificado').length;
  const withPlacement = rows.filter((p) => p.placement != null);
  const withDamage = rows.filter((p) => p.damage != null);
  const wins = withPlacement.filter((p) => p.placement === 1).length;
  const notWon = withPlacement.length - wins;
  const kills = rows.reduce((a, p) => a + p.kills, 0);
  const mById = new Map(matches.map((m) => [m.id, m]));
  const dates = rows.map((p) => mById.get(p.match_id)?.played_at ?? p.created_at).sort();
  return {
    matches: n, verified, unverified: n - verified, rejected,
    kills: n ? kills : null,
    avgKills: n ? round(kills / n) : null,
    maxKills: n ? Math.max(...rows.map((p) => p.kills)) : null,
    avgDamage: withDamage.length ? Math.round(withDamage.reduce((a, p) => a + (p.damage ?? 0), 0) / withDamage.length) : null,
    damageSamples: withDamage.length,
    wins: withPlacement.length ? wins : null,
    winRate: withPlacement.length ? round(wins / withPlacement.length, 4) : null,
    placementSamples: withPlacement.length,
    avgPlacement: withPlacement.length ? round(withPlacement.reduce((a, p) => a + (p.placement ?? 0), 0) / withPlacement.length) : null,
    // K/D Free Fire: abates ÷ partidas não ganhas (só com posições conhecidas)
    kd: notWon > 0 ? round(withPlacement.reduce((a, p) => a + p.kills, 0) / notWon) : null,
    top10Rate: withPlacement.length ? round(withPlacement.filter((p) => (p.placement ?? 99) <= 10).length / withPlacement.length, 4) : null,
    lastPlayedAt: dates.length ? dates[dates.length - 1] : null,
  };
}

export interface ConfidenceInfo { level: Confidence; reasons: string[] }
/** Nível de confiança: tamanho da amostra + proporção verificada + completude dos campos. */
export function confidenceFor(s: Pick<PlayerStats, 'matches' | 'verified' | 'placementSamples'>): ConfidenceInfo {
  if (!s.matches) return { level: 'indisponivel', reasons: ['Sem partidas registadas na TXAPILOG.'] };
  const share = s.verified / s.matches;
  const reasons = [`${s.matches} partida(s), ${s.verified} verificada(s) (${Math.round(share * 100)}%).`];
  if (s.placementSamples < s.matches) reasons.push(`Posição conhecida em ${s.placementSamples} de ${s.matches}.`);
  if (s.verified >= 20 && share >= 0.8) return { level: 'alta', reasons };
  if (s.verified >= 5 && share >= 0.5) return { level: 'media', reasons };
  reasons.push(s.verified < 5 ? 'Amostra verificada pequena (< 5).' : 'Muitas linhas ainda não verificadas.');
  return { level: 'baixa', reasons };
}

export interface Trend { direction: 'subida' | 'descida' | 'estavel' | 'indisponivel'; recentAvgKills: number | null; previousAvgKills: number | null; deltaKills: number | null; recentWinRate: number | null; previousWinRate: number | null; window: number; evidence: string[] }
/** Compara as últimas N partidas com as N anteriores. Precisa de 2N partidas utilizáveis. */
export function trendFor(parts: CoreParticipation[], matches: CoreMatch[], window = 5): Trend {
  const mById = new Map(matches.map((m) => [m.id, m]));
  const rows = parts.filter(usable).slice().sort((a, b) => (mById.get(b.match_id)?.played_at ?? b.created_at).localeCompare(mById.get(a.match_id)?.played_at ?? a.created_at));
  const none: Trend = { direction: 'indisponivel', recentAvgKills: null, previousAvgKills: null, deltaKills: null, recentWinRate: null, previousWinRate: null, window, evidence: [] };
  if (rows.length < window * 2) return none;
  const recent = rows.slice(0, window), prev = rows.slice(window, window * 2);
  const avg = (r: CoreParticipation[]) => round(r.reduce((a, p) => a + p.kills, 0) / r.length);
  const wr = (r: CoreParticipation[]) => { const w = r.filter((p) => p.placement != null); return w.length ? round(w.filter((p) => p.placement === 1).length / w.length, 4) : null; };
  const ra = avg(recent), pa = avg(prev), d = round(ra - pa);
  const rel = pa === 0 ? (ra > 0 ? 1 : 0) : d / pa;
  return {
    direction: Math.abs(rel) < 0.15 ? 'estavel' : rel > 0 ? 'subida' : 'descida',
    recentAvgKills: ra, previousAvgKills: pa, deltaKills: d, recentWinRate: wr(recent), previousWinRate: wr(prev), window,
    evidence: [...recent, ...prev].map((p) => p.id),
  };
}

export interface CompareRow { metric: string; a: number | null; b: number | null; better: 'a' | 'b' | 'empate' | 'indisponivel' }
export function comparePlayers(a: PlayerStats, b: PlayerStats): CompareRow[] {
  const rows: [string, number | null, number | null, 'max' | 'min'][] = [
    ['Partidas', a.matches, b.matches, 'max'],
    ['Média de abates', a.avgKills, b.avgKills, 'max'],
    ['K/D', a.kd, b.kd, 'max'],
    ['Taxa de vitória', a.winRate, b.winRate, 'max'],
    ['Top 10', a.top10Rate, b.top10Rate, 'max'],
    ['Posição média', a.avgPlacement, b.avgPlacement, 'min'],
    ['Dano médio', a.avgDamage, b.avgDamage, 'max'],
  ];
  return rows.map(([metric, x, y, dir]) => ({
    metric, a: x, b: y,
    better: x == null || y == null ? 'indisponivel' : x === y ? 'empate' : (dir === 'max' ? x > y : x < y) ? 'a' : 'b',
  }));
}

export interface TeamStats { matches: number; verified: number; wins: number | null; avgPlacement: number | null; kills: number | null; points: number | null; activeMembers: number }
export function teamStats(teamId: string, results: CoreResult[], members: CoreTeamMember[]): TeamStats {
  const rows = results.filter((r) => r.team_id === teamId && usable(r));
  const n = rows.length;
  const pts = rows.filter((r) => r.points != null);
  return {
    matches: n, verified: rows.filter((r) => r.validation_status === 'verificado').length,
    wins: n ? rows.filter((r) => r.placement === 1).length : null,
    avgPlacement: n ? round(rows.reduce((a, r) => a + r.placement, 0) / n) : null,
    kills: n ? rows.reduce((a, r) => a + r.kills_total, 0) : null,
    points: pts.length ? pts.reduce((a, r) => a + (r.points ?? 0), 0) : null,
    activeMembers: members.filter((m) => m.team_id === teamId && !m.left_at).length,
  };
}

export type RankMetric = 'avgKills' | 'kd' | 'winRate' | 'kills' | 'matches';
export interface RankRow { player: CorePlayer; stats: PlayerStats; value: number | null }
/** Ranking: jogadores sem amostra mínima ficam de fora (não se extrapola). */
export function rankPlayers(d: Pick<CoreData, 'players' | 'participations' | 'matches'>, metric: RankMetric, minMatches = 3, onlyVerified = false): RankRow[] {
  const by = groupBy(d.participations, (p) => p.player_id);
  return d.players
    .map((player) => { const stats = playerStats(by.get(player.id) ?? [], d.matches, onlyVerified); return { player, stats, value: stats[metric] as number | null }; })
    .filter((r) => r.stats.matches >= minMatches && r.value != null)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || b.stats.matches - a.stats.matches);
}

// ---------- Deteção de inconsistências / anomalias (para revisão HUMANA, nunca punição automática) ----------
export interface Anomaly {
  kind: 'kills_outlier' | 'kills_improvavel' | 'team_kills_mismatch' | 'duplicate_external_id' | 'duplicate_nickname' | 'placement_conflict' | 'placement_inconsistent' | 'team_overlap' | 'submitted_vs_verified';
  severity: 'baixa' | 'media' | 'alta';
  title: string; detail: string;
  entity_type: 'player' | 'team' | 'match' | 'external_id' | 'result';
  entity_id: string;
  evidence: string[];
}

function groupBy<T>(arr: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of arr) { const k = key(x); const a = m.get(k); if (a) a.push(x); else m.set(k, [x]); }
  return m;
}
function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export const IMPROBABLE_KILLS = 35; // num BR de ~50 jogadores, > 35 abates numa partida é extremamente raro

export function detectAnomalies(d: CoreData): Anomaly[] {
  const out: Anomaly[] = [];
  const nick = new Map(d.players.map((p) => [p.id, p.nickname]));
  const teamName = new Map(d.teams.map((t) => [t.id, t.name]));
  const parts = d.participations.filter(usable);
  const byPlayer = groupBy(parts, (p) => p.player_id);

  // 1) Abates fora do padrão do próprio jogador (IQR, ≥ 8 partidas) e valores improváveis
  for (const [pid, rows] of byPlayer) {
    for (const r of rows) if (r.kills > IMPROBABLE_KILLS) out.push({
      kind: 'kills_improvavel', severity: 'alta', entity_type: 'player', entity_id: pid, evidence: [r.id],
      title: `${nick.get(pid) ?? 'Jogador'}: ${r.kills} abates numa partida`, detail: `Valor acima de ${IMPROBABLE_KILLS} abates. Confirmar com prova (captura/replay).`,
    });
    if (rows.length < 8) continue;
    const k = rows.map((r) => r.kills).sort((a, b) => a - b);
    const q1 = quantile(k, 0.25), q3 = quantile(k, 0.75), iqr = Math.max(1, q3 - q1);
    const limit = q3 + 3 * iqr;
    const hits = rows.filter((r) => r.kills > limit && r.kills <= IMPROBABLE_KILLS);
    if (hits.length) out.push({
      kind: 'kills_outlier', severity: hits.some((h) => h.validation_status === 'submetido') ? 'media' : 'baixa', entity_type: 'player', entity_id: pid,
      evidence: hits.map((h) => h.id),
      title: `${nick.get(pid) ?? 'Jogador'}: abates fora do padrão`, detail: `${hits.length} partida(s) acima de ${fmtNum(limit, 1)} abates (Q3 ${fmtNum(q3)} + 3×IQR ${fmtNum(iqr)}) em ${rows.length} partidas.`,
    });
  }

  // 2) Submetidos muito acima dos verificados (mesmo jogador, ≥ 3 de cada)
  for (const [pid, rows] of byPlayer) {
    const v = rows.filter((r) => r.validation_status === 'verificado'), s = rows.filter((r) => r.validation_status === 'submetido');
    if (v.length < 3 || s.length < 3) continue;
    const av = v.reduce((a, r) => a + r.kills, 0) / v.length, as = s.reduce((a, r) => a + r.kills, 0) / s.length;
    if (as > Math.max(2, av * 2)) out.push({
      kind: 'submitted_vs_verified', severity: 'media', entity_type: 'player', entity_id: pid, evidence: s.map((r) => r.id),
      title: `${nick.get(pid) ?? 'Jogador'}: submissões acima do verificado`, detail: `Média submetida ${fmtNum(as)} vs verificada ${fmtNum(av)} abates.`,
    });
  }

  // 3) Mesmo ID Free Fire ligado a vários jogadores
  const byExt = groupBy(d.externalIds.filter((e) => e.status !== 'rejeitado'), (e) => `${e.game}:${e.external_id}`);
  for (const [, rows] of byExt) {
    const players = [...new Set(rows.map((r) => r.player_id))];
    if (players.length > 1) out.push({
      kind: 'duplicate_external_id', severity: 'alta', entity_type: 'external_id', entity_id: rows[0].external_id, evidence: rows.map((r) => r.id),
      title: `ID ${rows[0].external_id} reivindicado por ${players.length} jogadores`, detail: players.map((p) => nick.get(p) ?? p).join(', '),
    });
  }

  // 4) Nicknames praticamente iguais (possível conta duplicada)
  const byNick = groupBy(d.players, (p) => normalizeNickname(p.nickname));
  for (const [k, rows] of byNick) if (k.length >= 3 && rows.length > 1) out.push({
    kind: 'duplicate_nickname', severity: 'baixa', entity_type: 'player', entity_id: rows[0].id, evidence: rows.map((r) => r.id),
    title: `Possível duplicado: ${rows.map((r) => r.nickname).join(' / ')}`, detail: 'Nicknames equivalentes após normalização. Confirmar se é a mesma pessoa.',
  });

  // 5) Resultados de equipa: posição repetida na mesma partida; abates da equipa ≠ soma dos membros
  const resByMatch = groupBy(d.results.filter(usable), (r) => r.match_id);
  const partsByMatchTeam = groupBy(parts.filter((p) => p.team_id), (p) => `${p.match_id}|${p.team_id}`);
  for (const [mid, rows] of resByMatch) {
    for (const [pl, same] of groupBy(rows, (r) => String(r.placement))) if (same.length > 1) out.push({
      kind: 'placement_conflict', severity: 'alta', entity_type: 'match', entity_id: mid, evidence: same.map((r) => r.id),
      title: `${same.length} equipas com a posição ${pl} na mesma partida`, detail: same.map((r) => teamName.get(r.team_id) ?? r.team_id).join(', '),
    });
    for (const r of rows) {
      const ps = partsByMatchTeam.get(`${mid}|${r.team_id}`) ?? [];
      if (!ps.length) continue;
      const sum = ps.reduce((a, p) => a + p.kills, 0);
      if (sum !== r.kills_total) out.push({
        kind: 'team_kills_mismatch', severity: 'media', entity_type: 'result', entity_id: r.id, evidence: [r.id, ...ps.map((p) => p.id)],
        title: `${teamName.get(r.team_id) ?? 'Equipa'}: abates não batem certo`, detail: `Resultado diz ${r.kills_total}; soma dos ${ps.length} membro(s) registados = ${sum}.`,
      });
      const wrong = ps.filter((p) => p.placement != null && p.placement !== r.placement);
      if (wrong.length) out.push({
        kind: 'placement_inconsistent', severity: 'media', entity_type: 'result', entity_id: r.id, evidence: [r.id, ...wrong.map((p) => p.id)],
        title: `${teamName.get(r.team_id) ?? 'Equipa'}: posição diferente da dos membros`, detail: `Equipa ${r.placement}.º; membros: ${wrong.map((p) => `${nick.get(p.player_id) ?? '?'} ${p.placement}.º`).join(', ')}.`,
      });
    }
  }

  // 6) Jogador em duas equipas inscritas no mesmo torneio
  const activeTeamsOf = groupBy(d.members.filter((m) => !m.left_at), (m) => m.player_id);
  const teamsInTour = groupBy(d.tournamentTeams, (t) => t.tournament_id);
  for (const [tid, regs] of teamsInTour) {
    const set = new Set(regs.map((r) => r.team_id));
    for (const [pid, ms] of activeTeamsOf) {
      const inTour = ms.filter((m) => set.has(m.team_id));
      if (inTour.length > 1) out.push({
        kind: 'team_overlap', severity: 'media', entity_type: 'player', entity_id: pid, evidence: [tid, ...inTour.map((m) => m.team_id)],
        title: `${nick.get(pid) ?? 'Jogador'} em ${inTour.length} equipas do mesmo torneio`, detail: inTour.map((m) => teamName.get(m.team_id) ?? m.team_id).join(', '),
      });
    }
  }
  const sev = { alta: 0, media: 1, baixa: 2 } as const;
  return out.sort((a, b) => sev[a.severity] - sev[b.severity]);
}

// ---------- Origem dos dados ----------
export interface OriginBreakdown { total: number; bySource: Record<Source, number>; byStatus: Record<Validation, number> }
export function originBreakdown(rows: { source: Source; validation_status: Validation }[]): OriginBreakdown {
  const bySource: Record<Source, number> = { torneio_txapilog: 0, submetido_jogador: 0, provedor_autorizado: 0 };
  const byStatus: Record<Validation, number> = { submetido: 0, verificado: 0, rejeitado: 0 };
  for (const r of rows) { bySource[r.source] = (bySource[r.source] ?? 0) + 1; byStatus[r.validation_status] = (byStatus[r.validation_status] ?? 0) + 1; }
  return { total: rows.length, bySource, byStatus };
}

// ---------- Séries para gráficos ----------
/** Partidas por dia nos últimos `days` dias (inclui hoje), a partir de played_at. */
export function matchesPerDay(matches: CoreMatch[], days: number, now = new Date()): { label: string; value: number }[] {
  const out: { label: string; value: number; key: string }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    out.push({ key: d.toISOString().slice(0, 10), label: `${d.getUTCDate()}/${d.getUTCMonth() + 1}`, value: 0 });
  }
  const idx = new Map(out.map((o, i) => [o.key, i]));
  for (const m of matches) { if (m.validation_status === 'rejeitado') continue; const i = idx.get(m.played_at.slice(0, 10)); if (i != null) out[i].value++; }
  return out.map(({ label, value }) => ({ label, value }));
}

// ---------- Relatório determinístico (base do Centro de IA; a IA só pode reformular isto) ----------
export interface ReportLine { text: string; evidence: string[] }
export function playerReport(player: CorePlayer, d: CoreData): { lines: ReportLine[]; confidence: ConfidenceInfo; stats: PlayerStats } {
  const parts = d.participations.filter((p) => p.player_id === player.id);
  const stats = playerStats(parts, d.matches);
  const conf = confidenceFor(stats);
  const lines: ReportLine[] = [];
  const ids = parts.filter(usable).map((p) => p.id);
  if (!stats.matches) {
    lines.push({ text: `${player.nickname}: estatísticas indisponíveis — nenhuma partida registada na TXAPILOG.`, evidence: [] });
    return { lines, confidence: conf, stats };
  }
  lines.push({ text: `${player.nickname} tem ${stats.matches} partida(s) registada(s): ${stats.verified} verificada(s), ${stats.unverified} submetida(s) não verificada(s)${stats.rejected ? `, ${stats.rejected} rejeitada(s) excluída(s)` : ''}.`, evidence: ids });
  lines.push({ text: `Abates: ${stats.kills} no total, média ${fmtNum(stats.avgKills)} por partida, máximo ${stats.maxKills}.`, evidence: ids });
  lines.push({ text: stats.placementSamples ? `Vitórias: ${stats.wins} em ${stats.placementSamples} partidas com posição (${pct(stats.winRate)}); K/D ${fmtNum(stats.kd)}; posição média ${fmtNum(stats.avgPlacement)}.` : 'Vitórias e K/D: indisponível (sem posições registadas).', evidence: ids });
  lines.push({ text: stats.damageSamples ? `Dano médio ${stats.avgDamage} (em ${stats.damageSamples} partidas com dano registado).` : 'Dano: indisponível (não registado).', evidence: ids });
  const t = trendFor(parts, d.matches);
  lines.push(t.direction === 'indisponivel'
    ? { text: 'Tendência: indisponível (são precisas pelo menos 10 partidas).', evidence: [] }
    : { text: `Tendência (últimas ${t.window} vs ${t.window} anteriores): ${t.direction === 'subida' ? 'em subida' : t.direction === 'descida' ? 'em descida' : 'estável'} — média de abates ${fmtNum(t.previousAvgKills)} → ${fmtNum(t.recentAvgKills)}.`, evidence: t.evidence });
  const an = detectAnomalies(d).filter((a) => a.entity_id === player.id || a.evidence.some((e) => ids.includes(e)));
  if (an.length) lines.push({ text: `Atenção: ${an.length} sinal(is) para revisão humana — ${an.map((a) => a.title).join('; ')}.`, evidence: an.flatMap((a) => a.evidence) });
  return { lines, confidence: conf, stats };
}

export function fmtNum(n: number | null | undefined, d = 2): string { return n == null ? 'indisponível' : String(round(n, d)).replace('.', ','); }
export function pct(n: number | null | undefined): string { return n == null ? 'indisponível' : `${String(round(n * 100, 1)).replace('.', ',')}%`; }

/** "há 5 min", "há 2 h", "há 3 dias" (pt). */
export function timeAgo(iso: string | number | Date | null | undefined, now: number = Date.now()): string {
  if (iso == null) return 'nunca';
  const t = typeof iso === 'number' ? iso : new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'indisponível';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'agora mesmo';
  const m = Math.round(s / 60); if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60); if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24); if (d < 31) return `há ${d} dia${d === 1 ? '' : 's'}`;
  const mo = Math.round(d / 30); if (mo < 12) return `há ${mo} ${mo === 1 ? 'mês' : 'meses'}`;
  const y = Math.round(d / 365); return `há ${y} ano${y === 1 ? '' : 's'}`;
}
