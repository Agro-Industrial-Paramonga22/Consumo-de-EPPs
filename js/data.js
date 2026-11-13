/* ============================================================
   Capa de datos + utilidades compartidas
   ------------------------------------------------------------
   Hoy lee los JSON de /datos (generados por scripts/exportar_datos.py).
   Cuando Supabase tenga el esquema cargado, este es el ÚNICO archivo
   que hay que cambiar: las páginas sólo usan Datos.meta(), Datos.columnas(),
   Datos.matriz() y Datos.consumo().
   ============================================================ */

window.Datos = (function () {
  const BASE = 'datos/';
  const cache = new Map();

  function json(nombre) {
    if (cache.has(nombre)) return cache.get(nombre);
    const p = fetch(BASE + nombre, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('No se pudo leer ' + nombre + ' (' + r.status + ')');
      return r.json();
    });
    cache.set(nombre, p);
    return p;
  }

  return {
    meta:     function () { return json('meta.json'); },
    columnas: function () { return json('columnas.json'); },
    matriz:   function () { return json('matriz.json'); },
    consumo:  function () { return json('consumo.json'); }
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

  function soles(v) {
    return 'S/ ' + dinero.format(v || 0);
  }

  function num(v) {
    return dinero.format(v || 0);
  }

  function color(fam) {
    return COL[fam] || COL.OTROS;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
                 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  function mesCorto(ym) {          // '2026-03' -> 'mar 2026'
    const p = String(ym).split('-');
    return MESES[parseInt(p[1], 10) - 1] + ' ' + p[0];
  }

  function mesBreve(ym) {          // '2026-03' -> 'MAR'
    const p = String(ym).split('-');
    return MESES[parseInt(p[1], 10) - 1].toUpperCase();
  }

  return { soles: soles, num: num, color: color, esc: esc,
           mesCorto: mesCorto, mesBreve: mesBreve, COL: COL };
})();
