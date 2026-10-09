// Testes do TXAPILOG AI CORE (node:test, sem dependências). Correr: npm test
// Node 22: usa --experimental-strip-types para importar os ficheiros .ts diretamente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  playerStats, confidenceFor, trendFor, comparePlayers, teamStats, rankPlayers, detectAnomalies, originBreakdown,
  matchesPerDay, playerReport, isValidFreeFireId, normalizeNickname, validateParticipation, timeAgo, fmtNum, pct,
} from '../lib/core/stats.ts';
import { buildProviders, searchExternalId, NOT_CONFIGURED } from '../lib/core/providers.ts';
import { validateSummary } from '../supabase/functions/_shared/core-summary-guard.ts';

const T0 = Date.parse('2026-10-01T12:00:00Z');
const iso = (h) => new Date(T0 + h * 3600_000).toISOString();
let n = 0;
const part = (o) => ({ id: `mp${++n}`, match_id: o.match_id ?? `m${n}`, player_id: 'p1', team_id: null, kills: 0, damage: null, assists: null, placement: null, survived_seconds: null, source: 'torneio_txapilog', validation_status: 'verificado', created_at: iso(n), ...o });
const match = (id, h, o = {}) => ({ id, tournament_id: null, round_label: null, map: null, mode: 'squad', played_at: iso(h), source: 'torneio_txapilog', validation_status: 'verificado', ...o });
const empty = () => ({ players: [], externalIds: [], verifications: [], teams: [], members: [], tournaments: [], tournamentTeams: [], matches: [], participations: [], results: [] });

test('sem partidas → tudo indisponível (null), nunca zero inventado', () => {
  const s = playerStats([]);
  assert.equal(s.matches, 0);
  for (const k of ['kills', 'avgKills', 'maxKills', 'avgDamage', 'wins', 'winRate', 'avgPlacement', 'kd', 'top10Rate', 'lastPlayedAt']) assert.equal(s[k], null, k);
  assert.equal(confidenceFor(s).level, 'indisponivel');
  assert.equal(fmtNum(s.avgKills), 'indisponível');
  assert.equal(pct(s.winRate), 'indisponível');
});

test('estatísticas: rejeitadas excluídas, K/D Free Fire, dano só com amostras', () => {
  const rows = [
    part({ kills: 4, placement: 1, damage: 1000 }),
    part({ kills: 2, placement: 5 }),
    part({ kills: 6, placement: 3, damage: 1400, validation_status: 'submetido' }),
    part({ kills: 30, placement: 1, validation_status: 'rejeitado' }),
  ];
  const s = playerStats(rows);
  assert.equal(s.matches, 3); assert.equal(s.rejected, 1); assert.equal(s.verified, 2); assert.equal(s.unverified, 1);
  assert.equal(s.kills, 12); assert.equal(s.avgKills, 4); assert.equal(s.maxKills, 6);
  assert.equal(s.wins, 1); assert.equal(s.winRate, 0.3333);
  assert.equal(s.kd, 6); // 12 abates ÷ 2 partidas não ganhas
  assert.equal(s.avgDamage, 1200); assert.equal(s.damageSamples, 2);
  const v = playerStats(rows, [], true);
  assert.equal(v.matches, 2); assert.equal(v.kills, 6); assert.equal(v.kd, 6); // 6 abates ÷ 1 partida não ganha
});

test('K/D indisponível quando só há vitórias ou sem posições', () => {
  assert.equal(playerStats([part({ kills: 5, placement: 1 })]).kd, null);
  const s = playerStats([part({ kills: 5 })]);
  assert.equal(s.kd, null); assert.equal(s.wins, null); assert.equal(s.avgKills, 5);
});

test('confiança depende da amostra verificada', () => {
  assert.equal(confidenceFor({ matches: 25, verified: 22, placementSamples: 25 }).level, 'alta');
  assert.equal(confidenceFor({ matches: 10, verified: 6, placementSamples: 10 }).level, 'media');
  assert.equal(confidenceFor({ matches: 10, verified: 2, placementSamples: 10 }).level, 'baixa');
  assert.equal(confidenceFor({ matches: 30, verified: 10, placementSamples: 30 }).level, 'baixa'); // muitas não verificadas
});

test('tendência precisa de 2×janela partidas e deteta subida', () => {
  const ms = [], ps = [];
  for (let i = 0; i < 10; i++) { ms.push(match(`t${i}`, i)); ps.push(part({ match_id: `t${i}`, kills: i < 5 ? 2 : 5 })); }
  const t = trendFor(ps, ms, 5);
  assert.equal(t.direction, 'subida'); assert.equal(t.previousAvgKills, 2); assert.equal(t.recentAvgKills, 5); assert.equal(t.evidence.length, 10);
  assert.equal(trendFor(ps.slice(0, 9), ms, 5).direction, 'indisponivel');
});

test('comparação marca indisponível quando falta métrica', () => {
  const a = playerStats([part({ kills: 4, placement: 2 })]), b = playerStats([part({ kills: 3 })]);
  const rows = comparePlayers(a, b);
  assert.equal(rows.find((r) => r.metric === 'Média de abates').better, 'a');
  assert.equal(rows.find((r) => r.metric === 'Taxa de vitória').better, 'indisponivel');
  assert.equal(rows.find((r) => r.metric === 'Posição média').better, 'indisponivel');
});

test('ranking exclui amostras pequenas', () => {
  const d = empty();
  d.players = [{ id: 'p1', nickname: 'A' }, { id: 'p2', nickname: 'B' }];
  d.participations = [part({ player_id: 'p1', kills: 3 }), part({ player_id: 'p1', kills: 5 }), part({ player_id: 'p1', kills: 4 }), part({ player_id: 'p2', kills: 20 })];
  const r = rankPlayers(d, 'avgKills', 3);
  assert.equal(r.length, 1); assert.equal(r[0].player.id, 'p1'); assert.equal(r[0].value, 4);
});

test('estatísticas de equipa', () => {
  const res = [
    { id: 'r1', match_id: 'm1', team_id: 't1', placement: 1, kills_total: 10, points: 22, source: 'torneio_txapilog', validation_status: 'verificado', created_at: iso(1) },
    { id: 'r2', match_id: 'm2', team_id: 't1', placement: 3, kills_total: 4, points: null, source: 'torneio_txapilog', validation_status: 'submetido', created_at: iso(2) },
    { id: 'r3', match_id: 'm3', team_id: 't1', placement: 1, kills_total: 40, points: 50, source: 'submetido_jogador', validation_status: 'rejeitado', created_at: iso(3) },
  ];
  const s = teamStats('t1', res, [{ team_id: 't1', player_id: 'a', left_at: null }, { team_id: 't1', player_id: 'b', left_at: iso(0) }]);
  assert.deepEqual(s, { matches: 2, verified: 1, wins: 1, avgPlacement: 2, kills: 14, points: 22, activeMembers: 1 });
  assert.equal(teamStats('t9', res, []).wins, null);
});

test('anomalias: ID duplicado, nickname duplicado, valor improvável, soma de equipa, posição repetida, equipas sobrepostas', () => {
  const d = empty();
  d.players = [{ id: 'p1', nickname: 'Txuna77' }, { id: 'p2', nickname: 'TXUNA_77' }, { id: 'p3', nickname: 'Outro' }];
  d.externalIds = [
    { id: 'x1', player_id: 'p1', game: 'free_fire', external_id: '123456789', status: 'verificado' },
    { id: 'x2', player_id: 'p2', game: 'free_fire', external_id: '123456789', status: 'pendente' },
    { id: 'x3', player_id: 'p3', game: 'free_fire', external_id: '999999999', status: 'rejeitado' },
  ];
  d.matches = [match('m1', 1)];
  d.participations = [
    part({ id: 'a1', match_id: 'm1', player_id: 'p1', team_id: 't1', kills: 40, placement: 1, validation_status: 'submetido' }),
    part({ id: 'a2', match_id: 'm1', player_id: 'p3', team_id: 't1', kills: 2, placement: 2 }),
  ];
  d.results = [
    { id: 'r1', match_id: 'm1', team_id: 't1', placement: 1, kills_total: 50, points: 10, source: 'torneio_txapilog', validation_status: 'submetido', created_at: iso(1) },
    { id: 'r2', match_id: 'm1', team_id: 't2', placement: 1, kills_total: 3, points: 10, source: 'torneio_txapilog', validation_status: 'submetido', created_at: iso(1) },
  ];
  d.teams = [{ id: 't1', name: 'Leões' }, { id: 't2', name: 'Beira' }];
  d.members = [{ team_id: 't1', player_id: 'p3', left_at: null }, { team_id: 't2', player_id: 'p3', left_at: null }];
  d.tournamentTeams = [{ tournament_id: 'c1', team_id: 't1' }, { tournament_id: 'c1', team_id: 't2' }];
  const kinds = detectAnomalies(d).map((a) => a.kind).sort();
  assert.deepEqual(kinds, ['duplicate_external_id', 'duplicate_nickname', 'kills_improvavel', 'placement_conflict', 'placement_inconsistent', 'team_kills_mismatch', 'team_overlap'].sort());
  const all = detectAnomalies(d);
  assert.equal(all[0].severity, 'alta'); // ordenado por severidade
  assert.ok(all.every((a) => Array.isArray(a.evidence) && a.evidence.length > 0));
});

test('anomalias: padrão IQR do próprio jogador (≥ 8 partidas) e submetidos vs verificados', () => {
  const d = empty();
  d.players = [{ id: 'p1', nickname: 'Solo' }];
  const ks = [2, 3, 2, 3, 2, 3, 2, 3, 25];
  d.participations = ks.map((k, i) => part({ player_id: 'p1', kills: k, validation_status: i === 8 ? 'submetido' : 'verificado' }));
  const a = detectAnomalies(d).find((x) => x.kind === 'kills_outlier');
  assert.ok(a); assert.equal(a.evidence.length, 1); assert.equal(a.severity, 'media');
  const d2 = empty();
  d2.players = [{ id: 'p1', nickname: 'Solo' }];
  d2.participations = [2, 2, 2].map((k) => part({ player_id: 'p1', kills: k })).concat([9, 10, 11].map((k) => part({ player_id: 'p1', kills: k, validation_status: 'submetido' })));
  assert.ok(detectAnomalies(d2).some((x) => x.kind === 'submitted_vs_verified'));
});

test('dados limpos → sem anomalias', () => {
  const d = empty();
  d.players = [{ id: 'p1', nickname: 'Alpha' }, { id: 'p2', nickname: 'Bravo' }];
  d.externalIds = [{ id: 'x1', player_id: 'p1', game: 'free_fire', external_id: '111111111', status: 'verificado' }, { id: 'x2', player_id: 'p2', game: 'free_fire', external_id: '222222222', status: 'verificado' }];
  d.participations = [part({ player_id: 'p1', kills: 3 }), part({ player_id: 'p2', kills: 4 })];
  assert.deepEqual(detectAnomalies(d), []);
});

test('validação de entradas', () => {
  assert.ok(isValidFreeFireId('1234567890')); assert.ok(isValidFreeFireId(' 123456 '));
  for (const bad of ['12345', 'abc123456', '12345678901234', '', '1234-5678']) assert.equal(isValidFreeFireId(bad), false, bad);
  assert.deepEqual(validateParticipation({ kills: 5, placement: 2, damage: 1200 }), []);
  assert.equal(validateParticipation({ kills: 61 }).length, 1);
  assert.equal(validateParticipation({ kills: 2.5, placement: 0, damage: -1 }).length, 3);
  assert.equal(normalizeNickname('Txuna_77'), normalizeNickname('TXUNA77'));
  assert.equal(normalizeNickname('Zé'), 'ze');
});

test('origem dos dados e séries por dia', () => {
  const o = originBreakdown([part({}), part({ source: 'submetido_jogador', validation_status: 'submetido' })]);
  assert.equal(o.total, 2); assert.equal(o.bySource.submetido_jogador, 1); assert.equal(o.byStatus.verificado, 1); assert.equal(o.bySource.provedor_autorizado, 0);
  const s = matchesPerDay([match('a', 0), match('b', 1), match('c', -30), match('d', 0, { validation_status: 'rejeitado' })], 3, new Date(T0 + 2 * 3600_000));
  assert.equal(s.length, 3); assert.equal(s[2].value, 2); assert.equal(s[1].value, 1); assert.equal(s.reduce((a, x) => a + x.value, 0), 3); // rejeitada não conta
});

test('relatório: sem dados diz indisponível; com dados cita evidência', () => {
  const d = empty();
  d.players = [{ id: 'p1', nickname: 'Alpha' }, { id: 'p2', nickname: 'Novo' }];
  d.participations = [part({ player_id: 'p1', kills: 3, placement: 4 })];
  const r0 = playerReport(d.players[1], d);
  assert.match(r0.lines[0].text, /indisponíveis/); assert.equal(r0.confidence.level, 'indisponivel');
  const r = playerReport(d.players[0], d);
  assert.ok(r.lines.length >= 4); assert.ok(r.lines[0].evidence.length === 1);
  assert.ok(r.lines.some((l) => /Dano: indisponível/.test(l.text)));
  assert.ok(r.lines.some((l) => /Tendência: indisponível/.test(l.text)));
});

test('fornecedores: só TXAPILOG ativo; Garena e fornecedor externo não configurados e sem dados', async () => {
  const d = empty();
  d.players = [{ id: 'p1', nickname: 'Alpha' }];
  d.externalIds = [{ id: 'x1', player_id: 'p1', game: 'free_fire', external_id: '123456789', region: 'AF', status: 'verificado' }];
  d.participations = [part({ player_id: 'p1', kills: 3 })];
  const ps = buildProviders(() => d);
  assert.deepEqual(ps.map((p) => [p.id, p.enabled]), [['txapilog_torneios', true], ['garena_oficial', false], ['fornecedor_autorizado', false]]);
  assert.ok(ps.filter((p) => !p.enabled).every((p) => p.statusLabel === NOT_CONFIGURED));
  const [tx, ga, fa] = await searchExternalId(ps, '123456789');
  assert.equal(tx.status, 'encontrado'); assert.equal(tx.participations.length, 1);
  for (const r of [ga, fa]) { assert.equal(r.status, 'indisponivel'); assert.equal(r.players.length, 0); assert.equal(r.participations.length, 0); }
  const [none] = await searchExternalId(ps, '555555555');
  assert.equal(none.status, 'sem_dados'); assert.equal(none.players.length, 0);
});

test('guarda do resumo IA: aceita só citações válidas e números presentes nos factos', () => {
  const facts = ['Alpha tem 12 partida(s) registada(s): 10 verificada(s).', 'Abates: 40 no total, média 3,33 por partida, máximo 9.'];
  assert.equal(validateSummary('Alpha jogou 12 partidas, 10 verificadas [F1]. A média é 3,33 abates [F2].', facts).ok, true);
  assert.equal(validateSummary('Alpha jogou 12 partidas [F1]. Ganhou 7 vezes [F2].', facts).ok, false); // 7 inventado
  assert.equal(validateSummary('Alpha é muito bom e joga bem.', facts).ok, false); // sem citações
  assert.equal(validateSummary('Alpha jogou 12 partidas [F3].', facts).ok, false); // facto inexistente
  assert.equal(validateSummary('Alpha jogou 12 partidas [F1]. Tem uma média excelente sem citação.', facts).ok, false);
});

test('timeAgo em português', () => {
  const now = T0;
  assert.equal(timeAgo(now - 10_000, now), 'agora mesmo');
  assert.equal(timeAgo(now - 5 * 60_000, now), 'há 5 min');
  assert.equal(timeAgo(now - 3 * 3600_000, now), 'há 3 h');
  assert.equal(timeAgo(now - 86400_000, now), 'há 1 dia');
  assert.equal(timeAgo(null, now), 'nunca');
});

test('Edge Function usa exatamente os mesmos cálculos que o painel', () => {
  const a = readFileSync(new URL('../lib/core/stats.ts', import.meta.url), 'utf8');
  const b = readFileSync(new URL('../supabase/functions/_shared/core-stats.ts', import.meta.url), 'utf8');
  assert.equal(a, b, 'Correr: node scripts/sync-core-stats.mjs');
});

test('dados de exemplo não entram em produção: demoData só é importado em modo demo', () => {
  const repo = readFileSync(new URL('../lib/core/repo.ts', import.meta.url), 'utf8');
  const idx = repo.indexOf("import('./demoData')");
  assert.ok(idx > 0);
  assert.ok(repo.lastIndexOf('if (IS_DEMO)', idx) > repo.indexOf('export async function loadCore'));
  assert.ok(/!process\.env\.NEXT_PUBLIC_SUPABASE_URL \|\| !process\.env\.NEXT_PUBLIC_SUPABASE_ANON_KEY\)\) \{ const m = await import\('\.\/demoData'\)/.test(repo), 'import guardado por process.env literal (eliminado em produção)');
  assert.ok(!/from '\.\/demoData'/.test(repo));
});
