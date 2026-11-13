/* ============================================================
   Exportar la matriz a Excel
   EPPs en columnas, puestos a la izquierda y TOTAL kit.
   ============================================================ */

(function () {
  const $ = id => document.getElementById(id);

  async function exportar() {
    const btn = $('b-exportar');
    const viejo = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Generando…';

    try {
      const r = await Promise.all([Datos.meta(), Datos.columnas(), Datos.matriz()]);
      const meta = r[0];
      const cols = r[1].filter(c => c.n > 0).sort((a, b) => a.fn.localeCompare(b.fn) || b.n - a.n);
      const filas = r[2];

      const cab = ['PUESTO DE TRABAJO', 'LUGAR / CENTRO DE COSTO']
        .concat(cols.map(c => c.d))
        .concat(['TOTAL KIT (S/)']);

      const datos = filas.map(f => {
        const tiene = new Map(f.v.map(p => [p[0], p[1]]));
        return [f.p, f.l]
          .concat(cols.map(c => tiene.has(c.m) ? 1 : null))
          .concat([f.t]);
      });

      // fila de precios unitarios, como referencia
      const precios = ['', 'PRECIO UNITARIO (S/)'].concat(cols.map(c => c.p)).concat(['']);

      const aoa = [cab, precios].concat(datos);
      const ws = XLSX.utils.aoa_to_sheet(aoa);

      ws['!cols'] = [{ wch: 42 }, { wch: 30 }]
        .concat(cols.map(() => ({ wch: 16 })))
        .concat([{ wch: 14 }]);

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Matriz');

      const hoy = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, 'matriz-epp-' + hoy + '.xlsx');
    } catch (e) {
      alert('No se pudo exportar: ' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = viejo;
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('b-exportar').addEventListener('click', exportar);
  });
})();
