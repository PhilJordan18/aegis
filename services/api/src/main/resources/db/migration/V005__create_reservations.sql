-- Document 08, sections 4.6 and 5.1: reservations with their lifecycle guards and the two active-uniqueness
-- indexes, the final barrier when two transactions pass the application check at the same time (section 7.2).
-- The read indexes ix_reservations_active_until and ix_reservations_user_status (section 5.2) are created later by
-- V011, as planned in section 11.1. The application role never deletes a reservation (afterMigrate callback).

CREATE TABLE aegis.reservations (
    id             uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
    asset_id       uuid NOT NULL,
    user_id        uuid NOT NULL,
    status         text NOT NULL DEFAULT 'ACTIVE',
    reserved_from  timestamptz NOT NULL,
    reserved_until timestamptz NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    cancelled_at   timestamptz NULL,
    fulfilled_at   timestamptz NULL,
    expired_at     timestamptz NULL,

    CONSTRAINT fk_reservations_asset
        FOREIGN KEY (asset_id) REFERENCES aegis.assets (id),
    CONSTRAINT fk_reservations_user
        FOREIGN KEY (user_id) REFERENCES aegis.users (id),
    CONSTRAINT ck_reservations_status
        CHECK (status IN ('ACTIVE', 'FULFILLED', 'CANCELLED', 'EXPIRED')),
    CONSTRAINT ck_reservations_interval
        CHECK (reserved_from < reserved_until),
    CONSTRAINT ck_reservations_terminal_date
        CHECK (
            (status = 'ACTIVE' AND num_nonnulls(cancelled_at, fulfilled_at, expired_at) = 0)
            OR
            (status = 'FULFILLED' AND num_nonnulls(cancelled_at, fulfilled_at, expired_at) = 1 AND fulfilled_at IS NOT NULL)
            OR
            (status = 'CANCELLED' AND num_nonnulls(cancelled_at, fulfilled_at, expired_at) = 1 AND cancelled_at IS NOT NULL)
            OR
            (status = 'EXPIRED' AND num_nonnulls(cancelled_at, fulfilled_at, expired_at) = 1 AND expired_at IS NOT NULL)
        ),
    CONSTRAINT ck_reservations_dates_after_creation
        CHECK (
            (cancelled_at IS NULL OR cancelled_at >= created_at)
            AND (fulfilled_at IS NULL OR fulfilled_at >= created_at)
            AND (expired_at IS NULL OR expired_at >= created_at)
        ),
    -- Target of fk_locker_operations_checkout_reservation (V006): a checkout belongs to the reserved asset and user.
    CONSTRAINT uq_reservations_id_asset_user
        UNIQUE (id, asset_id, user_id)
);

CREATE UNIQUE INDEX ux_reservations_one_active_per_asset
    ON aegis.reservations (asset_id)
    WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX ux_reservations_one_active_per_user
    ON aegis.reservations (user_id)
    WHERE status = 'ACTIVE';
