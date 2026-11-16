/* ============================================================
   ETL INDEPENDIENTE: Excel de Uniformes -> payload para Supabase
   ============================================================ */

window.ETL_Uniformes = (function () {

  function norm(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function texto(v) {
    if (v == null) return '';
    return String(v).replace(/\s+/g, ' ').trim();
  }

  function numero(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return v;
    const s = String(v).replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  // Función para convertir la fecha de Excel (número de serie o texto) a formato YYYY-MM-DD
  function fechaISO(v) {
    if (!v) return null;
    if (v instanceof Date && !isNaN(v)) {
      const d = new Date(v.getTime() - v.getTimezoneOffset() * 60000);
      return d.toISOString().slice(0, 10);
    }
    if (typeof v === 'number') {
      const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
      return isNaN(d) ? null : d.toISOString().slice(0, 10);
    }
    const s = texto(v);
    // Intenta buscar formato YYYY-MM-DD
    const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[0];
    // Intenta buscar formato DD/MM/YYYY
    const m2 = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m2) return `${m2[3]}-${m2[2].padStart(2, '0')}-${m2[1].padStart(2, '0')}`;
    return null;
  }

  async function leer(file) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    if (!aoa.length) return { headers: [], rows: [] };
    return {
      headers: aoa[0].map(norm),
      rows: aoa.slice(1).filter(r => r && r.some(c => c !== null && c !== ''))
    };
  }

  function col(headers, pruebas, posicion) {
    for (const p of pruebas) {
      for (let i = 0; i < headers.length; i++) if (p(headers[i])) return i;
    }
    return posicion != null ? posicion : -1;
  }

  function requerida(nombre, idx, errores) {
    if (idx < 0) errores.push('Falta la columna "' + nombre + '"');
    return idx;
  }

  async function construir(archivo_uniformes) {
    const errores = [];
    const out = { catalogo: [], cargos: [], matriz: [], asignaciones: [] };

    if (!archivo_uniformes) {
      errores.push('Debes subir el archivo de Uniformes.');
      return { errores };
    }

    const uf = await leer(archivo_uniformes);

    // Buscar las columnas
    const iMatnr = requerida('Código de prenda (matnr)', col(uf.headers, [h => h === 'MATNR', h => h.includes('MATNR')], -1), errores);
    const iDescArt = requerida('Nombre de prenda (desc_art)', col(uf.headers, [h => h === 'DESC_ART', h => h.includes('DESC ART')], -1), errores);
    const iPrecio = col(uf.headers, [h => h === 'PRECIO', h => h.includes('PRECIO')], -1);
    const iCargo = requerida('Cargo (desc_cargo)', col(uf.headers, [h => h === 'DESC_CARGO', h => h.includes('DESC CARGO')], -1), errores);
    
    // Columnas para el consumo por persona
    // Nota: Hay dos columnas "nombres", buscamos la primera que aparezca (suele ser la del trabajador)
    const iNombreTrabajador = requerida('Nombre del trabajador (nombres)', col(uf.headers, [h => h === 'NOMBRES'], -1), errores);
        const iFecha = requerida('Fecha de registro (fecha_registro)', col(uf.headers, [h => h.includes('FECHA REGISTRO'), h => h.includes('FECHA')], -1), errores);
    const iCantidad = col(uf.headers, [h => h === 'CANTIDAD'], -1);

    if (errores.length) return { errores };

    const prendasSet = new Map(); 
    const cargosSet = new Set();  
    const matrizSet = new Set();  
    const asignacionesSet = new Set(); 

    uf.rows.forEach(r => {
      const material = texto(r[iMatnr]);
      const prenda = texto(r[iDescArt]).toUpperCase();
      const cargo = texto(r[iCargo]).toUpperCase();
      const nombreTrabajador = texto(r[iNombreTrabajador]).toUpperCase();
      const fechaRegistro = fechaISO(r[iFecha]);
      const cantidad = iCantidad >= 0 ? numero(r[iCantidad]) : 1;
      const precio = iPrecio >= 0 ? numero(r[iPrecio]) : 0;
      
      if (!material || !prenda || !cargo || !nombreTrabajador || !fechaRegistro) return; 

      // 1. Catálogo
      if (!prendasSet.has(material)) {
        prendasSet.set(material, {
          material: material,
          descripcion: prenda,
          precio: precio
        });
      }

      // 2. Cargos
      cargosSet.add(cargo);

      // 3. Matriz (Cargo + Prenda)
      const llaveMatriz = cargo + '||' + material;
      if (!matrizSet.has(llaveMatriz)) {
        matrizSet.add(llaveMatriz);
        out.matriz.push({
          cargo: cargo,
          material: material
        });
      }

      // 4. Asignaciones (Persona + Prenda + Fecha)
      const llaveAsignacion = nombreTrabajador + '||' + material + '||' + fechaRegistro;
      if (!asignacionesSet.has(llaveAsignacion)) {
        asignacionesSet.add(llaveAsignacion);
        out.asignaciones.push({
          nombre: nombreTrabajador,
          cargo: cargo,
          fecha_registro: fechaRegistro,
          material: material,
          cantidad: cantidad,
          precio: precio
        });
      }
    });

    // Convertir Sets/Mapas a arreglos
    prendasSet.forEach(p => out.catalogo.push(p));
    cargosSet.forEach(c => out.cargos.push({ nombre: c }));

    return {
      errores: [],
      payload: out,
      resumen: {
        prendas: out.catalogo.length,
        cargos: out.cargos.length,
        asignaciones: out.matriz.length,
        personas: out.asignaciones.length
      }
    };
  }

  return { construir: construir };
})();