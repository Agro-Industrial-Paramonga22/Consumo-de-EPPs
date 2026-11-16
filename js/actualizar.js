/* ============================================================
   Pantalla 3 — Actualizar datos
   ============================================================ */

(function () {
  const CFG = window.EPP_CONFIG;
  const $ = id => document.getElementById(id);

  const ARCHIVOS = {
    consumo: 'f-consumo',
    mae: 'f-mae',
    costos: 'f-costos',
    servicios: 'f-servicios',
    stock: 'f-stock'
  };

  function archivo(id) {
    const inp = $(id);
    return inp && inp.files && inp.files[0] ? inp.files[0] : null;
  }

  function marcarOk(id, okId) {
    const f = archivo(id);
    $(okId).textContent = f ? '✓ ' + f.name : '';
    $(okId).style.color = f ? '#059669' : '#94a3b8';
  }

  Object.keys(ARCHIVOS).forEach(k => {
    $(ARCHIVOS[k]).addEventListener('change', () => {
      marcarOk(ARCHIVOS[k], 'ok-' + k);
      $('estado').textContent = '';
      $('problemas').style.display = 'none';
    });
  });

  function errores(lista) {
    $('problemas').style.display = 'block';
    $('lista-errores').innerHTML = lista.map(e => '<li>' + e + '</li>').join('');
    $('resultado').style.display = 'none';
    $('estado').textContent = '';
    $('b-subir').disabled = false;
  }

  function fmt(n) { return new Intl.NumberFormat('es-PE').format(n); }
  function soles(n) { return 'S/ ' + new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2 }).format(n || 0); }

  async function subirEnLotes(payloadCompleto) {
    const TAMANO_LOTE = 2000; 
    
    const payloadEstructura = { ...payloadCompleto };
    delete payloadEstructura.consumo;
    
    const tieneEstructura = Object.keys(payloadEstructura).some(k => payloadEstructura[k] && payloadEstructura[k].length > 0);
    
    if (tieneEstructura) {
      $('estado').textContent = 'Subiendo datos maestros y catálogos...';
      const resp = await fetch(CFG.SUPABASE_URL + '/rest/v1/rpc/cargar_todo', {
        method: 'POST',
        headers: {
          apikey: CFG.SUPABASE_KEY,
          Authorization: 'Bearer ' + CFG.SUPABASE_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ p: payloadEstructura, p_clave: CFG.CLAVE_CARGA })
      });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error('Error en estructura base: ' + txt);
      }
    }

    if (payloadCompleto.consumo && payloadCompleto.consumo.length > 0) {
      const totalFilas = payloadCompleto.consumo.length;
      let subidas = 0;

      for (let i = 0; i < totalFilas; i += TAMANO_LOTE) {
        const lote = payloadCompleto.consumo.slice(i, i + TAMANO_LOTE);
        $('estado').textContent = `Subiendo consumo: ${fmt(subidas)} / ${fmt(totalFilas)} filas...`;
        
        const resp = await fetch(CFG.SUPABASE_URL + '/rest/v1/rpc/cargar_todo', {
          method: 'POST',
          headers: {
            apikey: CFG.SUPABASE_KEY,
            Authorization: 'Bearer ' + CFG.SUPABASE_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ p: { consumo: lote }, p_clave: CFG.CLAVE_CARGA })
        });

        if (!resp.ok) {
          const txt = await resp.text();
          throw new Error(`Error en el lote ${i / TAMANO_LOTE + 1}: ` + txt);
        }
        subidas += lote.length;
      }
    }
    
    return {
      personas: payloadCompleto.personas ? payloadCompleto.personas.length : 0,
      plazas: payloadCompleto.plazas ? payloadCompleto.plazas.length : 0,
      epps: payloadCompleto.epp ? payloadCompleto.epp.length : 0,
      consumo: payloadCompleto.consumo ? payloadCompleto.consumo.length : 0
    };
  }

  $('b-subir').addEventListener('click', async function () {
    const btn = this;
    $('problemas').style.display = 'none';
    $('resultado').style.display = 'none';
    btn.disabled = true;

    try {
      $('estado').textContent = 'Leyendo y procesando los Excel… (esto puede tardar un poco)';
      const r = await ETL.construir({
        consumo: archivo('f-consumo'),
        mae: archivo('f-mae'),
        costos: archivo('f-costos'),
        servicios: archivo('f-servicios'),
        stock: archivo('f-stock')
      });

      if (r.errores.length) { errores(r.errores); return; }

      const res = await subirEnLotes(r.payload);
      
      // --- RECONCILIACIÓN AUTOMÁTICA SILENCIOSA ---
      let mensajeReconciliacion = '';
      if (archivo('f-mae')) {
        $('estado').textContent = 'Actualizando y vinculando DNIs automáticamente...';
        try {
          await Datos.reconciliarDnis();
          mensajeReconciliacion = '<tr><td colspan="2" style="padding-top:10px; font-weight:bold; color:#059669;">✨ DNIs Huérfanos actualizados automáticamente al nuevo MAE.</td></tr>';
        } catch (e) {
          console.warn('No se pudo reconciliar automáticamente:', e);
          mensajeReconciliacion = '<tr><td colspan="2" style="color:#b91c1c;">No se pudo reconciliar DNIs automáticamente. Intenta de nuevo.</td></tr>';
        }
      }
      
      let htmlResumen = '<table class="resumen-tabla">';
      
      if (res.consumo > 0) {
        htmlResumen += fila('Personas', fmt(res.personas));
        htmlResumen += fila('Plazas', fmt(res.plazas));
        htmlResumen += fila('Consumo', fmt(res.consumo) + ' líneas');
      }
      if (res.epps > 0) {
        htmlResumen += fila('EPPs en Catálogo', fmt(res.epps));
      }

      if (mensajeReconciliacion) {
        htmlResumen += mensajeReconciliacion;
      }

      if (archivo('f-consumo')) {
        const okCount = r.resumen.ok || 0;
        const huerfanoCount = r.resumen.huerfano || 0;
        const sinDniCount = r.resumen.sin_dni || 0;
        
        htmlResumen += '<tr><td colspan="2" style="padding-top:10px; font-weight:bold; color:#1e293b;">Identificación de Consumos (del archivo actual)</td></tr>';
        htmlResumen += fila('✅ Con DNI válido', fmt(okCount));
        if (huerfanoCount > 0) {
          htmlResumen += fila('⚠️ DNI no encontrado en MAE', fmt(huerfanoCount));
        }
        if (sinDniCount > 0) {
          htmlResumen += fila('❓ Sin DNI / No legible', fmt(sinDniCount));
        }
      }

      if (archivo('f-consumo') && !archivo('f-costos')) {
         htmlResumen += '<tr><td colspan="2" style="padding-top:10px; font-weight:bold; color:#1e293b;">EPPs Pendientes de Precio</td></tr>';
         htmlResumen += '<tr><td colspan="2" style="font-size:12px; color:#b91c1c;">No se subieron costos. Los EPPs nuevos se crearon con precio 0. Ve al Catálogo para actualizarlos.</td></tr>';
      }
      
      htmlResumen += '</table><p style="margin:14px 0 0;font-size:13px"><a href="index.html">Ver la matriz →</a></p>';

      $('resumen').innerHTML = htmlResumen;
      $('resultado').style.display = 'block';
      $('estado').textContent = 'Listo. Proceso completado.';
      sessionStorage.removeItem('epp_cache_consumo');
    } catch (e) {
      errores([String(e.message || e)]);
    } finally {
      btn.disabled = false;
    }
  });

  function fila(k, v) {
    return '<tr><th>' + k + '</th><td>' + v + '</td></tr>';
  }
})();