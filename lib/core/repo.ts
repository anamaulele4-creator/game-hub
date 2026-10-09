// TXAPILOG AI CORE · acesso a dados (Supabase com RLS) e ações.
// Produção: só lê o que existe nas tabelas core_* (sem nada inventado). Se a migração ainda não correu,
// devolve missingMigration = true e a interface mostra o que falta fazer.
// Demo (NEXT_PUBLIC_DEMO=1): "Dados de exemplo" claramente identificados, guardados só em memória.
import { IS_DEMO, SUPABASE_URL } from '@/lib/config';
import type { CoreData, CoreRole } from './stats';
import type { Anomaly } from './stats';
import type { CoverResult } from '@/lib/coverImage';
import { isMissingColumnError } from '@/lib/cover';

export interface CoreAlert { id: string; kind: string; severity: 'baixa' | 'media' | 'alta'; title: string; detail: string | null; entity_type: string | null; entity_id: string | null; evidence: string[]; origin: 'motor_ia' | 'sistema' | 'utilizador'; status: 'aberto' | 'em_revisao' | 'resolvido' | 'descartado'; created_at: string }
export interface CoreReport { id: string; scope: 'player' | 'team' | 'tournament' | 'global'; subject_id: string | null; kind: string; content: string; sources: string[]; confidence: 'alta' | 'media' | 'baixa' | 'indisponivel'; generator: string; created_at: string }
export interface CoreIntegrationRow { id: string; name: string; kind: 'oficial' | 'autorizado' | 'txapilog'; enabled: boolean; status: string; detail: string | null; last_sync_at: string | null }
export interface CoreAudit { id: number; actor_id: string | null; actor_label?: string; actor_role: string | null; action: string; table_name: string; row_id: string | null; created_at: string }
export interface CoreRoleRow { user_id: string; handle: string; role: CoreRole; created_at: string }

export interface CoreBundle {
  mode: 'real' | 'demo';
  data: CoreData;
  alerts: CoreAlert[]; reports: CoreReport[]; integrations: CoreIntegrationRow[]; audit: CoreAudit[]; roles: CoreRoleRow[];
  myRole: CoreRole | null;
  loadedAt: number;
  missingMigration: boolean;
  errors: string[];
}

export const EMPTY_DATA: CoreData = { players: [], externalIds: [], verifications: [], teams: [], members: [], tournaments: [], tournamentTeams: [], matches: [], participations: [], results: [] };

let demoState: Omit<CoreBundle, 'mode' | 'myRole' | 'loadedAt' | 'missingMigration' | 'errors'> | null = null;

const isMissing = (e: { code?: string; message?: string } | null) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202' || /does not exist|Could not find the (table|function)/i.test(e.message ?? ''));

export async function loadCore(fallbackRole: CoreRole | null): Promise<CoreBundle> {
  if (IS_DEMO) {
    // Condição escrita com process.env literal: o webpack elimina este ramo (e o ficheiro de exemplo) nas builds de produção.
    if (!demoState && (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) { const m = await import('./demoData'); demoState = m.demoCore(); }
    if (!demoState) throw new Error('Dados de exemplo indisponíveis.');
    return { mode: 'demo', ...demoState, myRole: 'admin', loadedAt: Date.now(), missingMigration: false, errors: [] };
  }
  const { sb } = await import('@/lib/supabase');
  const c = await sb();
  const errors: string[] = [];
  let missing = false;
  const roleRes = await c.rpc('core_my_role');
  if (roleRes.error && isMissing(roleRes.error)) missing = true;
  const myRole = (roleRes.data as CoreRole | null) ?? fallbackRole;
  if (missing) return { mode: 'real', data: EMPTY_DATA, alerts: [], reports: [], integrations: [], audit: [], roles: [], myRole, loadedAt: Date.now(), missingMigration: true, errors };
  const staff = myRole === 'admin' || myRole === 'moderador' || myRole === 'organizador';
  const q = async <T,>(table: string, select: string, opts?: { order?: string; limit?: number; skip?: boolean }): Promise<T[]> => {
    if (opts?.skip) return [];
    let b = c.from(table).select(select);
    if (opts?.order) b = b.order(opts.order, { ascending: false });
    const { data, error } = await b.limit(opts?.limit ?? 2000);
    if (error) { if (isMissing(error)) missing = true; else errors.push(`${table}: ${error.message}`); return []; }
    return (data ?? []) as T[];
  };
  const [players, externalIds, verifications, teams, members, tournaments, tournamentTeams, matches, participations, results, alerts, reports, integrations, audit, roleRows] = await Promise.all([
    q<CoreData['players'][number]>('core_players', 'id,user_id,nickname,country,status,created_at'),
    q<CoreData['externalIds'][number]>('core_external_ids', 'id,player_id,game,external_id,region,status,source,created_at'),
    q<CoreData['verifications'][number]>('core_player_verifications', 'player_id,method,verified_at'),
    q<CoreData['teams'][number]>('core_teams', 'id,name,tag,kind,captain_player_id,created_at'),
    q<CoreData['members'][number]>('core_team_members', 'team_id,player_id,role,joined_at,left_at'),
    q<CoreData['tournaments'][number]>('core_tournaments', '*', { order: 'created_at' }),
    q<CoreData['tournamentTeams'][number]>('core_tournament_teams', 'tournament_id,team_id'),
    q<CoreData['matches'][number]>('core_matches', 'id,tournament_id,round_label,map,mode,played_at,source,validation_status', { order: 'played_at', limit: 3000 }),
    q<CoreData['participations'][number]>('core_match_participants', 'id,match_id,player_id,team_id,kills,damage,assists,placement,survived_seconds,source,validation_status,rejection_reason,created_at', { order: 'created_at', limit: 10000 }),
    q<CoreData['results'][number]>('core_results', 'id,match_id,team_id,placement,kills_total,points,source,validation_status,rejection_reason,created_at', { order: 'created_at', limit: 5000 }),
    q<CoreAlert>('core_alerts', 'id,kind,severity,title,detail,entity_type,entity_id,evidence,origin,status,created_at', { order: 'created_at', limit: 500, skip: !staff }),
    q<CoreReport>('core_ai_reports', 'id,scope,subject_id,kind,content,sources,confidence,generator,created_at', { order: 'created_at', limit: 100, skip: !staff }),
    q<CoreIntegrationRow>('core_integrations', 'id,name,kind,enabled,status,detail,last_sync_at', { skip: !staff }),
    q<CoreAudit>('core_audit_logs', 'id,actor_id,actor_role,action,table_name,row_id,created_at', { order: 'id', limit: 300, skip: myRole !== 'admin' }),
    q<{ user_id: string; role: CoreRole; created_at: string }>('core_user_roles', 'user_id,role,created_at', { skip: myRole !== 'admin' && myRole !== 'moderador' }),
  ]);
  // @handles para papéis e auditoria (profiles é legível)
  const ids = [...new Set([...roleRows.map((r) => r.user_id), ...audit.map((a) => a.actor_id).filter(Boolean) as string[]])];
  const handles = new Map<string, string>();
  if (ids.length) {
    const { data } = await c.from('profiles').select('id,handle').in('id', ids.slice(0, 500));
    for (const p of (data ?? []) as { id: string; handle: string }[]) handles.set(p.id, p.handle);
  }
  return {
    mode: 'real',
    data: { players, externalIds, verifications, teams, members, tournaments, tournamentTeams, matches, participations, results },
    alerts, reports, integrations,
    audit: audit.map((a) => ({ ...a, actor_label: a.actor_id ? '@' + (handles.get(a.actor_id) ?? a.actor_id.slice(0, 8)) : 'sistema' })),
    roles: roleRows.map((r) => ({ ...r, handle: handles.get(r.user_id) ?? r.user_id.slice(0, 8) })),
    myRole, loadedAt: Date.now(), missingMigration: missing, errors,
  };
}

// ---------- Ações (RLS + triggers decidem no servidor; o cliente só esconde o que não pode) ----------
export type ActionResult = 'ok' | 'demo';

export async function setValidation(kind: 'participacao' | 'resultado', id: string, status: 'verificado' | 'rejeitado', reason?: string): Promise<ActionResult> {
  if (status === 'rejeitado' && !reason?.trim()) throw new Error('Indica o motivo da rejeição.');
  if (IS_DEMO) {
    const d = demoState!.data;
    const list = kind === 'participacao' ? d.participations : d.results;
    const row = list.find((x) => x.id === id); if (row) { row.validation_status = status; row.rejection_reason = reason ?? null; }
    return 'demo';
  }
  const { sb } = await import('@/lib/supabase');
  const { error } = await (await sb()).rpc('core_set_validation', { p_kind: kind, p_id: id, p_status: status, p_reason: reason ?? null });
  if (error) throw new Error(error.message);
  return 'ok';
}

export async function createAlertFromAnomaly(a: Anomaly): Promise<ActionResult> {
  if (IS_DEMO) {
    demoState!.alerts.unshift({ id: 'ex-a' + Date.now(), kind: a.kind, severity: a.severity, title: a.title, detail: a.detail, entity_type: a.entity_type, entity_id: a.entity_id, evidence: a.evidence, origin: 'motor_ia', status: 'aberto', created_at: new Date().toISOString() });
    return 'demo';
  }
  const { sb } = await import('@/lib/supabase');
  const { error } = await (await sb()).from('core_alerts').insert({ kind: a.kind, severity: a.severity, title: a.title.slice(0, 140), detail: a.detail.slice(0, 2000), entity_type: a.entity_type, entity_id: a.entity_id.slice(0, 64), evidence: a.evidence.slice(0, 50), origin: 'motor_ia' });
  if (error) throw new Error(error.code === '23505' ? 'Já existe um alerta aberto para isto.' : error.message);
  return 'ok';
}

export async function setAlertStatus(id: string, status: CoreAlert['status']): Promise<ActionResult> {
  if (IS_DEMO) { const a = demoState!.alerts.find((x) => x.id === id); if (a) a.status = status; return 'demo'; }
  const { sb } = await import('@/lib/supabase');
  const { error } = await (await sb()).from('core_alerts').update({ status }).eq('id', id);
  if (error) throw new Error(error.message);
  return 'ok';
}

export async function setRole(handle: string, role: CoreRole): Promise<ActionResult> {
  const h = handle.trim().replace(/^@/, '');
  if (!/^[a-z0-9_.]{3,30}$/i.test(h)) throw new Error('@username inválido.');
  if (IS_DEMO) {
    const r = demoState!.roles.find((x) => x.handle === h);
    if (r) r.role = role; else demoState!.roles.push({ user_id: 'ex-u' + Date.now(), handle: h, role, created_at: new Date().toISOString() });
    return 'demo';
  }
  const { sb } = await import('@/lib/supabase');
  const { error } = await (await sb()).rpc('core_set_role', { p_handle: h, p_role: role });
  if (error) throw new Error(error.message);
  return 'ok';
}

export async function registerPlayer(nickname: string, externalId: string, region: string): Promise<ActionResult> {
  const { isValidFreeFireId } = await import('./stats');
  const nick = nickname.trim();
  if (nick.length < 2 || nick.length > 32) throw new Error('Nickname: 2 a 32 caracteres.');
  if (!isValidFreeFireId(externalId)) throw new Error('ID Free Fire: só números, 6 a 13 dígitos.');
  if (!/^[A-Z]{2,4}$/.test(region)) throw new Error('Região inválida.');
  if (IS_DEMO) {
    const id = 'ex-p' + Date.now();
    demoState!.data.players.push({ id, user_id: null, nickname: nick, country: 'MZ', status: 'ativo', created_at: new Date().toISOString() });
    demoState!.data.externalIds.push({ id: 'ex-x' + Date.now(), player_id: id, game: 'free_fire', external_id: externalId.trim(), region, status: 'pendente', source: 'torneio_txapilog', created_at: new Date().toISOString() });
    return 'demo';
  }
  const { sb } = await import('@/lib/supabase');
  const c = await sb();
  const { data, error } = await c.from('core_players').insert({ nickname: nick }).select('id').single();
  if (error) throw new Error(error.message);
  const { error: e2 } = await c.from('core_external_ids').insert({ player_id: data.id, external_id: externalId.trim(), region, source: 'torneio_txapilog' });
  if (e2) throw new Error(e2.message);
  return 'ok';
}

export async function createTournament(name: string, mode: 'solo' | 'duo' | 'squad', startsAt: string | null, cover?: CoverResult | null): Promise<ActionResult> {
  const n = name.trim();
  if (n.length < 3 || n.length > 80) throw new Error('Nome: 3 a 80 caracteres.');
  if (IS_DEMO) {
    demoState!.data.tournaments.unshift({ id: 'ex-c' + Date.now(), name: n, mode, region: 'AF', status: 'rascunho', starts_at: startsAt, ends_at: null, organizer_id: null, created_at: new Date().toISOString(), cover_url: cover?.dataUrl ?? null });
    return 'demo';
  }
  const { sb } = await import('@/lib/supabase');
  const c = await sb();
  const { data: u } = await c.auth.getUser();
  const { data, error } = await c.from('core_tournaments').insert({ name: n, mode, starts_at: startsAt, organizer_id: u.user?.id }).select('id').single();
  if (error) throw new Error(error.message);
  if (cover && data?.id) {
    // A capa é opcional: se o envio ou a coluna falharem, o torneio fica criado na mesma (com a capa do jogo).
    try {
      const { saveCover } = await import('@/lib/coverImage');
      const url = await saveCover('core-' + data.id, cover);
      const { error: e2 } = await c.from('core_tournaments').update({ cover_url: url }).eq('id', data.id);
      if (e2) throw new Error(isMissingColumnError(e2.message, 'cover_url') ? 'Torneio criado, mas a imagem não ficou gravada: corre o SQL supabase/migrations/2026-10-10_tournament_cover.sql.' : 'Torneio criado, mas não foi possível gravar a imagem.');
    } catch (e) { throw new Error((e as Error).message.startsWith('Torneio criado') ? (e as Error).message : 'Torneio criado, mas a imagem não foi enviada: ' + (e as Error).message); }
  }
  return 'ok';
}

export async function createTeam(name: string, kind: 'duo' | 'squad', tag: string): Promise<ActionResult> {
  const n = name.trim();
  if (n.length < 2 || n.length > 40) throw new Error('Nome: 2 a 40 caracteres.');
  if (tag && !/^[A-Za-z0-9]{2,6}$/.test(tag)) throw new Error('Tag: 2 a 6 letras/números.');
  if (IS_DEMO) { demoState!.data.teams.push({ id: 'ex-t' + Date.now(), name: n, tag: tag || null, kind, captain_player_id: null, created_at: new Date().toISOString() }); return 'demo'; }
  const { sb } = await import('@/lib/supabase');
  const { error } = await (await sb()).from('core_teams').insert({ name: n, kind, tag: tag || null });
  if (error) throw new Error(error.message);
  return 'ok';
}

/** Resumo com IA (Edge Function core-ai). Recebe só ids; a função lê as linhas reais no servidor. */
export async function requestAiSummary(scope: 'player' | 'team', id: string): Promise<{ ok: boolean; text?: string; citations?: string[]; confidence?: string; generator?: string; error?: string; notDeployed?: boolean }> {
  if (IS_DEMO) return { ok: false, error: 'Dados de exemplo: o resumo com IA só corre em produção. A mostrar o relatório determinístico.' };
  const { sb } = await import('@/lib/supabase');
  const c = await sb();
  const { data: s } = await c.auth.getSession();
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/core-ai`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${s.session?.access_token ?? ''}` },
      body: JSON.stringify({ scope, id }), signal: AbortSignal.timeout(50_000),
    });
    if (res.status === 404) return { ok: false, notDeployed: true, error: 'Função core-ai ainda não publicada. A mostrar o relatório determinístico.' };
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) return { ok: false, error: j.error ?? `Erro ${res.status}` };
    return { ok: true, text: j.text, citations: j.citations, confidence: j.confidence, generator: j.generator };
  } catch (e) {
    return { ok: false, notDeployed: true, error: 'Não foi possível contactar a função core-ai (' + ((e as Error).name === 'TimeoutError' ? 'tempo esgotado' : 'rede/CORS') + '). A mostrar o relatório determinístico.' };
  }
}
