-- Document 08, section 12.1: the privileges of the application role, reapplied after every migrate so that they
-- follow the schema. A Flyway callback is not versioned: it may change without touching any migration checksum.
-- Nothing happens while the role does not exist, which keeps local and CI databases that connect as the owner
-- unchanged. Every table of schema aegis gets exactly SELECT, INSERT, UPDATE and DELETE, except the append-only
-- tables, which get SELECT and INSERT only; TRUNCATE, REFERENCES and TRIGGER are never granted.

DO $grants$
DECLARE
    application_role CONSTANT text := '${application_role}';
    append_only CONSTANT text[] := ARRAY['audit_events'];
    relation record;
BEGIN
    IF application_role !~ '^[a-z_][a-z0-9_]{0,62}$' THEN
        RAISE EXCEPTION 'Invalid application role name "%"', application_role;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = application_role) THEN
        RAISE NOTICE 'Role % does not exist: no application privilege granted', application_role;
        RETURN;
    END IF;
    -- Revoking the owner's own privileges would break the schema; a superuser ignores privileges altogether.
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = application_role AND rolsuper)
        OR EXISTS (
            SELECT FROM pg_catalog.pg_namespace
            WHERE nspname = 'aegis' AND pg_catalog.pg_has_role(application_role, nspowner, 'USAGE'))
        OR EXISTS (
            SELECT FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'aegis' AND pg_catalog.pg_has_role(application_role, c.relowner, 'USAGE'))
    THEN
        RAISE EXCEPTION 'Role % must be neither a superuser nor a member of an owner of schema aegis or its objects',
            application_role;
    END IF;

    EXECUTE format('REVOKE ALL ON SCHEMA aegis FROM %I', application_role);
    EXECUTE format('GRANT USAGE ON SCHEMA aegis TO %I', application_role);

    FOR relation IN
        SELECT c.relname, c.relkind
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'aegis' AND c.relkind IN ('r', 'p', 'S')
        ORDER BY c.relname
    LOOP
        IF relation.relkind = 'S' THEN
            EXECUTE format('REVOKE ALL ON SEQUENCE aegis.%I FROM %I', relation.relname, application_role);
            EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE aegis.%I TO %I', relation.relname, application_role);
        ELSIF relation.relname = ANY (append_only) THEN
            EXECUTE format('REVOKE ALL ON TABLE aegis.%I FROM %I', relation.relname, application_role);
            EXECUTE format('GRANT SELECT, INSERT ON TABLE aegis.%I TO %I', relation.relname, application_role);
        ELSE
            EXECUTE format('REVOKE ALL ON TABLE aegis.%I FROM %I', relation.relname, application_role);
            EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE aegis.%I TO %I',
                    relation.relname, application_role);
        END IF;
    END LOOP;
END
$grants$;
