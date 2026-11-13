# -*- coding: utf-8 -*-
"""
Genera los JSON que consume la aplicación web a partir de los Excel de origen.

Uso:
    python scripts/exportar_datos.py --origen "C:\\ruta\\a\\los\\excel" --salida datos

Reglas de la MATRIZ (pantalla 1):
  * Solo consumo BÁSICO del puesto. Un EPP que usan unos pocos (p. ej. el
    respirador de 2 analistas entre 10, o el EPP de soldadura de un mecánico
    que suelda de vez en cuando) NO entra a la matriz; se queda en el consumo.
  * Un EPP por familia y plaza (el de mayor cobertura).
  * Cobertura esperada según la vida útil: casco/arnés 24 meses, lente/orejera/
    bota/careta 12 meses, guante/filtro/tapón 1-3 meses. En 6 meses se espera
    reponer el 25 %, 50 % y 100 % respectivamente; se exige el 60 % de eso
    (15 %, 30 % y 60 %).
  * El lente se mantiene siempre que haya evidencia: se entrega poco, pero
    se entrega.
  * Los EPPs de soldadura/oxicorte solo entran en puestos de soldadura.

Los archivos de salida contienen DNI y nombres -> estan en .gitignore.
"""
import argparse, json, os, re, collections, sys, unicodedata
import openpyxl

FAMILIAS = [
    # (codigo, nombre, palabras clave)
    ('CASCO',     'Casco',        lambda d: 'CASCO' in d or 'BARBIQUEJO' in d or 'SUSPENSION' in d),
    ('AUDITIVO',  'Auditivo',     lambda d: 'AUDIT' in d or 'OREJERA' in d or 'TAPON' in d),
    ('RESPIRADOR','Respirador',   lambda d: any(x in d for x in ('RESPIR', 'FILTRO', 'MASCARILLA', 'CARTUCHO', 'PREFILTRO', 'RETENEDOR'))),
    ('LENTE',     'Lente',        lambda d: any(x in d for x in ('LENTE', 'ANTEOJO', 'GAFAS', 'CARE'))),
    ('GUANTE',    'Guante',       lambda d: 'GUANTE' in d),
    ('BOTA',      'Bota',         lambda d: any(x in d for x in ('BOTA', 'ZAPATO', 'ESCARPIN', 'CUBREZAPATO'))),
    ('SOLDADURA', 'Soldadura',    lambda d: any(x in d for x in ('SOLDAR', 'LUNA'))),
    ('ROPA',      'Ropa',         lambda d: any(x in d for x in ('MAMELUCO', 'MANDIL', 'CHALECO', 'CAPUCHA', 'GORRO', 'MANGA', 'CASACA'))),
    ('ARNES',     'Arnés',        lambda d: 'ARNES' in d or 'FAJA' in d),
]

# EPPs que solo tienen sentido en un puesto de soldadura / oxicorte
SOLDADURA_EPP = {
    '60000008532',  # CAPUCHA P/SOLDAR
    '60000009063',  # CASACA P/SOLDAR
    '60000005279',  # MANGA PROTECTOR CUERO P/SOLDADOR
    '60000011217',  # MANDIL DE CUERO PARA SOLDADOR
    '60000005122',  # ESCARPIN CORTO CUERO P/SOLDA
    '60000005032',  # LUNA BLANCA PARA MASCARA DE SOLDAR
    '60000004870',  # CARETA DE LENTE ELEVADIZO PARA SOLDADOR
    '60000005126',  # ANTEOJO N°6 C/LUNA NEGRA CIRCULAR P/OXIG
    '60000005243',  # ESCARPIN D/SOLDADOR
    '60000005461',  # GUANTE DE CUERO P/SOLDAD Y OXIGENIS
    '60000012385',  # GUANTE DE SOLDAR STEELPRO
    '60000005383',  # GUANTE SOLDADOR INDURA
    '60000012419',  # GUANTE SOLDADOR STEELPRO MASTERWELD
}
PUESTOS_SOLDADURA = ('SOLDADOR', 'CALDERERO', 'HERRERO', 'MANIOBRISTA')


def familia_de(desc):
    d = desc.upper()
    for cod, nom, test in FAMILIAS:
        if test(d):
            return cod, nom
    return 'OTROS', 'Otros'


def tasa_de(desc):
    """Fracción de la gente que se espera reponer en 6 meses, según la vida útil."""
    d = desc.upper()
    if 'CASCO' in d or 'ARNES' in d or 'BARBIQUEJO' in d or 'SUSPENSION' in d:
        return 0.25            # 24 meses
    if 'RESPIR' in d and not any(x in d for x in ('FILTRO', 'CARTUCHO', 'MASCARILLA', 'PREFILTRO')):
        return 0.25            # respirador reutilizable, 24 meses
    if any(x in d for x in ('LENTE', 'ANTEOJO', 'GAFAS', 'CARE', 'OREJERA',
                            'BOTA', 'ZAPATO', 'ESCARPIN', 'MANDIL', 'CAPUCHA',
                            'CASACA', 'MANGA', 'CHALECO')):
        return 0.50            # 12 meses
    return 1.00                # guante, filtro, tapón, mascarilla, mameluco: 1-3 meses


def n(v):
    return '' if v is None else re.sub(r'\s+', ' ', str(v)).strip()


def norm(s):
    s = unicodedata.normalize('NFD', str(s or ''))
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn').upper()
    s = re.sub(r'[^A-Z ]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


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


def resolver_nombre(texto, indice):
    """El campo DNI a veces trae el nombre (recortado). Devuelve el DNI si es único."""
    q = norm(texto)
    toks = [t for t in q.split() if t]
    if len(toks) < 2 or not any(len(t) >= 4 for t in toks):
        return None
    cand = set()
    for nombre, dni in indice.items():
        partes = nombre.split()
        if all(any(p.startswith(t) for p in partes) for t in toks):
            cand.add(dni)
    return cand.pop() if len(cand) == 1 else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--origen', default=r'C:\Users\edins\Downloads')
    ap.add_argument('--salida', default='datos')
    a = ap.parse_args()
    O, S = a.origen, a.salida
    os.makedirs(S, exist_ok=True)

    mae = O + r'\MAE_v2.xlsx'
    if not os.path.exists(mae):
        mae = O + r'\MAE ACT SEG IND 03.06.26 (1).xls'

    consumo = list(leer(O + r'\Consumo.xlsx'))
    costos = {n(r['Material']): {'desc': n(r['Descripción material']),
                                 'precio': float(r['Precio'] or 0),
                                 'unidad': n(r['Unidad medida base'])}
              for r in leer(O + r'\Costos actualizados 2026.xlsx')}
    # Correccion conocida: la luna blanca se compra por LOTE de 100 a S/90
    if '60000005032' in costos:
        costos['60000005032']['precio'] = 0.90

    personas = {}
    nombres = {}
    for m in openpyxl.load_workbook(mae, data_only=True, read_only=True).worksheets[0].iter_rows(min_row=2, values_only=True):
        if not m[5]:
            continue
        key = str(m[5]).strip().lstrip('0')
        personas[key] = {
            'dni': str(m[5]).strip(), 'nombre': n(m[1]),
            'puesto': n(m[7]), 'lugar': n(m[14]) or '(sin centro de costo)'}
        if personas[key]['nombre']:
            nombres.setdefault(norm(personas[key]['nombre']), key)

    for m in leer(O + r'\MAESTRO SERVICIOS.xlsx'):
        mm = re.search(r'(\d{8})', n(m['nro_doc_ide']))
        if not mm:
            continue
        key = mm.group(1).lstrip('0')
        personas.setdefault(key, {
            'dni': mm.group(1), 'nombre': n(m['trabajador']),
            'puesto': n(m['cargo']), 'lugar': n(m['num_lug_trabajo']) or '(sin lugar de trabajo)'})
        if personas[key]['nombre']:
            nombres.setdefault(norm(personas[key]['nombre']), key)

    # ---- consumo valido: DNI directo o nombre que se resuelve a un DNI único
    validos = []
    recuperados = 0
    for r in consumo:
        d = n(r['DNI']).lstrip('0')
        if d and d in personas:
            validos.append((r, d))
            continue
        if d and not d.isdigit():
            dni = resolver_nombre(d, nombres)
            if dni:
                validos.append((r, dni))
                recuperados += 1

    # ---- celdas plaza x epp
    celda = collections.defaultdict(lambda: {'pers': set(), 'qty': 0.0})
    plaza_pers = collections.defaultdict(set)
    for r, d in validos:
        p = personas[d]
        k = (p['puesto'], p['lugar'])
        mat = n(r['Material'])
        celda[(k, mat)]['pers'].add(d)
        celda[(k, mat)]['qty'] += float(r['Cantid.reducidas'] or 0)
        plaza_pers[k].add(d)

    plazas = {(p['puesto'], p['lugar']) for p in personas.values()}
    epps_ok = sorted({n(r['Material']) for r, _ in validos})

    # ---- elegir 1 EPP por familia y plaza (mayor cobertura; empate -> mayor cantidad)
    elegido = collections.defaultdict(dict)
    for (k, mat), v in celda.items():
        fam = familia_de(costos[mat]['desc'])[0]
        cob = len(v['pers']) / max(len(plaza_pers[k]), 1)
        act = elegido[k].get(fam)
        if act is None or cob > act[1] or (cob == act[1] and v['qty'] > act[2]):
            elegido[k][fam] = (mat, cob, v['qty'], len(v['pers']))

    # ---- decidir si el elegido es BASE del puesto
    base = collections.defaultdict(dict)
    adicional = collections.defaultdict(list)
    for k, fams in elegido.items():
        es_soldador = any(x in k[0].upper() for x in PUESTOS_SOLDADURA)
        nc = len(plaza_pers[k])
        for fam, (mat, cob, qty, nc_epp) in fams.items():
            desc = costos[mat]['desc']
            soldadura = mat in SOLDADURA_EPP
            if soldadura and not es_soldador:
                adicional[k].append((mat, round(cob * 100, 1), 'soldadura'))
                continue
            if soldadura and es_soldador:
                base[k][fam] = (mat, cob, qty)
                continue
            if fam == 'LENTE':                      # el lente siempre se entrega
                base[k][fam] = (mat, cob, qty)
                continue
            # se espera reponer nc * tasa en el período; se exige el 60 % de eso
            esperado = nc * tasa_de(desc)
            minimo = max(1, int(0.6 * esperado + 0.5))
            if nc_epp >= minimo:
                base[k][fam] = (mat, cob, qty)
            else:
                adicional[k].append((mat, round(cob * 100, 1), 'minoritario'))

    usadas = collections.Counter()
    for k, fams in base.items():
        for fam, (mat, cob, qty) in fams.items():
            usadas[mat] += 1

    columnas = []
    for mat in epps_ok:
        c = costos[mat]
        fcod, fname = familia_de(c['desc'])
        columnas.append({'m': mat, 'd': c['desc'], 'f': fcod, 'fn': fname,
                         'u': c['unidad'], 'p': c['precio'], 'n': usadas.get(mat, 0)})
    columnas.sort(key=lambda x: (-x['n'], x['fn'], x['d']))

    filas = []
    for k in plazas:
        verdes = [[mat, round(cob * 100, 1)] for fam, (mat, cob, _) in base.get(k, {}).items()]
        verdes.sort()
        total = round(sum(costos[m]['precio'] for m, _ in verdes), 2)
        filas.append({'p': k[0], 'l': k[1], 'n': len(plaza_pers.get(k, ())),
                      'v': verdes, 't': total, 'a': adicional.get(k, [])})
    filas.sort(key=lambda x: x['p'])

    # ---- consumo por persona y mes (pantalla 2)
    meses = sorted({r['Fecha base'].strftime('%Y-%m') for r, _ in validos if r['Fecha base']})
    pers_out = {}
    for r, d in validos:
        p = personas[d]
        mes = r['Fecha base'].strftime('%Y-%m')
        mat = n(r['Material'])
        qty = float(r['Cantid.reducidas'] or 0)
        val = round(qty * costos[mat]['precio'], 2)
        o = pers_out.setdefault(d, {
            'dni': p['dni'], 'nombre': p['nombre'], 'puesto': p['puesto'], 'lugar': p['lugar'],
            'total': 0.0, 'meses': collections.defaultdict(float), 'items': {}})
        o['total'] = round(o['total'] + val, 2)
        o['meses'][mes] += val
        it = o['items'].setdefault(mat, {'c': 0.0, 'v': 0.0, 'meses': collections.defaultdict(float)})
        it['c'] += qty
        it['v'] = round(it['v'] + val, 2)
        it['meses'][mes] += val

    for o in pers_out.values():
        o['meses'] = {k: round(v, 2) for k, v in sorted(o['meses'].items())}
        o['items'] = [{'m': m, 'c': round(v['c'], 2), 'v': v['v'],
                       'meses': {k: round(x, 2) for k, x in sorted(v['meses'].items())}}
                      for m, v in sorted(o['items'].items(), key=lambda x: -x[1]['v'])]

    tot_val = sum(o['total'] for o in pers_out.values())
    por_mes = collections.Counter()
    for o in pers_out.values():
        for k, v in o['meses'].items():
            por_mes[k] += v

    meta = {
        'generado': __import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M'),
        'meses': meses,
        'plazas': len(filas),
        'plazas_con_consumo': len(plaza_pers),
        'plazas_con_kit': sum(1 for f in filas if f['v']),
        'epps': len(columnas),
        'epps_base': len(usadas),
        'celdas': sum(len(f['v']) for f in filas),
        'adicionales': sum(len(f['a']) for f in filas),
        'personas': len(personas),
        'personas_con_consumo': len(pers_out),
        'recuperados_por_nombre': recuperados,
        'valor': round(tot_val, 2),
        'por_mes': {k: round(v, 2) for k, v in sorted(por_mes.items())},
        'costo_dotacion': round(sum(f['t'] for f in filas), 2),
    }

    def dump(nombre, obj):
        with open(os.path.join(S, nombre), 'w', encoding='utf-8') as fh:
            json.dump(obj, fh, ensure_ascii=False, separators=(',', ':'))
        print(f'  {nombre:16s} {os.path.getsize(os.path.join(S, nombre))/1024:8.1f} KB')

    print('Generando datos:')
    dump('meta.json', meta)
    dump('columnas.json', columnas)
    dump('matriz.json', filas)
    dump('consumo.json', list(pers_out.values()))
    print(f"\n  plazas {meta['plazas']} ({meta['plazas_con_consumo']} con consumo, {meta['plazas_con_kit']} con kit)")
    print(f"  EPPs {meta['epps']} ({meta['epps_base']} son base en algun puesto)")
    print(f"  celdas base {meta['celdas']}   adicionales fuera {meta['adicionales']}")
    print(f"  personas {meta['personas']} ({meta['personas_con_consumo']} con consumo, {recuperados} por nombre)")
    print(f"  valor 6 meses S/ {meta['valor']:,.2f}")


if __name__ == '__main__':
    main()
