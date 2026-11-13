/* ============================================================
   Pantalla 3 — Actualizar datos
   Toma los Excel del SAP, los convierte con ETL y llama a la
   función cargar_todo() de Supabase.
   ============================================================ */

(function () {
  const CFG = window.EPP_CONFIG;
  const $ = id => document.getElementById(id);

  const ARCHIVOS = {
    consumo: 'f-consumo',
    mae: 'f-mae',
    costos: 'f-costos',
    servicios: 'f-servicios',
    stock: 'f-stock'
  };

  function archivo(id) {
    const inp = $(id);
    return inp && inp.files && inp.files[0] ? inp.files[0] : null;
  }

  function marcarOk(id, okId) {
    const f = archivo(id);
    $(okId).textContent = f ? '✓ ' + f.name : '';
    $(okId).style.color = f ? '#059669' : '#94a3b8';
  }

  Object.keys(ARCHIVOS).forEach(k => {
    $(ARCHIVOS[k]).addEventListener('change', () => {
      marcarOk(ARCHIVOS[k], 'ok-' + k);
      $('estado').textContent = '';
      $('problemas').style.display = 'none';
    });
  });

  function errores(lista) {
    $('problemas').style.display = 'block';
    $('lista-errores').innerHTML = lista.map(e => '<li>' + e + '</li>').join('');
    $('resultado').style.display = 'none';
    $('estado').textContent = '';
    $('b-subir').disabled = false;
  }

  function fmt(n) { return new Intl.NumberFormat('es-PE').format(n); }
  function soles(n) { return 'S/ ' + new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2 }).format(n || 0); }

  $('b-subir').addEventListener('click', async function () {
    const btn = this;
    $('problemas').style.display = 'none';
    $('resultado').style.display = 'none';
    btn.disabled = true;

    try {
      $('estado').textContent = 'Leyendo los Excel…';
      const r = await ETL.construir({
        consumo: archivo('f-consumo'),
        mae: archivo('f-mae'),
        costos: archivo('f-costos'),
        servicios: archivo('f-servicios'),
        stock: archivo('f-stock')
      });

      if (r.errores.length) { errores(r.errores); return; }

      $('estado').textContent = 'Subiendo ' + fmt(r.resumen.consumo) +
        ' líneas de consumo y ' + fmt(r.resumen.personas) + ' personas…';

      const resp = await fetch(CFG.SUPABASE_URL + '/rest/v1/rpc/cargar_todo', {
        method: 'POST',
        headers: {
          apikey: CFG.SUPABASE_KEY,
          Authorization: 'Bearer ' + CFG.SUPABASE_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ p: r.payload, p_clave: CFG.CLAVE_CARGA })
      });

      const txt = await resp.text();
      if (!resp.ok) {
        let msg = txt;
        try { msg = JSON.parse(txt).message || txt; } catch (e) {}
        errores(['Supabase rechazó la carga: ' + msg]);
        return;
      }

      const res = JSON.parse(txt);
      const m = res.meta || {};
      $('resumen').innerHTML =
        '<table class="resumen-tabla">' +
        fila('Personas', fmt(res.personas)) +
        fila('Plazas', fmt(res.plazas)) +
        fila('Consumo', fmt(res.consumo) + ' líneas (' + fmt(res.consumo_ok) + ' con DNI · ' +
             fmt(res.consumo_sin_dni) + ' sin DNI · ' + fmt(res.consumo_huerfano) + ' huérfano)') +
        fila('EPPs', fmt(res.epps)) +
        fila('Matriz base', fmt(res.matriz) + ' celdas · ' + fmt(m.epps_base) + ' EPPs') +
        fila('Costo de dotación', soles(m.costo_dotacion)) +
        fila('Consumo del período', soles(m.valor)) +
        (res.manual_previas ? fila('Celdas manuales conservadas', fmt(res.manual_previas)) : '') +
        '</table>' +
        '<p style="margin:14px 0 0;font-size:13px"><a href="index.html">Ver la matriz →</a></p>';

      $('resultado').style.display = 'block';
      $('estado').textContent = 'Listo.';
    } catch (e) {
      errores([String(e.message || e)]);
    } finally {
      btn.disabled = false;
    }
  });

  function fila(k, v) {
    return '<tr><th>' + k + '</th><td>' + v + '</td></tr>';
  }
})();
