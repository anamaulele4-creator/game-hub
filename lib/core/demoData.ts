// "Dados de exemplo" do AI CORE — SÓ usados em builds de demonstração (NEXT_PUBLIC_DEMO=1).
// Nunca aparecem em produção e a interface identifica-os sempre como "Dados de exemplo".
// São gerados de forma determinística (semente fixa) para as capturas e testes serem estáveis.
import type { CoreData, CoreExternalId, CoreMatch, CoreParticipation, CorePlayer, CoreResult, CoreTeam, CoreTeamMember, CoreTournament } from './stats';
import type { CoreAlert, CoreAudit, CoreIntegrationRow, CoreReport, CoreRoleRow } from './repo';

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const NICKS = ['MZ_Fenix', 'Txuna77', 'KillaBeira', 'Matola_Sniper', 'ZéHeadshot', 'Nhamunda', 'LeoaDeGaza', 'RushNampula', 'Inhaca_Pro', 'TeteStorm', 'Xiconhoca', 'Mafalala_FF', 'Txuna_77', 'QuelimaneOG'];

export function demoCore(now = Date.now()) {
  const r = rng(20261009);
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const H = 3600_000, D = 24 * H;
  const players: CorePlayer[] = NICKS.map((n, i) => ({ id: `ex-p${i + 1}`, user_id: null, nickname: n, country: 'MZ', status: 'ativo', created_at: iso((60 - i) * D) }));
  const externalIds: CoreExternalId[] = players.map((p, i) => ({
    id: `ex-x${i + 1}`, player_id: p.id, game: 'free_fire', external_id: String(1000000000 + i * 7919 + 123), region: 'AF',
    status: i < 9 ? 'verificado' : 'pendente', source: i < 9 ? 'torneio_txapilog' : 'submetido_jogador', created_at: p.created_at,
  }));
  // Exemplo de duplicado: o jogador 13 (Txuna_77) reivindica o mesmo ID do jogador 2 (Txuna77)
  externalIds.push({ id: 'ex-x99', player_id: 'ex-p13', game: 'free_fire', external_id: externalIds[1].external_id, region: 'AF', status: 'pendente', source: 'submetido_jogador', created_at: iso(2 * D) });

  const teams: CoreTeam[] = [
    { id: 'ex-t1', name: 'Leões de Maputo', tag: 'LDM', kind: 'squad', captain_player_id: 'ex-p1', created_at: iso(50 * D) },
    { id: 'ex-t2', name: 'Beira Storm', tag: 'BST', kind: 'squad', captain_player_id: 'ex-p3', created_at: iso(48 * D) },
    { id: 'ex-t3', name: 'Matola Kings', tag: 'MTK', kind: 'squad', captain_player_id: 'ex-p4', created_at: iso(45 * D) },
    { id: 'ex-t4', name: 'Dupla Inhaca', tag: 'INH', kind: 'duo', captain_player_id: 'ex-p9', created_at: iso(30 * D) },
  ];
  const roster: Record<string, string[]> = { 'ex-t1': ['ex-p1', 'ex-p2', 'ex-p5', 'ex-p6'], 'ex-t2': ['ex-p3', 'ex-p7', 'ex-p8', 'ex-p10'], 'ex-t3': ['ex-p4', 'ex-p11', 'ex-p12', 'ex-p14'], 'ex-t4': ['ex-p9', 'ex-p13'] };
  const members: CoreTeamMember[] = Object.entries(roster).flatMap(([t, ps]) => ps.map((p, i) => ({ team_id: t, player_id: p, role: i === 0 ? 'capitao' : 'membro', joined_at: iso(40 * D), left_at: null } as CoreTeamMember)));
  // Exemplo de sobreposição: ex-p9 também está nos Leões (inscritos no mesmo torneio)
  members.push({ team_id: 'ex-t1', player_id: 'ex-p9', role: 'suplente', joined_at: iso(10 * D), left_at: null });

  const tournaments: CoreTournament[] = [
    { id: 'ex-c1', name: 'Taça TXAPILOG Maputo', mode: 'squad', region: 'AF', status: 'terminado', starts_at: iso(28 * D), ends_at: iso(21 * D), organizer_id: null, created_at: iso(35 * D) },
    { id: 'ex-c2', name: 'Liga Moçambique FF · Ronda 2', mode: 'squad', region: 'AF', status: 'a_decorrer', starts_at: iso(6 * D), ends_at: null, organizer_id: null, created_at: iso(14 * D) },
    { id: 'ex-c3', name: 'Duo Cup Inhambane', mode: 'duo', region: 'AF', status: 'inscricoes', starts_at: iso(-5 * D), ends_at: null, organizer_id: null, created_at: iso(3 * D) },
  ];
  const tournamentTeams = [
    { tournament_id: 'ex-c1', team_id: 'ex-t1' }, { tournament_id: 'ex-c1', team_id: 'ex-t2' }, { tournament_id: 'ex-c1', team_id: 'ex-t3' },
    { tournament_id: 'ex-c2', team_id: 'ex-t1' }, { tournament_id: 'ex-c2', team_id: 'ex-t2' }, { tournament_id: 'ex-c2', team_id: 'ex-t3' }, { tournament_id: 'ex-c2', team_id: 'ex-t4' },
  ];

  const matches: CoreMatch[] = [];
  const participations: CoreParticipation[] = [];
  const results: CoreResult[] = [];
  const maps = ['Bermuda', 'Purgatório', 'Kalahari', 'Alpine', 'Nexterra'];
  const squads = ['ex-t1', 'ex-t2', 'ex-t3'];
  let pc = 0;
  for (let i = 0; i < 36; i++) {
    const tour = i < 16 ? 'ex-c1' : i < 30 ? 'ex-c2' : null;
    const ago = i < 16 ? (28 - i * 0.4) * D : i < 30 ? (6 - (i - 16) * 0.4) * D : (1 - (i - 30) * 0.15) * D;
    const status = i < 26 ? 'verificado' : 'submetido';
    const m: CoreMatch = { id: `ex-m${i + 1}`, tournament_id: tour, round_label: tour ? `Jogo ${i < 16 ? i + 1 : i - 15}` : null, map: maps[i % maps.length], mode: 'squad', played_at: iso(ago), source: tour ? 'torneio_txapilog' : 'submetido_jogador', validation_status: status };
    matches.push(m);
    const order = squads.slice().sort(() => r() - 0.5);
    order.forEach((t, k) => {
      const placement = k === 0 ? 1 : k === 1 ? 2 + Math.floor(r() * 3) : 5 + Math.floor(r() * 8);
      let total = 0;
      for (const pid of roster[t]) {
        const skill = pid === 'ex-p1' ? 3.2 : pid === 'ex-p3' ? 2.8 : pid === 'ex-p4' ? 2.4 : 1.4;
        const trendBoost = pid === 'ex-p3' && i >= 26 ? 2 : 0;
        let kills = Math.max(0, Math.round(skill + trendBoost + (r() - 0.4) * 3));
        if (pid === 'ex-p11' && i === 33) kills = 38; // exemplo de valor improvável (submetido)
        total += kills;
        participations.push({
          id: `ex-mp${++pc}`, match_id: m.id, player_id: pid, team_id: t, kills, damage: r() < 0.8 ? Math.round(kills * 180 + 250 + r() * 400) : null,
          assists: Math.floor(r() * 3), placement, survived_seconds: Math.round(600 + r() * 900), source: m.source, validation_status: status, created_at: m.played_at,
        });
      }
      // exemplo de inconsistência: resultado com abates diferentes da soma dos membros
      results.push({ id: `ex-r${i + 1}-${k}`, match_id: m.id, team_id: t, placement, kills_total: i === 31 && k === 0 ? total + 6 : total, points: Math.max(0, 13 - placement) + total, source: m.source, validation_status: status, created_at: m.played_at });
    });
  }

  const data: CoreData = { players, externalIds, verifications: players.slice(0, 6).map((p) => ({ player_id: p.id, method: 'organizador_torneio', verified_at: p.created_at })), teams, members, tournaments, tournamentTeams, matches, participations, results };
  const alerts: CoreAlert[] = [
    { id: 'ex-a1', kind: 'duplicate_external_id', severity: 'alta', title: `ID ${externalIds[1].external_id} reivindicado por 2 jogadores`, detail: 'Txuna77, Txuna_77', entity_type: 'external_id', entity_id: externalIds[1].external_id, evidence: ['ex-x2', 'ex-x99'], origin: 'motor_ia', status: 'aberto', created_at: iso(2 * H) },
  ];
  const reports: CoreReport[] = [];
  const integrations: CoreIntegrationRow[] = [
    { id: 'txapilog_torneios', name: 'Torneios registados na TXAPILOG', kind: 'txapilog', enabled: true, status: 'Ativo', detail: null, last_sync_at: iso(12 * 60_000) },
    { id: 'garena_oficial', name: 'API oficial Garena Free Fire', kind: 'oficial', enabled: false, status: 'Não configurado — sem fonte autorizada', detail: null, last_sync_at: null },
    { id: 'fornecedor_autorizado', name: 'Fornecedor de dados autorizado', kind: 'autorizado', enabled: false, status: 'Não configurado — sem fonte autorizada', detail: null, last_sync_at: null },
  ];
  const audit: CoreAudit[] = [
    { id: 3, actor_id: null, actor_label: '@ana', actor_role: 'admin', action: 'UPDATE', table_name: 'core_match_participants', row_id: 'ex-mp40', created_at: iso(3 * H) },
    { id: 2, actor_id: null, actor_label: '@moderador', actor_role: 'moderador', action: 'INSERT', table_name: 'core_alerts', row_id: 'ex-a1', created_at: iso(2 * H) },
    { id: 1, actor_id: null, actor_label: '@ana', actor_role: 'admin', action: 'RPC', table_name: 'core_set_role', row_id: '@organizador', created_at: iso(26 * H) },
  ];
  const roles: CoreRoleRow[] = [
    { user_id: 'ex-u1', handle: 'ana', role: 'admin', created_at: iso(40 * D) },
    { user_id: 'ex-u2', handle: 'moderador', role: 'moderador', created_at: iso(20 * D) },
    { user_id: 'ex-u3', handle: 'organizador', role: 'organizador', created_at: iso(20 * D) },
  ];
  return { data, alerts, reports, integrations, audit, roles };
}
