/* =====================================================================
   Configuración de conexión a Supabase
   ---------------------------------------------------------------------
   La clave "publishable" es pública por diseño: puede ir en el repo.
   Lo que NUNCA debe llegar aquí es la clave secreta (sb_secret_...) ni
   el token de GitHub.
   ===================================================================== */
window.EPP_CONFIG = {
  SUPABASE_URL: 'https://yyzwlqtbhcbyftwwtexi.supabase.co',
  SUPABASE_KEY: 'sb_publishable_BI0eXBgpM6lgBuHH7pprdQ_IcM5Mryl',

  // Clave de la función cargar_todo(): evita que cualquiera con la clave
  // pública vacíe la base. No es seguridad real (está en el código), es
  // una barrera; para eso está RLS.
  CLAVE_CARGA: 'epp-paramonga-2026'
};
