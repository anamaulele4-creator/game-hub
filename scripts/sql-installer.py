#!/usr/bin/env python3
"""Gera uma página de instalação "pelo telemóvel" (copiar partes para o SQL Editor do Supabase) a partir de um .sql.
Divide só nas fronteiras de secção ("-- N. ..."), nunca a meio de uma função.
Uso: python3 scripts/sql-installer.py supabase/migrations/2026-10-20-moderador-afiliados.sql public/sql-afiliados.html "Afiliados & moderadores" "texto"
"""
import json, re, sys

src, out, title, intro = sys.argv[1:5]
sql = open(src, encoding='utf-8').read()
lines = sql.split('\n')
sections, cur = [], []
for ln in lines:
    if re.match(r'^-- \d+\. ', ln) and cur:
        sections.append('\n'.join(cur)); cur = []
    cur.append(ln)
sections.append('\n'.join(cur))
LIMIT = 9000
parts, buf = [], ''
for s in sections:
    if buf and len(buf) + len(s) > LIMIT:
        parts.append(buf.strip() + '\n'); buf = ''
    buf += s + '\n'
if buf.strip(): parts.append(buf.strip() + '\n')
assert ''.join(p.strip() for p in parts).replace('\n', '') == sql.strip().replace('\n', '').replace('\n', ''), 'conteúdo perdido'
js = json.dumps(parts, ensure_ascii=True)
full = json.dumps(sql, ensure_ascii=True)
html = f'''<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TXAPILOG · SQL {title}</title>
<style>body{{background:#0F1A3A;color:#fff;font-family:system-ui;padding:20px;text-align:center}}button{{background:#FFC20E;border:0;color:#0B1B4D;font-size:18px;font-weight:700;padding:16px 20px;border-radius:14px;width:100%;max-width:420px;margin:6px 0}}button.ok{{background:#1f8a4c;color:#fff}}p{{color:#ccc}}#s{{margin:14px 0;font-size:17px}}a{{color:#FFC20E}}</style></head>
<body><h2>TXAPILOG · {title}</h2>
<p>{intro}</p>
<button id="all" style="font-size:20px;padding:20px">Copiar tudo e abrir o Supabase</button>
<p>Depois de abrir: apaga o que estiver no SQL Editor, cola e toca em <b>Run</b>. Pronto.</p>
<p style="margin-top:28px">Se der erro por ser grande, usa as partes abaixo.<br>Abre o <a href="https://supabase.com/dashboard/project/nmdauzpbwnepmqyafaqs/sql/new" target="_blank">SQL Editor do Supabase</a>. Para <b>cada parte, por ordem</b>:<br>1. Toca em "Copiar parte N".<br>2. No SQL Editor apaga o que lá estiver, cola e toca em <b>Run</b>.<br>3. Espera "Success" e passa à seguinte.<br>Se aparecer um aviso sobre operações destrutivas, confirma: o script é seguro e pode repetir-se.</p>
<div id="s">Pronto: {len(parts)} partes</div><div id="parts"></div>
<script>
const parts={js};
const full={full};
const ED='https://supabase.com/dashboard/project/nmdauzpbwnepmqyafaqs/sql/new';
document.getElementById('all').onclick=async()=>{{const b=document.getElementById('all');try{{await navigator.clipboard.writeText(full)}}catch(e){{const a=document.createElement('textarea');a.value=full;document.body.appendChild(a);a.select();document.execCommand('copy');a.remove()}}
  b.classList.add('ok');b.textContent='Copiado! A abrir o Supabase...';setTimeout(()=>{{location.href=ED}},600)}};
const box=document.getElementById('parts');
parts.forEach((t,i)=>{{const b=document.createElement('button');b.textContent='Copiar parte '+(i+1)+' de '+parts.length;
  b.onclick=async()=>{{try{{await navigator.clipboard.writeText(t)}}catch(e){{const a=document.createElement('textarea');a.value=t;document.body.appendChild(a);a.select();document.execCommand('copy');a.remove()}}
    b.classList.add('ok');b.textContent='Parte '+(i+1)+' copiada';document.getElementById('s').textContent=(i+1<parts.length)?'Cola a parte '+(i+1)+' no SQL Editor e toca em Run.':'Última parte! Cola, Run, e depois recarrega a app.'}};
  box.appendChild(b)}});
</script></body></html>'''
open(out, 'w', encoding='utf-8').write(html)
print(len(parts), 'partes', [len(p) for p in parts])
