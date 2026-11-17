/* ============================================================
   Pantalla — MATRIZ DE UNIFORMES
   Filtros en cascada: Gerencia -> Área/Sección -> Lugar (CECO) -> Cargo
   ============================================================ */

(function () {
  const $ = function (id) { return document.getElementById(id); };
  let COLS = [], FILAS = [];
  let FILA_ACTUAL = null;
  let CASCADA = null;

  const st = { gerencia: '', seccion: '', ceco: '', cargo: '' };

  async function init() {
    try {
      const r = await Promise.all([DatosUniformes.columnas(), DatosUniformes.matriz()]);
      COLS = r[0]; FILAS = r[1];
    } catch (e) {
      $('app').innerHTML = '<div class="card vacio">No se pudieron cargar los datos.<br><small>' + e.message + '</small></div>';
      return;
    }

    $('app').classList.remove('oculto');
    $('cargando').classList.add('oculto');

    $('uf-k-prendas').textContent = COLS.length;
    document.querySelector('.brand p').textContent =
      FILAS.length + ' cargos · ' + COLS.length + ' prendas en catálogo';

    pintarFiltros();

    // Configurar pantalla completa
    $('uf-btn-fullscreen').addEventListener('click', function() {
      $('uf-tabla-wrap').classList.add('fullscreen');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        $('uf-tabla-wrap').classList.remove('fullscreen');
        cerrarDetalle();
      }
    });

    render();
  }

  /* ---------------- Filtros en cascada ---------------- */

  // Un registro por cada combinación cargo + (gerencia, área, lugar).
  // Un mismo cargo puede aparecer en varias gerencias: la matriz lo muestra
  // si cualquiera de sus combinaciones pasa el filtro.
  function registros() {
    const out = [];
    FILAS.forEach(function (f) {
      f.org.forEach(function (o) {
        out.push({
          gerencia: o.gerencia,
          seccion: o.seccion,
          ceco: o.lugar,
          cargo: f.p,
          id: f.id
        });
      });
    });
    return out;
  }

  function pintarFiltros() {
    const campos = [
      { key: 'gerencia', vacio: 'Todas las gerencias' },
      { key: 'seccion',  vacio: 'Todas las áreas' },
      { key: 'ceco',     vacio: 'Todos los lugares' },
      { key: 'cargo',    vacio: 'Todos los cargos' }
    ];

    const combos = {
      gerencia: new Combo('uf-c-gerencia', { vacio: 'Todas las gerencias' }),
      seccion:  new Combo('uf-c-seccion',  { vacio: 'Todas las áreas' }),
      ceco:     new Combo('uf-c-ceco',     { vacio: 'Todos los lugares' }),
      cargo:    new Combo('uf-c-cargo',    { vacio: 'Todos los cargos' })
    };

    CASCADA = new Cascada({
      registros: registros(),
      campos: campos,
      combos: combos,
      alCambiar: function () {
        st.gerencia = combos.gerencia.value;
        st.seccion  = combos.seccion.value;
        st.ceco     = combos.ceco.value;
        st.cargo    = combos.cargo.value;
        render();
      }
    });

    $('uf-b-limpiar').addEventListener('click', function () {
      if (CASCADA) CASCADA.limpiar();
    });

    CASCADA.recalcular();
  }

  function filasVisibles() {
    return FILAS.filter(function (f) {
      return f.org.some(function (o) {
        if (st.gerencia && o.gerencia !== st.gerencia) return false;
        if (st.seccion && o.seccion !== st.seccion) return false;
        if (st.ceco && o.lugar !== st.ceco) return false;
        if (st.cargo && f.p !== st.cargo) return false;
        return true;
      });
    });
  }

  function render() {
    const lista = filasVisibles();

    // Actualizar KPIs
    let costoTotal = 0;
    lista.forEach(f => {
      f.v.forEach(mat => {
        const prenda = COLS.find(c => c.m === mat);
        if (prenda) costoTotal += prenda.p;
      });
    });
    $('uf-k-cargos').textContent = lista.length;
    $('uf-k-costo').textContent = 'S/ ' + costoTotal.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // 1. Pintar cabecera
    const th = COLS.map(function (c) {
      return '<th class="col-epp" title="' + c.d + ' · S/ ' + c.p + '"><div class="rot">' + c.d + '</div><span class="precio">S/ ' + c.p + '</span></th>';
    }).join('');

    const cg = document.getElementById('uf-matriz-colgroup');
    if (cg) {
      cg.innerHTML = '<col style="width:320px">' + COLS.map(function () { return '<col style="width:42px">'; }).join('') + '<col style="width:104px">';
    }

    $('uf-matriz-head').innerHTML =
      '<tr><th class="col-fija"><div class="th-puesto">Cargo</div></th>' + th + 
      '<th class="col-total"><div class="th-puesto" style="justify-content:flex-end; color:#8b5cf6;">TOTAL</div></th></tr>';

    // 2. Pintar cuerpo
    const partes = [];
    lista.forEach(function (f, i) {
      let costoFila = 0;
      const celdas = COLS.map(function (c) {
        const tienePrenda = f.v.includes(c.m);
        if (tienePrenda) {
          costoFila += c.p;
          return '<td><span class="dot" style="background:#8b5cf6" title="Asignado"></span></td>';
        }
        return '<td></td>';
      }).join('');

      partes.push(
        '<tr data-i="' + i + '">' +
          '<td class="col-fija"><div class="puesto-nom">' + f.p + '</div></td>' + 
          celdas + 
          '<td class="col-total" style="color:#8b5cf6; font-weight:600;">S/ ' + costoFila.toLocaleString('es-PE', { minimumFractionDigits: 2 }) + '</td>' +
        '</tr>'
      );
    });

    $('uf-matriz-body').innerHTML = partes.join('') || '<tr><td colspan="100" style="text-align:center;padding:40px;">No hay cargos con esos filtros.</td></tr>';
    $('uf-contador').textContent = 'Mostrando ' + lista.length + ' de ' + FILAS.length + ' cargos';

    // 3. Evento click
    $('uf-matriz-body').onclick = function (e) {
      const tr = e.target.closest('tr');
      if (!tr) return;
      abrirDetalle(lista[+tr.dataset.i]);
    };
  }

  function abrirDetalle(f) {
    FILA_ACTUAL = f;
    const d = $('drawer');
    $('d-titulo').textContent = f.p;
    $('d-sub').textContent = f.v.length + ' prendas asignadas';

    let html = '';
    let costoKit = 0;
    
    if (f.v.length === 0) {
      html += '<div class="vacio">No hay uniformes asignados.</div>';
    } else {
      html += f.v.map(function (material) {
        const prenda = COLS.find(c => c.m === material);
        if (!prenda) return '';
        costoKit += prenda.p;
        return '<div class="kit-item" data-epp="' + prenda.m + '">' +
          '<span class="pt" style="background:#8b5cf6"></span>' +
          '<div class="desc">' + prenda.d + '<div class="fam">S/ ' + prenda.p + '</div></div>' +
          '<button class="btn-eliminar" onclick="window.quitarUniforme(\'' + prenda.m + '\')">Quitar</button>' +
          '</div>';
      }).join('');
      html += '<div class="kit-total" style="border-top-color:#8b5cf6;"><span>Costo del cargo</span><span>S/ ' + costoKit.toLocaleString('es-PE', {minimumFractionDigits: 2}) + '</span></div>';
    }

    html += '<div style="margin-top:16px; text-align:center;">' +
            '<button id="btn-add-prenda" class="btn-exportar" style="width:100%; border-color:#8b5cf6; color:#8b5cf6;">+ Agregar Prenda al Cargo</button>' +
            '<div id="buscador-prenda" class="oculto" style="margin-top:10px; position:relative;">' +
            '<input type="text" id="input-buscar-prenda" placeholder="Buscar prenda..." style="width:100%; box-sizing:border-box; padding:8px;">' +
            '<div id="resultados-prenda" class="resultados-busqueda"></div>' +
            '</div></div>';

    $('d-cuerpo').innerHTML = html;
    d.classList.add('abierto');

    configurarEventos();
  }

  function configurarEventos() {
    const cont = $('d-cuerpo');
    cont.onclick = function(e) {
      if (e.target.closest('#btn-add-prenda')) {
        $('buscador-prenda').classList.toggle('oculto');
        if(!$('buscador-prenda').classList.contains('oculto')) $('input-buscar-prenda').focus();
      }
    };

    const input = $('input-buscar-prenda');
    if (input) {
      input.oninput = function() {
        const q = this.value.toLowerCase().trim();
        const res = $('resultados-prenda');
        if (q.length < 2) { res.innerHTML = ''; return; }
        
        const matches = COLS.filter(c => c.d.toLowerCase().includes(q) && !FILA_ACTUAL.v.includes(c.m)).slice(0, 5);
        
        if(matches.length === 0) {
          res.innerHTML = '<div class="res-item" style="color:#94a3b8; cursor:default;">No hay coincidencias</div>';
          return;
        }

        res.innerHTML = matches.map(c => 
          `<div class="res-item" data-id="${c.m}">${c.d} (S/ ${c.p})</div>`
        ).join('');
        
        res.querySelectorAll('.res-item').forEach(el => {
          el.onclick = () => window.agregarUniforme(el.dataset.id);
        });
      };
    }
  }

  window.quitarUniforme = async function(material) {
    if (!FILA_ACTUAL) return;
    try {
      await DatosUniformes.actualizarMatriz(FILA_ACTUAL.id, material, 'quitar');
      FILA_ACTUAL.v = FILA_ACTUAL.v.filter(m => m !== material);
      render();
      abrirDetalle(FILA_ACTUAL);
    } catch(e) { alert('Error: ' + e.message); }
  };

  window.agregarUniforme = async function(material) {
    if (!FILA_ACTUAL) return;
    try {
      await DatosUniformes.actualizarMatriz(FILA_ACTUAL.id, material, 'agregar');
      FILA_ACTUAL.v.push(material);
      render();
      abrirDetalle(FILA_ACTUAL);
      $('input-buscar-prenda').value = '';
      $('buscador-prenda').classList.add('oculto');
    } catch(e) { alert('Error: ' + e.message); }
  };

  function cerrarDetalle() { 
    $('drawer').classList.remove('abierto'); 
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('b-cerrar').addEventListener('click', cerrarDetalle);
    init();
  });
})();
