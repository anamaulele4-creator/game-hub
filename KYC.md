# KYC unificado (verificação de identidade e documentos)

Ordem do dono (Claudio Cesar), 2026-10-21: **Admin › KYC é o único sítio** onde se decidem todas as verificações de identidade e documentos, de **todos** os utilizadores.

## Para o utilizador
- Página: **/seguranca/verificacao/** (links em Perfil, Segurança, Marketplace › Anunciar e no painel do criador).
- `?f=vendedor|afiliado|levantamento|criador|identidade` abre já com essa finalidade.
- Tipos de documento: BI, passaporte, carta de condução, DIRE, NUIT, comprovativo de morada, selfie, selfie a segurar o documento, outro. BI, carta e DIRE pedem frente e verso. Vários ficheiros por pedido (JPG/PNG/WebP reduzidos no telemóvel, sem EXIF; PDF até 8 MB).
- Ficheiros no bucket **privado** `verificacoes`, pasta `<uid>/`. Só o dono e os revisores autorizados os leem (RLS no Storage); a equipa vê com links de 2 minutos.
- Quando a equipa pede mais documentos, o pedido mostra o motivo e um formulário para enviar o que falta (volta a "pendente").
- Histórico completo de cada pedido (estados, motivos, datas).

## Finalidades e documentos obrigatórios (servidor e cliente usam as mesmas regras)
| Finalidade | Obrigatório |
|---|---|
| identidade (geral) | pelo menos 1 ficheiro |
| criador | documento com foto (BI, passaporte, carta, DIRE) |
| vendedor (contas/diamantes), afiliado/moderador, levantamento | documento com foto + selfie (ou selfie a segurar o documento) |

Cobertura (`kyc__verified`): vendedor/afiliado/levantamento aprovados cobrem-se entre si (todos têm documento + selfie); criador fica coberto por estes ou por criador; identidade por qualquer aprovado. A verificação de vendedor antiga aprovada continua a contar.

## Estados
`pendente → em_analise → aprovado | recusado | mais_documentos`; `mais_documentos → pendente` (o utilizador envia mais) ou `recusado`. Aprovado e recusado são finais (depois de recusado, o utilizador faz um pedido novo). Um pedido aberto por finalidade. Máx. 6 pedidos por dia.
Motivo obrigatório (mín. 5 caracteres) para aprovar, recusar e pedir documentos. Quem enviou não decide o próprio pedido.

## Bloqueios que leem o estado unificado
- `seller__verified(uuid)` = `kyc__verified(uid, 'vendedor')` → anúncios de contas/diamantes (gatilho `market_products_guard`), lojas e pagamentos a vendedores do Marketplace 3.0, `mkt_me.seller_verified`.
- Aprovar com documento com foto sobe o nível de limites (`security_settings.kyc_level`) para 2; com selfie a segurar o documento para 3 (como fazia a antiga revisão de níveis).

## Admin › KYC (`components/admin/Kyc.tsx`) e /admin/kyc
- Uma fila com tudo: pedidos novos, vendedores, níveis KYC antigos (`kyc_submissions`, bucket `kyc-docs`) e KYC das apostas (`bet_kyc`, só dados).
- Filtros por estado, finalidade, tipo de documento e datas; pesquisa por @handle, nome ou id.
- Detalhe com os documentos (links temporários), histórico completo do utilizador e decisão com motivo. O utilizador é notificado.
- Acesso: admin ou permissão **KYC_REVIEW** (`kyc_staff_perms`, dada pelo admin no fim da fila). Revisores sem papel de admin usam **/admin/kyc/**. Tudo é verificado de novo no servidor (`kyc__can_review`).
- Auditoria: `app_audit_log` (área `kyc`, antes/depois) + `audit_log`. Registam-se envios, documentos adicionados, abertura de documentos, decisões, permissões e tentativas negadas.
- KYC das apostas: aparece na fila; só o admin decide, pela função já existente `bets_admin_kyc_review` (sem alterações à lógica das apostas).

## Compatibilidade e migração
- `supabase/migrations/2026-10-21-kyc-unificado.sql` (idempotente; instalar por **/sql-kyc.html** depois do sql-afiliados).
- Copia, sem apagar, `seller_verifications` e `kyc_submissions` para `kyc_requests`/`kyc_files` (`legacy_ref` impede duplicados). As tabelas antigas ficam.
- Novos pedidos de nível 1 (telemóvel) em Segurança continuam a ir para `kyc_submissions` e aparecem na fila (gatilho `kyc_unified_mirror`); a decisão na fila atualiza a tabela antiga.
- `seller_verification_submit/me/admin_list/review` passam pela fila única; aprovar um vendedor também marca `seller_verifications` como aprovado.
- "Afiliados & verificação" já não revê documentos: mostra o número por decidir e o botão "Abrir a fila KYC".

## Testes
- `tests/kyc.test.mjs` — regras puras e ligação dos ecrãs.
- `tests/kyc-sql.test.mjs` — Postgres real em memória: migração idempotente sem perdas, RLS (utilizador não vê documentos de outros), permissões (admin/KYC_REVIEW, banido perde acesso), transições, motivo obrigatório, notificações, auditoria e bloqueio de vendedor.
