/* ============================================================
   Pantalla — CONSUMO DE UNIFORMES
   ============================================================ */

(function () {
  const $ = function (id) { return document.getElementById(id); };
  let PERSONAS = [];
  let filtroTexto = '';
  let filtroAnio = '';
  const porMaterial = new Map(); // Para guardar los nombres reales

  async function init() {
    try {
      // Cargamos tanto el consumo como el catálogo (para los nombres)
      const r = await Promise.all([
        DatosUniformes.consumo(), 
        DatosUniformes.columnas()
      ]);
      PERSONAS = r[0];
      
      // Llenamos el diccionario de materiales -> nombres
      r[1].forEach(function(c) {
        porMaterial.set(c.m, c.d);
      });

    } catch (e) {
      $('app').innerHTML = '<div class="card vacio">No se pudieron cargar los datos.<br><small>' + e.message + '</small></div>';
      return;
    }

    $('app').classList.remove('oculto');
    $('cargando').classList.add('oculto');
    
    document.querySelector('.brand p').textContent = PERSONAS.length + ' personas con uniformes registrados';

    // Filtros
    $('f-buscar').addEventListener('input', function() {
      filtroTexto = this.value.toLowerCase().trim();
      render();
    });

    $('f-anio').addEventListener('change', function() {
      filtroAnio = this.value;
      render();
    });

    $('b-limpiar').addEventListener('click', function() {
      $('f-buscar').value = '';
      $('f-anio').value = '';
      filtroTexto = '';
      filtroAnio = '';
      render();
    });

    render();
  }

  function render() {
    // 1. Filtrar
    const lista = PERSONAS.filter(p => {
      if (filtroTexto && p.nombre.toLowerCase().indexOf(filtroTexto) === -1) return false;
      
      // Regla del Año: Si registro es 2019, y filtro es 2025, debe aparecer.
      if (filtroAnio) {
        const anioRegistro = p.fecha_registro.split('-')[0];
        if (parseInt(anioRegistro) > parseInt(filtroAnio)) return false;
      }
      
      return true;
    });

    // 2. Calcular KPIs
    let granTotal = 0;
    lista.forEach(p => { granTotal += p.total; });

    $('k-personas').textContent = lista.length;
    $('k-total').textContent = 'S/ ' + granTotal.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    $('contador').textContent = 'Mostrando ' + lista.length + ' de ' + PERSONAS.length + ' personas';

    // 3. Pintar tabla
    const html = lista.map(function(p, i) {
      // Formatear fecha a DD/MM/YYYY
      const partesFecha = p.fecha_registro.split('-');
      const fechaMostrar = partesFecha.length === 3 ? `${partesFecha[2]}/${partesFecha[1]}/${partesFecha[0]}` : p.fecha_registro;

      return '<tr class="fila" data-i="' + i + '">' +
        '<td><div class="nombre">' + p.nombre + '</div><div class="lugar">' + p.cargo + '</div></td>' +
        '<td style="text-align:center;">' + fechaMostrar + '</td>' +
        '<td class="destacado-num" style="color:#8b5cf6;">S/ ' + p.total.toLocaleString('es-PE', { minimumFractionDigits: 2 }) + '</td>' +
      '</tr>';
    }).join('');

    $('cuerpo').innerHTML = html || '<tr><td colspan="3" style="text-align:center;padding:40px;">No hay personas que coincidan con el filtro.</td></tr>';

    // 4. Evento click
    $('cuerpo').onclick = function (e) {
      const tr = e.target.closest('tr.fila');
      if (!tr) return;
      abrirDetalle(lista[+tr.dataset.i]);
    };
  }

  function abrirDetalle(p) {
    const d = $('drawer');
    $('d-titulo').textContent = p.nombre;
    $('d-sub').textContent = p.cargo + ' · Registrado el ' + p.fecha_registro;

    let html = p.items.map(function (it) {
      // AQUÍ ESTÁ LA MAGIA: Buscamos el nombre real en el diccionario
      const nombreReal = porMaterial.get(it.material) || it.material;
      
      return '<div class="kit-item">' +
        '<span class="pt" style="background:#8b5cf6"></span>' +
        '<div class="desc">' + nombreReal + '<div class="fam">Cantidad: ' + it.cantidad + '</div></div>' +
        '<div class="precio">S/ ' + (it.cantidad * it.precio).toLocaleString('es-PE', {minimumFractionDigits: 2}) + '</div>' +
        '</div>';
    }).join('');

    html += '<div class="kit-total" style="border-top-color:#8b5cf6;"><span>Costo Total</span><span style="color:#8b5cf6;">S/ ' + p.total.toLocaleString('es-PE', {minimumFractionDigits: 2}) + '</span></div>';

    $('d-cuerpo').innerHTML = html;
    d.classList.add('abierto');
  }

  function cerrarDetalle() { $('drawer').classList.remove('abierto'); }

  document.addEventListener('DOMContentLoaded', function () {
    $('b-cerrar').addEventListener('click', cerrarDetalle);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') cerrarDetalle();
    });
    init();
  });
})();