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

      html = items.map(function (it) {
        return '<div class="kit-item">' +
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
          return '<div class="kit-item" style="opacity:.65">' +
            '<span class="pt" style="background:' + U.color(c.f) + '"></span>' +
            '<div class="desc">' + U.esc(c.d) +
              '<div class="fam">' + U.esc(c.fn) + ' · ' + (p[2] === 'soldadura' ? 'solo para soldadura' : 'lo usan unos pocos') +
              ' · ' + p[1] + '%</div></div>' +
            '<div class="precio">' + U.soles(c.p) + '</div></div>';
        }).join('');
      }

      html += '<p style="font-size:11.5px;color:#94a3b8;margin-top:10px;line-height:1.4">' +
      'La matriz es el consumo base del puesto: un EPP por familia (el que usa más gente) ' +
      'y solo si lo usa la mayoría. Lo que usan unos pocos sigue en la pantalla de consumo.</p>';
    }
    $('d-cuerpo').innerHTML = html;
    d.classList.add('abierto');
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
