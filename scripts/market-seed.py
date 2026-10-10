"""Gera o catálogo inicial do marketplace (rascunhos editáveis pela Ana) para SQL e para o modo demo.
Títulos e descrições originais da TXAPILOG; fotos = arte oficial dos jogos já usada no site (art:<id>). Preço 0 = "A definir".
Uso: python3 scripts/market-seed.py  → supabase/migrations/2026-10-10-market-seed.sql + lib/marketSeed.ts"""
import json, uuid, os
NS = uuid.UUID('6f1c1d2e-7a4b-4c55-9e1a-2b7d0c9f4a10')
# (categoria, tipo, entrega, título, descrição, arte)
ITEMS = [
 ('ff','conta','manual','Conta Free Fire nível alto com passes antigos','Conta com vários passes de elite antigos. O vendedor confirma nível, skins e e-mail de recuperação antes da entrega.','ff'),
 ('ff','conta','manual','Conta Free Fire para competitivo (Mestre)','Conta já em Mestre na época atual. Entrega com troca de e-mail e vinculação acompanhada.','ff-3'),
 ('ff','moedas','automatica','Diamantes Free Fire · pacote pequeno','Recarga de diamantes pelo ID do jogador. Indica o ID na compra.','ff-2'),
 ('ff','moedas','automatica','Diamantes Free Fire · pacote grande','Recarga de diamantes pelo ID do jogador, para quem joga todos os dias.','ff-2'),
 ('ff','servico','manual','Subida de rank Free Fire (Ouro → Diamante)','Jogador competitivo sobe o teu rank em modo ranqueado. Prazo combinado antes de começar.','ff'),
 ('ff','servico','manual','Treino de mira 1 hora (Free Fire)','Sessão por chamada com rotina de sensibilidade, HUD e treino na ilha de treino.','ff-3'),
 ('ff','itens','manual','Skin de arma rara Free Fire (conta com a skin)','Conta com a skin indicada nas fotos. Confirma a skin pedida nas perguntas antes de comprar.','ff-2'),
 ('cr','conta','manual','Conta Clash Royale com cartas no máximo','Conta com várias cartas no nível máximo e deck meta pronto.','cr'),
 ('cr','moedas','automatica','Gemas Clash Royale','Gemas entregues na tua conta pela tag do jogador.','cr'),
 ('cr','servico','manual','Coaching Clash Royale para ladder','Análise de replays e ajuste do deck, 1 hora por chamada.','cr'),
 ('cr','itens','manual','Pass Royale da temporada','Ativação do Pass Royale na tua conta. Entrega combinada com o vendedor.','cr'),
 ('ef','conta','manual','Conta eFootball com plantel forte','Conta com jogadores épicos e plantel acima de 3200 de força.','ef'),
 ('ef','moedas','automatica','eFootball Coins','Moedas entregues pelo ID do utilizador eFootball.','ef'),
 ('ef','servico','manual','Coaching eFootball 1 hora','Formações, táticas e dribles para Divisão 1, por chamada.','ef'),
 ('dls','conta','manual','Conta DLS com estádio e plantel completo','Conta Dream League Soccer com estádio ampliado e plantel de alto nível.','dls'),
 ('dls','moedas','automatica','DLS Coins','Moedas Dream League Soccer na tua conta.','dls'),
 ('dls','servico','manual','Kit e logo personalizados para DLS','Desenho do equipamento e emblema do teu clube, entregue em ficheiros prontos.','dls'),
 ('fortnite','moedas','automatica','V-Bucks Fortnite','V-Bucks via cartão oficial. O código é entregue após confirmação do pagamento.','outros'),
 ('fortnite','conta','manual','Conta Fortnite com skins de temporadas antigas','Conta com skins de passes antigos. Lista completa nas fotos do vendedor.','outros'),
 ('valorant','moedas','automatica','Valorant Points','Pontos Valorant pela loja oficial, entregues como código.','outros'),
 ('valorant','servico','manual','Subida de rank Valorant','Jogador experiente joga as tuas partidas ranqueadas até ao rank combinado.','outros'),
 ('minecraft','conta','manual','Conta Minecraft Java & Bedrock','Conta original com acesso total e troca de e-mail.','outros'),
 ('minecraft','servico','manual','Servidor Minecraft configurado','Instalação e configuração de servidor com plugins à escolha.','outros'),
 ('cod','moedas','automatica','COD Points (Call of Duty Mobile)','CP entregues na tua conta Call of Duty Mobile pelo UID.','outros'),
 ('cod','conta','manual','Conta Call of Duty Mobile com armas lendárias','Conta com armas e operadores lendários. Detalhes nas perguntas.','outros'),
 ('steam','giftcard','automatica','Cartão Steam','Código de saldo Steam entregue por mensagem após a confirmação.','outros'),
 ('steam','itens','manual','Jogo Steam por oferta','O vendedor envia o jogo escolhido como oferta para a tua conta Steam.','outros'),
 ('giftcards','giftcard','automatica','Gift card Google Play','Código Google Play para compras em jogos Android.','outros'),
 ('giftcards','giftcard','automatica','Gift card PlayStation Store','Código PSN para a loja PlayStation.','outros'),
 ('moedas','moedas','automatica','Recarga de moedas para outros jogos móveis','Diz o jogo e o ID na pergunta antes de comprar; o vendedor confirma se consegue recarregar.','ff-2'),
 ('outros','servico','manual','Overlay e alertas para live de jogos','Pacote de overlay, alertas e ecrã de espera com o nome da tua equipa.','outros'),
]
rows = []
for i, (cat, kind, deliv, title, desc, art) in enumerate(ITEMS):
    rows.append({'id': str(uuid.uuid5(NS, title)), 'category': cat, 'kind': kind, 'delivery': deliv, 'title': title, 'description': desc, 'photos': ['art:' + art], 'stock': 1})
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
q = lambda s: "'" + s.replace("'", "''") + "'"
sql = ['-- Catálogo inicial do marketplace (gerado por scripts/market-seed.py). Rascunhos: não aparecem ao público até a Ana publicar.',
       '-- Preço 0 = "A definir". Idempotente (ids fixos).',
       'do $$ declare v_seller uuid := (select id from public.profiles where role = \'admin\' and not banned order by (lower(email) = \'anamaulele4@gmail.com\') desc nulls last, created_at limit 1);',
       'begin', '  if v_seller is null then return; end if;',
       '  insert into public.market_products (id, seller_id, category, kind, delivery, title, description, price_mzn, stock, photos, status) values']
vals = [f"    ({q(r['id'])}::uuid, v_seller, {q(r['category'])}, {q(r['kind'])}, {q(r['delivery'])}, {q(r['title'])}, {q(r['description'])}, 0, 1, array[{q(r['photos'][0])}], 'rascunho')" for r in rows]
sql.append(',\n'.join(vals) + '\n  on conflict (id) do nothing;')
sql += ['end $$;', '']
open(os.path.join(root, 'supabase/migrations/2026-10-10-market-seed.sql'), 'w').write('\n'.join(sql))
ts = '// Gerado por scripts/market-seed.py — catálogo inicial (rascunhos) usado no modo demo.\nimport type { SeedListing } from \'./marketApi\';\n\nexport const MARKET_SEED: SeedListing[] = ' + json.dumps(rows, ensure_ascii=False, indent=1) + ';\n'
open(os.path.join(root, 'lib/marketSeed.ts'), 'w').write(ts)
print(len(rows), 'anúncios')
