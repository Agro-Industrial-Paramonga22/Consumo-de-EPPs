-- =====================================================================
--  Uniformes — gerencia / área / lugar por cargo
-- ---------------------------------------------------------------------
--  Las tablas de uniformes solo guardan el NOMBRE DEL CARGO. La jerarquía
--  organizacional vive en el maestro de personas (nombre -> CECO ->
--  sección -> gerencia), así que se expone con esta vista para que la
--  Matriz de Uniformes pueda filtrar por gerencia, área y lugar.
--
--  Es una vista (no tabla): al recargar los Excel de uniformes o el
--  maestro de personas, el filtro se actualiza solo.
--
--  Ejecutar en el proyecto Supabase yyzwlqtbhcbyftwwtexi.
-- =====================================================================

-- Índices de expresión: sin ellos la vista hace un scan completo de
-- personas x asignaciones y PostgREST la corta por timeout.
create index if not exists ix_personas_nombre_up
  on public.personas (upper(trim(nombre)));
create index if not exists ix_uni_asig_cargo_up
  on public.uniformes_asignaciones (upper(trim(cargo)));
create index if not exists ix_uni_asig_nombre_up
  on public.uniformes_asignaciones (upper(trim(nombre)));

create or replace view public.vw_uniformes_cargos_org
with (security_invoker = true) as
select distinct
  uc.id                                            as cargo_id,
  uc.nombre                                        as cargo,
  coalesce(g.nombre, 'Sin asignar')                as gerencia,
  coalesce(s.nombre, 'Sin área')                   as seccion,
  coalesce(cc.codigo, 'SIN-ASIGNAR')               as ceco,
  coalesce(cc.descripcion, 'Sin lugar de trabajo') as ceco_desc
from public.uniformes_cargos uc
left join public.uniformes_asignaciones ua
       on upper(trim(ua.cargo)) = upper(trim(uc.nombre))
left join public.personas p
       on upper(trim(p.nombre)) = upper(trim(ua.nombre))
left join public.centros_costo cc on cc.codigo = p.ceco
left join public.secciones s      on s.id = cc.seccion_id
left join public.gerencias g      on g.id = s.gerencia_id;

grant select on public.vw_uniformes_cargos_org to anon, authenticated;

-- ---------------------------------------------------------------------
--  Misma jerarquía, pero por trabajador (pantalla "Consumo de Uniformes")
-- ---------------------------------------------------------------------
create or replace view public.vw_uniformes_personas_org
with (security_invoker = true) as
select distinct
  ua.nombre                                        as persona,
  coalesce(g.nombre, 'Sin asignar')                as gerencia,
  coalesce(s.nombre, 'Sin área')                   as seccion,
  coalesce(cc.codigo, 'SIN-ASIGNAR')               as ceco,
  coalesce(cc.descripcion, 'Sin lugar de trabajo') as ceco_desc
from public.uniformes_asignaciones ua
left join public.personas p       on upper(trim(p.nombre)) = upper(trim(ua.nombre))
left join public.centros_costo cc on cc.codigo = p.ceco
left join public.secciones s      on s.id = cc.seccion_id
left join public.gerencias g      on g.id = s.gerencia_id;

grant select on public.vw_uniformes_personas_org to anon, authenticated;
