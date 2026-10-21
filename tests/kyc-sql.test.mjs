// Testes do KYC unificado (supabase/migrations/2026-10-21-kyc-unificado.sql) numa base Postgres real em memória (PGlite).
// RLS (ninguém vê documentos de outros), permissões de revisão (admin / KYC_REVIEW), transições de estado,
// migração dos dados antigos sem perdas e bloqueios existentes a ler o estado unificado. Não toca em bases remotas.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeDb, ROOT } from './sql/mkt3-db.mjs';

const MIG = fs.readFileSync(path.join(ROOT, 'supabase/migrations/2026-10-21-kyc-unificado.sql'), 'utf8');
let h; let skip = false;
const U = {};

async function upload(user, name) {
  await h.asUser(user);
  await h.db.query(`insert into storage.objects (bucket_id, name, owner) values ('verificacoes', $1, $2)`, [`${user}/${name}`, user]);
  return `${user}/${name}`;
}
const f = (p, t, s = 'unico') => ({ path: p, doc_type: t, side: s });
const notes = async (u) => { await h.asService(); return h.q(`select body from notifications where user_id = $1 order by created_at`, [u]); };

before(async () => {
  h = await makeDb();
  if (!h) { skip = true; return; }
  const { db } = h;
  // Ambiente de teste: o Storage real dá estes privilégios ao papel authenticated (as políticas RLS decidem).
  await db.exec(`grant usage on schema storage to authenticated, anon; grant select, insert, delete on storage.objects to authenticated;`);
  for (const [k, role] of [['chefe', 'admin'], ['revisor', 'user'], ['moder', 'moderator'], ['ana', 'user'], ['beto', 'user'], ['velho', 'user'], ['nivel', 'user'], ['apost', 'user']]) U[k] = await h.mk(k, role);
  await h.asService();
  // Dados ANTIGOS (antes do KYC unificado): vendedor aprovado + pedido de nível KYC pendente + KYC das apostas
  await db.query(`insert into seller_verifications (user_id, doc_path, selfie_path, status, submitted_at) values ($1, $2, $3, 'aprovado', now() - interval '3 days')`,
    [U.velho, `${U.velho}/doc-a.webp`, `${U.velho}/selfie-a.webp`]);
  // (o gatilho antigo põe user_id = auth.uid(): inserido com a sessão do utilizador, sem passar pela RLS)
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [U.nivel]);
  await db.query(`insert into kyc_submissions (level, kind, doc_path) values (2, 'documento', $1)`, [`${U.nivel}/bi.jpg`]);
  await h.asService();
  await db.query(`insert into bet_kyc (user_id, full_name, birth_date, id_type, id_number, phone) values ($1, 'Apo Stador', '1990-01-01', 'NUIT', '123456789', '841234567')`, [U.apost]);
  await db.exec(MIG); await db.exec(MIG); // duas vezes = idempotente
});

test('KYC SQL: migração idempotente mantém a verificação antiga (vendedor continua verificado) e o pedido de nível', { skip }, async () => {
  await h.asService();
  const rows = await h.q(`select user_id, purpose, status, source from kyc_requests where legacy_ref is not null order by source`);
  assert.equal(rows.length, 2, 'cada registo antigo uma só vez');
  const v = rows.find((r) => r.user_id === U.velho); assert.equal(v.purpose, 'vendedor'); assert.equal(v.status, 'aprovado'); assert.equal(v.source, 'migrado_vendedor');
  const n = rows.find((r) => r.user_id === U.nivel); assert.equal(n.status, 'pendente'); assert.equal(n.source, 'migrado_kyc');
  assert.equal((await h.q(`select count(*)::int c from kyc_files where user_id = $1`, [U.velho]))[0].c, 2);
  assert.equal((await h.q(`select count(*)::int c from kyc_files where user_id = $1 and bucket = 'kyc-docs'`, [U.nivel]))[0].c, 1);
  assert.equal((await h.q(`select public.seller__verified($1) v`, [U.velho]))[0].v, true);
  assert.equal((await h.q(`select count(*)::int c from seller_verifications`))[0].c, 1, 'tabela antiga intacta');
});

test('KYC SQL: envio valida finalidade, ficheiros e documentos obrigatórios', { skip }, async () => {
  const bi = await upload(U.ana, 'kyc-bi-frente.webp');
  await h.asUser(U.ana);
  assert.equal((await h.rpc('kyc_submit', ['vendedor', JSON.stringify([f(bi, 'bi', 'frente')]), ''])).code, 'NEED_SELFIE');
  assert.equal((await h.rpc('kyc_submit', ['xpto', JSON.stringify([f(bi, 'bi')]), ''])).code, 'PURPOSE');
  assert.equal((await h.rpc('kyc_submit', ['identidade', JSON.stringify([f(`${U.beto}/x.webp`, 'bi')]), ''])).code, 'FILES', 'caminho de outro utilizador');
  assert.equal((await h.rpc('kyc_submit', ['identidade', JSON.stringify([f(`${U.ana}/nao-existe.webp`, 'bi')]), ''])).code, 'FILES_MISSING');
  assert.equal((await h.rpc('kyc_submit', ['identidade', JSON.stringify([f(bi, 'cartao')]), ''])).code, 'DOC_TYPE');
  const verso = await upload(U.ana, 'kyc-bi-verso.webp'); const self = await upload(U.ana, 'kyc-selfie.webp');
  await h.asUser(U.ana);
  const r = await h.rpc('kyc_submit', ['vendedor', JSON.stringify([f(bi, 'bi', 'frente'), f(verso, 'bi', 'verso'), f(self, 'selfie_documento')]), 'para vender contas']);
  assert.equal(r.ok, true); U.req = r.id;
  assert.equal((await h.rpc('kyc_submit', ['identidade', JSON.stringify([f(bi, 'bi')]), ''])).code, 'FILES', 'ficheiro já usado noutro pedido');
  const p2 = await upload(U.ana, 'kyc-passaporte.webp'); const s2 = await upload(U.ana, 'kyc-selfie-2.webp');
  await h.asUser(U.ana);
  assert.equal((await h.rpc('kyc_submit', ['vendedor', JSON.stringify([f(p2, 'passaporte'), f(s2, 'selfie')]), ''])).code, 'OPEN', 'um pedido aberto por finalidade');
  const me = await h.rpc('kyc_me');
  assert.equal(me.requests.length, 1); assert.equal(me.requests[0].files.length, 3); assert.equal(me.verified.vendedor, false);
});

test('KYC SQL (RLS): um utilizador não vê pedidos, ficheiros nem documentos de outro; o revisor vê', { skip }, async () => {
  await h.asUser(U.beto);
  assert.equal((await h.q(`select * from kyc_requests where user_id = $1`, [U.ana])).length, 0);
  assert.equal((await h.q(`select * from kyc_files where user_id = $1`, [U.ana])).length, 0);
  assert.equal((await h.q(`select * from kyc_events where user_id = $1`, [U.ana])).length, 0);
  assert.equal((await h.q(`select * from storage.objects where bucket_id = 'verificacoes' and name like $1`, [U.ana + '/%'])).length, 0, 'sem acesso aos ficheiros');
  assert.equal((await h.q(`select * from storage.objects where bucket_id = 'kyc-docs'`)).length, 0);
  await assert.rejects(h.db.query(`insert into kyc_requests (user_id, purpose) values ($1, 'identidade')`, [U.beto]), /permission denied/);
  await assert.rejects(h.db.query(`update kyc_requests set status = 'aprovado'`), /permission denied/);
  await assert.rejects(h.db.query(`insert into storage.objects (bucket_id, name) values ('verificacoes', $1)`, [U.ana + '/falso.webp']), /row-level security/);
  // o dono vê os seus
  await h.asUser(U.ana);
  assert.equal((await h.q(`select * from storage.objects where bucket_id = 'verificacoes' and name like $1`, [U.ana + '/%'])).length, 5);
  assert.equal((await h.q(`select * from kyc_files`)).length, 3, 'só os próprios');
  // o revisor autorizado vê tudo
  await h.asUser(U.chefe);
  assert.equal((await h.rpc('kyc_admin_grant', [U.revisor, true])).ok, true);
  await h.asUser(U.revisor);
  assert.ok((await h.q(`select * from storage.objects where bucket_id = 'verificacoes' and name like $1`, [U.ana + '/%'])).length === 5);
  assert.ok((await h.q(`select * from kyc_requests`)).length >= 3);
});

test('KYC SQL: só admin e KYC_REVIEW revêem; só o admin dá a permissão', { skip }, async () => {
  for (const u of [U.ana, U.beto, U.moder]) {
    await h.asUser(u);
    assert.equal((await h.rpc('kyc_admin_review', [U.req, 'aprovado', 'Tudo certo aqui'])).code, 'FORBIDDEN');
    assert.equal((await h.rpc('kyc_admin_list', [])).code, 'FORBIDDEN');
    assert.equal((await h.rpc('kyc_admin_get', [U.req])).code, 'FORBIDDEN');
  }
  await h.asUser(U.revisor);
  assert.equal((await h.rpc('kyc_admin_grant', [U.beto, true])).code, 'FORBIDDEN', 'revisor não dá permissões');
  const l = await h.rpc('kyc_admin_list', []);
  assert.equal(l.ok, true);
  assert.ok(l.items.some((x) => x.kind === 'apostas' && x.user_id === U.apost), 'KYC das apostas aparece na fila única');
  assert.ok(l.items.some((x) => x.id === U.req));
  assert.equal((await h.rpc('kyc_admin_list', ['pendente', 'vendedor', 'bi', null, null, 'ana'])).items.length, 1, 'filtros + pesquisa');
  assert.equal((await h.rpc('kyc_admin_list', ['aprovado', 'vendedor', null, null, null, 'ana'])).items.length, 0);
  // conta banida perde a permissão
  await h.asService(); await h.db.query(`update profiles set banned = true where id = $1`, [U.revisor]);
  await h.asUser(U.revisor); assert.equal((await h.rpc('kyc_admin_list', [])).code, 'FORBIDDEN');
  await h.asService(); await h.db.query(`update profiles set banned = false where id = $1`, [U.revisor]);
  const denied = await h.q(`select count(*)::int c from app_audit_log where area = 'kyc' and action = 'kyc:negado'`);
  assert.ok(denied[0].c >= 3, 'tentativas negadas ficam na auditoria');
});

test('KYC SQL: transições de estado, motivo obrigatório, notificação, auditoria e bloqueio de vendedor', { skip }, async () => {
  await h.asUser(U.revisor);
  assert.equal((await h.rpc('kyc_admin_review', [U.req, 'recusado', ''])).code, 'REASON');
  assert.equal((await h.rpc('kyc_admin_review', [U.req, 'aprovado', 'ok'])).code, 'REASON');
  assert.equal((await h.rpc('kyc_admin_review', [U.req, 'xpto', 'Motivo longo'])).code, 'ACTION');
  assert.equal((await h.rpc('kyc_admin_review', [U.req, 'em_analise', ''])).ok, true);
  assert.equal((await h.rpc('kyc_admin_review', [U.req, 'mais_documentos', 'Falta o comprovativo de morada'])).ok, true);
  assert.equal((await h.rpc('kyc_admin_review', [U.req, 'aprovado', 'Documentos conferidos'])).code, 'STATE', 'à espera do utilizador');
  // utilizador completa o pedido → volta a pendente
  const mor = await upload(U.ana, 'kyc-morada.pdf');
  await h.asUser(U.beto); assert.equal((await h.rpc('kyc_add_files', [U.req, JSON.stringify([f(mor, 'comprovativo_morada')]), ''])).code, 'NOT_FOUND', 'não é o dono');
  await h.asUser(U.ana);
  assert.equal((await h.rpc('kyc_add_files', [U.req, JSON.stringify([f(mor, 'comprovativo_morada')]), 'enviado'])).status, 'pendente');
  await h.asUser(U.revisor);
  const d = await h.rpc('kyc_admin_get', [U.req]);
  assert.equal(d.files.length, 4); assert.ok(d.events.length >= 4, 'histórico completo'); assert.equal(d.history.length, 1);
  assert.equal((await h.rpc('kyc_admin_review', [U.req, 'aprovado', 'Documentos conferidos'])).ok, true);
  assert.equal((await h.rpc('kyc_admin_review', [U.req, 'recusado', 'Mudei de ideias'])).code, 'STATE', 'decisão final');
  await h.asService();
  assert.equal((await h.q(`select public.seller__verified($1) v`, [U.ana]))[0].v, true, 'o bloqueio de contas/diamantes lê o estado unificado');
  assert.equal((await h.q(`select kyc_level from security_settings where user_id = $1`, [U.ana]))[0].kyc_level, 3, 'BI + selfie com documento = nível 3');
  assert.equal((await h.q(`select status from seller_verifications where user_id = $1`, [U.ana]))[0].status, 'aprovado', 'compatível com o SQL antigo');
  const n = (await notes(U.ana)).map((x) => x.body).join(' | ');
  assert.match(n, /mais documentos/); assert.match(n, /aprovada/);
  const acts = (await h.q(`select action from app_audit_log where area = 'kyc' and target = $1 order by id`, [U.req])).map((x) => x.action);
  for (const a of ['kyc:enviado', 'kyc:em_analise', 'kyc:mais_documentos', 'kyc:documentos_adicionados', 'kyc:ver_documentos', 'kyc:aprovado']) assert.ok(acts.includes(a), a);
  await h.asUser(U.ana); assert.equal((await h.rpc('kyc_me')).verified.vendedor, true);
  assert.equal((await h.rpc('seller_verification_me')).status, 'aprovado');
});

test('KYC SQL: funções antigas de vendedor e pedidos de nível passam pela fila única', { skip }, async () => {
  const doc = await upload(U.beto, 'doc-1.webp'); const sf = await upload(U.beto, 'selfie-1.webp');
  await h.asUser(U.beto);
  assert.equal((await h.rpc('seller_verification_submit', [doc, sf])).ok, true);
  assert.equal((await h.rpc('seller_verification_me')).status, 'pendente');
  await h.asUser(U.chefe);
  const legacy = await h.rpc('seller_verification_admin_list', ['pendente']);
  assert.ok(legacy.items.some((x) => x.user_id === U.beto && x.doc_path === doc));
  assert.equal((await h.rpc('seller_verification_review', [U.beto, false, 'Selfie desfocada'])).ok, true);
  await h.asUser(U.beto); const me = await h.rpc('seller_verification_me'); assert.equal(me.status, 'rejeitado'); assert.equal(me.reason, 'Selfie desfocada');
  // nível KYC antigo (página Segurança) → aparece na fila e a decisão acompanha a tabela antiga
  await h.asService(); await h.db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [U.nivel]);
  await h.db.query(`insert into kyc_submissions (level, kind) values (1, 'telefone')`);
  await h.asUser(U.chefe);
  const rows = await h.rpc('kyc_admin_list', [null, null, null, null, null, 'nivel']);
  assert.equal(rows.items.length, 2, 'migrado + espelhado');
  const lvl2 = rows.items.find((x) => x.source === 'migrado_kyc');
  assert.equal((await h.rpc('kyc_admin_review', [lvl2.id, 'aprovado', 'BI legível e válido'])).ok, true);
  await h.asService();
  assert.equal((await h.q(`select status from kyc_submissions where user_id = $1 and level = 2`, [U.nivel]))[0].status, 'aprovado');
  assert.equal((await h.q(`select kyc_level from security_settings where user_id = $1`, [U.nivel]))[0].kyc_level, 2);
  assert.equal((await h.q(`select public.seller__verified($1) v`, [U.nivel]))[0].v, false, 'nível de identidade não basta para vender contas');
});
