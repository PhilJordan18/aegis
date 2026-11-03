-- Document 08, section 12.1: the application role and the migration owner role of one Aegis database.
-- Run as a superuser, once per database; running it again changes nothing:
--   psql -v ON_ERROR_STOP=1 -v app_role=aegis_app -v migration_role=aegis_migrator -d aegis \
--     -f infra/postgres/provision-roles.sql
-- No password is written here or passed on the command line. Set each one afterwards in psql with
-- \password <role>, which sends only a SCRAM verifier: a plaintext ALTER ROLE ... PASSWORD can reach server logs.
-- Table privileges are not granted here: the Flyway callback afterMigrate__grant_application_role.sql applies them
-- after every migration, so they follow the schema.

-- A refusal below must stop the script even when the caller omits -v ON_ERROR_STOP=1: the ALTER ROLE statements
-- that follow would otherwise demote the refused role.
\set ON_ERROR_STOP on

\if :{?app_role}
\else
\set app_role aegis_app
\endif
\if :{?migration_role}
\else
\set migration_role aegis_migrator
\endif

-- ALTER ROLE below would demote a superuser or the current owner; refuse instead of guessing.
SELECT
    :'app_role' !~ '^[a-z_][a-z0-9_]{0,62}$'
    OR :'migration_role' !~ '^[a-z_][a-z0-9_]{0,62}$'
    OR :'app_role' = :'migration_role'
    OR EXISTS (
        SELECT FROM pg_catalog.pg_roles r
        WHERE r.rolname IN (:'app_role', :'migration_role')
          AND (r.rolsuper OR r.rolname = current_user))
    OR EXISTS (
        SELECT FROM pg_catalog.pg_roles r
        JOIN pg_catalog.pg_namespace n ON n.nspname = 'aegis'
        WHERE r.rolname = :'app_role' AND pg_catalog.pg_has_role(r.oid, n.nspowner, 'MEMBER'))
    AS refused
\gset
\if :refused
DO $refuse$ BEGIN
    RAISE EXCEPTION 'Refused: invalid or equal role names, a superuser or the current user, or an application role '
        'that owns schema aegis';
END $refuse$;
\endif

SELECT format('CREATE ROLE %I', :'app_role')
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = :'app_role')
\gexec
SELECT format('ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', :'app_role')
\gexec

SELECT format('CREATE ROLE %I', :'migration_role')
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = :'migration_role')
\gexec
SELECT format('ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
        :'migration_role')
\gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_role')
\gexec
SELECT format('GRANT CONNECT, CREATE ON DATABASE %I TO %I', current_database(), :'migration_role')
\gexec
