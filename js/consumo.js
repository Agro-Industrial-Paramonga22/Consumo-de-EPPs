/* ============================================================
   Pantalla 2 — CONSUMO POR PUESTO
   Filtro por puesto / lugar / mes -> personas de ese puesto,
   con el consumo mes a mes y el detalle de EPPs al desplegar.
   ============================================================ */

(function () {
  const U = Util;
  let META = null, COLS = [], PERSONAS = [];
  const porMaterial = new Map();

  const st = { puesto: '', lugar: '', mes: '' };

  const $ = function (id) { return document.getElementById(id); };

  async function init() {
    try {
      const r = await Promise.all([Datos.meta(), Datos.columnas(), Datos.consumo()]);
      META = r[0]; COLS = r[1]; PERSONAS = r[2];
    } catch (e) {
      $('app').innerHTML =
        '<div class="card vacio">No se pudieron cargar los datos.<br><small>' +
        U.esc(e.message) + '</small></div>';
      return;
    }

    COLS.forEach(function (c) { porMaterial.set(c.m, c); });

    document.querySelector('.brand p').textContent =
      U.mesCorto(META.meses[0]) + ' – ' + U.mesCorto(META.meses[META.meses.length - 1]) +
      ' · ' + META.personas_con_consumo + ' personas con consumo';

    pintarFiltros();
    render();
    $('app').classList.remove('oculto');
    $('cargando').classList.add('oculto');
  }

  function pintarFiltros() {
    const puestos = Array.from(new Set(PERSONAS.map(function (p) { return p.puesto; }))).sort();
    $('f-puesto').innerHTML = '<option value="">Todos los puestos</option>' +
      puestos.map(function (p) {
        return '<option value="' + U.esc(p) + '">' + U.esc(p) + '</option>';
      }).join('');

    const lugares = Array.from(new Set(PERSONAS.map(function (p) { return p.lugar; }))).sort();
    $('f-lugar').innerHTML = '<option value="">Todos los lugares</option>' +
      lugares.map(function (l) {
        return '<option value="' + U.esc(l) + '">' + U.esc(l) + '</option>';
      }).join('');

    $('f-mes').innerHTML = '<option value="">Todos los meses</option>' +
      META.meses.map(function (m) {
        return '<option value="' + m + '">' + U.mesCorto(m) + '</option>';
      }).join('');

    $('f-puesto').addEventListener('change', function () { st.puesto = this.value; render(); });
    $('f-lugar').addEventListener('change', function () { st.lugar = this.value; render(); });
    $('f-mes').addEventListener('change', function () { st.mes = this.value; render(); });
    $('b-limpiar').addEventListener('click', function () {
      st.puesto = st.lugar = st.mes = '';
      $('f-puesto').value = ''; $('f-lugar').value = ''; $('f-mes').value = '';
      render();
    });
  }

  function mesesVisibles() {
    return st.mes ? [st.mes] : META.meses.slice();
  }

  function render() {
    const meses = mesesVisibles();

    const lista = PERSONAS.filter(function (p) {
      if (st.puesto && p.puesto !== st.puesto) return false;
      if (st.lugar && p.lugar !== st.lugar) return false;
      if (st.mes) {
        const v = p.meses[st.mes] || 0;
        if (v === 0) return false;
      }
      return true;
    });

    lista.sort(function (a, b) { return b.total - a.total; });

    const suma = function (p) {
      if (!st.mes) return p.total;
      return p.meses[st.mes] || 0;
    };

    let granTotal = 0;
    lista.forEach(function (p) { granTotal += suma(p); });

    $('k-personas').textContent = lista.length;
    $('k-total').textContent = U.soles(granTotal);
    $('k-prom').textContent = lista.length ? U.soles(granTotal / lista.length) : U.soles(0);

    // ---------- cabecera
    $('th-row').innerHTML =
      '<th style="min-width:300px">Persona</th>' +
      meses.map(function (m) { return '<th>' + U.mesBreve(m) + '</th>'; }).join('') +
      '<th style="min-width:110px">Total</th>';

    // ---------- filas
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

    // ---------- fila de totales
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

    // ---------- detalle al hacer clic
    $('cuerpo').onclick = function (e) {
      const tr = e.target.closest('tr.fila');
      if (!tr) return;
      const i = +tr.dataset.i;
      const det = document.querySelector('tr[data-det="' + i + '"]');
      const abierto = det.classList.contains('oculto');
      if (abierto) {
        det.querySelector('td').innerHTML = detalleHTML(lista[i], meses);
        det.classList.remove('oculto');
        tr.classList.add('abierta');
      } else {
        det.classList.add('oculto');
        tr.classList.remove('abierta');
      }
    };
  }

  function detalleHTML(p, meses) {
    const items = p.items.slice().sort(function (a, b) {
      if (st.mes) return (b.meses[st.mes] || 0) - (a.meses[st.mes] || 0);
      return b.v - a.v;
    }).filter(function (it) {
      if (!st.mes) return true;
      return (it.meses[st.mes] || 0) > 0;
    });

    if (!items.length) return '<div class="detalle-in vacio">Sin detalle en ese mes.</div>';

    const filas = items.map(function (it) {
      const col = porMaterial.get(it.m) || { d: it.m, fn: '', f: 'OTROS', p: 0, u: '' };
      const celdas = meses.map(function (m) {
        const v = it.meses[m] || 0;
        return '<td class="' + (v ? '' : 'cero') + '">' + (v ? U.num(v) : '–') + '</td>';
      }).join('');
      const tot = st.mes ? (it.meses[st.mes] || 0) : it.v;
      return '<tr>' +
        '<td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;' +
          'background:' + U.color(col.f) + ';margin-right:7px"></span>' +
          U.esc(col.d) +
          '<span style="color:#94a3b8;font-size:11px"> · ' + U.esc(col.fn) + '</span></td>' +
        celdas +
        '<td style="font-weight:600">' + U.soles(tot) + '</td></tr>';
    }).join('');

    return '<div class="detalle-in"><table class="det"><thead><tr>' +
      '<th>EPP consumido</th>' +
      meses.map(function (m) { return '<th>' + U.mesBreve(m) + '</th>'; }).join('') +
      '<th>Total</th></tr></thead><tbody>' + filas + '</tbody></table></div>';
  }

  document.addEventListener('DOMContentLoaded', init);
})();
