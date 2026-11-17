/* ============================================================
   Pantalla 2 — CONSUMO POR PUESTO
   ============================================================ */

(function () {
  const U = Util;
  let META = null, COLS = [], PERSONAS = [];
  const porMaterial = new Map();

  const st = { gerencia: '', seccion: '', ceco: '', puesto: '', anio: '', meses: [], buscarPersona: '' };

  let CASCADA = null, COMBOS = null, FILTROS_LISTOS = false;

  const $ = function (id) { return document.getElementById(id); };

    async function init() {
    $('app').classList.remove('oculto');
    $('cargando').classList.add('oculto');

    $('cuerpo').innerHTML = '<tr><td colspan="15" style="text-align:center; padding:40px; color:#94a3b8;">⏳ Cargando consumo…</td></tr>';

    try {
      const r = await Promise.all([Datos.meta(), Datos.columnas()]);
      META = r[0]; COLS = r[1];
      COLS.forEach(function (c) { porMaterial.set(c.m, c); });
      
      pintarFiltros();
      
      // Al leer de la nueva vista, ya vienen limpios (solo con DNI)
      PERSONAS = await Datos.consumo();

      const mesesSet = new Set();
      PERSONAS.forEach(function (p) {
        Object.keys(p.meses).forEach(function (m) { 
          if (p.meses[m] > 0) mesesSet.add(m); 
        });
      });
      META.meses = Array.from(mesesSet).sort();

      if (META.meses.length > 0) {
        document.querySelector('.brand p').textContent =
          U.mesCorto(META.meses[0]) + ' – ' + U.mesCorto(META.meses[META.meses.length - 1]) +
          ' · ' + PERSONAS.length + ' personas con consumo';
          
        const aniosDisponibles = Array.from(new Set(META.meses.map(m => m.split('-')[0]))).sort().reverse();
        if (aniosDisponibles.length > 0) {
          st.anio = aniosDisponibles[0]; 
          st.meses = []; 
        }
      } else {
        document.querySelector('.brand p').textContent = 'Sin datos de consumo';
      }

      pintarFiltros();
      render();

    } catch (e) {
      $('app').innerHTML =
        '<div class="card vacio">No se pudieron cargar los datos.<br><small>' +
        U.esc(e.message) + '</small></div>';
    }
  }

  function pintarFiltros() {
    // 1. Los cuatro filtros jerárquicos (gerencia -> sección -> CECO -> puesto)
    if (!COMBOS) {
      COMBOS = {
        gerencia: new Combo('c-gerencia', { vacio: 'Todas las gerencias' }),
        seccion:  new Combo('c-seccion',  { vacio: 'Todas las secciones' }),
        ceco:     new Combo('c-ceco',     { vacio: 'Todos los lugares' }),
        puesto:   new Combo('c-puesto',   { vacio: 'Todos los puestos' })
      };

      CASCADA = new Cascada({
        registros: PERSONAS,
        campos: [
          { key: 'gerencia', vacio: 'Todas las gerencias' },
          { key: 'seccion',  vacio: 'Todas las secciones' },
          { key: 'ceco',     vacio: 'Todos los lugares' },
          { key: 'puesto',   vacio: 'Todos los puestos' }
        ],
        combos: COMBOS,
        alCambiar: function () {
          st.gerencia = COMBOS.gerencia.value;
          st.seccion  = COMBOS.seccion.value;
          st.ceco     = COMBOS.ceco.value;
          st.puesto   = COMBOS.puesto.value;
          if (PERSONAS.length) render();   // todavía no llegaron los datos
        }
      });
    }

    const anios = Array.from(new Set(META.meses.map(m => m.split('-')[0]))).sort().reverse();
    $('f-anio').innerHTML = '<option value="">Todos los años</option>' +
      anios.map(a => `<option value="${a}">${a}</option>`).join('');
      
    // Asegurarnos de que el selector visualmente muestre el año que acabamos de seleccionar
    $('f-anio').value = st.anio;

    function llenarMeses() {
      const dropMeses = $('ms-dropdown-meses');
      let html = '';

      if (st.anio) {
        // Si hay año, mostrar meses con su año
        const mesesAnio = META.meses.filter(m => m.startsWith(st.anio));
        html = mesesAnio.map(m => {
          return `<label class="ms-item">
                    <input type="checkbox" value="${m}" ${st.meses.includes(m) ? 'checked' : ''}> ${U.mesCorto(m)}
                  </label>`;
        }).join('');
      } else {
        // Si NO hay año, mostrar solo los 12 meses del calendario (Enero a Diciembre)
        const NOMBRES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        html = NOMBRES.map((nombre, i) => {
          const val = String(i + 1).padStart(2, '0'); // '01', '02', etc.
          return `<label class="ms-item">
                    <input type="checkbox" value="${val}" ${st.meses.includes(val) ? 'checked' : ''}> ${nombre}
                  </label>`;
        }).join('');
      }

      dropMeses.innerHTML = html;
      
      // Actualizar texto del botón
      if (st.meses.length === 0) {
        $('ms-toggle-meses').textContent = st.anio ? 'Todos los meses del ' + st.anio : 'Todos los meses';
      } else if (st.meses.length === 1) {
        const txt = st.anio 
          ? U.mesCorto(st.meses[0]) 
          : ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][parseInt(st.meses[0], 10)-1];
        $('ms-toggle-meses').textContent = txt;
      } else {
        $('ms-toggle-meses').textContent = st.meses.length + ' meses seleccionados';
      }
    }

    $('ms-dropdown-meses').classList.add('oculto');
    llenarMeses();

    if (!FILTROS_LISTOS) {
      FILTROS_LISTOS = true;

      $('ms-toggle-meses').addEventListener('click', function(e) {
        e.stopPropagation();
        $('ms-dropdown-meses').classList.toggle('oculto');
      });

      document.addEventListener('click', function(e) {
        if (!$('ms-dropdown-meses').contains(e.target) && e.target !== $('ms-toggle-meses')) {
          $('ms-dropdown-meses').classList.add('oculto');
        }
      });

      $('ms-dropdown-meses').addEventListener('change', function(e) {
        if (e.target.type === 'checkbox') {
          st.meses = Array.from(this.querySelectorAll('input:checked')).map(cb => cb.value);
          llenarMeses(); 
          render();
        }
      });

      $('f-anio').addEventListener('change', function() {
        st.anio = this.value;
        st.meses = []; 
        llenarMeses(); 
        render();
      });

      $('f-buscar-persona').addEventListener('input', function () {
        st.buscarPersona = this.value.toLowerCase().trim();
        clearTimeout(window._tBuscar); 
        window._tBuscar = setTimeout(render, 160);
      });

      $('b-limpiar').addEventListener('click', function () {
        st.buscarPersona = st.anio = '';
        st.meses = [];
        $('f-anio').value = '';
        $('f-buscar-persona').value = ''; 
        llenarMeses();
        if (CASCADA) CASCADA.limpiar();
        else render();
      });
    }

    actualizarSelectoresDependientes();
  }

  function actualizarSelectoresDependientes() {
    if (!CASCADA) return;
    CASCADA.registros = PERSONAS;   // la referencia cambia cuando termina la descarga
    CASCADA.recalcular();
  }

  function mesesVisibles() {
    if (st.meses.length > 0) {
      return META.meses.filter(m => {
        if (st.anio) {
          return st.meses.includes(m);
        } else {
          const mesNum = m.split('-')[1];
          return st.meses.includes(mesNum);
        }
      });
    }
    if (st.anio) {
      return META.meses.filter(m => m.startsWith(st.anio));
    }
    return META.meses.slice();
  }

  function render() {
    const meses = mesesVisibles();

    const lista = PERSONAS.filter(function (p) {
      if (st.gerencia && p.gerencia !== st.gerencia) return false;
      if (st.seccion && p.seccion !== st.seccion) return false;
      if (st.ceco && p.ceco !== st.ceco) return false;
      if (st.puesto && p.puesto !== st.puesto) return false;
      if (st.buscarPersona && p.nombre.toLowerCase().indexOf(st.buscarPersona) === -1) return false;
      
      if (st.meses.length > 0 || st.anio) {
        const tieneConsumo = meses.some(m => (p.meses[m] || 0) > 0);
        if (!tieneConsumo) return false;
      }
      return true;
    });

    lista.sort(function (a, b) { return b.total - a.total; });

    const suma = function (p) {
      if (st.meses.length > 0 || st.anio) {
        return meses.reduce((acc, m) => acc + (p.meses[m] || 0), 0);
      }
      return p.total;
    };

    let granTotal = 0;
    lista.forEach(function (p) { granTotal += suma(p); });

    $('k-personas').textContent = lista.length;
    $('k-total').textContent = U.soles(granTotal);
    $('k-prom').textContent = lista.length ? U.soles(granTotal / lista.length) : U.soles(0);

    $('th-row').innerHTML =
      '<th style="min-width:300px">Persona</th>' +
      meses.map(function (m) { return '<th>' + U.mesBreve(m) + '</th>'; }).join('') +
      '<th style="min-width:110px">Total</th>';

    const html = [];
    lista.forEach(function (p, i) {
      const celdas = meses.map(function (m) {
        const v = p.meses[m] || 0;
        return '<td class="' + (v ? '' : 'cero') + '">' + (v ? U.num(v) : '–') + '</td>';
      }).join('');

      html.push(
        '<tr class="fila" data-i="' + i + '">' +
          '<td><div class="nombre">' + U.esc(p.nombre) + '</div>' +
              '<div class="lugar">' + U.esc(p.lugar) + '</div></td>' +
          celdas +
          '<td class="destacado-num">' + U.soles(suma(p)) + '</td>' +
        '</tr>' +
        '<tr class="detalle oculto" data-det="' + i + '"><td colspan="' + (meses.length + 2) + '"></td></tr>');
    });

    $('cuerpo').innerHTML = html.join('') ||
      '<tr><td colspan="' + (meses.length + 2) + '"><div class="vacio">' +
      'No hay consumo para ese filtro.</div></td></tr>';

    const totMes = meses.map(function (m) {
      let t = 0;
      lista.forEach(function (p) { t += p.meses[m] || 0; });
      return t;
    });
    $('pie-tabla').innerHTML =
      '<tr class="fila-total">' +
        '<td>Total ' + lista.length + ' persona(s)</td>' +
        meses.map(function (m, j) { return '<td>' + U.num(totMes[j]) + '</td>'; }).join('') +
        '<td>' + U.soles(granTotal) + '</td>' +
      '</tr>';

    $('cuerpo').onclick = async function (e) {
      const tr = e.target.closest('tr.fila');
      if (!tr) return;
      const i = +tr.dataset.i;
      const det = document.querySelector('tr[data-det="' + i + '"]');
      const persona = lista[i];
      if (!det || !persona) return;

      if (!det.classList.contains('oculto')) {
        det.classList.add('oculto');
        tr.classList.remove('abierta');
        return;
      }

      det.classList.remove('oculto');
      tr.classList.add('abierta');

      // El detalle (materiales por mes) se pide recién ahora, no en la carga inicial
      if (!persona.items.length) {
        det.querySelector('td').innerHTML = '<div class="detalle-in">Cargando detalle…</div>';
        try {
          persona.items = await Datos.consumoDetalle(persona.dni);
        } catch (err) {
          det.querySelector('td').innerHTML =
            '<div class="detalle-in vacio">No se pudo cargar el detalle. ' + U.esc(err.message) + '</div>';
          return;
        }
      }

      det.querySelector('td').innerHTML = detalleHTML(persona, meses);
    };
  }

  function detalleHTML(p, meses) {
    const items = p.items.slice().sort(function (a, b) {
      if (st.meses.length > 0 || st.anio) {
        const sumA = meses.reduce((acc, m) => acc + (a.meses[m] || 0), 0);
        const sumB = meses.reduce((acc, m) => acc + (b.meses[m] || 0), 0);
        return sumB - sumA;
      }
      return b.v - a.v;
    }).filter(function (it) {
      if (st.meses.length === 0 && !st.anio) return true;
      return meses.some(m => (it.meses[m] || 0) > 0);
    });

    if (!items.length) return '<div class="detalle-in vacio">Sin detalle en los meses seleccionados.</div>';

    const filas = items.map(function (it) {
      const col = porMaterial.get(it.m) || { d: it.m, fn: '', f: 'OTROS', p: 0, u: '' };
      const celdas = meses.map(function (m) {
        const v = it.meses[m] || 0;
        return '<td class="' + (v ? '' : 'cero') + '">' + (v ? U.num(v) : '–') + '</td>';
      }).join('');
      
      const tot = (st.meses.length > 0 || st.anio)
        ? meses.reduce((acc, m) => acc + (it.meses[m] || 0), 0)
        : it.v;

      return '<tr>' +
        '<td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;' +
          'background:' + U.color(col.f) + ';margin-right:7px"></span>' +
          U.esc(col.d) +
          '<span style="color:#94a3b8;font-size:11px"> · ' + U.esc(col.fn) + '</span></td>' +
        celdas +
        '<td style="font-weight:600">' + U.soles(tot) + '</td></tr>';
    }).join('');

    return '<div class="detalle-in"><table class="det"><tbody>' + filas + '</tbody></table></div>';
  }

  document.addEventListener('DOMContentLoaded', init);
})();