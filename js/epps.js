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
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px; color:#94a3b8;">No hay EPPs</td></tr>';
      return;
    }

    tbody.innerHTML = epps.map(c => `
      <tr class="fila">
        <td style="text-align: left; font-size: 11px; color: #64748b;">${c.m}</td>
        <td style="text-align: left; font-weight: 600;">${c.d}</td>
        <td style="text-align: left;">
          <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${Util.color(c.f)}; margin-right:5px;"></span>
          ${c.fn}
        </td>
        <td style="text-align: center;">${c.u}</td>
        <td style="text-align: right;">
          <input type="number" step="0.01" class="input-precio" 
                 data-material="${c.m}" value="${c.p.toFixed(2)}" 
                 style="width: 90px; padding: 4px; text-align: right; border: 1px solid #cbd5e1; border-radius: 4px;">
        </td>
        <td style="text-align: center;">
          <button class="btn-eliminar-epp" data-id="${c.m}" data-nombre="${c.d.replace(/"/g, '&quot;')}">
            Eliminar
          </button>
        </td>
      </tr>
    `).join('');

    // Evento para GUARDAR EL PRECIO
    document.querySelectorAll('.input-precio').forEach(input => {
      input.addEventListener('change', async function() {
        const material = this.dataset.material;
        const nuevoPrecio = parseFloat(this.value);
        
        if (isNaN(nuevoPrecio) || nuevoPrecio < 0) {
          alert('Ingresa un número válido.');
          return;
        }

        this.style.backgroundColor = '#fef08a'; // Amarillo (cargando)
        this.disabled = true;

        try {
          await Datos.actualizarPrecio(material, nuevoPrecio);
          this.style.backgroundColor = '#dcfce7'; // Verde (éxito)
          setTimeout(() => this.style.backgroundColor = '', 1000);
          
          const epp = TODOS_LOS_EPPS.find(x => x.m === material);
          if (epp) epp.p = nuevoPrecio;
        } catch (error) {
          alert('Error al guardar precio: ' + error.message);
          this.style.backgroundColor = '#fee2e2'; // Rojo (error)
        } finally {
          this.disabled = false;
        }
      });
    });

    // Evento para ELIMINAR
    document.querySelectorAll('.btn-eliminar-epp').forEach(btn => {
      btn.addEventListener('click', async function() {
        const material = this.dataset.id;
        const nombre = this.dataset.nombre;
        
        if (!confirm(`¿Estás seguro de eliminar "${nombre}"?\n\nDejará de aparecer en la matriz.`)) return;

        const originalText = this.innerHTML;
        this.innerHTML = '...';
        this.disabled = true;

        try {
          await Datos.desactivarEPP(material);
          TODOS_LOS_EPPS = TODOS_LOS_EPPS.filter(x => x.m !== material);
          $('f-buscar').dispatchEvent(new Event('input')); 
        } catch (error) {
          alert('Error: ' + error.message);
          this.innerHTML = originalText;
          this.disabled = false;
        }
      });
    });
  }

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

  document.addEventListener('DOMContentLoaded', init);
})();