#!/usr/bin/env python3
"""Gera public/sql-tudo.html (tudo, por ordem: afiliados + apostas v2 + venda de contas + Marketplace 3.0 partes 1-6 e 7+)
e public/sql-pendentes.html (só as partes 7+). Correr de novo sempre que uma migração mudar."""
import re, json, html, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def lit(page, name):
    h = open(os.path.join(ROOT, 'public', page)).read()
    m = re.search(r'const ' + name + r'\s*=\s*', h)
    dec = json.JSONDecoder()
    val, _ = dec.raw_decode(h[m.end():])
    return val
blocks = [('Afiliados e moderadores', lit('sql-afiliados.html', 'full')),
          ('Apostas v2', lit('sql-apostas.html', 'full')),
          ('Venda de contas (só criadores)', lit('sql-contas.html', 'full'))]
parts = lit('sql-marketplace.html', 'parts')
for i, p in enumerate(parts):
    blocks.append((f'Marketplace 3.0 · parte {i+1}', p if isinstance(p, str) else p.get('sql') or p.get('text')))
# Partes 7+ (agendamento de prazos, equipa da loja, pagamento direto, Creator OS): lidas dos ficheiros de migração
import glob
EXTRA = sorted(glob.glob(os.path.join(ROOT, 'supabase/migrations/2026-10-21-mkt3-[0-9][0-9]-*.sql')))
EXTRA = [f for f in EXTRA if int(os.path.basename(f).split('-')[4]) >= 7]
EXTRA_TITLES = {7: 'agendamento automático de prazos (pg_cron)', 8: 'equipa da loja', 9: 'pagamento direto M-Pesa/e-Mola no checkout', 10: 'Creator OS (perfil, recebimentos, reclamações, automações)'}
extra_blocks = []
for f in EXTRA:
    n = int(os.path.basename(f).split('-')[4])
    extra_blocks.append((f'Marketplace 3.0 · parte {n} — {EXTRA_TITLES.get(n, "")}', open(f, encoding='utf-8').read()))
blocks += extra_blocks
sql = ''.join(f"\n\n-- ############################################################\n-- {n}\n-- ############################################################\n{s}\n" for n, s in blocks)
sql = "-- TXAPILOG · SQL completo (afiliados + apostas v2 + venda de contas + Marketplace 3.0 partes 1-10). IDEMPOTENTE: pode repetir-se.\n" + sql
page = f'''<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TXAPILOG · SQL completo</title>
<style>body{{background:#0F1A3A;color:#fff;font-family:system-ui;padding:20px;text-align:center}}button{{background:#FFC20E;border:0;color:#0B1B4D;font-size:20px;font-weight:700;padding:20px;border-radius:14px;width:100%;max-width:420px;margin:8px 0}}button.ok{{background:#1f8a4c;color:#fff}}p,li{{color:#ccc}}ol{{text-align:left;max-width:520px;margin:0 auto}}textarea{{width:100%;height:50vh;background:#0B1430;color:#9fe;font:12px monospace;border-radius:10px;padding:8px}}a{{color:#FFC20E}}</style></head>
<body><h2>TXAPILOG · SQL completo</h2>
<p>Tudo num só: afiliados, apostas v2, venda de contas e Marketplace 3.0 (partes 1–10), já pela ordem certa. É seguro e pode repetir-se: não apaga dados. Tudo fica <b>desligado</b> até ligares no Admin.</p>
<button id="all">Copiar tudo e abrir o Supabase</button>
<p>No SQL Editor apaga o que estiver, cola e toca em <b>Run</b>. Se aparecer aviso, confirma. Espera por “Success”.</p>
<p><b>Depois:</b></p>
<ol><li>Admin › Apostas › Permissões: “Dar todas”. Cria um mercado e liga em Ligar/Desligar.</li><li>Admin › Utilizadores: Função <b>criador</b> para quem vende contas.</li><li>Marketplace › Gestão › Comissões: cria a regra global (ex.: 10%). Em Definições liga “Marketplace 3.0 aberto ao público”.</li><li>Só depois de testares: “Pagamentos com dinheiro real” e “Pedidos de pagamento a vendedores”.</li></ol>
<textarea readonly id="t">{html.escape(sql)}</textarea>
<script>const full={json.dumps(sql)};
document.getElementById('all').onclick=async()=>{{const b=document.getElementById('all');try{{await navigator.clipboard.writeText(full)}}catch(e){{const a=document.getElementById('t');a.select();document.execCommand('copy')}}
b.classList.add('ok');b.textContent='Copiado! A abrir o Supabase...';setTimeout(()=>{{location.href='https://supabase.com/dashboard/project/nmdauzpbwnepmqyafaqs/sql/new'}},600)}};
</script></body></html>'''
for d in ('public', 'docs'):
    open(os.path.join(ROOT, d, 'sql-tudo.html'), 'w').write(page)
print(len(sql), [n for n,_ in blocks])

# ---- sql-pendentes.html: SÓ o SQL novo (partes 7+), para quem já correu o sql-tudo anterior ----
psql = "-- TXAPILOG · SQL pendente: Marketplace 3.0 partes " + ", ".join(str(int(os.path.basename(f).split('-')[4])) for f in EXTRA) + ". IDEMPOTENTE: pode repetir-se.\n-- Pré-requisito: o SQL completo (sql-tudo.html) já corrido.\n" + ''.join(f"\n\n-- ############################################################\n-- {n}\n-- ############################################################\n{q}\n" for n, q in extra_blocks)
lis = ''.join(f'<li>{html.escape(n)}</li>' for n, _ in extra_blocks)
pp = f'''<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>TXAPILOG · SQL pendente</title>
<style>body{{background:#0F1A3A;color:#fff;font-family:system-ui;padding:20px;text-align:center}}button{{background:#FFC20E;border:0;color:#0B1B4D;font-size:20px;font-weight:700;padding:20px;border-radius:14px;width:100%;max-width:420px;margin:8px 0}}button.ok{{background:#1f8a4c;color:#fff}}p,li{{color:#ccc}}ol,ul{{text-align:left;max-width:560px;margin:0 auto}}textarea{{width:100%;height:45vh;background:#0B1430;color:#9fe;font:12px monospace;border-radius:10px;padding:8px}}a{{color:#FFC20E}}</style></head>
<body><h2>TXAPILOG · SQL pendente (só o novo)</h2>
<p>Só o que ainda não correste. Pré-requisito: o <a href="sql-tudo.html">SQL completo</a> já corrido (como fizeste). Seguro e pode repetir-se: não apaga dados.</p>
<ul>{lis}</ul>
<button id="all">Copiar e abrir o Supabase</button>
<p>No SQL Editor apaga o que estiver, cola e toca em <b>Run</b>. Se aparecer aviso, confirma. Espera por “Success”.</p>
<p><b>Depois:</b> nada a ligar para a equipa e o painel do criador. O pagamento direto M-Pesa/e-Mola usa o interruptor que já existe, “Pagamentos com dinheiro real” (Marketplace › Gestão › Definições), e só aparece se o fornecedor da carteira estiver configurado. Os prazos passam a correr sozinhos a cada 5 min.</p>
<textarea readonly id="t">{html.escape(psql)}</textarea>
<script>const full={json.dumps(psql)};
document.getElementById('all').onclick=async()=>{{const b=document.getElementById('all');try{{await navigator.clipboard.writeText(full)}}catch(e){{const a=document.getElementById('t');a.select();document.execCommand('copy')}}
b.classList.add('ok');b.textContent='Copiado! A abrir o Supabase...';setTimeout(()=>{{location.href='https://supabase.com/dashboard/project/nmdauzpbwnepmqyafaqs/sql/new'}},600)}};
</script></body></html>'''
for d in ('public', 'docs'):
    open(os.path.join(ROOT, d, 'sql-pendentes.html'), 'w').write(pp)
print('pendentes', len(psql), [n for n, _ in extra_blocks])
