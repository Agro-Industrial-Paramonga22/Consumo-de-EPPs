/* ============================================================
   Capa de Datos INDEPENDIENTE — Uniformes
   ============================================================ */

window.DatosUniformes = (function () {
  const CFG = window.EPP_CONFIG || {};
  const PAGE = 1000;
  const cache = new Map();

  function num(v) { return v == null || v === '' ? 0 : Number(v); }

  function norm(s) {
    return String(s == null ? '' : s).trim().toUpperCase();
  }

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
    // --------------------------------------------------------
    // 1. Obtener todas las prendas (columnas de la matriz)
    // --------------------------------------------------------
    columnas: function () {
      return una('uniformes_columnas', async function () {
        const cs = await restAll('uniformes_catalogo?select=*&order=descripcion.asc');
        return cs.map(function (c) {
          return {
            m: c.material, 
            d: c.descripcion, 
            p: num(c.precio)
          };
        });
      });
    },

    // --------------------------------------------------------
    // 2. Obtener la matriz (cargos y sus prendas asignadas)
    // --------------------------------------------------------
    matriz: function () {
      return una('uniformes_matriz', async function () {
        const r = await Promise.all([
          restAll('uniformes_cargos?select=*&order=nombre.asc'),
          restAll('uniformes_matriz?select=cargo_id,material,requerido'),
          restAll('vw_uniformes_cargos_org?select=cargo_id,gerencia,seccion,ceco,ceco_desc')
        ]);

        const cargos = r[0];
        const relaciones = r[1];

        const matrizPorCargo = new Map();
        relaciones.forEach(function (rel) {
          if (!matrizPorCargo.has(rel.cargo_id)) matrizPorCargo.set(rel.cargo_id, []);
          if (rel.requerido) {
            matrizPorCargo.get(rel.cargo_id).push(rel.material);
          }
        });

        // Gerencia / área / lugar de cada cargo (vista derivada del maestro
        // de personas: nombre del trabajador -> CECO -> sección -> gerencia).
        const orgPorCargo = new Map();
        r[2].forEach(function (o) {
          if (!orgPorCargo.has(o.cargo_id)) orgPorCargo.set(o.cargo_id, []);
          orgPorCargo.get(o.cargo_id).push({
            gerencia: o.gerencia,
            seccion: o.seccion,
            ceco: o.ceco,
            lugar: o.ceco_desc
          });
        });

        return cargos.map(function (c) {
          return {
            id: c.id,
            p: c.nombre,
            v: matrizPorCargo.get(c.id) || [],
            org: orgPorCargo.get(c.id) || [{
              gerencia: 'Sin asignar',
              seccion: 'Sin asignar',
              ceco: 'SIN-ASIGNAR',
              lugar: 'Sin lugar de trabajo'
            }]
          };
        });
      });
    },

    // --------------------------------------------------------
    // 3. Guardar cambios manuales en la Matriz (Mover/Agregar/Quitar)
    // --------------------------------------------------------
    actualizarMatriz: async function (cargo_id, material, accion) {
      const url = CFG.SUPABASE_URL + '/rest/v1/uniformes_matriz';
      const headers = {
        'apikey': CFG.SUPABASE_KEY,
        'Authorization': 'Bearer ' + CFG.SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      };

      if (accion === 'quitar') {
        const r = await fetch(url + '?cargo_id=eq.' + cargo_id + '&material=eq.' + material, {
          method: 'DELETE', headers: headers
        });
        if (!r.ok) throw new Error('Error al eliminar: ' + (await r.text()));
        cache.delete('uniformes_matriz');
        return true;
      } 
      
      if (accion === 'agregar') {
        const body = { cargo_id: cargo_id, material: material, requerido: true };
        const r = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body) });
        if (!r.ok) throw new Error('Error al insertar: ' + (await r.text()));
        cache.delete('uniformes_matriz');
        return true;
      }
    },

    // --------------------------------------------------------
    // 4. Obtener el consumo agrupado por persona (PANTALLA 3)
    // --------------------------------------------------------
    consumo: function () {
      return una('uniformes_consumo', async function () {
        // Traemos todas las asignaciones registradas + la jerarquía de cada
        // trabajador (nombre -> CECO -> sección -> gerencia).
        const r = await Promise.all([
          restAll('uniformes_asignaciones?select=*'),
          restAll('vw_uniformes_personas_org?select=persona,gerencia,seccion,ceco,ceco_desc')
        ]);
        const asignaciones = r[0];
        const porPersona = new Map();

        const orgPorPersona = new Map();
        r[1].forEach(function (o) { orgPorPersona.set(norm(o.persona), o); });

        asignaciones.forEach(function (a) {
          const key = a.nombre; // Usamos el nombre como identificador principal

          if (!porPersona.has(key)) {
            const o = orgPorPersona.get(norm(a.nombre));
            porPersona.set(key, {
              nombre: a.nombre,
              cargo: a.cargo,
              fecha_registro: a.fecha_registro,
              total: 0,
              items: [],
              org: o ? [{ gerencia: o.gerencia, seccion: o.seccion, ceco: o.ceco, lugar: o.ceco_desc }]
                     : [{ gerencia: 'Sin asignar', seccion: 'Sin asignar', ceco: 'SIN-ASIGNAR', lugar: 'Sin lugar de trabajo' }]
            });
          }
          
          const p = porPersona.get(key);
          
          // Actualizamos a la fecha más reciente de registro para el filtro
          if (a.fecha_registro > p.fecha_registro) {
            p.fecha_registro = a.fecha_registro;
          }

          const costo = num(a.cantidad) * num(a.precio);
          p.total += costo;

          // Buscar si ya existe este material en sus items para sumar cantidades
          const itemExistente = p.items.find(i => i.material === a.material);
          if (itemExistente) {
            itemExistente.cantidad += num(a.cantidad);
          } else {
            p.items.push({
              material: a.material,
              cantidad: num(a.cantidad),
              precio: num(a.precio)
            });
          }
        });

        // Convertimos el Mapa a un Arreglo y lo ordenamos de mayor a menor costo
        return Array.from(porPersona.values()).sort((a, b) => b.total - a.total);
      });
    }
  };
})();