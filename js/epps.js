(function () {
  const $ = (id) => document.getElementById(id);
  let TODOS_LOS_EPPS = [];

  async function init() {
    try {
      TODOS_LOS_EPPS = await Datos.catalogoEPPs();
      renderTabla(TODOS_LOS_EPPS);
      $('app').classList.remove('oculto');
      $('cargando').classList.add('oculto');
    } catch (e) {
      $('cargando').innerHTML = '<div class="vacio">Error al cargar: ' + e.message + '</div>';
    }
  }

  function renderTabla(epps) {
    const tbody = $('cuerpo-epps');
    if (epps.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:30px; color:#94a3b8;">No hay EPPs</td></tr>';
      return;
    }

    tbody.innerHTML = epps.map(c => `
      <tr class="fila">
        <td style="text-align: left; font-size: 11px; color: #64748b;">${c.m}</td>
        <td class="epp-nombre" data-id="${c.m}" data-nombre="${c.d.replace(/"/g, '&quot;')}" style="text-align: left; font-weight: 600;">
          ${c.d}
        </td>
        <td style="text-align: center;">${c.u}</td>
        <td style="text-align: right;">
          <input type="number" step="0.01" class="input-precio" 
                 data-material="${c.m}" value="${c.p.toFixed(2)}" 
                 style="width: 90px; padding: 4px; text-align: right; border: 1px solid #cbd5e1; border-radius: 4px;">
        </td>
      </tr>
    `).join('');

    // Evento para editar el precio
    document.querySelectorAll('.input-precio').forEach(input => {
      input.addEventListener('change', async function() {
        const material = this.dataset.material;
        const nuevoPrecio = parseFloat(this.value);
        
        if (isNaN(nuevoPrecio) || nuevoPrecio < 0) {
          alert('Ingresa un número válido.');
          return;
        }

        this.style.backgroundColor = '#fef08a';
        this.disabled = true;

        try {
          await Datos.actualizarPrecio(material, nuevoPrecio);
          this.style.backgroundColor = '#dcfce7';
          setTimeout(() => this.style.backgroundColor = '', 1000);
          
          const epp = TODOS_LOS_EPPS.find(x => x.m === material);
          if (epp) epp.p = nuevoPrecio;
        } catch (error) {
          alert('Error al guardar precio: ' + error.message);
          this.style.backgroundColor = '#fee2e2';
        } finally {
          this.disabled = false;
        }
      });
    });

    // Evento para ELIMINAR al hacer clic en el nombre
    document.querySelectorAll('.epp-nombre').forEach(el => {
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        document.querySelectorAll('.popover-epp-catalogo').forEach(p => p.remove());

        const material = this.dataset.id;
        const nombre = this.dataset.nombre;
        const rect = this.getBoundingClientRect();

        const pop = document.createElement('div');
        pop.className = 'popover-epp-catalogo';
        pop.style.top = (rect.bottom + window.scrollY + 4) + 'px';
        pop.style.left = (rect.left + window.scrollX) + 'px';
        pop.innerHTML = `<button>Eliminar EPP</button>`;
        document.body.appendChild(pop);

        pop.querySelector('button').addEventListener('click', async function() {
          if (!confirm(`¿Estás seguro de eliminar "${nombre}"?\n\nDejará de aparecer en la matriz.`)) return;
          
          this.innerHTML = 'Eliminando...';
          this.disabled = true;

          try {
            await Datos.desactivarEPP(material);
            TODOS_LOS_EPPS = TODOS_LOS_EPPS.filter(x => x.m !== material);
            $('f-buscar').dispatchEvent(new Event('input')); 
          } catch (error) {
            alert('Error: ' + error.message);
            this.innerHTML = 'Eliminar EPP';
            this.disabled = false;
          }
          pop.remove();
        });

        setTimeout(() => {
          document.addEventListener('click', function closePop(ev) {
            if (!pop.contains(ev.target)) { 
              pop.remove(); 
              document.removeEventListener('click', closePop); 
            }
          });
        }, 10);
      });
    });
  }

  // Filtro de búsqueda
  $('f-buscar').addEventListener('input', function() {
    const q = this.value.toLowerCase().trim();
    if (!q) {
      renderTabla(TODOS_LOS_EPPS);
      return;
    }
    const filtrados = TODOS_LOS_EPPS.filter(c => 
      c.d.toLowerCase().includes(q) || c.m.toLowerCase().includes(q)
    );
    renderTabla(filtrados);
  });

  // --- LÓGICA PARA AGREGAR EPP ---
  $('btn-nuevo-epp').addEventListener('click', () => {
    $('modal-epp').classList.remove('oculto');
    $('add-material').value = '';
    $('add-descripcion').value = '';
    $('add-precio').value = '0.00';
    $('add-material').focus();
  });

  $('btn-cancelar-add').addEventListener('click', () => {
    $('modal-epp').classList.add('oculto');
  });

  $('btn-guardar-add').addEventListener('click', async function() {
    const material = $('add-material').value.trim();
    const descripcion = $('add-descripcion').value.trim().toUpperCase();
    const familia_id = $('add-familia').value;
    const unidad = $('add-unidad').value.trim().toUpperCase();
    const precio = parseFloat($('add-precio').value);

    if (!material || !descripcion || isNaN(precio)) {
      alert('Por favor, completa los campos obligatorios (Código, Descripción y Precio).');
      return;
    }

    const originalText = this.innerHTML;
    this.innerHTML = 'Guardando...';
    this.disabled = true;

    try {
      await Datos.agregarEPP({
        material, descripcion, familia_id, unidad, precio
      });
      
      $('modal-epp').classList.add('oculto');
      TODOS_LOS_EPPS = await Datos.catalogoEPPs();
      renderTabla(TODOS_LOS_EPPS);
      
    } catch (error) {
      alert('Error al guardar el EPP: ' + error.message);
    } finally {
      this.innerHTML = originalText;
      this.disabled = false;
    }
  });

  // --- LÓGICA: VER INACTIVOS ---
  $('btn-ver-inactivos').addEventListener('click', async () => {
    try {
      const inactivos = await Datos.eppsInactivos();
      if (inactivos.length === 0) {
        alert('No hay EPPs inactivos.');
        return;
      }
      
      const tbody = $('cuerpo-epps');
      tbody.innerHTML = inactivos.map(c => `
        <tr style="opacity: 0.6;">
          <td style="text-align: left; font-size: 11px; color: #64748b;">${c.m}</td>
          <td style="text-align: left; font-weight: 600;">${c.d}</td>
          <td style="text-align: center;">${c.u}</td>
          <td style="text-align: right;">
            <button class="btn-primario btn-reactivar" data-id="${c.m}" style="padding: 4px 8px; font-size: 12px;">Reactivar</button>
          </td>
        </tr>
      `).join('');

      document.querySelectorAll('.btn-reactivar').forEach(btn => {
        btn.addEventListener('click', async function() {
          const mat = this.dataset.id;
          this.disabled = true;
          this.textContent = '...';
          try {
            await Datos.reactivarEPP(mat);
            TODOS_LOS_EPPS = await Datos.catalogoEPPs();
            renderTabla(TODOS_LOS_EPPS);
            // Forzamos el filtro para que se vea el EPP reactivado
            $('f-buscar').value = '';
            $('f-buscar').dispatchEvent(new Event('input'));
          } catch (e) {
            alert('Error: ' + e.message);
          }
        });
      });
    } catch (e) {
      alert('Error al cargar inactivos: ' + e.message);
    }
  });

  // (ELIMINADO EL LISTENER DE RECONCILIAR)

  document.addEventListener('DOMContentLoaded', init);
})();