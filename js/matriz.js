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

  // --- NUEVAS VARIABLES PARA EL ZOOM ---
  let currentZoom = 1;
  const zoomStep = 0.1;
  const maxZoom = 2.0;  // Máximo 200%
  const minZoom = 0.5;  // Mínimo 50%

  const st = {
    area: '', 
    lugar: '',
    puesto: '',
    fams: new Set(),
    vacias: true,     // mostrar plazas sin ningún consumo
    orden: 'puesto'    // 'total' (mayor costo primero) | 'puesto' (alfabético)
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
    pintarFullscreen();
    pintarCabecera();
    render();
    $('app').classList.remove('oculto');
    $('cargando').classList.add('oculto');
  }

  /* ---------------- KPIs ---------------- */
  function pintarKpis() {
    document.querySelector('.brand p').textContent =
      U.mesCorto(META.meses[0]) + ' – ' + U.mesCorto(META.meses[META.meses.length - 1]) +
      ' · ' + U.soles(META.valor) + ' consumidos';
  }

  function actualizarKpis(filas) {
    const totalPlazas = filas.length;
    const plazasConConsumo = filas.filter(f => f.v.length > 0).length;
    const costoTotal = filas.reduce((sum, f) => sum + f.t, 0);
    
    const eppsUnicos = new Set();
    filas.forEach(f => f.v.forEach(p => eppsUnicos.add(p[0])));

    $('k-plazas').textContent = totalPlazas;
    $('k-plazas-sub').textContent = plazasConConsumo + ' con consumo registrado';
    $('k-epps').textContent = eppsUnicos.size;
    $('k-costo').textContent = U.soles(costoTotal);
    $('k-costo-sub').textContent = 'suma de las ' + totalPlazas + ' plazas';
  }

  /* ---------------- FUNCIONES DE PANTALLA COMPLETA ---------------- */
    /* ---------------- FUNCIONES DE PANTALLA COMPLETA ---------------- */
  function pintarFullscreen() {
    const btn = $('btn-fullscreen');
    const tablaWrap = document.querySelector('.tabla-wrap');

    // Solo activamos el botón para entrar a pantalla completa
    btn.addEventListener('click', () => {
      tablaWrap.classList.add('fullscreen');
    });
  }

  /* ---------------- Filtros ---------------- */
  function pintarFiltros() {
    $('f-area').addEventListener('change', function () { 
      st.area = this.value; 
      st.puesto = ''; $('f-puesto').value = ''; 
      actualizarSelectores(); 
      render(); 
    });
    
    $('f-lugar').addEventListener('change', function () { st.lugar = this.value; render(); });
    $('f-puesto').addEventListener('change', function () { st.puesto = this.value; render(); });
    $('t-vacias').addEventListener('change', function () { st.vacias = this.checked; render(); });
    $('b-limpiar').addEventListener('click', limpiar);
    
    actualizarSelectores();
  }

  function actualizarSelectores() {
    const selArea = $('f-area');
    if (selArea.options.length <= 1) {
      const areas = Array.from(new Set(FILAS.map(f => f.area))).sort();
      areas.forEach(a => {
        const o = document.createElement('option'); o.value = a; o.textContent = a; selArea.appendChild(o);
      });
    }

    const filasFiltradasPorArea = st.area ? FILAS.filter(f => f.area === st.area) : FILAS;

    const selPuesto = $('f-puesto');
    selPuesto.innerHTML = '<option value="">Todos</option>';
    const puestos = Array.from(new Set(filasFiltradasPorArea.map(f => f.p))).sort();
    puestos.forEach(p => {
      const o = document.createElement('option'); o.value = p; o.textContent = p; selPuesto.appendChild(o);
    });
    selPuesto.value = st.puesto;

    const selLugar = $('f-lugar');
    selLugar.innerHTML = '<option value="">Todos</option>';
    const lugares = Array.from(new Set(filasFiltradasPorArea.map(f => f.l))).sort();
    lugares.forEach(l => {
      const o = document.createElement('option'); o.value = l; o.textContent = l; selLugar.appendChild(o);
    });
    selLugar.value = st.lugar;
  }

  function limpiar() {
    st.area = ''; st.lugar = ''; st.puesto = '';
    st.vacias = true;
    $('f-area').value = ''; 
    $('f-lugar').value = ''; $('f-puesto').value = '';
    $('t-vacias').checked = true;
    actualizarSelectores();
    render();
  }

  /* ---------------- cabecera de la tabla ---------------- */
  function columnasVisibles() {
    return COLS.filter(function (c) {
      if (c.n === 0) return false;              
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
    return FILAS.filter(function (f) {
      if (st.area && f.area !== st.area) return false;
      if (st.lugar && f.l !== st.lugar) return false;
      if (st.puesto && f.p !== st.puesto) return false;
      if (!st.vacias && f.v.length === 0) return false;
      return true;
    });
  }

  function render() {
    const cols = columnasVisibles();
    const filas = filasVisibles();
    
    actualizarKpis(filas);
    pintarCabecera();          

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
            '<div class="puesto-nom">' + U.esc(f.p) + '</div>' +
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

    $('matriz-body').onclick = function (e) {
      const tr = e.target.closest('tr');
      if (!tr) return;
      abrirDetalle(filas[+tr.dataset.i]);
    };
  }

  /* ---------------- panel de detalle ---------------- */
  function abrirDetalle(f) {
    FILA_ACTUAL = f; 
    const d = $('drawer');
    $('d-titulo').textContent = f.p;
    $('d-sub').textContent = f.l + ' · ' + (f.n || 0) + ' persona(s) con consumo en esta plaza';

    let html = '';
    
    if (f.v.length === 0) {
      html += '<div class="vacio">Esta plaza no tiene ningún consumo registrado con DNI.' +
              '<br><br>El kit está <b>pendiente de definir</b>.</div>';
    } else {
      const items = f.v.map(function (p) {
        return { c: porMaterial.get(p[0]), cob: p[1] };
      }).sort(function (a, b) { return b.c.p - a.c.p; });

      html += items.map(function (it) {
        return '<div class="kit-item" data-epp="' + it.c.m + '" data-tipo="base">' +
          '<span class="pt" style="background:' + U.color(it.c.f) + '"></span>' +
          '<div class="desc">' + U.esc(it.c.d) +
            '<div class="fam">' + U.esc(it.c.fn) + ' · lo recibió el ' + it.cob + '%</div></div>' +
          '<div class="precio">' + U.soles(it.c.p) + '</div></div>';
      }).join('') +
      '<div class="kit-total"><span>Costo del kit base</span><span>' + U.soles(f.t) + '</span></div>';

      if (f.a && f.a.length) {
        html += '<div style="margin-top:14px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em">' +
                'Consumo adicional · fuera de la matriz</div>';
        html += f.a.map(function (p) {
          const c = porMaterial.get(p[0]);
          if(!c) return ''; 
          return '<div class="kit-item" data-epp="' + c.m + '" data-tipo="adicional" style="opacity:.65">' +
            '<span class="pt" style="background:' + U.color(c.f) + '"></span>' +
            '<div class="desc">' + U.esc(c.d) +
              '<div class="fam">' + U.esc(c.fn) + ' · ' + (p[2] === 'soldadura' ? 'solo para soldadura' : 'lo usan unos pocos') +
              ' · ' + p[1] + '%</div></div>' +
            '<div class="precio">' + U.soles(c.p) + '</div></div>';
        }).join('');
      }

      html += '<p style="font-size:11.5px;color:#94a3b8;margin-top:14px;line-height:1.4">' +
      'La matriz es el consumo base del puesto: un EPP por familia (el que usa más gente) ' +
      'y solo si lo usa la mayoría. Haz clic en un EPP para moverlo entre el Kit Base y el Consumo Adicional.</p>';
    }

    html += '<div style="margin-top:16px; text-align:center;">' +
            '<button id="btn-add-epp" class="btn-exportar" style="width:100%">+ Agregar EPP al kit</button>' +
            '<div id="buscador-epp" class="oculto" style="margin-top:10px; position:relative;">' +
            '<input type="text" id="input-buscar-epp" placeholder="Escribe el nombre del EPP..." style="width:100%; box-sizing:border-box; padding:8px;">' +
            '<div id="resultados-epp" class="resultados-busqueda"></div>' +
            '</div></div>';

    $('d-cuerpo').innerHTML = html;
    d.classList.add('abierto');

    configurarEventosDrawer();
  }

  /* ---------------- Eventos dentro del Drawer ---------------- */
  function configurarEventosDrawer() {
    const cont = $('d-cuerpo');

    cont.onclick = function(e) {
      const item = e.target.closest('.kit-item');
      const btnAdd = e.target.closest('#btn-add-epp');
      
      if (btnAdd) {
        $('buscador-epp').classList.toggle('oculto');
        if(!$('buscador-epp').classList.contains('oculto')) $('input-buscar-epp').focus();
        return;
      }

      if (item) {
        mostrarPopover(item, e);
      } else {
        document.querySelectorAll('.popover-epp').forEach(el => el.remove());
      }
    };

    const input = $('input-buscar-epp');
    if (input) {
      input.oninput = function() {
        const q = this.value.toLowerCase().trim();
        const res = $('resultados-epp');
        if (q.length < 2) { res.innerHTML = ''; return; }
        
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
        
        res.querySelectorAll('.res-item').forEach(el => {
          el.onclick = () => window.agregarEppManual(el.dataset.id);
        });
      };
    }
  }

  function mostrarPopover(item, event) {
    document.querySelectorAll('.popover-epp').forEach(el => el.remove());
    
    const epp_id = item.dataset.epp;
    const tipo = item.dataset.tipo;
    const rect = item.getBoundingClientRect(); // Obtenemos la posición exacta en pantalla
    
    const pop = document.createElement('div');
    pop.className = 'popover-epp';
    // Lo posicionamos justo debajo del EPP donde hiciste clic
    pop.style.top = (rect.bottom + 5) + 'px';
    pop.style.left = (rect.left + 20) + 'px';
    
    let botones = '';
    if (tipo === 'base') {
      botones += `<button onclick="window.ejecutarMovimiento('${epp_id}', 'quitar_base')">Mover a consumo adicional</button>`;
    } else {
      botones += `<button onclick="window.ejecutarMovimiento('${epp_id}', 'hacer_base')">Mover a kit base</button>`;
    }
    
    botones += `<button class="btn-eliminar" onclick="window.ejecutarMovimiento('${epp_id}', 'eliminar')">Eliminar de la plaza</button>`;
    
    pop.innerHTML = botones;
    document.body.appendChild(pop);
    
    // Evitar que el mismo clic que abrió el menú lo cierre inmediatamente
    event.stopPropagation(); 
    
    // Cerrar el menú al hacer clic en cualquier otra parte
    setTimeout(() => {
      document.addEventListener('click', function closePop(e) {
        if (!pop.contains(e.target)) { 
          pop.remove(); 
          document.removeEventListener('click', closePop); 
        }
      });
    }, 10);
  }

    window.ejecutarMovimiento = async function(epp_id, accion) {
    if (!FILA_ACTUAL) return;
    document.querySelectorAll('.popover-epp').forEach(el => el.remove());
    
    try {
      // 1. Guardamos en Supabase (en segundo plano)
      await Datos.actualizarMatriz(FILA_ACTUAL.id, epp_id, accion);
      
      // 2. ACTUALIZAMOS LA MEMORIA LOCAL SIN VOLVER A DESCARGAR TODO
      if (accion === 'quitar_base') {
          FILA_ACTUAL.v = FILA_ACTUAL.v.filter(p => p[0] !== epp_id);
      } else if (accion === 'hacer_base') {
          if (FILA_ACTUAL.a) FILA_ACTUAL.a = FILA_ACTUAL.a.filter(p => p[0] !== epp_id);
          if (!FILA_ACTUAL.v.some(p => p[0] === epp_id)) FILA_ACTUAL.v.push([epp_id, 100]);
      } else if (accion === 'eliminar') {
          FILA_ACTUAL.v = FILA_ACTUAL.v.filter(p => p[0] !== epp_id);
          if (FILA_ACTUAL.a) FILA_ACTUAL.a = FILA_ACTUAL.a.filter(p => p[0] !== epp_id);
      }
      
      // 3. Recalculamos el costo total del kit localmente
      let nuevoTotal = 0;
      FILA_ACTUAL.v.forEach(p => {
          const col = porMaterial.get(p[0]);
          if (col) nuevoTotal += col.p;
      });
      FILA_ACTUAL.t = nuevoTotal;
      
      // 4. Actualizamos la fila en la lista global y repintamos
      const idx = FILAS.findIndex(f => f.id === FILA_ACTUAL.id);
      if (idx !== -1) FILAS[idx] = FILA_ACTUAL;
      
      render(); 
      abrirDetalle(FILA_ACTUAL); 
      
    } catch (e) {
      alert('Error al guardar en Supabase: ' + e.message);
    }
  };

    window.agregarEppManual = async function(epp_id) {
    if (!FILA_ACTUAL) return;
    try {
      await Datos.actualizarMatriz(FILA_ACTUAL.id, epp_id, 'hacer_base', 1);
      
      // Actualización local instantánea
      if (!FILA_ACTUAL.v.some(p => p[0] === epp_id)) {
          FILA_ACTUAL.v.push([epp_id, 100]);
          const col = porMaterial.get(epp_id);
          if (col) FILA_ACTUAL.t += col.p;
      }
      
      const idx = FILAS.findIndex(f => f.id === FILA_ACTUAL.id);
      if (idx !== -1) FILAS[idx] = FILA_ACTUAL;
      
      render(); 
      abrirDetalle(FILA_ACTUAL);
      
      // Cerrar el buscador si estaba abierto
      $('buscador-epp').classList.add('oculto');
      $('input-buscar-epp').value = '';
      
    } catch (e) {
      alert('Error al agregar: ' + e.message);
    }
  };

  async function refrescarDatos() {
    const todasLasFilas = await Datos.matriz();
    const filaActualizada = todasLasFilas.find(f => f.p === FILA_ACTUAL.p && f.l === FILA_ACTUAL.l);
    
    filaActualizada._m = new Map();
    filaActualizada.v.forEach(p => filaActualizada._m.set(p[0], p[1]));
    
    const idx = FILAS.findIndex(f => f.p === FILA_ACTUAL.p && f.l === FILA_ACTUAL.l);
    if (idx !== -1) FILAS[idx] = filaActualizada;
    
    render(); 
    abrirDetalle(filaActualizada);
  }

    function cerrarDetalle() { 
    $('drawer').classList.remove('abierto'); 
    // Limpiamos cualquier menú flotante que haya quedado huérfano
    document.querySelectorAll('.popover-epp').forEach(el => el.remove());
  }

   document.addEventListener('DOMContentLoaded', function () {
    $('b-cerrar').addEventListener('click', cerrarDetalle);
    
    // --- NUEVA LÓGICA DE ESCAPE (CAPA POR CAPA) ---
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        
        // Capa 1: Si hay un menú flotante (Mover/Eliminar) abierto, lo cierra primero
        const popoverAbierto = document.querySelector('.popover-epp');
        if (popoverAbierto) {
          popoverAbierto.remove();
          return; // Se detiene aquí y no cierra el panel
        }

        // Capa 2: Si el panel lateral está abierto, lo cierra
        const drawer = $('drawer');
        if (drawer.classList.contains('abierto')) {
          cerrarDetalle();
          return;
        }

        // Capa 3: Si está en pantalla completa, sale de ella
        const tablaWrap = document.querySelector('.tabla-wrap');
        if (tablaWrap.classList.contains('fullscreen')) {
          tablaWrap.classList.remove('fullscreen');
        }
      }
    });

    init();
  });
})();