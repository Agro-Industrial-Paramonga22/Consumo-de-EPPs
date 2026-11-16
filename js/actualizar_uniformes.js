/* ============================================================
   Pantalla — Actualizar Uniformes
   ============================================================ */

(function () {
  const CFG = window.EPP_CONFIG;
  const $ = id => document.getElementById(id);

  $('b-subir-uniformes').addEventListener('click', async function () {
    const btn = this;
    $('problemas-uf').style.display = 'none';
    $('resultado-uf').style.display = 'none';
    btn.disabled = true;

    try {
      const file = $('f-uniformes').files[0];
      if (!file) {
        alert('Selecciona un archivo Excel de Uniformes primero.');
        btn.disabled = false;
        return;
      }

      $('estado-uf').textContent = 'Leyendo Excel de Uniformes...';
      
      // Llamamos al ETL de Uniformes
      const r = await ETL_Uniformes.construir(file);

      if (r.errores.length) {
        $('problemas-uf').style.display = 'block';
        $('lista-errores-uf').innerHTML = r.errores.map(e => '<li>' + e + '</li>').join('');
        $('estado-uf').textContent = '';
        btn.disabled = false;
        return;
      }

      $('estado-uf').textContent = 'Subiendo a Supabase...';

      // Enviamos a la función RPC cargar_uniformes
      const resp = await fetch(CFG.SUPABASE_URL + '/rest/v1/rpc/cargar_uniformes', {
        method: 'POST',
        headers: {
          apikey: CFG.SUPABASE_KEY,
          Authorization: 'Bearer ' + CFG.SUPABASE_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ p: r.payload })
      });

      if (!resp.ok) {
        throw new Error('Error de Supabase: ' + await resp.text());
      }

      const resumenHtml = `
        <table class="resumen-tabla">
          <tr><th>Prendas en Catálogo</th><td>${r.resumen.prendas}</td></tr>
          <tr><th>Cargos Procesados</th><td>${r.resumen.cargos}</td></tr>
          <tr><th>Asignaciones a Matriz</th><td>${r.resumen.asignaciones}</td></tr>
        </table>
        <p style="margin:14px 0 0;font-size:13px"><a href="uniformes.html">Ver Matriz de Uniformes →</a></p>
      `;

      $('resumen-uf').innerHTML = resumenHtml;
      $('resultado-uf').style.display = 'block';
      $('estado-uf').textContent = 'Listo. Proceso completado.';
    } catch (e) {
      $('problemas-uf').style.display = 'block';
      $('lista-errores-uf').innerHTML = '<li>' + e.message + '</li>';
      $('estado-uf').textContent = '';
    } finally {
      btn.disabled = false;
    }
  });
})();