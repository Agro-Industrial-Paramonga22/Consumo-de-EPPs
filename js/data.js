/* ============================================================
   Capa de datos — Supabase
   ------------------------------------------------------------
   Lee directo de las vistas del proyecto (db/schema.sql):
     vw_meta, vw_epp_base, vw_costo_plaza, vw_consumo_plaza,
     vw_matriz_detalle, vw_matriz_adicional, vw_consumo_persona

   La web solo usa Datos.meta(), Datos.columnas(), Datos.matriz()
   y Datos.consumo(). Si cambia el origen, este es el único archivo
   que se toca.
   ============================================================ */

window.Datos = (function () {
  const CFG = window.EPP_CONFIG || {};
  const PAGE = 1000;                 // Supabase corta en 1000 filas por request
  const cache = new Map();

  function num(v) { return v == null || v === '' ? 0 : Number(v); }

  async function rest(path) {
    const r = await fetch(CFG.SUPABASE_URL + '/rest/v1/' + path, {
      cache: 'no-store',
      headers: {
        apikey: CFG.SUPABASE_KEY,
        Authorization: 'Bearer ' + CFG.SUPABASE_KEY
      }
    });
    if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + (await r.text()).slice(0, 180));
    return r.json();
  }

  async function restAll(path) {
    const sep = path.indexOf('?') === -1 ? '?' : '&';
    const out = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await rest(path + sep + 'limit=' + PAGE + '&offset=' + offset);
      out.push(...page);
      if (page.length < PAGE) break;
    }
    return out;
  }

  function una(nombre, fn) {
    if (!cache.has(nombre)) cache.set(nombre, fn());
    return cache.get(nombre);
  }

  return {
    /* Números de portada */
    meta: function () {
      return una('meta', async function () {
        const m = (await rest('vw_meta?select=*'))[0] || {};
        m.valor = num(m.valor);
        m.costo_dotacion = num(m.costo_dotacion);
        return m;
      });
    },

    /* Catálogo de EPPs con cuántas plazas lo tienen como base */
    columnas: function () {
      return una('columnas', async function () {
        const cs = await restAll('vw_epp_base?select=*&order=n_plazas.desc,descripcion.asc');
        return cs.map(function (c) {
          return {
            m: c.material, d: c.descripcion, f: c.familia_codigo, fn: c.familia,
            u: c.unidad, p: num(c.precio), n: c.n_plazas
          };
        });
      });
    },

    /* Filas de la matriz: plaza + kit base + consumo adicional */
    matriz: function () {
      return una('matriz', async function () {
        const r = await Promise.all([
          restAll('vw_costo_plaza?select=plaza_id,puesto,ceco_desc,personas,costo_kit'),
          restAll('vw_consumo_plaza?select=plaza_id,personas'),
          restAll('vw_matriz_detalle?select=plaza_id,epp_id,cobertura_pct'),
          restAll('vw_matriz_adicional?select=plaza_id,material,cobertura_pct,motivo')
        ]);
        const consumidores = new Map(r[1].map(function (x) { return [x.plaza_id, x.personas]; }));
        const base = new Map();
        r[2].forEach(function (c) {
          if (!base.has(c.plaza_id)) base.set(c.plaza_id, []);
          base.get(c.plaza_id).push([c.epp_id, num(c.cobertura_pct)]);
        });
        const adic = new Map();
        r[3].forEach(function (c) {
          if (!adic.has(c.plaza_id)) adic.set(c.plaza_id, []);
          adic.get(c.plaza_id).push([c.material, num(c.cobertura_pct), c.motivo]);
        });

        return r[0].map(function (p) {
          const v = (base.get(p.plaza_id) || []).slice().sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
          const a = (adic.get(p.plaza_id) || []).slice().sort(function (x, y) { return x[1] - y[1]; });
          return {
            p: p.puesto, l: p.ceco_desc || '(sin centro de costo)',
            n: consumidores.get(p.plaza_id) || 0,
            v: v, t: num(p.costo_kit), a: a
          };
        }).sort(function (a, b) { return a.p.localeCompare(b.p) || a.l.localeCompare(b.l); });
      });
    },

    /* Consumo real por persona (pantalla 2) */
    consumo: function () {
      return una('consumo', async function () {
        const lineas = await restAll('vw_consumo_persona?select=dni,nombre,puesto,ceco_desc,fecha,material,cantidad,valor');
        const por = new Map();
        lineas.forEach(function (x) {
          if (!por.has(x.dni)) {
            por.set(x.dni, {
              dni: x.dni, nombre: x.nombre, puesto: x.puesto || '', lugar: x.ceco_desc || '',
              total: 0, meses: {}, items: {}
            });
          }
          const o = por.get(x.dni);
          const mes = String(x.fecha).slice(0, 7);
          const val = num(x.valor);
          o.total = Math.round((o.total + val) * 100) / 100;
          o.meses[mes] = Math.round(((o.meses[mes] || 0) + val) * 100) / 100;
          const it = o.items[x.material] || (o.items[x.material] = { c: 0, v: 0, meses: {}, m: x.material });
          it.c += num(x.cantidad);
          it.v = Math.round((it.v + val) * 100) / 100;
          it.meses[mes] = Math.round(((it.meses[mes] || 0) + val) * 100) / 100;
        });

        return Array.from(por.values()).map(function (o) {
          o.items = Object.values(o.items).sort(function (a, b) { return b.v - a.v; })
            .map(function (it) {
              return { m: it.m, c: Math.round(it.c * 100) / 100, v: it.v, meses: it.meses };
            });
          return o;
        });
      });
    }
  };
})();


window.Util = (function () {
  const COL = {
    CASCO: '#6366f1', AUDITIVO: '#0ea5e9', RESPIRADOR: '#14b8a6',
    LENTE: '#8b5cf6', GUANTE: '#f59e0b', BOTA: '#ef4444',
    SOLDADURA: '#64748b', ROPA: '#ec4899', ARNES: '#84cc16', OTROS: '#94a3b8'
  };

  const dinero = new Intl.NumberFormat('es-PE', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });

  function soles(v) { return 'S/ ' + dinero.format(v || 0); }
  function num(v) { return dinero.format(v || 0); }
  function color(fam) { return COL[fam] || COL.OTROS; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
                 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  function mesCorto(ym) {
    const p = String(ym).split('-');
    return MESES[parseInt(p[1], 10) - 1] + ' ' + p[0];
  }

  function mesBreve(ym) {
    const p = String(ym).split('-');
    return MESES[parseInt(p[1], 10) - 1].toUpperCase();
  }

  return { soles: soles, num: num, color: color, esc: esc,
           mesCorto: mesCorto, mesBreve: mesBreve, COL: COL };
})();
