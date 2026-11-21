-- SYNTHETIC acceptance fixtures for the Manager administrative reads (#48, #52, #53).
--
-- These rows are NOT produced by a business flow. They stand in for the physical checkout and return chain
-- (#43-#47, #51), which does not exist yet, so the read routes of document 09, sections 17 to 19, can be
-- verified on realistic states. They never close those full-stack stories.
--
-- How to recognize them:
--   * every primary key starts with 5eed0000-;
--   * asset codes start with SYN-, the synthetic user's email ends with @synthetic.invalid;
--   * jsonb details carry "synthetic": true.
-- QA-RAW-SENTINEL and QA-SECRET-SENTINEL are planted in raw payloads, parsed payloads and details. No API
-- response may ever contain them (document 09, sections 18.1 and 19.1).
--
-- Preconditions: Flyway migrated, the demo accounts and the demo locker provisioned
-- (AEGIS_DEMO_ACCOUNTS_ENABLED=true, AEGIS_DEMO_LOCKER_ENABLED=true). It runs in one transaction, as the
-- schema owner, and fails if any of it already exists. Times are relative to now() so the overdue loan is
-- always overdue and the active loan never is.

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE qa_ctx ON COMMIT DROP AS
SELECT
    (SELECT id FROM aegis.users WHERE lower(email) = 'admin@aegis.demo') AS admin_id,
    (SELECT id FROM aegis.users WHERE lower(email) = 'technician@aegis.demo') AS tech_id,
    'd46a74ae-39dc-460b-8af0-38fc791b376a'::uuid AS locker_id,
    '1ae77ae3-8490-4f09-9412-a7816b77bff9'::uuid AS a1,
    '5c1d0b7e-2f4a-4d3b-9a61-0e8b7c2d4f10'::uuid AS a2,
    (SELECT id FROM aegis.locker_devices WHERE locker_id = 'd46a74ae-39dc-460b-8af0-38fc791b376a') AS device_id,
    date_trunc('second', now()) AS t0;

DO $$
BEGIN
    IF (SELECT admin_id IS NULL OR tech_id IS NULL OR device_id IS NULL FROM qa_ctx) THEN
        RAISE EXCEPTION 'demo accounts and demo locker must be provisioned before the synthetic seed';
    END IF;
END $$;

-- A second technician, so userId filters have something to exclude. It cannot sign in.
INSERT INTO aegis.users (id, display_name, email, password_hash, role, maximum_access_level)
VALUES ('5eed0000-0000-4000-8000-000000000101', 'Technicien synthétique B', 'tech-b@synthetic.invalid',
        '!synthetic-account-without-password', 'TECHNICIAN', 'STANDARD');

INSERT INTO aegis.asset_models (id, name, manufacturer, model_number, description, default_calibration_required)
VALUES ('5eed0000-0000-4000-8000-000000000201', 'SYN Oscilloscope', 'Synthetic', 'SYN-1',
        'Modèle synthétique de la recette Manager', false);

INSERT INTO aegis.assets (id, asset_model_id, asset_code, serial_number, required_access_level, calibration_required)
VALUES
    ('5eed0000-0000-4000-8000-000000000301', '5eed0000-0000-4000-8000-000000000201', 'SYN-LOAN-ACTIVE', 'SYN-SN-301', 'STANDARD', false),
    ('5eed0000-0000-4000-8000-000000000302', '5eed0000-0000-4000-8000-000000000201', 'SYN-LOAN-OVERDUE', 'SYN-SN-302', 'STANDARD', false),
    ('5eed0000-0000-4000-8000-000000000303', '5eed0000-0000-4000-8000-000000000201', 'SYN-LOAN-DONE', 'SYN-SN-303', 'STANDARD', false),
    ('5eed0000-0000-4000-8000-000000000304', '5eed0000-0000-4000-8000-000000000201', 'SYN-ANOM-OPEN', 'SYN-SN-304', 'STANDARD', false),
    ('5eed0000-0000-4000-8000-000000000305', '5eed0000-0000-4000-8000-000000000201', 'SYN-ANOM-ACK', 'SYN-SN-305', 'STANDARD', false),
    ('5eed0000-0000-4000-8000-000000000306', '5eed0000-0000-4000-8000-000000000201', 'SYN-ANOM-TARGET', 'SYN-SN-306', 'STANDARD', false),
    ('5eed0000-0000-4000-8000-000000000307', '5eed0000-0000-4000-8000-000000000201', 'SYN-OP-FAILED', 'SYN-SN-307', 'STANDARD', false),
    ('5eed0000-0000-4000-8000-000000000308', '5eed0000-0000-4000-8000-000000000201', 'SYN-ANOM-RESOLVED', 'SYN-SN-308', 'STANDARD', false);

-- One active RFID identifier per synthetic asset: operations require the expected identifier.
INSERT INTO aegis.asset_identifiers (id, asset_id, identifier_type, identifier_value)
SELECT ('5eed0000-0000-4000-8000-000000000' || (400 + n)::text)::uuid,
       ('5eed0000-0000-4000-8000-000000000' || (300 + n)::text)::uuid,
       'RFID_UHF', 'E2005EED00000000000003' || lpad(n::text, 2, '0')
FROM generate_series(1, 8) AS n;

-- Reservations behind the checkouts, all terminal.
INSERT INTO aegis.reservations (id, asset_id, user_id, status, reserved_from, reserved_until, created_at,
                                fulfilled_at, expired_at)
SELECT r.id, r.asset_id, c.tech_id, r.status, c.t0 + r.from_offset, c.t0 + r.from_offset + interval '2 hours',
       c.t0 + r.from_offset,
       CASE WHEN r.status = 'FULFILLED' THEN c.t0 + r.from_offset + interval '10 minutes' END,
       CASE WHEN r.status = 'EXPIRED' THEN c.t0 + r.from_offset + interval '2 hours' END
FROM qa_ctx c, (VALUES
    ('5eed0000-0000-4000-8000-000000000501'::uuid, '5eed0000-0000-4000-8000-000000000301'::uuid, 'FULFILLED', interval '-2 days'),
    ('5eed0000-0000-4000-8000-000000000502'::uuid, '5eed0000-0000-4000-8000-000000000302'::uuid, 'FULFILLED', interval '-9 days'),
    ('5eed0000-0000-4000-8000-000000000503'::uuid, '5eed0000-0000-4000-8000-000000000303'::uuid, 'FULFILLED', interval '-6 days'),
    ('5eed0000-0000-4000-8000-000000000504'::uuid, '5eed0000-0000-4000-8000-000000000304'::uuid, 'EXPIRED', interval '-1 day'),
    ('5eed0000-0000-4000-8000-000000000505'::uuid, '5eed0000-0000-4000-8000-000000000305'::uuid, 'EXPIRED', interval '-3 days'),
    ('5eed0000-0000-4000-8000-000000000507'::uuid, '5eed0000-0000-4000-8000-000000000307'::uuid, 'EXPIRED', interval '-4 days'),
    ('5eed0000-0000-4000-8000-000000000508'::uuid, '5eed0000-0000-4000-8000-000000000308'::uuid, 'EXPIRED', interval '-5 days')
) AS r(id, asset_id, status, from_offset);

-- Checkout operations (CHECKOUT needs a reservation) and the return of the completed loan.
-- Every operation is terminal, so the one-open-operation-per-locker rule never blocks the real flow.
CREATE TEMP TABLE qa_ops ON COMMIT DROP AS
SELECT o.id, o.asset_id, o.reservation_id, o.compartment, o.status, c.t0 + o.at AS created_at, o.failure_reason,
       o.reach
FROM qa_ctx c, (VALUES
    -- reach: how far the chronology got (1 authorized, 2 sent, 3 acknowledged, 4 door, 5 observation)
    ('5eed0000-0000-4000-8000-000000000601'::uuid, '5eed0000-0000-4000-8000-000000000301'::uuid, '5eed0000-0000-4000-8000-000000000501'::uuid, 'A1', 'CONFIRMED', interval '-2 days' + interval '5 minutes', NULL, 5),
    ('5eed0000-0000-4000-8000-000000000602'::uuid, '5eed0000-0000-4000-8000-000000000302'::uuid, '5eed0000-0000-4000-8000-000000000502'::uuid, 'A2', 'CONFIRMED', interval '-9 days' + interval '5 minutes', NULL, 5),
    ('5eed0000-0000-4000-8000-000000000603'::uuid, '5eed0000-0000-4000-8000-000000000303'::uuid, '5eed0000-0000-4000-8000-000000000503'::uuid, 'A1', 'CONFIRMED', interval '-6 days' + interval '5 minutes', NULL, 5),
    ('5eed0000-0000-4000-8000-000000000604'::uuid, '5eed0000-0000-4000-8000-000000000304'::uuid, '5eed0000-0000-4000-8000-000000000504'::uuid, 'A1', 'ANOMALY', interval '-1 day' + interval '5 minutes', 'EXPECTED_ASSET_NOT_OBSERVED', 5),
    ('5eed0000-0000-4000-8000-000000000605'::uuid, '5eed0000-0000-4000-8000-000000000305'::uuid, '5eed0000-0000-4000-8000-000000000505'::uuid, 'A2', 'ANOMALY', interval '-3 days' + interval '5 minutes', 'DOOR_NOT_CLOSED_BEFORE_EXPIRY', 4),
    ('5eed0000-0000-4000-8000-000000000607'::uuid, '5eed0000-0000-4000-8000-000000000307'::uuid, '5eed0000-0000-4000-8000-000000000507'::uuid, 'A2', 'FAILED', interval '-4 days' + interval '5 minutes', 'COMMAND_REJECTED', 2),
    ('5eed0000-0000-4000-8000-000000000608'::uuid, '5eed0000-0000-4000-8000-000000000308'::uuid, '5eed0000-0000-4000-8000-000000000508'::uuid, 'A1', 'ANOMALY', interval '-5 days' + interval '5 minutes', 'EXPECTED_ASSET_NOT_OBSERVED', 5)
) AS o(id, asset_id, reservation_id, compartment, status, at, failure_reason, reach);

INSERT INTO aegis.locker_operations (
    id, type, status, user_id, asset_id, locker_id, compartment_id, reservation_id, loan_id,
    expected_asset_identifier_id, created_at, authorized_at, local_proof_validated_at, expires_at,
    command_sent_at, acknowledged_at, door_opened_at, observation_received_at, confirmed_at, terminal_at,
    failure_reason)
SELECT o.id, 'CHECKOUT', o.status, c.tech_id, o.asset_id, c.locker_id,
       CASE o.compartment WHEN 'A1' THEN c.a1 ELSE c.a2 END, o.reservation_id, NULL,
       ('5eed0000-0000-4000-8000-000000000' || (400 + right(o.asset_id::text, 1)::int)::text)::uuid,
       o.created_at,
       o.created_at + interval '20 seconds', o.created_at + interval '20 seconds', o.created_at + interval '140 seconds',
       CASE WHEN o.reach >= 2 THEN o.created_at + interval '21 seconds' END,
       CASE WHEN o.reach >= 3 THEN o.created_at + interval '22 seconds' END,
       CASE WHEN o.reach >= 4 THEN o.created_at + interval '30 seconds' END,
       CASE WHEN o.reach >= 5 THEN o.created_at + interval '45 seconds' END,
       CASE WHEN o.status = 'CONFIRMED' THEN o.created_at + interval '46 seconds' END,
       o.created_at + interval '46 seconds',
       o.failure_reason
FROM qa_ops o, qa_ctx c;

-- Loans: active and on time, active and overdue, completed. A late loan stays ACTIVE: lateness never frees custody.
INSERT INTO aegis.loans (id, asset_id, holder_user_id, checkout_operation_id, status, checked_out_at, due_at,
                         return_requested_at, created_at)
SELECT l.id, l.asset_id, c.tech_id, l.op_id, 'ACTIVE', o.created_at + interval '46 seconds',
       c.t0 + l.due, CASE WHEN l.id = '5eed0000-0000-4000-8000-000000000703'::uuid THEN o.created_at + interval '2 days' END,
       o.created_at + interval '46 seconds'
FROM qa_ctx c
JOIN (VALUES
    ('5eed0000-0000-4000-8000-000000000701'::uuid, '5eed0000-0000-4000-8000-000000000301'::uuid, '5eed0000-0000-4000-8000-000000000601'::uuid, interval '5 days'),
    ('5eed0000-0000-4000-8000-000000000702'::uuid, '5eed0000-0000-4000-8000-000000000302'::uuid, '5eed0000-0000-4000-8000-000000000602'::uuid, interval '-2 days'),
    ('5eed0000-0000-4000-8000-000000000703'::uuid, '5eed0000-0000-4000-8000-000000000303'::uuid, '5eed0000-0000-4000-8000-000000000603'::uuid, interval '-3 days')
) AS l(id, asset_id, op_id, due) ON true
JOIN qa_ops o ON o.id = l.op_id;

UPDATE aegis.loans SET status = 'RETURN_PENDING' WHERE id = '5eed0000-0000-4000-8000-000000000703';

-- Tech B holds an ACTIVE reservation whose only checkout attempt failed: doc 09 §8.4 keeps that terminal attempt as
-- currentOperationId. The attempt is terminal, so it never blocks the real flow on the locker.
INSERT INTO aegis.reservations (id, asset_id, user_id, status, reserved_from, reserved_until, created_at)
SELECT '5eed0000-0000-4000-8000-000000000509', '5eed0000-0000-4000-8000-000000000306', '5eed0000-0000-4000-8000-000000000101',
       'ACTIVE', c.t0 - interval '10 minutes', c.t0 + interval '110 minutes', c.t0 - interval '10 minutes'
FROM qa_ctx c;

INSERT INTO aegis.locker_operations (
    id, type, status, user_id, asset_id, locker_id, compartment_id, reservation_id, expected_asset_identifier_id,
    created_at, authorized_at, local_proof_validated_at, expires_at, command_sent_at, terminal_at, failure_reason)
SELECT '5eed0000-0000-4000-8000-000000000609', 'CHECKOUT', 'FAILED', '5eed0000-0000-4000-8000-000000000101',
       '5eed0000-0000-4000-8000-000000000306', c.locker_id, c.a2, '5eed0000-0000-4000-8000-000000000509',
       '5eed0000-0000-4000-8000-000000000406',
       c.t0 - interval '5 minutes', c.t0 - interval '280 seconds', c.t0 - interval '280 seconds',
       c.t0 - interval '160 seconds', c.t0 - interval '279 seconds', c.t0 - interval '270 seconds', 'COMMAND_REJECTED'
FROM qa_ctx c;

INSERT INTO aegis.locker_operations (
    id, type, status, user_id, asset_id, locker_id, compartment_id, reservation_id, loan_id,
    expected_asset_identifier_id, created_at, authorized_at, local_proof_validated_at, expires_at,
    command_sent_at, acknowledged_at, door_opened_at, observation_received_at, confirmed_at, terminal_at)
SELECT '5eed0000-0000-4000-8000-000000000613', 'RETURN', 'CONFIRMED', c.tech_id,
       '5eed0000-0000-4000-8000-000000000303', c.locker_id, c.a1, NULL, '5eed0000-0000-4000-8000-000000000703',
       '5eed0000-0000-4000-8000-000000000403', l.return_requested_at,
       l.return_requested_at + interval '20 seconds', l.return_requested_at + interval '20 seconds',
       l.return_requested_at + interval '140 seconds', l.return_requested_at + interval '21 seconds',
       l.return_requested_at + interval '22 seconds', l.return_requested_at + interval '30 seconds',
       l.return_requested_at + interval '45 seconds', l.return_requested_at + interval '46 seconds',
       l.return_requested_at + interval '46 seconds'
FROM qa_ctx c, aegis.loans l WHERE l.id = '5eed0000-0000-4000-8000-000000000703';

UPDATE aegis.loans
SET status = 'COMPLETED', return_operation_id = '5eed0000-0000-4000-8000-000000000613',
    returned_at = return_requested_at + interval '46 seconds'
WHERE id = '5eed0000-0000-4000-8000-000000000703';

-- Device evidence: one accepted scan message per anomaly operation, with planted sentinels.
INSERT INTO aegis.inbound_device_messages (
    id, locker_device_id, message_id, topic, message_type, operation_id, schema_version, device_session_id,
    boot_count, sequence, occurred_at, received_at, raw_payload, parsed_payload, processing_status)
SELECT m.id, c.device_id, m.message_id, 'aegis/v1/lockers/' || c.locker_id || '/events/rfid-scan-completed',
       'RFID_SCAN_COMPLETED', m.op_id, '1.0', '5eed0000-0000-4000-8000-000000000a01', 1, m.seq,
       o.created_at + interval '44 seconds', o.created_at + interval '45 seconds',
       convert_to('{"synthetic":true,"rawMarker":"QA-RAW-SENTINEL","hmac":"QA-SECRET-SENTINEL"}', 'UTF8'),
       '{"synthetic": true, "rawMarker": "QA-RAW-SENTINEL", "hmac": "QA-SECRET-SENTINEL"}'::jsonb,
       'PROCESSED'
FROM qa_ctx c
JOIN (VALUES
    ('5eed0000-0000-4000-8000-000000000801'::uuid, '5eed0000-0000-4000-8000-000000000811'::uuid, '5eed0000-0000-4000-8000-000000000604'::uuid, 1),
    ('5eed0000-0000-4000-8000-000000000808'::uuid, '5eed0000-0000-4000-8000-000000000818'::uuid, '5eed0000-0000-4000-8000-000000000608'::uuid, 2)
) AS m(id, message_id, op_id, seq) ON true
JOIN qa_ops o ON o.id = m.op_id;

-- The later scan that proves asset 308 back in A1 (resolution evidence); it belongs to no operation.
INSERT INTO aegis.inbound_device_messages (
    id, locker_device_id, message_id, topic, message_type, schema_version, device_session_id,
    boot_count, sequence, occurred_at, received_at, raw_payload, parsed_payload, processing_status)
SELECT '5eed0000-0000-4000-8000-000000000809', c.device_id, '5eed0000-0000-4000-8000-000000000819',
       'aegis/v1/lockers/' || c.locker_id || '/events/rfid-scan-completed', 'RFID_SCAN_COMPLETED', '1.0',
       '5eed0000-0000-4000-8000-000000000a01', 1, 3, c.t0 - interval '4 days', c.t0 - interval '4 days',
       convert_to('{"synthetic":true,"rawMarker":"QA-RAW-SENTINEL"}', 'UTF8'),
       '{"synthetic": true, "rawMarker": "QA-RAW-SENTINEL"}'::jsonb, 'PROCESSED'
FROM qa_ctx c;

INSERT INTO aegis.physical_observations (id, inbound_message_id, locker_id, compartment_id, operation_id, type,
                                         observed_at, identifier_value, value_json)
SELECT p.id, p.message_id, c.locker_id, c.a1, p.op_id, p.type, p.observed_at, p.identifier, p.value
FROM qa_ctx c, (VALUES
    ('5eed0000-0000-4000-8000-000000000901'::uuid, '5eed0000-0000-4000-8000-000000000801'::uuid,
     '5eed0000-0000-4000-8000-000000000604'::uuid, 'ASSET_PRESENT',
     (SELECT created_at + interval '44 seconds' FROM qa_ops WHERE id = '5eed0000-0000-4000-8000-000000000604'),
     NULL::text, '{"value": true, "synthetic": true}'::jsonb),
    ('5eed0000-0000-4000-8000-000000000908'::uuid, '5eed0000-0000-4000-8000-000000000808'::uuid,
     '5eed0000-0000-4000-8000-000000000608'::uuid, 'ASSET_PRESENT',
     (SELECT created_at + interval '44 seconds' FROM qa_ops WHERE id = '5eed0000-0000-4000-8000-000000000608'),
     NULL, '{"value": true, "synthetic": true}'::jsonb),
    ('5eed0000-0000-4000-8000-000000000909'::uuid, '5eed0000-0000-4000-8000-000000000809'::uuid, NULL,
     'ASSET_IDENTIFIER_DETECTED', (SELECT t0 - interval '4 days' FROM qa_ctx), 'E2005EED0000000000000308', NULL)
) AS p(id, message_id, op_id, type, observed_at, identifier, value);

-- Anomalies: OPEN with evidence, ACKNOWLEDGED, RESOLVED, and an OPEN target without any operation that the
-- acknowledgement checks mutate (its missing correlation must stay visible as missing, never invented).
INSERT INTO aegis.anomalies (id, type, severity, status, locker_operation_id, asset_id, compartment_id, detected_at,
                             acknowledged_at, acknowledged_by_user_id, acknowledgement_note, resolved_at,
                             resolution_evidence_observation_id, resolution_note, details)
SELECT a.id, a.type, a.severity, a.status, a.op_id, a.asset_id, CASE a.compartment WHEN 'A1' THEN c.a1 ELSE c.a2 END,
       c.t0 + a.detected,
       CASE WHEN a.status = 'ACKNOWLEDGED' THEN c.t0 + a.detected + interval '1 hour' END,
       CASE WHEN a.status = 'ACKNOWLEDGED' THEN c.admin_id END,
       CASE WHEN a.status = 'ACKNOWLEDGED' THEN 'Inspection synthétique planifiée (seed QA).' END,
       CASE WHEN a.status = 'RESOLVED' THEN c.t0 - interval '4 days' END,
       CASE WHEN a.status = 'RESOLVED' THEN '5eed0000-0000-4000-8000-000000000909'::uuid END,
       CASE WHEN a.status = 'RESOLVED' THEN 'Résolu par le scan synthétique 909 (seed QA).' END,
       jsonb_build_object('synthetic', true, 'rawMarker', 'QA-RAW-SENTINEL', 'hmac', 'QA-SECRET-SENTINEL')
FROM qa_ctx c, (VALUES
    ('5eed0000-0000-4000-8000-000000000b04'::uuid, 'EXPECTED_ASSET_NOT_OBSERVED', 'HIGH', 'OPEN',
     '5eed0000-0000-4000-8000-000000000604'::uuid, '5eed0000-0000-4000-8000-000000000304'::uuid, 'A1', interval '-1 day' + interval '6 minutes'),
    ('5eed0000-0000-4000-8000-000000000b05'::uuid, 'DOOR_NOT_CLOSED_BEFORE_EXPIRY', 'MEDIUM', 'ACKNOWLEDGED',
     '5eed0000-0000-4000-8000-000000000605'::uuid, '5eed0000-0000-4000-8000-000000000305'::uuid, 'A2', interval '-3 days' + interval '6 minutes'),
    ('5eed0000-0000-4000-8000-000000000b06'::uuid, 'UNEXPECTED_ASSET_OBSERVED', 'LOW', 'OPEN',
     NULL, '5eed0000-0000-4000-8000-000000000306'::uuid, 'A2', interval '-2 hours'),
    ('5eed0000-0000-4000-8000-000000000b08'::uuid, 'EXPECTED_ASSET_NOT_OBSERVED', 'HIGH', 'RESOLVED',
     '5eed0000-0000-4000-8000-000000000608'::uuid, '5eed0000-0000-4000-8000-000000000308'::uuid, 'A1', interval '-5 days' + interval '6 minutes')
) AS a(id, type, severity, status, op_id, asset_id, compartment, detected);

-- 25 terminal reservations for paging: two holders, several assets, and six sharing one created_at so only the
-- id tie-breaker of document 09, section 22.1 keeps page boundaries stable.
INSERT INTO aegis.reservations (id, asset_id, user_id, status, reserved_from, reserved_until, created_at,
                                cancelled_at, expired_at)
SELECT ('5eed0000-0000-4000-8000-0000000c' || lpad(n::text, 4, '0'))::uuid,
       ('5eed0000-0000-4000-8000-000000000' || (300 + 1 + n % 8)::text)::uuid,
       CASE WHEN n % 3 = 0 THEN '5eed0000-0000-4000-8000-000000000101'::uuid ELSE c.tech_id END,
       CASE WHEN n % 2 = 0 THEN 'CANCELLED' ELSE 'EXPIRED' END,
       ts, ts + interval '1 hour', ts,
       CASE WHEN n % 2 = 0 THEN ts + interval '10 minutes' END,
       CASE WHEN n % 2 = 1 THEN ts + interval '1 hour' END
FROM qa_ctx c,
     LATERAL (SELECT n, CASE WHEN n BETWEEN 10 AND 15 THEN c.t0 - interval '20 days'
                             ELSE c.t0 - interval '30 days' + n * interval '7 hours' END AS ts
              FROM generate_series(1, 25) AS n) AS g;

-- Correlated audit trail of the synthetic operations, append-only like any audit row.
INSERT INTO aegis.audit_events (event_type, actor_user_id, subject_type, subject_id, operation_id, from_state,
                                to_state, result, reason, details, occurred_at)
SELECT e.event_type, CASE WHEN e.by_user THEN c.tech_id END, 'LOCKER_OPERATION', o.id, o.id, e.from_state,
       e.to_state, e.result, NULL,
       jsonb_build_object('synthetic', true, 'accessToken', 'QA-SECRET-SENTINEL'),
       o.created_at + e.at
FROM qa_ops o, qa_ctx c, (VALUES
    ('OPERATION_REQUESTED', true, NULL, NULL, 'ACCEPTED', interval '0 seconds', 0),
    ('OPERATION_AUTHORIZED', true, 'AWAITING_LOCAL_PROOF', 'AUTHORIZED', 'ACCEPTED', interval '20 seconds', 1),
    ('COMMAND_SENT', false, 'AUTHORIZED', 'COMMAND_SENT', 'IN_PROGRESS', interval '21 seconds', 2),
    ('COMMAND_ACKNOWLEDGED', false, 'COMMAND_SENT', 'COMMAND_ACKNOWLEDGED', 'IN_PROGRESS', interval '22 seconds', 3),
    ('DOOR_OPENED', false, 'COMMAND_ACKNOWLEDGED', 'DOOR_OPENED', 'IN_PROGRESS', interval '30 seconds', 4),
    ('OBSERVATION_RECEIVED', false, 'DOOR_OPENED', 'OBSERVATION_RECEIVED', 'IN_PROGRESS', interval '45 seconds', 5)
) AS e(event_type, by_user, from_state, to_state, result, at, reach)
WHERE e.reach <= o.reach;

-- Terminal event of each operation. The register has no dedicated event for a transition to ANOMALY, so the
-- seed records it as OPERATION_FAILED with to_state ANOMALY and result ANOMALY_REQUIRES_ACTION (seed choice,
-- not a contract).
INSERT INTO aegis.audit_events (event_type, actor_user_id, subject_type, subject_id, operation_id, from_state,
                                to_state, result, reason, details, occurred_at)
SELECT CASE o.status WHEN 'CONFIRMED' THEN 'OPERATION_CONFIRMED' WHEN 'FAILED' THEN 'OPERATION_FAILED'
                     ELSE 'OPERATION_FAILED' END,
       NULL, 'LOCKER_OPERATION', o.id, o.id,
       CASE o.reach WHEN 5 THEN 'OBSERVATION_RECEIVED' WHEN 4 THEN 'DOOR_OPENED' ELSE 'COMMAND_SENT' END,
       o.status,
       CASE o.status WHEN 'CONFIRMED' THEN 'ACCEPTED' WHEN 'ANOMALY' THEN 'ANOMALY_REQUIRES_ACTION' ELSE 'REJECTED' END,
       o.failure_reason, '{"synthetic": true}'::jsonb, o.created_at + interval '46 seconds'
FROM qa_ops o;

INSERT INTO aegis.audit_events (event_type, actor_user_id, subject_type, subject_id, operation_id, from_state,
                                to_state, result, reason, details, occurred_at)
SELECT 'ANOMALY_CREATED', NULL, 'ANOMALY', a.id, a.locker_operation_id, NULL, NULL, 'ANOMALY_REQUIRES_ACTION',
       a.type, '{"synthetic": true, "rawMarker": "QA-RAW-SENTINEL"}'::jsonb, a.detected_at
FROM aegis.anomalies a WHERE a.id::text LIKE '5eed0000-%'
UNION ALL
SELECT 'ANOMALY_ACKNOWLEDGED', a.acknowledged_by_user_id, 'ANOMALY', a.id, a.locker_operation_id, 'OPEN',
       'ACKNOWLEDGED', 'ACCEPTED', NULL, '{"synthetic": true}'::jsonb, a.acknowledged_at
FROM aegis.anomalies a WHERE a.id = '5eed0000-0000-4000-8000-000000000b05'
UNION ALL
SELECT 'ANOMALY_RESOLVED', NULL, 'ANOMALY', a.id, a.locker_operation_id, 'OPEN', 'RESOLVED', 'ACCEPTED', NULL,
       '{"synthetic": true}'::jsonb, a.resolved_at
FROM aegis.anomalies a WHERE a.id = '5eed0000-0000-4000-8000-000000000b08'
UNION ALL
SELECT 'CHECKOUT_CONFIRMED', NULL, 'LOAN', l.id, l.checkout_operation_id, NULL, NULL, 'ACCEPTED', NULL,
       '{"synthetic": true}'::jsonb, l.checked_out_at
FROM aegis.loans l WHERE l.id::text LIKE '5eed0000-%'
UNION ALL
SELECT 'LOAN_COMPLETED', NULL, 'LOAN', l.id, l.return_operation_id, 'RETURN_PENDING', 'COMPLETED', 'ACCEPTED', NULL,
       '{"synthetic": true}'::jsonb, l.returned_at
FROM aegis.loans l WHERE l.id = '5eed0000-0000-4000-8000-000000000703';

COMMIT;
