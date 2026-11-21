-- Synthetic OPEN anomalies for the Web screen review, applied after the matrix (which acknowledges every seeded one).
-- b10 is linked to the FAILED operation 607, b11 has no operation (missing correlation), b12 serves the 409 race.
-- No audit event is written for them: they are fixtures, not the result of a detection flow.
INSERT INTO aegis.anomalies (id, type, severity, status, locker_operation_id, asset_id, compartment_id, detected_at, details)
SELECT v.id::uuid, v.type, v.sev, 'OPEN', v.op::uuid, v.asset::uuid,
       (SELECT compartment_id FROM aegis.locker_operations WHERE id = '5eed0000-0000-4000-8000-000000000607'),
       now() - v.ago::interval, jsonb_build_object('synthetic', true, 'rawMarker', 'QA-RAW-SENTINEL')
FROM (VALUES
  ('5eed0000-0000-4000-8000-000000000b10', 'COMMAND_REJECTED', 'HIGH', '5eed0000-0000-4000-8000-000000000607', '5eed0000-0000-4000-8000-000000000307', '30 minutes'),
  ('5eed0000-0000-4000-8000-000000000b11', 'UNEXPECTED_ASSET_OBSERVED', 'LOW', NULL, '5eed0000-0000-4000-8000-000000000306', '20 minutes'),
  ('5eed0000-0000-4000-8000-000000000b12', 'INCONSISTENT_PHYSICAL_STATE', 'MEDIUM', NULL, '5eed0000-0000-4000-8000-000000000305', '10 minutes')
) AS v(id, type, sev, op, asset, ago);
