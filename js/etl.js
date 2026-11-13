/* ============================================================
   ETL en el navegador: Excel del SAP -> payload para Supabase
   ============================================================ */

window.ETL = (function () {

  const FAMILIAS = [
    ['CASCO',      d => d.includes('CASCO') || d.includes('BARBIQUEJO') || d.includes('SUSPENSION')],
    ['AUDITIVO',   d => d.includes('AUDIT') || d.includes('OREJERA') || d.includes('TAPON')],
    ['RESPIRADOR', d => /RESPIR|FILTRO|MASCARILLA|CARTUCHO|PREFILTRO|RETENEDOR/.test(d)],
    ['LENTE',      d => /LENTE|ANTEOJO|GAFAS|CARE/.test(d)],
    ['GUANTE',     d => d.includes('GUANTE')],
    ['BOTA',       d => /BOTA|ZAPATO|ESCARPIN|CUBREZAPATO/.test(d)],
    ['SOLDADURA',  d => /SOLDAR|LUNA/.test(d)],
    ['ROPA',       d => /MAMELUCO|MANDIL|CHALECO|CAPUCHA|GORRO|MANGA|CASACA/.test(d)],
    ['ARNES',      d => d.includes('ARNES') || d.includes('FAJA')]
  ];

  const SOLDADURA_EPP = new Set([
    '60000008532', '60000009063', '60000005279', '60000011217', '60000005122',
    '60000005032', '60000004870', '60000005126', '60000005243', '60000005461',
    '60000012385', '60000005383', '60000012419'
  ]);

  function familiaDe(desc) {
    const d = String(desc || '').toUpperCase();
    for (const [cod, test] of FAMILIAS) if (test(d)) return cod;
    return 'OTROS';
  }

  function norm(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function texto(v) {
    if (v == null) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).replace(/\s+/g, ' ').trim();
  }

  function fechaISO(v) {
    if (!v) return null;
    if (v instanceof Date && !isNaN(v)) {
      const d = new Date(v.getTime() - v.getTimezoneOffset() * 60000);
      return d.toISOString().slice(0, 10);
    }
    if (typeof v === 'number') {
      const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
      return isNaN(d) ? null : d.toISOString().slice(0, 10);
    }
    const s = texto(v);
    const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[0];
    const m2 = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m2) return `${m2[3]}-${m2[2].padStart(2, '0')}-${m2[1].padStart(2, '0')}`;
    return null;
  }

  function numero(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return v;
    const s = String(v).replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  async function leer(file) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    if (!aoa.length) return { headers: [], rows: [] };
    return {
      headers: aoa[0].map(norm),
      rows: aoa.slice(1).filter(r => r && r.some(c => c !== null && c !== ''))
    };
  }

  function col(headers, pruebas, posicion) {
    for (const p of pruebas) {
      for (let i = 0; i < headers.length; i++) if (p(headers[i])) return i;
    }
    return posicion != null ? posicion : -1;
  }

  function requerida(nombre, idx, errores) {
    if (idx < 0) errores.push('Falta la columna "' + nombre + '"');
    return idx;
  }

  /* ---------------- construcción ---------------- */
  async function construir(archivos) {
    const errores = [];
    
    // INICIALIZAMOS VACÍO. Solo se llenará lo que se suba.
    const out = {}; 

    if (!archivos.consumo && !archivos.costos && !archivos.mae) {
      errores.push('Debes subir al menos un archivo.');
      return { errores };
    }
    if (archivos.consumo && (!archivos.mae || !archivos.costos)) {
      errores.push('Para procesar el Consumo, debes subir también el MAE y los Costos.');
      return { errores };
    }

    const gerencias = new Set();
    const secciones = new Map();
    const centros = new Map();
    const descACodigo = new Map();
    const puestos = new Set();
    const personas = new Map();

    let ok = 0, sinDni = 0, huerfano = 0;

    /* ---- MAE ---- */
    if (archivos.mae) {
      const mae = await leer(archivos.mae);
      let iNom = col(mae.headers, [h => h.startsWith('NOMBRE')], 1);
      let iDni = col(mae.headers, [h => h === 'DNI'], 5);
      let iPue = col(mae.headers, [h => h.includes('DESC COD CARGO'), h => h === 'CARGO', h => h.includes('CARGO')], 7);
      let iArea = col(mae.headers, [h => h.includes('DESC COD AREA'), h => h === 'AREA'], 10);
      let iSec = col(mae.headers, [h => h.includes('DES COD SECCION'), h => h.includes('SECCION')], 12);
      let iCen = col(mae.headers, [h => h === 'CENCOS', h => h.includes('CENCOS')], 13);
      let iCenDesc = col(mae.headers, [h => h.includes('DESC CENCOS')], 14);
      
      requerida('DNI (MAE)', iDni, errores);
      requerida('desc_cod_cargo (MAE)', iPue, errores);
      requerida('cencos (MAE)', iCen, errores);
      if (errores.length) return { errores };

      mae.rows.forEach(r => {
        const dni = texto(r[iDni]).replace(/\D/g, '');
        if (!dni) return;
        const g = texto(r[iArea]);
        const s = texto(r[iSec]);
        const cod = texto(r[iCen]);
        const desc = texto(r[iCenDesc]) || '(sin centro de costo)';
        gerencias.add(g);
        if (!secciones.has(s)) secciones.set(s, g);
        centros.set(cod, { descripcion: desc, seccion: s });
        if (!descACodigo.has(desc)) descACodigo.set(desc, cod);
        puestos.add(texto(r[iPue]));
        personas.set(dni.replace(/^0+/, ''), {
          dni: dni, nombre: texto(r[iNom]), puesto: texto(r[iPue]), ceco: cod, fuente: 'MAE'
        });
      });
    }

    /* ---- SERVICIOS ---- */
    if (archivos.servicios) {
      const srv = await leer(archivos.servicios);
      const iDoc = col(srv.headers, [h => h === 'NRO DOC IDE', h => h.startsWith('NRO DOC')], 0);
      const iTra = col(srv.headers, [h => h === 'TRABAJADOR'], 2);
      const iCar = col(srv.headers, [h => h === 'CARGO'], 5);
      const iLug = col(srv.headers, [h => h === 'NUM LUG TRABAJO', h => h.startsWith('NUM LUG')], 6);
      srv.rows.forEach(r => {
        const dni = (texto(r[iDoc]).match(/\d{8}/) || [''])[0];
        if (!dni) return;
        const lugar = texto(r[iLug]) || '(sin lugar de trabajo)';
        const ceco = descACodigo.get(lugar) || ('SRV-' + norm(lugar).toLowerCase().replace(/ /g, '-').slice(0, 40));
        gerencias.add('SERVICIOS');
        if (!secciones.has(lugar)) secciones.set(lugar, 'SERVICIOS');
        if (!centros.has(ceco)) centros.set(ceco, { descripcion: lugar, seccion: lugar });
        puestos.add(texto(r[iCar]));
        if (!personas.has(dni.replace(/^0+/, ''))) {
          personas.set(dni.replace(/^0+/, ''), {
            dni: dni, nombre: texto(r[iTra]), puesto: texto(r[iCar]), ceco: ceco, fuente: 'SERVICIOS'
          });
        }
      });
    }

    /* ---- COSTOS ---- */
    const costos = new Map();
    if (archivos.costos) {
      const cos = await leer(archivos.costos);
      const iMat = requerida('Material (Costos)', col(cos.headers, [h => h === 'MATERIAL'], 0), errores);
      const iDesc = requerida('Descripción material (Costos)', col(cos.headers, [h => h.startsWith('DESCRIPCION')], 1), errores);
      const iPre = requerida('Precio (Costos)', col(cos.headers, [h => h === 'PRECIO', h => h.includes('PRECIO')], 2), errores);
      const iUni = col(cos.headers, [h => h.includes('UNIDAD')], 3);
      if (errores.length) return { errores };

      cos.rows.forEach(r => {
        const mat = texto(r[iMat]);
        if (!mat) return;
        costos.set(mat, {
          descripcion: texto(r[iDesc]),
          unidad: (iUni >= 0 ? texto(r[iUni]) : '') || 'UN',
          precio: numero(r[iPre]),
          factor: 1
        });
      });
      if (costos.has('60000005032')) { 
        costos.get('60000005032').precio = 0.90;
        costos.get('60000005032').factor = 100;
      }

      // Solo se crean las llaves si hay archivo de costos
      out.epp = [];
      out.precios = [];
      costos.forEach((c, mat) => {
        out.epp.push({
          material: mat, descripcion: c.descripcion, familia: familiaDe(c.descripcion),
          unidad: c.unidad, factor: c.factor, solo_soldadura: SOLDADURA_EPP.has(mat)
        });
        out.precios.push({ material: mat, precio: c.precio, vigente_desde: '2026-01-01' });
      });
    }

    /* ---- CONSUMO ---- */
    if (archivos.consumo) {
      const con = await leer(archivos.consumo);
      const iFec = requerida('Fecha base (Consumo)', col(con.headers, [h => h.startsWith('FECHA')], 0), errores);
      const iCMat = requerida('Material (Consumo)', col(con.headers, [h => h === 'MATERIAL'], 1), errores);
      const iCan = requerida('Cantid.reducidas (Consumo)', col(con.headers, [h => h.startsWith('CANTID')], 3), errores);
      const iCUni = col(con.headers, [h => h.startsWith('UNIDAD')], 4);
      const iCDni = requerida('DNI (Consumo)', col(con.headers, [h => h === 'DNI'], 6), errores);
      if (errores.length) return { errores };

      const nombres = new Map();
      personas.forEach(p => { if (p.nombre) nombres.set(norm(p.nombre), p.dni); });

      const usados = new Set();
      
      // Solo se crea la llave si hay archivo de consumo
      out.consumo = [];

      con.rows.forEach(r => {
        const mat = texto(r[iCMat]);
        if (!mat) return;
        const fecha = fechaISO(r[iFec]);
        if (!fecha) return;
        usados.add(mat);
        const cantidad = numero(r[iCan]);
        const unidad = (iCUni >= 0 ? texto(r[iCUni]) : '') || (costos.get(mat) || {}).unidad || 'UN';
        const crudo = texto(r[iCDni]);
        let dni = null, ref = null, estado = 'sin_dni';

        if (crudo) {
          if (/^\d{8}$/.test(crudo)) {
            if (personas.has(crudo.replace(/^0+/, ''))) { dni = crudo; estado = 'ok'; }
            else { dni = crudo; estado = 'dni_huerfano'; }
          } else {
            ref = crudo;
            const toks = norm(crudo).split(' ').filter(Boolean);
            if (toks.length >= 2 && toks.some(t => t.length >= 4)) {
              const cand = new Set();
              nombres.forEach((d, nombre) => {
                const partes = nombre.split(' ');
                if (toks.every(t => partes.some(p => p.startsWith(t)))) cand.add(d);
              });
              if (cand.size === 1) { dni = cand.values().next().value; estado = 'ok'; }
            }
          }
        }
        if (estado === 'ok') ok++; else if (estado === 'sin_dni') sinDni++; else huerfano++;

        out.consumo.push({
          fecha: fecha, material: mat, cantidad: cantidad, unidad: unidad,
          dni: dni, ref_texto: ref, estado: estado
        });
      });

      if (archivos.costos) {
        const faltantes = [];
        usados.forEach(mat => {
          if (!costos.get(mat)) faltantes.push(mat);
        });
        if (faltantes.length) {
          errores.push('Estos materiales del consumo no están en Costos: ' + faltantes.slice(0, 6).join(', '));
          return { errores };
        }
      }
    }

    /* ---- plazas ---- */
    if (archivos.mae) {
      // Solo se crean las llaves si hay archivo de MAE
      out.gerencias = [];
      out.secciones = [];
      out.cecos = [];
      out.puestos = [];
      out.plazas = [];
      out.personas = [];

      const plazas = new Set();
      personas.forEach(p => plazas.add(p.puesto + '||' + p.ceco));

      gerencias.forEach(g => out.gerencias.push({ nombre: g }));
      secciones.forEach((g, s) => out.secciones.push({ nombre: s, gerencia: g }));
      centros.forEach((v, c) => out.cecos.push({ codigo: c, descripcion: v.descripcion, seccion: v.seccion }));
      puestos.forEach(p => out.puestos.push({ nombre: p }));
      plazas.forEach(x => {
        const [puesto, ceco] = x.split('||');
        out.plazas.push({ puesto: puesto, ceco: ceco });
      });
      personas.forEach(p => out.personas.push(p));
    }

    /* ---- STOCK ---- */
    if (archivos.stock) {
      const st = await leer(archivos.stock);
      const iSm = col(st.headers, [h => h === 'MATERIAL'], 0);
      const iCe = col(st.headers, [h => h.includes('CENTRO')], 1);
      const iAl = col(st.headers, [h => h.includes('ALMACEN')], 2);
      const iLo = col(st.headers, [h => h.includes('LOTE')], 3);
      const iLi = col(st.headers, [h => h.includes('LIBRE UTILIZACION'), h => h.includes('LIBRE')], 5);
      const iVa = col(st.headers, [h => h.includes('VALOR LIBRE'), h => h.includes('VALOR')], 9);
      
      out.stock = [];
      st.rows.forEach(r => {
        const mat = texto(r[iSm]);
        if (!mat) return;
        out.stock.push({
          material: mat, centro: texto(r[iCe]), almacen: texto(r[iAl]), lote: texto(r[iLo]),
          libre: numero(iLi >= 0 ? r[iLi] : 0), valor: numero(iVa >= 0 ? r[iVa] : 0)
        });
      });
    }

    return {
      errores: [],
      payload: out,
      resumen: {
        personas: out.personas ? out.personas.length : 0, 
        plazas: out.plazas ? out.plazas.length : 0,
        epps: out.epp ? out.epp.length : 0, 
        consumo: out.consumo ? out.consumo.length : 0,
        ok: ok, sin_dni: sinDni, huerfano: huerfano, 
        stock: out.stock ? out.stock.length : 0
      }
    };
  }

  return { construir: construir, familiaDe: familiaDe };
})();