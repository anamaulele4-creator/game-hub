'use client';
import React, { useMemo, useRef, useState } from 'react';
import { buildProviders, NOT_CONFIGURED } from '@/lib/core/providers';
import { setRole } from '@/lib/core/repo';
import type { CoreRole } from '@/lib/core/stats';
import { DataTable, Empty, Origin, Panel, Select, Updated, btn, can, fmtDate, input, useAction, useCore } from './kit';

const ROLE_INFO: [CoreRole, string, string][] = [
  ['admin', 'Administrador', 'Tudo: papéis, auditoria, integrações, validação, alertas.'],
  ['moderador', 'Moderador', 'Valida/rejeita resultados e IDs, revê alertas, vê papéis. Sem auditoria nem papéis.'],
  ['organizador', 'Organizador', 'Cria torneios e equipas, regista jogadores, valida resultados dos SEUS torneios.'],
  ['jogador', 'Jogador', 'Sem acesso ao painel. Submete os próprios resultados (ficam “Submetido · não verificado”).'],
];

export function Users() {
  const { bundle, role } = useCore();
  const { busy, run } = useAction();
  const [handle, setHandle] = useState('');
  const [r, setR] = useState<CoreRole>('moderador');
  return (
    <div className="space-y-4">
      <Panel title="Papéis e permissões" sub="Aplicadas na base de dados (RLS + funções core_has_role); a interface só esconde o que o servidor já recusa.">
        <ul className="grid gap-2 sm:grid-cols-2">
          {ROLE_INFO.map(([k, l, t]) => <li key={k} className="rounded-xl bg-core-bg/60 p-3 text-sm"><p className="font-bold">{l} <span className="font-mono text-[12px] text-white/50">{k}</span></p><p className="mt-0.5 text-white/70">{t}</p></li>)}
        </ul>
      </Panel>
      {can(role, 'papeis') && (
        <Panel title="Atribuir papel" sub="Pelo @username do perfil TXAPILOG. Fica registado na auditoria.">
          <form className="grid gap-2 sm:grid-cols-[1fr_180px_auto] sm:items-end" onSubmit={async (e) => { e.preventDefault(); if (await run(() => setRole(handle, r), 'Papel atualizado.')) setHandle(''); }}>
            <label className="flex flex-col gap-1 text-[12px] text-white/65">@username<input className={input} value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@utilizador" required maxLength={31} /></label>
            <Select label="Papel" value={r} onChange={(v) => setR(v as CoreRole)} options={ROLE_INFO.map(([k, l]) => [k, l])} />
            <button className={btn} disabled={busy}>Guardar</button>
          </form>
        </Panel>
      )}
      <Panel title="Utilizadores com papel no AI CORE">
        <DataTable rowKey={(x) => x.user_id} rows={bundle.roles} search={(x) => `${x.handle} ${x.role}`} placeholder="Pesquisar…"
          empty={<Empty icon="" title="Sem papéis atribuídos" text="Os administradores da app (profiles.role = admin) já têm acesso total; os restantes recebem papel aqui." />}
          cols={[
            { key: 'h', label: 'Utilizador', sort: (x) => x.handle, render: (x) => <b>@{x.handle}</b> },
            { key: 'r', label: 'Papel', sort: (x) => x.role, render: (x) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${x.role === 'admin' ? 'bg-neon text-ink' : 'bg-white/15'}`}>{x.role}</span> },
            { key: 'd', label: 'Desde', render: (x) => fmtDate(x.created_at, false) },
          ]} />
      </Panel>
    </div>
  );
}

export function AuditIntegrations() {
  const { bundle, role } = useCore();
  const dataRef = useRef(bundle.data); dataRef.current = bundle.data;
  const providers = useMemo(() => buildProviders(() => dataRef.current), []);
  const rows = providers.map((p) => ({ p, db: bundle.integrations.find((i) => i.id === p.id) }));
  return (
    <div className="space-y-4">
      <Panel title="Estado das integrações Free Fire" sub="Só fontes autorizadas podem fornecer dados. Nenhuma ligação é simulada.">
        <ul className="space-y-2">
          {rows.map(({ p, db }) => (
            <li key={p.id} className="rounded-xl border border-core-line bg-core-bg/60 p-3">
              <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                <p className="mr-auto flex min-w-0 items-center gap-2 font-semibold"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${p.enabled ? 'bg-emerald-400' : 'bg-white/30'}`} aria-hidden />{p.name}</p>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${p.enabled ? 'bg-emerald-400 text-ink' : 'bg-white/15 text-white/85'}`}>{p.enabled ? 'Ativo' : NOT_CONFIGURED}</span>
              </div>
              <p className="mt-1 text-[13px] text-white/70">{p.detail}</p>
              <p className="mt-1 text-[12px] text-white/50">Tipo: {p.kind === 'oficial' ? 'API oficial' : p.kind === 'autorizado' ? 'fornecedor autorizado' : 'dados próprios TXAPILOG'} · {p.enabled ? (db?.last_sync_at ? <Updated at={db.last_sync_at} prefix="Último registo" /> : <Updated at={bundle.loadedAt} prefix="Lido" />) : 'sem sincronização'}</p>
            </li>
          ))}
        </ul>
        <Origin>Para ligar um fornecedor autorizado: contrato/licença → chave como segredo da Edge Function → gravar linhas com source = provedor_autorizado → ativar em core_integrations. Ver docs/AI-CORE.md.</Origin>
      </Panel>
      {can(role, 'auditoria') ? (
        <Panel title="Registo de auditoria" sub="Escrito por triggers da base de dados em cada alteração das tabelas do AI CORE.">
          <DataTable rowKey={(a) => String(a.id)} rows={bundle.audit} search={(a) => `${a.actor_label ?? ''} ${a.action} ${a.table_name} ${a.row_id ?? ''}`} placeholder="Pesquisar ação, tabela, utilizador…"
            empty={<Empty icon="" title="Sem registos de auditoria" />}
            initialSort={{ key: 'd', dir: -1 }}
            cols={[
              { key: 'd', label: 'Quando', sort: (a) => a.created_at, render: (a) => <span className="whitespace-nowrap text-[13px]">{fmtDate(a.created_at)}</span> },
              { key: 'u', label: 'Quem', render: (a) => <span>{a.actor_label ?? '—'} <span className="text-[11px] text-white/50">{a.actor_role}</span></span> },
              { key: 'a', label: 'Ação', render: (a) => <span className="font-mono text-[12px]">{a.action}</span> },
              { key: 't', label: 'Tabela', render: (a) => <span className="font-mono text-[12px]">{a.table_name}</span> },
              { key: 'r', label: 'Registo', render: (a) => <span className="block max-w-[140px] truncate font-mono text-[12px] text-white/60" title={a.row_id ?? ''}>{a.row_id ?? '—'}</span> },
            ]} />
        </Panel>
      ) : <Panel title="Registo de auditoria"><p className="text-sm text-white/65">Só administradores podem consultar a auditoria.</p></Panel>}
    </div>
  );
}
