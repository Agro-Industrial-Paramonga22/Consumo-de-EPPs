/* ============================================================
   combo.js — desplegable con búsqueda para los filtros
   ------------------------------------------------------------
   Reemplaza al <select> nativo: se puede escribir y la lista se
   achica a lo que más se parece. También trae la cascada, que va
   de arriba hacia abajo, uno por uno: cada filtro lista solo lo que
   dejan sus filtros superiores (gerencia -> sección -> CECO -> puesto),
   al cambiar uno se limpian los de abajo, y nunca se autocompleta
   nada: "Todas / Todos" o la ✕ dejan el filtro vacío.

   Uso:
     var c = new Combo('c-gerencia', { vacio: 'Todas las gerencias', alCambiar: listo });
     c.setOptions([{ value: 'GERENCIA DE CAMPO', label: 'GERENCIA DE CAMPO' }, ...]);
     c.setValue('GERENCIA DE CAMPO');

     var cascada = new Cascada({
       registros: FILAS,                    // [{ gerencia, area, lugar, puesto, ... }]
       campos: [                            // en orden jerárquico
         { key: 'gerencia', vacio: 'Todas las gerencias' },
         { key: 'area',     vacio: 'Todas las secciones' },
         { key: 'lugar',    vacio: 'Todos los lugares' },
         { key: 'puesto',   vacio: 'Todos los puestos' }
       ],
       combos: { gerencia: c, area: s, lugar: l, puesto: p },
       alCambiar: render
     });
     cascada.recalcular();
   ============================================================ */

(function () {
  'use strict';

  function normalizar(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function comparar(a, b) {
    return String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' });
  }

  /* ---------------- Combo ---------------- */
  function Combo(idCaja, opciones) {
    opciones = opciones || {};
    var caja = typeof idCaja === 'string' ? document.getElementById(idCaja) : idCaja;
    if (!caja) throw new Error('Combo: no existe ' + idCaja);

    this.caja = caja;
    this.input = caja.querySelector('input');
    this.lista = caja.querySelector('.combo-list');
    this.btn = caja.querySelector('.combo-btn');
    this.textoVacio = opciones.vacio || 'Todos';
    this.alCambiar = opciones.alCambiar || function () {};
    this.items = [];
    this.value = '';
    this.filtro = '';
    this.visibles = [];
    this.filas = [];
    this.res = -1;
    this.abierto = false;

    var self = this;
    this.input.placeholder = this.textoVacio;
    this.input.setAttribute('autocomplete', 'off');

    // botón ✕ para quitar el filtro sin tener que abrir la lista
    this.x = document.createElement('button');
    this.x.type = 'button';
    this.x.className = 'combo-x oculto';
    this.x.tabIndex = -1;
    this.x.title = 'Quitar este filtro';
    this.x.setAttribute('aria-label', 'Quitar este filtro');
    this.x.innerHTML = '&times;';
    this.caja.appendChild(this.x);

    this.x.addEventListener('mousedown', function (e) { e.preventDefault(); });
    this.x.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      self.value = '';
      self.filtro = '';
      self.input.value = '';
      self.cerrar();
      self.mostrarX();
      self.alCambiar('');
    });

    this.input.addEventListener('focus', function () { self.abrir(); });
    this.input.addEventListener('click', function () { if (!self.abierto) self.abrir(); });
    this.input.addEventListener('input', function () {
      self.filtro = self.input.value;
      self.res = -1;
      self.pintar();
    });
    this.input.addEventListener('keydown', function (e) { self.tecla(e); });
    this.input.addEventListener('blur', function () { self.cerrar(); });

    this.btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    this.btn.addEventListener('click', function () {
      if (self.abierto) self.cerrar();
      else { self.input.focus(); self.abrir(); }
    });

    this.lista.addEventListener('mousedown', function (e) {
      var it = e.target.closest('.combo-item');
      if (!it) return;
      e.preventDefault();               // que el input no pierda el foco
      self.elegir(it.getAttribute('data-v'));
      self.input.blur();
    });

    document.addEventListener('mousedown', function (e) {
      if (self.abierto && !self.caja.contains(e.target)) self.cerrar();
    });
  }

  Combo.prototype.etiqueta = function (v) {
    for (var i = 0; i < this.items.length; i++) {
      if (this.items[i].value === v) return this.items[i].label;
    }
    return v || '';
  };

  Combo.prototype.mostrarX = function () {
    if (!this.x) return;
    if (this.value) this.x.classList.remove('oculto');
    else this.x.classList.add('oculto');
  };

  Combo.prototype.setOptions = function (items) {
    this.items = (items || []).map(function (o) {
      var value = (o && typeof o === 'object') ? o.value : o;
      var label = (o && typeof o === 'object' && o.label != null) ? o.label : value;
      return { value: value, label: label, norm: normalizar(label) };
    });
    if (this.abierto) this.pintar();
    else this.input.value = this.value ? this.etiqueta(this.value) : '';
    this.mostrarX();
  };

  Combo.prototype.setValue = function (v) {
    this.value = v || '';
    if (!this.abierto) this.input.value = this.value ? this.etiqueta(this.value) : '';
    else this.pintar();
    this.mostrarX();
  };

  Combo.prototype.abrir = function () {
    if (!this.items.length) return;
    this.abierto = true;
    this.filtro = '';
    this.res = -1;
    if (this.value) {
      this.input.value = this.etiqueta(this.value);
      this.input.select();
    } else {
      this.input.value = '';
    }
    this.lista.classList.remove('oculto');
    this.pintar();
  };

  Combo.prototype.cerrar = function () {
    if (!this.abierto) return;
    this.abierto = false;
    this.lista.classList.add('oculto');
    this.input.value = this.value ? this.etiqueta(this.value) : '';
    this.input.placeholder = this.textoVacio;
    this.mostrarX();
  };

  Combo.prototype.puntaje = function (item) {
    var q = normalizar(this.filtro);
    if (!q) return 0;
    var s = item.norm;
    var tokens = q.split(' ');
    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i] && s.indexOf(tokens[i]) === -1) return -1;
    }
    if (s === q) return 0;
    if (s.indexOf(q) === 0) return 1;
    var palabras = s.split(' ');
    for (var j = 0; j < palabras.length; j++) {
      if (palabras[j].indexOf(tokens[0]) === 0) return 2;
    }
    return 3;
  };

  Combo.prototype.pintar = function () {
    var self = this;
    var q = normalizar(this.filtro);
    var encontrados = [];

    if (q) {
      this.items.forEach(function (it) {
        var p = self.puntaje(it);
        if (p >= 0) encontrados.push({ it: it, p: p });
      });
      encontrados.sort(function (a, b) { return a.p - b.p || comparar(a.it.label, b.it.label); });
      this.visibles = encontrados.map(function (x) { return x.it; });
      this.filas = this.visibles.slice();          // lo que se dibuja, en orden
    } else {
      this.visibles = this.items.slice().sort(function (a, b) { return comparar(a.label, b.label); });
      this.filas = [{ value: '', label: this.textoVacio }].concat(this.visibles);
    }

    var html = this.filas.map(function (it, i) {
      return '<div class="combo-item' + (it.value === '' ? ' todas' : '') +
             (it.value === self.value ? ' sel' : '') +
             (i === self.res ? ' res' : '') +
             '" data-v="' + escapeAttr(it.value) + '" title="' + escapeAttr(it.label) + '">' +
             escapeHtml(it.label) + '</div>';
    });
    if (!this.filas.length) {
      html.push('<div class="combo-vacio">Sin coincidencias</div>');
    }
    this.lista.innerHTML = html.join('');
    if (this.res >= 0) {
      var el = this.lista.querySelector('.combo-item.res');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }
  };

  Combo.prototype.tecla = function (e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!this.abierto) { this.abrir(); return; }
      var n = this.filas.length;
      if (!n) return;
      var paso = e.key === 'ArrowDown' ? 1 : -1;
      this.res = this.res + paso;
      if (this.res >= n) this.res = 0;
      if (this.res < 0) this.res = n - 1;
      this.pintar();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!this.abierto) { this.abrir(); return; }
      if (!this.filas.length) { this.cerrar(); this.input.blur(); return; }
      var elegido = this.filas[this.res >= 0 ? this.res : 0];
      this.elegir(elegido.value);
      this.input.blur();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      this.filtro = '';
      this.cerrar();
      this.input.blur();
    }
  };

  Combo.prototype.elegir = function (v) {
    this.value = v || '';
    this.filtro = '';
    this.input.value = this.value ? this.etiqueta(this.value) : '';
    this.cerrar();
    this.mostrarX();
    this.alCambiar(this.value);
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }

  /* ---------------- Cascada ----------------
     Sola va hacia abajo, uno por uno:
       gerencia -> lista todas las gerencias
       sección  -> solo las secciones de esa gerencia
       CECO     -> solo los CECO de esa gerencia + sección
       puesto   -> solo los puestos de esa gerencia + sección + CECO
     Al cambiar un filtro se limpian los de abajo; nunca se autocompleta
     nada y elegir "Todas / Todos" (o la ✕) deja el filtro vacío. */
  function Cascada(opciones) {
    this.registros = opciones.registros || [];
    this.campos = opciones.campos || [];
    this.combos = opciones.combos || {};
    this.alCambiar = opciones.alCambiar || function () {};
    this.activo = false;
    this.previo = {};

    var self = this;
    this.campos.forEach(function (c, i) {
      var cb = self.combos[c.key];
      if (!cb) return;
      cb.alCambiar = function () { self.alElegir(i); };
    });
  }

  Cascada.prototype.valores = function () {
    var self = this, o = {};
    this.campos.forEach(function (c) {
      var cb = self.combos[c.key];
      o[c.key] = cb ? (cb.value || '') : '';
    });
    return o;
  };

  /* El usuario eligió algo en el filtro de posición i */
  Cascada.prototype.alElegir = function (i) {
    if (this.activo) return;
    var self = this;
    var campo = this.campos[i];
    var cb = this.combos[campo.key];
    var nuevo = cb ? (cb.value || '') : '';
    var antes = this.previo[campo.key] || '';

    this.activo = true;
    try {
      if (nuevo !== antes) {
        // cambiar un filtro resetea los de abajo
        for (var j = i + 1; j < this.campos.length; j++) {
          var hijo = this.combos[this.campos[j].key];
          if (hijo && hijo.value) hijo.setValue('');
        }
      }
      this.refrescar();
    } finally {
      this.activo = false;
    }
    this.alCambiar();
  };

  /* Se vuelven a leer los datos (al terminar la descarga, por ejemplo) */
  Cascada.prototype.recalcular = function () {
    if (this.activo) return;
    this.activo = true;
    try {
      this.refrescar();
    } finally {
      this.activo = false;
    }
    this.alCambiar();
  };

  Cascada.prototype.refrescar = function () {
    var self = this;
    var st = this.valores();

    this.campos.forEach(function (c, i) {
      var cb = self.combos[c.key];
      if (!cb) return;

      // solo los filtros de ARRIBA recortan esta lista
      var base = self.registros.filter(function (r) {
        for (var j = 0; j < i; j++) {
          var o = self.campos[j];
          if (st[o.key] && String(r[o.key]) !== st[o.key]) return false;
        }
        return true;
      });

      var vistos = {};
      var valores = [];
      base.forEach(function (r) {
        var v = r[c.key];
        if (v === undefined || v === null || v === '') return;
        v = String(v);
        if (vistos[v]) return;
        vistos[v] = 1;
        valores.push(v);
      });
      valores.sort(comparar);

      cb.setOptions(valores.map(function (v) { return { value: v, label: v }; }));

      // la selección ya no existe entre las opciones -> se limpia
      // (pasa solo si cambiaron los datos, no al elegir)
      if (st[c.key] && !vistos[st[c.key]]) {
        st[c.key] = '';
        cb.setValue('');
        for (var k = i + 1; k < self.campos.length; k++) {
          var hijo = self.combos[self.campos[k].key];
          if (hijo && hijo.value) hijo.setValue('');
        }
      }
      // si hay una sola opción posible se deja en "Todas": no se autocompleta
    });

    this.previo = this.valores();
  };

  Cascada.prototype.limpiar = function () {
    var self = this;
    this.campos.forEach(function (c) {
      if (self.combos[c.key]) self.combos[c.key].setValue('');
    });
    this.recalcular();
  };

  window.Combo = Combo;
  window.Cascada = Cascada;
})();
