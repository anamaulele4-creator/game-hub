// POIPAK IA — inteligência própria da plataforma: regras locais, funciona offline e sem custos (sem APIs pagas).
// Faz: auto-reparação (verificação de saúde), moderação antes de publicar, bem-estar e ajuda aos utilizadores.
import { IS_DEMO, MAX_UPLOAD_MB, SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

export const AI_NAME = 'POIPAK IA';
export const AI_VERSION = '2.0';
export const AI_PLAN = 'Plano Grátis';
export const AI_LABEL = `${AI_NAME} v${AI_VERSION} · ${AI_PLAN}`;

export const AI_CAPABILITIES: { icon: string; title: string; desc: string }[] = [
  { icon: '🩺', title: 'Auto-reparação', desc: 'Verifica a ligação ao servidor, renova a sessão, atualiza a app e recupera de erros sozinha. Sem ligação entra em modo seguro.' },
  { icon: '🛡️', title: 'Moderação automática', desc: 'Antes de publicar deteta insultos, palavrões, ameaças, spam de links, publicações repetidas, texto todo em maiúsculas e excesso de hashtags.' },
  { icon: '🧘', title: 'Bem-estar', desc: 'Sugere pausas depois de ~45 min seguidos, lembra-te de descansar depois das 23:00 e ajuda a escrever com respeito.' },
  { icon: '💬', title: 'Assistente', desc: 'Responde a dúvidas sobre publicar, memes, som, entrar na conta, limites e privacidade — mesmo sem internet.' },
  { icon: '🎮', title: 'Coach de jogo', desc: 'Dicas de armas, treino e estratégia por regras próprias. Usa IA avançada só quando a administração a ativa.' },
];
export const AI_FUTURE: string[] = [
  'Chat avançado com IA (Gemini) sem limites diários',
  'Análise automática dos teus vídeos: melhores jogadas e erros',
  'Legendas e títulos sugeridos para clipes e memes',
  'Moderação de imagens e vídeos',
  'Planos de treino personalizados semanais',
];

// ---------- Estatísticas locais (para o painel) ----------
const STATS_KEY = 'gh-ai-stats';
export interface AiStats { autoFixes: number; modBlocks: number; modWarnings: number; healthChecks: number; lastHealth?: Health; safeMode?: boolean }
export function aiStats(): AiStats {
  try { return { autoFixes: 0, modBlocks: 0, modWarnings: 0, healthChecks: 0, ...JSON.parse(localStorage.getItem(STATS_KEY) || '{}') }; } catch { return { autoFixes: 0, modBlocks: 0, modWarnings: 0, healthChecks: 0 }; }
}
function bump(patch: (s: AiStats) => Partial<AiStats>) {
  try { const s = aiStats(); localStorage.setItem(STATS_KEY, JSON.stringify({ ...s, ...patch(s) })); } catch {}
}
export const countAutoFix = () => bump((s) => ({ autoFixes: s.autoFixes + 1 }));

// ---------- Moderação ----------
const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[@4]/g, 'a').replace(/3/g, 'e').replace(/[1!|]/g, 'i').replace(/0/g, 'o').replace(/\$|5/g, 's').replace(/7/g, 't')
  .replace(/(.)\1+/g, '$1');
const words = (t: string) => norm(t).split(/[^a-z]+/).filter(Boolean);

/** Abuso claro → bloqueia. */
// Nota: as listas passam pela mesma normalização (sem acentos, letras repetidas reduzidas a uma).
const BLOCK_WORDS = ['caralho', 'caralhos', 'foda', 'fodase', 'foder', 'fodido', 'fodida', 'puta', 'putas', 'putaria', 'cona', 'conas', 'buceta', 'piroca', 'cabrao', 'cabroes', 'viado', 'paneleiro', 'fdp', 'pqp', 'vsf', 'xiconhoca', 'preto imundo', 'macaco nojento'];
const BLOCK_PHRASES = ['filho da puta', 'filha da puta', 'vai te foder', 'vai-te foder', 'vai a merda', 'vou te matar', 'vou-te matar', 'te mato', 'mata-te', 'matate', 'se mata', 'vai morrer', 'nudes', 'manda nude', 'diamantes gratis', 'diamante gratis', 'gerador de diamantes', 'ganha dinheiro facil', 'clica no link', 'hack free fire', 'conta gratis'];
/** Linguagem rude → avisa com gentileza (não bloqueia). */
const WARN_WORDS = ['merda', 'pora', 'idiota', 'idiotas', 'buro', 'bura', 'estupido', 'estupida', 'otario', 'otaria', 'imbecil', 'cretino', 'parvo', 'parva', 'lixo', 'nob', 'nub', 'mongo', 'atrasado', 'palhaco', 'cala-te', 'cala a boca', 'cagar', 'bosta'];

export interface ModResult { level: 'ok' | 'warn' | 'block'; reasons: string[]; tip?: string }
const RECENT_KEY = 'gh-ai-recent-posts';

export function moderate(text: string, opts: { tags?: string[]; allowCaps?: boolean; checkRepeat?: boolean } = {}): ModResult {
  const raw = (text || '').trim();
  const n = norm(raw);
  const w = words(raw);
  const block: string[] = [], warn: string[] = [];
  const hit = (list: string[]) => list.map(norm).filter((x) => (x.includes(' ') || x.includes('-') ? n.includes(x) : w.includes(x)));
  const bw = [...hit(BLOCK_WORDS), ...BLOCK_PHRASES.map(norm).filter((p) => n.includes(p))];
  if (bw.length) block.push('linguagem ofensiva, ameaça ou burla');
  const ww = hit(WARN_WORDS);
  if (ww.length) warn.push('linguagem rude');
  const links = (raw.match(/(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|xyz|ly|me|co|io|site|online)\b/gi) || []).length;
  if (links >= 3) block.push('demasiados links (spam)'); else if (links === 2) warn.push('vários links');
  if (/(\+?258)?\s?8[2-7]\s?\d{3}\s?\d{4}/.test(raw) && /gratis|grátis|promo|ganha|whats/i.test(raw)) block.push('possível burla com número de telefone');
  const letters = raw.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (!opts.allowCaps && letters.length >= 12 && letters.replace(/[^A-ZÀ-Þ]/g, '').length / letters.length > 0.75) warn.push('texto todo em maiúsculas (parece gritar)');
  const hashtags = (raw.match(/#[\p{L}\p{N}_]+/gu) || []).length + (opts.tags?.length ?? 0);
  if (hashtags > 15) block.push('hashtags em excesso (spam)'); else if (hashtags > 8) warn.push('muitas hashtags');
  if (/(.)\1{7,}/.test(raw) || /(\b\w+\b)(\s+\1\b){4,}/i.test(raw)) warn.push('texto repetido');
  if (opts.checkRepeat && raw.length >= 8) {
    try {
      const recent: { t: string; at: number }[] = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      if (recent.some((r) => r.t === n && Date.now() - r.at < 24 * 3600_000)) block.push('já publicaste isto nas últimas 24 h');
    } catch {}
  }
  if (block.length) return { level: 'block', reasons: block, tip: 'A POIPAK IA não deixa publicar isto. Reescreve sem ofensas, ameaças ou spam — a comunidade agradece 💙' };
  if (warn.length) return { level: 'warn', reasons: warn, tip: toneTip(warn) };
  return { level: 'ok', reasons: [] };
}

function toneTip(reasons: string[]) {
  if (reasons.includes('linguagem rude')) return 'Dica: dá para dizer o mesmo sem palavras rudes. Ex.: "jogaste mal" → "na próxima vais conseguir 💪".';
  if (reasons.some((r) => r.includes('maiúsculas'))) return 'Dica: escrever tudo em maiúsculas parece gritar. Experimenta só a primeira letra.';
  if (reasons.some((r) => r.includes('hashtags'))) return 'Dica: 3 a 5 hashtags chegam para ser encontrado.';
  return 'Dica: textos curtos e claros chegam a mais pessoas.';
}

/** Regista a decisão: conta no painel e, se bloqueou, avisa a administração (system_errors, sem SQL novo). */
export function recordModeration(r: ModResult, where: string, text: string) {
  if (r.level === 'ok') return;
  bump((s) => (r.level === 'block' ? { modBlocks: s.modBlocks + 1 } : { modWarnings: s.modWarnings + 1 }));
  if (r.level === 'block') {
    void import('./systemErrors').then((m) => m.logSystemError({ message: `[${AI_NAME} · moderação] bloqueado em ${where}: ${r.reasons.join(', ')} · "${text.slice(0, 80)}"` }, { auto_fixed: true })).catch(() => {});
  }
}
/** Memoriza a publicação feita (para detetar repetições). */
export function rememberPost(text: string) {
  try {
    const n = norm(text.trim()); if (n.length < 8) return;
    const recent: { t: string; at: number }[] = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    localStorage.setItem(RECENT_KEY, JSON.stringify([{ t: n, at: Date.now() }, ...recent].slice(0, 20)));
  } catch {}
}

// ---------- Auto-reparação: verificação de saúde ----------
export interface Health { at: number; online: boolean; server: 'ok' | 'lento' | 'falha' | 'demo'; ms?: number; storage: boolean; session: 'ok' | 'renovada' | 'sem sessão' | 'falha' | 'demo'; sw: 'atualizado' | 'sem SW' | 'falha'; safeMode: boolean }
let fails = 0;

async function timedFetch(url: string, ms: number, init?: RequestInit) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  const t0 = performance.now();
  try { const r = await fetch(url, { ...init, signal: ac.signal, cache: 'no-store' }); return { ok: r.ok || r.status < 500, ms: Math.round(performance.now() - t0) }; }
  catch { return { ok: false, ms: Math.round(performance.now() - t0) }; } finally { clearTimeout(t); }
}

export async function checkHealth(): Promise<Health> {
  const h: Health = { at: Date.now(), online: typeof navigator === 'undefined' ? true : navigator.onLine, server: 'demo', storage: false, session: 'demo', sw: 'sem SW', safeMode: false };
  try { localStorage.setItem('gh-ai-probe', '1'); localStorage.removeItem('gh-ai-probe'); h.storage = true; } catch {}
  if (!IS_DEMO) {
    const r = h.online ? await timedFetch(`${SUPABASE_URL}/auth/v1/health`, 8000, { headers: { apikey: SUPABASE_ANON_KEY } }) : { ok: false, ms: 0 };
    h.ms = r.ms; h.server = !r.ok ? 'falha' : r.ms > 3000 ? 'lento' : 'ok';
    const wasDown = fails >= 1;
    fails = r.ok ? 0 : fails + 1;
    if (r.ok && wasDown) { countAutoFix(); try { window.dispatchEvent(new Event('poipak:reconnected')); } catch {} } // volta a ler os dados
    if (r.ok) {
      try {
        const { sb } = await import('./supabase');
        const c = await sb();
        const { data } = await c.auth.getSession();
        if (!data.session) h.session = 'sem sessão';
        else if ((data.session.expires_at ?? 0) * 1000 - Date.now() < 10 * 60_000) { const x = await c.auth.refreshSession(); h.session = x.error ? 'falha' : 'renovada'; if (!x.error) countAutoFix(); }
        else h.session = 'ok';
      } catch { h.session = 'falha'; }
    } else h.session = 'falha';
  }
  try {
    if ('serviceWorker' in navigator) { const reg = await navigator.serviceWorker.getRegistration(); if (reg) { await reg.update(); h.sw = 'atualizado'; } }
  } catch { h.sw = 'falha'; }
  h.safeMode = !IS_DEMO && fails >= 2; // 2 falhas seguidas → modo seguro (mostra o que está guardado, tenta de novo sozinha)
  bump((s) => ({ healthChecks: s.healthChecks + 1, lastHealth: h, safeMode: h.safeMode }));
  return h;
}

// ---------- Assistente (ajuda da plataforma) ----------
const has = (t: string, list: string[]) => list.some((x) => t.includes(x));
/** Resposta de ajuda sobre a plataforma, ou null se a pergunta não for sobre a plataforma. */
export function helpAnswer(question: string): string | null {
  const t = norm(question);
  if (has(t, ['meme'])) return '😂 Memes: toca em ＋ Publicar › Meme. Escolhe uma imagem (ou um fundo de cor), escreve o texto de cima e de baixo e vê a pré-visualização ao vivo. Publica e aparece em Clipes › Memes e no Início.';
  if (has(t, ['video longo', 'videos longos', 'youtube', '2 horas', 'duas horas'])) return `📺 Vídeos longos: ＋ Publicar › Vídeo longo. Envia um ficheiro (até ${MAX_UPLOAD_MB} MB e 2 horas) ou cola um link do YouTube (sem limite de tamanho). Aparecem na área 📺 Vídeos, na horizontal.`;
  if (has(t, ['som', 'audio', 'mudo', 'sem som', 'volume'])) return '🔊 Som: os navegadores começam sem som. Toca uma vez no vídeo e o som fica ligado — e lembramo-nos da tua escolha. Também há o botão 🔇/🔊 do lado direito.';
  if (has(t, ['google', 'entrar', 'login', 'iniciar sessao', 'palavra-passe', 'password', 'senha', 'conta'])) return '🔑 Entrar: usa "Continuar com Google" (o mais rápido) ou, em "Outras opções", email/telemóvel com palavra-passe ou código de 6 dígitos. Esqueceste a palavra-passe? Entrar › Esqueci a palavra-passe.';
  if (has(t, ['limite', 'tamanho', 'mb', 'quanto tempo', 'duracao', 'minutos', 'grande demais'])) return `📏 Limites: clipes até 5 minutos; vídeos longos até 2 horas; ficheiros até ${MAX_UPLOAD_MB} MB no plano atual (para mais, cola um link do YouTube). Há também um limite diário de publicações.`;
  if (has(t, ['privacidade', 'dados', 'apagar conta', 'eliminar conta', 'bloquear', 'seguidores', 'quem ve'])) return '🔒 Privacidade: ao publicar escolhe 🌍 Público ou 👥 Só seguidores. Podes bloquear/denunciar no menu ⋯ de qualquer perfil ou publicação. Para eliminar a conta: Definições › Eliminar conta.';
  if (has(t, ['denunciar', 'denuncia', 'insulto', 'assedio', 'bullying'])) return '🛡️ Denunciar: toca em ⋯ na publicação ou perfil › Denunciar. A POIPAK IA também bloqueia insultos e spam antes de serem publicados. Em perigo real, fala com um adulto de confiança.';
  if (has(t, ['publicar', 'postar', 'enviar video', 'carregar', 'upload', 'clipe'])) return '🎬 Publicar: toca em ＋ no fundo do ecrã. Escolhe Clipe (vertical, até 5 min), Vídeo longo, Meme, Foto ou Momento (texto). Dá um título, escolhe o jogo e quem pode ver. Se a ligação cair, o envio retoma sozinho.';
  if (has(t, ['pausa', 'cansado', 'tempo de ecra', 'dormir', 'noite'])) return '🧘 Bem-estar: a POIPAK IA sugere uma pausa a cada ~45 min e lembra-te de descansar depois das 23:00. Ajusta em Bem-estar.';
  if (has(t, ['erro', 'nao carrega', 'bug', 'lento', 'travou', 'nao funciona'])) return '🩺 A POIPAK IA verifica a ligação a cada poucos minutos e repara sozinha (renova a sessão, atualiza a app, tenta de novo). Se continuar, fecha e abre a app ou vai a Definições › limpar dados.';
  return null;
}
