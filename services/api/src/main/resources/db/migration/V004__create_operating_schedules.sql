-- Document 08, sections 4.5 and 5.1: versioned operating schedules of a locker and their daily windows, with the
-- invariant indexes. The read index ix_operating_windows_schedule_day (section 5.2) is created later by V011, as
-- planned in section 11.1.

CREATE TABLE aegis.operating_schedules (
    id                 uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
    locker_id          uuid NOT NULL,
    time_zone          text NOT NULL DEFAULT 'America/Toronto',
    active             boolean NOT NULL DEFAULT true,
    created_by_user_id uuid NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    archived_at        timestamptz NULL,

    CONSTRAINT fk_operating_schedules_locker
        FOREIGN KEY (locker_id) REFERENCES aegis.lockers (id),
    CONSTRAINT fk_operating_schedules_creator
        FOREIGN KEY (created_by_user_id) REFERENCES aegis.users (id),
    CONSTRAINT ck_operating_schedules_timezone
        CHECK (btrim(time_zone) <> ''),
    CONSTRAINT ck_operating_schedules_active_archive
        CHECK (
            (active = true AND archived_at IS NULL)
            OR
            (active = false AND archived_at IS NOT NULL)
        )
);

CREATE TABLE aegis.operating_windows (
    id                    uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
    operating_schedule_id uuid NOT NULL,
    day_of_week           smallint NOT NULL,
    opens_at              time without time zone NULL,
    closes_at             time without time zone NULL,
    enabled               boolean NOT NULL DEFAULT true,

    CONSTRAINT fk_operating_windows_schedule
        FOREIGN KEY (operating_schedule_id) REFERENCES aegis.operating_schedules (id),
    CONSTRAINT ck_operating_windows_day
        CHECK (day_of_week BETWEEN 1 AND 7),
    CONSTRAINT ck_operating_windows_order
        CHECK (
            (enabled = true
                AND opens_at IS NOT NULL
                AND closes_at IS NOT NULL
                AND opens_at < closes_at)
            OR
            (enabled = false
                AND opens_at IS NULL
                AND closes_at IS NULL)
        )
);

CREATE UNIQUE INDEX ux_operating_schedules_one_active_per_locker
    ON aegis.operating_schedules (locker_id)
    WHERE active = true;

CREATE UNIQUE INDEX ux_operating_windows_one_per_day
    ON aegis.operating_windows (operating_schedule_id, day_of_week);
