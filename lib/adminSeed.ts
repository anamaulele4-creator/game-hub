// Dados iniciais do painel de administração (demo).
import type { Broadcast, Order, Payout, PlatformSettings, Report, AuditEntry } from './store';

const settings: PlatformSettings = {
  maintenance: false,
  maintenanceMsg: 'Estamos a melhorar o TXAPILOG. Voltamos já! 🛠️',
  banner: { on: false, text: '🏆 Liga Pro Moçambique: inscrições abertas até 20 de outubro!', tone: 'promo' },
  features: { lives: true, torneios: true, loja: true, eventos: true, canais: true, desafios: true, coach: true, anuncios: true, presentes: true, comentarios: true },
  signupsOpen: true,
};

const reports: Report[] = [
  { id: 'rp1', kind: 'clipe', target: 'c4', label: 'Quando o squad te abandona 😂', reason: 'Spam ou enganoso', by: '@dercio', date: '07/10/2026, 09:12', status: 'aberta' },
  { id: 'rp2', kind: 'comentário', target: 'cm2', label: '“Que sensibilidade usas?”', reason: 'Assédio ou bullying', by: '@kiara', date: '07/10/2026, 08:40', status: 'aberta' },
  { id: 'rp3', kind: 'utilizador', target: '@freediamonds99', label: 'Conta Spam', reason: 'Burla / diamantes grátis', by: '@mario_ff', date: '06/10/2026, 21:03', status: 'aberta' },
  { id: 'rp4', kind: 'live', target: 'l4', label: 'Squad com seguidores', reason: 'Linguagem ofensiva', by: '@shaira', date: '06/10/2026, 19:55', status: 'aberta' },
  { id: 'rp5', kind: 'anúncio', target: 'ad-pend', label: 'Auscultadores RGB', reason: 'Promete “diamantes grátis”', by: 'sistema', date: '06/10/2026, 18:20', status: 'aberta' },
];

const audit: AuditEntry[] = [
  { id: 'au-seed2', at: '06/10/2026, 18:00', actor: '@ana', action: 'Baniu utilizador', target: '@freediamonds99' },
  { id: 'au-seed1', at: '05/10/2026, 10:30', actor: '@ana', action: 'Alterou preço do plano', target: 'Premium → 149 MZN' },
];

const broadcasts: Broadcast[] = [
  { id: 'bc1', title: 'Liga Pro Moçambique', body: 'Inscrições abertas! Prémio de 60 000 MZN.', segment: 'Todos', url: '/torneios/t2', category: 'torneio', schedule: '', status: 'enviada', reach: 48210 },
];

const orders: Order[] = [
  { id: 'or1', user: '@mario_ff', items: '520 Diamantes Free Fire', total: 450, status: 'entregue', date: '2026-10-05' },
  { id: 'or2', user: '@shaira', items: 'Auscultadores Gamer RGB', total: 1850, status: 'enviado', date: '2026-10-06' },
  { id: 'or3', user: '@dercio', items: 'Gatilhos para telemóvel × 2', total: 780, status: 'pendente', date: '2026-10-07' },
];

const payouts: Payout[] = [
  { id: 'po1', creator: '@nyxff', amount: 12500, method: 'M-Pesa 84•••21', status: 'pendente', date: '2026-10-06' },
  { id: 'po2', creator: '@kazemz', amount: 4300, method: 'e-Mola 86•••09', status: 'pago', date: '2026-09-30' },
  { id: 'po3', creator: '@zuriplay', amount: 2100, method: 'M-Pesa 85•••77', status: 'aprovado', date: '2026-10-04' },
];

export const ADMIN_SEED = { settings, reports, removed: [] as string[], audit, policies: {} as Record<string, string>, broadcasts, orders, payouts };
