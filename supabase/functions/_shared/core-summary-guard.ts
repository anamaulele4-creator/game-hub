// TXAPILOG AI CORE · guarda do resumo gerado por IA (sem dependências; testado em tests/core-stats.test.mjs).
// A resposta só é aceite se cada frase citar factos existentes [F1]… e não trouxer números que não estejam nos factos.
/** Rejeita a resposta se citar factos inexistentes, tiver frases sem citação ou números que não estão nos factos. */
export function validateSummary(text: string, facts: string[]): { ok: boolean; cited: number[]; reason?: string } {
  const cited = [...text.matchAll(/\[F(\d+)\]/g)].map((m) => Number(m[1]));
  if (!cited.length) return { ok: false, cited, reason: 'sem citações' };
  if (cited.some((n) => n < 1 || n > facts.length)) return { ok: false, cited, reason: 'citação inexistente' };
  const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-ZÀ-Ú])/).filter((s) => s.trim().length > 12);
  if (sentences.some((s) => !/\[F\d+\]/.test(s))) return { ok: false, cited, reason: 'frase sem citação' };
  const norm = (s: string) => s.replace(/\[F\d+\]/g, '').replace(/(\d)\.(\d{3})/g, '$1$2').replace(/,/g, '.');
  const allowed = new Set((norm(facts.join(' ')).match(/\d+(?:\.\d+)?/g) ?? []).map(Number));
  const used = (norm(text).match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  const bad = used.filter((n) => !allowed.has(n));
  if (bad.length) return { ok: false, cited, reason: `números não presentes nos factos: ${bad.slice(0, 5).join(', ')}` };
  return { ok: true, cited: [...new Set(cited)] };
}

