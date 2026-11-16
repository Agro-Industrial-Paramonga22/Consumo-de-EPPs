/* ============================================================
   Capa de datos — Supabase
   ------------------------------------------------------------
   Lee directo de las vistas del proyecto (db/schema.sql):
     vw_meta, vw_epp_base, vw_costo_plaza, vw_consumo_plaza,
     vw_matriz_detalle, vw_matriz_adicional, vw_consumo_persona

     La web usa Datos.meta(), Datos.columnas(), Datos.matriz(),
   Datos.consumo(), Datos.actualizarMatriz(), Datos.catalogoEPPs(),
   Datos.desactivarEPP(), Datos.actualizarPrecio() y Datos.agregarEPP().
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
          restAll('vw_costo_plaza?select=plaza_id,puesto,ceco_desc,personas,costo_kit,seccion'),
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
            id: p.plaza_id,
            area: p.seccion || 'Sin Área',
            p: p.puesto, 
            l: p.ceco_desc || '(sin centro de costo)',
            n: consumidores.get(p.plaza_id) || 0,
            v: v, t: num(p.costo_kit), a: a
          };
        }).sort(function (a, b) { return a.p.localeCompare(b.p) || a.l.localeCompare(b.l); });
      });
    },

        /* Consumo real por persona (pantalla 2) */
        /* Consumo real por persona (pantalla 2) */
    consumo: function () {
      return una('consumo', async function () {
        
        // 1. Intentar leer de la caché del navegador
        const cacheGuardado = sessionStorage.getItem('epp_cache_consumo');
        if (cacheGuardado) {
          try {
            return JSON.parse(cacheGuardado);
          } catch (e) {
            console.warn('Error leyendo caché, se descargará de nuevo', e);
          }
        }

        // 2. Si no hay caché, descargar de Supabase
        const lineas = await restAll('vw_consumo_persona_agrupado?select=*');
        const por = new Map();
        
        lineas.forEach(function (x) {
          if (!por.has(x.dni)) {
            por.set(x.dni, {
              dni: x.dni, nombre: x.nombre, puesto: x.puesto || '', lugar: x.ceco_desc || '',
              area: x.seccion || 'Sin Área',
              total: 0, meses: {}, items: {}
            });
          }
          const o = por.get(x.dni);
          const mes = x.mes; 
          const val = num(x.valor);
          
          o.total = Math.round((o.total + val) * 100) / 100;
          o.meses[mes] = Math.round(((o.meses[mes] || 0) + val) * 100) / 100;
          
          const it = o.items[x.material] || (o.items[x.material] = { c: 0, v: 0, meses: {}, m: x.material });
          it.c += num(x.cantidad);
          it.v = Math.round((it.v + val) * 100) / 100;
          it.meses[mes] = Math.round(((it.meses[mes] || 0) + val) * 100) / 100;
        });

        const resultado = Array.from(por.values()).map(function (o) {
          o.items = Object.values(o.items).sort(function (a, b) { return b.v - a.v; })
            .map(function (it) {
              return { m: it.m, c: Math.round(it.c * 100) / 100, v: it.v, meses: it.meses };
            });
          return o;
        });

        // 3. Guardar en la caché para futuras visitas
        try {
          sessionStorage.setItem('epp_cache_consumo', JSON.stringify(resultado));
        } catch (e) {
          console.warn('El navegador no tiene espacio para caché', e);
        }

        return resultado;
      });
    },
    /* Escribir en Supabase (matriz_estandar) */
    actualizarMatriz: async function (plaza_id, epp_id, accion) {
      const url = CFG.SUPABASE_URL + '/rest/v1/matriz_estandar';
      const headers = {
        'apikey': CFG.SUPABASE_KEY,
        'Authorization': 'Bearer ' + CFG.SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      };

      if (accion === 'quitar_base') {
        const r = await fetch(url + '?plaza_id=eq.' + plaza_id + '&epp_id=eq.' + epp_id, {
          method: 'DELETE', headers: headers
        });
        if (!r.ok) throw new Error('Error al eliminar: ' + (await r.text()));
        cache.delete('matriz');
        return true;
      } 
      
      if (accion === 'hacer_base') {
        const body = { plaza_id: plaza_id, epp_id: epp_id, requerido: true, origen: 'manual' };
        const r = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body) });
        if (!r.ok) throw new Error('Error al insertar: ' + (await r.text()));
        cache.delete('matriz');
        return true;
      }
      
      if (accion === 'eliminar') {
        const body = { plaza_id: plaza_id, epp_id: epp_id, requerido: false, origen: 'manual' };
        const r = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body) });
        if (!r.ok) throw new Error('Error al eliminar: ' + (await r.text()));
        cache.delete('matriz');
        return true;
      }
    },

    /* --- FUNCIONES PARA EL CATÁLOGO DE EPPs --- */
    
    catalogoEPPs: async function () {
      const cs = await restAll('vw_epp_precio?select=*&order=descripcion.asc');
      return cs.map(function (c) {
        return {
          m: c.material, d: c.descripcion, f: c.familia_codigo, fn: c.familia,
          u: c.unidad, p: num(c.precio)
        };
      });
    },

    desactivarEPP: async function (material) {
      const url = CFG.SUPABASE_URL + '/rest/v1/epp?material=eq.' + material;
      const headers = {
        'apikey': CFG.SUPABASE_KEY,
        'Authorization': 'Bearer ' + CFG.SUPABASE_KEY,
        'Content-Type': 'application/json'
      };
      const r = await fetch(url, {
        method: 'PATCH', headers: headers, body: JSON.stringify({ activo: false })
      });
      if (!r.ok) throw new Error('Error al eliminar: ' + (await r.text()));
      cache.delete('columnas');
      cache.delete('matriz');
      return true;
    },

    actualizarPrecio: async function (material, nuevo_precio) {
      const url = CFG.SUPABASE_URL + '/rest/v1/precios?material=eq.' + material;
      const headers = {
        'apikey': CFG.SUPABASE_KEY,
        'Authorization': 'Bearer ' + CFG.SUPABASE_KEY,
        'Content-Type': 'application/json'
      };
      const r = await fetch(url, {
        method: 'PATCH', headers: headers, body: JSON.stringify({ precio: nuevo_precio })
      });
      if (!r.ok) throw new Error('Error al actualizar precio: ' + (await r.text()));
      cache.delete('columnas');
      cache.delete('matriz');
      return true;
    },

    agregarEPP: async function (datos) {
      const headers = {
        'apikey': CFG.SUPABASE_KEY,
        'Authorization': 'Bearer ' + CFG.SUPABASE_KEY,
        'Content-Type': 'application/json'
      };

      const bodyEpp = {
        material: datos.material,
        descripcion: datos.descripcion,
        familia_id: parseInt(datos.familia_id),
        unidad: datos.unidad,
        activo: true,
        solo_soldadura: false
      };
      
      let r = await fetch(CFG.SUPABASE_URL + '/rest/v1/epp', {
        method: 'POST', headers: headers, body: JSON.stringify(bodyEpp)
      });
      if (!r.ok) throw new Error(await r.text());

      const bodyPrecio = {
        material: datos.material,
        precio: parseFloat(datos.precio),
        moneda: 'PEN',
        vigente_desde: new Date().toISOString().split('T')[0],
        fuente: 'MANUAL'
      };
      
      r = await fetch(CFG.SUPABASE_URL + '/rest/v1/precios', {
        method: 'POST', headers: headers, body: JSON.stringify(bodyPrecio)
      });
      if (!r.ok) throw new Error(await r.text());

      cache.delete('columnas');
      cache.delete('matriz');
      return true;
    },

    /* --- NUEVAS FUNCIONES (Paso 3) --- */
    
    reactivarEPP: async function (material) {
      const url = CFG.SUPABASE_URL + '/rest/v1/epp?material=eq.' + material;
      const headers = {
        'apikey': CFG.SUPABASE_KEY,
        'Authorization': 'Bearer ' + CFG.SUPABASE_KEY,
        'Content-Type': 'application/json'
      };
      const r = await fetch(url, {
        method: 'PATCH', headers: headers, body: JSON.stringify({ activo: true })
      });
      if (!r.ok) throw new Error('Error al reactivar: ' + (await r.text()));
      cache.delete('columnas');
      cache.delete('matriz');
      return true;
    },

    eppsInactivos: async function () {
      const cs = await restAll('epp?select=material,descripcion,unidad&activo=eq.false');
      return cs.map(c => ({ m: c.material, d: c.descripcion, u: c.unidad }));
    },

    reconciliarDnis: async function () {
      const r = await fetch(CFG.SUPABASE_URL + '/rest/v1/rpc/reconciliar_dnis_huerfanos', {
        method: 'POST',
        headers: {
          'apikey': CFG.SUPABASE_KEY,
          'Authorization': 'Bearer ' + CFG.SUPABASE_KEY,
          'Content-Type': 'application/json'
        }
      });
      if (!r.ok) throw new Error('Error al reconciliar: ' + (await r.text()));
      cache.delete('consumo');
      cache.delete('matriz');
      return true;
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