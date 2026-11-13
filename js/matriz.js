/* ============================================================
   Pantalla 1 — MATRIZ
   Horizontal: puestos de trabajo (con su lugar / centro de costo)
   Vertical  : EPPs
   Verde     : ese puesto consume ese EPP (un solo EPP por familia)
   ============================================================ */

(function () {
  const U = Util;
  let META = null, COLS = [], FILAS = [];
  const porMaterial = new Map();
  let FILA_ACTUAL = null; // Variable para guardar la plaza que estamos viendo en el drawer

  const st = {
    lugar: '',
    puesto: '',
    fams: new Set(),
    vacias: true,     // mostrar plazas sin ningún consumo
    orden: 'total'    // 'total' (mayor costo primero) | 'puesto' (alfabético)
  };

  const $ = function (id) { return document.getElementById(id); };

  /* ---------------- carga ---------------- */
  async function init() {
    try {
      const r = await Promise.all([Datos.meta(), Datos.columnas(), Datos.matriz()]);
      META = r[0]; COLS = r[1]; FILAS = r[2];
    } catch (e) {
      $('app').innerHTML =
        '<div class="card vacio">No se pudieron cargar los datos.<br><small>' +
        U.esc(e.message) + '</small><br><br>' +
        'Sirve la carpeta con un servidor local (Live Server), no abras el archivo con doble clic.</div>';
      return;
    }

    COLS.forEach(function (c) { porMaterial.set(c.m, c); });
    FILAS.forEach(function (f) {
      f._m = new Map();
      f.v.forEach(function (p) { f._m.set(p[0], p[1]); });
    });

    pintarKpis();
    pintarFiltros();
    pintarCabecera();
    render();
    $('app').classList.remove('oculto');
    $('cargando').classList.add('oculto');
  }

  /* ---------------- KPIs ---------------- */
  function pintarKpis() {
    $('k-plazas').textContent = META.plazas;
    $('k-plazas-sub').textContent = META.plazas_con_consumo + ' con consumo registrado';
    $('k-epps').textContent = META.epps_base || META.epps;
    $('k-costo').textContent = U.soles(META.costo_dotacion);
    $('k-costo-sub').textContent = 'suma de las ' + META.plazas + ' plazas';
    document.querySelector('.brand p').textContent =
      U.mesCorto(META.meses[0]) + ' – ' + U.mesCorto(META.meses[META.meses.length - 1]) +
      ' · ' + U.soles(META.valor) + ' consumidos';
  }

  /* ---------------- filtros ---------------- */
  function pintarFiltros() {
    const lugares = Array.from(new Set(FILAS.map(function (f) { return f.l; }))).sort();
    const sel = $('f-lugar');
    lugares.forEach(function (l) {
      const o = document.createElement('option');
      o.value = l; o.textContent = l;
      sel.appendChild(o);
    });

    const fams = [];
    COLS.forEach(function (c) {
      if (!fams.some(function (x) { return x.f === c.f; })) fams.push({ f: c.f, fn: c.fn });
    });
    fams.sort(function (a, b) { return a.fn.localeCompare(b.fn); });

    const cont = $('f-familias');
    cont.innerHTML = fams.map(function (x) {
      return '<span class="chip" data-fam="' + x.f + '">' +
             '<span class="pt" style="background:' + U.color(x.f) + '"></span>' +
             U.esc(x.fn) + '</span>';
    }).join('');

    cont.addEventListener('click', function (e) {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const f = chip.dataset.fam;
      if (st.fams.has(f)) st.fams.delete(f); else st.fams.add(f);
      chip.classList.toggle('on');
      render();
    });

    $('f-lugar').addEventListener('change', function () { st.lugar = this.value; render(); });
    $('f-puesto').addEventListener('input', function () {
      st.puesto = this.value.trim().toLowerCase();
      clearTimeout(window._t); window._t = setTimeout(render, 160);
    });
    $('t-vacias').addEventListener('change', function () { st.vacias = this.checked; render(); });
    $('b-limpiar').addEventListener('click', limpiar);
  }

  function limpiar() {
    st.lugar = ''; st.puesto = ''; st.fams.clear();
    st.vacias = true;
    $('f-lugar').value = ''; $('f-puesto').value = '';
    $('t-vacias').checked = true;
    document.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('on'); });
    render();
  }

  /* ---------------- cabecera de la tabla ---------------- */
  function columnasVisibles() {
    return COLS.filter(function (c) {
      if (c.n === 0) return false;              // solo EPPs que son base en algún puesto
      if (st.fams.size && !st.fams.has(c.f)) return false;
      return true;
    });
  }

  function pintarCabecera() {
    const cols = columnasVisibles();
    const th = cols.map(function (c) {
      return '<th class="col-epp" title="' + U.esc(c.d) + ' · ' + U.esc(c.fn) +
             ' · ' + U.soles(c.p) + ' / ' + U.esc(c.u) + '">' +
             '<span class="fam-bar" style="background:' + U.color(c.f) + '"></span>' +
             '<div class="rot">' + U.esc(c.d) + '</div>' +
             '<span class="precio">' + U.soles(c.p) + '</span></th>';
    }).join('');

    const cg = document.getElementById('matriz-colgroup');
    if (cg) {
      cg.innerHTML = '<col style="width:320px">' +
        cols.map(function () { return '<col style="width:42px">'; }).join('') +
        '<col style="width:104px">';
    }

    $('matriz-head').innerHTML =
      '<tr><th class="col-fija"><div class="th-puesto">Puesto de trabajo · lugar</div></th>' +
      th +
      '<th class="col-total" id="th-total" style="cursor:pointer" title="Clic para cambiar el orden">' +
      '<div class="th-puesto" style="justify-content:flex-end">TOTAL kit ' +
      (st.orden === 'total' ? '↓' : '') + '</div></th></tr>';

    const thTot = document.getElementById('th-total');
    thTot.addEventListener('click', function () {
      st.orden = st.orden === 'total' ? 'puesto' : 'total';
      this.querySelector('.th-puesto').textContent =
        st.orden === 'total' ? 'TOTAL kit ↓' : 'TOTAL kit';
      render();
    });
  }

  /* ---------------- cuerpo ---------------- */
  function filasVisibles() {
    const q = st.puesto;
    return FILAS.filter(function (f) {
      if (st.lugar && f.l !== st.lugar) return false;
      if (q && f.p.toLowerCase().indexOf(q) === -1) return false;
      if (!st.vacias && f.v.length === 0) return false;
      return true;
    });
  }

  function render() {
    const cols = columnasVisibles();
    const filas = filasVisibles();
    pintarCabecera();          // encabezado y colgroup siguen a las columnas visibles

    if (st.orden === 'total') {
      filas.sort(function (a, b) {
        return (b.t - a.t) || a.p.localeCompare(b.p) || a.l.localeCompare(b.l);
      });
    } else {
      filas.sort(function (a, b) {
        return a.p.localeCompare(b.p) || a.l.localeCompare(b.l);
      });
    }

    const partes = [];
    for (let i = 0; i < filas.length; i++) {
      const f = filas[i];
      const vacia = f.v.length === 0;
      const celdas = new Array(cols.length);
      for (let j = 0; j < cols.length; j++) {
        const cob = f._m.get(cols[j].m);
        if (cob === undefined) {
          celdas[j] = '<td></td>';
        } else {
          const col = porMaterial.get(cols[j].m);
          celdas[j] = '<td><span class="dot' +
            '" data-tip="' + U.esc(col.d) + '&#10;' + U.esc(col.fn) +
            ' · ' + U.soles(col.p) +
            '&#10;Consumo base: lo recibió el ' + cob + '% de las personas con consumo"></span></td>';
        }
      }
      partes.push(
        '<tr class="' + (vacia ? 'vacia' : '') + '" data-i="' + i + '">' +
          '<td class="col-fija">' +
            '<div class="puesto-nom">' + U.esc(f.p) +
              (f.n ? '<span class="puesto-n">' + f.n + '</span>' : '') + '</div>' +
            '<div class="puesto-lug">' + U.esc(f.l) + '</div>' +
          '</td>' + celdas.join('') +
          '<td class="col-total">' +
            (vacia ? '<span class="pendiente">sin consumo</span>' : U.soles(f.t)) +
          '</td>' +
        '</tr>');
    }

    $('matriz-body').innerHTML = partes.join('');

    $('contador').textContent =
      'Mostrando ' + filas.length + ' de ' + FILAS.length + ' plazas · ' +
      cols.length + ' EPPs';

    // clic en una fila -> panel de detalle
    $('matriz-body').onclick = function (e) {
      const tr = e.target.closest('tr');
      if (!tr) return;
      abrirDetalle(filas[+tr.dataset.i]);
    };
  }

  /* ---------------- panel de detalle ---------------- */
  function abrirDetalle(f) {
    FILA_ACTUAL = f; // Guardamos la fila actual
    const d = $('drawer');
    $('d-titulo').textContent = f.p;
    $('d-sub').textContent = f.l + ' · ' + (f.n || 0) + ' persona(s) con consumo en esta plaza';

    let html = '';
    if (f.v.length === 0) {
      html = '<div class="vacio">Esta plaza no tiene ningún consumo registrado con DNI.' +
             '<br><br>El kit está <b>pendiente de definir</b>.</div>';
    } else {
      const items = f.v.map(function (p) {
        return { c: porMaterial.get(p[0]), cob: p[1] };
      }).sort(function (a, b) { return b.c.p - a.c.p; });

      // --- ÍTEMS DEL KIT BASE (Interactivos) ---
      html = items.map(function (it) {
        return '<div class="kit-item" data-epp="' + it.c.m + '" data-tipo="base">' +
          '<span class="pt" style="background:' + U.color(it.c.f) + '"></span>' +
          '<div class="desc">' + U.esc(it.c.d) +
            '<div class="fam">' + U.esc(it.c.fn) + ' · lo recibió el ' + it.cob + '%</div></div>' +
          '<div class="precio">' + U.soles(it.c.p) + '</div></div>';
      }).join('') +
      '<div class="kit-total"><span>Costo del kit base</span><span>' + U.soles(f.t) + '</span></div>';

      // --- ÍTEMS ADICIONALES (Interactivos) ---
      if (f.a && f.a.length) {
        html += '<div style="margin-top:14px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em">' +
                'Consumo adicional · fuera de la matriz</div>';
        html += f.a.map(function (p) {
          const c = porMaterial.get(p[0]);
          // Validación por si el EPP adicional no está en la lista de columnas base
          if(!c) return ''; 
          return '<div class="kit-item" data-epp="' + c.m + '" data-tipo="adicional" style="opacity:.65">' +
            '<span class="pt" style="background:' + U.color(c.f) + '"></span>' +
            '<div class="desc">' + U.esc(c.d) +
              '<div class="fam">' + U.esc(c.fn) + ' · ' + (p[2] === 'soldadura' ? 'solo para soldadura' : 'lo usan unos pocos') +
              ' · ' + p[1] + '%</div></div>' +
            '<div class="precio">' + U.soles(c.p) + '</div></div>';
        }).join('');
      }

      // --- BOTÓN PARA AGREGAR NUEVO EPP ---
      html += '<div style="margin-top:16px; text-align:center;">' +
              '<button id="btn-add-epp" class="btn-exportar" style="width:100%">+ Agregar EPP al kit</button>' +
              '<div id="buscador-epp" class="oculto" style="margin-top:10px; position:relative;">' +
              '<input type="text" id="input-buscar-epp" placeholder="Escribe el nombre del EPP..." style="width:100%; box-sizing:border-box; padding:8px;">' +
              '<div id="resultados-epp" class="resultados-busqueda"></div>' +
              '</div></div>';
      
      html += '<p style="font-size:11.5px;color:#94a3b8;margin-top:14px;line-height:1.4">' +
      'La matriz es el consumo base del puesto: un EPP por familia (el que usa más gente) ' +
      'y solo si lo usa la mayoría. Haz clic en un EPP para moverlo entre el Kit Base y el Consumo Adicional.</p>';
    }
    $('d-cuerpo').innerHTML = html;
    d.classList.add('abierto');

    configurarEventosDrawer();
  }

  /* ---------------- Eventos dentro del Drawer ---------------- */
  function configurarEventosDrawer() {
    const cont = $('d-cuerpo');

    // 1. Manejo de clics (Popover o Botón de Agregar)
    cont.onclick = function(e) {
      const item = e.target.closest('.kit-item');
      const btnAdd = e.target.closest('#btn-add-epp');
      
      // Si hace clic en "+ Agregar EPP"
      if (btnAdd) {
        $('buscador-epp').classList.toggle('oculto');
        if(!$('buscador-epp').classList.contains('oculto')) $('input-buscar-epp').focus();
        return;
      }

      // Si hace clic en un EPP de la lista
      if (item) {
        mostrarPopover(item, e);
      } else {
        document.querySelectorAll('.popover-epp').forEach(el => el.remove());
      }
    };

    // 2. Buscador predictivo de EPPs
    const input = $('input-buscar-epp');
    if (input) {
      input.oninput = function() {
        const q = this.value.toLowerCase().trim();
        const res = $('resultados-epp');
        if (q.length < 2) { res.innerHTML = ''; return; }
        
        // Filtra el catálogo completo de EPPs (COLS)
        const matches = COLS.filter(c => c.d.toLowerCase().includes(q)).slice(0, 5);
        
        if(matches.length === 0) {
          res.innerHTML = '<div class="res-item" style="color:#94a3b8; cursor:default;">No se encontraron coincidencias</div>';
          return;
        }

        res.innerHTML = matches.map(c => 
          `<div class="res-item" data-id="${c.m}" data-nombre="${U.esc(c.d)}">
            <span style="color:${U.color(c.f)}; margin-right:6px;">●</span> ${U.esc(c.d)}
           </div>`
        ).join('');
        
        // Evento clic para seleccionar del resultado
        res.querySelectorAll('.res-item').forEach(el => {
          el.onclick = () => window.agregarEppManual(el.dataset.id);
        });
      };
    }
  }

  // Muestra el menú flotante al hacer clic en un EPP
   function mostrarPopover(item, event) {
    document.querySelectorAll('.popover-epp').forEach(el => el.remove());
    
    const epp_id = item.dataset.epp;
    const tipo = item.dataset.tipo;
    const rect = item.getBoundingClientRect();
    
    const pop = document.createElement('div');
    pop.className = 'popover-epp';
    pop.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    pop.style.left = (rect.left + window.scrollX + 20) + 'px';
    
    let botones = '';
    if (tipo === 'base') {
      botones += `<button onclick="window.ejecutarMovimiento('${epp_id}', 'quitar_base')">Mover a consumo adicional</button>`;
    } else {
      botones += `<button onclick="window.ejecutarMovimiento('${epp_id}', 'hacer_base')">Mover a kit base</button>`;
    }
    
    // Agregamos el botón de eliminar
    botones += `<button class="btn-eliminar" onclick="window.ejecutarMovimiento('${epp_id}', 'eliminar')">Eliminar de la plaza</button>`;
    
    pop.innerHTML = botones;
    document.body.appendChild(pop);
    
    setTimeout(() => {
      document.addEventListener('click', function closePop(e) {
        if (!pop.contains(e.target) && !item.contains(e.target)) { 
          pop.remove(); 
          document.removeEventListener('click', closePop); 
        }
      });
    }, 10);
  }

    // --- Funciones Globales para Supabase ---
  
  window.ejecutarMovimiento = async function(epp_id, accion) {
    if (!FILA_ACTUAL) return;
    document.querySelectorAll('.popover-epp').forEach(el => el.remove());
    
    try {
      await Datos.actualizarMatriz(FILA_ACTUAL.id, epp_id, accion);
      await refrescarDatos();
    } catch (e) {
      alert('Error al guardar en Supabase: ' + e.message);
    }
  };

  window.agregarEppManual = async function(epp_id) {
    if (!FILA_ACTUAL) return;
    try {
      await Datos.actualizarMatriz(FILA_ACTUAL.id, epp_id, 'hacer_base');
      await refrescarDatos();
    } catch (e) {
      alert('Error al agregar: ' + e.message);
    }
  };

  window.agregarEppManual = async function(epp_id) {
    if (!FILA_ACTUAL) return;
    try {
      await Datos.actualizarMatriz(FILA_ACTUAL.id, epp_id, 'hacer_base', 1);
      await refrescarDatos();
    } catch (e) {
      alert('Error al agregar: ' + e.message);
    }
  };

  // Función auxiliar para recargar la tabla y el drawer sin refrescar la página web
  async function refrescarDatos() {
    const todasLasFilas = await Datos.matriz();
    // Buscamos la fila que teníamos abierta para actualizarla
    const filaActualizada = todasLasFilas.find(f => f.p === FILA_ACTUAL.p && f.l === FILA_ACTUAL.l);
    
    // Volvemos a crear el mapa de EPPs
    filaActualizada._m = new Map();
    filaActualizada.v.forEach(p => filaActualizada._m.set(p[0], p[1]));
    
    // Actualizamos el arreglo global FILAS
    const idx = FILAS.findIndex(f => f.p === FILA_ACTUAL.p && f.l === FILA_ACTUAL.l);
    if (idx !== -1) FILAS[idx] = filaActualizada;
    
    // Repintamos todo
    render(); 
    abrirDetalle(filaActualizada);
  }

  function cerrarDetalle() { $('drawer').classList.remove('abierto'); }

  /* ---------------- arranque ---------------- */
  document.addEventListener('DOMContentLoaded', function () {
    $('b-cerrar').addEventListener('click', cerrarDetalle);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') cerrarDetalle();
    });
    init();
  });
})();