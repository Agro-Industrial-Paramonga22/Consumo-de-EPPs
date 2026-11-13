-- =====================================================================
--  Actualización de datos desde la web
--  Ejecutar después de db/schema.sql (idempotente)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. STOCK (se guarda, aunque la matriz todavía no lo use)
-- ---------------------------------------------------------------------
create table if not exists stock (
    id            bigserial primary key,
    material      text not null,
    centro        text,
    almacen       text,
    lote          text,
    libre         numeric(14,2),
    valor         numeric(14,2),
    actualizado_en timestamptz not null default now()
);

alter table stock enable row level security;
drop policy if exists lectura_publica on stock;
create policy lectura_publica on stock for select to anon, authenticated using (true);
grant select on stock to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Clave de carga (barrera simple para la función de actualización)
-- ---------------------------------------------------------------------
create table if not exists config (
    clave text primary key,
    valor text not null
);
alter table config enable row level security;
grant select on config to anon, authenticated;

insert into config (clave, valor)
values ('clave_carga', 'epp-paramonga-2026')
on conflict (clave) do nothing;

-- ---------------------------------------------------------------------
-- 3. Vida útil -> fracción que se espera reponer en 6 meses
-- ---------------------------------------------------------------------
create or replace function tasa_reposicion(descripcion text) returns numeric
language sql immutable as $$
    select case
        when upper(descripcion) ~ '(CASCO|ARNES|BARBIQUEJO|SUSPENSION)' then 0.25
        when upper(descripcion) ~ 'RESPIR'
             and upper(descripcion) !~ '(FILTRO|CARTUCHO|MASCARILLA|PREFILTRO)' then 0.25
        when upper(descripcion) ~ '(LENTE|ANTEOJO|GAFAS|CARE|OREJERA|BOTA|ZAPATO|ESCARPIN|MANDIL|CAPUCHA|CASACA|MANGA|CHALECO)' then 0.50
        else 1.00
    end
$$;

-- ---------------------------------------------------------------------
-- 4. Recalcular la matriz base (respeta las celdas editadas a mano)
-- ---------------------------------------------------------------------
create or replace function recalcular_matriz() returns integer
language plpgsql security definer as $$
declare
    n integer;
begin
    delete from matriz_estandar where origen = 'auto';

    with tot as (
        select pl.id as plaza_id, count(distinct co.dni)::numeric as n
        from consumo co
        join personas pe on pe.dni = co.dni
        join plazas pl   on pl.puesto_id = pe.puesto_id
                        and pl.ceco = coalesce(pe.ceco, 'SIN-CECO')
        where co.estado = 'ok'
        group by 1
    ),
    uso as (
        select pl.id as plaza_id, co.material,
               count(distinct co.dni) as nc, sum(co.cantidad) as qty,
               min(co.id) as primero
        from consumo co
        join personas pe on pe.dni = co.dni
        join plazas pl   on pl.puesto_id = pe.puesto_id
                        and pl.ceco = coalesce(pe.ceco, 'SIN-CECO')
        where co.estado = 'ok'
        group by 1, 2
    ),
    rank as (
        select u.*, e.familia_id, e.descripcion, e.solo_soldadura,
               row_number() over (partition by u.plaza_id, e.familia_id
                                  order by u.nc desc, u.qty desc, u.primero) as rn
        from uso u
        join epp e on e.material = u.material
    ),
    base as (
        select r.*, t.n as total, f.codigo as familia, pu.nombre as puesto
        from rank r
        join tot t on t.plaza_id = r.plaza_id
        join plazas pl on pl.id = r.plaza_id
        join puestos pu on pu.id = pl.puesto_id
        join familias f on f.id = r.familia_id
        where r.rn = 1
    )
    insert into matriz_estandar (plaza_id, epp_id, familia_id, cantidad,
                                 reposiciones_anio, requerido, cobertura_pct, origen)
    select b.plaza_id, b.material, b.familia_id, 1,
           case tasa_reposicion(b.descripcion)
                when 0.25 then 0.5
                when 0.50 then 1.0
                else 12.0
           end,
           true,
           round(100.0 * b.nc / nullif(b.total, 0), 1),
           'auto'
    from base b
    where (b.solo_soldadura = false
           or b.puesto ilike any (array['%SOLDADOR%', '%CALDERERO%', '%HERRERO%', '%MANIOBRISTA%']))
      and (b.familia = 'LENTE'
           or b.solo_soldadura
           or b.nc >= greatest(1, round(0.6 * b.total * tasa_reposicion(b.descripcion))))
    on conflict (plaza_id, epp_id) do nothing;

    get diagnostics n = row_count;
    return n;
end $$;

-- ---------------------------------------------------------------------
-- 5. Carga completa: estructura, catálogo, personas, consumo y stock
-- ---------------------------------------------------------------------
create or replace function cargar_todo(p jsonb, p_clave text) returns jsonb
language plpgsql security definer as $$
declare
    ok boolean;
    manual_previas integer;
begin
    if p_clave is distinct from (select valor from config where clave = 'clave_carga') then
        raise exception 'Clave de carga incorrecta';
    end if;

    -- guardar lo editado a mano (se reengancha por puesto + ceco + material)
    create temp table _manual on commit drop as
    select pu.nombre as puesto, pl.ceco, m.epp_id, m.familia_id, m.cantidad,
           m.reposiciones_anio, m.cobertura_pct, m.nota
    from matriz_estandar m
    join plazas pl on pl.id = m.plaza_id
    join puestos pu on pu.id = pl.puesto_id
    where m.origen = 'manual';
    get diagnostics manual_previas = row_count;

    truncate table consumo, matriz_estandar, personas, stock, plazas, puestos,
                   precios, epp, centros_costo, secciones, gerencias
    restart identity cascade;

    insert into gerencias (nombre)
    select distinct x.nombre from jsonb_to_recordset(p->'gerencias') as x(nombre text);

    insert into secciones (nombre, gerencia_id)
    select distinct s.nombre, g.id
    from jsonb_to_recordset(p->'secciones') as s(nombre text, gerencia text)
    join gerencias g on g.nombre = s.gerencia;

    insert into centros_costo (codigo, descripcion, seccion_id)
    select c.codigo, c.descripcion, s.id
    from jsonb_to_recordset(p->'cecos') as c(codigo text, descripcion text, seccion text)
    left join secciones s on s.nombre = c.seccion;

    insert into puestos (nombre)
    select distinct x.nombre from jsonb_to_recordset(p->'puestos') as x(nombre text);

    insert into plazas (puesto_id, ceco)
    select pu.id, x.ceco
    from jsonb_to_recordset(p->'plazas') as x(puesto text, ceco text)
    join puestos pu on pu.nombre = x.puesto;

    insert into epp (material, descripcion, familia_id, unidad, factor, solo_soldadura)
    select x.material, x.descripcion, f.id, coalesce(x.unidad, 'UN'),
           coalesce(x.factor, 1), coalesce(x.solo_soldadura, false)
    from jsonb_to_recordset(p->'epp') as x(material text, descripcion text, familia text,
                                           unidad text, factor numeric, solo_soldadura boolean)
    join familias f on f.codigo = x.familia;

    insert into precios (material, precio, vigente_desde, fuente)
    select x.material, x.precio, coalesce(x.vigente_desde::date, '2026-01-01'), 'SAP'
    from jsonb_to_recordset(p->'precios') as x(material text, precio numeric, vigente_desde text);

    insert into personas (dni, nombre, puesto_id, ceco, fuente)
    select x.dni, x.nombre, pu.id, x.ceco, coalesce(x.fuente, 'MAE')
    from jsonb_to_recordset(p->'personas') as x(dni text, nombre text, puesto text, ceco text, fuente text)
    join puestos pu on pu.nombre = x.puesto;

    insert into consumo (fecha, material, cantidad, unidad, dni, ref_texto, estado)
    select x.fecha::date, x.material, x.cantidad, coalesce(x.unidad, 'UN'),
           x.dni, x.ref_texto, coalesce(x.estado, 'ok')
    from jsonb_to_recordset(p->'consumo') as x(fecha text, material text, cantidad numeric,
                                               unidad text, dni text, ref_texto text, estado text);

    insert into stock (material, centro, almacen, lote, libre, valor)
    select x.material, x.centro, x.almacen, x.lote, x.libre, x.valor
    from jsonb_to_recordset(coalesce(p->'stock', '[]'::jsonb)) as x(material text, centro text,
                                                                   almacen text, lote text,
                                                                   libre numeric, valor numeric);

    -- reinsertar lo manual
    insert into matriz_estandar (plaza_id, epp_id, familia_id, cantidad, reposiciones_anio,
                                 requerido, cobertura_pct, origen, nota)
    select pl.id, m.epp_id, m.familia_id, m.cantidad, m.reposiciones_anio,
           true, m.cobertura_pct, 'manual', m.nota
    from _manual m
    join puestos pu on pu.nombre = m.puesto
    join plazas pl on pl.puesto_id = pu.id and pl.ceco = m.ceco
    on conflict (plaza_id, epp_id) do nothing;

    perform recalcular_matriz();

    return jsonb_build_object(
        'personas', (select count(*) from personas),
        'plazas', (select count(*) from plazas),
        'consumo', (select count(*) from consumo),
        'consumo_ok', (select count(*) from consumo where estado = 'ok'),
        'consumo_sin_dni', (select count(*) from consumo where estado = 'sin_dni'),
        'consumo_huerfano', (select count(*) from consumo where estado = 'dni_huerfano'),
        'epps', (select count(*) from epp),
        'matriz', (select count(*) from matriz_estandar),
        'manual_previas', manual_previas,
        'meta', (select to_jsonb(v) from vw_meta v)
    );
end $$;

grant execute on function recalcular_matriz() to anon, authenticated;
grant execute on function cargar_todo(jsonb, text) to anon, authenticated;
