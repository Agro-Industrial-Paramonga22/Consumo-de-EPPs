# -*- coding: utf-8 -*-
"""Cliente mínimo de Supabase para los scripts de carga.

Credenciales por variable de entorno (no se guardan en el repo):
    SUPABASE_PAT     token personal  (solo para DDL / SQL)
    SUPABASE_SECRET  clave secreta   (datos, se usa del lado servidor)

Uso:
    python scripts/importar_supabase.py --origen "C:\\ruta\\excel"
"""
import json
import os
import urllib.error
import urllib.request

REF = os.environ.get('SUPABASE_REF', 'yyzwlqtbhcbyftwwtexi')
PAT = os.environ.get('SUPABASE_PAT', '')
SECRET = os.environ.get('SUPABASE_SECRET', '')
BASE = f'https://{REF}.supabase.co'


def _req(url, data=None, headers=None, method=None, timeout=300):
    body = None if data is None else json.dumps(data).encode('utf-8')
    h = {'Content-Type': 'application/json'}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=body, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode('utf-8')
            return r.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8')


def sql(query):
    if not PAT:
        raise RuntimeError('Falta SUPABASE_PAT')
    code, out = _req(f'https://api.supabase.com/v1/projects/{REF}/database/query',
                     {'query': query}, {'Authorization': 'Bearer ' + PAT}, 'POST')
    if code >= 300:
        raise RuntimeError(f'SQL {code}: {out}')
    return out


def rest(path, method='GET', payload=None, prefer=None):
    if not SECRET:
        raise RuntimeError('Falta SUPABASE_SECRET')
    return _req(f'{BASE}/rest/v1/{path}', payload,
                {'apikey': SECRET, 'Authorization': 'Bearer ' + SECRET,
                 **({'Prefer': prefer} if prefer else {})}, method)


def insert(table, rows, chunk=500, on_conflict=None):
    out = []
    for i in range(0, len(rows), chunk):
        q = table + (f'?on_conflict={on_conflict}' if on_conflict else '')
        code, res = rest(q, 'POST', rows[i:i + chunk],
                         prefer='return=representation,resolution=merge-duplicates')
        if code >= 300:
            raise RuntimeError(f'insert {table} {code}: {str(res)[:600]}')
        out.extend(res or [])
    return out


def select(path):
    code, res = rest(path)
    if code >= 300:
        raise RuntimeError(f'select {path} {code}: {str(res)[:400]}')
    return res
