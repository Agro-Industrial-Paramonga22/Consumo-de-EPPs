# Consumo de EPPs — Matriz de costos por puesto

Aplicación web (HTML + CSS + JS, sin frameworks ni build) que responde dos preguntas:

1. **¿Qué EPPs usa cada puesto de trabajo y cuánto cuesta cubrirlo?**
2. **¿Cuánto consumió realmente cada puesto, cada persona y cada mes?**

Datos: **Supabase** (proyecto `yyzwlqtbhcbyftwwtexi`), cargados desde los Excel de
origen: `Consumo` (SAP), maestros de personal (`MAE ACT SEG IND` y
`MAESTRO SERVICIOS`), maestro de precios (`Costos actualizados 2026`) y `STOCK`.

---

## Cómo verlo

La página necesita un servidor local: abrir `index.html` con doble clic **no funciona**
(el navegador bloquea `fetch` desde `file://`).

**VS Code → extensión Live Server → clic derecho en `index.html` → Open with Live Server.**

O desde PowerShell:

```powershell
python -m http.server 8877
# luego abrir http://127.0.0.1:8877/index.html
```

## Estructura

```
├─ index.html              Pantalla 1 — Matriz EPP × puesto
├─ consumo.html            Pantalla 2 — Consumo real por puesto y mes
├─ css/estilos.css
├─ js/
│  ├─ config.js            URL + clave publishable de Supabase
│  ├─ data.js              consultas a las vistas (único punto de acceso a datos)
│  ├─ matriz.js
│  └─ consumo.js
├─ db/schema.sql           Tablas, vistas y RLS (idempotente)
└─ scripts/
   ├─ sb_cliente.py        cliente REST / SQL
   └─ importar_supabase.py ETL: Excel → Supabase (todo, incluido lo sin DNI)
```

---

## Pantalla 1 — Matriz

- **Horizontal:** puestos de trabajo, cada uno con su **lugar / centro de costo**.
- **Vertical:** los EPPs que son **consumo base** de al menos un puesto.
- **Cuadrado verde:** ese EPP es parte del kit base del puesto.
- **TOTAL kit:** suma de precios unitarios de los EPPs base del puesto.

**La matriz es solo el consumo base del puesto.** Un EPP que usan unos pocos
—el respirador de 2 analistas entre 10, el EPP de soldadura de un mecánico que
suelda de vez en cuando— **no entra**; se queda en la pantalla 2, porque el
consumo no se toca.

**Reglas del consumo base**

1. **Un EPP por familia.** Cada plaza marca como máximo un EPP por tipo
   (un guante, un respirador, un lente…) aunque haya consumido varias variantes.
   Se elige la que usa más personas de esa plaza; si empatan, la de mayor cantidad.
2. **Cobertura esperada según la vida útil.** El dato son 6 meses, así que no se
   puede exigir que "todos" aparezcan: el casco y el arnés duran 24 meses (se
   espera reponer 25 %), el lente, la orejera, la bota y la careta 12 meses
   (50 %), y el guante, el filtro, el tapón y el mameluco 1–3 meses (100 %).
   Se exige el **60 % de esa reposición esperada**.
3. **El lente siempre se queda** si hay evidencia: se entrega poco, pero se entrega.
4. **Soldadura solo en puestos de soldadura.** Capucha, casaca, mandil, manga,
   escarpín de solda, careta y anteojo de oxicorte no entran en un puesto que no
   sea SOLDADOR, CALDERERO, HERRERO o MANIOBRISTA.
5. **El DNI manda.** Si la columna DNI trae un nombre, se busca en el maestro y
   se le asigna el DNI cuando la coincidencia es única. Las líneas sin DNI no se
   consideran.

**Columnas y filas.** Las columnas son solo los EPPs que son base en algún puesto
(49 hoy). Se muestran las 389 plazas, incluidas las 186 sin consumo, marcadas en
gris con la etiqueta *sin consumo*. El detalle de cada fila lista el **consumo
adicional** (lo que usan unos pocos y queda fuera de la matriz).

### Sobre el precio

El precio de cada EPP se guarda **por unidad base**. Cuando el material se compra
por lote, el factor queda registrado y se divide. Ejemplo real:
`LUNA BLANCA PARA MASCARA DE SOLDAR` se compra por **lote de 100 a S/ 90**
→ precio unitario **S/ 0,90**. Sin esa conversión, ese solo ítem inflaba el gasto
del período en S/ 107.920.

---

## Pantalla 2 — Consumo real

Filtros por **puesto**, **lugar de trabajo** y **mes**. Muestra a las personas del
puesto con su consumo mes a mes y el total; al hacer clic en una persona se
despliega el detalle de EPPs consumidos en los meses visibles.

Solo entran las líneas con DNI de una persona que exista en el maestro.
Las líneas sin DNI y las de DNI desconocido **sí están guardadas en la base**
(`consumo.estado = 'sin_dni' | 'dni_huerfano'`, con `ref_texto` para "TALLER SOLDA",
"SOLDADORES", "TOPICO"…), solo que no se atribuyen a una persona.

---

## Base de datos

El proyecto Supabase tiene el esquema de `db/schema.sql` y **todo** el consumo.
La web lee con la clave publishable de `js/config.js` (RLS: lectura pública).

| Tabla | Qué guarda |
|---|---|
| `gerencias`, `secciones`, `centros_costo` | jerarquía organizacional |
| `puestos`, `plazas` | puesto y plaza (puesto + centro de costo) |
| `familias`, `epp`, `precios` | catálogo, precio por unidad base y precio con vigencia |
| `personas` | maestro de personal (DNI, nombre, puesto, ceco) |
| `consumo` | **todas** las líneas de SAP (estado ok / sin_dni / dni_huerfano) |
| `matriz_estandar` | el kit base editable: plaza × EPP, cobertura y origen (`auto`/`manual`) |

Vistas que consume la web: `vw_meta`, `vw_epp_base`, `vw_costo_plaza`,
`vw_matriz_detalle`, `vw_matriz_adicional` y `vw_consumo_persona`.
`vw_calidad_datos` resume cuánto del gasto está identificado y cuánto no.

## Cargar o recargar los datos

```powershell
$env:SUPABASE_PAT="sbp_..."        # solo para SQL/DDL
$env:SUPABASE_SECRET="sb_secret_..."   # datos (nunca va al repo)
python scripts/importar_supabase.py --origen "C:\Users\edins\Downloads"
```

Trunca y vuelve a cargar: estructura, catálogo, personas, las 3.229 líneas de
consumo y las 530 celdas de la matriz base. Si alguien editó la matriz a mano,
esas filas quedan con `origen = 'manual'` para distinguirlas.

## Privacidad

La base contiene **DNI y nombres de trabajadores**. La clave publishable solo
permite leer; la secreta y el token personal viven en variables de entorno y no
se suben al repositorio.
