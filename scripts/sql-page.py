#!/usr/bin/env python3
"""Gera uma página pública (como sql-reconcile.html) que mostra um .sql inteiro com o botão "Copiar tudo e abrir o Supabase".
Uso: python3 scripts/sql-page.py <ficheiro.sql> <saida.html> "<título>" "<introdução html>" "<passos depois html>"
"""
import html, json, sys

src, out, title, intro, after = sys.argv[1:6]
sql = open(src, encoding='utf-8').read()
full = json.dumps(sql, ensure_ascii=True)
page = f'''<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TXAPILOG · SQL {html.escape(title)}</title>
<style>body{{background:#0F1A3A;color:#fff;font-family:system-ui;padding:20px;text-align:center}}button{{background:#FFC20E;border:0;color:#0B1B4D;font-size:20px;font-weight:700;padding:20px;border-radius:14px;width:100%;max-width:420px;margin:8px 0}}button.ok{{background:#1f8a4c;color:#fff}}p,li{{color:#ccc}}ol{{text-align:left;max-width:520px;margin:0 auto}}code{{color:#9fe;word-break:break-all}}textarea{{width:100%;height:50vh;background:#0B1430;color:#9fe;font:12px monospace;border-radius:10px;padding:8px}}a{{color:#FFC20E}}</style></head>
<body><h2>TXAPILOG · {html.escape(title)}</h2>
<p>{intro}</p>
<button id="all">Copiar tudo e abrir o Supabase</button>
<p>No SQL Editor apaga o que estiver, cola e toca em <b>Run</b>. Se aparecer aviso, confirma: é seguro e pode repetir-se.</p>
<p><b>Depois:</b></p>
{after}
<textarea readonly id="t">{html.escape(sql)}</textarea>
<script>const full={full};
document.getElementById('all').onclick=async()=>{{const b=document.getElementById('all');try{{await navigator.clipboard.writeText(full)}}catch(e){{const a=document.getElementById('t');a.select();document.execCommand('copy')}}
b.classList.add('ok');b.textContent='Copiado! A abrir o Supabase...';setTimeout(()=>{{location.href='https://supabase.com/dashboard/project/nmdauzpbwnepmqyafaqs/sql/new'}},600)}};
</script></body></html>
'''
open(out, 'w', encoding='utf-8').write(page)
print(out, len(page))
