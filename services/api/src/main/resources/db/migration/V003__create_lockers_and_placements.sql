-- Document 08, sections 4.4 and 5.1: lockers, compartments, devices and expected placements with their
-- invariant indexes. Read indexes are created later by V011, as planned in section 11.1.

CREATE TABLE aegis.lockers (
    id            uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
    code          text NOT NULL,
    name          text NOT NULL,
    topology      text NOT NULL,
    display_revision bigint NOT NULL DEFAULT 0 CHECK (display_revision >= 0),
    status        text NOT NULL DEFAULT 'UNKNOWN',
    last_seen_at  timestamptz NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ck_lockers_code_non_blank
        CHECK (btrim(code) <> ''),
    CONSTRAINT ck_lockers_name_non_blank
        CHECK (btrim(name) <> ''),
    CONSTRAINT ck_lockers_topology
        CHECK (topology IN ('MONOLITHIC', 'HUB_CELL')),
    CONSTRAINT ck_lockers_status
        CHECK (status IN ('ONLINE', 'OFFLINE', 'UNKNOWN'))
);

CREATE TABLE aegis.compartments (
    id                   uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
    locker_id            uuid NOT NULL,
    code                 text NOT NULL,
    local_address        smallint NOT NULL,
    hub_port             smallint NOT NULL CHECK (hub_port > 0),
    enabled              boolean NOT NULL DEFAULT true,
    connection_status    text NOT NULL DEFAULT 'UNKNOWN',
    rfid_reader_status   text NOT NULL DEFAULT 'UNKNOWN',
    door_state           text NOT NULL DEFAULT 'UNKNOWN',
    lock_state           text NOT NULL DEFAULT 'UNKNOWN',
    last_observed_at     timestamptz NULL,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_compartments_locker
        FOREIGN KEY (locker_id) REFERENCES aegis.lockers (id),
    CONSTRAINT ck_compartments_code_non_blank
        CHECK (btrim(code) <> ''),
    CONSTRAINT ck_compartments_local_address
        CHECK (local_address BETWEEN 1 AND 247),
    CONSTRAINT ck_compartments_connection_status
        CHECK (connection_status IN ('CONNECTED', 'DISCONNECTED', 'UNKNOWN')),
    CONSTRAINT ck_compartments_reader_status
        CHECK (rfid_reader_status IN ('HEALTHY', 'FAULTED', 'UNKNOWN')),
    CONSTRAINT ck_compartments_door_state
        CHECK (door_state IN ('OPEN', 'CLOSED', 'UNKNOWN')),
    CONSTRAINT ck_compartments_lock_state
        CHECK (lock_state IN ('LOCKED', 'UNLOCKED', 'UNKNOWN')),
    CONSTRAINT uq_compartments_hub_port UNIQUE (locker_id, hub_port),
    CONSTRAINT uq_compartments_id_locker
        UNIQUE (id, locker_id)
);

CREATE TABLE aegis.locker_devices (
    id                 uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
    locker_id          uuid NOT NULL,
    device_key         text NOT NULL,
    device_session_id  uuid NULL,
    boot_count         bigint NULL,
    provisioned_at     timestamptz NOT NULL DEFAULT now(),
    heartbeat_connection_id uuid NULL,
    heartbeat_sequence bigint NULL,
    last_valid_heartbeat_at timestamptz NULL,
    heartbeat_connection_closed_at timestamptz NULL,
    first_valid_heartbeat_at timestamptz NULL,
    firmware_version   text NOT NULL,
    connection_status  text NOT NULL DEFAULT 'UNKNOWN',
    last_seen_at       timestamptz NULL,
    registered_at      timestamptz NOT NULL DEFAULT now(),
    disabled_at        timestamptz NULL,
    updated_at         timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_locker_devices_id_locker UNIQUE (id, locker_id),
    CONSTRAINT fk_locker_devices_locker
        FOREIGN KEY (locker_id) REFERENCES aegis.lockers (id),
    CONSTRAINT ck_locker_devices_key_non_blank
        CHECK (btrim(device_key) <> ''),
    CONSTRAINT ck_locker_devices_firmware_non_blank
        CHECK (btrim(firmware_version) <> ''),
    CONSTRAINT ck_locker_devices_connection_status
        CHECK (connection_status IN ('ONLINE', 'OFFLINE', 'UNKNOWN')),
    CONSTRAINT ck_locker_devices_boot_count
        CHECK (boot_count IS NULL OR boot_count BETWEEN 1 AND 4294967295),
    CONSTRAINT ck_locker_devices_session_pair
        CHECK ((device_session_id IS NULL) = (boot_count IS NULL)),
    CONSTRAINT ck_locker_devices_heartbeat_reference
        CHECK (
            (heartbeat_connection_id IS NULL
                AND heartbeat_sequence IS NULL
                AND last_valid_heartbeat_at IS NULL
                AND heartbeat_connection_closed_at IS NULL)
            OR
            (heartbeat_connection_id IS NOT NULL
                AND heartbeat_sequence IS NOT NULL
                AND heartbeat_sequence >= 0
                AND last_valid_heartbeat_at IS NOT NULL
                AND boot_count IS NOT NULL
                AND first_valid_heartbeat_at IS NOT NULL)
        )
);

CREATE TABLE aegis.asset_placements (
    id             uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
    asset_id       uuid NOT NULL,
    compartment_id uuid NOT NULL,
    assigned_at    timestamptz NOT NULL DEFAULT now(),
    removed_at     timestamptz NULL,
    reason         text NOT NULL,

    CONSTRAINT fk_asset_placements_asset
        FOREIGN KEY (asset_id) REFERENCES aegis.assets (id),
    CONSTRAINT fk_asset_placements_compartment
        FOREIGN KEY (compartment_id) REFERENCES aegis.compartments (id),
    CONSTRAINT ck_asset_placements_reason_non_blank
        CHECK (btrim(reason) <> ''),
    CONSTRAINT ck_asset_placements_dates
        CHECK (removed_at IS NULL OR removed_at >= assigned_at)
);

CREATE UNIQUE INDEX ux_lockers_code_ci
    ON aegis.lockers (lower(code));

CREATE UNIQUE INDEX ux_compartments_locker_code
    ON aegis.compartments (locker_id, code);

CREATE UNIQUE INDEX ux_compartments_locker_address
    ON aegis.compartments (locker_id, local_address);

CREATE UNIQUE INDEX ux_locker_devices_device_key
    ON aegis.locker_devices (device_key);

CREATE UNIQUE INDEX ux_locker_devices_one_active_per_locker
    ON aegis.locker_devices (locker_id)
    WHERE disabled_at IS NULL;

CREATE UNIQUE INDEX ux_asset_placements_one_current_per_asset
    ON aegis.asset_placements (asset_id)
    WHERE removed_at IS NULL;

CREATE UNIQUE INDEX ux_asset_placements_one_current_per_compartment
    ON aegis.asset_placements (compartment_id)
    WHERE removed_at IS NULL;

-- CAT-02, decided on 28 October 2026: an asset carries at most one active identifier of each type.
CREATE UNIQUE INDEX ux_asset_identifiers_one_active_per_type
    ON aegis.asset_identifiers (asset_id, identifier_type)
    WHERE active = true;
