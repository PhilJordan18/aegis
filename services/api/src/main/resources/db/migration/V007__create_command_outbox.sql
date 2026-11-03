-- Document 08, sections 4.6, 4.7, 5.1 and 9: the local access challenge of an operation, its encrypted display
-- instructions and the durable unlock command (D8, D9 and D10 of document 07). The display outbox stays distinct from
-- command_outbox, whose operation_id uniqueness is reserved for the single unlock of an operation.
-- Created here with their tables: the invariant index ux_display_one_challenge_per_operation, the pending-expiry
-- index of section 7.6, and the claim indexes of section 9.2 that section 11.1 places in V007. The read indexes of
-- section 5.2 are created later by V011. The application role never deletes these rows (afterMigrate callback).

-- The 256-bit secret is never stored in clear: token_hash keeps its 32-byte digest only. The 60-second window and the
-- five wrong secrets are the bounds retained by ADR-009 on 23 September 2026.
CREATE TABLE aegis.local_access_challenges (
    id uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
    operation_id uuid NOT NULL UNIQUE,
    locker_id uuid NOT NULL,
    locker_device_id uuid NOT NULL,
    target_device_session_id uuid NOT NULL,
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    status text NOT NULL DEFAULT 'PENDING',
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    displayed_at timestamptz NULL,
    consumed_at timestamptz NULL,
    closed_at timestamptz NULL,
    failed_attempts smallint NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
    CONSTRAINT fk_local_challenge_operation
        FOREIGN KEY (operation_id, locker_id) REFERENCES aegis.locker_operations (id, locker_id),
    CONSTRAINT fk_local_challenge_device
        FOREIGN KEY (locker_device_id, locker_id) REFERENCES aegis.locker_devices (id, locker_id),
    CONSTRAINT uq_local_challenge_id_operation UNIQUE (id, operation_id),
    CONSTRAINT ck_local_challenge_status
        CHECK (status IN ('PENDING', 'CONSUMED', 'EXPIRED', 'INVALIDATED')),
    CONSTRAINT ck_local_challenge_window
        CHECK (expires_at > created_at AND expires_at <= created_at + interval '60 seconds'),
    CONSTRAINT ck_local_challenge_closed
        CHECK ((status = 'PENDING') = (closed_at IS NULL)),
    CONSTRAINT ck_local_challenge_consumed
        CHECK ((status = 'CONSUMED') = (consumed_at IS NOT NULL)),
    CONSTRAINT ck_local_challenge_consumption_time
        CHECK (
            consumed_at IS NULL OR
            (displayed_at IS NOT NULL AND consumed_at >= displayed_at
             AND consumed_at >= created_at AND consumed_at < expires_at
             AND closed_at = consumed_at)
        ),
    CONSTRAINT ck_local_challenge_dates
        CHECK (
            (displayed_at IS NULL OR (displayed_at >= created_at AND displayed_at < expires_at))
            AND (closed_at IS NULL OR closed_at >= created_at)
        ),
    CONSTRAINT ck_local_challenge_attempts
        CHECK (status <> 'PENDING' OR failed_attempts < 5)
);

-- The application encrypts the display payload (authenticated encryption, key outside PostgreSQL); the envelope of
-- ciphertext, nonce and tag lives in encrypted_payload and is purged once the challenge is consumed, expired or
-- invalidated. schema_version has no default, as in command_outbox: the producer states the MQTT schema of document
-- 10 it encodes, and a default would silently go stale when that schema changes; the hub rejects a wrong version.
CREATE TABLE aegis.hub_display_outbox (
    id uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
    message_id uuid NOT NULL UNIQUE,
    operation_id uuid NOT NULL,
    locker_id uuid NOT NULL,
    locker_device_id uuid NOT NULL,
    target_device_session_id uuid NOT NULL,
    challenge_id uuid NULL,
    message_type text NOT NULL,
    display_revision bigint NOT NULL CHECK (display_revision > 0),
    topic text NOT NULL CHECK (btrim(topic) <> ''),
    schema_version text NOT NULL,
    encrypted_payload bytea NULL,
    encryption_key_id text NOT NULL CHECK (btrim(encryption_key_id) <> ''),
    issued_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'PENDING',
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    claim_until timestamptz NULL,
    published_at timestamptz NULL,
    acknowledged_at timestamptz NULL,
    last_error text NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_display_operation
        FOREIGN KEY (operation_id, locker_id) REFERENCES aegis.locker_operations (id, locker_id),
    CONSTRAINT fk_display_device
        FOREIGN KEY (locker_device_id, locker_id) REFERENCES aegis.locker_devices (id, locker_id),
    CONSTRAINT fk_display_challenge
        FOREIGN KEY (challenge_id, operation_id) REFERENCES aegis.local_access_challenges (id, operation_id),
    CONSTRAINT uq_display_revision UNIQUE (locker_id, display_revision),
    CONSTRAINT ck_display_type
        CHECK (message_type IN ('DISPLAY_ACCESS_CHALLENGE', 'DISPLAY_OPERATION_STATUS')),
    CONSTRAINT ck_display_challenge
        CHECK ((message_type = 'DISPLAY_ACCESS_CHALLENGE') = (challenge_id IS NOT NULL)),
    CONSTRAINT ck_display_dates CHECK (expires_at > issued_at),
    CONSTRAINT ck_display_status
        CHECK (status IN ('PENDING', 'CLAIMED', 'DISPATCHED', 'ACKNOWLEDGED', 'REJECTED', 'CANCELLED')),
    CONSTRAINT ck_display_claim
        CHECK ((status = 'CLAIMED') = (claim_until IS NOT NULL)),
    CONSTRAINT ck_display_sendable_payload
        CHECK (status NOT IN ('PENDING', 'CLAIMED', 'DISPATCHED') OR encrypted_payload IS NOT NULL)
);

-- One row per durable unlock command; its message_id never changes across retries (section 8.3). payload holds the
-- minimal command contract only, never a password, user token or MQTT secret.
CREATE TABLE aegis.command_outbox (
    id              uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
    message_id      uuid NOT NULL,
    operation_id    uuid NOT NULL,
    locker_id       uuid NOT NULL,
    compartment_id  uuid NOT NULL,
    command_type    text NOT NULL,
    topic           text NOT NULL,
    schema_version  text NOT NULL,
    issued_at       timestamptz NOT NULL,
    expires_at      timestamptz NOT NULL,
    payload         jsonb NOT NULL,
    status          text NOT NULL DEFAULT 'PENDING',
    attempt_count   integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    claimed_at      timestamptz NULL,
    claim_until     timestamptz NULL,
    published_at    timestamptz NULL,
    acknowledged_at timestamptz NULL,
    last_error      text NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_command_outbox_operation
        FOREIGN KEY (operation_id) REFERENCES aegis.locker_operations (id),
    CONSTRAINT fk_command_outbox_compartment_locker
        FOREIGN KEY (compartment_id, locker_id)
        REFERENCES aegis.compartments (id, locker_id),
    CONSTRAINT uq_command_outbox_message
        UNIQUE (message_id),
    CONSTRAINT uq_command_outbox_operation
        UNIQUE (operation_id),
    CONSTRAINT ck_command_outbox_type
        CHECK (command_type = 'UNLOCK_COMPARTMENT'),
    CONSTRAINT ck_command_outbox_topic_non_blank
        CHECK (btrim(topic) <> ''),
    CONSTRAINT ck_command_outbox_schema_non_blank
        CHECK (btrim(schema_version) <> ''),
    CONSTRAINT ck_command_outbox_dates
        CHECK (expires_at > issued_at),
    CONSTRAINT ck_command_outbox_status
        CHECK (status IN ('PENDING', 'CLAIMED', 'DISPATCHED', 'ACKNOWLEDGED', 'REJECTED', 'CANCELLED')),
    CONSTRAINT ck_command_outbox_attempts
        CHECK (attempt_count >= 0),
    CONSTRAINT ck_command_outbox_claim
        CHECK (
            (status = 'CLAIMED' AND claim_until IS NOT NULL)
            OR
            (status <> 'CLAIMED' AND claim_until IS NULL)
        ),
    CONSTRAINT ck_command_outbox_ack
        CHECK (
            status NOT IN ('ACKNOWLEDGED', 'REJECTED')
            OR (published_at IS NOT NULL AND acknowledged_at IS NOT NULL)
        )
);

-- Section 4.6: one challenge instruction per operation; its retries keep the same message_id and revision.
CREATE UNIQUE INDEX ux_display_one_challenge_per_operation
    ON aegis.hub_display_outbox (operation_id)
    WHERE message_type = 'DISPLAY_ACCESS_CHALLENGE';

-- Section 7.6: before authorization, only the challenge deadline applies, and its expiry ends the operation.
CREATE INDEX ix_local_challenges_pending_expiry
    ON aegis.local_access_challenges (expires_at)
    WHERE status = 'PENDING';

CREATE INDEX ix_display_claimable
    ON aegis.hub_display_outbox (next_attempt_at, created_at)
    WHERE status IN ('PENDING', 'DISPATCHED');

-- Section 9.2: the claim reads PENDING rows and CLAIMED rows whose lease has ended, both within this predicate.
CREATE INDEX ix_command_outbox_claimable
    ON aegis.command_outbox (next_attempt_at, created_at, id)
    WHERE status IN ('PENDING', 'CLAIMED');
