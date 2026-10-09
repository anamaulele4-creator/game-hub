// TXAPILOG AI CORE · camada de integração Free Fire.
// Cada fonte é um "adapter" com a mesma interface. Só fontes AUTORIZADAS podem ficar ativas.
// A Garena não disponibiliza API pública oficial de estatísticas → o adapter oficial fica desativado.
// Nunca se simula uma ligação: um adapter não configurado devolve "indisponivel", sem dados.
import type { CoreData, CoreExternalId, CoreParticipation, CorePlayer, Source } from './stats';

export type ProviderKind = 'oficial' | 'autorizado' | 'txapilog';
export interface ProviderLookup {
  status: 'encontrado' | 'sem_dados' | 'indisponivel';
  provider: string;
  message: string;
  players: CorePlayer[];
  externalIds: CoreExternalId[];
  participations: CoreParticipation[];
  origin: Source | null;
}
export interface FreeFireProvider {
  id: string;
  name: string;
  kind: ProviderKind;
  /** Ativo = autorizado + configurado. */
  enabled: boolean;
  statusLabel: string;
  detail: string;
  lookupByExternalId(externalId: string, region?: string): Promise<ProviderLookup>;
}

export const NOT_CONFIGURED = 'Não configurado — sem fonte autorizada';

/** Adapter ATIVO: dados de torneios registados na TXAPILOG (tabelas core_* com RLS). */
export function txapilogTournamentsProvider(getData: () => CoreData): FreeFireProvider {
  return {
    id: 'txapilog_torneios', name: 'Torneios registados na TXAPILOG', kind: 'txapilog', enabled: true, statusLabel: 'Ativo',
    detail: 'Partidas e resultados inseridos por organizadores e validados por moderadores.',
    async lookupByExternalId(externalId, region) {
      const d = getData();
      const id = externalId.trim();
      const ext = d.externalIds.filter((e) => e.external_id === id && e.status !== 'rejeitado' && (!region || e.region === region));
      const pids = new Set(ext.map((e) => e.player_id));
      const players = d.players.filter((p) => pids.has(p.id));
      const participations = d.participations.filter((p) => pids.has(p.player_id));
      if (!players.length) return { status: 'sem_dados', provider: 'txapilog_torneios', message: 'Este ID não está associado a nenhum jogador registado na TXAPILOG.', players: [], externalIds: [], participations: [], origin: null };
      return { status: 'encontrado', provider: 'txapilog_torneios', message: participations.length ? 'Dados obtidos de torneios/submissões registados na TXAPILOG.' : 'Jogador registado, mas sem partidas registadas.', players, externalIds: d.externalIds.filter((e) => pids.has(e.player_id)), participations, origin: 'torneio_txapilog' };
    },
  };
}

/** Adapter DESATIVADO por omissão: um adapter sem fonte autorizada nunca devolve dados. */
export function disabledProvider(id: string, name: string, kind: ProviderKind, detail: string): FreeFireProvider {
  return {
    id, name, kind, enabled: false, statusLabel: NOT_CONFIGURED, detail,
    async lookupByExternalId() {
      return { status: 'indisponivel', provider: id, message: `${name}: ${NOT_CONFIGURED}.`, players: [], externalIds: [], participations: [], origin: null };
    },
  };
}

export function buildProviders(getData: () => CoreData): FreeFireProvider[] {
  return [
    txapilogTournamentsProvider(getData),
    disabledProvider('garena_oficial', 'API oficial Garena Free Fire', 'oficial', 'A Garena não disponibiliza API pública de estatísticas de jogadores. Sem acordo oficial, não há ligação.'),
    // Para ligar um fornecedor autorizado: implementar a chamada numa Edge Function (chave em `supabase secrets`),
    // gravar as linhas em core_matches/core_match_participants com source = 'provedor_autorizado' e ativar a linha em core_integrations.
    disabledProvider('fornecedor_autorizado', 'Fornecedor de dados autorizado', 'autorizado', 'Ligar só com contrato/licença. A chave fica como segredo da Edge Function, nunca no cliente.'),
  ];
}

/** Pesquisa por ID em todas as fontes ativas; as inativas aparecem como indisponíveis. */
export async function searchExternalId(providers: FreeFireProvider[], externalId: string, region?: string): Promise<ProviderLookup[]> {
  return Promise.all(providers.map((p) => p.lookupByExternalId(externalId, region)));
}
