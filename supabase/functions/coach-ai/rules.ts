// Coach IA · respostas automáticas (sem IA) — usadas quando a IA não está disponível,
// sem rede, sem sessão ou quando o limite diário acaba. O utilizador recebe SEMPRE uma resposta.
// Cópia de lib/coachRules.ts (a app). Mantém as duas iguais.

const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const has = (t: string, words: string[]) => words.some((w) => t.includes(w));

const WEAPONS: Record<string, string[]> = {
  m1887: ['Letal até ~5 m: aproxima-te com gel wall antes de entrar.', 'Treina o "drag" do centro do corpo para a cabeça no campo de treino (10 min/dia).', 'Depois dos 2 tiros, recarrega atrás de cobertura, nunca a céu aberto.'],
  awm: ['Escolhe posições altas e muda de sítio depois de cada disparo.', 'Mira 4x/8x: segura a respiração e espera o inimigo parar (fim de corrida, a lotear).', 'Leva uma SMG/shotgun como segunda arma para quando te aproximam.'],
  mp40: ['Arma de rush: entra logo depois de granada ou gel wall.', 'Spray curto e contínuo ao peito, com ligeiro puxar para baixo.', 'Ótima em zonas finais e dentro de casas.'],
  m4a1: ['Muito estável a média distância: rajadas de 3–5 balas.', 'Usa mira 2x e coronha para reduzir o recuo.', 'Agacha durante o spray para ganhar precisão.'],
  scar: ['Dano alto e recuo controlável: boa para iniciantes.', 'Mira ao peito e deixa o recuo subir para a cabeça.', 'Combina com shotgun para o curto alcance.'],
  ump: ['Dano bom contra colete: fica a curta/média distância.', 'Strafe (andar para os lados) enquanto disparas.', 'Recarrega cedo, o carregador acaba depressa.'],
  ak: ['Dano muito alto mas recuo forte: treina o controlo vertical.', 'Rajadas curtas a distâncias médias.', 'Mira 2x no máximo para não perderes o controlo.'],
  groza: ['Uma das melhores ARs: spray firme ao peito.', 'Usa coronha e cano para estabilizar.', 'Excelente em zonas finais.'],
  'desert eagle': ['Precisão acima de tudo: 1 tiro de cada vez, mira à cabeça.', 'Treina flick shots no campo de treino.', 'Boa como arma secundária para finalizar.'],
};

const WEAPON_ALIASES: [string, string][] = [['m1887', 'm1887'], ['m 1887', 'm1887'], ['awm', 'awm'], ['mp40', 'mp40'], ['mp 40', 'mp40'], ['m4a1', 'm4a1'], ['m4', 'm4a1'], ['scar', 'scar'], ['ump', 'ump'], ['ak47', 'ak'], ['ak 47', 'ak'], ['ak', 'ak'], ['groza', 'groza'], ['desert', 'desert eagle'], ['deagle', 'desert eagle']];

const WELLBEING = 'Lembra-te: 3 sessões de 30 min valem mais do que 1 de 3 horas. Bebe água e faz pausas';

export function ruleAnswer(question: string): string {
  const t = norm(question);
  const words = t.split(/[^a-z0-9]+/);

  if (has(t, ['hack', 'cheat', 'aimbot', 'mod apk', 'regedit', 'wallhack', 'diamantes gratis', 'diamante gratis', 'gerador de diamantes', 'injector', 'script'])) {
    return 'Não posso ajudar com hacks, cheats, mods ou "geradores de diamantes" — dão ban permanente e muitos roubam a tua conta.\n\nO que funciona mesmo:\n• 10 min de campo de treino por dia (mira e drag)\n• Ver os teus replays e anotar 1 erro por partida\n• Jogar com squad fixo e comunicar\n\nQueres um plano de treino de 7 dias?';
  }
  if (has(t, ['cansad', 'stress', 'tilt', 'raiva', 'sono', 'dormir', 'horas a jogar', 'viciad', 'triste', 'ansios', 'dor de cabeca', 'olhos'])) {
    return 'Isso é importante. Jogar bem também é cuidar de ti:\n• Pausa de 5–10 min a cada 45 min (olhos longe do ecrã)\n• Depois de 2 derrotas seguidas, para 15 min — o "tilt" piora a mira\n• Dorme 7–9 h: o tempo de reação cai muito sem sono\n• Água e algo para comer por perto\n\nSe te sentes mal com frequência, fala com alguém de confiança. A página Bem-estar da app tem mais dicas.';
  }

  for (const [alias, key] of WEAPON_ALIASES) {
    if (alias.includes(' ') ? t.includes(alias) : words.includes(alias)) {
      return `${key.toUpperCase()} — dicas rápidas:\n• ${WEAPONS[key].join('\n• ')}\n\n${WELLBEING}`;
    }
  }
  if (has(t, ['arma', 'armas', 'loadout'])) {
    return 'Para analisar a tua arma diz-me qual usas (ex.: M1887, AWM, MP40, M4A1, SCAR, UMP, Groza).\n\nRegra geral:\n• Uma arma de longo/médio alcance + uma de curto alcance\n• Treina 10 min/dia no campo de treino com a tua principal\n• Mira ao peito e deixa o recuo levar-te à cabeça';
  }
  if (has(t, ['sensibilidade', 'sensi', 'dpi', 'hud'])) {
    return 'Sensibilidade (ponto de partida, ajusta ±5 de cada vez):\n• Geral: 90–100\n• Mira vermelha: 85–95\n• 2x: 80–90 · 4x: 70–80 · AWM: 40–55\n\nComo afinar: no campo de treino, se passas do alvo → baixa; se não chegas → sobe. Testa 2–3 dias antes de mudar de novo. HUD: botão de disparo grande e perto do polegar.';
  }
  if (has(t, ['rotac', 'zona', 'mapa', 'bermuda', 'purgatorio', 'kalahari', 'alpine', 'nexterra', 'erangel', 'miramar', 'drop', 'aterr'])) {
    return 'Rotações:\n• Aterra longe da rota do avião para lotear em paz\n• Começa a mover-te quando a zona fecha a 1/3, não no último segundo\n• Vai pelas bordas da zona e usa veículos cedo\n• Antes de te mudares, escolhe a próxima cobertura (casa, rocha, árvore)\n• Zona final: posição alta e gel walls prontas';
  }
  if (has(t, ['efootball', 'fc mobile', 'fifa', 'futebol', 'golo', 'passe', 'defesa', 'formacao'])) {
    return 'eFootball — dicas:\n• Defende com contenção (não carregues sempre no pressing)\n• Passes curtos e rápidos; muda de flanco quando o meio está fechado\n• Formações equilibradas: 4-3-3 ou 4-2-1-3 para começar\n• Remata com o pé bom do jogador e dentro da área\n• Vê os teus replays: onde sofreste os golos?';
  }
  if (has(t, ['pubg', 'codm', 'call of duty', 'cod mobile', 'mobile legends'])) {
    return 'Dicas gerais:\n• Treina a mira 10 min antes de jogar\n• Joga sempre com auscultadores (passos e tiros)\n• Comunica: posição, inimigos, vida\n• Ajusta a sensibilidade aos poucos e mantém-na alguns dias\n\nDiz-me a tua arma ou o modo que jogas e dou-te dicas mais específicas.';
  }
  if (has(t, ['treino', 'plano', 'melhorar', 'evoluir', 'kd', 'k/d', 'rank', 'subir', 'mestre', 'heroic', 'heroico'])) {
    return 'Plano de treino (7 dias, 45 min/dia):\n• 10 min — campo de treino: mira e drag\n• 25 min — 2 partidas focadas num objetivo (ex.: sobreviver até ao top 10)\n• 10 min — rever 1 replay e anotar 1 erro\n\nDia 7: descanso ou jogo só por diversão. Mede o K/D e o top 10 no fim da semana.\n\n' + WELLBEING;
  }
  return 'Posso ajudar com:\n• Análise da tua arma (ex.: "dicas para a M1887")\n• Plano de treino semanal\n• Sensibilidade e HUD\n• Rotações e zona\n• eFootball, PUBG Mobile, CODM\n\nDiz-me o jogo e o que queres melhorar!';
}
