-- ADR-018 (#179), option A: every access token carries the credential version of its account, and a token whose version
-- differs from the stored one is refused. An effective password change increments it in the transaction of ADR-017.
-- Additive: existing accounts start at 0, and the previous API ignores the column.

ALTER TABLE aegis.users
    ADD COLUMN credential_version integer NOT NULL DEFAULT 0,
    ADD CONSTRAINT ck_users_credential_version_non_negative CHECK (credential_version >= 0);

-- A lowered version would make revoked tokens valid again, and a new hash under the same version would leave the
-- earlier tokens valid. Like the triggers of V011, this fires for the table owner too.
CREATE FUNCTION aegis.guard_user_credential_version() RETURNS trigger
    LANGUAGE plpgsql AS
$$
BEGIN
    IF NEW.credential_version < OLD.credential_version THEN
        RAISE EXCEPTION 'the credential version of user % cannot decrease', OLD.id
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.password_hash IS DISTINCT FROM OLD.password_hash
        AND NEW.credential_version <= OLD.credential_version THEN
        RAISE EXCEPTION 'a new password of user % requires a new credential version', OLD.id
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tr_users_credential_version_guarded
    BEFORE UPDATE OF credential_version, password_hash ON aegis.users
    FOR EACH ROW EXECUTE FUNCTION aegis.guard_user_credential_version();
