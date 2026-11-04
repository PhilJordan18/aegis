-- Document 08, sections 4.8, 4.9 and 8.2: the inbound device messages, their normalized physical observations, and
-- the two audit references announced by V002_2. One canonical row per (locker_device_id, message_id): a duplicate
-- delivery conflicts on uq_inbound_messages_device_message and produces no observation or transition.
-- Section 11.1 places no index in V008 beyond the constraints: the read indexes of section 5.2 are created later by
-- V011. The application role never deletes an inbound message and only appends observations (afterMigrate callback).

-- The envelope columns are extracted from the accepted payload (document 10, section 15.3) and stay null for a
-- message rejected before their extraction; raw_payload keeps the bytes as received.
CREATE TABLE aegis.inbound_device_messages (
    id                uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
    locker_device_id  uuid NOT NULL,
    message_id        uuid NOT NULL,
    topic             text NOT NULL,
    message_type      text NOT NULL,
    operation_id      uuid NULL,
    command_message_id uuid NULL,
    display_message_id uuid NULL,
    schema_version    text NOT NULL,
    device_session_id uuid NULL,
    boot_count        bigint NULL,
    sequence          bigint NULL,
    connection_id     uuid NULL,
    availability_status text NULL,
    occurred_at       timestamptz NOT NULL,
    received_at       timestamptz NOT NULL DEFAULT now(),
    raw_payload       bytea NOT NULL,
    parsed_payload    jsonb NULL,
    processing_status text NOT NULL DEFAULT 'RECEIVED',
    processing_error  text NULL,

    CONSTRAINT fk_inbound_messages_device
        FOREIGN KEY (locker_device_id) REFERENCES aegis.locker_devices (id),
    CONSTRAINT fk_inbound_messages_operation
        FOREIGN KEY (operation_id) REFERENCES aegis.locker_operations (id),
    CONSTRAINT fk_inbound_messages_command
        FOREIGN KEY (command_message_id) REFERENCES aegis.command_outbox (message_id),
    CONSTRAINT fk_inbound_messages_display
        FOREIGN KEY (display_message_id) REFERENCES aegis.hub_display_outbox (message_id),
    CONSTRAINT ck_inbound_messages_display_correlation
        CHECK (
            (message_type IN ('ACCESS_CHALLENGE_DISPLAYED', 'DISPLAY_REJECTED') AND display_message_id IS NOT NULL AND operation_id IS NOT NULL)
            OR (message_type NOT IN ('ACCESS_CHALLENGE_DISPLAYED', 'DISPLAY_REJECTED') AND display_message_id IS NULL)
        ),
    CONSTRAINT uq_inbound_messages_device_message
        UNIQUE (locker_device_id, message_id),
    CONSTRAINT ck_inbound_messages_topic_non_blank
        CHECK (btrim(topic) <> ''),
    CONSTRAINT ck_inbound_messages_type
        CHECK (message_type IN (
            'HEARTBEAT', 'DEVICE_AVAILABILITY',
            'ACCESS_CHALLENGE_DISPLAYED', 'DISPLAY_REJECTED',
            'COMMAND_ACKNOWLEDGED', 'COMMAND_REJECTED',
            'DOOR_OPENED', 'DOOR_CLOSED', 'LOCK_UNLOCKED', 'LOCK_LOCKED',
            'RFID_SCAN_COMPLETED',
            'DEVICE_RESTARTED', 'DEVICE_ERROR'
        )),
    CONSTRAINT ck_inbound_messages_schema_non_blank
        CHECK (btrim(schema_version) <> ''),
    CONSTRAINT ck_inbound_messages_status
        CHECK (processing_status IN ('RECEIVED', 'PROCESSED', 'REJECTED')),
    CONSTRAINT ck_inbound_messages_status_without_operation
        CHECK (
            message_type NOT IN ('HEARTBEAT', 'DEVICE_AVAILABILITY')
            OR operation_id IS NULL
        ),
    CONSTRAINT ck_inbound_messages_command_correlation
        CHECK (
            (message_type IN ('COMMAND_ACKNOWLEDGED', 'COMMAND_REJECTED')
                AND command_message_id IS NOT NULL)
            OR
            (message_type NOT IN ('COMMAND_ACKNOWLEDGED', 'COMMAND_REJECTED')
                AND command_message_id IS NULL)
        ),
    CONSTRAINT ck_inbound_messages_error
        CHECK (processing_status <> 'REJECTED' OR processing_error IS NOT NULL),
    CONSTRAINT ck_inbound_messages_boot_count
        CHECK (boot_count IS NULL OR boot_count BETWEEN 1 AND 4294967295),
    CONSTRAINT ck_inbound_messages_sequence
        CHECK (sequence IS NULL OR sequence >= 0),
    CONSTRAINT ck_inbound_messages_accepted_envelope
        CHECK (
            processing_status = 'REJECTED'
            OR (device_session_id IS NOT NULL AND boot_count IS NOT NULL AND sequence IS NOT NULL)
        ),
    CONSTRAINT ck_inbound_messages_connection
        CHECK (
            (message_type IN ('HEARTBEAT', 'DEVICE_AVAILABILITY')
                AND (connection_id IS NOT NULL OR processing_status = 'REJECTED'))
            OR (message_type NOT IN ('HEARTBEAT', 'DEVICE_AVAILABILITY') AND connection_id IS NULL)
        ),
    CONSTRAINT ck_inbound_messages_availability_status
        CHECK (
            (message_type = 'DEVICE_AVAILABILITY'
                AND ((availability_status IS NOT NULL AND availability_status IN ('ONLINE', 'OFFLINE'))
                    OR (availability_status IS NULL AND processing_status = 'REJECTED')))
            OR (message_type <> 'DEVICE_AVAILABILITY' AND availability_status IS NULL)
        )
);

-- A fact normalized from a valid message; value_json carries a boolean, text or numeric value without tying the
-- domain to a detection technology. Observations are immutable once recorded.
CREATE TABLE aegis.physical_observations (
    id                 uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
    inbound_message_id uuid NOT NULL,
    locker_id          uuid NOT NULL,
    compartment_id     uuid NULL,
    operation_id       uuid NULL,
    type               text NOT NULL,
    observed_at        timestamptz NOT NULL,
    identifier_value   text NULL,
    value_json         jsonb NULL,
    confidence         numeric(5,4) NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_physical_observations_message
        FOREIGN KEY (inbound_message_id) REFERENCES aegis.inbound_device_messages (id),
    CONSTRAINT fk_physical_observations_compartment_locker
        FOREIGN KEY (compartment_id, locker_id)
        REFERENCES aegis.compartments (id, locker_id),
    CONSTRAINT fk_physical_observations_operation
        FOREIGN KEY (operation_id) REFERENCES aegis.locker_operations (id),
    CONSTRAINT ck_physical_observations_type
        CHECK (type IN (
            'DOOR_OPENED', 'DOOR_CLOSED', 'LOCK_UNLOCKED', 'LOCK_LOCKED',
            'ASSET_PRESENT', 'ASSET_ABSENT', 'ASSET_IDENTIFIER_DETECTED',
            'DEVICE_RESTARTED'
        )),
    CONSTRAINT ck_physical_observations_compartment
        CHECK (
            type = 'DEVICE_RESTARTED'
            OR compartment_id IS NOT NULL
        ),
    CONSTRAINT ck_physical_observations_identifier
        CHECK (
            type <> 'ASSET_IDENTIFIER_DETECTED'
            OR identifier_value IS NOT NULL
        ),
    CONSTRAINT ck_physical_observations_confidence
        CHECK (confidence IS NULL OR confidence BETWEEN 0.0000 AND 1.0000)
);

-- No trigger fires: adding nullable columns without default rewrites no row of the append-only table, and the
-- foreign key validation only reads. Existing events keep null references; none is backfilled.
ALTER TABLE aegis.audit_events
    ADD COLUMN inbound_message_id uuid NULL,
    ADD COLUMN physical_observation_id uuid NULL,
    ADD CONSTRAINT fk_audit_events_message
        FOREIGN KEY (inbound_message_id) REFERENCES aegis.inbound_device_messages (id),
    ADD CONSTRAINT fk_audit_events_observation
        FOREIGN KEY (physical_observation_id) REFERENCES aegis.physical_observations (id);
