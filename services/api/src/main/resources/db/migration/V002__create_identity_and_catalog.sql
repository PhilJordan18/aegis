-- Document 08, sections 4.2, 4.3 and 5.1: identity and catalog tables with their invariant indexes.
-- Read indexes are created later by V011, as planned in section 11.1.

CREATE TABLE aegis.users (
    id                    uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
    display_name          text NOT NULL,
    email                 text NOT NULL,
    password_hash         text NOT NULL,
    role                  text NOT NULL,
    maximum_access_level  text NOT NULL,
    status                text NOT NULL DEFAULT 'ACTIVE',
    created_at            timestamptz NOT NULL DEFAULT now(),
    archived_at           timestamptz NULL,

    CONSTRAINT ck_users_display_name_non_blank
        CHECK (btrim(display_name) <> ''),
    CONSTRAINT ck_users_email_non_blank
        CHECK (btrim(email) <> '' AND email = btrim(email)),
    CONSTRAINT ck_users_password_hash_non_blank
        CHECK (btrim(password_hash) <> ''),
    CONSTRAINT ck_users_role
        CHECK (role IN ('ADMIN', 'TECHNICIAN')),
    CONSTRAINT ck_users_access_level
        CHECK (maximum_access_level IN ('STANDARD', 'RESTRICTED')),
    CONSTRAINT ck_users_status
        CHECK (status IN ('ACTIVE', 'DISABLED')),
    CONSTRAINT ck_users_archived_disabled
        CHECK (archived_at IS NULL OR status = 'DISABLED')
);

CREATE TABLE aegis.asset_models (
    id                          uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
    name                        text NOT NULL,
    manufacturer                text NULL,
    model_number                text NULL,
    description                 text NULL,
    default_calibration_required boolean NOT NULL DEFAULT false,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),
    archived_at                 timestamptz NULL,

    CONSTRAINT ck_asset_models_name_non_blank
        CHECK (btrim(name) <> '')
);

CREATE TABLE aegis.assets (
    id                    uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
    asset_model_id        uuid NOT NULL,
    asset_code            text NOT NULL,
    serial_number         text NULL,
    required_access_level text NOT NULL,
    operational_status    text NOT NULL DEFAULT 'SERVICEABLE',
    calibration_required  boolean NOT NULL,
    calibration_due_at    timestamptz NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    archived_at           timestamptz NULL,

    CONSTRAINT fk_assets_asset_model
        FOREIGN KEY (asset_model_id) REFERENCES aegis.asset_models (id),
    CONSTRAINT ck_assets_code_non_blank
        CHECK (btrim(asset_code) <> ''),
    CONSTRAINT ck_assets_access_level
        CHECK (required_access_level IN ('STANDARD', 'RESTRICTED')),
    CONSTRAINT ck_assets_operational_status
        CHECK (operational_status IN ('SERVICEABLE', 'MAINTENANCE', 'DAMAGED')),
    CONSTRAINT ck_assets_calibration_pair
        CHECK (
            (calibration_required = false AND calibration_due_at IS NULL)
            OR
            (calibration_required = true AND calibration_due_at IS NOT NULL)
        )
);

CREATE TABLE aegis.asset_identifiers (
    id               uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
    asset_id         uuid NOT NULL,
    identifier_type  text NOT NULL,
    identifier_value text NOT NULL,
    active           boolean NOT NULL DEFAULT true,
    assigned_at      timestamptz NOT NULL DEFAULT now(),
    revoked_at       timestamptz NULL,

    CONSTRAINT fk_asset_identifiers_asset
        FOREIGN KEY (asset_id) REFERENCES aegis.assets (id),
    CONSTRAINT ck_asset_identifiers_type
        CHECK (identifier_type IN ('RFID_UHF', 'NFC', 'QR')),
    CONSTRAINT ck_asset_identifiers_value_non_blank
        CHECK (btrim(identifier_value) <> ''),
    CONSTRAINT ck_asset_identifiers_lifecycle
        CHECK (
            (active = true AND revoked_at IS NULL)
            OR
            (active = false AND revoked_at IS NOT NULL)
        ),
    CONSTRAINT ck_asset_identifiers_dates
        CHECK (revoked_at IS NULL OR revoked_at >= assigned_at),
    CONSTRAINT uq_asset_identifiers_id_asset
        UNIQUE (id, asset_id)
);

CREATE UNIQUE INDEX ux_users_email_ci
    ON aegis.users (lower(email));

CREATE UNIQUE INDEX ux_asset_models_name_ci
    ON aegis.asset_models (lower(name))
    WHERE archived_at IS NULL;

CREATE UNIQUE INDEX ux_assets_code_ci
    ON aegis.assets (lower(asset_code));

CREATE UNIQUE INDEX ux_assets_serial_number
    ON aegis.assets (serial_number)
    WHERE serial_number IS NOT NULL;

CREATE UNIQUE INDEX ux_asset_identifiers_active_value
    ON aegis.asset_identifiers (identifier_type, identifier_value)
    WHERE active = true;
