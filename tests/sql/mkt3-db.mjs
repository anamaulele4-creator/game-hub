// Base de dados em memória (PGlite) com todo o SQL necessário ao Marketplace 3.0. Só para testes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APOSTAS = 'supabase/migrations/2026-10-20-apostas-v2.sql';
const CONTAS = 'supabase/migrations/2026-10-20-venda-contas.sql';
export const MKT3_PARTS = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) => /^2026-10-21-mkt3-\d\d-.*\.sql$/.test(f)).sort().map((f) => 'supabase/migrations/' + f);
const exists = (f) => fs.existsSync(path.join(ROOT, f));

export function files() {
  return [
    'tests/sql/supabase-stub.sql', 'supabase/schema.sql',
    'supabase/migrations/2026-10-08-profile-handle.sql', 'supabase/migrations/2026-10-08-clip-media.sql', 'supabase/migrations/2026-10-08-chat-groups-calls.sql',
    'supabase/migrations/2026-10-09-ai-core.sql', 'supabase/migrations/2026-10-10-tournaments-market.sql', 'supabase/migrations/2026-10-10-market-escrow.sql',
    'supabase/migrations/2026-10-10-bets.sql', 'supabase/migrations/2026-10-10-bets-money.sql', 'supabase/migrations/2026-10-10-team-logos.sql',
    'supabase/competitive.sql', 'supabase/migrations/2026-10-20-moderador-afiliados.sql',
    exists(APOSTAS) ? APOSTAS : 'tests/sql/app-settings-fixture.sql',
    ...(exists(CONTAS) ? [CONTAS] : []),
    ...MKT3_PARTS, ...MKT3_PARTS, // duas vezes = idempotente
  ];
}

export async function makeDb() {
  let PGlite, pgcrypto;
  try {
    ({ PGlite } = await import('@electric-sql/pglite'));
    ({ pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto'));
  } catch { return null; }
  const db = new PGlite({ extensions: { pgcrypto } });
  for (const f of files()) {
    try { await db.exec(fs.readFileSync(path.join(ROOT, f), 'utf8')); }
    catch (e) { throw new Error(`${f}: ${e.message}`); }
  }
  const U = {};
  const h = {
    db, U,
    cur: { kind: 'service' },
    async asUser(id) {
      h.cur = { kind: 'user', id };
      await db.query(`reset role`);
      await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [id ?? '', JSON.stringify({ sub: id, aal: 'aal1' })]);
      if (id) await db.query(`set role authenticated`);
    },
    async asAnon() {
      h.cur = { kind: 'anon' };
      await db.query(`reset role`);
      await db.query(`select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '{}', false)`);
      await db.query(`set role anon`);
    },
    async asService() {
      h.cur = { kind: 'service' };
      await db.query(`reset role`);
      await db.query(`select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '{}', false)`);
    },
    async rpc(fn, args = []) {
      const ph = args.map((_, i) => `$${i + 1}`).join(', ');
      return (await db.query(`select public.${fn}(${ph}) as r`, args)).rows[0].r;
    },
    async q(sql, args = []) { return (await db.query(sql, args)).rows; },
    async mk(k, role = 'user') {
      await h.asService();
      const id = crypto.randomUUID();
      await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${k}@t.mz`, JSON.stringify({ handle: k, name: k, birth: '1995-01-01', province: 'Maputo Cidade' })]);
      if (role !== 'user') await db.query(`update profiles set role = $1 where id = $2`, [role, id]);
      U[k] = id; return id;
    },
    /** Crédito real de teste: simula um depósito JÁ confirmado pelo fornecedor (como faria comp__confirm_deposit). */
    async fund(user, amount, ref) {
      await h.asService();
      await db.query(`select public.bets__post_mt($1, $2, 'deposito', $3)`, [user, amount, ref]);
    },
    /** Saldo lido como serviço; devolve depois a sessão anterior (utilizador/anónimo). */
    async balance(user) {
      const prev = h.cur; await h.asService();
      const b = (await db.query(`select public.bets__balance_mt($1) as b`, [user])).rows[0].b;
      if (prev.kind === 'user') await h.asUser(prev.id); else if (prev.kind === 'anon') await h.asAnon();
      return b;
    },
  };
  return h;
}
