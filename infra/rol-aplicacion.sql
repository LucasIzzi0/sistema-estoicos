-- Rol de base con el mínimo privilegio para la aplicación (Fase 9).
--
-- Hoy la app se conecta con el dueño de la base, que puede borrar tablas enteras. Con este rol,
-- si alguna vez se filtra la cadena de conexión, el daño posible es mucho menor: puede leer y
-- escribir filas, pero **no puede borrar ni alterar tablas**, ni tocar los triggers que hacen
-- que los libros (puntos, comisiones, auditoría) sean de solo inserción.
--
-- Las migraciones se siguen aplicando con el usuario dueño, solo durante el deploy.
--
-- Uso:
--   psql "$DATABASE_URL_ADMIN" -v app_password="'una-clave-larga'" -f infra/rol-aplicacion.sql
-- y después, en la app:  DATABASE_URL=postgresql://estoicos_app:<clave>@host:5432/estoicos

\set ON_ERROR_STOP on

-- 1. El rol, sin permiso para crear bases ni roles.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'estoicos_app') THEN
    EXECUTE format('CREATE ROLE estoicos_app LOGIN PASSWORD %L', current_setting('app_password'));
  ELSE
    EXECUTE format('ALTER ROLE estoicos_app PASSWORD %L', current_setting('app_password'));
  END IF;
END
$$;

ALTER ROLE estoicos_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- 2. Puede entrar a la base y ver el esquema, pero no crear objetos nuevos ahí.
GRANT CONNECT ON DATABASE current_database() TO estoicos_app;
GRANT USAGE ON SCHEMA public TO estoicos_app;
REVOKE CREATE ON SCHEMA public FROM estoicos_app;

-- 3. Filas: leer y escribir en todas las tablas de la aplicación.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO estoicos_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO estoicos_app;

-- 4. Lo que se cree de acá en adelante (migraciones nuevas) nace con los mismos permisos.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO estoicos_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO estoicos_app;

-- 5. Los libros de solo inserción se defienden igual con sus triggers, pero además se le saca
--    el permiso de borrar: un error de la aplicación no puede vaciar un historial.
REVOKE DELETE ON
  points_entries,
  commission_entries,
  stock_movements,
  audit_logs,
  consent_events,
  appointment_events,
  customer_credit_entries
FROM estoicos_app;

-- 6. Comprobación: qué quedó realmente.
SELECT table_name,
       string_agg(privilege_type, ', ' ORDER BY privilege_type) AS permisos
FROM information_schema.role_table_grants
WHERE grantee = 'estoicos_app'
  AND table_name IN (
    'sales', 'payments', 'points_entries', 'audit_logs', 'customers'
  )
GROUP BY table_name
ORDER BY table_name;
