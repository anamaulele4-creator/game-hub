// Textos legais do TXAPILOG (exigidos pela Google Play para apps sociais / UGC).
// Editáveis no Admin › Políticas (na demo a edição fica no navegador; em produção na tabela public.policies).
import { APP_NAME, COMPANY, CONTACT_EMAIL, MIN_AGE, POLICY_DATE, SITE_URL } from './config';

export interface PolicySection { h: string; p: string[] }
export interface Policy { slug: string; title: string; emoji: string; summary: string; sections: PolicySection[] }

const E = CONTACT_EMAIL;

export const POLICIES: Policy[] = [
  {
    slug: 'privacidade', title: 'Política de Privacidade', emoji: '',
    summary: `Como o ${APP_NAME} recolhe, usa, partilha e protege os teus dados pessoais.`,
    sections: [
      { h: '1. Quem somos', p: [`O ${APP_NAME} é uma plataforma moçambicana de gaming (clipes, lives, torneios, loja e eventos) operada por ${COMPANY}. Responsável pelo tratamento de dados: ${COMPANY}. Contacto: ${E}.`] },
      { h: '2. Dados que recolhemos', p: [
        'Conta: nome, nome de utilizador, email e/ou número de telemóvel, data de nascimento (para verificar a idade mínima), província, fotografia/avatar e palavra-passe (guardada cifrada pelo fornecedor de autenticação).',
        'Conteúdo que publicas: clipes, publicações, comentários, mensagens em canais e chats de lives, denúncias.',
        'Atividade: gostos, seguidores, visualizações, inscrições em torneios, compras, missões, tempo de ecrã (funcionalidade de bem-estar).',
        'Pagamentos: valor, método (M-Pesa, e-Mola, cartão) e estado. Não guardamos o PIN nem os dados completos do cartão — são tratados pelo agregador de pagamentos.',
        'Dispositivo e técnicos: tipo de dispositivo, sistema, idioma, identificadores de notificações push, registos de erros e endereço IP (segurança e prevenção de fraude).',
        'Anúncios: impressões e cliques em anúncios patrocinados, para medir resultados e cobrar anunciantes.',
        'Mensagens diretas: conteúdo das conversas 1:1 (texto e imagens), visível apenas aos participantes; a moderação só acede a mensagens denunciadas.',
        'Segurança e carteira: dispositivos, IP e histórico de inícios de sessão, PIN de transação (guardado apenas como hash), números M-Pesa/e-Mola da lista branca e, se pedires um nível de verificação mais alto, fotografia do documento e selfie (armazenamento privado, apagados 30 dias após a decisão salvo obrigação legal).',
        'Criadores: ganhos, presentes recebidos, membros e levantamentos.',
      ] },
      { h: '3. Para que usamos', p: [
        'Prestar o serviço (conta, feed, lives, torneios, loja, bilhetes); processar pagamentos; segurança, moderação e prevenção de fraude e abuso; cumprir obrigações legais; enviar notificações que ativaste; mostrar anúncios (personalizados apenas se consentires; caso contrário, anúncios contextuais); estatísticas agregadas para melhorar a app.',
        'Base legal: execução do contrato (Termos de Uso), consentimento (anúncios personalizados, notificações push, análises opcionais), interesse legítimo (segurança e moderação) e obrigação legal.',
      ] },
      { h: '4. Com quem partilhamos', p: [
        'Fornecedores que tratam dados por nossa conta: alojamento e base de dados (Supabase), envio de email e SMS, agregador de pagamentos M-Pesa/e-Mola, notificações push (Google Firebase Cloud Messaging / Web Push).',
        'Anunciantes recebem apenas relatórios agregados (impressões, cliques, alcance por província/idade), nunca a tua identidade.',
        'Autoridades, quando a lei o exigir, incluindo denúncias obrigatórias de exploração sexual de menores.',
        'Não vendemos os teus dados pessoais.',
      ] },
      { h: '5. Conteúdo público', p: ['O teu perfil, clipes, publicações e comentários são visíveis para outros utilizadores. Podes bloquear utilizadores e apagar o teu conteúdo a qualquer momento.'] },
      { h: '6. Menores', p: [`A idade mínima é ${MIN_AGE} anos. Contas de menores de 18 anos têm mensagens diretas limitadas a quem seguem, anúncios não personalizados e compras sujeitas a autorização do encarregado de educação. Ver Normas de Segurança Infantil.`] },
      { h: '7. Conservação', p: ['Mantemos os dados enquanto a conta existir. Após pedido de eliminação, a conta é desativada de imediato e os dados são apagados em até 30 dias, exceto registos de pagamentos (guardados até 10 anos por obrigação fiscal) e dados necessários para investigar abuso ou cumprir ordens legais.'] },
      { h: '8. Segurança', p: ['Ligações cifradas (HTTPS/TLS), dados cifrados em repouso no fornecedor, controlo de acesso por regras de segurança ao nível das linhas (RLS), palavras-passe com hash e acesso administrativo registado num log de auditoria.'] },
      { h: '9. Os teus direitos', p: [`Aceder, corrigir, exportar e apagar os teus dados; retirar consentimentos; opor-te a anúncios personalizados. Em Definições ou por email para ${E}. Respondemos em até 30 dias. Eliminação: ${SITE_URL}/eliminar-conta/`] },
      { h: '10. Transferências internacionais', p: ['Os nossos fornecedores podem alojar dados fora de Moçambique (ex.: UE/EUA), com garantias contratuais adequadas.'] },
      { h: '11. Alterações', p: [`Avisamos na app antes de alterações importantes. Última atualização: ${POLICY_DATE}.`] },
    ],
  },
  {
    slug: 'termos', title: 'Termos de Uso', emoji: '',
    summary: `Regras de utilização do ${APP_NAME}. Ao criar conta aceitas estes termos.`,
    sections: [
      { h: '1. Aceitação', p: [`Ao usar o ${APP_NAME} aceitas estes Termos, a Política de Privacidade e as Diretrizes da Comunidade. Tens de ter pelo menos ${MIN_AGE} anos. Menores de 18 precisam de autorização do encarregado de educação para compras.`] },
      { h: '2. A tua conta', p: ['És responsável pela segurança da conta e pela informação verdadeira. Uma pessoa, uma conta pessoal. Não partilhes códigos de verificação.'] },
      { h: '3. O teu conteúdo', p: ['Manténs os direitos sobre o que publicas. Dás-nos uma licença não exclusiva, gratuita e mundial para alojar, mostrar e distribuir esse conteúdo dentro do serviço e na sua promoção. Só publicas conteúdo que tens direito a partilhar.'] },
      { h: '4. Condutas proibidas', p: ['Violar as Diretrizes da Comunidade; burlas (ex.: “diamantes grátis”), venda de contas roubadas, batota/hacks, assédio, discurso de ódio, conteúdo sexual, exploração de menores, violência, spam, violação de direitos de autor e tentativa de aceder a dados de terceiros.'] },
      { h: '5. Moderação', p: ['Podemos remover conteúdo, limitar, suspender ou banir contas que violem as regras. Podes contestar por email. Denúncias são revistas normalmente em 24 h.'] },
      { h: '6. Compras, moedas e torneios', p: ['Preços em Meticais (MZN) com IVA incluído, sempre mostrados antes de pagar. Moedas e presentes são bens digitais sem valor fora da app e não são convertíveis em dinheiro, exceto levantamentos de criadores elegíveis. Torneios com inscrição paga são competições de habilidade; regras e distribuição de prémios aparecem em cada torneio. Ver Política de Reembolsos.'] },
      { h: '7. Assinaturas', p: ['Planos mensais renovam automaticamente até cancelares. Podes cancelar a qualquer momento no Perfil; o acesso mantém-se até ao fim do período pago.'] },
      { h: '8. Anúncios', p: ['Anunciantes são responsáveis pelos seus anúncios, que passam por revisão. Não são permitidos anúncios enganosos, de jogos de azar, álcool/tabaco para menores, ou conteúdo para adultos.'] },
      { h: '9. Limitação de responsabilidade', p: ['O serviço é fornecido “tal como está”. Não somos responsáveis por perdas indiretas nem por conteúdo de terceiros, na medida permitida pela lei moçambicana.'] },
      { h: '10. Lei aplicável', p: [`Lei da República de Moçambique. Contacto: ${E}. Última atualização: ${POLICY_DATE}.`] },
    ],
  },
  {
    slug: 'diretrizes', title: 'Diretrizes da Comunidade', emoji: '',
    summary: 'O que é e não é permitido no TXAPILOG. Respeito acima de tudo.',
    sections: [
      { h: 'Respeito', p: ['Sem assédio, bullying, ameaças, discurso de ódio (raça, etnia, religião, género, orientação sexual, deficiência, origem) nem doxxing (publicar dados pessoais de outros).'] },
      { h: 'Segurança de menores', p: ['Tolerância zero para qualquer conteúdo que sexualize menores, aliciamento (grooming) ou pedidos de imagens. Estas contas são banidas e denunciadas às autoridades.'] },
      { h: 'Conteúdo sexual e violento', p: ['Proibida nudez e conteúdo sexual. Violência real gráfica, automutilação e incentivo a suicídio são proibidos. Violência de videojogos é permitida.'] },
      { h: 'Jogo limpo', p: ['Sem hacks, batota, emuladores onde proibido, venda/compra de contas roubadas, burlas de diamantes ou recargas falsas.'] },
      { h: 'Spam e enganos', p: ['Sem spam, links maliciosos, sorteios falsos, esquemas de pirâmide ou apostas.'] },
      { h: 'Propriedade intelectual', p: ['Publica apenas conteúdo teu ou que tens autorização para usar.'] },
      { h: 'Como denunciar', p: ['Toca em ⋯ em qualquer clipe, publicação, comentário, live ou perfil → Denunciar. Podes também Bloquear o utilizador. Revemos em até 24 h.'] },
      { h: 'Consequências', p: ['Aviso, remoção de conteúdo, restrição de funcionalidades, suspensão temporária ou banimento permanente, conforme a gravidade.'] },
    ],
  },
  {
    slug: 'seguranca-infantil', title: 'Normas de Segurança Infantil (CSAE)', emoji: '',
    summary: 'Normas publicadas contra o abuso e a exploração sexual de crianças (CSAE), exigidas pela Google Play.',
    sections: [
      { h: 'Compromisso', p: [`O ${APP_NAME} proíbe de forma absoluta qualquer forma de abuso e exploração sexual de crianças (CSAE) e material de abuso sexual infantil (CSAM), incluindo aliciamento (grooming), sextorsão, tráfico e sexualização de menores.`] },
      { h: 'Idade mínima e proteções', p: [`Idade mínima de ${MIN_AGE} anos com verificação da data de nascimento no registo. Para menores de 18: mensagens diretas apenas de quem seguem, perfil com menos exposição, sem anúncios personalizados, compras com autorização do encarregado, silêncio noturno ativo por defeito.`] },
      { h: 'Deteção e moderação', p: ['Denúncia disponível em todo o conteúdo e perfis, com categoria “Segurança de menores” tratada com prioridade máxima. Moderação humana, filtros de palavras e revisão de anúncios. Contas infratoras são banidas de imediato e o conteúdo preservado para as autoridades.'] },
      { h: 'Denúncia às autoridades', p: ['Reportamos casos confirmados de CSAM às autoridades competentes em Moçambique (PRM — Polícia da República de Moçambique, Gabinete de Atendimento à Família e Menores Vítimas de Violência) e ao NCMEC / organismos internacionais aplicáveis, conforme a lei.'] },
      { h: 'Contacto para segurança infantil', p: [`Ponto de contacto designado: ${E} (assunto: “Segurança Infantil”). Respondemos com prioridade. Em perigo imediato, contacta a polícia (119) ou a Linha Fala Criança (116).`] },
      { h: 'Conformidade', p: [`Cumprimos as leis aplicáveis de proteção de menores e as políticas da Google Play sobre normas de segurança infantil. Última atualização: ${POLICY_DATE}.`] },
    ],
  },
  {
    slug: 'seguranca-dados', title: 'Segurança dos Dados (resumo)', emoji: '',
    summary: 'Resumo para a secção “Segurança dos dados” da Google Play: o que é recolhido, partilhado e porquê.',
    sections: [
      { h: 'Dados recolhidos', p: [
        'Informações pessoais: nome, email, telemóvel, ID de utilizador, data de nascimento — funcionalidade da app, gestão de conta, segurança. Obrigatório.',
        'Informações financeiras: histórico de compras — funcionalidade, prevenção de fraude. (Dados de cartão/PIN tratados pelo agregador, não por nós.)',
        'Fotos e vídeos / conteúdo gerado pelo utilizador: clipes, publicações, comentários — funcionalidade. Opcional.',
        'Mensagens na app: chats de lives e canais — funcionalidade, moderação.',
        'Atividade na app: interações, pesquisas, conteúdo visto — funcionalidade, análises, anúncios.',
        'Localização aproximada: província (indicada por ti) — segmentação de anúncios e torneios. Não recolhemos GPS.',
        'Identificadores do dispositivo: token de notificações push — notificações.',
        'Registos de falhas e diagnóstico — análises, segurança.',
      ] },
      { h: 'Partilha', p: ['Não vendemos dados. Partilhamos com fornecedores de serviço (alojamento, pagamentos, email/SMS, push) que atuam por nossa conta. Anunciantes recebem apenas dados agregados.'] },
      { h: 'Práticas de segurança', p: ['Dados cifrados em trânsito (HTTPS). Podes pedir a eliminação dos dados na app (Definições › Eliminar conta) ou na web: ' + SITE_URL + '/eliminar-conta/'] },
    ],
  },
  {
    slug: 'cookies', title: 'Cookies, Armazenamento e Anúncios', emoji: '',
    summary: 'Como usamos armazenamento local e como funcionam os anúncios patrocinados.',
    sections: [
      { h: 'Armazenamento local', p: ['Usamos armazenamento local do navegador/dispositivo (localStorage, cache do service worker) para manter a sessão, preferências, funcionamento offline e a versão de demonstração. Não usamos cookies de terceiros para rastreio entre sites.'] },
      { h: 'Anúncios patrocinados', p: ['Alguns itens no feed e nos clipes são anúncios, marcados claramente como “Patrocinado”. São vendidos pelo próprio TXAPILOG a anunciantes através do Gestor de Anúncios. Não usamos redes de anúncios de terceiros.'] },
      { h: 'Personalização', p: ['Com o teu consentimento, usamos idade, província, jogos que segues e interesses para escolher anúncios. Sem consentimento (e sempre para menores de 18), mostramos apenas anúncios contextuais. Podes mudar em Definições › Privacidade.'] },
      { h: 'Premium', p: ['Assinantes Premium não veem anúncios.'] },
    ],
  },
  {
    slug: 'reembolsos', title: 'Política de Reembolsos (bens digitais)', emoji: '',
    summary: 'Quando e como podes pedir reembolso de moedas, planos, inscrições e bilhetes.',
    sections: [
      { h: 'Princípio', p: ['Preço final sempre visível antes de pagar, sem custos escondidos. Cancelar uma assinatura é um toque.'] },
      { h: 'Moedas e presentes', p: ['Moedas não usadas: reembolso total até 14 dias após a compra. Moedas já gastas em presentes não são reembolsáveis, exceto erro técnico ou cobrança indevida.'] },
      { h: 'Assinaturas', p: ['Podes cancelar a qualquer momento; não há renovação seguinte. Reembolso proporcional se pedires nos primeiros 7 dias da primeira subscrição ou em caso de falha do serviço.'] },
      { h: 'Inscrições em torneios', p: ['Reembolso total se cancelares até 24 h antes do início ou se o torneio for cancelado/adiado pelo organizador. Sem reembolso após o check-in ou em caso de desqualificação por batota.'] },
      { h: 'Bilhetes de eventos', p: ['Reembolso total se o evento for cancelado. Troca de titular gratuita até 48 h antes.'] },
      { h: 'Loja / marketplace', p: ['Bens físicos: devolução em 7 dias se o produto chegar danificado ou diferente do anunciado. Diamantes/recargas: reembolso se não forem entregues em 24 h.'] },
      { h: 'Como pedir', p: [`Perfil › Compras › Pedir reembolso, ou email para ${E} com o ID do recibo. Reembolsos são devolvidos ao mesmo método (M-Pesa/e-Mola/cartão) em até 10 dias úteis. Compras feitas pela Google Play seguem também a política de reembolsos da Google Play.`] },
    ],
  },
  {
    slug: 'eliminar-conta', title: 'Eliminação de Conta e Dados', emoji: '',
    summary: 'Como eliminar a tua conta do TXAPILOG e os dados associados, na app ou nesta página.',
    sections: [
      { h: 'Na app', p: ['Definições › Conta › Eliminar conta. Confirmas com um código enviado para o teu email ou telemóvel. A conta é desativada imediatamente.'] },
      { h: 'Sem acesso à app', p: [`Preenche o formulário abaixo ou envia email para ${E} com o assunto “Eliminar conta” e o teu nome de utilizador, email ou telemóvel associado. Podemos pedir confirmação para proteger a tua conta.`] },
      { h: 'O que é apagado', p: ['Perfil, email, telemóvel, data de nascimento, clipes, publicações, comentários, mensagens, seguidores, gostos, guardados, progresso (XP, missões, conquistas), preferências e tokens de notificações.'] },
      { h: 'O que é mantido e por quanto tempo', p: ['Registos de pagamentos e faturas: até 10 anos (obrigação fiscal). Registos de moderação de contas banidas por abuso grave ou CSAE: o necessário para cumprir a lei. Dados agregados e anónimos de estatísticas.'] },
      { h: 'Prazo', p: ['Eliminação completa em até 30 dias após o pedido. Também podes pedir para apagar apenas alguns dados (ex.: clipes ou histórico) sem eliminar a conta.'] },
    ],
  },
];

export const POLICY_LINKS = POLICIES.map((p) => ({ href: `/${p.slug}`, label: p.title, emoji: p.emoji }));

export function policy(slug: string) {
  return POLICIES.find((p) => p.slug === slug)!;
}

/** Converte o texto editado no Admin (## Título + parágrafos separados por linha em branco) em secções. */
export function parsePolicyText(t: string): PolicySection[] {
  const out: PolicySection[] = [];
  let cur: PolicySection | null = null;
  for (const block of t.split(/\n\s*\n/)) {
    const lines = block.trim().split('\n');
    if (!lines[0]) continue;
    if (lines[0].startsWith('## ')) {
      cur = { h: lines[0].slice(3).trim(), p: [] };
      out.push(cur);
      const rest = lines.slice(1).join(' ').trim();
      if (rest) cur.p.push(rest);
    } else {
      if (!cur) { cur = { h: '', p: [] }; out.push(cur); }
      cur.p.push(lines.join(' ').trim());
    }
  }
  return out;
}

export function policyToText(p: Policy) {
  return p.sections.map((s) => `## ${s.h}\n\n${s.p.join('\n\n')}`).join('\n\n');
}
