// TXAPILOG AI CORE · Edge Function "core-ai" (Supabase / Deno)
// Resumo com IA de um jogador ou equipa, construído APENAS a partir de linhas reais das tabelas core_*.
//   1) verifica a sessão (JWT) e o papel (admin / moderador / organizador) com public.core_role;
//   2) limita pedidos na BD (public.core_rate_limit: 20/hora por utilizador, 300/dia no total);
//   3) lê as linhas no servidor (o cliente só envia o id — não pode injetar dados);
//   4) calcula os factos com os MESMOS cálculos do painel (_shared/core-stats.ts);
//   5) pede ao LLM (Gemini → Groq) que reformule SÓ esses factos, citando [F1], [F2]…;
//   6) valida a resposta: todas as frases citam factos existentes e nenhum número novo aparece.
//      Se falhar → devolve o relatório determinístico (generator = "deterministico").
//   7) guarda em core_ai_reports (sources = ids das linhas citadas, confidence).
//
// Deploy:   supabase functions deploy core-ai --no-verify-jwt   (a função verifica o JWT)
// Segredos: GEMINI_API_KEY (ou GROQ_API_KEY) — os mesmos do coach-ai; opcional ALLOWED_ORIGINS
// SQL:      supabase/migrations/2026-10-09-ai-core.sql
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { detectAnomalies, playerReport, teamStats, type CoreData, type ReportLine } from '../_shared/core-stats.ts';
import { validateSummary } from '../_shared/core-summary-guard.ts';

const DEFAULT_ORIGINS = ['https://anamaulele4-creator.github.io', 'http://localhost:3000'];
const ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const ALLOWED = ORIGINS.length ? ORIGINS : DEFAULT_ORIGINS;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function corsFor(req: Request): Record<string, string> {
  const o = req.headers.get('origin') ?? '';
  return {
    'access-control-allow-origin': ALLOWED.includes(o) ? o : ALLOWED[0],
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    vary: 'Origin',
  };
}

const SYSTEM = `És o motor de análise do TXAPILOG AI CORE (Free Fire, Moçambique).
Recebes uma lista de FACTOS numerados [F1], [F2]… calculados a partir de registos reais.
Escreve um resumo curto (máx. 120 palavras) em português de Moçambique para a equipa de moderação.
Regras OBRIGATÓRIAS:
- Usa APENAS os factos dados. Não acrescentes partidas, abates, vitórias, médias, percentagens, datas nem nomes que não estejam nos factos.
- Não faças cálculos novos; copia os números exatamente como aparecem.
- Cada frase termina com a citação do(s) facto(s) usado(s), ex.: "... [F2]".
- Se algo for "indisponível" nos factos, diz que está indisponível. Nunca estimes.
- Sinais de anomalia são para revisão humana: não acuses ninguém de batota.`;

type Gen = { text: string; generator: string };
async function callGemini(key: string, model: string, prompt: string): Promise<Gen> {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 400, ...(model.startsWith('gemini-2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {}) } }),
  });
  if (!r.ok) throw new Error(`gemini ${r.status}`);
  const j = await r.json();
  const text = (j?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('').trim();
  if (!text) throw new Error('vazio');
  return { text, generator: `gemini:${model}` };
}
async function callGroq(key: string, model: string, prompt: string): Promise<Gen> {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ model, temperature: 0.1, max_tokens: 400, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }] }),
  });
  if (!r.ok) throw new Error(`groq ${r.status}`);
  const text = String((await r.json())?.choices?.[0]?.message?.content ?? '').trim();
  if (!text) throw new Error('vazio');
  return { text, generator: `groq:${model}` };
}

// deno-lint-ignore no-explicit-any
async function loadAll(admin: any): Promise<CoreData> {
  const q = async (t: string, sel: string, lim = 10000) => { const { data, error } = await admin.from(t).select(sel).limit(lim); if (error) throw new Error(`${t}: ${error.message}`); return data ?? []; };
  const [players, externalIds, verifications, teams, members, tournaments, tournamentTeams, matches, participations, results] = await Promise.all([
    q('core_players', 'id,user_id,nickname,country,status,created_at'),
    q('core_external_ids', 'id,player_id,game,external_id,region,status,source,created_at'),
    q('core_player_verifications', 'player_id,method,verified_at'),
    q('core_teams', 'id,name,tag,kind,captain_player_id,created_at'),
    q('core_team_members', 'team_id,player_id,role,joined_at,left_at'),
    q('core_tournaments', 'id,name,mode,region,status,starts_at,ends_at,organizer_id,created_at'),
    q('core_tournament_teams', 'tournament_id,team_id'),
    q('core_matches', 'id,tournament_id,round_label,map,mode,played_at,source,validation_status'),
    q('core_match_participants', 'id,match_id,player_id,team_id,kills,damage,assists,placement,survived_seconds,source,validation_status,created_at', 20000),
    q('core_results', 'id,match_id,team_id,placement,kills_total,points,source,validation_status,created_at'),
  ]);
  return { players, externalIds, verifications, teams, members, tournaments, tournamentTeams, matches, participations, results } as unknown as CoreData;
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...cors, 'content-type': 'application/json; charset=utf-8' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const gemini = Deno.env.get('GEMINI_API_KEY') ?? '', groq = Deno.env.get('GROQ_API_KEY') ?? '';
  if (req.method === 'GET') return json({ ok: true, configured: !!(gemini || groq) });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método não suportado' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: u } = token ? await admin.auth.getUser(token) : { data: { user: null } };
  if (!u?.user) return json({ ok: false, error: 'Sessão inválida.' }, 401);
  const uid = u.user.id;
  const { data: role } = await admin.rpc('core_role', { p_uid: uid });
  if (!['admin', 'moderador', 'organizador'].includes(String(role))) return json({ ok: false, error: 'Sem permissão.' }, 403);

  const body = await req.json().catch(() => ({}));
  const scope = body?.scope === 'team' ? 'team' : body?.scope === 'player' ? 'player' : null;
  const id = String(body?.id ?? '');
  if (!scope || !UUID.test(id)) return json({ ok: false, error: 'Pedido inválido.' }, 400);

  const [{ data: okUser }, { data: okGlobal }] = await Promise.all([
    admin.rpc('core_rate_limit', { p_key: 'ai:' + uid, p_max: 20, p_window_seconds: 3600 }),
    admin.rpc('core_rate_limit', { p_key: 'ai:global', p_max: 300, p_window_seconds: 86400 }),
  ]);
  if (okUser === false || okGlobal === false) return json({ ok: false, error: 'Limite de resumos atingido. Tenta mais tarde.' }, 429);

  let d: CoreData;
  try { d = await loadAll(admin); } catch (e) { return json({ ok: false, error: 'Base de dados: ' + (e as Error).message }, 500); }

  let lines: ReportLine[] = []; let confidence: 'alta' | 'media' | 'baixa' | 'indisponivel' = 'indisponivel';
  if (scope === 'player') {
    const p = d.players.find((x) => x.id === id);
    if (!p) return json({ ok: false, error: 'Jogador não encontrado.' }, 404);
    const r = playerReport(p, d); lines = r.lines; confidence = r.confidence.level;
  } else {
    const t = d.teams.find((x) => x.id === id);
    if (!t) return json({ ok: false, error: 'Equipa não encontrada.' }, 404);
    const s = teamStats(t.id, d.results, d.members);
    const rs = d.results.filter((r) => r.team_id === t.id && r.validation_status !== 'rejeitado').map((r) => r.id);
    const memberIds = new Set(d.members.filter((m) => m.team_id === t.id && !m.left_at).map((m) => m.player_id));
    const an = detectAnomalies(d).filter((a) => a.entity_id === t.id || rs.includes(a.entity_id) || memberIds.has(a.entity_id));
    lines = !s.matches ? [{ text: `${t.name}: resultados indisponíveis — nenhum resultado registado.`, evidence: [] }] : [
      { text: `${t.name} (${t.kind}) tem ${s.matches} resultado(s) registados, ${s.verified} verificado(s), e ${s.activeMembers} membro(s) ativos.`, evidence: rs },
      { text: `Vitórias: ${s.wins}; posição média ${s.avgPlacement}; ${s.kills} abates; pontos: ${s.points ?? 'indisponível'}.`, evidence: rs },
      ...(an.length ? [{ text: `Há ${an.length} sinal(is) para revisão humana: ${an.map((a) => a.title).join('; ')}.`, evidence: an.flatMap((a) => a.evidence) }] : []),
    ];
    confidence = !s.matches ? 'indisponivel' : s.verified >= 10 && s.verified / s.matches >= 0.8 ? 'alta' : s.verified >= 3 ? 'media' : 'baixa';
  }

  const facts = lines.map((l) => l.text);
  const deterministic = facts.map((f, i) => `${f} [F${i + 1}]`).join(' ');
  let out: Gen = { text: deterministic, generator: 'deterministico' };
  let cited = facts.map((_, i) => i + 1);
  let note: string | undefined;

  if ((gemini || groq) && lines.some((l) => l.evidence.length)) {
    const prompt = 'FACTOS:\n' + facts.map((f, i) => `[F${i + 1}] ${f}`).join('\n') + '\n\nEscreve o resumo.';
    const plan: (() => Promise<Gen>)[] = [];
    if (gemini) for (const m of ['gemini-2.5-flash', 'gemini-2.0-flash']) plan.push(() => callGemini(gemini, m, prompt));
    if (groq) plan.push(() => callGroq(groq, 'llama-3.3-70b-versatile', prompt));
    for (const step of plan) {
      try {
        const g = await step();
        const v = validateSummary(g.text, facts);
        if (v.ok) { out = g; cited = v.cited; note = undefined; break; }
        note = `Resposta da IA descartada (${v.reason}); mostrado o relatório determinístico.`;
      } catch (e) { note = `IA indisponível (${(e as Error).message}); mostrado o relatório determinístico.`; }
    }
  } else if (!(gemini || groq)) note = 'IA generativa não configurada; mostrado o relatório determinístico.';

  const sources = [...new Set(cited.flatMap((n) => lines[n - 1]?.evidence ?? []))].slice(0, 500);
  await admin.from('core_ai_reports').insert({ scope, subject_id: id, kind: 'resumo', content: out.text.slice(0, 8000), sources, confidence, generator: out.generator.toLowerCase().replace(/[^a-z0-9_.:-]/g, '-').slice(0, 60), created_by: uid });
  return json({ ok: true, text: note ? `${out.text}\n\n— ${note}` : out.text, citations: sources, confidence, generator: out.generator, facts });
});
