#!/usr/bin/env python3
"""Gera public/sql-marketplace.html: instalação do Marketplace 3.0 pelo telemóvel, em 6 partes por ordem
(cada parte = um ficheiro supabase/migrations/2026-10-21-mkt3-0N-*.sql, idempotente).
Uso: python3 scripts/sql-marketplace-page.py   (correr de novo sempre que um ficheiro mudar; o teste verifica)
"""
import glob, html, json, os

ROOT = os.path.join(os.path.dirname(__file__), '..')
files = sorted(glob.glob(os.path.join(ROOT, 'supabase/migrations/2026-10-21-mkt3-0[1-6]-*.sql')))
assert len(files) == 6, files
parts = [open(f, encoding='utf-8').read() for f in files]
names = [os.path.basename(f) for f in files]
titles = ['Base: interruptores, permissões, auditoria', 'Lojas, produtos e pesquisa', 'Comissões, carrinho, checkout e pedidos',
          'Pagamentos, carteira, reembolsos e pagamentos a vendedores', 'Mensagens, avaliações e reclamações', 'Painéis, relatórios e auditoria']
js = json.dumps(parts, ensure_ascii=True)
ED = 'https://supabase.com/dashboard/project/nmdauzpbwnepmqyafaqs/sql/new'
items = ''.join(f'<li><b>Parte {i+1}</b> · {html.escape(t)} <span class="f">({html.escape(n)})</span></li>' for i, (t, n) in enumerate(zip(titles, names)))
page = f'''<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>TXAPILOG · SQL Marketplace 3.0</title>
<style>body{{background:#0F1A3A;color:#fff;font-family:system-ui;padding:20px;text-align:center}}button{{background:#FFC20E;border:0;color:#0B1B4D;font-size:18px;font-weight:700;padding:16px 20px;border-radius:14px;width:100%;max-width:420px;margin:6px 0}}button.ok{{background:#1f8a4c;color:#fff}}p,li{{color:#ccc}}ol{{text-align:left;max-width:560px;margin:0 auto}}.f{{color:#889;font-size:12px}}#s{{margin:14px 0;font-size:17px}}a{{color:#FFC20E}}.warn{{background:#3a2a00;border:1px solid #FFC20E;border-radius:12px;padding:12px;max-width:560px;margin:12px auto;text-align:left}}</style></head>
<body><h2>TXAPILOG · Marketplace 3.0</h2>
<div class="warn"><b>Antes:</b> corre primeiro <a href="sql-afiliados.html">sql-afiliados.html</a> e <a href="sql-apostas.html">sql-apostas.html</a> (cria os interruptores e a auditoria que o Marketplace 3.0 reutiliza). Se faltar algo, a Parte 1 pára com uma mensagem a dizer o que correr.</div>
<p>É seguro e pode repetir-se: só acrescenta tabelas, colunas e funções. Não apaga dados. O formulário de anúncios e os pedidos antigos continuam a funcionar.<br>
Tudo fica <b>desligado</b> até ligares em <b>Marketplace › Gestão › Definições</b>.</p>
<p>Abre o <a href="{ED}" target="_blank" rel="noopener">SQL Editor do Supabase</a>. Para <b>cada parte, por ordem</b>: toca em “Copiar parte N”, apaga o que estiver no editor, cola e toca em <b>Run</b>. Espera “Success” e passa à seguinte.</p>
<ol>{items}</ol>
<div id="s">Pronto: 6 partes</div><div id="parts"></div>
<p style="margin-top:24px"><b>Depois:</b> na app, Marketplace › Gestão › Comissões: cria a regra global (ex.: 10%). Em Definições: liga “Marketplace 3.0 aberto ao público”; só depois de testares, liga “Pagamentos com dinheiro real” e “Pedidos de pagamento a vendedores”.</p>
<script>
const parts={js};
const box=document.getElementById('parts');
parts.forEach((t,i)=>{{const b=document.createElement('button');b.textContent='Copiar parte '+(i+1)+' de '+parts.length;
  b.onclick=async()=>{{try{{await navigator.clipboard.writeText(t)}}catch(e){{const a=document.createElement('textarea');a.value=t;document.body.appendChild(a);a.select();document.execCommand('copy');a.remove()}}
    b.classList.add('ok');b.textContent='Parte '+(i+1)+' copiada';document.getElementById('s').textContent=(i+1<parts.length)?'Cola a parte '+(i+1)+' no SQL Editor e toca em Run. Depois copia a '+(i+2)+'.':'Última parte! Cola, Run, e recarrega a app.'}};
  box.appendChild(b)}});
</script></body></html>'''
open(os.path.join(ROOT, 'public/sql-marketplace.html'), 'w', encoding='utf-8').write(page)
print('public/sql-marketplace.html', len(page), [len(p) for p in parts])
