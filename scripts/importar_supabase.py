# -*- coding: utf-8 -*-
"""
Carga TODO el consumo de EPPs en Supabase: estructura, catálogo, personas,
consumo completo (con y sin DNI) y la matriz base.

Uso:
    $env:SUPABASE_PAT="sbp_..."; $env:SUPABASE_SECRET="sb_secret_..."
    python scripts/importar_supabase.py --origen "C:\\Users\\edins\\Downloads"

El esquema (db/schema.sql) tiene que estar aplicado antes.
"""
import argparse
import collections
import os
import re
import sys
import unicodedata

import openpyxl

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sb_cliente import rest, sql  # noqa: E402

# ---------------------------------------------------------------- reglas
FAMILIAS = [
    ('CASCO',      lambda d: 'CASCO' in d or 'BARBIQUEJO' in d or 'SUSPENSION' in d),
    ('AUDITIVO',   lambda d: 'AUDIT' in d or 'OREJERA' in d or 'TAPON' in d),
    ('RESPIRADOR', lambda d: any(x in d for x in ('RESPIR', 'FILTRO', 'MASCARILLA', 'CARTUCHO', 'PREFILTRO', 'RETENEDOR'))),
    ('LENTE',      lambda d: any(x in d for x in ('LENTE', 'ANTEOJO', 'GAFAS', 'CARE'))),
    ('GUANTE',     lambda d: 'GUANTE' in d),
    ('BOTA',       lambda d: any(x in d for x in ('BOTA', 'ZAPATO', 'ESCARPIN', 'CUBREZAPATO'))),
    ('SOLDADURA',  lambda d: any(x in d for x in ('SOLDAR', 'LUNA'))),
    ('ROPA',       lambda d: any(x in d for x in ('MAMELUCO', 'MANDIL', 'CHALECO', 'CAPUCHA', 'GORRO', 'MANGA', 'CASACA'))),
    ('ARNES',      lambda d: 'ARNES' in d or 'FAJA' in d),
]

SOLDADURA_EPP = {
    '60000008532', '60000009063', '60000005279', '60000011217', '60000005122',
    '60000005032', '60000004870', '60000005126', '60000005243', '60000005461',
    '60000012385', '60000005383', '60000012419',
}
PUESTOS_SOLDADURA = ('SOLDADOR', 'CALDERERO', 'HERRERO', 'MANIOBRISTA')


def familia_de(desc):
    d = desc.upper()
    for cod, test in FAMILIAS:
        if test(d):
            return cod
    return 'OTROS'


def tasa_de(desc):
    """Fracción que se espera reponer en 6 meses según la vida útil."""
    d = desc.upper()
    if 'CASCO' in d or 'ARNES' in d or 'BARBIQUEJO' in d or 'SUSPENSION' in d:
        return 0.25
    if 'RESPIR' in d and not any(x in d for x in ('FILTRO', 'CARTUCHO', 'MASCARILLA', 'PREFILTRO')):
        return 0.25
    if any(x in d for x in ('LENTE', 'ANTEOJO', 'GAFAS', 'CARE', 'OREJERA', 'BOTA',
                            'ZAPATO', 'ESCARPIN', 'MANDIL', 'CAPUCHA', 'CASACA',
                            'MANGA', 'CHALECO')):
        return 0.50
    return 1.00


def reposiciones(desc):
    t = tasa_de(desc)
    return {0.25: 0.5, 0.50: 1.0}.get(t, 12.0)


def n(v):
    return '' if v is None else re.sub(r'\s+', ' ', str(v)).strip()


def norm(s):
    s = unicodedata.normalize('NFD', str(s or ''))
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn').upper()
    s = re.sub(r'[^A-Z ]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def slug(s):
    s = norm(s).lower().replace(' ', '-')
    return re.sub(r'[^a-z0-9-]', '', s)[:40] or 'sin-lugar'


def leer(path, hoja=0):
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    ws = wb.worksheets[hoja]
    hdr = None
    for i, r in enumerate(ws.iter_rows(values_only=True), 1):
        if i == 1:
            hdr = [str(c).strip() if c is not None else '' for c in r]
            continue
        yield dict(zip(hdr, r))
    wb.close()


def insertar(tabla, filas, chunk=500):
    out = []
    for i in range(0, len(filas), chunk):
        code, res = rest(tabla, 'POST', filas[i:i + chunk], prefer='return=representation')
        if code >= 300:
            raise RuntimeError(f'insert {tabla} {code}: {str(res)[:700]}')
        out.extend(res or [])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--origen', default=r'C:\Users\edins\Downloads')
    ap.add_argument('--sin-limpiar', action='store_true')
    a = ap.parse_args()
    O = a.origen

    mae = O + r'\MAE_v2.xlsx'
    if not os.path.exists(mae):
        mae = O + r'\MAE ACT SEG IND 03.06.26 (1).xls'

    costos = {}
    for r in leer(O + r'\Costos actualizados 2026.xlsx'):
        mat = n(r['Material'])
        costos[mat] = {
            'descripcion': n(r['Descripción material']),
            'unidad': n(r['Unidad medida base']) or 'UN',
            'precio': float(r['Precio'] or 0),
            'factor': 1,
        }
    if '60000005032' in costos:          # luna blanca: lote de 100 a S/90
        costos['60000005032']['precio'] = 0.90
        costos['60000005032']['factor'] = 100

    gerencias = set()
    secciones = {}          # nombre -> gerencia
    centros = {}            # codigo -> (descripcion, seccion)
    desc_a_codigo = {}
    puestos = set()
    personas = {}

    for m in openpyxl.load_workbook(mae, data_only=True, read_only=True).worksheets[0].iter_rows(min_row=2, values_only=True):
        if not m[5]:
            continue
        g, s = n(m[10]), n(m[12])
        cod, desc = n(m[13]), n(m[14]) or '(sin centro de costo)'
        gerencias.add(g)
        secciones.setdefault(s, g)
        centros[cod] = (desc, s)
        desc_a_codigo.setdefault(desc, cod)
        puestos.add(n(m[7]))
        personas[str(m[5]).strip().lstrip('0')] = {
            'dni': str(m[5]).strip(), 'nombre': n(m[1]), 'puesto': n(m[7]),
            'ceco': cod, 'fuente': 'MAE'}

    for r in leer(O + r'\MAESTRO SERVICIOS.xlsx'):
        mm = re.search(r'(\d{8})', n(r['nro_doc_ide']))
        if not mm:
            continue
        dni = mm.group(1).lstrip('0')
        lugar = n(r['num_lug_trabajo']) or '(sin lugar de trabajo)'
        ceco = desc_a_codigo.get(lugar) or ('SRV-' + slug(lugar))
        gerencias.add('SERVICIOS')
        secciones.setdefault(lugar, 'SERVICIOS')
        centros.setdefault(ceco, (lugar, lugar))
        puestos.add(n(r['cargo']))
        personas.setdefault(dni, {
            'dni': mm.group(1), 'nombre': n(r['trabajador']), 'puesto': n(r['cargo']),
            'ceco': ceco, 'fuente': 'SERVICIOS'})

    # ---- consumo
    filas_consumo = []
    ok = 0
    sin_dni = 0
    huerfano = 0
    for r in leer(O + r'\Consumo.xlsx'):
        mat = n(r['Material'])
        if mat not in costos:
            continue
        fecha = r['Fecha base'].strftime('%Y-%m-%d') if r['Fecha base'] else None
        if not fecha:
            continue
        cant = float(r['Cantid.reducidas'] or 0)
        crudo = n(r['DNI'])
        dni, estado, ref = None, 'sin_dni', None
        if crudo:
            if crudo.isdigit() and len(crudo) == 8:
                if crudo.lstrip('0') in personas:
                    dni, estado = crudo, 'ok'
                else:
                    dni, estado, ref = crudo, 'dni_huerfano', None
            else:
                ref = crudo
                # nombre recortado -> buscar DNI único en el maestro
                q = norm(crudo)
                toks = [t for t in q.split() if t]
                cand = set()
                if len(toks) >= 2 and any(len(t) >= 4 for t in toks):
                    for p in personas.values():
                        partes = norm(p['nombre']).split()
                        if all(any(x.startswith(t) for x in partes) for t in toks):
                            cand.add(p['dni'])
                if len(cand) == 1:
                    dni, estado = cand.pop(), 'ok'
        filas_consumo.append({
            'fecha': fecha, 'material': mat, 'cantidad': cant,
            'unidad': n(r['Unidad medida base']) or costos[mat]['unidad'],
            'dni': dni, 'ref_texto': ref, 'estado': estado})
        ok += estado == 'ok'
        sin_dni += estado == 'sin_dni'
        huerfano += estado == 'dni_huerfano'

    plazas_set = {(p['puesto'], p['ceco']) for p in personas.values()}

    # solo el catálogo que realmente se consume (el maestro de costos trae todo el almacén)
    usados = {f['material'] for f in filas_consumo}
    costos = {m: c for m, c in costos.items() if m in usados}

    print(f'  gerencias {len(gerencias)} · secciones {len(secciones)} · cecos {len(centros)}')
    print(f'  puestos {len(puestos)} · plazas {len(plazas_set)} · personas {len(personas)}')
    print(f'  EPPs {len(costos)} · consumo {len(filas_consumo)} (ok {ok}, sin dni {sin_dni}, huérfano {huerfano})')

    # ---- limpiar y cargar (guardando antes lo que se editó a mano)
    manual = []
    code, res = rest('matriz_estandar?origen=eq.manual&select=epp_id,cantidad,reposiciones_anio,'
                     'requerido,nota,cobertura_pct,plazas(puesto_id,ceco,puestos(nombre))')
    if code < 300 and isinstance(res, list):
        manual = res
        print(f'  matriz manual a conservar: {len(manual)} celdas')

    if not a.sin_limpiar:
        sql('truncate table consumo, matriz_estandar, personas, plazas, puestos, '
            'precios, epp, centros_costo, secciones, gerencias restart identity cascade;')

    insertar('gerencias', [{'nombre': g} for g in sorted(gerencias)])
    gid = {r['nombre']: r['id'] for r in rest('gerencias?select=id,nombre')[1]}

    insertar('secciones', [{'nombre': s, 'gerencia_id': gid.get(g)} for s, g in sorted(secciones.items())])
    sid = {r['nombre']: r['id'] for r in rest('secciones?select=id,nombre')[1]}

    insertar('centros_costo', [{'codigo': c, 'descripcion': d, 'seccion_id': sid.get(s)}
                               for c, (d, s) in sorted(centros.items())])
    insertar('puestos', [{'nombre': p} for p in sorted(puestos)])
    pid = {r['nombre']: r['id'] for r in rest('puestos?select=id,nombre')[1]}

    insertar('plazas', [{'puesto_id': pid[p], 'ceco': c} for p, c in sorted(plazas_set)])
    ida_puesto = {v: k for k, v in pid.items()}
    plid = {(ida_puesto[r['puesto_id']], r['ceco']): r['id']
            for r in rest('plazas?select=id,puesto_id,ceco')[1]}

    fam = {r['codigo']: r['id'] for r in rest('familias?select=id,codigo')[1]}
    epp_rows = []
    for mat, c in costos.items():
        epp_rows.append({'material': mat, 'descripcion': c['descripcion'],
                         'familia_id': fam[familia_de(c['descripcion'])],
                         'unidad': c['unidad'], 'factor': c['factor'],
                         'solo_soldadura': mat in SOLDADURA_EPP})
    insertar('epp', epp_rows)
    insertar('precios', [{'material': mat, 'precio': c['precio'], 'vigente_desde': '2026-01-01',
                          'fuente': 'Costos actualizados 2026'} for mat, c in costos.items()])
    insertar('personas', [{'dni': p['dni'], 'nombre': p['nombre'],
                           'puesto_id': pid[p['puesto']], 'ceco': p['ceco'],
                           'fuente': p['fuente']} for p in personas.values()])
    insertar('consumo', filas_consumo, chunk=400)

    # ---- matriz base (mismas reglas que la web)
    celda = collections.defaultdict(lambda: {'pers': set(), 'qty': 0.0})
    plaza_pers = collections.defaultdict(set)
    for f in filas_consumo:
        if f['estado'] != 'ok':
            continue
        p = personas[f['dni'].lstrip('0')]
        k = (p['puesto'], p['ceco'])
        celda[(k, f['material'])]['pers'].add(f['dni'])
        celda[(k, f['material'])]['qty'] += f['cantidad']
        plaza_pers[k].add(f['dni'])

    elegido = collections.defaultdict(dict)
    for (k, mat), v in celda.items():
        famcod = familia_de(costos[mat]['descripcion'])
        cob = len(v['pers']) / max(len(plaza_pers[k]), 1)
        act = elegido[k].get(famcod)
        if act is None or cob > act[0] or (cob == act[0] and v['qty'] > act[1]):
            elegido[k][famcod] = (cob, v['qty'], mat, len(v['pers']))

    matriz = []
    for k, fams in elegido.items():
        nc = len(plaza_pers[k])
        soldador = any(x in k[0].upper() for x in PUESTOS_SOLDADURA)
        for famcod, (cob, _qty, mat, nc_epp) in fams.items():
            desc = costos[mat]['descripcion']
            soldadura = mat in SOLDADURA_EPP
            if soldadura and not soldador:
                continue
            if not soldadura:
                if famcod != 'LENTE':
                    esperado = nc * tasa_de(desc)
                    if nc_epp < max(1, int(0.6 * esperado + 0.5)):
                        continue
            matriz.append({'plaza_id': plid[k], 'epp_id': mat, 'familia_id': fam[famcod],
                           'cantidad': 1, 'reposiciones_anio': reposiciones(desc),
                           'requerido': True, 'cobertura_pct': round(cob * 100, 1),
                           'origen': 'auto', 'nota': None})
    manual_rows = []
    for m in manual:
        pl = m.get('plazas') or {}
        pu = (pl.get('puestos') or {}).get('nombre')
        k = (pu, pl.get('ceco'))
        if k in plid:
            manual_rows.append({
                'plaza_id': plid[k], 'epp_id': m['epp_id'],
                'familia_id': fam[familia_de(costos[m['epp_id']]['descripcion'])],
                'cantidad': m.get('cantidad', 1),
                'reposiciones_anio': m.get('reposiciones_anio'),
                'requerido': m.get('requerido', True),
                'cobertura_pct': m.get('cobertura_pct'),
                'origen': 'manual', 'nota': m.get('nota')})
    manual_keys = {(r['plaza_id'], r['epp_id']) for r in manual_rows}
    matriz = [r for r in matriz if (r['plaza_id'], r['epp_id']) not in manual_keys]

    insertar('matriz_estandar', matriz + manual_rows)

    print(f'  cargado: plazas {len(plid)}, personas {len(personas)}, consumo {len(filas_consumo)}, matriz {len(matriz)}')
    meta = rest('vw_meta')[1][0]
    print('  vw_meta:', meta)


if __name__ == '__main__':
    main()
