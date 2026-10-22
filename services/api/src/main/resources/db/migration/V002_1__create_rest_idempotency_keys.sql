-- Document 08, section 4.10: durable REST idempotency keys, scoped by actor, logical route and key.
-- Planned as V010 in section 11.1 and moved here so the catalog routes of document 09, section 20.1, can use it
-- before V003. It only references aegis.users, created by V002.
-- The purge index ix_rest_idempotency_expiry (section 5.2) stays with the read indexes of V011.

CREATE TABLE aegis.rest_idempotency_keys (
    id              uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
    actor_user_id   uuid NOT NULL,
    endpoint        text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash    bytea NOT NULL,
    status          text NOT NULL DEFAULT 'IN_PROGRESS',
    response_status smallint NULL,
    response_body   jsonb NULL,
    resource_type   text NULL,
    resource_id     uuid NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    completed_at    timestamptz NULL,
    expires_at      timestamptz NOT NULL,

    CONSTRAINT fk_rest_idempotency_actor
        FOREIGN KEY (actor_user_id) REFERENCES aegis.users (id),
    CONSTRAINT ck_rest_idempotency_endpoint
        CHECK (btrim(endpoint) <> ''),
    CONSTRAINT ck_rest_idempotency_key_length
        CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
    CONSTRAINT ck_rest_idempotency_hash
        CHECK (octet_length(request_hash) = 32),
    CONSTRAINT ck_rest_idempotency_status
        CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
    CONSTRAINT ck_rest_idempotency_response_status
        CHECK (response_status IS NULL OR response_status BETWEEN 200 AND 599),
    CONSTRAINT ck_rest_idempotency_dates
        CHECK (
            (completed_at IS NULL OR completed_at >= created_at)
            AND expires_at > created_at
        ),
    CONSTRAINT ck_rest_idempotency_lifecycle
        CHECK (
            (status = 'IN_PROGRESS'
                AND completed_at IS NULL
                AND response_status IS NULL
                AND response_body IS NULL)
            OR
            (status = 'COMPLETED'
                AND completed_at IS NOT NULL
                AND response_status IS NOT NULL)
        ),
    CONSTRAINT ck_rest_idempotency_resource_pair
        CHECK ((resource_type IS NULL) = (resource_id IS NULL)),
    CONSTRAINT uq_rest_idempotency_scope
        UNIQUE (actor_user_id, endpoint, idempotency_key)
);
