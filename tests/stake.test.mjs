// Painel de valor da aposta (lib/stake.ts) + regras da UI de /apostas: retorno/lucro, mínimo/máximo, chips,
// motivos de botão fechado e "aposta confirmada é irrevogável" na interface. Correr: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  STAKE_CHIPS, parseStake, stakeMath, maxAllowed, maxChip, clampStake, stakeStep, stepStake, stakeChips, stakeIssues, closedReason, PLACE_CODE_TEXT, AWAIT_RESULT_HOURS,
} from '../lib/stake.ts';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const cfg = { minStake: 10, maxStake: 2000, maxPayout: 50000 };
const ctx = (o = {}) => ({ cfg, limits: { maxStake: null, maxDaily: null, maxWeekly: null }, balance: 1000, stakedToday: 0, stakedWeek: 0, ...o });
const H = 3600e3;
const NOW = Date.parse('2026-10-21T15:30:00Z');

test('stake: retorno = valor × odd e lucro = retorno − valor (arredonda para baixo, como o servidor)', () => {
  assert.deepEqual(stakeMath(100, 1.87, 50000), { retorno: 187, lucro: 87, capped: false });
  assert.deepEqual(stakeMath(10, 1.87, 50000), { retorno: 18, lucro: 8, capped: false }); // 18.7 → 18
  assert.deepEqual(stakeMath(0, 1.87, 50000), { retorno: 0, lucro: 0, capped: false });
  assert.deepEqual(stakeMath(100, 1, 50000), { retorno: 0, lucro: 0, capped: false }); // sem odd válida
  assert.deepEqual(stakeMath(2000, 40, 50000), { retorno: 50000, lucro: 48000, capped: true }); // pagamento máximo
});

test('stake: leitura do campo (só dígitos inteiros)', () => {
  assert.equal(parseStake('1 000'), 1000);
  assert.equal(parseStake('50 MT'), 50);
  assert.equal(parseStake('abc'), 0);
  assert.equal(parseStake(''), 0);
  assert.equal(parseStake('99999999999'), 9999999); // máx. 7 dígitos
});

test('stake: mínimo/máximo do mercado e limites pessoais', () => {
  assert.equal(maxAllowed(ctx()), 2000);
  assert.equal(maxAllowed(ctx({ limits: { maxStake: 300, maxDaily: null, maxWeekly: null } })), 300);
  assert.equal(maxAllowed(ctx({ limits: { maxStake: null, maxDaily: 500, maxWeekly: null }, stakedToday: 450 })), 50);
  assert.equal(maxAllowed(ctx({ limits: { maxStake: null, maxDaily: null, maxWeekly: 100 }, stakedWeek: 200 })), 0);
  assert.equal(clampStake(5, ctx()), 10);
  assert.equal(clampStake(99999, ctx()), 2000);
  assert.equal(clampStake(150, ctx()), 150);
  assert.deepEqual(stakeIssues(5, ctx()), ['STAKE_MIN']);
  assert.deepEqual(stakeIssues(2500, ctx({ balance: 5000 })), ['STAKE_MAX']);
  assert.deepEqual(stakeIssues(400, ctx({ limits: { maxStake: 300, maxDaily: null, maxWeekly: null } })), ['LIMIT']);
  assert.deepEqual(stakeIssues(1500, ctx()), ['BALANCE']); // saldo 1000
  assert.deepEqual(stakeIssues(100, ctx()), []);
  assert.deepEqual(stakeIssues(100, ctx({ balance: 0 })), ['BALANCE']);
});

test('stake: botões − / + com passo e dentro dos limites', () => {
  assert.equal(stakeStep(50), 10); assert.equal(stakeStep(500), 50); assert.equal(stakeStep(1500), 100);
  assert.equal(stepStake(50, 1, ctx()), 60);
  assert.equal(stepStake(37, 1, ctx()), 40);
  assert.equal(stepStake(37, -1, ctx()), 30);
  assert.equal(stepStake(10, -1, ctx()), 10); // não desce abaixo do mínimo
  assert.equal(stepStake(200, -1, ctx()), 190);
  assert.equal(stepStake(1950, 1, ctx()), 2000);
  assert.equal(stepStake(2000, 1, ctx()), 2000); // não passa o máximo
});

test('stake: chips 10/20/50/100/500 + Máx. = saldo (limitado ao máximo)', () => {
  assert.deepEqual([...STAKE_CHIPS], [10, 20, 50, 100, 500]);
  const c = stakeChips(ctx());
  assert.deepEqual(c.map((x) => x.label), ['10', '20', '50', '100', '500', 'Máx.']);
  assert.equal(c.at(-1).value, 1000); // saldo
  assert.ok(c.every((x) => !x.disabled));
  assert.equal(maxChip(ctx({ balance: 9000 })), 2000); // nunca acima do máximo do mercado
  const lim = stakeChips(ctx({ limits: { maxStake: 60, maxDaily: null, maxWeekly: null } }));
  assert.deepEqual(lim.filter((x) => x.disabled).map((x) => x.label), ['100', '500']);
  assert.equal(lim.at(-1).value, 60);
  const min = stakeChips({ ...ctx(), cfg: { ...cfg, minStake: 25 } });
  assert.deepEqual(min.filter((x) => x.disabled).map((x) => x.label), ['10', '20']);
  const broke = stakeChips(ctx({ balance: 5 }));
  assert.equal(broke.at(-1).disabled, true); assert.equal(broke.at(-1).why, 'Saldo insuficiente');
});

const mk = (o = {}) => ({ status: 'aberto', closesAt: new Date(NOW + 3 * H).toISOString(), autoSuspended: false, matchId: 'm1', ...o });
const mt = (o = {}) => ({ status: 'agendado', startsAt: new Date(NOW + 3 * H).toISOString(), voided: false, ...o });
const on = { betsEnabled: true, realMoneyEnabled: true };

test('botão 1/2: aberto só com jogo agendado, mercado aberto e odd válida', () => {
  assert.equal(closedReason({ settings: on, market: mk(), match: mt(), odds: 1.87, now: NOW }), null);
});

test('botão 1/2: motivo quando está fechado (nunca "não faz nada")', () => {
  const r = (o) => closedReason({ settings: on, market: mk(), match: mt(), odds: 1.87, now: NOW, ...o });
  // AO VIVO: o mercado fecha à hora de início (é o caso da captura de ecrã)
  assert.equal(r({ match: mt({ status: 'ao_vivo', startsAt: new Date(NOW - 10 * 60e3).toISOString() }), market: mk({ status: 'suspenso', autoSuspended: true }) }), 'Mercado fechado — o jogo já começou.');
  assert.match(r({ match: mt({ status: 'ao_vivo', startsAt: new Date(NOW - (AWAIT_RESULT_HOURS + 40) * H).toISOString() }) }), /a aguardar o resultado do organizador/);
  // começou mas o varrimento ainda não marcou ao_vivo
  assert.equal(r({ match: mt({ startsAt: new Date(NOW - 60e3).toISOString() }) }), 'Mercado fechado — o jogo já começou.');
  assert.match(r({ match: mt({ status: 'terminado' }) }), /terminado/);
  assert.match(r({ match: mt({ status: 'adiado' }) }), /adiado/);
  assert.match(r({ match: mt({ status: 'cancelado' }) }), /cancelado/);
  assert.match(r({ match: mt({ voided: true }) }), /cancelado/);
  assert.equal(r({ market: mk({ status: 'suspenso', autoSuspended: false }) }), 'Mercado suspenso pela equipa neste momento.');
  assert.equal(r({ market: mk({ status: 'liquidado' }) }), 'Mercado já liquidado.');
  assert.equal(r({ market: mk({ closesAt: new Date(NOW - 1).toISOString() }) }), 'Mercado fechado.');
  assert.equal(r({ odds: 0 }), 'Ainda sem odd para esta seleção.');
  assert.equal(r({ market: null }), 'Mercado indisponível.');
  // interruptores do servidor
  assert.equal(r({ settings: { betsEnabled: false, realMoneyEnabled: true } }), 'As apostas foram desativadas pela plataforma neste momento.');
  assert.equal(r({ settings: { betsEnabled: true, realMoneyEnabled: false } }), 'Apostas indisponíveis neste momento.');
  assert.match(r({ readOnly: true }), /Exemplo/);
});

test('mensagens dos códigos do servidor (saldo, mercado fechado, desligado)', () => {
  for (const k of ['BALANCE', 'CLOSED', 'MARKET', 'BETS_OFF', 'REAL_OFF', 'KYC', 'STAKE_MIN', 'STAKE_MAX']) assert.ok(PLACE_CODE_TEXT[k], k);
  assert.match(PLACE_CODE_TEXT.BALANCE, /Saldo insuficiente/);
  assert.match(PLACE_CODE_TEXT.CLOSED, /Mercado fechado/);
});

test('UI /apostas: toque em 1/2 abre o painel; fechado explica porquê; mesmo caminho do servidor', () => {
  const b = read('components/bets/Bets.tsx');
  const s = read('components/bets/StakeSheet.tsx');
  assert.match(b, /<StakeSheet /);
  assert.match(b, /if \(why\) \{ toast\(why\); return; \}/, 'toque num botão fechado mostra o motivo');
  assert.doesNotMatch(b, /className="bx-odd"[^>]*\sdisabled=/, 'botão de odd não usa disabled (o toque tem de chegar)');
  assert.match(b, /aria-disabled=\{!open\}/);
  assert.match(b, /aria-expanded=\{more === m\.id\}/, '+N (mais mercados) mantém-se');
  assert.match(s, /betsApi\.place\(\{ selectionIds: \[item\.selectionId\], stake, odds: \[item\.odds\], acceptChanges: oddsMoved, currency: 'mt' \}\)/);
  assert.match(s, /setStep\('confirmar'\)/, 'APOSTAR leva a um passo de confirmação');
  assert.match(s, /href="\/carteira"/, 'saldo insuficiente aponta para a Carteira');
  // a UI não mexe em interruptores nem em pagamentos
  for (const src of [b, s, read('lib/stake.ts')]) assert.doesNotMatch(src, /bets_admin_set_real_money|set_real_money|betting_enabled\s*=|clicpay|mpesa_/i);
});

test('UI: aposta confirmada é irrevogável (sem retirar/cancelar/editar depois de confirmar)', () => {
  const b = read('components/bets/Bets.tsx');
  const s = read('components/bets/StakeSheet.tsx');
  const api = read('lib/betsApi.ts');
  // "As minhas apostas" (BetRow/MyBets) não tem botões de ação
  const row = b.slice(b.indexOf('export function BetRow'), b.indexOf('/* ---------------- Jogo responsável'));
  assert.doesNotMatch(row, /<button[^>]*onClick=\{[^}]*(cancel|remov|retir|edit|anular)/i);
  assert.doesNotMatch(row, /(Cancelar|Retirar|Editar|Cash ?out)/i);
  // depois de registada, o painel só mostra "Fechar"
  const done = s.slice(s.indexOf('data-testid="stake-done"'), s.indexOf("step === 'confirmar' ? (\n"));
  assert.ok(done.length > 100, 'bloco "feito" encontrado');
  assert.doesNotMatch(done, /onRemove|Retirar|Cancelar/);
  assert.match(done, /não pode ser retirada nem alterada/);
  // a API do cliente não tem forma de cancelar/editar apostas
  assert.doesNotMatch(api, /bets_cancel|cashout|cash_out|bets_edit|from\('bets'\)\.(update|delete)|from\('bet_legs'\)\.(update|delete)/);
  // o servidor também impede (migração com triggers e sem permissões de escrita)
  const sql = read('supabase/migrations/2026-10-21-apostas-irrevogaveis.sql');
  assert.match(sql, /before delete on public\.bets/);
  assert.match(sql, /before update on public\.bets/);
  assert.match(sql, /revoke insert, update, delete, truncate/);
  assert.doesNotMatch(sql, /real_money_enabled\s*=|bets_enabled\s*=|betting_enabled\s*=|monetary_features_enabled\s*=/, 'não mexe em interruptores');
  assert.ok(fs.existsSync(new URL('../public/sql-apostas-irrevogaveis.html', import.meta.url)), 'página de instalação');
});
