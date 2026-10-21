// KYC unificado — regras puras (lib/kyc.ts) e ligação dos ecrãs à fila única.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  missingDocs, canTransition, actionsFor, validReason, verifiedFor, filePath, validPath, isOpen, STATUSES, PURPOSES, DOC_TYPES, KYC_ERR,
} from '../lib/kyc.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('KYC: documentos obrigatórios por finalidade (iguais ao servidor)', () => {
  assert.equal(missingDocs('identidade', []), 'FILES');
  assert.equal(missingDocs('identidade', ['comprovativo_morada']), null);
  assert.equal(missingDocs('criador', ['nuit']), 'NEED_ID');
  assert.equal(missingDocs('criador', ['passaporte']), null);
  for (const p of ['vendedor', 'afiliado', 'levantamento']) {
    assert.equal(missingDocs(p, ['bi']), 'NEED_SELFIE', p);
    assert.equal(missingDocs(p, ['selfie']), 'NEED_ID', p);
    assert.equal(missingDocs(p, ['dire', 'selfie_documento']), null, p);
  }
  for (const c of ['FILES', 'NEED_ID', 'NEED_SELFIE', 'OPEN', 'STATE', 'REASON', 'FORBIDDEN']) assert.ok(KYC_ERR[c], c);
  assert.deepEqual(DOC_TYPES, ['bi', 'passaporte', 'carta_conducao', 'dire', 'nuit', 'comprovativo_morada', 'selfie', 'selfie_documento', 'outro']);
  assert.deepEqual(PURPOSES, ['identidade', 'vendedor', 'afiliado', 'levantamento', 'criador']);
});

test('KYC: máquina de estados do revisor', () => {
  assert.deepEqual(STATUSES, ['pendente', 'em_analise', 'aprovado', 'recusado', 'mais_documentos']);
  assert.ok(canTransition('pendente', 'aprovado') && canTransition('pendente', 'em_analise') && canTransition('em_analise', 'mais_documentos'));
  assert.ok(!canTransition('aprovado', 'recusado') && !canTransition('recusado', 'aprovado'), 'decisões finais');
  assert.ok(!canTransition('mais_documentos', 'aprovado'), 'espera pelos documentos');
  assert.deepEqual(actionsFor('aprovado'), []);
  assert.deepEqual(actionsFor('mais_documentos'), ['em_analise', 'recusado']);
  assert.ok(isOpen('mais_documentos') && !isOpen('aprovado'));
  assert.equal(validReason('aprovado', 'ok'), false); assert.equal(validReason('recusado', 'Foto ilegível'), true); assert.equal(validReason('em_analise', ''), true);
});

test('KYC: cobertura entre finalidades e caminhos privados', () => {
  assert.equal(verifiedFor('vendedor', ['identidade']), false, 'identidade geral não chega para vender');
  assert.equal(verifiedFor('vendedor', ['afiliado']), true);
  assert.equal(verifiedFor('criador', ['criador']), true);
  assert.equal(verifiedFor('vendedor', [], true), true, 'verificação antiga de vendedor conta');
  assert.equal(verifiedFor('identidade', ['criador']), true);
  const uid = '0b8c4c9e-0000-4000-8000-000000000001';
  const p = filePath(uid, 'bi', 'frente', 'JPEG', 'abc1');
  assert.equal(p, `${uid}/kyc-bi-frente-abc1.jpg`);
  assert.ok(validPath(uid, p)); assert.ok(!validPath(uid, `outro/${p}`)); assert.ok(!validPath(uid, `${uid}/../x.jpg`));
});

test('KYC: ecrãs usam a fila única (sem revisão duplicada)', () => {
  const admin = read('app/admin/page.tsx');
  assert.match(admin, /KYC: dynamic\(\(\) => import\('@\/components\/admin\/Kyc'\)/);
  const aff = read('components/admin/Affiliates.tsx');
  assert.doesNotMatch(aff, /adminReview|adminSignedUrl|VerifCard/, 'Afiliados já não revê documentos');
  assert.match(aff, /href="#kyc"/);
  assert.match(read('components/market/SellerVerification.tsx'), /VerificationCenter purpose="vendedor"/);
  assert.doesNotMatch(read('components/admin/Risk.tsx'), /kyc_submissions/);
  assert.match(read('app/perfil/page.tsx'), /\/seguranca\/verificacao\//);
  assert.match(read('app/seguranca/page.tsx'), /\/seguranca\/verificacao\//);
  const sql = read('supabase/migrations/2026-10-21-kyc-unificado.sql').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert.match(sql, /create or replace function public\.seller__verified\(p_user uuid\)[\s\S]{0,200}kyc__verified\(p_user, 'vendedor'\)/);
  assert.doesNotMatch(sql, /realMoneyEnabled|realOn|igj_licen|clicpay|mpesa_/i, 'não toca em dinheiro real, licença ou pagamentos');
  assert.ok(fs.existsSync(path.join(ROOT, 'public/sql-kyc.html')), 'página de instalação');
});
