/* ============================================================
   Pantalla — CONSUMO DE UNIFORMES
   Filtros en cascada: Gerencia -> Área/Sección -> Lugar (CECO) -> Trabajador
   ============================================================ */

(function () {
  const $ = function (id) { return document.getElementById(id); };
  let PERSONAS = [];
  let CASCADA = null;
  const porMaterial = new Map(); // Para guardar los nombres reales

  const st = { gerencia: '', seccion: '', ceco: '', persona: '', anio: '' };

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

    pintarFiltros();
    render();
  }

  /* ---------------- Filtros en cascada ---------------- */

  // Un registro por cada combinación trabajador + (gerencia, área, lugar).
  function registros() {
    const out = [];
    PERSONAS.forEach(function (p) {
      p.org.forEach(function (o) {
        out.push({
          gerencia: o.gerencia,
          seccion: o.seccion,
          ceco: o.lugar,
          persona: p.nombre
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
      { key: 'persona',  vacio: 'Todos los trabajadores' }
    ];

    const combos = {
      gerencia: new Combo('c-gerencia', { vacio: 'Todas las gerencias' }),
      seccion:  new Combo('c-seccion',  { vacio: 'Todas las áreas' }),
      ceco:     new Combo('c-ceco',     { vacio: 'Todos los lugares' }),
      persona:  new Combo('c-persona',  { vacio: 'Todos los trabajadores' })
    };

    CASCADA = new Cascada({
      registros: registros(),
      campos: campos,
      combos: combos,
      alCambiar: function () {
        st.gerencia = combos.gerencia.value;
        st.seccion  = combos.seccion.value;
        st.ceco     = combos.ceco.value;
        st.persona  = combos.persona.value;
        render();
      }
    });

    $('f-anio').addEventListener('change', function () {
      st.anio = this.value;
      render();
    });

    $('b-limpiar').addEventListener('click', function () {
      $('f-anio').value = '';
      st.anio = '';
      if (CASCADA) CASCADA.limpiar();
      else render();
    });

    CASCADA.recalcular();
  }

  function filasVisibles() {
    return PERSONAS.filter(function (p) {
      // Gerencia / área / lugar: basta con que una combinación del
      // trabajador pase los tres filtros.
      const pasaOrg = p.org.some(function (o) {
        if (st.gerencia && o.gerencia !== st.gerencia) return false;
        if (st.seccion && o.seccion !== st.seccion) return false;
        if (st.ceco && o.lugar !== st.ceco) return false;
        return true;
      });
      if (!pasaOrg) return false;

      if (st.persona && p.nombre !== st.persona) return false;

      // Regla del Año: si el registro es 2019 y el filtro 2025, debe aparecer.
      if (st.anio) {
        const anioRegistro = p.fecha_registro.split('-')[0];
        if (parseInt(anioRegistro) > parseInt(st.anio)) return false;
      }

      return true;
    });
  }

    function render() {
    // 1. Filtrar
    const lista = filasVisibles();

    // 2. Calcular KPIs
    let granTotal = 0;
    lista.forEach(p => { granTotal += p.total; });

    $('k-personas').textContent = lista.length;
    
    // Volvemos a pintar el Costo Total del Filtro
    $('k-total').textContent = 'S/ ' + granTotal.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // --- Actualizar la tarjeta de Máx y Mín Consumo ---
    const rankingActual = obtenerRankingSecciones();
    if (rankingActual.length > 0) {
      const max = rankingActual[0];
      const min = rankingActual[rankingActual.length - 1];
      
      $('k-rank-max-sec').textContent = max.nombre;
      $('k-rank-max-sec').title = max.nombre;
      $('k-rank-max-val').textContent = 'S/ ' + max.gasto.toLocaleString('es-PE', { minimumFractionDigits: 2 });
      
      $('k-rank-min-sec').textContent = min.nombre;
      $('k-rank-min-sec').title = min.nombre;
      $('k-rank-min-val').textContent = 'S/ ' + min.gasto.toLocaleString('es-PE', { minimumFractionDigits: 2 });
    } else {
      $('k-rank-max-sec').textContent = '—';
      $('k-rank-max-val').textContent = '—';
      $('k-rank-min-sec').textContent = '—';
      $('k-rank-min-val').textContent = '—';
    }
    
    $('contador').textContent = 'Mostrando ' + lista.length + ' de ' + PERSONAS.length + ' personas';

    // ... (El resto de tu función render() sigue igual, desde "const html = lista.map...")

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

    /* ---------------- LÓGICA DE RANKING (Navegación y Filtros) ---------------- */
  let rankingView = { level: 'secciones', seccionActiva: null };

  function obtenerRankingSecciones() {
    const porSeccion = {};
    const listaFiltrada = filasVisibles();

    listaFiltrada.forEach(p => {
      if (st.seccion) {
        const sec = st.seccion || 'SIN ÁREA';
        porSeccion[sec] = (porSeccion[sec] || 0) + p.total;
      } else {
        const secs = new Set(p.org.map(o => o.seccion || 'SIN ÁREA'));
        secs.forEach(sec => {
          porSeccion[sec] = (porSeccion[sec] || 0) + p.total;
        });
      }
    });

    return Object.keys(porSeccion).map(sec => ({
      nombre: sec,
      gasto: porSeccion[sec]
    })).sort((a, b) => b.gasto - a.gasto);
  }

  function obtenerRankingCecos(seccionFiltro) {
    const porCeco = {};
    const listaFiltrada = filasVisibles();

    listaFiltrada.forEach(p => {
      const cecos = new Set();
      p.org.forEach(o => {
        if (o.seccion === seccionFiltro) {
          cecos.add(o.lugar || 'SIN CECO');
        }
      });
      cecos.forEach(c => {
        porCeco[c] = (porCeco[c] || 0) + p.total;
      });
    });

    return Object.keys(porCeco).map(c => ({
      nombre: c,
      gasto: porCeco[c]
    })).sort((a, b) => b.gasto - a.gasto);
  }

  function abrirModalRanking() {
    rankingView = { level: 'secciones', seccionActiva: null };
    renderRankingModal();
    $('modal-ranking').classList.remove('oculto');
  }

  function renderRankingModal() {
    let html = '';
    html += '<table style="width:100%; border-collapse:collapse; text-align:left;">';
    html += '<thead><tr style="border-bottom:2px solid #e2e8f0; color:#64748b; font-size:12px; text-transform:uppercase; letter-spacing:0.5px;">';
    html += '<th style="padding:12px 16px; width:50px;">#</th>';
    html += `<th style="padding:12px 16px;">${rankingView.level === 'secciones' ? 'Sección / Área' : 'CECO / Lugar'}</th>`;
    html += '<th style="padding:12px 16px; text-align:right; white-space: nowrap;">Consumo</th>';
    html += '</tr></thead><tbody>';

    const datos = rankingView.level === 'secciones' 
      ? obtenerRankingSecciones() 
      : obtenerRankingCecos(rankingView.seccionActiva);

    if (datos.length === 0) {
      html += '<tr><td colspan="3" style="padding:40px; text-align:center; color:#94a3b8;">No hay datos para el filtro actual</td></tr>';
    } else {
      datos.forEach((item, index) => {
        const colorNum = index === 0 ? '#ef4444' : '#64748b';
        const pesoNum = index === 0 ? 'bold' : 'normal';
        html += `<tr class="fila-ranking" data-nombre="${item.nombre}" style="border-bottom:1px solid #f1f5f9; font-size:14px; cursor:pointer; transition: background 0.15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
            <td style="padding:14px 16px; font-weight:${pesoNum}; color:${colorNum};">${index + 1}</td>
            <td style="padding:14px 16px; color:#0f172a; font-weight:500;">${item.nombre}</td>
            <td style="padding:14px 16px; text-align:right; white-space: nowrap; color:${index === 0 ? '#ef4444' : '#8b5cf6'}; font-weight:600;">S/ ${item.gasto.toLocaleString('es-PE', {minimumFractionDigits: 2})}</td>
        </tr>`;
      });
    }
    html += '</tbody></table>';
    $('ranking-contenido').innerHTML = html;
    asignarEventosRanking();
  }

  function asignarEventosRanking() {
    const filas = document.querySelectorAll('.fila-ranking');
    filas.forEach(fila => {
      const nombre = fila.getAttribute('data-nombre');

      fila.addEventListener('click', function() {
        if (rankingView.level === 'secciones') {
          rankingView.level = 'cecos';
          rankingView.seccionActiva = nombre;
          renderRankingModal();
        }
      });

      fila.addEventListener('dblclick', function() {
        if (rankingView.level === 'secciones') {
          if (CASCADA && CASCADA.combos.seccion) CASCADA.combos.seccion.setValue(nombre); 
          if (CASCADA && CASCADA.combos.ceco) CASCADA.combos.ceco.setValue('');
          if (CASCADA && CASCADA.combos.persona) CASCADA.combos.persona.setValue('');
        } else {
          if (CASCADA && CASCADA.combos.seccion) CASCADA.combos.seccion.setValue(rankingView.seccionActiva);
          if (CASCADA && CASCADA.combos.ceco) CASCADA.combos.ceco.setValue(nombre);
          if (CASCADA && CASCADA.combos.persona) CASCADA.combos.persona.setValue('');
        }
        
        if (CASCADA) {
          CASCADA.recalcular();
        } else {
          render();
        }
        
        $('modal-ranking').classList.add('oculto');
        rankingView = { level: 'secciones', seccionActiva: null };
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('b-cerrar').addEventListener('click', cerrarDetalle);
    
    // --- EVENTOS DEL RANKING ---
    $('btn-ranking-secciones').addEventListener('click', abrirModalRanking);
    
    $('b-cerrar-ranking').addEventListener('click', function() {
      $('modal-ranking').classList.add('oculto');
      rankingView = { level: 'secciones', seccionActiva: null };
    });

    $('modal-ranking').addEventListener('click', function(e) {
      if (e.target === this) {
        this.classList.add('oculto');
        rankingView = { level: 'secciones', seccionActiva: null };
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        const modal = $('modal-ranking');
        if (modal && !modal.classList.contains('oculto')) {
          if (rankingView.level === 'cecos') {
            rankingView.level = 'secciones';
            rankingView.seccionActiva = null;
            renderRankingModal();
          } else {
            modal.classList.add('oculto');
            rankingView = { level: 'secciones', seccionActiva: null };
          }
        } else {
          cerrarDetalle(); // Cierra el panel lateral si no hay modal abierto
        }
      }
    });
    // ---------------------------

    init();
  });
})();
