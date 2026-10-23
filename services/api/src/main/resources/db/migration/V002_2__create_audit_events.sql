-- Document 08, sections 4.9, 5.2 and 12.1: the append-only audit of business mutations.
-- Planned with V009 in section 11.1 and moved here so the catalog mutations are audited before CAT-02 adds V003.
-- operation_id, inbound_message_id and physical_observation_id are left out: each arrives with its foreign key in
-- the migration that creates the referenced table (V006 and V008), so no reference column ever exists without it.
-- No event is backfilled for rows created before this table.

CREATE TABLE aegis.audit_events (
    id            uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
    event_type    text NOT NULL,
    actor_user_id uuid NULL,
    subject_type  text NOT NULL,
    subject_id    uuid NOT NULL,
    from_state    text NULL,
    to_state      text NULL,
    result        text NULL,
    reason        text NULL,
    details       jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at   timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_audit_events_actor
        FOREIGN KEY (actor_user_id) REFERENCES aegis.users (id),
    CONSTRAINT ck_audit_events_type
        CHECK (event_type IN (
            'AUTHENTICATION_SUCCEEDED', 'AUTHENTICATION_REJECTED',
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
        )),
    CONSTRAINT ck_audit_events_subject_type
        CHECK (subject_type IN (
            'USER', 'ASSET_MODEL', 'ASSET', 'ASSET_IDENTIFIER',
            'LOCKER', 'COMPARTMENT', 'OPERATING_SCHEDULE',
            'OPERATING_WINDOW', 'RESERVATION', 'LOAN',
            'LOCKER_OPERATION', 'COMMAND_OUTBOX',
            'LOCAL_ACCESS_CHALLENGE', 'HUB_DISPLAY_OUTBOX',
            'INBOUND_DEVICE_MESSAGE', 'PHYSICAL_OBSERVATION', 'ANOMALY'
        )),
    CONSTRAINT ck_audit_events_result
        CHECK (result IS NULL OR result IN (
            'ACCEPTED', 'IN_PROGRESS', 'REJECTED', 'CONFLICT',
            'ALREADY_APPLIED', 'ANOMALY_REQUIRES_ACTION'
        )),
    CONSTRAINT ck_audit_events_state_pair
        CHECK (
            (from_state IS NULL AND to_state IS NULL)
            OR (
                from_state IS NOT NULL
                AND to_state IS NOT NULL
                AND btrim(from_state) <> ''
                AND btrim(to_state) <> ''
            )
        )
);

-- ix_audit_events_operation_time arrives with operation_id in V006.
CREATE INDEX ix_audit_events_subject_time
    ON aegis.audit_events (subject_type, subject_id, occurred_at DESC);

CREATE INDEX ix_audit_events_time
    ON aegis.audit_events (occurred_at DESC, id DESC);

-- Defense in depth only. The real protection is the application role, which holds SELECT and INSERT on this table
-- and nothing else (afterMigrate callback, section 12.1). The table owner can disable or drop these triggers, and a
-- superuser bypasses them, for example with session_replication_role = replica.
CREATE FUNCTION aegis.refuse_audit_event_change() RETURNS trigger
    LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'aegis.audit_events is append-only: % refused', TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER tr_audit_events_append_only_rows
    BEFORE UPDATE OR DELETE ON aegis.audit_events
    FOR EACH ROW EXECUTE FUNCTION aegis.refuse_audit_event_change();

CREATE TRIGGER tr_audit_events_append_only_truncate
    BEFORE TRUNCATE ON aegis.audit_events
    FOR EACH STATEMENT EXECUTE FUNCTION aegis.refuse_audit_event_change();
