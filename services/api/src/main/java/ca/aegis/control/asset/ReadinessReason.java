package ca.aegis.control.asset;

/** Readiness reasons of document 09, section 8.1, in their documented order. */
public enum ReadinessReason {
    NOT_PRESENT,
    NOT_AVAILABLE,
    MAINTENANCE,
    DAMAGED,
    CALIBRATION_EXPIRED,
    ACCESS_DENIED,
    UNKNOWN_PHYSICAL_STATE
}
