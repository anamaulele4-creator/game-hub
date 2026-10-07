// Dados de demonstração (mock). Tudo fica no localStorage do navegador.

export type Division = 'Bronze' | 'Prata' | 'Ouro' | 'Platina' | 'Diamante' | 'Mestre' | 'Lenda';

export interface Idol {
  id: string;
  name: string;
  handle: string;
  game: string;
  avatar: string; // emoji
  color: string;
  followers: number;
  verified: boolean;
  bio: string;
  division: Division;
  rank: number;
  achievements: string[];
  team?: string;
}

export interface Clip {
  id: string;
  idolId: string;
  title: string;
  game: string;
  video?: string;
  gradient: string;
  emoji: string;
  likes: number;
  comments: number;
  shares: number;
  views: number;
  tags: string[];
}

export interface Live {
  id: string;
  idolId: string;
  title: string;
  game: string;
  viewers: number;
  gradient: string;
  featured?: boolean;
  startedMin: number;
}

export interface Tournament {
  id: string;
  name: string;
  game: string;
  mode: string;
  fee: number; // MZN, 0 = grátis
  prize: number;
  slots: number;
  filled: number;
  date: string;
  status: 'aberto' | 'a decorrer' | 'terminado';
  organizer: string;
  rules: string[];
  gradient: string;
}

export interface Post {
  id: string;
  idolId: string;
  text: string;
  emoji: string;
  likes: number;
  comments: number;
  time: string;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  category: 'Diamantes' | 'Acessórios' | 'Roupa' | 'Contas' | 'Serviços';
  seller: string;
  emoji: string;
  stock: number;
  rating: number;
}

export interface GHEvent {
  id: string;
  name: string;
  place: string;
  date: string;
  price: number;
  vipPrice: number;
  emoji: string;
  desc: string;
  left: number;
}

export interface Plan {
  id: string;
  name: string;
  price: number;
  period: string;
  emoji: string;
  perks: string[];
  highlight?: boolean;
}

export interface Channel {
  id: string;
  name: string;
  members: number;
  emoji: string;
  desc: string;
  topic: string;
}

export interface Lesson {
  id: string;
  title: string;
  level: 'Iniciante' | 'Intermédio' | 'Avançado';
  minutes: number;
  emoji: string;
  premium: boolean;
  steps: string[];
}

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  emoji: string;
  xp: number;
}

export interface Mission {
  id: string;
  name: string;
  goal: number;
  xp: number;
  emoji: string;
  action: MissionAction;
}

export type MissionAction = 'watch' | 'like' | 'comment' | 'share' | 'follow';

export interface Notif {
  id: string;
  type: 'live' | 'social' | 'torneio' | 'sistema' | 'compra';
  text: string;
  time: string;
  href: string;
  read: boolean;
}

export interface AdminUser {
  id: string;
  name: string;
  handle: string;
  plan: string;
  verified: boolean;
  banned: boolean;
  premium: boolean;
  joined: string;
}

export const GRADIENTS = [
  'from-fuchsia-600 via-purple-700 to-indigo-900',
  'from-cyan-500 via-blue-700 to-purple-900',
  'from-pink-500 via-rose-600 to-purple-900',
  'from-lime-400 via-emerald-600 to-cyan-900',
  'from-amber-400 via-orange-600 to-fuchsia-900',
  'from-violet-500 via-purple-800 to-black',
];

export const IDOLS: Idol[] = [
  { id: 'nyx', name: 'Nyx Matola', handle: '@nyxff', game: 'Free Fire', avatar: '🦊', color: '#b14dff', followers: 184300, verified: true, bio: 'Rusher de Matola. Campeã MZ Free Fire Cup 2025. Lives todas as noites às 20h.', division: 'Lenda', rank: 1, achievements: ['Campeã MZ Cup 2025', 'Top 10 África', '1M de visualizações'], team: 'Mambas Esports' },
  { id: 'kaze', name: 'Kaze', handle: '@kazemz', game: 'Free Fire', avatar: '🐉', color: '#00e5ff', followers: 132900, verified: true, bio: 'Sniper. Coach da Escola Free Fire. Partilho dicas todos os dias.', division: 'Mestre', rank: 2, achievements: ['MVP Liga Sul', '500 kills com AWM'], team: 'Mambas Esports' },
  { id: 'zuri', name: 'Zuri Play', handle: '@zuriplay', game: 'eFootball', avatar: '⚽', color: '#9dff3a', followers: 98700, verified: true, bio: 'eFootball e FIFA. Torneios de Maputo à Beira.', division: 'Diamante', rank: 3, achievements: ['Taça Beira 2025'] },
  { id: 'tembo', name: 'Tembo', handle: '@tembogg', game: 'PUBG Mobile', avatar: '🐘', color: '#ff2bd6', followers: 76400, verified: false, bio: 'Estratégia, zona e calma. Squad Tembo sempre unida.', division: 'Platina', rank: 4, achievements: ['Top 3 PUBG MZ'], team: 'Squad Tembo' },
  { id: 'lua', name: 'Lua Gamer', handle: '@luagamer', game: 'Free Fire', avatar: '🌙', color: '#ffc14d', followers: 64100, verified: true, bio: 'Clipes engraçados e momentos épicos. Bem-estar acima de tudo 💜', division: 'Diamante', rank: 5, achievements: ['Criadora do mês'] },
  { id: 'rocha', name: 'Rocha', handle: '@rochamz', game: 'Call of Duty Mobile', avatar: '🪨', color: '#6ea8ff', followers: 41800, verified: false, bio: 'CODM ranqueado. Desafia-me se tiveres coragem.', division: 'Ouro', rank: 6, achievements: ['Lendário CODM'] },
];

const MDN = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/';

export const CLIPS: Clip[] = [
  { id: 'c1', idolId: 'nyx', title: 'Booyah com 1 de vida 😱', game: 'Free Fire', video: MDN + 'flower.mp4', gradient: GRADIENTS[0], emoji: '🔥', likes: 12400, comments: 342, shares: 210, views: 88000, tags: ['booyah', 'clutch'] },
  { id: 'c2', idolId: 'kaze', title: 'AWM de outro planeta', game: 'Free Fire', gradient: GRADIENTS[1], emoji: '🎯', likes: 9800, comments: 201, shares: 140, views: 61000, tags: ['sniper'] },
  { id: 'c3', idolId: 'zuri', title: 'Golo de bicicleta no último minuto', game: 'eFootball', video: MDN + 'friday.mp4', gradient: GRADIENTS[3], emoji: '⚽', likes: 7600, comments: 156, shares: 98, views: 43000, tags: ['golo'] },
  { id: 'c4', idolId: 'lua', title: 'Quando o squad te abandona 😂', game: 'Free Fire', gradient: GRADIENTS[2], emoji: '😂', likes: 15200, comments: 512, shares: 430, views: 120000, tags: ['humor'] },
  { id: 'c5', idolId: 'tembo', title: 'Zona final perfeita', game: 'PUBG Mobile', gradient: GRADIENTS[4], emoji: '🪂', likes: 5100, comments: 88, shares: 45, views: 29000, tags: ['estratégia'] },
  { id: 'c6', idolId: 'rocha', title: '1v4 no Nuketown', game: 'Call of Duty Mobile', gradient: GRADIENTS[5], emoji: '💥', likes: 4300, comments: 67, shares: 39, views: 22000, tags: ['clutch'] },
];

export const LIVES: Live[] = [
  { id: 'l1', idolId: 'nyx', title: 'Ranqueada até Mestre 🔥 Desafios do chat', game: 'Free Fire', viewers: 4820, gradient: GRADIENTS[0], featured: true, startedMin: 47 },
  { id: 'l2', idolId: 'zuri', title: 'Final da Taça Maputo eFootball', game: 'eFootball', viewers: 2130, gradient: GRADIENTS[3], startedMin: 22 },
  { id: 'l3', idolId: 'kaze', title: 'Escola ao vivo: posicionamento', game: 'Free Fire', viewers: 1650, gradient: GRADIENTS[1], startedMin: 65 },
  { id: 'l4', idolId: 'tembo', title: 'Squad com seguidores', game: 'PUBG Mobile', viewers: 890, gradient: GRADIENTS[4], startedMin: 12 },
];

export const TOURNAMENTS: Tournament[] = [
  { id: 't1', name: 'Copa Mambas Free Fire', game: 'Free Fire', mode: 'Squad 4v4', fee: 0, prize: 15000, slots: 48, filled: 39, date: '2026-10-18 18:00', status: 'aberto', organizer: 'Mambas Esports', rules: ['Equipas de 4 jogadores', 'Nível mínimo 40', 'Proibido emulador', 'Check-in 30 min antes'], gradient: GRADIENTS[0] },
  { id: 't2', name: 'Liga Pro Moçambique', game: 'Free Fire', mode: 'Squad 4v4', fee: 250, prize: 60000, slots: 32, filled: 21, date: '2026-10-25 17:00', status: 'aberto', organizer: 'GAME HUB', rules: ['Inscrição por equipa: 250 MZN', 'Prémio dividido 50/30/20', 'Transmissão em direto'], gradient: GRADIENTS[1] },
  { id: 't3', name: 'Taça Beira eFootball', game: 'eFootball', mode: '1v1', fee: 100, prize: 20000, slots: 64, filled: 64, date: '2026-10-11 15:00', status: 'a decorrer', organizer: 'Zuri Play', rules: ['Eliminação direta', 'Jogos de 10 minutos'], gradient: GRADIENTS[3] },
  { id: 't4', name: 'PUBG Sunset Cup', game: 'PUBG Mobile', mode: 'Squad', fee: 0, prize: 8000, slots: 25, filled: 25, date: '2026-09-27 19:00', status: 'terminado', organizer: 'Squad Tembo', rules: ['Pontos por kill e posição'], gradient: GRADIENTS[4] },
];

export const POSTS: Post[] = [
  { id: 'p1', idolId: 'nyx', text: 'Hoje às 20h live especial: quem me vencer num 1v1 ganha 100 diamantes! 💎', emoji: '📣', likes: 3200, comments: 410, time: 'há 1 h' },
  { id: 'p2', idolId: 'kaze', text: 'Dica do dia: nunca saltes no centro do mapa no início. Rota pelas margens = mais loot e menos stress.', emoji: '💡', likes: 2100, comments: 120, time: 'há 3 h' },
  { id: 'p3', idolId: 'lua', text: 'Lembrete de bem-estar: bebe água, faz pausa a cada hora. O rank espera por ti 💜', emoji: '💧', likes: 4500, comments: 230, time: 'há 5 h' },
  { id: 'p4', idolId: 'zuri', text: 'Inscrições abertas para a Taça Beira! Vagas a esgotar.', emoji: '🏆', likes: 980, comments: 54, time: 'ontem' },
  { id: 'p5', idolId: 'tembo', text: 'Procuramos 1 jogador para a Squad Tembo. Requisitos: Platina+, microfone.', emoji: '🤝', likes: 640, comments: 77, time: 'ontem' },
];

export const PRODUCTS: Product[] = [
  { id: 'pr1', name: '520 Diamantes Free Fire', price: 450, category: 'Diamantes', seller: 'GAME HUB', emoji: '💎', stock: 999, rating: 4.9 },
  { id: 'pr2', name: '1060 Diamantes Free Fire', price: 880, category: 'Diamantes', seller: 'GAME HUB', emoji: '💎', stock: 999, rating: 4.9 },
  { id: 'pr3', name: 'Auscultadores Gamer RGB', price: 1850, category: 'Acessórios', seller: 'TechMaputo', emoji: '🎧', stock: 14, rating: 4.6 },
  { id: 'pr4', name: 'Gatilhos para telemóvel', price: 390, category: 'Acessórios', seller: 'TechMaputo', emoji: '🎮', stock: 40, rating: 4.4 },
  { id: 'pr5', name: 'Camisola Mambas Esports', price: 1200, category: 'Roupa', seller: 'Mambas Esports', emoji: '👕', stock: 22, rating: 4.8 },
  { id: 'pr6', name: 'Sessão de coaching 1h (Kaze)', price: 700, category: 'Serviços', seller: 'Kaze', emoji: '🧑‍🏫', stock: 8, rating: 5.0 },
  { id: 'pr7', name: 'Ventoinha para telemóvel', price: 650, category: 'Acessórios', seller: 'GadgetBeira', emoji: '❄️', stock: 30, rating: 4.3 },
  { id: 'pr8', name: 'Boné Neon GAME HUB', price: 550, category: 'Roupa', seller: 'GAME HUB', emoji: '🧢', stock: 50, rating: 4.7 },
];

export const EVENTS: GHEvent[] = [
  { id: 'e1', name: 'GAME HUB Fest Maputo', place: 'Centro de Conferências Joaquim Chissano, Maputo', date: '2026-11-21 10:00', price: 300, vipPrice: 900, emoji: '🎪', desc: 'Torneios ao vivo, meet & greet com ídolos, zona de jogos e música.', left: 420 },
  { id: 'e2', name: 'Noite eFootball Beira', place: 'Beira Shopping, Beira', date: '2026-11-07 18:00', price: 150, vipPrice: 450, emoji: '⚽', desc: 'Torneio presencial 1v1 com transmissão e prémios.', left: 85 },
  { id: 'e3', name: 'Workshop Criadores de Conteúdo', place: 'Online (link após compra)', date: '2026-10-30 19:00', price: 0, vipPrice: 250, emoji: '🎬', desc: 'Como gravar, editar e crescer com clipes. Bilhete VIP inclui revisão do teu canal.', left: 200 },
];

export const PLANS: Plan[] = [
  { id: 'premium', name: 'Premium', price: 149, period: 'mês', emoji: '👑', perks: ['Sem anúncios', 'Emblema Premium', 'XP x1.5', 'Aulas premium da Escola', 'Qualidade HD nas lives'], highlight: true },
  { id: 'criador', name: 'Criador Pro', price: 349, period: 'mês', emoji: '🎬', perks: ['Estatísticas avançadas', 'Monetização de lives (presentes)', 'Clipes até 3 min', 'Destaque no Para ti 1x/semana'] },
  { id: 'equipas', name: 'Equipas', price: 599, period: 'mês', emoji: '🛡️', perks: ['Página de equipa', 'Até 10 membros', 'Inscrição prioritária em torneios', 'Treinos agendados'] },
  { id: 'verificacao', name: 'Verificação', price: 499, period: 'pagamento único', emoji: '✅', perks: ['Selo verificado', 'Revisão manual em 72 h', 'Proteção contra imitadores'] },
  { id: 'coach', name: 'Coach IA', price: 199, period: 'mês', emoji: '🤖', perks: ['Análise das tuas partidas (demo)', 'Plano de treino semanal', 'Dicas personalizadas por arma e mapa'] },
];

export const CHANNELS: Channel[] = [
  { id: 'ch1', name: 'Free Fire Moçambique', members: 24800, emoji: '🔥', desc: 'Tudo sobre Free Fire em MZ: squads, dicas, torneios.', topic: 'Free Fire' },
  { id: 'ch2', name: 'eFootball MZ', members: 9100, emoji: '⚽', desc: 'Liga da comunidade e resultados.', topic: 'eFootball' },
  { id: 'ch3', name: 'Procura de Squad', members: 15200, emoji: '🤝', desc: 'Encontra colegas de equipa ao teu nível.', topic: 'Comunidade' },
  { id: 'ch4', name: 'Criadores', members: 4300, emoji: '🎬', desc: 'Edição, gravação e crescimento.', topic: 'Criadores' },
  { id: 'ch5', name: 'PUBG & CODM', members: 7600, emoji: '🪖', desc: 'Battle royale e FPS mobile.', topic: 'PUBG/CODM' },
];

export const LESSONS: Lesson[] = [
  { id: 's1', title: 'Sensibilidade ideal para o teu telemóvel', level: 'Iniciante', minutes: 6, emoji: '📱', premium: false, steps: ['Abre Definições > Sensibilidade', 'Geral entre 90-100', 'Mira vermelha 85-95', 'Testa no campo de treino 5 minutos'] },
  { id: 's2', title: 'Gel wall rápido', level: 'Iniciante', minutes: 8, emoji: '🧊', premium: false, steps: ['Usa o botão de gel no lado direito', 'Pratica 3 géis seguidos', 'Combina com agachar'] },
  { id: 's3', title: 'Rotação e zona segura', level: 'Intermédio', minutes: 10, emoji: '🗺️', premium: false, steps: ['Observa o primeiro círculo', 'Rota pelas margens', 'Guarda veículos para a 3.ª zona'] },
  { id: 's4', title: 'Comunicação de squad', level: 'Intermédio', minutes: 7, emoji: '🎙️', premium: false, steps: ['Chamadas curtas: direção + distância', 'Um líder por partida', 'Marca loot importante'] },
  { id: 's5', title: 'Movimento avançado e drag headshot', level: 'Avançado', minutes: 12, emoji: '🎯', premium: true, steps: ['Arrasta para cima no momento do tiro', 'Treina com M1887 e Desert Eagle', 'Grava e revê os teus clipes'] },
  { id: 's6', title: 'Mentalidade de campeão', level: 'Avançado', minutes: 9, emoji: '🧠', premium: true, steps: ['Define metas por sessão', 'Faz pausas entre partidas ranqueadas', 'Analisa derrotas sem culpa'] },
];

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'a1', name: 'Primeiro Passo', desc: 'Entra no GAME HUB', emoji: '👣', xp: 50 },
  { id: 'a2', name: 'Fã Número 1', desc: 'Segue o teu primeiro ídolo', emoji: '💜', xp: 50 },
  { id: 'a3', name: 'Coração Quente', desc: 'Dá 10 likes', emoji: '❤️', xp: 100 },
  { id: 'a4', name: 'Voz da Comunidade', desc: 'Escreve 5 comentários', emoji: '💬', xp: 100 },
  { id: 'a5', name: 'Espalha a Palavra', desc: 'Partilha 3 clipes', emoji: '📤', xp: 100 },
  { id: 'a6', name: 'Colecionador', desc: 'Guarda 5 itens', emoji: '🔖', xp: 80 },
  { id: 'a7', name: 'Em Chamas', desc: 'Sequência de 3 dias', emoji: '🔥', xp: 150 },
  { id: 'a8', name: 'Semana Perfeita', desc: 'Sequência de 7 dias', emoji: '📅', xp: 300 },
  { id: 'a9', name: 'Competidor', desc: 'Inscreve-te num torneio', emoji: '🏆', xp: 150 },
  { id: 'a10', name: 'Desafiante', desc: 'Envia um desafio a outro jogador', emoji: '⚔️', xp: 100 },
  { id: 'a11', name: 'Estudante', desc: 'Conclui 3 aulas da Escola', emoji: '🎓', xp: 200 },
  { id: 'a12', name: 'Equilíbrio', desc: 'Define um limite diário de tempo', emoji: '🧘', xp: 120 },
  { id: 'a13', name: 'Missão Cumprida', desc: 'Completa as 5 missões diárias', emoji: '✅', xp: 250 },
];

export const MISSIONS: Mission[] = [
  { id: 'm1', name: 'Vê 5 clipes', goal: 5, xp: 40, emoji: '🎬', action: 'watch' },
  { id: 'm2', name: 'Dá 5 likes', goal: 5, xp: 30, emoji: '❤️', action: 'like' },
  { id: 'm3', name: 'Comenta 2 vezes', goal: 2, xp: 40, emoji: '💬', action: 'comment' },
  { id: 'm4', name: 'Partilha 1 clipe', goal: 1, xp: 30, emoji: '📤', action: 'share' },
  { id: 'm5', name: 'Segue 1 ídolo novo', goal: 1, xp: 30, emoji: '➕', action: 'follow' },
];

export const DIVISIONS: { name: Division; minXp: number; emoji: string; color: string }[] = [
  { name: 'Bronze', minXp: 0, emoji: '🥉', color: '#cd7f32' },
  { name: 'Prata', minXp: 500, emoji: '🥈', color: '#c0c0c0' },
  { name: 'Ouro', minXp: 1500, emoji: '🥇', color: '#ffd700' },
  { name: 'Platina', minXp: 3000, emoji: '💠', color: '#7fffd4' },
  { name: 'Diamante', minXp: 5000, emoji: '💎', color: '#00e5ff' },
  { name: 'Mestre', minXp: 8000, emoji: '🔮', color: '#b14dff' },
  { name: 'Lenda', minXp: 12000, emoji: '👑', color: '#ff2bd6' },
];

export const WEEKLY_RANKING = [
  { name: 'Nyx Matola', avatar: '🦊', xp: 9820 },
  { name: 'Kaze', avatar: '🐉', xp: 8710 },
  { name: 'Zuri Play', avatar: '⚽', xp: 7400 },
  { name: 'Mário_FF', avatar: '😎', xp: 5300 },
  { name: 'Tembo', avatar: '🐘', xp: 4900 },
  { name: 'Lua Gamer', avatar: '🌙', xp: 4550 },
  { name: 'Shaira', avatar: '🦋', xp: 3100 },
  { name: 'Rocha', avatar: '🪨', xp: 2650 },
  { name: 'Dércio', avatar: '🎯', xp: 1800 },
];

export const PLAYERS = [
  { id: 'u1', name: 'Mário_FF', avatar: '😎', division: 'Diamante' },
  { id: 'u2', name: 'Shaira', avatar: '🦋', division: 'Platina' },
  { id: 'u3', name: 'Dércio', avatar: '🎯', division: 'Ouro' },
  { id: 'u4', name: 'Kiara', avatar: '🌺', division: 'Prata' },
];

export const GIFTS = [
  { id: 'g1', name: 'Coração', emoji: '💜', coins: 1 },
  { id: 'g2', name: 'Fogo', emoji: '🔥', coins: 5 },
  { id: 'g3', name: 'Coroa', emoji: '👑', coins: 20 },
  { id: 'g4', name: 'Foguetão', emoji: '🚀', coins: 50 },
  { id: 'g5', name: 'Diamante', emoji: '💎', coins: 100 },
];

export const COIN_PACKS = [
  { id: 'cp1', coins: 100, price: 50 },
  { id: 'cp2', coins: 500, price: 220 },
  { id: 'cp3', coins: 1200, price: 480 },
];

export const REACTIONS = ['🔥', '😂', '🤯', '👑', '💜'] as const;
export type Reaction = (typeof REACTIONS)[number];

export const SEED_NOTIFS: Notif[] = [
  { id: 'n1', type: 'live', text: 'Nyx Matola está em direto: Ranqueada até Mestre 🔥', time: 'agora', href: '/lives/l1', read: false },
  { id: 'n2', type: 'torneio', text: 'Copa Mambas Free Fire: faltam 9 vagas', time: 'há 20 min', href: '/torneios/t1', read: false },
  { id: 'n3', type: 'social', text: 'Kaze respondeu ao teu comentário', time: 'há 1 h', href: '/clipe/c2', read: false },
  { id: 'n4', type: 'sistema', text: 'Nova missão diária disponível. Ganha até 170 XP hoje!', time: 'há 2 h', href: '/missoes', read: true },
  { id: 'n5', type: 'compra', text: 'Demo: o teu bilhete para o GAME HUB Fest está guardado', time: 'ontem', href: '/eventos', read: true },
  { id: 'n6', type: 'social', text: 'Mário_FF desafiou-te para um 1v1', time: 'ontem', href: '/desafios', read: true },
];

export const SEED_COMMENTS: Record<string, { id: string; author: string; avatar: string; text: string; likes: number; replies: { id: string; author: string; avatar: string; text: string }[] }[]> = {
  c1: [
    { id: 'cm1', author: 'Mário_FF', avatar: '😎', text: 'Isto foi insano! 🔥', likes: 120, replies: [{ id: 'r1', author: 'Nyx Matola', avatar: '🦊', text: 'Obrigada mano 💜' }] },
    { id: 'cm2', author: 'Shaira', avatar: '🦋', text: 'Que sensibilidade usas?', likes: 45, replies: [] },
  ],
  c2: [{ id: 'cm3', author: 'Dércio', avatar: '🎯', text: 'Ensina-me esse flick 😭', likes: 30, replies: [{ id: 'r2', author: 'Kaze', avatar: '🐉', text: 'Vem à Escola Free Fire, aula 5!' }] }],
  c4: [{ id: 'cm4', author: 'Kiara', avatar: '🌺', text: 'Sou eu todos os dias 😂😂', likes: 210, replies: [] }],
};

export const ADMIN_USERS: AdminUser[] = [
  { id: 'u1', name: 'Mário Cossa', handle: '@mario_ff', plan: 'Premium', verified: false, banned: false, premium: true, joined: '2026-03-02' },
  { id: 'u2', name: 'Shaira Mondlane', handle: '@shaira', plan: 'Grátis', verified: false, banned: false, premium: false, joined: '2026-05-14' },
  { id: 'u3', name: 'Dércio Langa', handle: '@dercio', plan: 'Grátis', verified: false, banned: false, premium: false, joined: '2026-06-20' },
  { id: 'u4', name: 'Nyx Matola', handle: '@nyxff', plan: 'Criador Pro', verified: true, banned: false, premium: true, joined: '2025-11-01' },
  { id: 'u5', name: 'Conta Spam', handle: '@freediamonds99', plan: 'Grátis', verified: false, banned: true, premium: false, joined: '2026-09-30' },
  { id: 'u6', name: 'Kiara Sitoe', handle: '@kiara', plan: 'Equipas', verified: false, banned: false, premium: false, joined: '2026-08-08' },
];

export const REVENUE = [
  { source: 'Planos e assinaturas', value: 184500 },
  { source: 'Inscrições em torneios', value: 62300 },
  { source: 'Presentes nas lives', value: 48900 },
  { source: 'Loja / marketplace (comissão)', value: 37200 },
  { source: 'Bilhetes de eventos', value: 91800 },
  { source: 'Anúncios e patrocínios', value: 120000 },
];

export const ADS = [
  { id: 'ad1', brand: 'Vodacom', type: 'Patrocínio Liga Pro', value: 80000, status: 'ativo' },
  { id: 'ad2', brand: 'Movitel', type: 'Banner no Início', value: 25000, status: 'ativo' },
  { id: 'ad3', brand: 'Coca-Cola MZ', type: 'Patrocínio GAME HUB Fest', value: 150000, status: 'em negociação' },
  { id: 'ad4', brand: 'TechMaputo', type: 'Produto destacado na Loja', value: 6000, status: 'pausado' },
];

export const PAYMENTS = [
  { id: 'pay1', user: '@mario_ff', item: 'Premium (mês)', amount: 149, method: 'M-Pesa', status: 'pago' },
  { id: 'pay2', user: '@kiara', item: 'Plano Equipas', amount: 599, method: 'e-Mola', status: 'pago' },
  { id: 'pay3', user: '@dercio', item: 'Liga Pro (inscrição)', amount: 250, method: 'M-Pesa', status: 'pendente' },
  { id: 'pay4', user: '@shaira', item: 'Bilhete VIP Fest', amount: 900, method: 'e-Mola', status: 'falhou' },
  { id: 'pay5', user: '@nyxff', item: 'Levantamento presentes', amount: 12500, method: 'M-Pesa', status: 'em processamento' },
];

export const COMMISSIONS = [
  { area: 'Marketplace', rate: '10%' },
  { area: 'Presentes nas lives', rate: '30% plataforma / 70% criador' },
  { area: 'Inscrições pagas em torneios', rate: '15%' },
  { area: 'Bilhetes de eventos', rate: '8%' },
  { area: 'Coaching (serviços)', rate: '20%' },
];

export function idol(id: string): Idol {
  return IDOLS.find((i) => i.id === id) ?? IDOLS[0];
}

export function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace('.', ',') + ' M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace('.', ',') + ' mil';
  return String(n);
}

export function mzn(n: number): string {
  return n === 0 ? 'Grátis' : n.toLocaleString('pt-PT') + ' MZN';
}

export function divisionFor(xp: number) {
  let d = DIVISIONS[0];
  for (const x of DIVISIONS) if (xp >= x.minXp) d = x;
  const idx = DIVISIONS.indexOf(d);
  const next = DIVISIONS[idx + 1];
  return { ...d, next };
}

export function levelFor(xp: number) {
  const level = Math.floor(xp / 250) + 1;
  const into = xp % 250;
  return { level, into, pct: Math.round((into / 250) * 100) };
}
