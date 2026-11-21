/**
 * Samples of the filtered `details` (09 §19.1) as `GET /admin/audit-events` sent them, captured on 21 November 2026
 * from the API built from this branch (services/api, AuditDetailsFilter) against a throwaway PostgreSQL 16, after the
 * events were produced through the administrative REST API. Key order is the server's, which is not the allowlist's
 * order. The identifiers are those of that disposable database. Tests only; never imported by production code.
 */
export const ASSET_CREATED_MODEL = {"created": {"name": "Multimètre Fluke 117", "modelNumber": "117", "manufacturer": "Fluke", "defaultCalibrationRequired": true}} as const

export const ASSET_CREATED_UNIT = {"created": {"assetCode": "AEG-DEMO-005", "assetModelId": "2b310b29-d4d3-47b6-807a-6e77c91306c4", "serialNumber": "FL117-0005", "calibrationDueAt": "2027-01-31T05:00:00Z", "operationalStatus": "MAINTENANCE", "calibrationRequired": true, "requiredAccessLevel": "STANDARD"}} as const

export const ASSET_UPDATED_STATUS = {"changes": {"operationalStatus": {"to": "MAINTENANCE", "from": "SERVICEABLE"}}} as const

export const ASSET_UPDATED_SERIAL_LEVEL = {"changes": {"serialNumber": {"to": "FL117-0001-R", "from": "FL117-0001"}, "operationalStatus": {"to": "SERVICEABLE", "from": "MAINTENANCE"}, "requiredAccessLevel": {"to": "RESTRICTED", "from": "STANDARD"}}} as const

export const ASSET_UPDATED_CALIBRATION = {"changes": {"calibrationDueAt": {"to": "2027-06-30T04:00:00Z", "from": null}, "operationalStatus": {"to": "DAMAGED", "from": "SERVICEABLE"}, "calibrationRequired": {"to": true, "from": false}}} as const

export const ASSET_UPDATED_REVOKED = {"revoked": {"type": "RFID_UHF", "assetId": "751f88c9-e507-4894-a578-f284ee2abeaa"}, "revokedAt": "2026-11-21T13:39:47.997085Z"} as const

export const ASSET_PLACEMENT_MOVED = {"to": {"lockerId": "d46a74ae-39dc-460b-8af0-38fc791b376a", "assignedAt": "2026-11-21T13:39:48.024363Z", "lockerCode": "AEGIS-DEMO-01", "placementId": "c0ad4c46-400d-4daf-9f5e-3b165af26b89", "compartmentId": "5c1d0b7e-2f4a-4d3b-9a61-0e8b7c2d4f10", "compartmentCode": "A2"}, "from": {"lockerId": "d46a74ae-39dc-460b-8af0-38fc791b376a", "assignedAt": "2026-11-21T13:39:10.962177Z", "lockerCode": "AEGIS-DEMO-01", "placementId": "9b0dad31-6b58-4c2b-a04f-f082dc4dd3a5", "compartmentId": "1ae77ae3-8490-4f09-9412-a7816b77bff9", "compartmentCode": "A1"}} as const

export const ASSET_PLACEMENT_FIRST = {"to": {"lockerId": "d46a74ae-39dc-460b-8af0-38fc791b376a", "assignedAt": "2026-11-21T13:39:11.034579Z", "lockerCode": "AEGIS-DEMO-01", "placementId": "061734ed-613f-4971-afa9-d7dd022f6cce", "compartmentId": "5c1d0b7e-2f4a-4d3b-9a61-0e8b7c2d4f10", "compartmentCode": "A2"}, "from": null} as const

export const ASSET_PLACEMENT_ENDED = {"to": null, "from": {"lockerId": "d46a74ae-39dc-460b-8af0-38fc791b376a", "assignedAt": "2026-11-21T13:39:11.034579Z", "lockerCode": "AEGIS-DEMO-01", "placementId": "061734ed-613f-4971-afa9-d7dd022f6cce", "compartmentId": "5c1d0b7e-2f4a-4d3b-9a61-0e8b7c2d4f10", "compartmentCode": "A2"}} as const

export const ASSET_IDENTIFIER_ASSIGNED = {"assigned": {"type": "NFC", "assetId": "116f5db2-227b-4a3f-ac7c-7fd246d4e5a3"}} as const

export const SCHEDULE_UPDATED_FIRST = {"after": {"windows": [{"enabled": true, "opensAt": "07:00:00", "closesAt": "18:00:00", "dayOfWeek": "MONDAY"}, {"enabled": true, "opensAt": "07:00:00", "closesAt": "18:00:00", "dayOfWeek": "TUESDAY"}, {"enabled": true, "opensAt": "07:00:00", "closesAt": "18:00:00", "dayOfWeek": "WEDNESDAY"}, {"enabled": true, "opensAt": "07:00:00", "closesAt": "18:00:00", "dayOfWeek": "THURSDAY"}, {"enabled": true, "opensAt": "07:00:00", "closesAt": "18:00:00", "dayOfWeek": "FRIDAY"}, {"enabled": false, "opensAt": null, "closesAt": null, "dayOfWeek": "SATURDAY"}, {"enabled": false, "opensAt": null, "closesAt": null, "dayOfWeek": "SUNDAY"}], "timeZone": "America/Toronto"}, "before": null, "previousScheduleId": null} as const

export const SCHEDULE_UPDATED_CHANGED = {"after": {"windows": [{"enabled": true, "opensAt": "07:00:00", "closesAt": "19:30:00", "dayOfWeek": "MONDAY"}, {"enabled": true, "opensAt": "07:00:00", "closesAt": "19:30:00", "dayOfWeek": "TUESDAY"}, {"enabled": true, "opensAt": "07:00:00", "closesAt": "19:30:00", "dayOfWeek": "WEDNESDAY"}, {"enabled": true, "opensAt": "07:00:00", "closesAt": "19:30:00", "dayOfWeek": "THURSDAY"}, {"enabled": true, "opensAt": "07:00:00", "closesAt": "19:30:00", "dayOfWeek": "FRIDAY"}, {"enabled": false, "opensAt": null, "closesAt": null, "dayOfWeek": "SATURDAY"}, {"enabled": false, "opensAt": null, "closesAt": null, "dayOfWeek": "SUNDAY"}], "timeZone": "America/Toronto"}, "before": {"windows": [{"enabled": true, "opensAt": "07:00:00", "closesAt": "18:00:00", "dayOfWeek": "MONDAY"}, {"enabled": true, "opensAt": "07:00:00", "closesAt": "18:00:00", "dayOfWeek": "TUESDAY"}, {"enabled": true, "opensAt": "07:00:00", "closesAt": "18:00:00", "dayOfWeek": "WEDNESDAY"}, {"enabled": true, "opensAt": "07:00:00", "closesAt": "18:00:00", "dayOfWeek": "THURSDAY"}, {"enabled": true, "opensAt": "07:00:00", "closesAt": "18:00:00", "dayOfWeek": "FRIDAY"}, {"enabled": false, "opensAt": null, "closesAt": null, "dayOfWeek": "SATURDAY"}, {"enabled": false, "opensAt": null, "closesAt": null, "dayOfWeek": "SUNDAY"}], "timeZone": "America/Toronto"}, "previousScheduleId": "84b4690b-5933-4f94-949a-0b2734a102d6"} as const

export const ASSET_ARCHIVED = {"archivedAt": "2026-11-21T13:39:47.997085Z"} as const

/**
 * Built from the paths of AuditDetailsFilter, for the shapes the capture did not produce: a reservation that ends
 * operations (`endedOperationIds[]`), an empty list and an empty container (the filter keeps both).
 */
export const RESERVATION_CANCELLED = {
  assetId: '116f5db2-227b-4a3f-ac7c-7fd246d4e5a3',
  cancelledAt: '2026-11-21T14:05:00Z',
  reservedUntil: '2026-11-21T20:00:00Z',
  endedOperationIds: ['2f38d3b6-c18f-4a74-aa9a-2d574286013f', '9a0b1c2d-3e4f-4a5b-8c6d-7e8f90a1b2c3'],
} as const

export const RESERVATION_EXPIRED_NO_OPERATION = {
  assetId: '116f5db2-227b-4a3f-ac7c-7fd246d4e5a3',
  reservedUntil: '2026-11-21T20:00:00Z',
  endedOperationIds: [],
} as const
