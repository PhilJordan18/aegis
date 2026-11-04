-- Document 08, sections 4.9 and 5.1: the anomalies of the physical chain. audit_events moved to V002_2; no
-- migration is renumbered. The invariant index ux_anomalies_one_open_per_operation is created with its table, as
-- V005 to V007 do, so that the table never exists without it; the read indexes of section 5.2 are created later by
-- V011. The application role never deletes an anomaly (afterMigrate callback).

-- An active anomaly is resolved only by a resolution observation; ACKNOWLEDGED means recognized, never corrected.
CREATE TABLE aegis.anomalies (
    id                               uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
    type                             text NOT NULL,
    severity                         text NOT NULL,
    status                           text NOT NULL DEFAULT 'OPEN',
    locker_operation_id              uuid NULL,
    asset_id                         uuid NULL,
    compartment_id                   uuid NULL,
    detected_at                      timestamptz NOT NULL DEFAULT now(),
    acknowledged_at                  timestamptz NULL,
    acknowledged_by_user_id          uuid NULL,
    acknowledgement_note             text NULL,
    resolved_at                      timestamptz NULL,
    resolution_evidence_observation_id uuid NULL,
    resolution_note                  text NULL,
    details                          jsonb NOT NULL DEFAULT '{}'::jsonb,

    CONSTRAINT fk_anomalies_operation
        FOREIGN KEY (locker_operation_id) REFERENCES aegis.locker_operations (id),
    CONSTRAINT fk_anomalies_asset
        FOREIGN KEY (asset_id) REFERENCES aegis.assets (id),
    CONSTRAINT fk_anomalies_compartment
        FOREIGN KEY (compartment_id) REFERENCES aegis.compartments (id),
    CONSTRAINT fk_anomalies_acknowledger
        FOREIGN KEY (acknowledged_by_user_id) REFERENCES aegis.users (id),
    CONSTRAINT fk_anomalies_resolution_observation
        FOREIGN KEY (resolution_evidence_observation_id) REFERENCES aegis.physical_observations (id),
    CONSTRAINT ck_anomalies_type
        CHECK (type IN (
            'EXPECTED_ASSET_NOT_OBSERVED', 'UNEXPECTED_ASSET_OBSERVED',
            'ASSET_PRESENT_WITH_ACTIVE_LOAN',
            'DOOR_NOT_CLOSED_BEFORE_EXPIRY', 'COMMAND_REJECTED',
            'DEVICE_OFFLINE_DURING_OPERATION', 'INCONSISTENT_PHYSICAL_STATE'
        )),
    CONSTRAINT ck_anomalies_severity
        CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
    CONSTRAINT ck_anomalies_status
        CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
    CONSTRAINT ck_anomalies_acknowledgement_note
        CHECK (acknowledgement_note IS NULL OR btrim(acknowledgement_note) <> ''),
    CONSTRAINT ck_anomalies_resolution_note
        CHECK (resolution_note IS NULL OR btrim(resolution_note) <> ''),
    CONSTRAINT ck_anomalies_lifecycle
        CHECK (
            (status = 'OPEN'
                AND acknowledged_at IS NULL
                AND acknowledged_by_user_id IS NULL
                AND acknowledgement_note IS NULL
                AND resolved_at IS NULL
                AND resolution_evidence_observation_id IS NULL
                AND resolution_note IS NULL)
            OR
            (status = 'ACKNOWLEDGED'
                AND acknowledged_at IS NOT NULL
                AND acknowledged_by_user_id IS NOT NULL
                AND acknowledgement_note IS NOT NULL
                AND btrim(acknowledgement_note) <> ''
                AND resolved_at IS NULL
                AND resolution_evidence_observation_id IS NULL
                AND resolution_note IS NULL)
            OR
            (status = 'RESOLVED'
                AND resolved_at IS NOT NULL
                AND resolution_evidence_observation_id IS NOT NULL
                AND resolution_note IS NOT NULL
                AND btrim(resolution_note) <> ''
                AND (
                    num_nonnulls(acknowledged_at, acknowledged_by_user_id, acknowledgement_note) = 0
                    OR num_nonnulls(acknowledged_at, acknowledged_by_user_id, acknowledgement_note) = 3
                ))
        ),
    CONSTRAINT ck_anomalies_dates
        CHECK (
            (acknowledged_at IS NULL OR acknowledged_at >= detected_at)
            AND (resolved_at IS NULL OR resolved_at >= detected_at)
        )
);

-- Section 5.1, invariant 5: an operation never accumulates two concurrent active anomalies, even when two
-- transactions pass the application check at the same time. A resolved anomaly frees the operation.
CREATE UNIQUE INDEX ux_anomalies_one_open_per_operation
    ON aegis.anomalies (locker_operation_id)
    WHERE locker_operation_id IS NOT NULL
      AND status IN ('OPEN', 'ACKNOWLEDGED');
