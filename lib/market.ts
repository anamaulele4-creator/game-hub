// Marketplace TXAPILOG — regras puras (categorias, câmbio, arredondamento, compra segura). Testes: tests/market.test.mjs.
// A compra segura guarda o dinheiro até o comprador confirmar a entrega. Enquanto não houver API M-Pesa/e-Mola
// o passo de pagamento fica desligado ("Nada foi cobrado") e só o admin pode registar um pagamento já confirmado.

import type { ArtId } from './gameArt';

export interface MarketCategory { key: string; name: string; art: ArtId }
export const MARKET_CATEGORIES: MarketCategory[] = [
  { key: 'ff', name: 'Free Fire', art: 'ff' },
  { key: 'cr', name: 'Clash Royale', art: 'cr' },
  { key: 'ef', name: 'eFootball', art: 'ef' },
  { key: 'dls', name: 'Dream League Soccer', art: 'dls' },
  { key: 'fortnite', name: 'Fortnite', art: 'outros' },
  { key: 'valorant', name: 'Valorant', art: 'outros' },
  { key: 'minecraft', name: 'Minecraft', art: 'outros' },
  { key: 'cod', name: 'Call of Duty', art: 'outros' },
  { key: 'steam', name: 'Steam', art: 'outros' },
  { key: 'giftcards', name: 'Gift cards', art: 'outros' },
  { key: 'moedas', name: 'Diamantes e moedas', art: 'ff-2' },
  { key: 'outros', name: 'Outros', art: 'outros' },
];
export const categoryOf = (key: string) => MARKET_CATEGORIES.find((c) => c.key === key) ?? MARKET_CATEGORIES[MARKET_CATEGORIES.length - 1];

export type ListingKind = 'conta' | 'itens' | 'moedas' | 'giftcard' | 'servico';
export const LISTING_KINDS: { key: ListingKind; name: string }[] = [
  { key: 'conta', name: 'Conta' }, { key: 'itens', name: 'Itens' }, { key: 'moedas', name: 'Moedas / diamantes' },
  { key: 'giftcard', name: 'Gift card' }, { key: 'servico', name: 'Serviço' },
];
export const kindName = (k: string) => LISTING_KINDS.find((x) => x.key === k)?.name ?? k;
export type Delivery = 'automatica' | 'manual';

/* ---------------- Câmbio ---------------- */
export type Currency = 'MZN' | 'BRL' | 'USD' | 'ZAR';
export const CURRENCIES: Currency[] = ['MZN', 'BRL', 'USD', 'ZAR'];
export const CURRENCY_SYMBOL: Record<Currency, string> = { MZN: 'MT', BRL: 'R$', USD: 'US$', ZAR: 'R' };
/** Metical por unidade de cada moeda (MZN = 1). */
export type MznRates = Record<Currency, number>;
export const FX_CACHE_MS = 12 * 3600 * 1000;
export type Rounding = 1 | 5 | 10;

/** A partir da tabela da API (base USD): MT por 1 unidade de cada moeda. */
export function mznRatesFromUsd(usdRates: Record<string, number>): MznRates | null {
  const mzn = usdRates.MZN, brl = usdRates.BRL, zar = usdRates.ZAR;
  if (!(mzn > 0 && brl > 0 && zar > 0)) return null;
  return { MZN: 1, USD: mzn, BRL: mzn / brl, ZAR: mzn / zar };
}

/** Taxas manuais do admin (MT por unidade) substituem as da API quando definidas. */
export function applyOverride(api: MznRates | null, override: Partial<Record<Currency, number | null>>): MznRates | null {
  const r = { ...(api ?? { MZN: 1, USD: 0, BRL: 0, ZAR: 0 }) };
  for (const c of CURRENCIES) { const v = override[c]; if (c !== 'MZN' && v && v > 0) r[c] = v; }
  return CURRENCIES.every((c) => r[c] > 0) ? r : null;
}

/** Arredonda para cima ao múltiplo (1, 5 ou 10 MT): o vendedor nunca recebe menos do que pediu. */
export function roundMzn(v: number, step: Rounding): number {
  if (!(v > 0)) return 0;
  return Math.ceil(Math.round(v * 100) / 100 / step) * step;
}

export function toMzn(amount: number, cur: Currency, rates: MznRates, step: Rounding): number {
  return roundMzn(amount * rates[cur], step);
}

/** Valor em MT convertido para outra moeda (para o "≈ R$ X"), 2 casas. */
export function fromMzn(mzn: number, cur: Currency, rates: MznRates): number {
  return Math.round((mzn / rates[cur]) * 100) / 100;
}

export function fmtMoney(v: number, cur: Currency): string {
  if (cur === 'MZN') return `${Math.round(v).toLocaleString('pt-PT')} MT`;
  return `${CURRENCY_SYMBOL[cur]} ${v.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* ---------------- Compra segura (escrow) ---------------- */
export type OrderStatus = 'aguarda_pagamento' | 'pago' | 'entregue' | 'concluido' | 'disputa' | 'reembolsado' | 'cancelado';
export type OrderAction = 'confirmar_pagamento' | 'entregar' | 'confirmar_rececao' | 'abrir_disputa' | 'cancelar' | 'reembolsar' | 'liberar';
export type Role = 'comprador' | 'vendedor' | 'admin';

export const ORDER_LABEL: Record<OrderStatus, string> = {
  aguarda_pagamento: 'A aguardar pagamento', pago: 'Pago · valor retido', entregue: 'Entregue · a aguardar confirmação',
  concluido: 'Concluído', disputa: 'Em disputa', reembolsado: 'Reembolsado', cancelado: 'Cancelado',
};

const FLOW: Record<OrderAction, { from: OrderStatus[]; to: OrderStatus; by: Role[] }> = {
  confirmar_pagamento: { from: ['aguarda_pagamento'], to: 'pago', by: ['admin'] },
  entregar: { from: ['pago'], to: 'entregue', by: ['vendedor'] },
  confirmar_rececao: { from: ['entregue'], to: 'concluido', by: ['comprador'] },
  abrir_disputa: { from: ['pago', 'entregue'], to: 'disputa', by: ['comprador'] },
  cancelar: { from: ['aguarda_pagamento'], to: 'cancelado', by: ['comprador', 'vendedor', 'admin'] },
  reembolsar: { from: ['disputa', 'pago'], to: 'reembolsado', by: ['admin'] },
  liberar: { from: ['disputa'], to: 'concluido', by: ['admin'] },
};

/** Próximo estado, ou null se a ação não é permitida a este papel neste estado. */
export function nextStatus(s: OrderStatus, a: OrderAction, role: Role): OrderStatus | null {
  const f = FLOW[a];
  return f.from.includes(s) && f.by.includes(role) ? f.to : null;
}

export function actionsFor(s: OrderStatus, role: Role): OrderAction[] {
  return (Object.keys(FLOW) as OrderAction[]).filter((a) => nextStatus(s, a, role));
}

/** Taxa da plataforma: null = "A definir" (não se inventa valor). */
export function feeOf(total: number, feePct: number | null): number | null {
  return feePct == null ? null : Math.round(total * feePct) / 100;
}

export function avgRating(rs: number[]): number | null {
  if (!rs.length) return null;
  return Math.round((rs.reduce((a, b) => a + b, 0) / rs.length) * 10) / 10;
}

export const PAY_DISABLED = 'Pagamentos M-Pesa/e-Mola em breve – Nada foi cobrado';
export const TBD = 'A definir';

/* ---------------- Importação CSV (admin) ---------------- */
export interface CsvListing { category: string; kind: ListingKind; title: string; description: string; price: number; currency: Currency; stock: number; delivery: Delivery }
export const CSV_HEADER = 'categoria;tipo;titulo;descricao;preco;moeda;stock;entrega';

/** Divide uma linha CSV (separador ; ou ,) respeitando aspas. */
export function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

/** Lê o catálogo colado pela Ana. Linhas inválidas voltam com o motivo (nº da linha começa em 1, contando o cabeçalho). */
export function parseCatalogCsv(text: string): { rows: CsvListing[]; errors: string[] } {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (!lines.length) return { rows: [], errors: ['Vazio.'] };
  const sep = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const head = splitCsvLine(lines[0], sep).map(norm);
  const has = head.includes('titulo');
  const idx = (k: string, d: number) => (has ? head.indexOf(k) : d);
  const col = { cat: idx('categoria', 0), kind: idx('tipo', 1), title: idx('titulo', 2), desc: idx('descricao', 3), price: idx('preco', 4), cur: idx('moeda', 5), stock: idx('stock', 6), deliv: idx('entrega', 7) };
  const rows: CsvListing[] = []; const errors: string[] = [];
  (has ? lines.slice(1) : lines).forEach((l, i) => {
    const n = i + (has ? 2 : 1);
    const c = splitCsvLine(l, sep);
    const get = (k: number) => (k >= 0 ? c[k] ?? '' : '');
    const catTxt = norm(get(col.cat));
    const cat = MARKET_CATEGORIES.find((x) => x.key === catTxt || norm(x.name) === catTxt);
    const kindTxt = norm(get(col.kind));
    const kind = LISTING_KINDS.find((x) => x.key === kindTxt || norm(x.name) === kindTxt || norm(x.name).startsWith(kindTxt));
    const title = get(col.title);
    const priceTxt = get(col.price).replace(/\s/g, '').replace(',', '.');
    const price = priceTxt === '' ? 0 : Number(priceTxt);
    const cur = (get(col.cur).toUpperCase() || 'MZN').replace('MT', 'MZN') as Currency;
    const stock = get(col.stock) === '' ? 1 : Number(get(col.stock));
    const deliv = norm(get(col.deliv)).startsWith('auto') ? 'automatica' : 'manual';
    if (!cat) { errors.push(`Linha ${n}: categoria "${get(col.cat)}" desconhecida.`); return; }
    if (!kind) { errors.push(`Linha ${n}: tipo "${get(col.kind)}" desconhecido.`); return; }
    if (title.length < 3 || title.length > 80) { errors.push(`Linha ${n}: título com 3 a 80 caracteres.`); return; }
    if (!(price >= 0) || !CURRENCIES.includes(cur)) { errors.push(`Linha ${n}: preço ou moeda inválidos.`); return; }
    if (!Number.isInteger(stock) || stock < 0) { errors.push(`Linha ${n}: stock inválido.`); return; }
    rows.push({ category: cat.key, kind: kind.key, title, description: get(col.desc).slice(0, 1000), price, currency: cur, stock, delivery: deliv });
  });
  return { rows, errors };
}
