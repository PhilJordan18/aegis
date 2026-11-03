-- Document 08, sections 4.6, 4.9 and 5.1: locker operations and loans, the chain of custody of P0.
-- The two tables reference each other: loans name their checkout and return operations, and a return operation
-- names its loan. fk_locker_operations_return_loan is therefore added once both tables exist.
-- audit_events.operation_id arrives here with its foreign key and index, as V002_2 announced.
-- Read indexes (section 5.2) are created later by V011, as planned in section 11.1. The application role never
-- deletes an operation or a loan (afterMigrate callback).

CREATE TABLE aegis.locker_operations (
    id                           uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
    type                         text NOT NULL,
    status                       text NOT NULL DEFAULT 'REQUESTED',
    user_id                      uuid NOT NULL,
    asset_id                     uuid NOT NULL,
    locker_id                    uuid NOT NULL,
    compartment_id               uuid NOT NULL,
    reservation_id               uuid NULL,
    loan_id                      uuid NULL,
    expected_asset_identifier_id uuid NOT NULL,
    created_at                   timestamptz NOT NULL DEFAULT now(),
    authorized_at                timestamptz NULL,
    local_proof_validated_at     timestamptz NULL,
    expires_at                   timestamptz NULL,
    command_sent_at              timestamptz NULL,
    acknowledged_at              timestamptz NULL,
    door_opened_at               timestamptz NULL,
    observation_received_at      timestamptz NULL,
    confirmed_at                 timestamptz NULL,
    terminal_at                  timestamptz NULL,
    failure_reason               text NULL,

    CONSTRAINT fk_locker_operations_user
        FOREIGN KEY (user_id) REFERENCES aegis.users (id),
    CONSTRAINT fk_locker_operations_asset
        FOREIGN KEY (asset_id) REFERENCES aegis.assets (id),
    CONSTRAINT fk_locker_operations_compartment_locker
        FOREIGN KEY (compartment_id, locker_id)
        REFERENCES aegis.compartments (id, locker_id),
    CONSTRAINT fk_locker_operations_checkout_reservation
        FOREIGN KEY (reservation_id, asset_id, user_id)
        REFERENCES aegis.reservations (id, asset_id, user_id),
    CONSTRAINT fk_locker_operations_expected_identifier
        FOREIGN KEY (expected_asset_identifier_id, asset_id)
        REFERENCES aegis.asset_identifiers (id, asset_id),
    CONSTRAINT ck_locker_operations_type
        CHECK (type IN ('CHECKOUT', 'RETURN')),
    CONSTRAINT ck_locker_operations_status
        CHECK (status IN (
            'REQUESTED', 'AWAITING_LOCAL_PROOF', 'AUTHORIZED', 'COMMAND_SENT', 'COMMAND_ACKNOWLEDGED',
            'DOOR_OPENED', 'OBSERVATION_RECEIVED', 'CONFIRMED',
            'FAILED', 'EXPIRED', 'ANOMALY'
        )),
    CONSTRAINT ck_locker_operations_source
        CHECK (
            (type = 'CHECKOUT' AND reservation_id IS NOT NULL AND loan_id IS NULL)
            OR
            (type = 'RETURN' AND reservation_id IS NULL AND loan_id IS NOT NULL)
        ),
    CONSTRAINT ck_locker_operations_local_proof
        CHECK (
            (authorized_at IS NULL) = (local_proof_validated_at IS NULL)
            AND (authorized_at IS NULL OR local_proof_validated_at = authorized_at)
            AND (status NOT IN ('REQUESTED', 'AWAITING_LOCAL_PROOF') OR authorized_at IS NULL)
        ),
    CONSTRAINT uq_locker_operations_id_locker UNIQUE (id, locker_id),
    CONSTRAINT ck_locker_operations_authorization_pair
        CHECK ((authorized_at IS NULL) = (expires_at IS NULL)),
    CONSTRAINT ck_locker_operations_expiration
        CHECK (
            expires_at IS NULL
            OR expires_at = authorized_at + interval '120 seconds'
        ),
    CONSTRAINT ck_locker_operations_chronology
        CHECK (
            (authorized_at IS NULL OR authorized_at >= created_at)
            AND (expires_at IS NULL OR expires_at >= authorized_at)
            AND (command_sent_at IS NULL OR authorized_at IS NOT NULL)
            AND (acknowledged_at IS NULL OR command_sent_at IS NOT NULL)
            AND (door_opened_at IS NULL OR acknowledged_at IS NOT NULL)
            AND (observation_received_at IS NULL OR door_opened_at IS NOT NULL)
        ),
    CONSTRAINT ck_locker_operations_status_jalons
        CHECK (
            (status NOT IN ('AUTHORIZED', 'COMMAND_SENT', 'COMMAND_ACKNOWLEDGED', 'DOOR_OPENED', 'OBSERVATION_RECEIVED', 'CONFIRMED') OR authorized_at IS NOT NULL)
            AND (status NOT IN ('COMMAND_SENT', 'COMMAND_ACKNOWLEDGED', 'DOOR_OPENED', 'OBSERVATION_RECEIVED', 'CONFIRMED') OR command_sent_at IS NOT NULL)
            AND (status NOT IN ('COMMAND_ACKNOWLEDGED', 'DOOR_OPENED', 'OBSERVATION_RECEIVED', 'CONFIRMED') OR acknowledged_at IS NOT NULL)
            AND (status NOT IN ('DOOR_OPENED', 'OBSERVATION_RECEIVED', 'CONFIRMED') OR door_opened_at IS NOT NULL)
            AND (status NOT IN ('OBSERVATION_RECEIVED', 'CONFIRMED') OR observation_received_at IS NOT NULL)
        ),
    CONSTRAINT ck_locker_operations_terminal
        CHECK ((status IN ('CONFIRMED', 'FAILED', 'EXPIRED', 'ANOMALY')) = (terminal_at IS NOT NULL)),
    CONSTRAINT ck_locker_operations_confirmation
        CHECK ((status = 'CONFIRMED') = (confirmed_at IS NOT NULL)),
    CONSTRAINT ck_locker_operations_failure_reason
        CHECK ((status IN ('FAILED', 'EXPIRED', 'ANOMALY')) = (failure_reason IS NOT NULL)),
    CONSTRAINT ck_locker_operations_terminal_date
        CHECK (terminal_at IS NULL OR terminal_at >= created_at),
    CONSTRAINT uq_locker_operations_id_asset_user
        UNIQUE (id, asset_id, user_id)
);

-- due_at copies reservations.reserved_until even when the physical confirmation arrives later: a loan may start
-- overdue, so no CHECK compares due_at with checked_out_at (section 4.6).
CREATE TABLE aegis.loans (
    id                    uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
    asset_id              uuid NOT NULL,
    holder_user_id        uuid NOT NULL,
    checkout_operation_id uuid NOT NULL,
    return_operation_id   uuid NULL,
    status                text NOT NULL DEFAULT 'ACTIVE',
    checked_out_at        timestamptz NOT NULL,
    due_at                timestamptz NOT NULL,
    return_requested_at   timestamptz NULL,
    returned_at           timestamptz NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_loans_asset
        FOREIGN KEY (asset_id) REFERENCES aegis.assets (id),
    CONSTRAINT fk_loans_holder
        FOREIGN KEY (holder_user_id) REFERENCES aegis.users (id),
    -- The checkout operation belongs to the loan's asset and holder (decision of 28 October 2026). Its CHECKOUT type
    -- and the coherence of the return operation remain explicit checks of the confirmation services.
    CONSTRAINT fk_loans_checkout_operation
        FOREIGN KEY (checkout_operation_id, asset_id, holder_user_id)
        REFERENCES aegis.locker_operations (id, asset_id, user_id),
    CONSTRAINT fk_loans_return_operation
        FOREIGN KEY (return_operation_id) REFERENCES aegis.locker_operations (id),
    -- Section 7.4: one checkout operation creates at most one loan, even when two confirmations race.
    CONSTRAINT uq_loans_checkout_operation
        UNIQUE (checkout_operation_id),
    CONSTRAINT ck_loans_status
        CHECK (status IN ('ACTIVE', 'RETURN_PENDING', 'COMPLETED')),
    CONSTRAINT ck_loans_dates
        CHECK (
            (return_requested_at IS NULL OR return_requested_at >= checked_out_at)
            AND (returned_at IS NULL OR returned_at >= checked_out_at)
        ),
    CONSTRAINT ck_loans_status_effects
        CHECK (
            (status = 'ACTIVE' AND returned_at IS NULL AND return_operation_id IS NULL)
            OR
            (status = 'RETURN_PENDING' AND return_requested_at IS NOT NULL AND returned_at IS NULL AND return_operation_id IS NULL)
            OR
            (status = 'COMPLETED' AND return_requested_at IS NOT NULL AND returned_at IS NOT NULL AND return_operation_id IS NOT NULL)
        ),
    CONSTRAINT ck_loans_return_operation_distinct
        CHECK (return_operation_id IS NULL OR return_operation_id <> checkout_operation_id),
    CONSTRAINT uq_loans_id_asset_holder
        UNIQUE (id, asset_id, holder_user_id)
);

-- A return operation belongs to the loan's asset and to its holder.
ALTER TABLE aegis.locker_operations
    ADD CONSTRAINT fk_locker_operations_return_loan
        FOREIGN KEY (loan_id, asset_id, user_id)
        REFERENCES aegis.loans (id, asset_id, holder_user_id);

CREATE UNIQUE INDEX ux_loans_one_open_per_asset
    ON aegis.loans (asset_id)
    WHERE status IN ('ACTIVE', 'RETURN_PENDING');

-- Every non-terminal status, AWAITING_LOCAL_PROOF included: a pending QR challenge holds the locker too.
CREATE UNIQUE INDEX ux_locker_operations_one_open_per_locker
    ON aegis.locker_operations (locker_id)
    WHERE status IN (
        'REQUESTED', 'AWAITING_LOCAL_PROOF', 'AUTHORIZED', 'COMMAND_SENT',
        'COMMAND_ACKNOWLEDGED', 'DOOR_OPENED', 'OBSERVATION_RECEIVED'
    );

-- No trigger fires: adding a nullable column without default rewrites no row of the append-only table, and the
-- foreign key validation only reads. Existing events keep a null operation; none is backfilled.
ALTER TABLE aegis.audit_events
    ADD COLUMN operation_id uuid NULL,
    ADD CONSTRAINT fk_audit_events_operation
        FOREIGN KEY (operation_id) REFERENCES aegis.locker_operations (id);

CREATE INDEX ix_audit_events_operation_time
    ON aegis.audit_events (operation_id, occurred_at)
    WHERE operation_id IS NOT NULL;
