-- =====================================================================
--  Consumo de EPPs — Esquema base (PostgreSQL / Supabase)
--  Ejecutar en: Supabase → SQL Editor   (idempotente)
--
--  Jerarquía organizacional : Gerencia → Sección → CECO → Plaza
--  Plaza = puesto de trabajo dentro de un CECO  (fila de la matriz)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ESTRUCTURA ORGANIZACIONAL
-- ---------------------------------------------------------------------

create table if not exists gerencias (
    id     smallserial primary key,
    nombre text not null unique
);

create table if not exists secciones (
    id          smallserial primary key,
    nombre      text not null unique,
    gerencia_id smallint references gerencias(id)
);

create table if not exists centros_costo (
    codigo      text primary key,          -- 37095, 41401, 43101 …
    descripcion text not null,
    seccion_id  smallint references secciones(id)
);

insert into centros_costo (codigo, descripcion)
values ('SIN-CECO', 'Personas de servicios sin centro de costo asignado')
on conflict (codigo) do nothing;

create table if not exists puestos (
    id     serial primary key,
    nombre text not null unique,
    alias  text[] not null default '{}'
);

-- Plaza = puesto + ceco. Es la fila real de la matriz.
create table if not exists plazas (
    id        serial primary key,
    puesto_id int  not null references puestos(id) on delete cascade,
    ceco      text not null references centros_costo(codigo) on delete cascade,
    unique (puesto_id, ceco)
);

-- ---------------------------------------------------------------------
-- 2. CATÁLOGO DE EPP Y PRECIOS
-- ---------------------------------------------------------------------

create table if not exists familias (
    id     smallserial primary key,
    codigo text not null unique,
    nombre text not null,
    orden  smallint not null default 0
);

insert into familias (codigo, nombre, orden) values
    ('CASCO',     'Casco',      1),
    ('AUDITIVO',  'Auditivo',   2),
    ('RESPIRADOR','Respirador', 3),
    ('LENTE',     'Lente',      4),
    ('GUANTE',    'Guante',     5),
    ('BOTA',      'Bota',       6),
    ('SOLDADURA', 'Soldadura',  7),
    ('ROPA',      'Ropa',       8),
    ('ARNES',     'Arnés',      9),
    ('OTROS',     'Otros',     99)
on conflict (codigo) do nothing;

-- Nombres cortos para los chips de la matriz
update familias set nombre = 'Casco'     where codigo = 'CASCO';
update familias set nombre = 'Auditivo'  where codigo = 'AUDITIVO';
update familias set nombre = 'Respirador' where codigo = 'RESPIRADOR';
update familias set nombre = 'Lente'     where codigo = 'LENTE';
update familias set nombre = 'Guante'    where codigo = 'GUANTE';
update familias set nombre = 'Bota'      where codigo = 'BOTA';
update familias set nombre = 'Soldadura' where codigo = 'SOLDADURA';
update familias set nombre = 'Ropa'      where codigo = 'ROPA';
update familias set nombre = 'Arnés'     where codigo = 'ARNES';

-- factor = cuántas unidades base trae la unidad de compra.
-- Ej.: LUNA BLANCA se compra por LOTE de 100 (factor 100, S/90 el lote
--      -> S/0,90 por unidad). Así el precio siempre queda POR UNIDAD BASE
--      y coincide con la unidad en que viene el consumo.
create table if not exists epp (
    material       text primary key,        -- código SAP
    descripcion    text not null,
    familia_id     smallint references familias(id),
    unidad         text not null,           -- unidad base: UN, PAA, CJ…
    unidad_compra  text,
    factor         numeric(10,2) not null default 1 check (factor > 0),
    centro         text,
    grupo_compra   text,
    solo_soldadura boolean not null default false,   -- capucha, mandil, escarpín de solda…
    activo         boolean not null default true
);

-- Para bases ya creadas
alter table epp add column if not exists solo_soldadura boolean not null default false;

-- Precio SIEMPRE por unidad base, con vigencia (corrige sin perder histórico)
create table if not exists precios (
    id            bigserial primary key,
    material      text not null references epp(material) on delete cascade,
    precio        numeric(12,4) not null check (precio >= 0),
    moneda        char(3) not null default 'PEN',
    vigente_desde date not null default current_date,
    fuente        text,
    nota          text,
    creado_en     timestamptz not null default now(),
    unique (material, vigente_desde)
);

-- ---------------------------------------------------------------------
-- 3. PERSONAS Y CONSUMO
-- ---------------------------------------------------------------------

create table if not exists personas (
    dni           char(8) primary key,
    nombre        text not null,
    puesto_id     int references puestos(id),
    ceco          text references centros_costo(codigo),
    fecha_ingreso date,
    fuente        text not null check (fuente in ('MAE','SERVICIOS','MANUAL')),
    activo        boolean not null default true
);

-- Sin FK en dni: se cargan también los DNI que no están en el maestro,
-- en cuarentena, para no perder ni un sol del gasto.
create table if not exists consumo (
    id           bigserial primary key,
    fecha        date not null,
    material     text not null references epp(material),
    cantidad     numeric(12,2) not null,
    unidad       text not null,
    dni          char(8),
    ref_texto    text,        -- 'TALLER SOLDA', 'SOLDADORES', 'TOPICO'…
    estado       text not null default 'ok'
                 check (estado in ('ok','sin_dni','dni_huerfano')),
    importado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. MATRIZ ESTÁNDAR — un EPP por familia y plaza
--    El consumo la sugiere; luego queda como estándar editable.
-- ---------------------------------------------------------------------

create table if not exists matriz_estandar (
    plaza_id       int  not null references plazas(id) on delete cascade,
    epp_id         text not null references epp(material) on delete cascade,
    familia_id     smallint references familias(id),
    cantidad       numeric(6,2) not null default 1 check (cantidad >= 0),
    reposiciones_anio numeric(5,2),          -- null = usar 1 (kit unitario)
    requerido      boolean not null default true,
    cobertura_pct  numeric(5,2),
    origen         text not null default 'auto' check (origen in ('auto','manual')),
    nota           text,
    actualizado_en timestamptz not null default now(),
    primary key (plaza_id, epp_id)
);

-- ---------------------------------------------------------------------
-- 5. ÍNDICES
-- ---------------------------------------------------------------------
create index if not exists ix_consumo_fecha    on consumo (fecha);
create index if not exists ix_consumo_dni      on consumo (dni);
create index if not exists ix_consumo_material on consumo (material);
create index if not exists ix_consumo_estado   on consumo (estado);
create index if not exists ix_personas_puesto  on personas (puesto_id);
create index if not exists ix_personas_ceco    on personas (ceco);
create index if not exists ix_precios_mat      on precios (material, vigente_desde desc);
create index if not exists ix_matriz_plaza     on matriz_estandar (plaza_id);

-- ---------------------------------------------------------------------
-- 6. VISTAS
-- ---------------------------------------------------------------------

-- Precio vigente por EPP
create or replace view vw_epp_precio
with (security_invoker = true) as
select e.material, e.descripcion, f.codigo as familia_codigo, f.nombre as familia,
       f.orden as familia_orden, e.unidad, e.factor,
       p.precio, p.moneda, p.vigente_desde
from epp e
join familias f on f.id = e.familia_id
join lateral (
    select pr.* from precios pr
    where pr.material = e.material and pr.vigente_desde <= current_date
    order by pr.vigente_desde desc limit 1
) p on true
where e.activo;

-- Catálogo con cuántas plazas lo tienen como base (columna de la matriz)
create or replace view vw_epp_base
with (security_invoker = true) as
select ep.material, ep.descripcion, ep.familia_codigo, ep.familia, ep.familia_orden,
       ep.unidad, ep.factor, ep.precio, count(m.plaza_id) as n_plazas
from vw_epp_precio ep
left join matriz_estandar m on m.epp_id = ep.material and m.requerido
group by 1, 2, 3, 4, 5, 6, 7, 8;

-- Plazas con su dotación real
create or replace view vw_plazas
with (security_invoker = true) as
select pl.id as plaza_id, pl.puesto_id, pu.nombre as puesto, pl.ceco,
       cc.descripcion as ceco_desc, s.id as seccion_id, s.nombre as seccion,
       g.nombre as gerencia,
       (select count(*) from personas pe where pe.puesto_id = pl.puesto_id
                                               and coalesce(pe.ceco,'SIN-CECO') = pl.ceco) as personas
from plazas pl
join puestos pu        on pu.id = pl.puesto_id
join centros_costo cc  on cc.codigo = pl.ceco
left join secciones s  on s.id = cc.seccion_id
left join gerencias g  on g.id = s.gerencia_id;

-- Matriz sugerida por el consumo: 1 EPP por plaza y familia (mayor cobertura)
create or replace view vw_matriz_sugerida
with (security_invoker = true) as
with uso as (
    select pl.id as plaza_id, co.material, count(distinct co.dni) as personas_que_usan
    from consumo co
    join personas pe on pe.dni = co.dni
    join plazas pl   on pl.puesto_id = pe.puesto_id
                    and pl.ceco = coalesce(pe.ceco, 'SIN-CECO')
    group by 1, 2
),
tot as (
    select pl.id as plaza_id,
           (select count(*) from personas pe where pe.puesto_id = pl.puesto_id
                                                   and coalesce(pe.ceco,'SIN-CECO') = pl.ceco)::numeric as n_personas
    from plazas pl
),
ranked as (
    select u.plaza_id, u.material, e.familia_id,
           u.personas_que_usan, t.n_personas,
           round(100.0 * u.personas_que_usan / nullif(t.n_personas, 0), 1) as cobertura_pct,
           row_number() over (partition by u.plaza_id, e.familia_id
                              order by u.personas_que_usan desc, e.descripcion) as rn
    from uso u
    join tot t on t.plaza_id = u.plaza_id
    join epp e on e.material = u.material
)
select plaza_id, material, familia_id, personas_que_usan, n_personas, cobertura_pct
from ranked where rn = 1;

-- Consumo adicional: lo que se consumió en la plaza pero NO está en la matriz
create or replace view vw_matriz_adicional
with (security_invoker = true) as
with uso as (
    select pl.id as plaza_id, co.material, count(distinct co.dni) as personas_que_usan
    from consumo co
    join personas pe on pe.dni = co.dni
    join plazas pl   on pl.puesto_id = pe.puesto_id
                    and pl.ceco = coalesce(pe.ceco, 'SIN-CECO')
    where co.estado = 'ok'
    group by 1, 2
),
tot as (
    select pl.id as plaza_id, count(distinct co.dni)::numeric as n_consumidores
    from consumo co
    join personas pe on pe.dni = co.dni
    join plazas pl   on pl.puesto_id = pe.puesto_id
                    and pl.ceco = coalesce(pe.ceco, 'SIN-CECO')
    where co.estado = 'ok'
    group by 1
)
select u.plaza_id, u.material, u.personas_que_usan, t.n_consumidores,
       round(100.0 * u.personas_que_usan / nullif(t.n_consumidores, 0), 1) as cobertura_pct,
       case when e.solo_soldadura
             and not (pu.nombre ilike '%SOLDADOR%' or pu.nombre ilike '%CALDERERO%'
                      or pu.nombre ilike '%HERRERO%' or pu.nombre ilike '%MANIOBRISTA%')
            then 'soldadura' else 'minoritario' end as motivo
from uso u
join tot t on t.plaza_id = u.plaza_id
join plazas pl on pl.id = u.plaza_id
join puestos pu on pu.id = pl.puesto_id
join epp e on e.material = u.material
left join matriz_estandar m on m.plaza_id = u.plaza_id and m.epp_id = u.material
where m.plaza_id is null;

-- Detalle de la matriz (una fila por celda EPP × plaza)
create or replace view vw_matriz_detalle
with (security_invoker = true) as
select m.plaza_id, v.puesto, v.ceco, v.ceco_desc, v.seccion, v.gerencia, v.personas,
       m.epp_id, ep.descripcion, ep.familia_codigo, ep.familia, ep.unidad, ep.precio,
       m.cantidad, m.reposiciones_anio, m.cobertura_pct, m.origen,
       round(ep.precio * m.cantidad, 2)                          as subtotal_kit,
       round(ep.precio * m.cantidad * coalesce(m.reposiciones_anio, 1), 2) as subtotal_anual
from matriz_estandar m
join vw_plazas    v  on v.plaza_id  = m.plaza_id
join vw_epp_precio ep on ep.material = m.epp_id
where m.requerido;

-- Costo por plaza (la fila de la imagen)
create or replace view vw_costo_plaza
with (security_invoker = true) as
select v.plaza_id, v.puesto, v.ceco, v.ceco_desc, v.seccion, v.personas,
       count(d.epp_id)                       as epp_count,
       coalesce(sum(d.subtotal_kit), 0)::numeric(12,2)   as costo_kit,
       coalesce(sum(d.subtotal_anual), 0)::numeric(12,2) as costo_anual
from vw_plazas v
left join vw_matriz_detalle d on d.plaza_id = v.plaza_id
group by v.plaza_id, v.puesto, v.ceco, v.ceco_desc, v.seccion, v.personas;

-- Consumo real por persona
create or replace view vw_consumo_persona
with (security_invoker = true) as
select co.fecha, co.dni, pe.nombre, pu.nombre as puesto, pe.ceco, cc.descripcion as ceco_desc,
       s.nombre as seccion, co.material, ep.descripcion, ep.familia,
       co.cantidad, ep.precio,
       round(co.cantidad * ep.precio, 2)::numeric(12,2) as valor
from consumo co
join personas pe       on pe.dni = co.dni
left join puestos pu   on pu.id = pe.puesto_id
left join centros_costo cc on cc.codigo = coalesce(pe.ceco,'SIN-CECO')
left join secciones s  on s.id = cc.seccion_id
join vw_epp_precio ep  on ep.material = co.material;

-- Consumo real agregado por plaza
create or replace view vw_consumo_plaza
with (security_invoker = true) as
select pl.id as plaza_id, pu.nombre as puesto, pl.ceco, cc.descripcion as ceco_desc,
       count(distinct co.dni) as personas,
       count(co.id)           as lineas,
       count(distinct co.material) as epp_distintos,
       sum(round(co.cantidad * ep.precio, 2))::numeric(14,2) as valor_total
from consumo co
join personas pe      on pe.dni = co.dni
join plazas pl        on pl.puesto_id = pe.puesto_id
                     and pl.ceco = coalesce(pe.ceco,'SIN-CECO')
join puestos pu       on pu.id = pl.puesto_id
join centros_costo cc on cc.codigo = pl.ceco
join vw_epp_precio ep on ep.material = co.material
group by pl.id, pu.nombre, pl.ceco, cc.descripcion;

-- Semáforo de calidad del dato
create or replace view vw_calidad_datos
with (security_invoker = true) as
select count(*)                                                          as lineas,
       count(*) filter (where estado = 'ok')                             as ok,
       count(*) filter (where estado = 'sin_dni')                        as sin_dni,
       count(*) filter (where estado = 'dni_huerfano')                   as dni_huerfano,
       coalesce(sum(round(cantidad * precio, 2)), 0)::numeric(14,2)      as valor_total,
       coalesce(sum(round(cantidad * precio, 2)) filter (where estado='ok'), 0)::numeric(14,2) as valor_ok,
       coalesce(sum(round(cantidad * precio, 2)) filter (where estado='sin_dni'), 0)::numeric(14,2) as valor_sin_dni,
       coalesce(sum(round(cantidad * precio, 2)) filter (where estado='dni_huerfano'), 0)::numeric(14,2) as valor_huerfano
from consumo co
join vw_epp_precio v on v.material = co.material;

-- Números de portada de la matriz (un solo registro)
create or replace view vw_meta
with (security_invoker = true) as
select
  (select count(*) from vw_plazas)                                        as plazas,
  (select count(*) from vw_consumo_plaza)                                 as plazas_con_consumo,
  (select count(*) from vw_costo_plaza where epp_count > 0)               as plazas_con_kit,
  (select count(*) from vw_epp_precio)                                    as epps,
  (select count(distinct epp_id) from matriz_estandar where requerido)    as epps_base,
  (select count(*) from matriz_estandar where requerido)                  as celdas,
  (select count(*) from vw_matriz_adicional)                              as adicionales,
  (select count(*) from personas)                                         as personas,
  (select count(distinct dni) from vw_consumo_persona)                    as personas_con_consumo,
  (select coalesce(sum(valor), 0) from vw_consumo_persona)                as valor,
  (select coalesce(sum(costo_kit), 0) from vw_costo_plaza)                as costo_dotacion,
  (select coalesce(array_agg(mes order by mes), '{}')
     from (select distinct to_char(fecha, 'YYYY-MM') mes from vw_consumo_persona) x) as meses,
  (select coalesce(jsonb_object_agg(mes, total order by mes), '{}'::jsonb)
     from (select to_char(fecha, 'YYYY-MM') mes, round(sum(valor), 2) total
           from vw_consumo_persona group by 1) y)                          as por_mes;

-- ---------------------------------------------------------------------
-- 7. SEGURIDAD (RLS): lectura pública, escritura sólo con clave secreta
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
    foreach t in array array['gerencias','secciones','centros_costo','puestos','plazas',
                             'familias','epp','precios','personas','consumo','matriz_estandar']
    loop
        execute format('alter table %I enable row level security', t);
        execute format('drop policy if exists lectura_publica on %I', t);
        execute format('create policy lectura_publica on %I for select to anon, authenticated using (true)', t);
    end loop;
end $$;

grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
