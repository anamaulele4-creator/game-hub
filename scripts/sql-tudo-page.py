#!/usr/bin/env python3
"""Gera public/sql-tudo.html: um único SQL com afiliados + apostas v2 + venda de contas + Marketplace 3.0 (partes 1-6), por ordem."""
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
sql = ''.join(f"\n\n-- ############################################################\n-- {n}\n-- ############################################################\n{s}\n" for n, s in blocks)
sql = "-- TXAPILOG · SQL completo (afiliados + apostas v2 + venda de contas + Marketplace 3.0). IDEMPOTENTE: pode repetir-se.\n" + sql
page = f'''<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TXAPILOG · SQL completo</title>
<style>body{{background:#0F1A3A;color:#fff;font-family:system-ui;padding:20px;text-align:center}}button{{background:#FFC20E;border:0;color:#0B1B4D;font-size:20px;font-weight:700;padding:20px;border-radius:14px;width:100%;max-width:420px;margin:8px 0}}button.ok{{background:#1f8a4c;color:#fff}}p,li{{color:#ccc}}ol{{text-align:left;max-width:520px;margin:0 auto}}textarea{{width:100%;height:50vh;background:#0B1430;color:#9fe;font:12px monospace;border-radius:10px;padding:8px}}a{{color:#FFC20E}}</style></head>
<body><h2>TXAPILOG · SQL completo</h2>
<p>Tudo num só: afiliados, apostas v2, venda de contas e Marketplace 3.0 (6 partes), já pela ordem certa. É seguro e pode repetir-se: não apaga dados. Tudo fica <b>desligado</b> até ligares no Admin.</p>
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
