-- ADR-017 (#178): an effective password change revokes every open browser session of the account, in the same
-- transaction, with the new reason PASSWORD_CHANGED, and leaves the audit event PASSWORD_CHANGED. A revoked session
-- is final: the trigger below refuses any later change to its row, so no code path can reopen it.

ALTER TABLE aegis.browser_sessions
    DROP CONSTRAINT ck_browser_sessions_revocation_reason;

ALTER TABLE aegis.browser_sessions
    ADD CONSTRAINT ck_browser_sessions_revocation_reason
        CHECK (revocation_reason IS NULL
            OR revocation_reason IN ('SIGNED_OUT', 'ACCOUNT_CHANGED', 'PASSWORD_CHANGED'));

-- Defense in depth, like the audit triggers of V002_2: triggers fire for the table owner too; only DISABLE TRIGGER or
-- session_replication_role = replica bypasses them.
CREATE FUNCTION aegis.refuse_revoked_browser_session_change() RETURNS trigger
    LANGUAGE plpgsql AS
$$
BEGIN
    RAISE EXCEPTION 'browser session % is revoked and cannot change', OLD.id
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER tr_browser_sessions_revoked_final
    BEFORE UPDATE ON aegis.browser_sessions
    FOR EACH ROW
    WHEN (OLD.revoked_at IS NOT NULL)
    EXECUTE FUNCTION aegis.refuse_revoked_browser_session_change();

-- An open session (neither revoked nor past its end) is never deleted, whatever the caller: only an ended row may go.
CREATE FUNCTION aegis.refuse_open_browser_session_delete() RETURNS trigger
    LANGUAGE plpgsql AS
$$
BEGIN
    RAISE EXCEPTION 'browser session % is still open and cannot be deleted', OLD.id
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER tr_browser_sessions_open_kept
    BEFORE DELETE ON aegis.browser_sessions
    FOR EACH ROW
    WHEN (OLD.revoked_at IS NULL AND OLD.expires_at > now())
    EXECUTE FUNCTION aegis.refuse_open_browser_session_delete();

-- Retention (ADR-017): a session ends at the earlier of its revocation and its absolute end; LEAST ignores a null
-- revoked_at. The row is deleted 30 days after that instant. This index serves the purge.
CREATE INDEX ix_browser_sessions_ended
    ON aegis.browser_sessions ((LEAST(revoked_at, expires_at)));

ALTER TABLE aegis.audit_events
    DROP CONSTRAINT ck_audit_events_type;

ALTER TABLE aegis.audit_events
    ADD CONSTRAINT ck_audit_events_type
        CHECK (event_type IN (
            'AUTHENTICATION_SUCCEEDED', 'AUTHENTICATION_REJECTED', 'PASSWORD_CHANGED',
            'ASSET_CREATED', 'ASSET_UPDATED', 'ASSET_ARCHIVED',
            'ASSET_IDENTIFIER_ASSIGNED', 'ASSET_PLACEMENT_CHANGED',
            'SCHEDULE_UPDATED', 'READINESS_EVALUATED',
            'RESERVATION_CREATED', 'RESERVATION_CANCELLED',
            'RESERVATION_FULFILLED', 'RESERVATION_EXPIRED',
            'OPERATION_REQUESTED', 'OPERATION_AUTHORIZED',
            'LOCAL_CHALLENGE_CREATED', 'LOCAL_CHALLENGE_DISPLAYED',
            'LOCAL_CHALLENGE_CONSUMED', 'LOCAL_CHALLENGE_REJECTED',
            'LOCAL_CHALLENGE_EXPIRED', 'LOCAL_CHALLENGE_INVALIDATED',
            'COMMAND_SENT', 'COMMAND_ACKNOWLEDGED', 'COMMAND_REJECTED',
            'DOOR_OPENED', 'OBSERVATION_RECEIVED',
            'OPERATION_CONFIRMED', 'OPERATION_FAILED', 'OPERATION_EXPIRED',
            'LOAN_RETURN_STARTED', 'LOAN_RETURN_REVERTED_SAFE', 'LOAN_COMPLETED',
            'ANOMALY_CREATED',
            'ANOMALY_ACKNOWLEDGED', 'ANOMALY_RESOLVED',
            'CHECKOUT_CONFIRMED', 'RETURN_CONFIRMED',
            'MQTT_MESSAGE_DUPLICATE_IGNORED',
            'LOCKER_ONLINE', 'LOCKER_OFFLINE'
        ));
